import { TicketEmpresa, TicketOrigin, TicketPriority } from './ticket.enums';

export interface CreateTicketDto {
  empresa: TicketEmpresa;
  sistema: string;
  asunto: string;
  descripcion: string;
  prioridad: TicketPriority;
  clienteNombre: string;
  clienteEmail: string;
  origen: TicketOrigin;
}

export interface CreateTicketMessageDto {
  mensaje: string;
}

export interface FindTicketsQueryDto {
  empresa?: TicketEmpresa;
  sistema?: string;
  prioridad?: TicketPriority;
  estado?: string;
}

export interface UpdateTicketDto {
  estado?: string;
  asignadoA?: string | null;
}

export interface TicketClientProfileDto {
  email: string;
  nombre: string;
  empresa: TicketEmpresa;
  sistemaHabitual?: string;
}
