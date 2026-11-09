import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { BirthdayReminderEntity, CollaboratorEntity, UserRole } from '../database/entities';
import { nextBirthday, todayInArgentina } from './birthday-reminders.dates';
import { BirthdayRemindersService } from './birthday-reminders.service';

const collaborator = (overrides: Partial<CollaboratorEntity>): CollaboratorEntity =>
  ({
    id: 'c1',
    name: 'Ana',
    active: true,
    birthDate: null,
    roles: [UserRole.COLABORADOR],
    workEmail: null,
    personalEmail: null,
    ...overrides,
  }) as CollaboratorEntity;

// 10/11/2026 12:00 en Argentina (UTC-3).
const NOW = new Date('2026-11-10T15:00:00Z');

function setup(collaborators: CollaboratorEntity[], env: Record<string, string> = { BIRTHDAY_REMINDERS_ENABLED: 'true' }) {
  const sentKeys = new Set<string>();
  const reminderRepository = {
    insert: jest.fn(async (key: { collaboratorId: string; birthday: string; daysBefore: number }) => {
      const id = `${key.collaboratorId}|${key.birthday}|${key.daysBefore}`;
      if (sentKeys.has(id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
      sentKeys.add(id);
    }),
    delete: jest.fn(async (key: { collaboratorId: string; birthday: string; daysBefore: number }) => {
      sentKeys.delete(`${key.collaboratorId}|${key.birthday}|${key.daysBefore}`);
    }),
  };
  const collaboratorRepository = { find: jest.fn().mockResolvedValue(collaborators) };
  const resend = { send: jest.fn().mockResolvedValue(true) };
  const config = { get: (key: string) => env[key] };
  const service = new BirthdayRemindersService(
    reminderRepository as unknown as Repository<BirthdayReminderEntity>,
    collaboratorRepository as unknown as Repository<CollaboratorEntity>,
    resend as unknown as ResendService,
    config as unknown as ConfigService,
  );
  return { service, resend, reminderRepository };
}

const admin = collaborator({ id: 'admin', name: 'Admin', roles: [UserRole.ADMIN], workEmail: 'admin@capasso.tech' });
const contable = collaborator({ id: 'cont', name: 'Contador', roles: [UserRole.CONTABLE], personalEmail: 'contador@mail.com' });
const pm = collaborator({ id: 'pm', name: 'PM', roles: [UserRole.PROJECT_MANAGER], workEmail: 'pm@capasso.tech' });

describe('nextBirthday', () => {
  it('cuenta los días hasta el cumpleaños de este año', () => {
    expect(nextBirthday('1990-11-13', '2026-11-10')).toEqual({ birthday: '2026-11-13', daysUntil: 3, age: 36 });
  });

  it('el mismo día da 0', () => {
    expect(nextBirthday('1990-11-10', '2026-11-10').daysUntil).toBe(0);
  });

  it('si ya pasó, toma el del año que viene (cruce de año)', () => {
    expect(nextBirthday('1990-01-01', '2026-12-30')).toEqual({ birthday: '2027-01-01', daysUntil: 2, age: 37 });
  });

  it('el 29/2 se festeja el 28/2 en años no bisiestos', () => {
    expect(nextBirthday('2000-02-29', '2027-02-26')).toEqual({ birthday: '2027-02-28', daysUntil: 2, age: 27 });
    expect(nextBirthday('2000-02-29', '2028-02-26').birthday).toBe('2028-02-29');
  });

  it('usa la fecha de Argentina, no la UTC', () => {
    // 01:00 UTC del 11/11 todavía es 10/11 en Argentina.
    expect(todayInArgentina(new Date('2026-11-11T01:00:00Z'))).toBe('2026-11-10');
  });
});

describe('BirthdayRemindersService', () => {
  it('avisa a admin y contable 3, 2, 1 días antes y el mismo día', async () => {
    const ana = collaborator({ birthDate: '1990-11-13' });
    const { service, resend } = setup([ana, admin, contable, pm]);

    for (const day of ['10', '11', '12', '13']) {
      await service.sendDueReminders(new Date(`2026-11-${day}T15:00:00Z`));
    }

    expect(resend.send).toHaveBeenCalledTimes(4);
    expect(resend.send.mock.calls.map(([options]) => options.subject)).toEqual([
      'En 3 días cumple años Ana',
      'En 2 días cumple años Ana',
      'Mañana cumple años Ana',
      'Hoy cumple años Ana',
    ]);
    expect(resend.send.mock.calls[0][0].to).toEqual(['admin@capasso.tech', 'contador@mail.com']);
  });

  it('no avisa 4 días antes ni el día después', async () => {
    const { service, resend } = setup([collaborator({ birthDate: '1990-11-14' }), admin]);
    await service.sendDueReminders(NOW);
    const { service: after, resend: resendAfter } = setup([collaborator({ birthDate: '1990-11-09' }), admin]);
    await after.sendDueReminders(NOW);
    expect(resend.send).not.toHaveBeenCalled();
    expect(resendAfter.send).not.toHaveBeenCalled();
  });

  it('no repite el aviso si corre varias veces el mismo día', async () => {
    const { service, resend } = setup([collaborator({ birthDate: '1990-11-13' }), admin]);
    await service.sendDueReminders(NOW);
    await service.sendDueReminders(new Date('2026-11-10T20:00:00Z'));
    expect(resend.send).toHaveBeenCalledTimes(1);
  });

  it('si el email no sale, libera la reserva para poder mandarlo de nuevo', async () => {
    const { service, resend, reminderRepository } = setup([collaborator({ birthDate: '1990-11-13' }), admin]);
    resend.send.mockResolvedValueOnce(false);
    await service.sendDueReminders(NOW);
    expect(reminderRepository.delete).toHaveBeenCalledTimes(1);
    await service.sendDueReminders(NOW);
    expect(resend.send).toHaveBeenCalledTimes(2);
  });

  it('ignora inactivos y colaboradores sin fecha de nacimiento', async () => {
    const { service, resend } = setup([
      collaborator({ id: 'a', birthDate: '1990-11-13', active: false }),
      collaborator({ id: 'b', birthDate: null }),
      admin,
    ]);
    await service.sendDueReminders(NOW);
    expect(resend.send).not.toHaveBeenCalled();
  });

  it('el cumpleañero no recibe su propio aviso', async () => {
    const { service, resend } = setup([{ ...admin, birthDate: '1985-11-12' } as CollaboratorEntity, contable]);
    await service.sendDueReminders(NOW);
    expect(resend.send.mock.calls[0][0].to).toEqual(['contador@mail.com']);
  });

  it('solo está activo en producción salvo que se fuerce', () => {
    expect(setup([], {}).service.isEnabled()).toBe(false);
    expect(setup([], { RENDER_GIT_BRANCH: 'develop' }).service.isEnabled()).toBe(false);
    expect(setup([], { RENDER_GIT_BRANCH: 'main' }).service.isEnabled()).toBe(true);
    expect(setup([], { RENDER_GIT_BRANCH: 'main', BIRTHDAY_REMINDERS_ENABLED: 'false' }).service.isEnabled()).toBe(false);
  });
});
