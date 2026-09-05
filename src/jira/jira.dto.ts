// Una entrada del array JIRA_CONNECTIONS (env var, JSON): un site de Jira y las
// credenciales de un usuario/bot con acceso de lectura sobre sus proyectos.
export interface JiraConnection {
  key: string;
  baseUrl: string;
  email: string;
  apiToken: string;
}

// Lo que expone GET /jira/connections (solo admin): nunca el apiToken.
export interface JiraConnectionSummary {
  key: string;
  baseUrl: string;
}

export interface JiraIssueSummary {
  key: string;
  summary: string;
  issueType: string | null;
  status: string | null;
  /** "Story point estimate" del issue, si el proyecto de Jira usa ese campo. */
  storyPoints: number | null;
}
