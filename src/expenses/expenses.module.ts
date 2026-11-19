import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ResendService } from '../common/resend.service';
import {
  ClientEntity,
  CollaboratorEntity,
  ExpenseClientEntity,
  ExpenseEntity,
  ExpenseProjectEntity,
  ProjectEntity,
} from '../database/entities';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ExpenseEntity, ExpenseProjectEntity, ExpenseClientEntity, ClientEntity, CollaboratorEntity, ProjectEntity]),
    AuthModule,
  ],
  controllers: [ExpensesController],
  providers: [ExpensesService, ResendService],
})
export class ExpensesModule {}
