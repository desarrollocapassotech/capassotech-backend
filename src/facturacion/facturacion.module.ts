import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClientEntity, ProjectEntity } from '../database/entities';
import { IntegrationsModule } from '../integrations/integrations.module';
import { FacturacionController } from './facturacion.controller';
import { FacturacionService } from './facturacion.service';

// Pantalla Facturación: facturar desde el tracker usando la API del Facturador.
@Module({
  imports: [
    TypeOrmModule.forFeature([ProjectEntity, ClientEntity]),
    AuthModule,
    IntegrationsModule,
  ],
  controllers: [FacturacionController],
  providers: [FacturacionService],
})
export class FacturacionModule {}
