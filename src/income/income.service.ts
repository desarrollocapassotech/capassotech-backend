import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import { IncomeEntity, IncomeProjectEntity } from '../database/entities';
import { CreateIncomeDto, UpdateIncomeDto } from './income.dto';

// IncomeEntity no tiene project_id directo: un ingreso puede tener 0..N
// proyectos asociados, resueltos vía tracker.income_projects y adjuntados acá
// (mismo patrón que ExpensesService/ExpenseResponse).
export interface IncomeResponse extends IncomeEntity {
  projectIds: string[];
}

@Injectable()
export class IncomeService {
  constructor(
    @InjectRepository(IncomeEntity)
    private readonly incomeRepository: Repository<IncomeEntity>,
    @InjectRepository(IncomeProjectEntity)
    private readonly incomeProjectRepository: Repository<IncomeProjectEntity>,
  ) {}

  async findAll(): Promise<IncomeResponse[]> {
    const [incomes, links] = await Promise.all([
      this.incomeRepository.find({ order: { paymentDate: 'DESC', createdAt: 'DESC' } }),
      this.incomeProjectRepository.find(),
    ]);
    return this.attachProjectIds(incomes, links);
  }

  async findOne(id: string): Promise<IncomeResponse> {
    const income = await this.findEntity(id);
    const links = await this.incomeProjectRepository.find({ where: { incomeId: id } });
    return { ...income, projectIds: links.map((link) => link.projectId) };
  }

  async create(dto: CreateIncomeDto, actorEmail: string): Promise<IncomeResponse> {
    this.validate(dto);

    return this.incomeRepository.manager.transaction(async (manager) => {
      const income = manager.getRepository(IncomeEntity).create({
        id: randomUUID(),
        description: dto.description.trim(),
        amount: String(dto.amount),
        currency: dto.currency ?? undefined,
        paymentMethod: dto.paymentMethod.trim(),
        paymentDate: dto.paymentDate,
        notes: dto.notes ?? null,
        createdBy: actorEmail,
      });

      const saved = await manager.getRepository(IncomeEntity).save(income);
      const projectIds = await this.replaceIncomeProjects(manager, saved.id, dto.projectIds ?? []);
      return { ...saved, projectIds };
    });
  }

  async update(id: string, dto: UpdateIncomeDto): Promise<IncomeResponse> {
    return this.incomeRepository.manager.transaction(async (manager) => {
      const existing = await manager.getRepository(IncomeEntity).findOneBy({ id });
      if (!existing) {
        throw new NotFoundException('Ingreso no encontrado.');
      }

      if (dto.description !== undefined) {
        if (!dto.description?.trim()) {
          throw new BadRequestException('Falta la descripción del ingreso.');
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
      if (dto.paymentMethod !== undefined) {
        if (!dto.paymentMethod?.trim()) {
          throw new BadRequestException('Falta el medio de cobro.');
        }
        existing.paymentMethod = dto.paymentMethod.trim();
      }
      if (dto.paymentDate !== undefined) {
        if (!dto.paymentDate) {
          throw new BadRequestException('Falta la fecha de cobro.');
        }
        existing.paymentDate = dto.paymentDate;
      }
      if (dto.notes !== undefined) existing.notes = dto.notes;

      const saved = await manager.getRepository(IncomeEntity).save(existing);

      let projectIds: string[];
      if (dto.projectIds !== undefined) {
        projectIds = await this.replaceIncomeProjects(manager, id, dto.projectIds);
      } else {
        const links = await manager.getRepository(IncomeProjectEntity).find({ where: { incomeId: id } });
        projectIds = links.map((link) => link.projectId);
      }

      return { ...saved, projectIds };
    });
  }

  async remove(id: string): Promise<void> {
    const result = await this.incomeRepository.delete({ id });
    if (result.affected === 0) {
      throw new NotFoundException('Ingreso no encontrado.');
    }
  }

  private validate(dto: CreateIncomeDto): void {
    if (!dto.description?.trim()) {
      throw new BadRequestException('Falta la descripción del ingreso.');
    }
    if (dto.amount == null || Number.isNaN(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('El monto debe ser un número mayor a 0.');
    }
    if (!dto.paymentMethod?.trim()) {
      throw new BadRequestException('Falta el medio de cobro.');
    }
    if (!dto.paymentDate) {
      throw new BadRequestException('Falta la fecha de cobro.');
    }
  }

  private async findEntity(id: string): Promise<IncomeEntity> {
    const income = await this.incomeRepository.findOneBy({ id });
    if (!income) {
      throw new NotFoundException('Ingreso no encontrado.');
    }
    return income;
  }

  private attachProjectIds(incomes: IncomeEntity[], links: IncomeProjectEntity[]): IncomeResponse[] {
    const projectIdsByIncome = new Map<string, string[]>();
    for (const link of links) {
      const list = projectIdsByIncome.get(link.incomeId) ?? [];
      list.push(link.projectId);
      projectIdsByIncome.set(link.incomeId, list);
    }
    return incomes.map((income) => ({ ...income, projectIds: projectIdsByIncome.get(income.id) ?? [] }));
  }

  // Reemplaza de una todos los proyectos asociados a un ingreso (mismo patrón
  // que ExpensesService.replaceExpenseProjects: el form manda la lista completa).
  private async replaceIncomeProjects(manager: EntityManager, incomeId: string, projectIds: string[]): Promise<string[]> {
    const repo = manager.getRepository(IncomeProjectEntity);
    await repo.delete({ incomeId });
    const uniqueIds = [...new Set(projectIds)];
    if (uniqueIds.length === 0) return [];

    try {
      const rows = uniqueIds.map((projectId) => repo.create({ incomeId, projectId }));
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
}
