import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientEntity, ProjectEntity } from '../database/entities';
import { JiraConnection, JiraConnectionSummary, JiraIssueSummary } from './jira.dto';

interface JiraApiIssueResponse {
  key: string;
  fields: Record<string, unknown> & {
    summary: string;
    issuetype?: { name?: string };
    status?: { name?: string };
  };
}

interface JiraFieldMetadata {
  id: string;
  name?: string;
  schema?: { custom?: string };
}

// Tipo de custom field que usa Jira para "Story point estimate" (proyectos
// team-managed) o "Story Points" (proyectos company-managed/classic). El id real
// (ej: "customfield_10016") varía por site, por eso se resuelve en runtime en vez
// de hardcodearlo.
const STORY_POINTS_CUSTOM_TYPES = ['com.pyxis.greenhopper.jira:jsw-story-points', 'com.pyxis.greenhopper.jira:gh-story-points'];
const STORY_POINTS_FIELD_NAMES = ['story point estimate', 'story points'];

@Injectable()
export class JiraService {
  private readonly logger = new Logger(JiraService.name);
  private readonly connectionsByKey: Map<string, JiraConnection>;
  // Cache en memoria (vive lo que dure el proceso): el id del custom field de
  // story points no cambia en runtime, no vale la pena resolverlo en cada request.
  private readonly storyPointsFieldByConnection = new Map<string, string | null>();

  constructor(
    configService: ConfigService,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
  ) {
    this.connectionsByKey = this.parseConnections(configService.get<string>('JIRA_CONNECTIONS'));
  }

  listConnections(): JiraConnectionSummary[] {
    return [...this.connectionsByKey.values()].map(({ key, baseUrl }) => ({ key, baseUrl }));
  }

  // Resuelve proyecto -> cliente -> conexión de Jira, y devuelve el issue.
  // Null (en vez de excepción) cuando el proyecto/cliente no tiene Jira
  // configurado: el frontend usa esto para no autocompletar sin romper el form.
  async getIssueForProject(projectId: string, issueKey: string): Promise<JiraIssueSummary | null> {
    const project = await this.projectRepository.findOneBy({ id: projectId });
    if (!project?.clientId) {
      return null;
    }

    const client = await this.clientRepository.findOneBy({ id: project.clientId });
    if (!client?.jiraConnectionKey) {
      return null;
    }

    const connection = this.connectionsByKey.get(client.jiraConnectionKey);
    if (!connection) {
      this.logger.warn(
        `El cliente ${client.id} referencia la conexión Jira "${client.jiraConnectionKey}", que no existe en JIRA_CONNECTIONS.`,
      );
      return null;
    }

    return this.fetchIssue(connection, issueKey);
  }

  private async fetchIssue(connection: JiraConnection, issueKey: string): Promise<JiraIssueSummary> {
    const storyPointsFieldId = await this.resolveStoryPointsFieldId(connection);
    const fields = ['summary', 'issuetype', 'status', storyPointsFieldId].filter((f): f is string => !!f).join(',');
    const url = `${connection.baseUrl.replace(/\/+$/, '')}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${fields}`;
    const basicAuth = Buffer.from(`${connection.email}:${connection.apiToken}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' },
      });
    } catch (error) {
      this.logger.warn(`No se pudo contactar a Jira (${connection.key}): ${(error as Error).message}`);
      throw new BadGatewayException('No se pudo contactar a Jira.');
    }

    if (response.status === 404) {
      throw new NotFoundException('No se encontró esa tarea en Jira.');
    }
    if (response.status === 401 || response.status === 403) {
      this.logger.warn(`Jira (${connection.key}) rechazó las credenciales configuradas (status ${response.status}).`);
      throw new BadGatewayException('Jira rechazó las credenciales configuradas para este cliente.');
    }
    if (!response.ok) {
      throw new BadGatewayException(`Jira respondió con un error (status ${response.status}).`);
    }

    const data = (await response.json()) as JiraApiIssueResponse;
    const storyPointsRaw = storyPointsFieldId ? data.fields[storyPointsFieldId] : null;
    return {
      key: data.key,
      summary: data.fields.summary,
      issueType: data.fields.issuetype?.name ?? null,
      status: data.fields.status?.name ?? null,
      storyPoints: typeof storyPointsRaw === 'number' ? storyPointsRaw : null,
    };
  }

  // Busca, una sola vez por conexión, el id real del custom field de story
  // points en ese site (varía por instancia de Jira). null = el site no tiene
  // ese campo (o no se pudo resolver); el issue simplemente queda sin story points.
  private async resolveStoryPointsFieldId(connection: JiraConnection): Promise<string | null> {
    if (this.storyPointsFieldByConnection.has(connection.key)) {
      return this.storyPointsFieldByConnection.get(connection.key) ?? null;
    }

    const basicAuth = Buffer.from(`${connection.email}:${connection.apiToken}`).toString('base64');
    let fieldId: string | null = null;

    try {
      const response = await fetch(`${connection.baseUrl.replace(/\/+$/, '')}/rest/api/3/field`, {
        headers: { Authorization: `Basic ${basicAuth}`, Accept: 'application/json' },
      });
      if (response.ok) {
        const allFields = (await response.json()) as JiraFieldMetadata[];
        const match = allFields.find(
          (f) =>
            (f.schema?.custom && STORY_POINTS_CUSTOM_TYPES.includes(f.schema.custom)) ||
            STORY_POINTS_FIELD_NAMES.includes((f.name ?? '').toLowerCase()),
        );
        fieldId = match?.id ?? null;
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo resolver el campo de story points para Jira (${connection.key}): ${(error as Error).message}`,
      );
    }

    this.storyPointsFieldByConnection.set(connection.key, fieldId);
    return fieldId;
  }

  private parseConnections(raw: string | undefined): Map<string, JiraConnection> {
    const map = new Map<string, JiraConnection>();
    if (!raw?.trim()) {
      return map;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.error('JIRA_CONNECTIONS no es un JSON válido; la integración con Jira queda deshabilitada.');
      return map;
    }

    if (!Array.isArray(parsed)) {
      this.logger.error('JIRA_CONNECTIONS debe ser un array; la integración con Jira queda deshabilitada.');
      return map;
    }

    for (const entry of parsed as unknown[]) {
      const candidate = entry as Record<string, unknown>;
      if (
        candidate &&
        typeof candidate.key === 'string' &&
        typeof candidate.baseUrl === 'string' &&
        typeof candidate.email === 'string' &&
        typeof candidate.apiToken === 'string'
      ) {
        map.set(candidate.key, candidate as unknown as JiraConnection);
      } else {
        this.logger.warn(`Entrada inválida en JIRA_CONNECTIONS ignorada: ${JSON.stringify(entry)}`);
      }
    }

    return map;
  }
}
