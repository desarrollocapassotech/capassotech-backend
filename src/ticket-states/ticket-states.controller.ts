import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { TicketStatesService } from './ticket-states.service';
import type { CreateTicketStateDto } from './ticket-states.dto';

// Gateado a nivel de método (no de controller) porque, a diferencia de
// tickets/, acá todas las rutas son del panel de soporte: no hay flujo
// público de cliente que necesite pegarle a /ticket-states.
// No existe un rol "soporte" dedicado todavía (ver auth/auth.types.ts), así
// que por ahora alcanza con estar logueado (colaborador o admin) — mismo
// criterio que ClientsController.findAll.
@Controller('ticket-states')
export class TicketStatesController {
  constructor(private readonly ticketStatesService: TicketStatesService) {}

  @UseGuards(FirebaseAuthGuard)
  @Get()
  findAll() {
    return this.ticketStatesService.findAll();
  }

  // Acción "agregar nuevo estado" del tablero Kanban: el estado se agrega al
  // final (orden = max + 1), no se soporta reordenar/editar/borrar todavía.
  @UseGuards(FirebaseAuthGuard)
  @Post()
  create(@Body() body: CreateTicketStateDto) {
    return this.ticketStatesService.create(body);
  }
}
