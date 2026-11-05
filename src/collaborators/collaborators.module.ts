import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ResendService } from '../common/resend.service';
import {
  AppUserEntity,
  ClientEntity,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  CollaboratorReceiptAcknowledgementEntity,
  ProjectCollaboratorEntity,
  ProjectEntity,
  TimeEntryEntity,
} from '../database/entities';
import { CollaboratorReceiptAcknowledgementController } from './collaborator-receipt-acknowledgement.controller';
import { CollaboratorReceiptAcknowledgementService } from './collaborator-receipt-acknowledgement.service';
import { CollaboratorReceiptSenderService } from './collaborator-receipt-sender.service';
import { CollaboratorReceiptService } from './collaborator-receipt.service';
import { CollaboratorsController } from './collaborators.controller';
import { CollaboratorsService } from './collaborators.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CollaboratorEntity,
      AppUserEntity,
      CollaboratorProjectRateEntity,
      CollaboratorReceiptAcknowledgementEntity,
      ProjectCollaboratorEntity,
      TimeEntryEntity,
      ClientEntity,
      ProjectEntity,
    ]),
    AuthModule,
  ],
  controllers: [CollaboratorsController, CollaboratorReceiptAcknowledgementController],
  providers: [
    CollaboratorsService,
    CollaboratorReceiptService,
    CollaboratorReceiptAcknowledgementService,
    CollaboratorReceiptSenderService,
    ResendService,
  ],
  exports: [
    CollaboratorsService,
    CollaboratorReceiptService,
    CollaboratorReceiptSenderService,
  ],
})
export class CollaboratorsModule {}
