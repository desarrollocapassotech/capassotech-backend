import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { UserRole } from '../auth/auth.types';
import { CollaboratorEntity, ProjectEntity, TaskBillingType, TimeEntryEntity } from '../database/entities';
import { CreateTimeEntryDto, UpdateTimeEntryDto } from './time-entries.dto';

export interface SheetSyncRunResult {
  attempted: number;
  synced: number;
}

export interface SheetSyncStatus {
  pendingCount: number;
  oldestPendingDate: string | null;
  recentErrors: Array<{ id: string; date: string; attempts: number; lastError: string | null }>;
}

// Cuántos registros pendientes reintenta como máximo cada corrida (cron o manual),
// para no mandarle a Apps Script una ráfaga enorme de golpe si estuvo caído un rato.
const SHEET_SYNC_BATCH_SIZE = 100;

export interface RequesterContext {
  uid: string;
  roles: UserRole[];
}

// Reporting está en Argentina; se fija el offset acá en vez de usar la zona
// horaria del server (Render corre en UTC) para no romper el formato que ya
// espera la hoja de cálculo.
const ARGENTINA_UTC_OFFSET = '-03:00';

@Injectable()
export class TimeEntriesService {
  private readonly logger = new Logger(TimeEntriesService.name);

  constructor(
    @InjectRepository(TimeEntryEntity)
    private readonly timeEntryRepository: Repository<TimeEntryEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    private readonly configService: ConfigService,
  ) {}

  findAll(): Promise<TimeEntryEntity[]> {
    return this.timeEntryRepository.find({ order: { date: 'DESC' } });
  }

  async findOne(id: string): Promise<TimeEntryEntity> {
    const found = await this.timeEntryRepository.findOneBy({ id });
    if (!found) {
      throw new NotFoundException('Registro de horas no encontrado.');
    }
    return found;
  }

  // Cualquier usuario autenticado puede cargar horas, pero solo para sí mismo; admin
  // y contable pueden cargarlas para cualquier colaborador (igual que hoy en
  // AdminTimeManagement.tsx, incluida la carga masiva por XLSX).
  async create(dto: CreateTimeEntryDto, requester: RequesterContext): Promise<TimeEntryEntity> {
    this.validateBasicFields(dto);

    const isPrivileged = requester.roles.includes(UserRole.ADMIN) || requester.roles.includes(UserRole.CONTABLE);

    if (!isPrivileged) {
      const ownCollaborator = await this.collaboratorRepository.findOneBy({ userId: requester.uid });
      if (!ownCollaborator || ownCollaborator.id !== dto.colaboradorId) {
        throw new ForbiddenException('Solo podés cargar horas para vos mismo.');
      }
    }

    const collaborator = await this.collaboratorRepository.findOneBy({ id: dto.colaboradorId });
    if (!collaborator) {
      throw new BadRequestException('El colaborador indicado no existe.');
    }

    const project = await this.projectRepository.findOneBy({ id: dto.projectId });
    if (!project) {
      throw new BadRequestException('El proyecto indicado no existe.');
    }

    const entry = this.timeEntryRepository.create({
      id: randomUUID(),
      collaboratorId: collaborator.id,
      collaboratorName: collaborator.name,
      taskId: dto.taskId ?? '',
      taskTitle: dto.taskTitle ?? '',
      projectId: project.id,
      projectName: project.name,
      date: this.normalizeDate(dto.date),
      hours: String(dto.hours),
      comments: dto.comments ?? null,
      taskBillingType: dto.taskBillingType ?? TaskBillingType.FEATURE,
    });

    const saved = await this.timeEntryRepository.save(entry);

    // Intento inmediato (no bloquea la respuesta al usuario). Si falla, queda
    // con sheetSyncedAt = null y lo levanta resyncPendingSheetEntries().
    this.trySyncToGoogleSheet(saved).catch((error) => {
      this.logger.error(`Error inesperado sincronizando ${saved.id} con Sheets: ${(error as Error).message}`);
    });

    return saved;
  }

  // Edición: solo admin/contable (ver TimeEntriesController), ninguna otra revisión
  // de permisos adicional acá.
  async update(id: string, dto: UpdateTimeEntryDto): Promise<TimeEntryEntity> {
    const existing = await this.findOne(id);

    if (dto.colaboradorId !== undefined) {
      const collaborator = await this.collaboratorRepository.findOneBy({ id: dto.colaboradorId });
      if (!collaborator) {
        throw new BadRequestException('El colaborador indicado no existe.');
      }
      existing.collaboratorId = collaborator.id;
      existing.collaboratorName = collaborator.name;
    }

    if (dto.projectId !== undefined) {
      const project = await this.projectRepository.findOneBy({ id: dto.projectId });
      if (!project) {
        throw new BadRequestException('El proyecto indicado no existe.');
      }
      existing.projectId = project.id;
      existing.projectName = project.name;
    }

    if (dto.taskId !== undefined) existing.taskId = dto.taskId;
    if (dto.taskTitle !== undefined) existing.taskTitle = dto.taskTitle;
    if (dto.date !== undefined) existing.date = this.normalizeDate(dto.date);
    if (dto.hours !== undefined) existing.hours = String(dto.hours);
    if (dto.comments !== undefined) existing.comments = dto.comments;
    if (dto.taskBillingType !== undefined) existing.taskBillingType = dto.taskBillingType;

    return this.timeEntryRepository.save(existing);
  }

  async remove(id: string): Promise<void> {
    const result = await this.timeEntryRepository.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException('Registro de horas no encontrado.');
    }
  }

  private validateBasicFields(dto: CreateTimeEntryDto): void {
    if (!dto.colaboradorId) throw new BadRequestException('Falta el colaborador.');
    if (!dto.projectId) throw new BadRequestException('Falta el proyecto.');
    if (!dto.date) throw new BadRequestException('Falta la fecha.');
    if (dto.hours === undefined || dto.hours === null || Number.isNaN(Number(dto.hours))) {
      throw new BadRequestException('Falta la cantidad de horas.');
    }
  }

  // Igual que normalizeDateToLocalMidnight del frontend: se guarda solo el día
  // calendario, sin hora.
  private normalizeDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('La fecha no tiene un formato válido.');
    }
    return date.toISOString().split('T')[0];
  }

  // Vuelca el registro a una hoja de cálculo externa usada para reporting.
  // Migrado desde el frontend (antes lo llamaba el navegador directo); mismo
  // payload y formato de fecha que esperaba el Apps Script.
  private async appendToGoogleSheet(entry: TimeEntryEntity): Promise<void> {
    const url = this.configService.get<string>('GOOGLE_SHEETS_TIME_ENTRIES_WEBHOOK_URL');
    if (!url) {
      return;
    }

    const dateWithOffset = `${entry.date}T00:00:00${ARGENTINA_UTC_OFFSET}`;

    const payload = {
      colaboradorId: entry.collaboratorId,
      colaboradorName: entry.collaboratorName,
      taskId: entry.taskId,
      taskTitle: entry.taskTitle ?? '',
      projectId: entry.projectId,
      projectName: entry.projectName ?? '',
      startDate: dateWithOffset,
      endDate: dateWithOffset,
      hours: Number(entry.hours),
      comments: entry.comments ?? '',
      taskBillingType: entry.taskBillingType ?? TaskBillingType.FEATURE,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Apps Script respondió ${response.status}`);
    }
  }

  // Intenta volcar un registro puntual y persiste el resultado (sheetSyncedAt o
  // el error/intento) para que quede trazado quién falta y por qué.
  private async trySyncToGoogleSheet(entry: TimeEntryEntity): Promise<boolean> {
    try {
      await this.appendToGoogleSheet(entry);
      await this.timeEntryRepository.update(entry.id, {
        sheetSyncedAt: new Date(),
        sheetSyncLastError: null,
      });
      return true;
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`No se pudo volcar el registro ${entry.id} a Google Sheets: ${message}`);
      await this.timeEntryRepository.update(entry.id, { sheetSyncLastError: message });
      await this.timeEntryRepository.increment({ id: entry.id }, 'sheetSyncAttempts', 1);
      return false;
    }
  }

  // Red de seguridad: reintenta lo que haya quedado sin confirmar (falla de red,
  // Apps Script caído, cuota excedida, etc). Corre solo, y también queda expuesto
  // para forzarlo manualmente desde el endpoint de admin.
  @Cron(CronExpression.EVERY_HOUR)
  async resyncPendingSheetEntries(): Promise<SheetSyncRunResult> {
    const pending = await this.timeEntryRepository.find({
      where: { sheetSyncedAt: IsNull() },
      order: { createdAt: 'ASC' },
      take: SHEET_SYNC_BATCH_SIZE,
    });

    if (!pending.length) {
      return { attempted: 0, synced: 0 };
    }

    this.logger.log(`Sync con Sheets: reintentando ${pending.length} registro(s) pendiente(s).`);

    let synced = 0;
    for (const entry of pending) {
      if (await this.trySyncToGoogleSheet(entry)) {
        synced += 1;
      }
    }

    this.logger.log(`Sync con Sheets: ${synced}/${pending.length} sincronizado(s) en esta corrida.`);
    return { attempted: pending.length, synced };
  }

  // Para el panel de admin: cuántas horas están sin confirmar en el sheet y desde cuándo.
  async getSheetSyncStatus(): Promise<SheetSyncStatus> {
    const pending = await this.timeEntryRepository.find({
      where: { sheetSyncedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });

    return {
      pendingCount: pending.length,
      oldestPendingDate: pending[0]?.date ?? null,
      recentErrors: pending
        .filter((entry) => entry.sheetSyncAttempts > 0)
        .slice(0, 10)
        .map((entry) => ({
          id: entry.id,
          date: entry.date,
          attempts: entry.sheetSyncAttempts,
          lastError: entry.sheetSyncLastError,
        })),
    };
  }
}
