import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AuthenticatedRequest,
  FirebaseAuthGuard,
} from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BillableHoursService } from './billable-hours.service';
import { FacturadorAccessService } from './facturador-access.service';
import { IntegrationKeyGuard } from './integration-key.guard';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly billableHours: BillableHoursService,
    private readonly facturador: FacturadorAccessService,
    private readonly authService: AuthService,
  ) {}

  /** Para el Facturador (servidor a servidor, con X-Integration-Key). */
  @UseGuards(IntegrationKeyGuard)
  @Get('billable-hours')
  listarHoras(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.billableHours.listar(from, to, clientId || undefined);
  }

  /** Botón "Ir al facturador" (usuario del tracker con rol admin o contable). */
  @UseGuards(FirebaseAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTABLE)
  @Post('facturador/acceso')
  @HttpCode(200)
  async irAlFacturador(
    @CurrentUser() user: AuthenticatedRequest['user'],
    @Body() body: { destino?: unknown },
  ) {
    const profile = await this.authService.getProfile(user.uid, user.email);
    const destino =
      typeof body?.destino === 'string' ? body.destino : undefined;
    return this.facturador.pedirAcceso(
      user.email,
      profile.name || undefined,
      destino,
    );
  }
}
