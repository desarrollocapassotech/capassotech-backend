import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CcImputationEntity,
  CcMovementEntity,
  ClientEntity,
  ProjectBillingTermEntity,
  ProjectEntity,
} from '../database/entities';
import {
  condicionDeEntidad,
  errorDeCondicion,
  type CondicionCobro,
} from './condiciones';

export interface BillingTermDto {
  clientId?: unknown;
  desde?: unknown;
  hasta?: unknown;
  currency?: unknown;
  monthlyAmount?: unknown;
  hourlyRate?: unknown;
}

const monto = (v: unknown, campo: string): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new BadRequestException(`${campo} debe ser un número mayor a cero.`);
  }
  return Math.round(n * 100) / 100;
};

const mes = (v: unknown): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') {
    throw new BadRequestException('Los meses deben tener formato YYYY-MM.');
  }
  return v;
};

// Condiciones de cobro de un proyecto (ver condiciones.ts). Una condición que ya generó un cargo
// del mes con imputaciones queda fija: solo se puede cerrar (`hasta`), para no cambiar meses que
// ya se cobraron. El cambio de montos se hace cerrando la vigente y abriendo otra.
@Injectable()
export class BillingTermsService {
  constructor(
    @InjectRepository(ProjectBillingTermEntity)
    private readonly terms: Repository<ProjectBillingTermEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ClientEntity)
    private readonly clients: Repository<ClientEntity>,
    @InjectRepository(CcMovementEntity)
    private readonly movimientos: Repository<CcMovementEntity>,
    @InjectRepository(CcImputationEntity)
    private readonly imputaciones: Repository<CcImputationEntity>,
  ) {}

  async listar(filtro: { projectId?: string; clientId?: string } = {}) {
    const rows = await this.terms.find({
      where: {
        ...(filtro.projectId ? { projectId: filtro.projectId } : {}),
        ...(filtro.clientId ? { clientId: filtro.clientId } : {}),
      },
      order: { desde: 'ASC' },
    });
    return rows.map(condicionDeEntidad);
  }

  async crear(projectId: string, dto: BillingTermDto, email?: string) {
    if (!(await this.projects.existsBy({ id: projectId }))) {
      throw new NotFoundException('Proyecto no encontrado.');
    }
    const clientId = typeof dto.clientId === 'string' ? dto.clientId : '';
    if (!clientId || !(await this.clients.existsBy({ id: clientId }))) {
      throw new BadRequestException('Elegí un cliente que exista.');
    }
    const nueva = {
      desde: mes(dto.desde) ?? '',
      hasta: mes(dto.hasta),
      currency: dto.currency as CondicionCobro['currency'],
      monthlyAmount: monto(dto.monthlyAmount, 'La suscripción'),
      hourlyRate: monto(dto.hourlyRate, 'La tarifa por hora'),
    };
    const otras = await this.listar({ projectId, clientId });
    const error = errorDeCondicion(nueva, otras);
    if (error) throw new BadRequestException(error);
    const saved = await this.terms.save(
      this.terms.create({
        projectId,
        clientId,
        desde: nueva.desde,
        hasta: nueva.hasta,
        currency: nueva.currency,
        monthlyAmount: nueva.monthlyAmount?.toFixed(2) ?? null,
        hourlyRate: nueva.hourlyRate?.toFixed(2) ?? null,
        createdBy: email ?? null,
      }),
    );
    return condicionDeEntidad(saved);
  }

  async editar(projectId: string, id: string, dto: BillingTermDto) {
    const actual = await this.buscar(projectId, id);
    if (dto.clientId !== undefined && dto.clientId !== actual.clientId) {
      throw new BadRequestException(
        'No se puede cambiar el cliente de una condición: creá otra.',
      );
    }
    const editada = {
      desde: dto.desde !== undefined ? (mes(dto.desde) ?? '') : actual.desde,
      hasta: dto.hasta !== undefined ? mes(dto.hasta) : actual.hasta,
      currency:
        dto.currency !== undefined
          ? (dto.currency as CondicionCobro['currency'])
          : actual.currency,
      monthlyAmount:
        dto.monthlyAmount !== undefined
          ? monto(dto.monthlyAmount, 'La suscripción')
          : actual.monthlyAmount,
      hourlyRate:
        dto.hourlyRate !== undefined
          ? monto(dto.hourlyRate, 'La tarifa por hora')
          : actual.hourlyRate,
    };
    const cobrado = await this.ultimoMesCobrado(actual);
    if (cobrado) {
      const cambiaMontos =
        editada.desde !== actual.desde ||
        editada.currency !== actual.currency ||
        editada.monthlyAmount !== actual.monthlyAmount ||
        editada.hourlyRate !== actual.hourlyRate;
      if (cambiaMontos) {
        throw new ConflictException(
          `Esta condición ya se cobró (hay imputaciones hasta ${cobrado}): solo se puede cerrar. Para cambiar el monto, cerrala y creá otra desde el mes siguiente.`,
        );
      }
      if (editada.hasta != null && editada.hasta < cobrado) {
        throw new ConflictException(
          `No se puede cerrar antes de ${cobrado}: ese mes ya tiene imputaciones.`,
        );
      }
    }
    const otras = (
      await this.listar({ projectId, clientId: actual.clientId })
    ).filter((o) => o.id !== id);
    const error = errorDeCondicion(editada, otras);
    if (error) throw new BadRequestException(error);
    await this.terms.update(
      { id },
      {
        desde: editada.desde,
        hasta: editada.hasta,
        currency: editada.currency,
        monthlyAmount: editada.monthlyAmount?.toFixed(2) ?? null,
        hourlyRate: editada.hourlyRate?.toFixed(2) ?? null,
      },
    );
    return this.buscar(projectId, id);
  }

  async eliminar(projectId: string, id: string) {
    const actual = await this.buscar(projectId, id);
    const cobrado = await this.ultimoMesCobrado(actual);
    if (cobrado) {
      throw new ConflictException(
        `Esta condición ya se cobró (hay imputaciones hasta ${cobrado}): cerrala en vez de eliminarla.`,
      );
    }
    await this.terms.delete({ id });
  }

  private async buscar(projectId: string, id: string) {
    const row = await this.terms.findOneBy({ id, projectId });
    if (!row) throw new NotFoundException('Condición no encontrada.');
    return condicionDeEntidad(row);
  }

  /**
   * Último mes de la vigencia con un cargo del mes del cliente que tiene una línea de este
   * proyecto y alguna imputación. Null si nada se cobró todavía.
   */
  private async ultimoMesCobrado(c: CondicionCobro): Promise<string | null> {
    const qb = this.movimientos
      .createQueryBuilder('m')
      .where(
        `m.client_id = :cliente AND m.origen = 'mes' AND m.month >= :desde`,
        {
          cliente: c.clientId,
          desde: c.desde,
        },
      );
    if (c.hasta) qb.andWhere('m.month <= :hasta', { hasta: c.hasta });
    const cargos = (await qb.getMany()).filter((m) =>
      (m.detail?.lineas ?? []).some(
        (l) =>
          l.proyectoId === c.projectId ||
          // Cargos generados antes de guardar el proyecto en cada línea.
          (l.proyectoId == null &&
            (l.referencia ?? '').includes(`:${c.projectId}:`)),
      ),
    );
    if (!cargos.length) return null;
    const conImputacion = await this.imputaciones.find({
      where: { cargoId: In(cargos.map((m) => m.id)) },
      select: { cargoId: true },
    });
    const ids = new Set(conImputacion.map((i) => i.cargoId));
    const meses = cargos
      .filter((m) => ids.has(m.id))
      .map((m) => m.month as string)
      .sort();
    return meses.at(-1) ?? null;
  }
}
