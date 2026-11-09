import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ResendService } from '../common/resend.service';
import { BirthdayReminderEntity, CollaboratorEntity } from '../database/entities';
import { BirthdayRemindersService } from './birthday-reminders.service';

@Module({
  imports: [TypeOrmModule.forFeature([BirthdayReminderEntity, CollaboratorEntity])],
  providers: [BirthdayRemindersService, ResendService],
})
export class BirthdayRemindersModule {}
