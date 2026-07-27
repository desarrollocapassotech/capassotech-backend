import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import {
  ClientEntity,
  CollaboratorEntity,
  ProjectCollaboratorRole,
  ProjectEntity,
  ProjectDeliverableEntity,
} from '../database/entities';
import { ProjectCollaboratorEntity } from '../database/entities';
import { UserRole } from '../auth/auth.types';
import { CreateProjectDto, ProjectDeliverableDto, UpdateProjectDto } from './projects.dto';

export interface ProjectResponse extends ProjectEntity {
  managerIds: string[];
  teamMemberIds: string[];
  deliverables: (ProjectDeliverableDto & { id: string })[];
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
  ) {}

  async findAll(): Promise<ProjectResponse[]> {
    const projects = await this.projectRepository.find({ order: { name: 'ASC' } });
    const [assignments, deliverables] = await Promise.all([
      this.assignmentRepository.find(),
      this.deliverableRepository.find({ order: { dueDate: 'ASC' } }),
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
    }));
  }

  async findOne(id: string): Promise<ProjectResponse> {
    const project = await this.findEntity(this.projectRepository.manager, id);
    return this.withAssignments(project);
  }

  // GET /projects y GET /projects/:id quedan abiertos a cualquier autenticado
  // (carga de horas, historial de clientes, panel de PM/QA), pero eso no debe
  // filtrar cuánto le cobramos a un cliente a colaboradores/PM/QA, ni el rate de
  // OTROS clientes a un cliente logueado. Ven estos campos sin enmascarar:
  // admin, contable, el propio cliente sobre sus propios proyectos
  // (ClientPanel.tsx/ClientHistory.tsx necesitan rate/currency para mostrar sus
  // horas facturables), y un project_manager sobre los proyectos que gestiona
  // (ProjectManagerPanel.tsx necesita rate/currency para calcular las horas
  // facturables de su equipo vía calculateBillableHours en el frontend).
  async maskRatesForRequester(projects: ProjectResponse[], requester: RequesterContext): Promise<ProjectResponse[]> {
    const isPrivileged = requester.roles.includes(UserRole.ADMIN) || requester.roles.includes(UserRole.CONTABLE);
    if (isPrivileged) {
      return projects;
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

    return projects.map((project) => {
      if (ownClientId !== null && project.clientId === ownClientId) {
        return project;
      }
      if (managedProjectIds?.has(project.id)) {
        return project;
      }
      const { rate: _rate, currency: _currency, ...masked } = project;
      return masked as ProjectResponse;
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
        rate: dto.rate != null ? String(dto.rate) : null,
        currency: dto.currency ?? null,
        billingType: dto.billingType ?? null,
        clientId: dto.clientId ?? null,
        jiraIds: dto.jiraIds ?? [],
        billableHoursLimit: dto.billableHoursLimit != null ? String(dto.billableHoursLimit) : null,
      });

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
      if (dto.rate !== undefined) existing.rate = dto.rate == null ? null : String(dto.rate);
      if (dto.currency !== undefined) existing.currency = dto.currency;
      if (dto.billingType !== undefined) existing.billingType = dto.billingType;
      if (dto.clientId !== undefined) existing.clientId = dto.clientId;
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
    const [assignments, deliverables] = await Promise.all([
      assignmentRepo.find({ where: { projectId: project.id } }),
      deliverableRepo.find({ where: { projectId: project.id }, order: { dueDate: 'ASC' } }),
    ]);
    return {
      ...project,
      managerIds: assignments.filter((a) => a.role === ProjectCollaboratorRole.MANAGER).map((a) => a.collaboratorId),
      teamMemberIds: assignments
        .filter((a) => a.role === ProjectCollaboratorRole.TEAM_MEMBER)
        .map((a) => a.collaboratorId),
      deliverables: deliverables.map((d) => ({ id: d.id, name: d.name, dueDate: d.dueDate })),
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
