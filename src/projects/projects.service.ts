import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import {
  ClientEntity,
  CollaboratorEntity,
  PROJECT_KINDS,
  ProjectBillingTermEntity,
  ProjectCollaboratorRole,
  ProjectEntity,
  ProjectDeliverableEntity,
} from '../database/entities';
import { normalizeBillableConfig } from '../clients/billable-config.util';
import { condicionDeEntidad, type CondicionCobro } from './condiciones';
import { ProjectCollaboratorEntity } from '../database/entities';
import { UserRole } from '../auth/auth.types';
import { CreateProjectDto, ProjectDeliverableDto, UpdateProjectDto } from './projects.dto';

export interface ProjectResponse extends ProjectEntity {
  managerIds: string[];
  teamMemberIds: string[];
  deliverables: (ProjectDeliverableDto & { id: string })[];
  /** Condiciones de cobro del proyecto (filtradas según quién pregunta). */
  billingTerms: CondicionCobro[];
}

export interface RequesterContext {
  uid: string;
  roles: UserRole[];
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(ProjectCollaboratorEntity)
    private readonly assignmentRepository: Repository<ProjectCollaboratorEntity>,
    @InjectRepository(ProjectDeliverableEntity)
    private readonly deliverableRepository: Repository<ProjectDeliverableEntity>,
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    @InjectRepository(ProjectBillingTermEntity)
    private readonly termRepository: Repository<ProjectBillingTermEntity>,
  ) {}

  async findAll(): Promise<ProjectResponse[]> {
    const projects = await this.projectRepository.find({ order: { name: 'ASC' } });
    const [assignments, deliverables, terms] = await Promise.all([
      this.assignmentRepository.find(),
      this.deliverableRepository.find({ order: { dueDate: 'ASC' } }),
      this.termRepository.find({ order: { desde: 'ASC' } }),
    ]);

    const managersByProject = new Map<string, string[]>();
    const teamByProject = new Map<string, string[]>();
    for (const assignment of assignments) {
      const map = assignment.role === ProjectCollaboratorRole.MANAGER ? managersByProject : teamByProject;
      const list = map.get(assignment.projectId) ?? [];
      list.push(assignment.collaboratorId);
      map.set(assignment.projectId, list);
    }

    const deliverablesByProject = new Map<string, (ProjectDeliverableDto & { id: string })[]>();
    for (const deliverable of deliverables) {
      const list = deliverablesByProject.get(deliverable.projectId) ?? [];
      list.push({ id: deliverable.id, name: deliverable.name, dueDate: deliverable.dueDate });
      deliverablesByProject.set(deliverable.projectId, list);
    }

    return projects.map((project) => ({
      ...project,
      managerIds: managersByProject.get(project.id) ?? [],
      teamMemberIds: teamByProject.get(project.id) ?? [],
      deliverables: deliverablesByProject.get(project.id) ?? [],
      billingTerms: terms.filter((t) => t.projectId === project.id).map(condicionDeEntidad),
    }));
  }

  async findOne(id: string): Promise<ProjectResponse> {
    const project = await this.findEntity(this.projectRepository.manager, id);
    return this.withAssignments(project);
  }

  // GET /projects y GET /projects/:id quedan abiertos a cualquier autenticado
  // (carga de horas, historial de clientes, panel de PM/QA), pero eso no debe
  // filtrar cuánto le cobramos a un cliente a colaboradores/PM/QA, ni lo que
  // pagan OTROS clientes a un cliente logueado. Las condiciones de cobro y la
  // configuración de horas facturables se ven así:
  // - admin y contable: todo.
  // - project_manager, en los proyectos que gestiona: todo (ProjectManagerPanel.tsx
  //   calcula las horas facturables de su equipo).
  // - cliente: solo sus propias condiciones, en cualquier proyecto (las necesita para
  //   mostrar sus horas facturables), y la configuración de horas de los proyectos
  //   donde tiene condiciones o es dueño.
  // - el resto: nada.
  // rate, currency y billingType del proyecto ya no se usan (se eliminan en una
  // migración posterior): no salen nunca.
  async maskRatesForRequester(projects: ProjectResponse[], requester: RequesterContext): Promise<ProjectResponse[]> {
    const sinLegado = projects.map(
      ({ rate: _rate, currency: _currency, billingType: _tipo, ...p }) => p as ProjectResponse,
    );
    const isPrivileged = requester.roles.includes(UserRole.ADMIN) || requester.roles.includes(UserRole.CONTABLE);
    if (isPrivileged) {
      return sinLegado;
    }

    let ownClientId: string | null = null;
    if (requester.roles.includes(UserRole.CLIENT)) {
      const ownClient = await this.clientRepository.findOneBy({ userId: requester.uid });
      ownClientId = ownClient?.id ?? null;
    }

    let managedProjectIds: Set<string> | null = null;
    if (requester.roles.includes(UserRole.PROJECT_MANAGER)) {
      const ownCollaborator = await this.collaboratorRepository.findOneBy({ userId: requester.uid });
      if (ownCollaborator) {
        const managedAssignments = await this.assignmentRepository.find({
          where: { collaboratorId: ownCollaborator.id, role: ProjectCollaboratorRole.MANAGER },
        });
        managedProjectIds = new Set(managedAssignments.map((a) => a.projectId));
      }
    }

    return sinLegado.map((project) => {
      if (managedProjectIds?.has(project.id)) {
        return project;
      }
      const propias =
        ownClientId !== null ? project.billingTerms.filter((t) => t.clientId === ownClientId) : [];
      const vinculado = ownClientId !== null && (project.clientId === ownClientId || propias.length > 0);
      return {
        ...project,
        billingTerms: propias,
        billableConfig: vinculado ? project.billableConfig : null,
      };
    });
  }

  // Alta + asignación de responsables/equipo en una sola transacción: si una
  // asignación referencia un colaborador inexistente, se revierte todo (nunca
  // queda un proyecto "huérfano" guardado sin sus asignaciones).
  async create(dto: CreateProjectDto): Promise<ProjectResponse> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Falta el nombre del proyecto.');
    }

    return this.projectRepository.manager.transaction(async (manager) => {
      const project = manager.getRepository(ProjectEntity).create({
        id: randomUUID(),
        name: dto.name,
        active: dto.active ?? true,
        kind: dto.kind ?? 'cliente',
        clientId: dto.clientId ?? null,
        billableConfig: normalizeBillableConfig(dto.billableConfig),
        jiraConnectionKey: dto.jiraConnectionKey ?? null,
        jiraIds: dto.jiraIds ?? [],
        billableHoursLimit: dto.billableHoursLimit != null ? String(dto.billableHoursLimit) : null,
      });

      this.validarTipo(project);
      const saved = await this.trySave(manager, project, 'crear');

      if (dto.managerIds?.length) {
        await this.replaceRoleAssignments(manager, saved.id, ProjectCollaboratorRole.MANAGER, dto.managerIds);
      }
      if (dto.teamMemberIds?.length) {
        await this.replaceRoleAssignments(manager, saved.id, ProjectCollaboratorRole.TEAM_MEMBER, dto.teamMemberIds);
      }

      return this.withAssignments(saved, manager);
    });
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectResponse> {
    return this.projectRepository.manager.transaction(async (manager) => {
      const existing = await this.findEntity(manager, id);

      if (dto.name !== undefined) existing.name = dto.name;
      if (dto.active !== undefined) existing.active = dto.active;
      if (dto.kind !== undefined) existing.kind = dto.kind;
      if (dto.clientId !== undefined) existing.clientId = dto.clientId;
      // Un producto o un interno no tiene dueño: cambiar el tipo lo saca solo.
      if (existing.kind !== 'cliente' && dto.clientId === undefined) existing.clientId = null;
      this.validarTipo(existing);
      if (dto.billableConfig !== undefined) existing.billableConfig = normalizeBillableConfig(dto.billableConfig);
      if (dto.jiraConnectionKey !== undefined) existing.jiraConnectionKey = dto.jiraConnectionKey || null;
      if (dto.jiraIds !== undefined) existing.jiraIds = dto.jiraIds;
      if (dto.billableHoursLimit !== undefined) {
        existing.billableHoursLimit = dto.billableHoursLimit == null ? null : String(dto.billableHoursLimit);
      }

      const saved = await this.trySave(manager, existing, 'actualizar');

      if (dto.managerIds !== undefined) {
        await this.replaceRoleAssignments(manager, id, ProjectCollaboratorRole.MANAGER, dto.managerIds);
      }
      if (dto.teamMemberIds !== undefined) {
        await this.replaceRoleAssignments(manager, id, ProjectCollaboratorRole.TEAM_MEMBER, dto.teamMemberIds);
      }

      return this.withAssignments(saved, manager);
    });
  }

  // La configuración de horas facturables la ajustan admin y contable (BillableAdjustForm.tsx).
  async updateBillableConfig(id: string, config: unknown): Promise<ProjectResponse> {
    const existing = await this.findEntity(this.projectRepository.manager, id);
    existing.billableConfig = normalizeBillableConfig(config);
    const saved = await this.projectRepository.save(existing);
    return this.withAssignments(saved);
  }

  async remove(id: string): Promise<void> {
    try {
      const result = await this.projectRepository.delete({ id });
      if (result.affected === 0) {
        throw new NotFoundException('Proyecto no encontrado.');
      }
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          'No se puede eliminar: el proyecto tiene horas cargadas. Desactivalo en su lugar.',
        );
      }
      throw error;
    }
  }

  // Un proyecto de cliente tiene dueño; un producto o un interno, no (sus horas son propias y
  // lo que se cobra sale de las condiciones de cobro).
  private validarTipo(project: ProjectEntity): void {
    if (!PROJECT_KINDS.includes(project.kind)) {
      throw new BadRequestException('El tipo de proyecto debe ser cliente, producto o interno.');
    }
    if (project.kind === 'cliente' && !project.clientId) {
      throw new BadRequestException('Elegí el cliente del proyecto.');
    }
    if (project.kind !== 'cliente' && project.clientId) {
      throw new BadRequestException('Un producto o un proyecto interno no tiene cliente dueño.');
    }
  }

  private async findEntity(manager: EntityManager, id: string): Promise<ProjectEntity> {
    const found = await manager.getRepository(ProjectEntity).findOneBy({ id });
    if (!found) {
      throw new NotFoundException('Proyecto no encontrado.');
    }
    return found;
  }

  private async withAssignments(project: ProjectEntity, manager?: EntityManager): Promise<ProjectResponse> {
    const assignmentRepo = manager ? manager.getRepository(ProjectCollaboratorEntity) : this.assignmentRepository;
    const deliverableRepo = manager ? manager.getRepository(ProjectDeliverableEntity) : this.deliverableRepository;
    const termRepo = manager ? manager.getRepository(ProjectBillingTermEntity) : this.termRepository;
    const [assignments, deliverables, terms] = await Promise.all([
      assignmentRepo.find({ where: { projectId: project.id } }),
      deliverableRepo.find({ where: { projectId: project.id }, order: { dueDate: 'ASC' } }),
      termRepo.find({ where: { projectId: project.id }, order: { desde: 'ASC' } }),
    ]);
    return {
      ...project,
      managerIds: assignments.filter((a) => a.role === ProjectCollaboratorRole.MANAGER).map((a) => a.collaboratorId),
      teamMemberIds: assignments
        .filter((a) => a.role === ProjectCollaboratorRole.TEAM_MEMBER)
        .map((a) => a.collaboratorId),
      deliverables: deliverables.map((d) => ({ id: d.id, name: d.name, dueDate: d.dueDate })),
      billingTerms: terms.map(condicionDeEntidad),
    };
  }

  // Reemplaza de una todos los entregables de un proyecto (mismo patrón que
  // replaceRoleAssignments: el form manda la lista completa, acá se borra y se
  // reinserta todo junto).
  async replaceDeliverables(id: string, deliverables: ProjectDeliverableDto[]): Promise<ProjectResponse> {
    await this.findEntity(this.projectRepository.manager, id); // 404 si no existe

    for (const deliverable of deliverables) {
      if (!deliverable.name?.trim()) {
        throw new BadRequestException('Cada entregable necesita un nombre.');
      }
      if (!deliverable.dueDate || Number.isNaN(new Date(deliverable.dueDate).getTime())) {
        throw new BadRequestException('Cada entregable necesita una fecha válida.');
      }
    }

    await this.projectRepository.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ProjectDeliverableEntity);
      await repo.delete({ projectId: id });

      if (!deliverables.length) return;

      const rows = deliverables.map((deliverable) =>
        repo.create({
          id: randomUUID(),
          projectId: id,
          name: deliverable.name.trim(),
          dueDate: deliverable.dueDate,
        }),
      );
      await repo.save(rows);
    });

    return this.findOne(id);
  }

  private async replaceRoleAssignments(
    manager: EntityManager,
    projectId: string,
    role: ProjectCollaboratorRole,
    collaboratorIds: string[],
  ): Promise<void> {
    const repo = manager.getRepository(ProjectCollaboratorEntity);
    await repo.delete({ projectId, role });
    const uniqueIds = [...new Set(collaboratorIds)];
    if (!uniqueIds.length) return;

    try {
      const rows = uniqueIds.map((collaboratorId) => repo.create({ projectId, collaboratorId, role }));
      await repo.save(rows);
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        const label = role === ProjectCollaboratorRole.MANAGER ? 'responsable' : 'integrante del equipo';
        throw new BadRequestException(`Uno de los colaboradores asignados como ${label} no existe.`);
      }
      throw error;
    }
  }

  private async trySave(
    manager: EntityManager,
    project: ProjectEntity,
    action: 'crear' | 'actualizar',
  ): Promise<ProjectEntity> {
    try {
      return await manager.getRepository(ProjectEntity).save(project);
    } catch (error) {
      if (this.isForeignKeyViolation(error)) {
        throw new BadRequestException(`No se pudo ${action} el proyecto: el cliente asignado no existe.`);
      }
      throw error;
    }
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23503';
  }
}
