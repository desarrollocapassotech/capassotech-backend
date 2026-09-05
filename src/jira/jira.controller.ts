import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JiraService } from './jira.service';

// Todo autenticado puede consultar un issue (lo usa TimeEntryForm.tsx al cargar
// horas), pero la lista de conexiones (con sus baseUrl) queda admin-only: es
// configuración interna, no algo que un colaborador/cliente necesite ver.
@UseGuards(FirebaseAuthGuard)
@Controller('jira')
export class JiraController {
  constructor(private readonly jiraService: JiraService) {}

  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('connections')
  listConnections() {
    return this.jiraService.listConnections();
  }

  // found:false (200) significa "sin Jira configurado para este proyecto", un
  // caso esperado que el frontend no debe tratar como error. Un issue que no
  // existe en Jira, o credenciales inválidas, sí llegan como excepción HTTP.
  @Get('issues/:issueKey')
  async getIssue(@Param('issueKey') issueKey: string, @Query('projectId') projectId?: string) {
    if (!projectId) {
      throw new BadRequestException('Falta projectId.');
    }
    const issue = await this.jiraService.getIssueForProject(projectId, issueKey);
    return issue ? { found: true, issue } : { found: false };
  }
}
