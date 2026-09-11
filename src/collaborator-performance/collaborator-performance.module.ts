import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ExchangeRateModule } from '../exchange-rate/exchange-rate.module';
import { CollaboratorEntity, CollaboratorProjectRateEntity, ProjectEntity, TimeEntryEntity } from '../database/entities';
import { CollaboratorPerformanceController } from './collaborator-performance.controller';
import { CollaboratorPerformanceService } from './collaborator-performance.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([CollaboratorEntity, TimeEntryEntity, ProjectEntity, CollaboratorProjectRateEntity]),
    AuthModule,
    ExchangeRateModule,
  ],
  controllers: [CollaboratorPerformanceController],
  providers: [CollaboratorPerformanceService],
})
export class CollaboratorPerformanceModule {}
