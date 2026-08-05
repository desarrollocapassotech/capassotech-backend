import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MonthlyExchangeRateEntity } from '../database/entities';

interface DolarApiResponse {
  compra?: number;
  venta?: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

function parseMonthKey(month: string): { year: number; month: number } | null {
  const match = MONTH_KEY_PATTERN.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNum = Number(match[2]);
  if (monthNum < 1 || monthNum > 12) return null;
  return { year, month: monthNum };
}

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);
  private cachedRate: number | null = null;
  private cachedAt = 0;

  constructor(
    @InjectRepository(MonthlyExchangeRateEntity)
    private readonly monthlyRateRepo: Repository<MonthlyExchangeRateEntity>,
  ) {}

  // `month` (yyyy-MM) es opcional: sin él, se mantiene el comportamiento de
  // siempre (TC en vivo). Con él, se prioriza el TC bloqueado a mano para ese
  // mes (ver setMonthlyRate) y solo se cae al TC en vivo si nadie lo fijó.
  async getUsdRate(month?: string): Promise<{ rate: number; locked: boolean }> {
    if (month) {
      const locked = await this.getLockedRate(month);
      if (locked !== null) {
        return { rate: locked, locked: true };
      }
    }
    const rate = await this.getLiveUsdRate();
    return { rate, locked: false };
  }

  async setMonthlyRate(
    month: string,
    rate: number,
    updatedBy: string | null,
  ): Promise<{ rate: number; locked: true }> {
    const parsed = parseMonthKey(month);
    if (!parsed) {
      throw new BadRequestException('Mes inválido: se espera el formato yyyy-MM.');
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException('El tipo de cambio debe ser un número mayor a 0.');
    }

    await this.monthlyRateRepo.upsert(
      {
        year: parsed.year,
        month: parsed.month,
        rate: rate.toFixed(4),
        updatedBy,
      },
      ['year', 'month'],
    );

    return { rate, locked: true };
  }

  private async getLockedRate(month: string): Promise<number | null> {
    const parsed = parseMonthKey(month);
    if (!parsed) return null;
    const row = await this.monthlyRateRepo.findOne({
      where: { year: parsed.year, month: parsed.month },
    });
    return row ? Number.parseFloat(row.rate) : null;
  }

  private async getLiveUsdRate(): Promise<number> {
    const now = Date.now();
    if (this.cachedRate !== null && now - this.cachedAt < CACHE_TTL_MS) {
      return this.cachedRate;
    }

    try {
      const response = await fetch('https://dolarapi.com/v1/dolares/oficial');
      if (!response.ok) {
        throw new Error(`dolarapi respondió ${response.status}`);
      }
      const data = (await response.json()) as DolarApiResponse;
      const rate = data?.venta;
      if (typeof rate !== 'number' || rate <= 0) {
        throw new Error('dolarapi devolvió una tasa inválida');
      }
      this.cachedRate = rate;
      this.cachedAt = now;
      return rate;
    } catch (error) {
      this.logger.warn(`No se pudo obtener la cotización del dólar: ${(error as Error).message}`);
      if (this.cachedRate !== null) {
        return this.cachedRate;
      }
      return 1;
    }
  }
}
