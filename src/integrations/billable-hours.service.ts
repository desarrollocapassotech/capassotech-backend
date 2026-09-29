import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  ClientEntity,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  ProjectEntity,
  TimeEntryEntity,
} from '../database/entities';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import {
  BillableCollaborator,
  billableHoursForEntry,
} from './billable-hours.util';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DIAS = 370;

export interface BillableHoursEntry {
  id: string;
  date: string;
  hours: string;
  billableHours: string;
  billableDetail: {
    appliedFactor: string;
    markupMultiplier: string;
    additionalFixedHours: string;
    minimumBillableHours: string | null;
    usdRate: string;
  };
  taskBillingType: string;
  taskId: string;
  taskTitle: string;
  collaborator: { id: string; name: string };
  project: { id: string; name: string; billingType: string | null };
  client: {
    id: string;
    name: string;
    razonSocial: string | null;
    cuit: string | null;
    ivaCondition: string | null;
    billingCurrency: string;
  } | null;
}

export interface BillableHoursResponse {
  from: string;
  to: string;
  generatedAt: string;
  entries: BillableHoursEntry[];
}

function fechaValida(v: string | undefined, campo: string): string {
  if (!v || !FECHA.test(v) || Number.isNaN(Date.parse(`${v}T00:00:00Z`))) {
    throw new BadRequestException(`${campo} debe tener formato YYYY-MM-DD.`);
  }
  return v;
}

/** Mes en curso en Argentina ("yyyy-MM"), igual que lo ve el frontend del tracker. */
function mesActualArgentina(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  })
    .format(ahora)
    .slice(0, 7);
}

/** Número con hasta 4 decimales, sin ceros de más: 4.125 → "4.125", 3 → "3". */
function decimal(n: number, decimales = 4): string {
  if (!Number.isFinite(n)) return '0';
  return String(Number(n.toFixed(decimales)));
}

/**
 * Horas trabajadas y facturables por registro, para el Facturador (ARCHITECTURE.md
 * del Facturador, D2). Las facturables salen del mismo cálculo que usa el frontend
 * (billable-hours.util.ts, con test de paridad) y del mismo tipo de cambio: el
 * bloqueado del mes si lo hay, el vigente para el mes en curso.
 */
@Injectable()
export class BillableHoursService {
  constructor(
    @InjectRepository(TimeEntryEntity)
    private readonly entries: Repository<TimeEntryEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projects: Repository<ProjectEntity>,
    @InjectRepository(ClientEntity)
    private readonly clients: Repository<ClientEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly collaborators: Repository<CollaboratorEntity>,
    @InjectRepository(CollaboratorProjectRateEntity)
    private readonly projectRates: Repository<CollaboratorProjectRateEntity>,
    private readonly exchangeRate: ExchangeRateService,
  ) {}

  async listar(
    fromRaw?: string,
    toRaw?: string,
    clientId?: string,
  ): Promise<BillableHoursResponse> {
    const from = fechaValida(fromRaw, 'from');
    const to = fechaValida(toRaw, 'to');
    if (from > to)
      throw new BadRequestException('from no puede ser posterior a to.');
    const dias =
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000;
    if (dias > MAX_DIAS)
      throw new BadRequestException(
        `El rango no puede superar ${MAX_DIAS} días.`,
      );

    // El filtro por fecha y cliente va en la query (no en memoria).
    const qb = this.entries
      .createQueryBuilder('te')
      .innerJoin(ProjectEntity, 'p', 'p.id = te.project_id')
      .where('te.date BETWEEN :from AND :to', { from, to })
      .orderBy('te.date', 'ASC')
      .addOrderBy('te.id', 'ASC');
    if (clientId) qb.andWhere('p.client_id = :clientId', { clientId });
    const rows = await qb.getMany();

    const projectIds = [...new Set(rows.map((r) => r.projectId))];
    const projects = projectIds.length
      ? await this.projects.findBy({ id: In(projectIds) })
      : [];
    const clientIds = [
      ...new Set(
        projects
          .map((p) => p.clientId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const clients = clientIds.length
      ? await this.clients.findBy({ id: In(clientIds) })
      : [];

    // En time_entries.collaborator_id puede venir el id del colaborador o su uid de Firebase
    // (el frontend busca por cualquiera de los dos).
    const collaboratorKeys = [...new Set(rows.map((r) => r.collaboratorId))];
    const collaborators = collaboratorKeys.length
      ? await this.collaborators.find({
          where: [
            { id: In(collaboratorKeys) },
            { userId: In(collaboratorKeys) },
          ],
        })
      : [];
    const rates = collaborators.length
      ? await this.projectRates.findBy({
          collaboratorId: In(collaborators.map((c) => c.id)),
        })
      : [];

    const projectById = new Map(projects.map((p) => [p.id, p]));
    const clientById = new Map(clients.map((c) => [c.id, c]));
    const collaboratorByKey = new Map<
      string,
      BillableCollaborator & { name: string }
    >();
    for (const c of collaborators) {
      const mapped = {
        id: c.id,
        name: c.name,
        hourlyRate: Number(c.hourlyRate),
        currency: c.currency,
        exchangeRate:
          c.exchangeRate != null ? Number(c.exchangeRate) : undefined,
        projectRates: rates
          .filter((r) => r.collaboratorId === c.id)
          .map((r) => ({
            projectId: r.projectId,
            hourlyRate: Number(r.hourlyRate),
          })),
      };
      collaboratorByKey.set(c.id, mapped);
      if (c.userId) collaboratorByKey.set(c.userId, mapped);
    }

    const mesActual = mesActualArgentina();
    const usdRateByMonth = new Map<string, number>();
    for (const month of new Set(rows.map((r) => r.date.slice(0, 7)))) {
      // Mes en curso: TC vigente (aunque haya uno bloqueado), como el frontend.
      const { rate } = await this.exchangeRate.getUsdRate(
        month === mesActual ? undefined : month,
      );
      usdRateByMonth.set(month, rate);
    }

    const entries = rows.map((e): BillableHoursEntry => {
      const p = projectById.get(e.projectId);
      const project = p
        ? {
            id: p.id,
            rate: p.rate != null ? Number(p.rate) : undefined,
            currency: p.currency ?? undefined,
            billingType: p.billingType ?? undefined,
          }
        : undefined;
      const client = p?.clientId ? clientById.get(p.clientId) : undefined;
      const collaborator = collaboratorByKey.get(e.collaboratorId);
      const usdRate = usdRateByMonth.get(e.date.slice(0, 7)) ?? 1;
      const { billableHours, details } = billableHoursForEntry(
        Number(e.hours),
        project,
        collaborator,
        usdRate,
        client ?? null,
        e.taskBillingType,
      );

      return {
        id: e.id,
        date: e.date,
        hours: e.hours,
        // 6 decimales: el Facturador suma los registros y redondea el total a 2; con menos
        // precisión la suma podía diferir en 0,01 h de lo que muestra el tracker.
        billableHours: decimal(billableHours, 6),
        billableDetail: {
          appliedFactor: decimal(details.appliedFactor, 6),
          markupMultiplier: decimal(details.markupMultiplier, 6),
          additionalFixedHours: decimal(details.additionalFixedHours),
          minimumBillableHours:
            details.minimumBillableHours != null
              ? decimal(details.minimumBillableHours)
              : null,
          usdRate: decimal(usdRate),
        },
        taskBillingType: e.taskBillingType,
        taskId: e.taskId,
        taskTitle: e.taskTitle,
        collaborator: {
          id: collaborator?.id ?? e.collaboratorId,
          name: collaborator?.name ?? e.collaboratorName,
        },
        project: {
          id: e.projectId,
          name: p?.name ?? e.projectName,
          billingType: p?.billingType ?? null,
        },
        client: client
          ? {
              id: client.id,
              name: client.name,
              razonSocial: client.razonSocial,
              cuit: client.cuit,
              ivaCondition: client.ivaCondition,
              billingCurrency: client.billingCurrency,
            }
          : null,
      };
    });

    return { from, to, generatedAt: new Date().toISOString(), entries };
  }
}
