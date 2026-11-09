import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TimeEntriesService } from './time-entries.service';
import type { CreateTimeEntryDto, UpdateTimeEntryDto } from './time-entries.dto';

// La lectura queda abierta a cualquier usuario autenticado: los reportes de horas
// (tabla propia, historial de clientes, panel de PM/QA, gestión admin) se arman
// todos a partir de la lista completa.
@UseGuards(FirebaseAuthGuard)
@Controller('time-entries')
export class TimeEntriesController {
  constructor(
    private readonly timeEntriesService: TimeEntriesService,
    private readonly authService: AuthService,
  ) {}

  // Un cliente solo recibe las horas de sus proyectos y las de productos marcadas para él: las
  // de otros clientes y las internas no le llegan nunca.
  @Get()
  async findAll(@CurrentUser() user: AuthenticatedRequest['user']) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    return this.timeEntriesService.findAllFor({ uid: user.uid, roles: requesterProfile.roles });
  }

  // Estado de la sincronización con el Google Sheet de reporting: cuántas horas
  // están sin confirmar todavía y los últimos errores. Declarado antes de
  // ':id' para que Nest no lo confunda con un id de registro.
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTABLE)
  @Get('sheet-sync/status')
  getSheetSyncStatus() {
    return this.timeEntriesService.getSheetSyncStatus();
  }

  // Fuerza un reintento ahora mismo (el cron ya lo hace solo cada 5 minutos),
  // útil para confirmar que quedó todo al día sin esperar al próximo ciclo.
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTABLE)
  @Post('sheet-sync/run')
  runSheetSync() {
    return this.timeEntriesService.resyncPendingSheetEntries();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.timeEntriesService.findOne(id);
  }

  // Alta: cualquier autenticado, pero el service solo deja cargar para uno mismo
  // salvo que sea admin/contable (igual que hoy: EmployeePanel/TimeEntryForm.tsx
  // vs. la carga para terceros y el import XLSX de AdminTimeManagement.tsx).
  @Post()
  async create(@Body() body: CreateTimeEntryDto, @CurrentUser() user: AuthenticatedRequest['user']) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    return this.timeEntriesService.create(body, { uid: user.uid, roles: requesterProfile.roles });
  }

  // Edición y baja: solo admin/contable (igual que hoy, exclusivo de
  // AdminTimeManagement.tsx; un colaborador no puede editar/borrar sus propias horas
  // ya cargadas).
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTABLE)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateTimeEntryDto) {
    return this.timeEntriesService.update(id, body);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTABLE)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.timeEntriesService.remove(id);
  }
}
