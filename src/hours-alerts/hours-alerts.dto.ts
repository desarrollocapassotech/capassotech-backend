// El backend no recalcula "horas facturables" (eso implica portar la lógica de
// markup del frontend: config de facturación por cliente, tipo de tarea, tipo de
// cambio, etc.). El frontend ya la calcula para pintar la barra de progreso en rojo
// y manda acá el resultado tal cual, junto con qué proyectos la componen (para
// resolver a qué PM avisar) y el nombre del cliente (para el asunto/cuerpo del mail).
export interface NotifyHighHoursDto {
  clientName: string;
  projects: { id: string; name: string }[];
  billableHours: number;
  limit: number;
  percent: number;
}
