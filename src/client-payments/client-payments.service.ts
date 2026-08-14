import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientPaymentEntity } from '../database/entities';
import { ClientPaymentResponse, UpsertClientPaymentDto } from './client-payments.dto';

function toResponse(entity: ClientPaymentEntity): ClientPaymentResponse {
  return {
    clientId: entity.clientId,
    year: entity.year,
    month: entity.month,
    hoursPaid: Number(entity.hoursPaid),
    note: entity.note,
    updatedBy: entity.updatedBy,
    updatedAt: entity.updatedAt,
  };
}

@Injectable()
export class ClientPaymentsService {
  constructor(
    @InjectRepository(ClientPaymentEntity)
    private readonly clientPaymentRepository: Repository<ClientPaymentEntity>,
  ) {}

  async findByClient(clientId: string): Promise<ClientPaymentResponse[]> {
    const rows = await this.clientPaymentRepository.find({
      where: { clientId },
      order: { year: 'DESC', month: 'DESC' },
    });
    return rows.map(toResponse);
  }

  async upsert(
    clientId: string,
    dto: UpsertClientPaymentDto,
    updatedBy: string | null,
  ): Promise<ClientPaymentResponse> {
    if (!Number.isInteger(dto.year) || dto.year < 2000) {
      throw new BadRequestException('Año inválido.');
    }
    if (!Number.isInteger(dto.month) || dto.month < 1 || dto.month > 12) {
      throw new BadRequestException('Mes inválido: debe estar entre 1 y 12.');
    }
    if (!Number.isFinite(dto.hoursPaid) || dto.hoursPaid < 0) {
      throw new BadRequestException('Las horas pagadas deben ser un número mayor o igual a 0.');
    }

    await this.clientPaymentRepository.upsert(
      {
        clientId,
        year: dto.year,
        month: dto.month,
        hoursPaid: dto.hoursPaid.toFixed(2),
        note: dto.note?.trim() || null,
        updatedBy,
      },
      ['clientId', 'year', 'month'],
    );

    const saved = await this.clientPaymentRepository.findOneByOrFail({
      clientId,
      year: dto.year,
      month: dto.month,
    });
    return toResponse(saved);
  }
}
