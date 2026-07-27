import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  ClientEntity,
  CollaboratorEntity,
  ProjectCollaboratorEntity,
  ProjectDeliverableEntity,
  ProjectEntity,
} from '../database/entities';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectEntity,
      ProjectCollaboratorEntity,
      ProjectDeliverableEntity,
      ClientEntity,
      CollaboratorEntity,
    ]),
    AuthModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
