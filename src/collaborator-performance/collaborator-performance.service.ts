import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import {
  BillingCurrency,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  ProjectBillingTermEntity,
  ProjectEntity,
  TimeEntryEntity,
} from '../database/entities';
import { clienteDeHora, condicionDeEntidad, condicionDelMes, vigente } from '../projects/condiciones';
import { CollaboratorPerformanceResponseDto, OutlierTaskDto, QuarterMetricDto } from './collaborator-performance.dto';

const QUARTER_WINDOW = 4;
// Menos de esto en un grupo (taskBillingType + proyecto), la mediana no es confiable.
const MIN_GROUP_SAMPLE = 10;
// Tolerancia antes de marcar desvío contra el estimado real de Jira (30%: se
// marca si las horas reales superan 1.3x el estimado). El fallback estadístico
// (mediana del grupo) usa su propio umbral, más laxo (2x), ver JIRA_ESTIMATE_THRESHOLD.
const JIRA_ESTIMATE_THRESHOLD = 1.3;
const GROUP_MEDIAN_THRESHOLD = 2;
// Tope de trimestres cuando el usuario elige un rango de fechas custom, para no
// devolver un gráfico enorme si alguien pide, por ejemplo, 10 años.
const MAX_QUARTERS_IN_CUSTOM_RANGE = 40;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface PerformanceFilters {
  clientId?: string;
  projectId?: string;
  from?: string;
  to?: string;
}

interface QuarterRef {
  year: number;
  quarter: number;
}

function quarterOf(dateStr: string): QuarterRef {
  const [year, month] = dateStr.split('-').map(Number);
  return { year, quarter: Math.floor((month - 1) / 3) + 1 };
}

function quarterLabel(ref: QuarterRef): string {
  return `${ref.year}-Q${ref.quarter}`;
}

// Últimos N trimestres calendario, incluyendo el actual, más viejo primero.
function lastNQuarters(n: number, today = new Date()): QuarterRef[] {
  let year = today.getUTCFullYear();
  let quarter = Math.floor(today.getUTCMonth() / 3) + 1;
  const refs: QuarterRef[] = [];
  for (let i = 0; i < n; i += 1) {
    refs.unshift({ year, quarter });
    quarter -= 1;
    if (quarter === 0) {
      quarter = 4;
      year -= 1;
    }
  }
  return refs;
}

function quarterStartDate(ref: QuarterRef): string {
  const month = (ref.quarter - 1) * 3;
  return new Date(Date.UTC(ref.year, month, 1)).toISOString().slice(0, 10);
}

// Todos los trimestres calendario entre `from` y `to` (inclusive), más viejo
// primero. Se usa cuando el usuario elige un rango de fechas propio en vez de
// la ventana fija de "últimos 4 trimestres".
function quartersInRange(from: string, to: string): QuarterRef[] {
  const start = quarterOf(from);
  const end = quarterOf(to);
  const refs: QuarterRef[] = [];
  let year = start.year;
  let quarter = start.quarter;
  while ((year < end.year || (year === end.year && quarter <= end.quarter)) && refs.length < MAX_QUARTERS_IN_CUSTOM_RANGE) {
    refs.push({ year, quarter });
    quarter += 1;
    if (quarter === 5) {
      quarter = 1;
      year += 1;
    }
  }
  return refs;
}

interface OutlierRow {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string | null;
  lastDate: string;
  totalHours: string;
  storyPoints: string | null;
  medianHours: string | null;
  sampleSize: string | null;
}

@Injectable()
export class CollaboratorPerformanceService {
  constructor(
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    @InjectRepository(TimeEntryEntity)
    private readonly timeEntryRepository: Repository<TimeEntryEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(CollaboratorProjectRateEntity)
    private readonly projectRateRepository: Repository<CollaboratorProjectRateEntity>,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  async getPerformance(collaboratorId: string, filters: PerformanceFilters = {}): Promise<CollaboratorPerformanceResponseDto> {
    const collaborator = await this.collaboratorRepository.findOneBy({ id: collaboratorId });
    if (!collaborator) {
      throw new NotFoundException('Colaborador no encontrado.');
    }

    const hasCustomRange = Boolean(filters.from || filters.to);
    let windowStart: string;
    let windowEnd: string;
    let quarterRefs: QuarterRef[];

    if (hasCustomRange) {
      if (!filters.from || !filters.to || !DATE_PATTERN.test(filters.from) || !DATE_PATTERN.test(filters.to)) {
        throw new BadRequestException('Para filtrar por fecha hace falta un rango completo (from y to, formato yyyy-MM-dd).');
      }
      if (filters.from > filters.to) {
        throw new BadRequestException('La fecha "from" no puede ser posterior a "to".');
      }
      windowStart = filters.from;
      windowEnd = filters.to;
      quarterRefs = quartersInRange(windowStart, windowEnd);
    } else {
      quarterRefs = lastNQuarters(QUARTER_WINDOW);
      windowStart = quarterStartDate(quarterRefs[0]);
      windowEnd = new Date().toISOString().slice(0, 10);
    }

    const allowedProjectIds = await this.resolveAllowedProjectIds(filters);

    const [quarters, outlierTasks] = await Promise.all([
      this.computeQuarterlyMetrics(collaborator, quarterRefs, windowStart, windowEnd, allowedProjectIds),
      this.computeOutlierTasks(collaboratorId, windowStart, windowEnd, allowedProjectIds),
    ]);

    const outlierCountByQuarter = new Map<string, number>();
    for (const task of outlierTasks) {
      outlierCountByQuarter.set(task.quarterLabel, (outlierCountByQuarter.get(task.quarterLabel) ?? 0) + 1);
    }
    for (const q of quarters) {
      q.outlierTaskCount = outlierCountByQuarter.get(q.label) ?? 0;
    }

    return {
      collaboratorId,
      collaboratorName: collaborator.name,
      currency: 'USD',
      quarters,
      outlierTasks,
    };
  }

  // projectId tiene prioridad sobre clientId (si mandan los dos, se filtra a
  // ese único proyecto). null = sin filtro de proyecto/cliente.
  private async resolveAllowedProjectIds(filters: PerformanceFilters): Promise<Set<string> | null> {
    if (filters.projectId) {
      return new Set([filters.projectId]);
    }
    if (filters.clientId) {
      const clientProjects = await this.projectRepository.findBy({ clientId: filters.clientId });
      return new Set(clientProjects.map((p) => p.id));
    }
    return null;
  }

  private async computeQuarterlyMetrics(
    collaborator: CollaboratorEntity,
    quarterRefs: QuarterRef[],
    windowStart: string,
    windowEnd: string,
    allowedProjectIds: Set<string> | null,
  ): Promise<QuarterMetricDto[]> {
    const allEntries = await this.timeEntryRepository.find({
      where: { collaboratorId: collaborator.id, date: Between(windowStart, windowEnd) },
    });
    const entries = allowedProjectIds ? allEntries.filter((e) => allowedProjectIds.has(e.projectId)) : allEntries;

    const buckets = new Map<string, QuarterMetricDto>();
    for (const ref of quarterRefs) {
      buckets.set(quarterLabel(ref), {
        year: ref.year,
        quarter: ref.quarter,
        label: quarterLabel(ref),
        hours: 0,
        revenueUsd: 0,
        costUsd: 0,
        marginUsd: 0,
        revenueArs: 0,
        costArs: 0,
        marginArs: 0,
        outlierTaskCount: 0,
      });
    }

    if (entries.length === 0) {
      return [...buckets.values()];
    }

    const projectIds = [...new Set(entries.map((e) => e.projectId))];
    const [projects, rateOverrides, condiciones] = await Promise.all([
      this.projectRepository.findBy({ id: In(projectIds) }),
      this.projectRateRepository.findBy({ collaboratorId: collaborator.id, projectId: In(projectIds) }),
      this.projectRepository.manager
        .getRepository(ProjectBillingTermEntity)
        .findBy({ projectId: In(projectIds) })
        .then((xs) => xs.map(condicionDeEntidad)),
    ]);
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const overrideByProject = new Map(rateOverrides.map((r) => [r.projectId, Number(r.hourlyRate)]));

    // Las suscripciones se reparten entre todas las horas del proyecto en el mes.
    const monthlyProjectIds = [...new Set(condiciones.filter((c) => c.monthlyAmount != null).map((c) => c.projectId))];
    const monthlyTotalsByKey = await this.loadMonthlyProjectTotals(monthlyProjectIds, windowStart, windowEnd);

    const usdRateCache = new Map<string, number>();
    const rateForMonth = async (month: string): Promise<number> => {
      if (!usdRateCache.has(month)) {
        const { rate } = await this.exchangeRateService.getUsdRate(month);
        usdRateCache.set(month, rate);
      }
      return usdRateCache.get(month)!;
    };
    const toUsd = async (amount: number, currency: BillingCurrency | null, month: string): Promise<number> => {
      if (currency !== BillingCurrency.ARS) return amount;
      return amount / (await rateForMonth(month));
    };
    // Mes a mes, no el total del trimestre por un solo TC: cada mes puede tener el suyo.
    const toArs = async (amount: number, currency: BillingCurrency | null, month: string): Promise<number> => {
      if (currency === BillingCurrency.ARS) return amount;
      return amount * (await rateForMonth(month));
    };

    for (const entry of entries) {
      const project = projectById.get(entry.projectId);
      if (!project) continue;

      const hours = Number(entry.hours);
      const month = entry.date.slice(0, 7);
      const bucket = buckets.get(quarterLabel(quarterOf(entry.date)));
      if (!bucket) continue;

      const collaboratorRate = overrideByProject.get(entry.projectId) ?? Number(collaborator.hourlyRate);
      const costUsd = await toUsd(hours * collaboratorRate, collaborator.currency, month);
      const costArs = await toArs(hours * collaboratorRate, collaborator.currency, month);

      // Ingreso de la hora según las condiciones de cobro del mes: su parte de las suscripciones
      // del proyecto (de todos los clientes) y, si se cobra por hora, la tarifa del cliente de la hora.
      let revenueUsd = 0;
      let revenueArs = 0;
      const sumar = async (monto: number, moneda: 'USD' | 'ARS') => {
        const currency = moneda === 'ARS' ? BillingCurrency.ARS : BillingCurrency.USD;
        revenueUsd += await toUsd(monto, currency, month);
        revenueArs += await toArs(monto, currency, month);
      };
      const totalHoursForMonth = monthlyTotalsByKey.get(`${project.id}:${month}`) ?? hours;
      const share = totalHoursForMonth > 0 ? hours / totalHoursForMonth : 0;
      if (project.active) {
        for (const c of condiciones) {
          if (c.projectId === project.id && c.monthlyAmount != null && vigente(c, month)) {
            await sumar(share * c.monthlyAmount, c.currency);
          }
        }
      }
      const condicion = condicionDelMes(
        condiciones,
        project.id,
        clienteDeHora(project.clientId, entry.clientId),
        month,
      );
      if (condicion?.hourlyRate != null) {
        await sumar(hours * condicion.hourlyRate, condicion.currency);
      }

      bucket.hours += hours;
      bucket.costUsd += costUsd;
      bucket.revenueUsd += revenueUsd;
      bucket.costArs += costArs;
      bucket.revenueArs += revenueArs;
    }

    for (const bucket of buckets.values()) {
      bucket.marginUsd = bucket.revenueUsd - bucket.costUsd;
      bucket.marginArs = bucket.revenueArs - bucket.costArs;
      bucket.hours = Math.round(bucket.hours * 100) / 100;
      bucket.costUsd = Math.round(bucket.costUsd * 100) / 100;
      bucket.revenueUsd = Math.round(bucket.revenueUsd * 100) / 100;
      bucket.marginUsd = Math.round(bucket.marginUsd * 100) / 100;
      bucket.costArs = Math.round(bucket.costArs * 100) / 100;
      bucket.revenueArs = Math.round(bucket.revenueArs * 100) / 100;
      bucket.marginArs = Math.round(bucket.marginArs * 100) / 100;
    }

    return [...buckets.values()];
  }

  // Horas totales cargadas por TODOS los colaboradores, por (proyecto, mes), para
  // proyectos de facturación monthly: hace falta para prorratear el rate fijo del
  // mes según la dedicación relativa de cada colaborador.
  private async loadMonthlyProjectTotals(projectIds: string[], windowStart: string, windowEnd: string): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();

    const rows = await this.timeEntryRepository
      .createQueryBuilder('te')
      .select('te.project_id', 'projectId')
      .addSelect(`to_char(te.date, 'YYYY-MM')`, 'month')
      .addSelect('SUM(te.hours)', 'totalHours')
      .where('te.project_id IN (:...ids)', { ids: projectIds })
      .andWhere('te.date BETWEEN :windowStart AND :windowEnd', { windowStart, windowEnd })
      .groupBy('te.project_id')
      .addGroupBy(`to_char(te.date, 'YYYY-MM')`)
      .getRawMany<{ projectId: string; month: string; totalHours: string }>();

    return new Map(rows.map((r) => [`${r.projectId}:${r.month}`, Number(r.totalHours)]));
  }

  // Primera vez que el backend calcula una mediana/percentil: se resuelve con SQL
  // crudo (percentile_cont no tiene equivalente directo en el query builder de
  // TypeORM). La mediana de cada grupo (taskBillingType + proyecto) se calcula
  // sobre TODO el histórico (no solo la ventana de trimestres) para que sea
  // estable; el resultado se filtra después a las tareas de este colaborador
  // dentro de la ventana.
  private async computeOutlierTasks(
    collaboratorId: string,
    windowStart: string,
    windowEnd: string,
    allowedProjectIds: Set<string> | null,
  ): Promise<OutlierTaskDto[]> {
    const sql = `
      WITH task_totals AS (
        SELECT
          task_id AS "taskId",
          project_id AS "projectId",
          task_billing_type AS "taskBillingType",
          SUM(hours) AS "totalHours",
          COUNT(DISTINCT collaborator_id) AS "collaboratorCount",
          MAX(story_points) AS "storyPoints",
          MAX(task_title) AS "taskTitle",
          MAX(date)::text AS "lastDate"
        FROM tracker.time_entries
        GROUP BY task_id, project_id, task_billing_type
      ),
      single_owner AS (
        SELECT * FROM task_totals WHERE "collaboratorCount" = 1
      ),
      group_medians AS (
        SELECT
          "projectId",
          "taskBillingType",
          percentile_cont(0.5) WITHIN GROUP (ORDER BY "totalHours") AS "medianHours",
          COUNT(*) AS "sampleSize"
        FROM single_owner
        WHERE "storyPoints" IS NULL
        GROUP BY "projectId", "taskBillingType"
        HAVING COUNT(*) >= $4
      )
      SELECT
        so."taskId", so."taskTitle", so."projectId", p.name AS "projectName", so."lastDate",
        so."totalHours", so."storyPoints", gm."medianHours", gm."sampleSize"
      FROM single_owner so
      LEFT JOIN tracker.projects p ON p.id = so."projectId"
      LEFT JOIN group_medians gm ON gm."projectId" = so."projectId" AND gm."taskBillingType" = so."taskBillingType"
      WHERE so."lastDate" BETWEEN $2 AND $3
        AND EXISTS (
          SELECT 1 FROM tracker.time_entries te
          WHERE te.task_id = so."taskId" AND te.collaborator_id = $1
        )
    `;

    const allRows: OutlierRow[] = await this.timeEntryRepository.manager.query(sql, [collaboratorId, windowStart, windowEnd, MIN_GROUP_SAMPLE]);
    const rows = allowedProjectIds ? allRows.filter((r) => allowedProjectIds.has(r.projectId)) : allRows;

    const candidates = rows
      .map((row) => {
        const totalHours = Number(row.totalHours);
        const storyPoints = row.storyPoints != null ? Number(row.storyPoints) : null;
        const medianHours = row.medianHours != null ? Number(row.medianHours) : null;

        let method: 'jira_estimate' | 'group_median' | null = null;
        let baselineHours: number | null = null;
        if (storyPoints != null) {
          method = 'jira_estimate';
          baselineHours = storyPoints;
        } else if (medianHours != null) {
          method = 'group_median';
          baselineHours = medianHours;
        }

        const threshold = method === 'jira_estimate' ? JIRA_ESTIMATE_THRESHOLD : GROUP_MEDIAN_THRESHOLD;
        const isOutlier = method !== null && baselineHours! > 0 && totalHours > threshold * baselineHours!;

        return { row, totalHours, method, baselineHours, isOutlier };
      })
      .filter((c) => c.isOutlier);

    if (candidates.length === 0) return [];

    const taskIds = candidates.map((c) => c.row.taskId);
    const commentRows = await this.timeEntryRepository.find({
      where: { taskId: In(taskIds), collaboratorId },
    });
    const commentsByTask = new Map<string, string[]>();
    for (const entry of commentRows) {
      if (!entry.comments) continue;
      const list = commentsByTask.get(entry.taskId) ?? [];
      list.push(entry.comments);
      commentsByTask.set(entry.taskId, list);
    }

    return candidates
      .map(({ row, totalHours, method, baselineHours }) => ({
        taskId: row.taskId,
        taskTitle: row.taskTitle,
        projectId: row.projectId,
        projectName: row.projectName,
        quarterLabel: quarterLabel(quarterOf(row.lastDate)),
        lastDate: row.lastDate,
        totalHours,
        method: method!,
        baselineHours: baselineHours!,
        deviationRatio: Math.round((totalHours / baselineHours!) * 100) / 100,
        justificationComment: commentsByTask.get(row.taskId)?.join(' / ') ?? null,
      }))
      .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0));
  }
}
