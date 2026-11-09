import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CollaboratorsModule } from '../collaborators/collaborators.module';
import {
  CcConfigEntity,
  CcDueReminderEntity,
  CcImputationEntity,
  CcInstallmentPlanEntity,
  CcMovementEntity,
  ClientEntity,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  CollaboratorReceiptAcknowledgementEntity,
  TimeEntryEntity,
} from '../database/entities';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { CuentaCorrienteController } from './cuenta-corriente.controller';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { VencimientosService } from './vencimientos.service';
import { ResendService } from '../common/resend.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CcConfigEntity,
      CcDueReminderEntity,
      CcMovementEntity,
      CcImputationEntity,
      CcInstallmentPlanEntity,
      ClientEntity,
      CollaboratorEntity,
      CollaboratorProjectRateEntity,
      CollaboratorReceiptAcknowledgementEntity,
      TimeEntryEntity,
    ]),
    AuthModule,
    CollaboratorsModule,
    ExchangeRateModule,
    FacturacionModule,
    IntegrationsModule,
  ],
  controllers: [CuentaCorrienteController],
  providers: [CuentaCorrienteService, VencimientosService, ResendService],
})
export class CuentaCorrienteModule {}
