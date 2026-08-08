import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { CollaboratorEntity, ExpenseEntity, ProjectEntity, UserRole } from '../database/entities';
import { CreateExpenseDto, UpdateExpenseDto } from './expenses.dto';
import { buildExpenseNotificationHtml } from './expense-notification.template';

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    @InjectRepository(ExpenseEntity)
    private readonly expenseRepository: Repository<ExpenseEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    private readonly resendService: ResendService,
  ) {}

  findAll(): Promise<ExpenseEntity[]> {
    return this.expenseRepository.find({ order: { expenseDate: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<ExpenseEntity> {
    const expense = await this.expenseRepository.findOneBy({ id });
    if (!expense) {
      throw new NotFoundException('Gasto no encontrado.');
    }
    return expense;
  }

  async create(dto: CreateExpenseDto, actorEmail: string): Promise<ExpenseEntity> {
    if (!dto.description?.trim()) {
      throw new BadRequestException('Falta la descripción del gasto.');
    }
    if (dto.amount == null || Number.isNaN(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('El monto debe ser un número mayor a 0.');
    }

    const expense = this.expenseRepository.create({
      id: randomUUID(),
      description: dto.description.trim(),
      amount: String(dto.amount),
      currency: dto.currency ?? undefined,
      periodicity: dto.periodicity ?? undefined,
      projectId: dto.projectId ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      category: dto.category ?? null,
      expenseDate: dto.expenseDate ?? null,
      notes: dto.notes ?? null,
      createdBy: actorEmail,
    });

    const saved = await this.trySave(expense, 'crear');
    void this.notifyExpenseWatchers(saved, 'creado', actorEmail);
    return saved;
  }

  async update(id: string, dto: UpdateExpenseDto, actorEmail: string): Promise<ExpenseEntity> {
    const existing = await this.findOne(id);

    if (dto.description !== undefined) {
      if (!dto.description?.trim()) {
        throw new BadRequestException('Falta la descripción del gasto.');
      }
      existing.description = dto.description.trim();
    }
    if (dto.amount !== undefined) {
      if (dto.amount == null || Number.isNaN(dto.amount) || dto.amount <= 0) {
        throw new BadRequestException('El monto debe ser un número mayor a 0.');
      }
      existing.amount = String(dto.amount);
    }
    if (dto.currency !== undefined) existing.currency = dto.currency;
    if (dto.periodicity !== undefined) existing.periodicity = dto.periodicity;
    if (dto.projectId !== undefined) existing.projectId = dto.projectId;
    if (dto.paymentMethod !== undefined) existing.paymentMethod = dto.paymentMethod;
    if (dto.category !== undefined) existing.category = dto.category;
    if (dto.expenseDate !== undefined) existing.expenseDate = dto.expenseDate;
    if (dto.notes !== undefined) existing.notes = dto.notes;

    const saved = await this.trySave(existing, 'actualizar');
    void this.notifyExpenseWatchers(saved, 'actualizado', actorEmail);
    return saved;
  }

  async remove(id: string): Promise<void> {
    const result = await this.expenseRepository.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException('Gasto no encontrado.');
    }
  }

  private async trySave(expense: ExpenseEntity, action: 'crear' | 'actualizar'): Promise<ExpenseEntity> {
    try {
      return await this.expenseRepository.save(expense);
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new BadRequestException(`No se pudo ${action} el gasto: el proyecto asignado no existe.`);
      }
      throw error;
    }
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503';
  }

  // Best-effort: si Resend falla o no está configurado, el gasto ya se guardó y la
  // request no debe fallar por eso (ver ResendService, no lanza sin API key).
  private async notifyExpenseWatchers(expense: ExpenseEntity, action: 'creado' | 'actualizado', actorEmail: string): Promise<void> {
    try {
      // roles es un array de Postgres: se filtra en memoria (mismo criterio que ya
      // usa el frontend para listas cortas como esta) en vez de armar un WHERE con
      // el operador @> a mano. Mismos roles que pueden ver/gestionar Gastos (ver
      // @Roles en ExpensesController): admin + contable, no solo admin.
      const collaborators = await this.collaboratorRepository.find();
      const watchers = collaborators.filter(
        (collaborator) => collaborator.roles.includes(UserRole.ADMIN) || collaborator.roles.includes(UserRole.CONTABLE),
      );
      const recipients = [...new Set(watchers.map((watcher) => watcher.workEmail ?? watcher.personalEmail).filter((email): email is string => !!email))];
      if (recipients.length === 0) {
        this.logger.warn('No hay ningún admin/contable con email configurado; se omite la notificación de gasto.');
        return;
      }

      const projectName = expense.projectId
        ? (await this.projectRepository.findOneBy({ id: expense.projectId }))?.name
        : null;

      const subject = `Gasto ${action}: ${expense.description}`;
      const rows: [string, string][] = [
        ['Concepto', expense.description],
        ['Monto', `${Number(expense.amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${expense.currency}`],
        ['Periodicidad', expense.periodicity === 'mensual' ? 'Mensual' : 'Único'],
        ['Proyecto', projectName ?? 'Sin proyecto asociado'],
        ['Medio de pago', expense.paymentMethod ?? '-'],
        ['Categoría', expense.category ?? '-'],
        ['Fecha', expense.expenseDate ?? '-'],
        ['Notas', expense.notes ?? '-'],
        ['Realizado por', actorEmail],
      ];
      const html = buildExpenseNotificationHtml(action, rows);

      await this.resendService.send({ to: recipients, subject, html });
    } catch (error) {
      this.logger.error(`No se pudo notificar el gasto ${expense.id} por email: ${(error as Error).message}`);
    }
  }
}
