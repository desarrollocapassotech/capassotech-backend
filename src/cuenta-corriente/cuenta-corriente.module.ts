import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { CollaboratorsModule } from '../collaborators/collaborators.module';
import {
  CcConfigEntity,
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CcConfigEntity,
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
  providers: [CuentaCorrienteService],
})
export class CuentaCorrienteModule {}
