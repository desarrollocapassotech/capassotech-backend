import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// tracker.birthday_reminders: un registro por aviso de cumpleaños ya mandado
// (colaborador, fecha del cumpleaños, días que faltaban). Evita repetir el email
// si el cron corre más de una vez el mismo día o el server se reinicia.
@Entity({ name: 'birthday_reminders', schema: 'tracker' })
export class BirthdayReminderEntity {
  @PrimaryColumn({ name: 'collaborator_id', type: 'text' })
  collaboratorId: string;

  @PrimaryColumn({ name: 'birthday', type: 'date' })
  birthday: string;

  @PrimaryColumn({ name: 'days_before', type: 'int' })
  daysBefore: number;

  @CreateDateColumn({ name: 'notified_at', type: 'timestamptz' })
  notifiedAt: Date;
}
