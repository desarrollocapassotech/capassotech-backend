import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ExpenseEntity } from '../database/entities';
import { CreateExpenseDto, UpdateExpenseDto } from './expenses.dto';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(ExpenseEntity)
    private readonly expenseRepository: Repository<ExpenseEntity>,
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

  async create(dto: CreateExpenseDto, createdBy: string): Promise<ExpenseEntity> {
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
      createdBy,
    });

    return this.trySave(expense, 'crear');
  }

  async update(id: string, dto: UpdateExpenseDto): Promise<ExpenseEntity> {
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

    return this.trySave(existing, 'actualizar');
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
}
