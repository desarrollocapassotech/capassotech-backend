import { Body, Controller, ForbiddenException, Get, Param, Put, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientEntity } from '../database/entities';
import { ClientPaymentsService } from './client-payments.service';
import type { UpsertClientPaymentDto } from './client-payments.dto';

// GET: admin, contable, o el propio cliente sobre sus pagos (necesita ver
// cuánto debe). PUT: solo admin/contable (ver AskUserQuestion en la sesión que
// agregó esto: el cliente nunca carga su propia deuda).
@UseGuards(FirebaseAuthGuard)
@Controller('clients/:clientId/payments')
export class ClientPaymentsController {
  constructor(
    private readonly clientPaymentsService: ClientPaymentsService,
    private readonly authService: AuthService,
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
  ) {}

  @Get()
  async findAll(
    @Param('clientId') clientId: string,
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    const isPrivileged =
      requesterProfile.roles.includes(UserRole.ADMIN) || requesterProfile.roles.includes(UserRole.CONTABLE);

    if (!isPrivileged) {
      const client = await this.clientRepository.findOneBy({ id: clientId });
      const isSelf = !!client?.userId && client.userId === user.uid;
      if (!isSelf) {
        throw new ForbiddenException('No tenés permisos para ver los pagos de este cliente.');
      }
    }

    return this.clientPaymentsService.findByClient(clientId);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTABLE)
  @Put()
  upsert(
    @Param('clientId') clientId: string,
    @Body() body: UpsertClientPaymentDto,
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    return this.clientPaymentsService.upsert(clientId, body, user.uid);
  }
}
