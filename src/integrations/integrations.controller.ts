import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { UserRole } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import {
  AuthenticatedRequest,
  FirebaseAuthGuard,
} from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { FacturadorAccessService } from './facturador-access.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly facturador: FacturadorAccessService,
    private readonly authService: AuthService,
  ) {}

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
