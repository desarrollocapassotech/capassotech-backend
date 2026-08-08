import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { ClientHoursAlertEntity, CollaboratorEntity, ProjectCollaboratorEntity, ProjectCollaboratorRole, UserRole } from '../database/entities';
import { NotifyHighHoursDto } from './hours-alerts.dto';
import { buildHighHoursAlertHtml } from './hours-alert-notification.template';

@Injectable()
export class HoursAlertsService {
  private readonly logger = new Logger(HoursAlertsService.name);

  constructor(
    @InjectRepository(ClientHoursAlertEntity)
    private readonly alertRepository: Repository<ClientHoursAlertEntity>,
    @InjectRepository(ProjectCollaboratorEntity)
    private readonly projectCollaboratorRepository: Repository<ProjectCollaboratorEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    private readonly resendService: ResendService,
  ) {}

  // Un solo email por (cliente, mes): el dashboard del PM recalcula el estado "en
  // rojo" en cada render, así que esto se puede llamar muchas veces para el mismo
  // cliente en el mismo mes. Se inserta la fila de dedup ANTES de mandar el email
  // (la PK compuesta actúa de lock) para que dos requests casi simultáneas no manden
  // el mismo aviso dos veces.
  async notifyIfNew(clientId: string, dto: NotifyHighHoursDto): Promise<{ sent: boolean }> {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    try {
      await this.alertRepository.insert({ clientId, year, month });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        return { sent: false };
      }
      throw error;
    }

    try {
      // Destinatarios: el/los PM de los proyectos de este cliente + todos los admin
      // (Super Admin), igual criterio que ExpensesService.notifyExpenseWatchers.
      const projectIds = dto.projects.map((project) => project.id);
      const [managerAssignments, collaborators] = await Promise.all([
        this.projectCollaboratorRepository.find({
          where: { projectId: In(projectIds), role: ProjectCollaboratorRole.MANAGER },
        }),
        this.collaboratorRepository.find(),
      ]);
      const managerIds = new Set(managerAssignments.map((assignment) => assignment.collaboratorId));
      const watchers = collaborators.filter((collaborator) => managerIds.has(collaborator.id) || collaborator.roles.includes(UserRole.ADMIN));
      const recipients = [...new Set(watchers.map((watcher) => watcher.workEmail ?? watcher.personalEmail).filter((email): email is string => !!email))];
      if (recipients.length === 0) {
        this.logger.warn(`Cliente ${clientId}: horas muy altas pero no hay PM ni admin con email configurado; se omite la notificación.`);
        return { sent: false };
      }

      const rows: [string, string][] = [
        ['Cliente', dto.clientName],
        ['Horas facturables', dto.billableHours.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })],
        ['Límite mensual', dto.limit.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })],
        ['Avance', `${Math.round(dto.percent)}%`],
        ['Proyectos', dto.projects.map((project) => project.name).join(', ') || '-'],
      ];
      const html = buildHighHoursAlertHtml(rows);

      await this.resendService.send({ to: recipients, subject: `Horas muy altas: ${dto.clientName}`, html });
      return { sent: true };
    } catch (error) {
      this.logger.error(`No se pudo notificar horas altas del cliente ${clientId}: ${(error as Error).message}`);
      return { sent: false };
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
  }
}
