import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ClientsService } from './clients.service';
import type { CreateClientDto, UpdateClientDto } from './clients.dto';

// La lectura queda abierta a cualquier usuario autenticado: la lista de clientes se
// usa en toda la app (proyectos, historial, paneles de PM/QA, etc.), no solo en la
// pantalla de gestión.
@UseGuards(FirebaseAuthGuard)
@Controller('clients')
export class ClientsController {
  constructor(
    private readonly clientsService: ClientsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedRequest['user']) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    const requester = { uid: user.uid, roles: requesterProfile.roles };
    const [clients, managedClientIds] = await Promise.all([
      this.clientsService.findAll(),
      this.clientsService.resolveManagedClientIds(requester),
    ]);
    return clients.map((client) => this.clientsService.maskBillingForRequester(client, requester, managedClientIds));
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedRequest['user']) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    const requester = { uid: user.uid, roles: requesterProfile.roles };
    const [client, managedClientIds] = await Promise.all([
      this.clientsService.findOne(id),
      this.clientsService.resolveManagedClientIds(requester),
    ]);
    return this.clientsService.maskBillingForRequester(client, requester, managedClientIds);
  }

  // Alta: solo admin (igual que hoy, el botón "Nuevo Cliente" no se muestra para
  // contable en ClientManagement.tsx, que ahí es de solo lectura).
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: CreateClientDto) {
    return this.clientsService.create(body);
  }

  // Edición: admin (todo), contable (solo billableConfig, vía
  // AdminTimeManagement/BillableAdjustForm.tsx) o el propio cliente sobre su perfil
  // (datos de contacto/fiscales). El detalle de campos por rol vive en
  // ClientsService.resolveAllowedFields, no en un guard genérico.
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateClientDto,
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    return this.clientsService.update(id, body, {
      uid: user.uid,
      roles: requesterProfile.roles,
    });
  }

  // Foto de perfil: mismo criterio que update() — hoy solo admin, los clientes no
  // tienen autoedición de foto (UserProfile.tsx no lo permite para el rol client).
  @Post(':id/profile-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadProfileImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    return this.clientsService.uploadProfileImage(id, file, {
      uid: user.uid,
      roles: requesterProfile.roles,
    });
  }

  // Baja: solo admin (igual que hoy).
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.clientsService.remove(id);
  }
}
