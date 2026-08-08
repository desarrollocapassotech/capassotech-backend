import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { HoursAlertsService } from './hours-alerts.service';
import type { NotifyHighHoursDto } from './hours-alerts.dto';

// Disparado por ProjectManagerPanel.tsx cuando su propio cálculo de avance mensual
// (horas facturables vs. límite del cliente) da "en rojo" — el backend no reproduce
// esa cuenta, solo dedup + resuelve a qué PM avisar y manda el email.
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(UserRole.PROJECT_MANAGER, UserRole.ADMIN)
@Controller('clients/:clientId/high-hours-alert')
export class HoursAlertsController {
  constructor(private readonly hoursAlertsService: HoursAlertsService) {}

  @Post()
  notify(@Param('clientId') clientId: string, @Body() body: NotifyHighHoursDto) {
    return this.hoursAlertsService.notifyIfNew(clientId, body);
  }
}
