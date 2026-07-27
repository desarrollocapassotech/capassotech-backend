import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ProjectsService } from './projects.service';
import type { CreateProjectDto, ReplaceProjectDeliverablesDto, UpdateProjectDto } from './projects.dto';

// La lectura queda abierta a cualquier usuario autenticado: la lista de proyectos
// se usa en toda la app (carga de horas, historial de clientes, panel de PM/QA,
// equipos, etc.), no solo en la pantalla de gestión.
//
// Las mutaciones son admin-only: a diferencia de colaboradores/clientes, acá
// contable es de solo lectura (ProjectManagement.tsx: isReadOnly = hasRole(user,
// 'contable')) y no existe autoedición para project manager (ProjectManagerPanel.tsx
// solo lee sus proyectos, no los modifica).
@UseGuards(FirebaseAuthGuard)
@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedRequest['user']) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    const projects = await this.projectsService.findAll();
    return this.projectsService.maskRatesForRequester(projects, { uid: user.uid, roles: requesterProfile.roles });
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedRequest['user']) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    const project = await this.projectsService.findOne(id);
    const [masked] = await this.projectsService.maskRatesForRequester([project], {
      uid: user.uid,
      roles: requesterProfile.roles,
    });
    return masked;
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: CreateProjectDto) {
    return this.projectsService.create(body);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateProjectDto) {
    return this.projectsService.update(id, body);
  }

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.projectsService.remove(id);
  }

  // Entregables: reemplaza toda la lista de una (mismo criterio de permisos que
  // el resto de las mutaciones de proyectos: solo admin).
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Put(':id/deliverables')
  replaceDeliverables(@Param('id') id: string, @Body() body: ReplaceProjectDeliverablesDto) {
    return this.projectsService.replaceDeliverables(id, body.deliverables ?? []);
  }
}
