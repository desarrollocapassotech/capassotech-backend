import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  AppUserEntity,
  ClientEntity,
  ClientFunctionalAnalystEntity,
  CollaboratorEntity,
  ProjectCollaboratorEntity,
  ProjectEntity,
} from '../database/entities';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ClientEntity,
      ClientFunctionalAnalystEntity,
      AppUserEntity,
      CollaboratorEntity,
      ProjectEntity,
      ProjectCollaboratorEntity,
    ]),
    AuthModule,
  ],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
