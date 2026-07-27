import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  AppUserEntity,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  ProjectCollaboratorEntity,
  TimeEntryEntity,
} from '../database/entities';
import { CollaboratorReceiptService } from './collaborator-receipt.service';
import { CollaboratorsController } from './collaborators.controller';
import { CollaboratorsService } from './collaborators.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollaboratorEntity,
      AppUserEntity,
      CollaboratorProjectRateEntity,
      ProjectCollaboratorEntity,
      TimeEntryEntity,
    ]),
    AuthModule,
  ],
  controllers: [CollaboratorsController],
  providers: [CollaboratorsService, CollaboratorReceiptService],
  exports: [CollaboratorsService],
})
export class CollaboratorsModule {}
