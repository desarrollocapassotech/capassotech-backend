import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { BirthdayReminderEntity, CollaboratorEntity, UserRole } from '../database/entities';
import { birthdayReminderSubject, buildBirthdayReminderHtml } from './birthday-reminder-notification.template';
import { nextBirthday, REMINDER_DAYS_BEFORE, todayInArgentina } from './birthday-reminders.dates';

// Avisa por email al Super Admin (rol admin) y al contador (rol contable) 3, 2 y
// 1 días antes del cumpleaños de cada colaborador activo, y el mismo día.
//
// Corre una vez por día a las 9 de Argentina. La tabla birthday_reminders
// garantiza un solo email por (colaborador, cumpleaños, días antes) aunque el
// cron se dispare dos veces (por ejemplo, durante un deploy con dos instancias).
//
// Solo manda desde producción: QA tiene su propia base (copia de producción), así
// que sin esto los mismos avisos saldrían dos veces. Se decide con
// BIRTHDAY_REMINDERS_ENABLED ('true'/'false') o, si no está, con la rama que
// despliega Render (RENDER_GIT_BRANCH === 'main').
@Injectable()
export class BirthdayRemindersService {
  private readonly logger = new Logger(BirthdayRemindersService.name);
  private running = false;

  constructor(
    @InjectRepository(BirthdayReminderEntity)
    private readonly reminderRepository: Repository<BirthdayReminderEntity>,
    @InjectRepository(CollaboratorEntity)
    private readonly collaboratorRepository: Repository<CollaboratorEntity>,
    private readonly resendService: ResendService,
    private readonly configService: ConfigService,
  ) {}

  isEnabled(): boolean {
    const flag = this.configService.get<string>('BIRTHDAY_REMINDERS_ENABLED');
    if (flag !== undefined && flag !== '') return flag.toLowerCase() === 'true';
    return this.configService.get<string>('RENDER_GIT_BRANCH') === 'main';
  }

  @Cron('0 9 * * *', { name: 'birthday-reminders', timeZone: 'America/Argentina/Buenos_Aires' })
  async sendDueReminders(now: Date = new Date()): Promise<{ sent: number }> {
    if (!this.isEnabled() || this.running) {
      return { sent: 0 };
    }
    this.running = true;
    try {
      const today = todayInArgentina(now);
      const collaborators = await this.collaboratorRepository.find();
      const watchers = collaborators.filter(
        (collaborator) =>
          collaborator.active && (collaborator.roles.includes(UserRole.ADMIN) || collaborator.roles.includes(UserRole.CONTABLE)),
      );

      let sent = 0;
      for (const collaborator of collaborators) {
        if (!collaborator.active || !collaborator.birthDate) continue;
        const { birthday, daysUntil, age } = nextBirthday(collaborator.birthDate, today);
        if (!(REMINDER_DAYS_BEFORE as readonly number[]).includes(daysUntil)) continue;

        // El cumpleañero no recibe su propio aviso aunque sea admin o contable.
        const recipients = [
          ...new Set(
            watchers
              .filter((watcher) => watcher.id !== collaborator.id)
              .map((watcher) => watcher.workEmail ?? watcher.personalEmail)
              .filter((email): email is string => !!email),
          ),
        ];
        if (recipients.length === 0) {
          this.logger.warn(`Cumpleaños de ${collaborator.name}: no hay admin ni contable con email configurado; se omite el aviso.`);
          continue;
        }

        if (await this.notify(collaborator, birthday, daysUntil, age, recipients)) sent += 1;
      }
      return { sent };
    } catch (error) {
      this.logger.error(`No se pudieron revisar los cumpleaños: ${(error as Error).message}`);
      return { sent: 0 };
    } finally {
      this.running = false;
    }
  }

  // Se reserva el aviso ANTES de mandarlo (la PK actúa de lock, igual que en
  // HoursAlertsService). Si el email no sale, se libera la reserva: ese aviso se
  // pierde, pero el del día siguiente sale igual.
  private async notify(collaborator: CollaboratorEntity, birthday: string, daysUntil: number, age: number, recipients: string[]): Promise<boolean> {
    const key = { collaboratorId: collaborator.id, birthday, daysBefore: daysUntil };
    try {
      await this.reminderRepository.insert(key);
    } catch (error) {
      if (this.isUniqueViolation(error)) return false;
      throw error;
    }

    let sent = false;
    try {
      const [year, month, day] = birthday.split('-');
      const rows: [string, string][] = [
        ['Colaborador', collaborator.name],
        ['Fecha', `${day}/${month}/${year}`],
        ['Cumple', `${age} años`],
      ];
      sent = await this.resendService.send({
        to: recipients,
        subject: birthdayReminderSubject(collaborator.name, daysUntil),
        html: buildBirthdayReminderHtml(collaborator.name, daysUntil, rows),
      });
    } catch (error) {
      this.logger.error(`No se pudo mandar el aviso de cumpleaños de ${collaborator.name}: ${(error as Error).message}`);
    }

    if (!sent) {
      await this.reminderRepository.delete(key);
    }
    return sent;
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
  }
}
