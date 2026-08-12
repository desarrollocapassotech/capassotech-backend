import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, In, Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { CollaboratorEntity, ExpenseEntity, ExpensePeriodicity, ExpenseProjectEntity, ProjectEntity, UserRole } from '../database/entities';
import { CreateExpenseDto, CreateExpenseInstallmentsDto, UpdateExpenseDto } from './expenses.dto';
import { buildExpenseNotificationHtml } from './expense-notification.template';
import { addMonthsToDateString, splitAmountIntoInstallments } from './installment.util';

function formatPeriodicity(periodicity: ExpensePeriodicity): string {
  if (periodicity === ExpensePeriodicity.MENSUAL) return 'Mensual';
  if (periodicity === ExpensePeriodicity.ANUAL) return 'Anual';
  return 'Único';
}

// ExpenseEntity ya no tiene project_id (ver AddExpenseProjects): un gasto puede
// tener 0..N proyectos asociados, resueltos vía tracker.expense_projects y
// adjuntados acá para no filtrar el detalle de esa tabla puente al resto de la app.
export interface ExpenseResponse extends ExpenseEntity {
  projectIds: string[];
}

@Injectable()
export class ExpensesService {
  private readonly logger = new Logger(ExpensesService.name);

  constructor(
    @InjectRepository(ExpenseEntity)
    private readonly expenseRepository: Repository<ExpenseEntity>,
    @InjectRepository(ExpenseProjectEntity)
    private readonly expenseProjectRepository: Repository<ExpenseProjectEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    private readonly resendService: ResendService,
  ) {}

  async findAll(): Promise<ExpenseResponse[]> {
    const [expenses, links] = await Promise.all([
      this.expenseRepository.find({ order: { expenseDate: 'DESC', createdAt: 'DESC' } }),
      this.expenseProjectRepository.find(),
    ]);
    return this.attachProjectIds(expenses, links);
  }

  async findOne(id: string): Promise<ExpenseResponse> {
    const expense = await this.findEntity(id);
    const links = await this.expenseProjectRepository.find({ where: { expenseId: id } });
    return { ...expense, projectIds: links.map((link) => link.projectId) };
  }

  async create(dto: CreateExpenseDto, actorEmail: string): Promise<ExpenseResponse> {
    if (!dto.description?.trim()) {
      throw new BadRequestException('Falta la descripción del gasto.');
    }
    if (dto.amount == null || Number.isNaN(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('El monto debe ser un número mayor a 0.');
    }

    const response = await this.expenseRepository.manager.transaction(async (manager) => {
      const expense = manager.getRepository(ExpenseEntity).create({
        id: randomUUID(),
        description: dto.description.trim(),
        amount: String(dto.amount),
        currency: dto.currency ?? undefined,
        periodicity: dto.periodicity ?? undefined,
        paymentMethod: dto.paymentMethod ?? null,
        alternativePaymentMethod: dto.alternativePaymentMethod ?? null,
        paymentAccess: dto.paymentAccess ?? null,
        category: dto.category ?? null,
        expenseDate: dto.expenseDate ?? null,
        notes: dto.notes ?? null,
        createdBy: actorEmail,
      });

      const saved = await manager.getRepository(ExpenseEntity).save(expense);
      const projectIds = await this.replaceExpenseProjects(manager, saved.id, dto.projectIds ?? []);
      return { ...saved, projectIds };
    });

    void this.notifyExpenseWatchers(response, 'creado', actorEmail);
    return response;
  }

  // Un gasto único pagado en cuotas: crea N filas (una por cuota) en una sola
  // transacción y manda UNA sola notificación con el detalle de todas, en vez de
  // una por fila (evita spamear N emails por una sola alta).
  async createInstallments(dto: CreateExpenseInstallmentsDto, actorEmail: string): Promise<ExpenseResponse[]> {
    if (!dto.description?.trim()) {
      throw new BadRequestException('Falta la descripción del gasto.');
    }
    if (dto.totalAmount == null || Number.isNaN(dto.totalAmount) || dto.totalAmount <= 0) {
      throw new BadRequestException('El monto total debe ser un número mayor a 0.');
    }
    if (!Number.isInteger(dto.installmentsCount) || dto.installmentsCount < 2) {
      throw new BadRequestException('La cantidad de cuotas debe ser un número entero mayor o igual a 2.');
    }
    if (!dto.firstInstallmentDate) {
      throw new BadRequestException('Falta la fecha de la primera cuota.');
    }

    const amounts = splitAmountIntoInstallments(dto.totalAmount, dto.installmentsCount);
    const projectIds = [...new Set(dto.projectIds ?? [])];

    const responses = await this.expenseRepository.manager.transaction(async (manager) => {
      const rows = amounts.map((amount, index) =>
        manager.getRepository(ExpenseEntity).create({
          id: randomUUID(),
          description: `${dto.description.trim()} (Cuota ${index + 1}/${dto.installmentsCount})`,
          amount: String(amount),
          currency: dto.currency ?? undefined,
          periodicity: ExpensePeriodicity.UNICO,
          paymentMethod: dto.paymentMethod ?? null,
          alternativePaymentMethod: dto.alternativePaymentMethod ?? null,
          paymentAccess: dto.paymentAccess ?? null,
          category: dto.category ?? null,
          expenseDate: addMonthsToDateString(dto.firstInstallmentDate, index),
          notes: dto.notes ?? null,
          createdBy: actorEmail,
        }),
      );

      const saved = await manager.getRepository(ExpenseEntity).save(rows);

      if (projectIds.length > 0) {
        try {
          const links = saved.flatMap((row) =>
            projectIds.map((projectId) => manager.getRepository(ExpenseProjectEntity).create({ expenseId: row.id, projectId })),
          );
          await manager.getRepository(ExpenseProjectEntity).save(links);
        } catch (error) {
          if (this.isForeignKeyViolation(error)) {
            throw new BadRequestException('No se pudieron crear las cuotas: uno de los proyectos asignados no existe.');
          }
          throw error;
        }
      }

      return saved.map((row): ExpenseResponse => ({ ...row, projectIds }));
    });

    void this.notifyInstallmentsCreated(dto, responses, actorEmail);
    return responses;
  }

  async update(id: string, dto: UpdateExpenseDto, actorEmail: string): Promise<ExpenseResponse> {
    const response = await this.expenseRepository.manager.transaction(async (manager) => {
      const existing = await manager.getRepository(ExpenseEntity).findOneBy({ id });
      if (!existing) {
        throw new NotFoundException('Gasto no encontrado.');
      }

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
      if (dto.paymentMethod !== undefined) existing.paymentMethod = dto.paymentMethod;
      if (dto.alternativePaymentMethod !== undefined) existing.alternativePaymentMethod = dto.alternativePaymentMethod;
      if (dto.paymentAccess !== undefined) existing.paymentAccess = dto.paymentAccess;
      if (dto.category !== undefined) existing.category = dto.category;
      if (dto.expenseDate !== undefined) existing.expenseDate = dto.expenseDate;
      if (dto.notes !== undefined) existing.notes = dto.notes;

      const saved = await manager.getRepository(ExpenseEntity).save(existing);

      let projectIds: string[];
      if (dto.projectIds !== undefined) {
        projectIds = await this.replaceExpenseProjects(manager, id, dto.projectIds);
      } else {
        const links = await manager.getRepository(ExpenseProjectEntity).find({ where: { expenseId: id } });
        projectIds = links.map((link) => link.projectId);
      }

      return { ...saved, projectIds };
    });

    void this.notifyExpenseWatchers(response, 'actualizado', actorEmail);
    return response;
  }

  async remove(id: string): Promise<void> {
    const result = await this.expenseRepository.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException('Gasto no encontrado.');
    }
  }

  private async findEntity(id: string): Promise<ExpenseEntity> {
    const expense = await this.expenseRepository.findOneBy({ id });
    if (!expense) {
      throw new NotFoundException('Gasto no encontrado.');
    }
    return expense;
  }

  private attachProjectIds(expenses: ExpenseEntity[], links: ExpenseProjectEntity[]): ExpenseResponse[] {
    const projectIdsByExpense = new Map<string, string[]>();
    for (const link of links) {
      const list = projectIdsByExpense.get(link.expenseId) ?? [];
      list.push(link.projectId);
      projectIdsByExpense.set(link.expenseId, list);
    }
    return expenses.map((expense) => ({ ...expense, projectIds: projectIdsByExpense.get(expense.id) ?? [] }));
  }

  // Reemplaza de una todos los proyectos asociados a un gasto (mismo patrón que
  // ProjectsService.replaceRoleAssignments: el form manda la lista completa).
  private async replaceExpenseProjects(manager: EntityManager, expenseId: string, projectIds: string[]): Promise<string[]> {
    const repo = manager.getRepository(ExpenseProjectEntity);
    await repo.delete({ expenseId });
    const uniqueIds = [...new Set(projectIds)];
    if (uniqueIds.length === 0) return [];

    try {
      const rows = uniqueIds.map((projectId) => repo.create({ expenseId, projectId }));
      await repo.save(rows);
      return uniqueIds;
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new BadRequestException('Uno de los proyectos asignados no existe.');
      }
      throw error;
    }
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503';
  }

  // roles es un array de Postgres: se filtra en memoria (mismo criterio que ya usa
  // el frontend para listas cortas como esta) en vez de armar un WHERE con el
  // operador @> a mano. Mismos roles que pueden ver/gestionar Gastos (ver @Roles
  // en ExpensesController): admin + contable, no solo admin.
  private async resolveWatcherEmails(): Promise<string[]> {
    const collaborators = await this.collaboratorRepository.find();
    const watchers = collaborators.filter(
      (collaborator) => collaborator.roles.includes(UserRole.ADMIN) || collaborator.roles.includes(UserRole.CONTABLE),
    );
    return [...new Set(watchers.map((watcher) => watcher.workEmail ?? watcher.personalEmail).filter((email): email is string => !!email))];
  }

  private async resolveProjectNames(projectIds: string[]): Promise<string[]> {
    if (projectIds.length === 0) return [];
    const projects = await this.projectRepository.find({ where: { id: In(projectIds) } });
    return projects.map((project) => project.name);
  }

  // Best-effort: si Resend falla o no está configurado, el gasto ya se guardó y la
  // request no debe fallar por eso (ver ResendService, no lanza sin API key).
  private async notifyExpenseWatchers(expense: ExpenseResponse, action: 'creado' | 'actualizado', actorEmail: string): Promise<void> {
    try {
      const recipients = await this.resolveWatcherEmails();
      if (recipients.length === 0) {
        this.logger.warn('No hay ningún admin/contable con email configurado; se omite la notificación de gasto.');
        return;
      }

      const projectNames = await this.resolveProjectNames(expense.projectIds);

      const subject = `Gasto ${action}: ${expense.description}`;
      const rows: [string, string][] = [
        ['Concepto', expense.description],
        ['Monto', `${Number(expense.amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${expense.currency}`],
        ['Periodicidad', formatPeriodicity(expense.periodicity)],
        ['Proyectos', projectNames.length > 0 ? projectNames.join(', ') : 'Sin proyecto asociado'],
        ['Medio de pago', expense.paymentMethod ?? '-'],
        ['Forma de pago alternativa', expense.alternativePaymentMethod ?? '-'],
        ['Acceso al pago', expense.paymentAccess ?? '-'],
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

  private async notifyInstallmentsCreated(
    dto: CreateExpenseInstallmentsDto,
    installments: ExpenseResponse[],
    actorEmail: string,
  ): Promise<void> {
    try {
      const recipients = await this.resolveWatcherEmails();
      if (recipients.length === 0) {
        this.logger.warn('No hay ningún admin/contable con email configurado; se omite la notificación de gasto.');
        return;
      }

      const projectNames = await this.resolveProjectNames(installments[0]?.projectIds ?? []);

      const subject = `Gasto creado en cuotas: ${dto.description} (${dto.installmentsCount} cuotas)`;
      const rows: [string, string][] = [
        ['Concepto', dto.description],
        ['Monto total', `${dto.totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${installments[0]?.currency ?? ''}`],
        ['Proyectos', projectNames.length > 0 ? projectNames.join(', ') : 'Sin proyecto asociado'],
        ['Medio de pago', dto.paymentMethod ?? '-'],
        ['Forma de pago alternativa', dto.alternativePaymentMethod ?? '-'],
        ['Acceso al pago', dto.paymentAccess ?? '-'],
        ['Categoría', dto.category ?? '-'],
        ['Notas', dto.notes ?? '-'],
        ...installments.map((installment, index): [string, string] => [
          `Cuota ${index + 1}/${dto.installmentsCount}`,
          `${Number(installment.amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${installment.currency} — ${installment.expenseDate}`,
        ]),
        ['Realizado por', actorEmail],
      ];
      const html = buildExpenseNotificationHtml('creado', rows);

      await this.resendService.send({ to: recipients, subject, html });
    } catch (error) {
      this.logger.error(`No se pudieron notificar las cuotas de "${dto.description}" por email: ${(error as Error).message}`);
    }
  }
}
