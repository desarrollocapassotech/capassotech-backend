import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { ResendService } from '../common/resend.service';
import { CuentaCorrienteService, hoyArgentina } from '../cuenta-corriente/cuenta-corriente.service';
import {
  BalanceSummarySendEntity,
  ClientEntity,
  CollaboratorEntity,
  CollaboratorProjectRateEntity,
  ExpenseClientEntity,
  ExpenseEntity,
  ExpenseProjectEntity,
  ProjectBillingTermEntity,
  ProjectEntity,
  TimeEntryEntity,
  UserRole,
} from '../database/entities';
import { ExchangeRateService } from '../exchange-rate/exchange-rate.service';
import { rangoMes } from '../facturacion/resumen';
import type { BillableCollaborator } from '../integrations/billable-hours.util';
import { condicionDeEntidad } from '../projects/condiciones';
import { calcularBalance, type Balance } from './balance';
import { balanceResumenSubject, buildBalanceResumenHtml } from './balance-resumen.template';

// Resumen semanal del balance: los viernes a las 9 de Argentina, un email a los admin y contables
// activos con el balance del mes en curso hasta ese día (lo mismo que el Panel de administración).
//
// La tabla balance_summary_sends garantiza un solo envío por día aunque el cron se dispare dos
// veces (por ejemplo, durante un deploy). Las pruebas con `enviar` no la usan.
//
// Solo manda desde producción, igual que el aviso de vencimientos: QA es una copia de producción y
// el backend local apunta a la de producción. Se decide con BALANCE_SUMMARY_ENABLED
// ('true'/'false') o, si no está, con la rama que despliega Render (RENDER_GIT_BRANCH === 'main').
@Injectable()
export class BalanceResumenService {
  private readonly logger = new Logger(BalanceResumenService.name);
  private running = false;

  constructor(
    @InjectRepository(BalanceSummarySendEntity) private readonly envios: Repository<BalanceSummarySendEntity>,
    @InjectRepository(ProjectEntity) private readonly proyectos: Repository<ProjectEntity>,
    @InjectRepository(ProjectBillingTermEntity) private readonly condiciones: Repository<ProjectBillingTermEntity>,
    @InjectRepository(ClientEntity) private readonly clientes: Repository<ClientEntity>,
    @InjectRepository(TimeEntryEntity) private readonly horas: Repository<TimeEntryEntity>,
    @InjectRepository(CollaboratorEntity) private readonly colaboradores: Repository<CollaboratorEntity>,
    @InjectRepository(CollaboratorProjectRateEntity) private readonly tarifas: Repository<CollaboratorProjectRateEntity>,
    @InjectRepository(ExpenseEntity) private readonly gastos: Repository<ExpenseEntity>,
    @InjectRepository(ExpenseProjectEntity) private readonly gastosProyectos: Repository<ExpenseProjectEntity>,
    @InjectRepository(ExpenseClientEntity) private readonly gastosClientes: Repository<ExpenseClientEntity>,
    private readonly tipoDeCambio: ExchangeRateService,
    private readonly cc: CuentaCorrienteService,
    private readonly resend: ResendService,
    private readonly configService: ConfigService,
  ) {}

  isEnabled(): boolean {
    const flag = this.configService.get<string>('BALANCE_SUMMARY_ENABLED');
    if (flag !== undefined && flag !== '') return flag.toLowerCase() === 'true';
    return this.configService.get<string>('RENDER_GIT_BRANCH') === 'main';
  }

  @Cron('0 9 * * 5', { name: 'balance-summary', timeZone: 'America/Argentina/Buenos_Aires' })
  async enviarResumenSemanal(): Promise<boolean> {
    if (!this.isEnabled() || this.running) return false;
    this.running = true;
    const hoy = hoyArgentina();
    let reservado = false;
    try {
      const destinatarios = await this.destinatarios();
      if (!destinatarios.length) {
        this.logger.warn('Resumen del balance: no hay admin ni contable con email configurado; se omite.');
        return false;
      }
      // Se reserva el envío del día ANTES de mandarlo (la PK actúa de lock): si otra instancia ya
      // lo reservó, no se repite. Si el email no sale, se libera la reserva.
      try {
        await this.envios.insert({ sendDate: hoy });
        reservado = true;
      } catch (error) {
        if (this.isUniqueViolation(error)) return false;
        throw error;
      }
      const enviado = await this.enviar(destinatarios);
      if (!enviado) {
        await this.envios.delete({ sendDate: hoy });
        reservado = false;
      }
      return enviado;
    } catch (error) {
      if (reservado) await this.envios.delete({ sendDate: hoy }).catch(() => undefined);
      this.logger.error(`No se pudo mandar el resumen del balance: ${(error as Error).message}`);
      return false;
    } finally {
      this.running = false;
    }
  }

  /** Arma y manda el resumen del mes en curso a `to` (también sirve para mandar una prueba). */
  async enviar(to: string[]): Promise<boolean> {
    const hoy = hoyArgentina();
    const mes = hoy.slice(0, 7);
    const { balance, tcFijado } = await this.calcular(mes);
    return this.resend.send({
      to,
      subject: balanceResumenSubject(balance, hoy),
      html: buildBalanceResumenHtml(balance, hoy, tcFijado, this.urlFrontend()),
    });
  }

  async calcular(mes: string): Promise<{ balance: Balance; tcFijado: boolean }> {
    const { desde, hasta } = rangoMes(mes);
    const [tc, proyectos, condiciones, clientes, horas, colaboradores, tarifas, gastos, gastosProyectos, gastosClientes, cargos] =
      await Promise.all([
        this.tipoDeCambio.getUsdRate(mes),
        this.proyectos.find(),
        this.condiciones.find(),
        this.clientes.find(),
        this.horas.find({ where: { date: Between(desde, hasta) } }),
        this.colaboradores.find(),
        this.tarifas.find(),
        this.gastos.find(),
        this.gastosProyectos.find(),
        this.gastosClientes.find(),
        this.cc.cargosDelMes(mes),
      ]);
    if (!tc.locked && tc.rate <= 1) {
      throw new Error('No se pudo obtener el tipo de cambio del día y el mes no tiene uno fijado.');
    }

    // En las horas puede venir el id del colaborador o su uid de Firebase.
    const porClave = new Map<string, BillableCollaborator & { name: string }>();
    for (const c of colaboradores) {
      const mapped = {
        id: c.id,
        name: c.name,
        hourlyRate: Number(c.hourlyRate),
        currency: c.currency,
        exchangeRate: c.exchangeRate != null ? Number(c.exchangeRate) : undefined,
        projectRates: tarifas
          .filter((t) => t.collaboratorId === c.id)
          .map((t) => ({ projectId: t.projectId, hourlyRate: Number(t.hourlyRate) })),
      };
      porClave.set(c.id, mapped);
      if (c.userId) porClave.set(c.userId, mapped);
    }

    const balance = calcularBalance({
      mes,
      usdRate: tc.rate,
      proyectos: proyectos.map((p) => ({
        id: p.id,
        name: p.name,
        active: p.active,
        kind: p.kind,
        clientId: p.clientId,
        billableConfig: p.billableConfig,
      })),
      condiciones: condiciones.map(condicionDeEntidad),
      clientes: clientes.map((c) => ({ id: c.id, name: c.name })),
      horas: horas.map((h) => ({
        projectId: h.projectId,
        clientId: h.clientId,
        collaboratorId: h.collaboratorId,
        hours: Number(h.hours) || 0,
        taskBillingType: h.taskBillingType,
      })),
      colaboradores: porClave,
      gastos: gastos.map((g) => ({
        id: g.id,
        description: g.description,
        amount: Number(g.amount),
        currency: g.currency,
        periodicity: g.periodicity,
        expenseDate: g.expenseDate,
        category: g.category,
        projectIds: gastosProyectos.filter((l) => l.expenseId === g.id).map((l) => l.projectId),
        clientIds: gastosClientes.filter((l) => l.expenseId === g.id).map((l) => l.clientId),
      })),
      cargos: cargos.cargos,
      adicionales: cargos.adicionales,
    });
    return { balance, tcFijado: tc.locked };
  }

  private async destinatarios(): Promise<string[]> {
    return [
      ...new Set(
        (await this.colaboradores.find())
          .filter((c) => c.active && (c.roles.includes(UserRole.ADMIN) || c.roles.includes(UserRole.CONTABLE)))
          .map((c) => c.workEmail ?? c.personalEmail)
          .filter((email): email is string => !!email),
      ),
    ];
  }

  private isUniqueViolation(error: unknown): boolean {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
  }

  private urlFrontend(): string {
    return this.configService.get<string>('FRONTEND_PUBLIC_URL') || 'https://tracker.capasso.tech';
  }
}
