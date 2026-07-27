import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketStateEntity } from '../database/entities';
import { CreateTicketStateDto } from './ticket-states.dto';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

@Injectable()
export class TicketStatesService {
  constructor(
    @InjectRepository(TicketStateEntity)
    private readonly ticketStateRepository: Repository<TicketStateEntity>,
  ) {}

  findAll(): Promise<TicketStateEntity[]> {
    return this.ticketStateRepository.find({ order: { orden: 'ASC' } });
  }

  async getDefault(): Promise<TicketStateEntity> {
    const defaultState = await this.ticketStateRepository.findOneBy({ esDefault: true });
    if (defaultState) {
      return defaultState;
    }
    // No debería pasar (el seed siempre define uno), pero si alguien lo borró
    // a mano en la base, se usa el primero por orden en vez de romper la
    // creación de tickets.
    const [first] = await this.ticketStateRepository.find({ order: { orden: 'ASC' }, take: 1 });
    if (!first) {
      throw new InternalServerErrorException('No hay estados de ticket configurados.');
    }
    return first;
  }

  async existsById(id: string): Promise<boolean> {
    const count = await this.ticketStateRepository.countBy({ id });
    return count > 0;
  }

  async create(dto: CreateTicketStateDto): Promise<TicketStateEntity> {
    const nombre = dto.nombre?.trim();
    const color = dto.color?.trim();

    if (!nombre) {
      throw new BadRequestException('El nombre del estado es obligatorio.');
    }
    if (!color || !HEX_COLOR_RE.test(color)) {
      throw new BadRequestException('El color debe ser un hex válido, ej. #3b82f6.');
    }

    const id = await this.generateUniqueId(nombre);
    const raw = await this.ticketStateRepository
      .createQueryBuilder('ticket_state')
      .select('MAX(ticket_state.orden)', 'max')
      .getRawOne<{ max: number | null }>();

    const state = new TicketStateEntity();
    state.id = id;
    state.nombre = nombre;
    state.color = color;
    state.orden = (raw?.max ?? -1) + 1;
    state.esDefault = false;

    return this.ticketStateRepository.save(state);
  }

  private async generateUniqueId(nombre: string): Promise<string> {
    const base =
      nombre
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '') // quita tildes (á -> a + combining acute)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'estado';

    let candidate = base;
    let attempt = 1;
    while (await this.existsById(candidate)) {
      attempt += 1;
      candidate = `${base}_${attempt}`;
    }
    return candidate;
  }
}
