import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { ClientEntity, ProjectEntity } from '../database/entities';
import { JiraController } from './jira.controller';
import { JiraService } from './jira.service';

@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity, ClientEntity]), AuthModule],
  controllers: [JiraController],
  providers: [JiraService],
})
export class JiraModule {}
