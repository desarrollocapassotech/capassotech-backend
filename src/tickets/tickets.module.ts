import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
// import { MailService } from '../common/mail.service'; // deshabilitado: SMTP_HOST no está configurado en Render, rompía el boot del backend
import { ClientEntity, TicketAttachmentEntity, TicketEntity, TicketMessageEntity } from '../database/entities';
import { TicketStatesModule } from '../ticket-states/ticket-states.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TicketEntity, TicketMessageEntity, TicketAttachmentEntity, ClientEntity]),
    AuthModule,
    TicketStatesModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService /*, MailService */],
  exports: [TicketsService],
})
export class TicketsModule {}
