import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { CcDueReminderEntity, CollaboratorEntity, UserRole } from '../database/entities';
import { CuentaCorrienteService } from './cuenta-corriente.service';
import { vencimientosSubject } from './vencimientos-notification.template';
import { VencimientosService } from './vencimientos.service';

jest.mock('./cuenta-corriente.service', () => ({
  CuentaCorrienteService: class {},
  hoyArgentina: () => '2026-11-10',
}));

const persona = (overrides: Partial<CollaboratorEntity>): CollaboratorEntity =>
  ({ id: 'x', name: 'X', active: true, roles: [UserRole.COLABORADOR], workEmail: null, personalEmail: null, ...overrides }) as CollaboratorEntity;

const admin = persona({ id: 'admin', roles: [UserRole.ADMIN], workEmail: 'admin@capasso.tech' });
const contable = persona({ id: 'cont', roles: [UserRole.CONTABLE], personalEmail: 'contador@mail.com' });
const dev = persona({ id: 'dev', workEmail: 'dev@capasso.tech' });

const cobro = { id: 'm1', side: 'cliente' as const, cuentaId: 'c1', cuenta: 'Puerto Rico', concepto: 'Servicios Octubre 2026', importe: 1600, pendiente: 1600, moneda: 'USD' as const, vencimiento: '2026-11-10' };
const pago = { ...cobro, id: 'm2', side: 'colaborador' as const, cuenta: 'Ana', concepto: 'Horas Octubre 2026', moneda: 'ARS' as const };

function setup(cargos = [cobro, pago], env: Record<string, string> = { CC_DUE_REMINDERS_ENABLED: 'true' }) {
  const reservados = new Set<string>();
  const avisos = {
    insert: jest.fn(async (k: { movementId: string; dueDate: string }) => {
      const id = `${k.movementId}|${k.dueDate}`;
      if (reservados.has(id)) throw Object.assign(new Error('duplicate'), { code: '23505' });
      reservados.add(id);
    }),
    delete: jest.fn(async (k: { movementId: string; dueDate: string }) => {
      reservados.delete(`${k.movementId}|${k.dueDate}`);
    }),
  };
  const colaboradores = { find: jest.fn().mockResolvedValue([admin, contable, dev]) };
  const cc = { cargosQueVencen: jest.fn().mockResolvedValue(cargos) };
  const resend = { send: jest.fn().mockResolvedValue(true) };
  const service = new VencimientosService(
    avisos as unknown as Repository<CcDueReminderEntity>,
    colaboradores as unknown as Repository<CollaboratorEntity>,
    cc as unknown as CuentaCorrienteService,
    resend as unknown as ResendService,
    { get: (k: string) => env[k] } as unknown as ConfigService,
  );
  return { service, resend, cc, reservados };
}

describe('VencimientosService', () => {
  it('manda un solo email con los cobros y pagos del día a admin y contables', async () => {
    const { service, resend, cc } = setup();
    expect(await service.avisarVencimientos('2026-11-10')).toEqual({ sent: 2 });
    expect(cc.cargosQueVencen).toHaveBeenCalledWith('2026-11-10');
    expect(resend.send).toHaveBeenCalledTimes(1);
    const { to, subject, html } = resend.send.mock.calls[0][0];
    expect(to).toEqual(['admin@capasso.tech', 'contador@mail.com']);
    expect(subject).toBe('Hoy vencen 1 cobro y 1 pago de la cuenta corriente');
    expect(html).toContain('Puerto Rico');
    expect(html).toContain('US$ 1.600,00');
  });

  it('no repite el aviso si el cron corre dos veces el mismo día', async () => {
    const { service, resend } = setup();
    await service.avisarVencimientos('2026-11-10');
    expect(await service.avisarVencimientos('2026-11-10')).toEqual({ sent: 0 });
    expect(resend.send).toHaveBeenCalledTimes(1);
  });

  it('si el email no sale, libera las reservas para poder reintentar', async () => {
    const { service, resend, reservados } = setup();
    resend.send.mockResolvedValueOnce(false);
    expect(await service.avisarVencimientos('2026-11-10')).toEqual({ sent: 0 });
    expect(reservados.size).toBe(0);
  });

  it('sin nada que venza no manda nada', async () => {
    const { service, resend } = setup([]);
    expect(await service.avisarVencimientos('2026-11-10')).toEqual({ sent: 0 });
    expect(resend.send).not.toHaveBeenCalled();
  });

  it('fuera de producción no revisa nada', async () => {
    const { service, resend, cc } = setup(undefined, { RENDER_GIT_BRANCH: 'qa' });
    expect(await service.avisarVencimientos('2026-11-10')).toEqual({ sent: 0 });
    expect(cc.cargosQueVencen).not.toHaveBeenCalled();
    expect(resend.send).not.toHaveBeenCalled();
  });
});

describe('vencimientosSubject', () => {
  it('nombra solo lo que hay', () => {
    expect(vencimientosSubject([cobro, { ...cobro, id: 'm3' }])).toBe('Hoy vencen 2 cobros de la cuenta corriente');
    expect(vencimientosSubject([pago])).toBe('Hoy vencen 1 pago de la cuenta corriente');
  });
});
