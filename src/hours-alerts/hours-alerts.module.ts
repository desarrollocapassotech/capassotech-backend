import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ResendService } from '../common/resend.service';
import { ClientHoursAlertEntity, CollaboratorEntity, ProjectCollaboratorEntity } from '../database/entities';
import { HoursAlertsController } from './hours-alerts.controller';
import { HoursAlertsService } from './hours-alerts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ClientHoursAlertEntity, ProjectCollaboratorEntity, CollaboratorEntity]),
    AuthModule,
  ],
  controllers: [HoursAlertsController],
  providers: [HoursAlertsService, ResendService],
})
export class HoursAlertsModule {}
