import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResendService } from '../common/resend.service';
import { CuentaCorrienteModule } from '../cuenta-corriente/cuenta-corriente.module';
import {
  BalanceSummarySendEntity,
  ClientEntity,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  ExpenseClientEntity,
  ExpenseEntity,
  ExpenseProjectEntity,
  ProjectBillingTermEntity,
  ProjectEntity,
  TimeEntryEntity,
} from '../database/entities';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { BalanceResumenService } from './balance-resumen.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BalanceSummarySendEntity,
      ProjectEntity,
      ProjectBillingTermEntity,
      ClientEntity,
      TimeEntryEntity,
      CollaboratorEntity,
      CollaboratorProjectRateEntity,
      ExpenseEntity,
      ExpenseProjectEntity,
      ExpenseClientEntity,
    ]),
    CuentaCorrienteModule,
    ExchangeRateModule,
  ],
  providers: [BalanceResumenService, ResendService],
  exports: [BalanceResumenService],
})
export class BalanceModule {}
