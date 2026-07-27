import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { ClientEntity, TicketAttachmentEntity, TicketEntity, TicketMessageEntity } from '../database/entities';
import { AuthService } from '../auth/auth.service';
import { TicketStatesService } from '../ticket-states/ticket-states.service';
// import { MailService } from '../common/mail.service'; // deshabilitado: SMTP_HOST no está configurado en Render, rompía el boot del backend
import { CreateTicketDto, CreateTicketMessageDto, FindTicketsQueryDto, TicketClientProfileDto, UpdateTicketDto } from './tickets.dto';
import { TicketEmpresa, TicketPriority, TicketOrigin, TicketMessageAuthor } from './ticket.enums';

@Injectable()
export class TicketsService {
  private readonly supportEmails: string[];
  private readonly fromEmail: string;

  constructor(
    @InjectRepository(TicketEntity)
    private readonly ticketRepository: Repository<TicketEntity>,
    @InjectRepository(TicketMessageEntity)
    private readonly messageRepository: Repository<TicketMessageEntity>,
    @InjectRepository(TicketAttachmentEntity)
    private readonly attachmentRepository: Repository<TicketAttachmentEntity>,
    @InjectRepository(ClientEntity)
    private readonly clientRepository: Repository<ClientEntity>,
    private readonly authService: AuthService,
    private readonly ticketStatesService: TicketStatesService,
    // private readonly mailService: MailService, // deshabilitado: SMTP_HOST no está configurado en Render
    private readonly configService: ConfigService,
  ) {
    this.supportEmails = this.parseSupportEmails();
    this.fromEmail = this.configService.get<string>('TICKET_FROM_EMAIL') ?? 'ticketera@capassotech.local';
  }

  async createTicket(dto: CreateTicketDto, authToken?: string): Promise<TicketEntity> {
    this.validateCreateTicketDto(dto);

    const ticket = new TicketEntity();
    ticket.id = randomUUID();
    ticket.codigo = await this.generateUniqueCode();
    ticket.empresa = dto.empresa;
    ticket.sistema = dto.sistema.trim();
    ticket.asunto = dto.asunto.trim();
    ticket.descripcion = dto.descripcion.trim();
    ticket.prioridad = dto.prioridad;
    ticket.estado = (await this.ticketStatesService.getDefault()).id;
    ticket.origen = dto.origen;
    ticket.clienteNombre = dto.clienteNombre.trim();
    ticket.clienteEmail = dto.clienteEmail.trim();
    ticket.clientId = null;
    ticket.asignadoA = null;
    ticket.mensajes = [];
    ticket.adjuntos = [];

    if (authToken) {
      const user = await this.authService.verifyIdToken(authToken);
      const client = await this.clientRepository.findOne({ where: { userId: user.uid } });
      if (client) {
        ticket.clientId = client.id;
      }
    }

    if (!ticket.clientId) {
      const clientByEmail = await this.clientRepository.findOne({ where: { email: ticket.clienteEmail } });
      if (clientByEmail) {
        ticket.clientId = clientByEmail.id;
      }
    }

    const saved = await this.ticketRepository.save(ticket);

    // Notificación por email deshabilitada: SMTP_HOST no está configurado en Render.
    // try {
    //   await this.sendTicketEmails(saved);
    // } catch (error) {
    //   throw new InternalServerErrorException(
    //     'El ticket se creó, pero no se pudo notificar por email. Revisá la configuración de correo.',
    //   );
    // }

    return saved;
  }

  async findByCode(codigo: string): Promise<TicketEntity> {
    const ticket = await this.ticketRepository.findOne({
      where: { codigo },
      relations: { mensajes: true, adjuntos: true },
      order: { mensajes: { creadoEn: 'ASC' } },
    });
    if (!ticket) {
      throw new NotFoundException('Ticket no encontrado.');
    }
    return ticket;
  }

  // Listado del tablero Kanban del panel de soporte, con filtros opcionales.
  findAll(filtros: FindTicketsQueryDto): Promise<TicketEntity[]> {
    const where: Record<string, string> = {};
    if (filtros.empresa) where.empresa = filtros.empresa;
    if (filtros.sistema) where.sistema = filtros.sistema;
    if (filtros.prioridad) where.prioridad = filtros.prioridad;
    if (filtros.estado) where.estado = filtros.estado;

    return this.ticketRepository.find({ where, order: { createdAt: 'DESC' } });
  }

  // Usado por el drag & drop del tablero (cambio de columna = cambio de
  // estado) y, a futuro, por la asignación de un agente al ticket.
  async updateStatus(id: string, dto: UpdateTicketDto): Promise<TicketEntity> {
    const ticket = await this.ticketRepository.findOneBy({ id });
    if (!ticket) {
      throw new NotFoundException('Ticket no encontrado.');
    }

    if (dto.estado !== undefined) {
      const estadoExiste = await this.ticketStatesService.existsById(dto.estado);
      if (!estadoExiste) {
        throw new BadRequestException('El estado indicado no existe.');
      }
      ticket.estado = dto.estado;
    }

    if (dto.asignadoA !== undefined) {
      ticket.asignadoA = dto.asignadoA;
    }

    return this.ticketRepository.save(ticket);
  }

  async createMessageAsClient(codigo: string, dto: CreateTicketMessageDto): Promise<TicketEntity> {
    if (!dto.mensaje?.trim()) {
      throw new BadRequestException('El mensaje es obligatorio.');
    }

    const ticket = await this.findByCode(codigo);
    const message = new TicketMessageEntity();
    message.id = randomUUID();
    message.ticket = ticket;
    message.ticketId = ticket.id;
    message.autor = TicketMessageAuthor.CLIENTE;
    message.autorNombre = ticket.clienteNombre || null;
    message.mensaje = dto.mensaje.trim();

    await this.messageRepository.save(message);

    return this.findByCode(codigo);
  }

  async findClientProfileByEmail(email: string): Promise<TicketClientProfileDto> {
    const normalized = email.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('El email es obligatorio.');
    }

    const client = await this.clientRepository.findOne({ where: { email: normalized } });
    if (!client) {
      throw new NotFoundException('Perfil de cliente no encontrado.');
    }

    return {
      email: client.email ?? normalized,
      nombre: client.name,
      empresa: TicketEmpresa.CAPASSOTECH,
    };
  }

  private validateCreateTicketDto(dto: CreateTicketDto) {
    if (!dto.empresa) throw new BadRequestException('La empresa es obligatoria.');
    if (!dto.sistema?.trim()) throw new BadRequestException('El sistema afectado es obligatorio.');
    if (!dto.asunto?.trim()) throw new BadRequestException('El asunto es obligatorio.');
    if (!dto.descripcion?.trim()) throw new BadRequestException('La descripción es obligatoria.');
    if (!dto.prioridad) throw new BadRequestException('La prioridad es obligatoria.');
    if (!dto.clienteNombre?.trim()) throw new BadRequestException('El nombre del cliente es obligatorio.');
    if (!dto.clienteEmail?.trim()) throw new BadRequestException('El email del cliente es obligatorio.');
    if (!dto.origen) throw new BadRequestException('El origen es obligatorio.');
  }

  private async generateUniqueCode(): Promise<string> {
    const year = new Date().getFullYear();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `TCK-${year}-${Math.floor(1000 + Math.random() * 9000)}`;
      const existing = await this.ticketRepository.findOneBy({ codigo: candidate });
      if (!existing) {
        return candidate;
      }
    }
    throw new InternalServerErrorException('No se pudo generar un código de seguimiento único.');
  }

  // Deshabilitado junto con MailService: SMTP_HOST no está configurado en Render.
  // private async sendTicketEmails(ticket: TicketEntity) {
  //   if (this.supportEmails.length === 0) {
  //     throw new InternalServerErrorException('No hay direcciones de soporte configuradas.');
  //   }
  //
  //   const subject = `Nuevo ticket de soporte: ${ticket.codigo}`;
  //   const publicUrl = this.configService.get<string>('TICKET_PUBLIC_URL') ?? 'http://localhost:5173/seguimiento';
  //   const body = [
  //     `Código: ${ticket.codigo}`,
  //     `Empresa: ${ticket.empresa}`,
  //     `Sistema: ${ticket.sistema}`,
  //     `Asunto: ${ticket.asunto}`,
  //     `Descripción: ${ticket.descripcion}`,
  //     `Prioridad: ${ticket.prioridad}`,
  //     `Cliente: ${ticket.clienteNombre} <${ticket.clienteEmail}>`,
  //     `Seguimiento: ${publicUrl}/${ticket.codigo}`,
  //   ].join('\n');
  //
  //   await Promise.all([
  //     this.mailService.sendMail({
  //       from: this.fromEmail,
  //       to: ticket.clienteEmail,
  //       subject,
  //       text: `Gracias por tu reporte. Tu ticket se registró correctamente.\n\n${body}`,
  //     }),
  //     this.mailService.sendMail({
  //       from: this.fromEmail,
  //       to: this.supportEmails,
  //       subject: `Nuevo ticket ${ticket.codigo} - ${ticket.clienteNombre}`,
  //       text: body,
  //     }),
  //   ]);
  // }

  private parseSupportEmails(): string[] {
    const raw = this.configService.get<string>('TICKET_SUPPORT_EMAILS') ?? '';
    return raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
}
