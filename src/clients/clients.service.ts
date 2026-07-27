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
import { UserRole } from '../auth/auth.types';
import { assertValidImageFile, buildClientImagePath } from '../common/profile-image.util';
import {
  AppUserEntity,
  BillingCurrency,
  ClientEntity,
  ClientFunctionalAnalystEntity,
  CollaboratorEntity,
  ProjectCollaboratorEntity,
  ProjectCollaboratorRole,
  ProjectEntity,
} from '../database/entities';
import { normalizeBillableConfig } from './billable-config.util';
import { CreateClientDto, UpdateClientDto } from './clients.dto';

export interface RequesterContext {
  uid: string;
  roles: UserRole[];
}

export interface ClientResponse extends ClientEntity {
  analistaFuncionalIds: string[];
}

type ClientField = keyof UpdateClientDto;

@Injectable()
export class ClientsService {
  // Un admin puede editar cualquier campo.
  private static readonly ADMIN_FIELDS: ClientField[] = [
    'name',
    'email',
    'password',
    'phone',
    'address',
    'city',
    'province',
    'postalCode',
    'floor',
    'razonSocial',
    'cuit',
    'ivaCondition',
    'billingCurrency',
    'billableConfig',
    'analistaFuncionalIds',
    'profileImageUrl',
    'billableHoursLimit',
  ];

  // Un contable solo puede ajustar la configuración de horas facturables (igual
  // que hoy en AdminTimeManagement/BillableAdjustForm.tsx). El resto de la ficha
  // de ClientManagement.tsx es de solo lectura para contable.
  private static readonly ACCOUNTANT_FIELDS: ClientField[] = ['billableConfig'];

  // Un cliente editando su propio perfil (UserProfile.tsx) solo toca datos de
  // contacto/fiscales, nunca facturación ni la lista de analistas asignados.
  private static readonly SELF_FIELDS: ClientField[] = [
    'name',
    'email',
    'phone',
    'address',
    'floor',
    'city',
    'province',
    'postalCode',
    'razonSocial',
    'cuit',
    'ivaCondition',
  ];

  constructor(
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(ClientFunctionalAnalystEntity)
    private readonly analystRepository: Repository<ClientFunctionalAnalystEntity>,
    @InjectRepository(AppUserEntity)
    private readonly appUserRepository: Repository<AppUserEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(ProjectCollaboratorEntity)
    private readonly assignmentRepository: Repository<ProjectCollaboratorEntity>,
    private readonly authService: AuthService,
  ) {}

  async findAll(): Promise<ClientResponse[]> {
    const clients = await this.clientRepository.find({ order: { name: 'ASC' } });
    const analystRows = await this.analystRepository.find();

    const analystsByClient = new Map<string, string[]>();
    for (const row of analystRows) {
      const list = analystsByClient.get(row.clientId) ?? [];
      list.push(row.collaboratorId);
      analystsByClient.set(row.clientId, list);
    }

    return clients.map((client) => ({ ...client, analistaFuncionalIds: analystsByClient.get(client.id) ?? [] }));
  }

  async findOne(id: string): Promise<ClientResponse> {
    const client = await this.findEntity(id);
    return this.withAnalysts(client);
  }

  // GET /clients y GET /clients/:id quedan abiertos a cualquier autenticado (se
  // usan en proyectos, historial, paneles de PM/QA), pero eso no debe filtrar el
  // markup/config de facturación de un cliente a otro colaborador o a otro
  // cliente. Ven este campo sin enmascarar: admin, contable, el propio cliente
  // sobre su propio registro (ClientHistory.tsx necesita su billableConfig para
  // explicar sus horas facturadas), y un project_manager sobre los clientes de
  // los proyectos que gestiona (ProjectManagerPanel.tsx necesita billableConfig
  // para calcular las horas facturables de su equipo). `managedClientIds` se
  // resuelve una sola vez por request vía resolveManagedClientIds, no acá, para
  // no disparar una query por cliente en el listado.
  maskBillingForRequester(
    client: ClientResponse,
    requester: RequesterContext,
    managedClientIds: Set<string> = new Set(),
  ): ClientResponse {
    const isPrivileged = requester.roles.includes(UserRole.ADMIN) || requester.roles.includes(UserRole.CONTABLE);
    const isSelf = client.userId !== null && client.userId === requester.uid;
    const isManaged = managedClientIds.has(client.id);

    if (isPrivileged || isSelf || isManaged) {
      return client;
    }

    const { billableConfig: _billableConfig, ...masked } = client;
    return masked as ClientResponse;
  }

  // Resuelve, para un project_manager, el conjunto de clientes cuyos proyectos
  // gestiona (managerIds). Devuelve un Set vacío para cualquier otro rol o si el
  // requester no tiene un colaborador asociado.
  async resolveManagedClientIds(requester: RequesterContext): Promise<Set<string>> {
    if (!requester.roles.includes(UserRole.PROJECT_MANAGER)) {
      return new Set();
    }

    const ownCollaborator = await this.collaboratorRepository.findOneBy({ userId: requester.uid });
    if (!ownCollaborator) {
      return new Set();
    }

    const managedAssignments = await this.assignmentRepository.find({
      where: { collaboratorId: ownCollaborator.id, role: ProjectCollaboratorRole.MANAGER },
    });
    const managedProjectIds = managedAssignments.map((a) => a.projectId);
    if (managedProjectIds.length === 0) {
      return new Set();
    }

    const managedProjects = await this.projectRepository.find({ where: { id: In(managedProjectIds) } });
    return new Set(
      managedProjects
        .map((project) => project.clientId)
        .filter((clientId): clientId is string => clientId !== null),
    );
  }

  async create(dto: CreateClientDto): Promise<ClientResponse> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Falta el nombre del cliente.');
    }

    let userId: string | null = null;

    if (dto.email && dto.password) {
      userId = await this.authService.createFirebaseUser(dto.email, dto.password);
      await this.appUserRepository.upsert(
        {
          id: userId,
          email: dto.email,
          name: dto.name,
          roles: [UserRole.CLIENT],
          hourlyRate: '0',
        },
        ['id'],
      );
    }

    const client = this.clientRepository.create({
      id: randomUUID(),
      userId,
      name: dto.name,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      address: dto.address ?? null,
      city: dto.city ?? null,
      province: dto.province ?? null,
      postalCode: dto.postalCode ?? null,
      floor: dto.floor ?? null,
      razonSocial: dto.razonSocial ?? null,
      cuit: dto.cuit ?? null,
      ivaCondition: dto.ivaCondition ?? null,
      password: dto.password ?? null,
      billingCurrency: this.normalizeCurrency(dto.billingCurrency),
      billableConfig: normalizeBillableConfig(dto.billableConfig),
      profileImageUrl: dto.profileImageUrl ?? null,
      billableHoursLimit: dto.billableHoursLimit != null ? String(dto.billableHoursLimit) : null,
    });

    const saved = await this.clientRepository.save(client);

    if (dto.analistaFuncionalIds?.length) {
      await this.replaceAnalysts(saved.id, dto.analistaFuncionalIds);
    }

    return this.withAnalysts(saved);
  }

  async update(id: string, dto: UpdateClientDto, requester: RequesterContext): Promise<ClientResponse> {
    const existing = await this.findEntity(id);
    const allowedFields = this.resolveAllowedFields(existing, requester);

    if (allowedFields.size === 0) {
      throw new ForbiddenException('No tenés permisos para editar este cliente.');
    }

    let analystsToApply: string[] | undefined;

    for (const field of allowedFields) {
      if (!(field in dto)) continue;

      switch (field) {
        case 'billingCurrency':
          if (dto.billingCurrency !== undefined) existing.billingCurrency = this.normalizeCurrency(dto.billingCurrency);
          break;
        case 'billableConfig':
          if (dto.billableConfig !== undefined) existing.billableConfig = normalizeBillableConfig(dto.billableConfig);
          break;
        case 'billableHoursLimit':
          if (dto.billableHoursLimit !== undefined) {
            existing.billableHoursLimit = dto.billableHoursLimit == null ? null : String(dto.billableHoursLimit);
          }
          break;
        case 'password':
          if (dto.password) {
            if (!existing.userId) {
              throw new BadRequestException('Este cliente todavía no tiene una cuenta de acceso creada.');
            }
            await this.authService.setFirebaseUserPassword(existing.userId, dto.password);
            existing.password = dto.password;
          }
          break;
        case 'analistaFuncionalIds':
          if (dto.analistaFuncionalIds !== undefined) analystsToApply = dto.analistaFuncionalIds;
          break;
        default:
          (existing as unknown as Record<string, unknown>)[field] = dto[field] ?? null;
      }
    }

    const saved = await this.clientRepository.save(existing);

    if (analystsToApply !== undefined) {
      await this.replaceAnalysts(id, analystsToApply);
    }

    return this.withAnalysts(saved);
  }

  // Sube la foto de perfil y la persiste en el mismo paso. Mismo criterio de
  // permisos que update(): solo se puede si 'profileImageUrl' está en el set de
  // campos permitidos (hoy, solo admin — los clientes no tienen autoedición de foto,
  // igual que en UserProfile.tsx).
  async uploadProfileImage(
    id: string,
    file: Express.Multer.File | undefined,
    requester: RequesterContext,
  ): Promise<ClientResponse> {
    assertValidImageFile(file);

    const existing = await this.findEntity(id);
    const allowedFields = this.resolveAllowedFields(existing, requester);
    if (!allowedFields.has('profileImageUrl')) {
      throw new ForbiddenException('No tenés permisos para cambiar esta foto de perfil.');
    }

    const path = buildClientImagePath(id, file.originalname);
    existing.profileImageUrl = await this.authService.uploadProfileImage(file.buffer, file.mimetype, path);

    const saved = await this.clientRepository.save(existing);
    return this.withAnalysts(saved);
  }

  async remove(id: string): Promise<void> {
    try {
      const result = await this.clientRepository.delete({ id });
      if (result.affected === 0) {
        throw new NotFoundException('Cliente no encontrado.');
      }
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          'No se puede eliminar: el cliente tiene proyectos u otras asignaciones vinculadas.',
        );
      }
      throw error;
    }
  }

  private async findEntity(id: string): Promise<ClientEntity> {
    const found = await this.clientRepository.findOneBy({ id });
    if (!found) {
      throw new NotFoundException('Cliente no encontrado.');
    }
    return found;
  }

  private async withAnalysts(client: ClientEntity): Promise<ClientResponse> {
    const rows = await this.analystRepository.find({ where: { clientId: client.id } });
    return { ...client, analistaFuncionalIds: rows.map((row) => row.collaboratorId) };
  }

  private async replaceAnalysts(clientId: string, collaboratorIds: string[]): Promise<void> {
    await this.analystRepository.delete({ clientId });
    const uniqueIds = [...new Set(collaboratorIds)];
    if (uniqueIds.length) {
      const rows = uniqueIds.map((collaboratorId) => this.analystRepository.create({ clientId, collaboratorId }));
      await this.analystRepository.save(rows);
    }
  }

  private resolveAllowedFields(target: ClientEntity, requester: RequesterContext): Set<ClientField> {
    if (requester.roles.includes(UserRole.ADMIN)) {
      return new Set(ClientsService.ADMIN_FIELDS);
    }

    const fields = new Set<ClientField>();
    if (target.userId && target.userId === requester.uid) {
      ClientsService.SELF_FIELDS.forEach((field) => fields.add(field));
    }
    if (requester.roles.includes(UserRole.CONTABLE)) {
      ClientsService.ACCOUNTANT_FIELDS.forEach((field) => fields.add(field));
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
