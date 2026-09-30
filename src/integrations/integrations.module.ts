import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  ClientEntity,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  ProjectEntity,
  TimeEntryEntity,
} from '../database/entities';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { BillableHoursService } from './billable-hours.service';
import { FacturadorAccessService } from './facturador-access.service';
import { FacturadorClient } from './facturador.client';
import { IntegrationsController } from './integrations.controller';

// Integración con el Facturador: cliente de su API pública, horas facturables (para la
// pantalla Facturación) y acceso sin doble login para configurarlo.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TimeEntryEntity,
      ProjectEntity,
      ClientEntity,
      CollaboratorEntity,
      CollaboratorProjectRateEntity,
    ]),
    AuthModule,
    ExchangeRateModule,
  ],
  controllers: [IntegrationsController],
  providers: [BillableHoursService, FacturadorAccessService, FacturadorClient],
  exports: [BillableHoursService, FacturadorClient],
})
export class IntegrationsModule {}
