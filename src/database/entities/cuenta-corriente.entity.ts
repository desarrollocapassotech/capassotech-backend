import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type CcSide = 'cliente' | 'colaborador';
export type CcTipo = 'cargo' | 'pago' | 'credito';
export type CcOrigen = 'mes' | 'ajuste' | 'saldo_inicial' | 'manual';
export type CcMoneda = 'USD' | 'ARS';

/** Línea del detalle de un cargo: de ahí salen los conceptos del comprobante. */
export interface CcLineaDetalle {
  descripcion: string;
  /** "68 h", "1 mes". */
  cantidad: string;
  /** En la moneda de origen del cargo. */
  importe: number;
  /** Referencia del ítem del mes en el Facturador (para saber si ya se facturó por otro lado). */
  referencia?: string;
}

export interface CcDetalle {
  lineas: CcLineaDetalle[];
  /** Horas facturables sin redondear del cargo: alimentan las horas pagadas de la deuda. */
  horasFacturables?: number;
}

// tracker.cc_config: mes desde el que arranca la cuenta corriente (fila única, id = 1).
@Entity({ name: 'cc_config', schema: 'tracker' })
export class CcConfigEntity {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ name: 'start_month', type: 'text' })
  startMonth: string;

  @Column({ name: 'updated_by', type: 'text', nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

// tracker.cc_movements: cargos (Debe), pagos y créditos (Haber) de una cuenta. Los cargos del
// mes se generan solos desde las horas y los abonos; el resto se carga a mano.
@Entity({ name: 'cc_movements', schema: 'tracker' })
export class CcMovementEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  side: CcSide;

  @Column({ name: 'client_id', type: 'text', nullable: true })
  clientId: string | null;

  @Column({ name: 'collaborator_id', type: 'text', nullable: true })
  collaboratorId: string | null;

  @Column({ type: 'text' })
  tipo: CcTipo;

  @Column({ type: 'text' })
  origen: CcOrigen;

  /** Mes del cargo (yyyy-MM); null en lo cargado a mano. */
  @Column({ type: 'text', nullable: true })
  month: string | null;

  /** Ajuste: el cargo del mes que corrige. */
  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @Column({ type: 'text' })
  concept: string;

  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  /** Moneda de la deuda: por defecto la del proyecto; se cambia con el selector del cargo. */
  @Column({ type: 'text' })
  currency: CcMoneda;

  /** Moneda e importe calculados de las horas, antes de la elección de moneda. */
  @Column({ name: 'source_currency', type: 'text', nullable: true })
  sourceCurrency: CcMoneda | null;

  @Column({
    name: 'source_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  sourceAmount: string | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'due_date', type: 'date', nullable: true })
  dueDate: string | null;

  @Column({ name: 'payment_method', type: 'text', nullable: true })
  paymentMethod: string | null;

  @Column({ type: 'text', nullable: true })
  reference: string | null;

  @Column({ type: 'jsonb', nullable: true })
  detail: CcDetalle | null;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

// tracker.cc_imputations: qué parte de un pago cancela qué cargo, con el comprobante que se
// emitió al imputar. Deshacer no borra la fila: queda `reversed_at` como rastro fiscal.
@Entity({ name: 'cc_imputations', schema: 'tracker' })
export class CcImputationEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'pago_id', type: 'uuid' })
  pagoId: string;

  @Column({ name: 'cargo_id', type: 'uuid' })
  cargoId: string;

  /** En la moneda del cargo. */
  @Column({ type: 'numeric', precision: 14, scale: 2 })
  amount: string;

  /** En la moneda del pago. */
  @Column({ name: 'payment_amount', type: 'numeric', precision: 14, scale: 2 })
  paymentAmount: string;

  /** Pesos por dólar con que se convirtió, si pago y cargo o factura están en distinta moneda. */
  @Column({
    name: 'exchange_rate',
    type: 'numeric',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  exchangeRate: string | null;

  /** null: la imputación no emite comprobante (ya estaba facturado). */
  @Column({ type: 'text', nullable: true })
  documento: 'factura' | 'recibo' | null;

  @Column({ name: 'comprobante_id', type: 'text', nullable: true })
  comprobanteId: string | null;

  @Column({ name: 'comprobante_tipo', type: 'text', nullable: true })
  comprobanteTipo: string | null;

  @Column({ name: 'comprobante_numero', type: 'text', nullable: true })
  comprobanteNumero: string | null;

  /** Estado del Facturador, o PENDIENTE / ERROR mientras no se pudo emitir. */
  @Column({ name: 'comprobante_estado', type: 'text', nullable: true })
  comprobanteEstado: string | null;

  @Column({ name: 'comprobante_error', type: 'text', nullable: true })
  comprobanteError: string | null;

  @Column({ name: 'fecha_emision', type: 'date', nullable: true })
  fechaEmision: string | null;

  /** Se suma tras un error definitivo: la clave de emisión siguiente tiene que ser otra. */
  @Column({ type: 'int', default: 1 })
  intento: number;

  @Column({ name: 'idempotency_key', type: 'text', nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'reversed_at', type: 'timestamptz', nullable: true })
  reversedAt: Date | null;

  @Column({ name: 'reversal_reason', type: 'text', nullable: true })
  reversalReason: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
