import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type MonedaCondicion = 'USD' | 'ARS';

// tracker.project_billing_terms: qué le cobra un proyecto a un cliente en un período. Suscripción
// mensual, tarifa por hora o las dos. Para cambiar una condición se cierra la vigente (`hasta`) y
// se abre otra desde el mes siguiente: los meses pasados no cambian.
@Entity({ name: 'project_billing_terms', schema: 'tracker' })
export class ProjectBillingTermEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'project_id', type: 'text' })
  projectId: string;

  @Column({ name: 'client_id', type: 'text' })
  clientId: string;

  /** Primer mes en que vale (yyyy-MM). */
  @Column({ type: 'text' })
  desde: string;

  /** Último mes en que vale (yyyy-MM); null = sigue vigente. */
  @Column({ type: 'text', nullable: true })
  hasta: string | null;

  @Column({ type: 'text' })
  currency: MonedaCondicion;

  /** Suscripción: monto fijo por mes, sin importar las horas. */
  @Column({
    name: 'monthly_amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
  })
  monthlyAmount: string | null;

  /** Se cobran las horas facturables del cliente en el proyecto a esta tarifa. */
  @Column({
    name: 'hourly_rate',
    type: 'numeric',
    precision: 12,
    scale: 2,
    nullable: true,
  })
  hourlyRate: string | null;

  @Column({ name: 'created_by', type: 'text', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Vigente en el mes (yyyy-MM): los meses se comparan como texto. */
export function condicionVigente(
  c: Pick<ProjectBillingTermEntity, 'desde' | 'hasta'>,
  mes: string,
): boolean {
  return c.desde <= mes && (c.hasta == null || c.hasta >= mes);
}
