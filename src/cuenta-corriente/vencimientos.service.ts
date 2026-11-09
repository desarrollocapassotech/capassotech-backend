import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { CcDueReminderEntity, CollaboratorEntity, UserRole } from '../database/entities';
import { CuentaCorrienteService, hoyArgentina } from './cuenta-corriente.service';
import { buildVencimientosHtml, vencimientosSubject } from './vencimientos-notification.template';

// Aviso interno de vencimientos de la cuenta corriente: el día en que vence un cargo (cobro a un
// cliente o pago a un colaborador) y sigue con algo pendiente, un solo email con todos los del día
// a los admin y contables activos. No le llega nada al cliente ni al colaborador.
//
// Corre una vez por día a las 9 de Argentina. La tabla cc_due_reminders garantiza un solo aviso
// por (cargo, vencimiento) aunque el cron se dispare dos veces (por ejemplo, durante un deploy).
//
// Solo manda desde producción: QA tiene su propia base (copia de producción) y el backend local
// apunta a la de producción, así que sin esto los mismos avisos saldrían repetidos. Se decide con
// CC_DUE_REMINDERS_ENABLED ('true'/'false') o, si no está, con la rama que despliega Render
// (RENDER_GIT_BRANCH === 'main').
@Injectable()
export class VencimientosService {
  private readonly logger = new Logger(VencimientosService.name);
  private running = false;

  constructor(
    @InjectRepository(CcDueReminderEntity)
    private readonly avisos: Repository<CcDueReminderEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly colaboradores: Repository<CollaboratorEntity>,
    private readonly cc: CuentaCorrienteService,
    private readonly resend: ResendService,
    private readonly configService: ConfigService,
  ) {}

  isEnabled(): boolean {
    const flag = this.configService.get<string>('CC_DUE_REMINDERS_ENABLED');
    if (flag !== undefined && flag !== '') return flag.toLowerCase() === 'true';
    return this.configService.get<string>('RENDER_GIT_BRANCH') === 'main';
  }

  @Cron('0 9 * * *', { name: 'cc-due-reminders', timeZone: 'America/Argentina/Buenos_Aires' })
  async avisarVencimientos(fecha: string = hoyArgentina()): Promise<{ sent: number }> {
    if (!this.isEnabled() || this.running) return { sent: 0 };
    this.running = true;
    try {
      const cargos = await this.cc.cargosQueVencen(fecha);
      if (!cargos.length) return { sent: 0 };

      const destinatarios = [
        ...new Set(
          (await this.colaboradores.find())
            .filter((c) => c.active && (c.roles.includes(UserRole.ADMIN) || c.roles.includes(UserRole.CONTABLE)))
            .map((c) => c.workEmail ?? c.personalEmail)
            .filter((email): email is string => !!email),
        ),
      ];
      if (!destinatarios.length) {
        this.logger.warn('Vencimientos de la cuenta corriente: no hay admin ni contable con email configurado; se omite el aviso.');
        return { sent: 0 };
      }

      // Se reserva cada aviso ANTES de mandarlo (la PK actúa de lock): lo que ya reservó otra
      // instancia no se repite. Si el email no sale, se liberan las reservas.
      const reservados: typeof cargos = [];
      for (const cargo of cargos) {
        try {
          await this.avisos.insert({ movementId: cargo.id, dueDate: fecha });
          reservados.push(cargo);
        } catch (error) {
          if (!this.isUniqueViolation(error)) throw error;
        }
      }
      if (!reservados.length) return { sent: 0 };

      let sent = false;
      try {
        sent = await this.resend.send({
          to: destinatarios,
          subject: vencimientosSubject(reservados),
          html: buildVencimientosHtml(fecha, reservados, this.urlFrontend()),
        });
      } catch (error) {
        this.logger.error(`No se pudo mandar el aviso de vencimientos: ${(error as Error).message}`);
      }
      if (!sent) {
        for (const cargo of reservados) {
          await this.avisos.delete({ movementId: cargo.id, dueDate: fecha });
        }
        return { sent: 0 };
      }
      return { sent: reservados.length };
    } catch (error) {
      this.logger.error(`No se pudieron revisar los vencimientos de la cuenta corriente: ${(error as Error).message}`);
      return { sent: 0 };
    } finally {
      this.running = false;
    }
  }

  /** Dónde está el panel, para los links del email. */
  private urlFrontend(): string {
    return this.configService.get<string>('FRONTEND_PUBLIC_URL') || 'https://tracker.capasso.tech';
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
  }
}
