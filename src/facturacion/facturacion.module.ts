import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  ClientEntity,
  ClientReceiptEntity,
  ProjectEntity,
} from '../database/entities';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';

// Pantalla Facturación: facturar desde el tracker usando la API del Facturador.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      ClientEntity,
      ClientReceiptEntity,
    ]),
    AuthModule,
    IntegrationsModule,
    ExchangeRateModule,
  ],
  controllers: [FacturacionController],
  providers: [FacturacionService],
})
export class FacturacionModule {}
