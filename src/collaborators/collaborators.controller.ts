import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CollaboratorReceiptService } from './collaborator-receipt.service';
import type { GenerateCollaboratorReceiptDto } from './collaborator-receipt.dto';
import { CollaboratorsService } from './collaborators.service';
import type {
  CreateCollaboratorDto,
  ReplaceCollaboratorProjectRatesDto,
  UpdateCollaboratorDto,
} from './collaborators.dto';

// La lectura queda abierta a cualquier usuario autenticado: la lista de
// colaboradores se usa en toda la app (time entries, equipos de proyecto,
// historial de clientes, etc.), no solo en la pantalla de gestión.
@UseGuards(FirebaseAuthGuard)
@Controller('collaborators')
export class CollaboratorsController {
  constructor(
    private readonly collaboratorsService: CollaboratorsService,
    private readonly authService: AuthService,
    private readonly collaboratorReceiptService: CollaboratorReceiptService,
  ) {}

  @Get()
  async findAll(@CurrentUser() user: AuthenticatedRequest['user']) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    const requester = { uid: user.uid, roles: requesterProfile.roles };
    const [collaborators, managedCollaboratorIds] = await Promise.all([
      this.collaboratorsService.findAll(),
      this.collaboratorsService.resolveManagedCollaboratorIds(requester),
    ]);
    return collaborators.map((collaborator) =>
      this.collaboratorsService.maskFinancialsForRequester(collaborator, requester, managedCollaboratorIds),
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedRequest['user']) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    const requester = { uid: user.uid, roles: requesterProfile.roles };
    const [collaborator, managedCollaboratorIds] = await Promise.all([
      this.collaboratorsService.findOne(id),
      this.collaboratorsService.resolveManagedCollaboratorIds(requester),
    ]);
    return this.collaboratorsService.maskFinancialsForRequester(collaborator, requester, managedCollaboratorIds);
  }

  // Alta: solo admin (igual que hoy, el botón "Nuevo Colaborador" no se muestra
  // para contable en EmployeeManagement.tsx).
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post()
  create(@Body() body: CreateCollaboratorDto) {
    return this.collaboratorsService.create(body);
  }

  // Edición: admin (todo), contable (solo sueldo) o el propio colaborador sobre su
  // perfil (datos personales). El detalle de qué campos aplica cada rol vive en
  // CollaboratorsService.resolveAllowedFields, no en un guard genérico, porque
  // depende de si el request es sobre uno mismo.
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateCollaboratorDto,
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    return this.collaboratorsService.update(id, body, {
      uid: user.uid,
      roles: requesterProfile.roles,
    });
  }

  // Recibo de pago: admin o contable (ver EmployeeManagement.tsx -> botón
  // "Emitir recibo"). El frontend arma y previsualiza los datos editables; acá
  // solo se vuelcan sobre el template de templates/template-recibo-colaborador.pdf.
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTABLE)
  @Post(':id/receipt')
  @Header('Content-Type', 'application/pdf')
  async generateReceipt(
    @Param('id') id: string,
    @Body() body: GenerateCollaboratorReceiptDto,
  ): Promise<StreamableFile> {
    await this.collaboratorsService.findOne(id); // 404 si no existe
    const pdf = await this.collaboratorReceiptService.generate(body);
    return new StreamableFile(pdf);
  }

  // Foto de perfil: mismo criterio de permisos que update() (ver
  // CollaboratorsService.resolveAllowedFields) — admin, o el propio colaborador
  // sobre su perfil. Sube directo a Firebase Storage vía el backend, en vez de
  // subir desde el navegador como antes.
  @Post(':id/profile-image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadProfileImage(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    return this.collaboratorsService.uploadProfileImage(id, file, {
      uid: user.uid,
      roles: requesterProfile.roles,
    });
  }

  // Valor hora por proyecto: reemplaza toda la lista de una (mismo criterio de
  // permisos que el sueldo: admin, o contable vía ACCOUNTANT_RATE_FIELDS).
  @Put(':id/project-rates')
  async replaceProjectRates(
    @Param('id') id: string,
    @Body() body: ReplaceCollaboratorProjectRatesDto,
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    const requesterProfile = await this.authService.getProfile(user.uid, user.email);
    return this.collaboratorsService.replaceProjectRates(id, body.rates ?? [], {
      uid: user.uid,
      roles: requesterProfile.roles,
    });
  }

  // Baja definitiva: solo admin (igual que hoy, el botón de eliminar no se
  // muestra para contable). Desactivar es un PATCH { active: false }, no esto.
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.collaboratorsService.remove(id);
  }
}
