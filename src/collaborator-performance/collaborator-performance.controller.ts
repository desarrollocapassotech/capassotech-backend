import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CollaboratorPerformanceService } from './collaborator-performance.service';

// Sección de desempeño: rentabilidad y eficiencia por colaborador. Solo
// admin/contable, igual que expenses/income (nada acá queda abierto al resto).
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CONTABLE)
@Controller('collaborator-performance')
export class CollaboratorPerformanceController {
  constructor(private readonly collaboratorPerformanceService: CollaboratorPerformanceService) {}

  @Get(':collaboratorId')
  getPerformance(
    @Param('collaboratorId') collaboratorId: string,
    @Query('clientId') clientId?: string,
    @Query('projectId') projectId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.collaboratorPerformanceService.getPerformance(collaboratorId, { clientId, projectId, from, to });
  }
}
