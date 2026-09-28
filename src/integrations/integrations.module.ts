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
import { IntegrationKeyGuard } from './integration-key.guard';
import { IntegrationsController } from './integrations.controller';

// Integración con el Facturador: horas facturables (servidor a servidor) y acceso
// sin doble login. No modifica ningún otro módulo.
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
  providers: [
    BillableHoursService,
    FacturadorAccessService,
    IntegrationKeyGuard,
  ],
})
export class IntegrationsModule {}
