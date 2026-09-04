import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { IncomeEntity, IncomeProjectEntity, ProjectEntity } from '../database/entities';
import { IncomeController } from './income.controller';
import { IncomeService } from './income.service';

@Module({
  imports: [TypeOrmModule.forFeature([IncomeEntity, IncomeProjectEntity, ProjectEntity]), AuthModule],
  controllers: [IncomeController],
  providers: [IncomeService],
})
export class IncomeModule {}
