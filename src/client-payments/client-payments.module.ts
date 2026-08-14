import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClientEntity, ClientPaymentEntity } from '../database/entities';
import { ClientPaymentsController } from './client-payments.controller';
import { ClientPaymentsService } from './client-payments.service';

@Module({
  imports: [TypeOrmModule.forFeature([ClientPaymentEntity, ClientEntity]), AuthModule],
  controllers: [ClientPaymentsController],
  providers: [ClientPaymentsService],
})
export class ClientPaymentsModule {}
