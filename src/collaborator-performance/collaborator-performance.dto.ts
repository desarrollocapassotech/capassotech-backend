export interface QuarterMetricDto {
  year: number;
  quarter: number;
  /** ej: "2025-Q3" */
  label: string;
  hours: number;
  revenueUsd: number;
  costUsd: number;
  marginUsd: number;
  outlierTaskCount: number;
}

export interface OutlierTaskDto {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string | null;
  quarterLabel: string;
  /** Fecha (yyyy-MM-dd) del último time_entry cargado para esta tarea. */
  lastDate: string;
  totalHours: number;
  /** 'jira_estimate': se comparó contra story_points reales. 'group_median': fallback estadístico (mediana del grupo). */
  method: 'jira_estimate' | 'group_median';
  baselineHours: number;
  deviationRatio: number;
  /** Comentario de justificación que el colaborador ya carga cuando supera el estimado de Jira (ver TimeEntryForm.tsx). */
  justificationComment: string | null;
}

export interface CollaboratorPerformanceResponseDto {
  collaboratorId: string;
  collaboratorName: string;
  currency: 'USD';
  quarters: QuarterMetricDto[];
  outlierTasks: OutlierTaskDto[];
}
