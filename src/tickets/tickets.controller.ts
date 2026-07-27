import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { TicketsService } from './tickets.service';
import type { CreateTicketDto, CreateTicketMessageDto, FindTicketsQueryDto, UpdateTicketDto } from './tickets.dto';

@Controller()
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post('tickets')
  async createTicket(@Body() body: CreateTicketDto, @Req() req: Request) {
    const authHeader = req.headers.authorization;
    const authToken = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

    return this.ticketsService.createTicket(body, authToken);
  }

  // Listado del tablero Kanban del panel de soporte. No hay rol "soporte"
  // dedicado todavía (ver auth/auth.types.ts), así que alcanza con estar
  // logueado — mismo criterio que ClientsController.findAll.
  @UseGuards(FirebaseAuthGuard)
  @Get('tickets')
  findAll(@Query() query: FindTicketsQueryDto) {
    return this.ticketsService.findAll(query);
  }

  @Get('tickets/track/:codigo')
  findByCode(@Param('codigo') codigo: string) {
    return this.ticketsService.findByCode(codigo);
  }

  // Cambio de estado (drag & drop del tablero) y/o asignación de agente.
  @UseGuards(FirebaseAuthGuard)
  @Patch('tickets/:id')
  updateTicket(@Param('id') id: string, @Body() body: UpdateTicketDto) {
    return this.ticketsService.updateStatus(id, body);
  }

  @Post('tickets/track/:codigo/messages')
  createMessageAsClient(
    @Param('codigo') codigo: string,
    @Body() body: CreateTicketMessageDto,
  ) {
    return this.ticketsService.createMessageAsClient(codigo, body);
  }

  @Get('ticket-client-profiles/:email')
  async findClientProfile(@Param('email') email: string) {
    return this.ticketsService.findClientProfileByEmail(decodeURIComponent(email));
  }
}
