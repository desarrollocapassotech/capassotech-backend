import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { assertValidImageFile, buildCollaboratorImagePath } from '../common/profile-image.util';
import {
  AppUserEntity,
  BillingCurrency,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  ProjectCollaboratorEntity,
  ProjectCollaboratorRole,
  TimeEntryEntity,
  UserRole,
} from '../database/entities';
import { CollaboratorProjectRateDto, CreateCollaboratorDto, UpdateCollaboratorDto } from './collaborators.dto';

export interface RequesterContext {
  uid: string;
  roles: UserRole[];
}

export interface CollaboratorResponse extends CollaboratorEntity {
  projectRates: CollaboratorProjectRateDto[];
}

type CollaboratorField = keyof UpdateCollaboratorDto;

@Injectable()
export class CollaboratorsService {
  // Un admin puede editar cualquier campo.
  private static readonly ADMIN_FIELDS: CollaboratorField[] = [
    'name',
    'personalEmail',
    'workEmail',
    'password',
    'hourlyRate',
    'currency',
    'exchangeRate',
    'active',
    'startedDate',
    'birthDate',
    'paymentMethod',
    'phone',
    'city',
    'address',
    'floor',
    'province',
    'postalCode',
    'cbuCvu',
    'roles',
    'showFinancialValues',
    'profileImageUrl',
  ];

  // Un contable solo puede tocar el sueldo (misma restricción que hoy en
  // EmployeeManagement.tsx: isRateOnlyEdit && isAccountant).
  private static readonly ACCOUNTANT_RATE_FIELDS: CollaboratorField[] = [
    'hourlyRate',
    'currency',
    'exchangeRate',
  ];

  // Un colaborador editando su propio perfil (UserProfile.tsx) solo toca datos
  // personales, nunca sueldo/rol/password (eso va por /auth/change-password).
  private static readonly SELF_FIELDS: CollaboratorField[] = [
    'name',
    'personalEmail',
    'workEmail',
    'phone',
    'birthDate',
    'address',
    'floor',
    'city',
    'province',
    'postalCode',
    'cbuCvu',
    'paymentMethod',
    'startedDate',
    'active',
    'profileImageUrl',
  ];

  constructor(
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    @InjectRepository(AppUserEntity)
    private readonly appUserRepository: Repository<AppUserEntity>,
    @InjectRepository(CollaboratorProjectRateEntity)
    private readonly projectRateRepository: Repository<CollaboratorProjectRateEntity>,
    @InjectRepository(ProjectCollaboratorEntity)
    private readonly assignmentRepository: Repository<ProjectCollaboratorEntity>,
    @InjectRepository(TimeEntryEntity)
    private readonly timeEntryRepository: Repository<TimeEntryEntity>,
    private readonly authService: AuthService,
  ) {}

  async findAll(): Promise<CollaboratorResponse[]> {
    const [collaborators, rates] = await Promise.all([
      this.collaboratorRepository.find({ order: { name: 'ASC' } }),
      this.projectRateRepository.find(),
    ]);

    const ratesByCollaborator = new Map<string, CollaboratorProjectRateDto[]>();
    for (const rate of rates) {
      const list = ratesByCollaborator.get(rate.collaboratorId) ?? [];
      list.push({ projectId: rate.projectId, hourlyRate: Number(rate.hourlyRate) });
      ratesByCollaborator.set(rate.collaboratorId, list);
    }

    return collaborators.map((collaborator) => ({
      ...collaborator,
      projectRates: ratesByCollaborator.get(collaborator.id) ?? [],
    }));
  }

  async findOne(id: string): Promise<CollaboratorResponse> {
    const found = await this.collaboratorRepository.findOneBy({ id });
    if (!found) {
      throw new NotFoundException('Colaborador no encontrado.');
    }
    return this.attachProjectRates(found);
  }

  // GET /collaborators y GET /collaborators/:id quedan abiertos a cualquier
  // autenticado (ver comentario en el controller), pero eso no debe filtrar
  // sueldo/CBU de TODO el equipo a cualquier colaborador. Ven estos campos sin
  // enmascarar: admin, contable, el propio colaborador sobre su propio registro
  // (mismo criterio que resolveAllowedFields para edición), y un
  // project_manager sobre los colaboradores asignados a los proyectos que
  // gestiona (ProjectManagerPanel.tsx necesita el hourlyRate de su equipo para
  // calcular las horas facturables). `managedCollaboratorIds` se resuelve una
  // sola vez por request vía resolveManagedCollaboratorIds, no acá, para no
  // disparar una query por colaborador en el listado.
  maskFinancialsForRequester(
    collaborator: CollaboratorResponse,
    requester: RequesterContext,
    managedCollaboratorIds: Set<string> = new Set(),
  ): CollaboratorResponse {
    const isPrivileged = requester.roles.includes(UserRole.ADMIN) || requester.roles.includes(UserRole.CONTABLE);
    const isSelf = collaborator.userId !== null && collaborator.userId === requester.uid;
    const isManaged = managedCollaboratorIds.has(collaborator.id);

    if (isPrivileged || isSelf || isManaged) {
      return collaborator;
    }

    const { hourlyRate: _hourlyRate, cbuCvu: _cbuCvu, projectRates: _projectRates, ...masked } = collaborator;
    return masked as CollaboratorResponse;
  }

  // Resuelve, para un project_manager, el conjunto de colaboradores "visibles"
  // en los proyectos que gestiona: no alcanza con los asignados formalmente en
  // project_collaborators (team member/manager), porque alguien puede haber
  // cargado horas en el proyecto sin estar asignado ahí (ej. un admin cubriendo
  // una tarea puntual) y el cálculo de horas facturables del panel de PM
  // (calculateBillableHours) necesita el hourlyRate de TODOS los que le cargaron
  // horas ese mes, no solo del equipo formal. Devuelve un Set vacío para
  // cualquier otro rol o si el requester no tiene un colaborador asociado.
  async resolveManagedCollaboratorIds(requester: RequesterContext): Promise<Set<string>> {
    if (!requester.roles.includes(UserRole.PROJECT_MANAGER)) {
      return new Set();
    }

    const ownCollaborator = await this.collaboratorRepository.findOneBy({ userId: requester.uid });
    if (!ownCollaborator) {
      return new Set();
    }

    const managerAssignments = await this.assignmentRepository.find({
      where: { collaboratorId: ownCollaborator.id, role: ProjectCollaboratorRole.MANAGER },
    });
    const managedProjectIds = managerAssignments.map((a) => a.projectId);
    if (managedProjectIds.length === 0) {
      return new Set();
    }

    const [teamAssignments, timeEntryRows] = await Promise.all([
      this.assignmentRepository.find({ where: { projectId: In(managedProjectIds) } }),
      this.timeEntryRepository
        .createQueryBuilder('te')
        .select('DISTINCT te.collaborator_id', 'collaboratorId')
        .where('te.project_id IN (:...projectIds)', { projectIds: managedProjectIds })
        .getRawMany<{ collaboratorId: string }>(),
    ]);

    const collaboratorIds = new Set(teamAssignments.map((a) => a.collaboratorId));
    for (const row of timeEntryRows) {
      collaboratorIds.add(row.collaboratorId);
    }
    return collaboratorIds;
  }

  async create(dto: CreateCollaboratorDto): Promise<CollaboratorResponse> {
    if (!dto.name?.trim() || !dto.startedDate || dto.hourlyRate === undefined || dto.hourlyRate === null) {
      throw new BadRequestException('Faltan campos obligatorios (nombre, fecha de inicio, valor por hora).');
    }

    const roles = dto.roles?.length ? dto.roles : [UserRole.COLABORADOR];
    let userId: string | null = null;

    if (dto.workEmail && dto.password) {
      userId = await this.authService.createFirebaseUser(dto.workEmail, dto.password);
      await this.appUserRepository.upsert(
        {
          id: userId,
          email: dto.workEmail,
          name: dto.name,
          roles,
          hourlyRate: String(dto.hourlyRate),
        },
        ['id'],
      );
    }

    const collaborator = this.collaboratorRepository.create({
      id: randomUUID(),
      userId,
      name: dto.name,
      personalEmail: dto.personalEmail ?? null,
      workEmail: dto.workEmail ?? null,
      password: dto.password ?? null,
      hourlyRate: String(dto.hourlyRate),
      currency: this.normalizeCurrency(dto.currency),
      exchangeRate: dto.exchangeRate != null ? String(dto.exchangeRate) : null,
      active: dto.active ?? true,
      startedDate: dto.startedDate,
      birthDate: dto.birthDate ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      phone: dto.phone ?? null,
      city: dto.city ?? null,
      address: dto.address ?? null,
      floor: dto.floor ?? null,
      province: dto.province ?? null,
      postalCode: dto.postalCode ?? null,
      cbuCvu: dto.cbuCvu ?? null,
      roles,
      showFinancialValues: dto.showFinancialValues ?? true,
      profileImageUrl: dto.profileImageUrl ?? null,
    });

    const saved = await this.collaboratorRepository.save(collaborator);
    return { ...saved, projectRates: [] };
  }

  async update(
    id: string,
    dto: UpdateCollaboratorDto,
    requester: RequesterContext,
  ): Promise<CollaboratorResponse> {
    const existing = await this.findOne(id);
    const allowedFields = this.resolveAllowedFields(existing, requester);

    if (allowedFields.size === 0) {
      throw new ForbiddenException('No tenés permisos para editar este colaborador.');
    }

    for (const field of allowedFields) {
      if (!(field in dto)) continue;

      switch (field) {
        case 'hourlyRate':
          if (dto.hourlyRate !== undefined) existing.hourlyRate = String(dto.hourlyRate);
          break;
        case 'exchangeRate':
          if (dto.exchangeRate !== undefined) {
            existing.exchangeRate = dto.exchangeRate == null ? null : String(dto.exchangeRate);
          }
          break;
        case 'currency':
          if (dto.currency !== undefined) existing.currency = this.normalizeCurrency(dto.currency);
          break;
        case 'password':
          if (dto.password) {
            if (!existing.userId) {
              throw new BadRequestException('Este colaborador todavía no tiene una cuenta de acceso creada.');
            }
            await this.authService.setFirebaseUserPassword(existing.userId, dto.password);
            existing.password = dto.password;
          }
          break;
        case 'roles':
          if (dto.roles !== undefined) existing.roles = dto.roles.length ? dto.roles : [UserRole.COLABORADOR];
          break;
        default:
          (existing as unknown as Record<string, unknown>)[field] = dto[field] ?? null;
      }
    }

    return this.collaboratorRepository.save(existing);
  }

  // Sube la foto de perfil y la persiste en el mismo paso. Mismo criterio de
  // permisos que update(): solo se puede si 'profileImageUrl' está en el set de
  // campos permitidos para este requester sobre este colaborador (admin, o el
  // propio colaborador vía UserProfile.tsx).
  async uploadProfileImage(
    id: string,
    file: Express.Multer.File | undefined,
    requester: RequesterContext,
  ): Promise<CollaboratorResponse> {
    assertValidImageFile(file);

    const existing = await this.findOne(id);
    const allowedFields = this.resolveAllowedFields(existing, requester);
    if (!allowedFields.has('profileImageUrl')) {
      throw new ForbiddenException('No tenés permisos para cambiar esta foto de perfil.');
    }

    const path = buildCollaboratorImagePath(id, file.originalname);
    existing.profileImageUrl = await this.authService.uploadProfileImage(file.buffer, file.mimetype, path);

    return this.collaboratorRepository.save(existing);
  }

  // Reemplaza de una todos los overrides de valor hora por proyecto de este
  // colaborador (mismo criterio que replaceRoleAssignments en projects.service.ts:
  // el form manda la lista completa, acá se borra y se reinserta todo junto).
  // Mismos roles que pueden tocar el sueldo (ver ACCOUNTANT_RATE_FIELDS).
  async replaceProjectRates(
    id: string,
    rates: CollaboratorProjectRateDto[],
    requester: RequesterContext,
  ): Promise<CollaboratorResponse> {
    const canEditRates = requester.roles.includes(UserRole.ADMIN) || requester.roles.includes(UserRole.CONTABLE);
    if (!canEditRates) {
      throw new ForbiddenException('No tenés permisos para editar tarifas por proyecto.');
    }

    await this.findOne(id); // 404 si no existe

    const rateByProject = new Map<string, number>();
    for (const rate of rates) {
      if (!rate.projectId) continue;
      if (!Number.isFinite(rate.hourlyRate) || rate.hourlyRate <= 0) {
        throw new BadRequestException('El valor hora por proyecto debe ser un número mayor a 0.');
      }
      rateByProject.set(rate.projectId, rate.hourlyRate);
    }

    await this.projectRateRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(CollaboratorProjectRateEntity);
      await repo.delete({ collaboratorId: id });

      if (!rateByProject.size) return;

      try {
        const rows = Array.from(rateByProject.entries()).map(([projectId, hourlyRate]) =>
          repo.create({ collaboratorId: id, projectId, hourlyRate: String(hourlyRate) }),
        );
        await repo.save(rows);
      } catch (error) {
        if (this.isForeignKeyViolation(error)) {
          throw new BadRequestException('Uno de los proyectos indicados no existe.');
        }
        throw error;
      }
    });

    return this.findOne(id);
  }

  private async attachProjectRates(collaborator: CollaboratorEntity): Promise<CollaboratorResponse> {
    const rates = await this.projectRateRepository.findBy({ collaboratorId: collaborator.id });
    return {
      ...collaborator,
      projectRates: rates.map((rate) => ({ projectId: rate.projectId, hourlyRate: Number(rate.hourlyRate) })),
    };
  }

  async remove(id: string): Promise<void> {
    try {
      const result = await this.collaboratorRepository.delete({ id });
      if (result.affected === 0) {
        throw new NotFoundException('Colaborador no encontrado.');
      }
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          'No se puede eliminar: el colaborador tiene horas cargadas u otras asignaciones. Desactivalo en su lugar.',
        );
      }
      throw error;
    }
  }

  private resolveAllowedFields(
    target: CollaboratorEntity,
    requester: RequesterContext,
  ): Set<CollaboratorField> {
    if (requester.roles.includes(UserRole.ADMIN)) {
      return new Set(CollaboratorsService.ADMIN_FIELDS);
    }

    const fields = new Set<CollaboratorField>();
    if (target.userId && target.userId === requester.uid) {
      CollaboratorsService.SELF_FIELDS.forEach((field) => fields.add(field));
    }
    if (requester.roles.includes(UserRole.CONTABLE)) {
      CollaboratorsService.ACCOUNTANT_RATE_FIELDS.forEach((field) => fields.add(field));
    }
    return fields;
  }

  private normalizeCurrency(currency: BillingCurrency | undefined): BillingCurrency {
    return currency === BillingCurrency.ARS ? BillingCurrency.ARS : BillingCurrency.USD;
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503';
  }
}
