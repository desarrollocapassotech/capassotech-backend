import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { TicketStateEntity } from '../database/entities';
import { TicketStatesController } from './ticket-states.controller';
import { TicketStatesService } from './ticket-states.service';

@Module({
  imports: [TypeOrmModule.forFeature([TicketStateEntity]), AuthModule],
  controllers: [TicketStatesController],
  providers: [TicketStatesService],
  exports: [TicketStatesService],
})
export class TicketStatesModule {}
