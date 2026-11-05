import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BillingCurrency, UserRole } from './enums';

// tracker.collaborators <- Firestore /colaboradores
@Entity({ name: 'collaborators', schema: 'tracker' })
export class CollaboratorEntity {
  @PrimaryColumn({ type: 'text' })
  id: string;

  @Column({ name: 'user_id', type: 'text', nullable: true })
  userId: string | null;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'personal_email', type: 'text', nullable: true })
  personalEmail: string | null;

  @Column({ name: 'work_email', type: 'text', nullable: true })
  workEmail: string | null;

  // Legacy: texto plano igual que hoy en Firestore. Ver nota en database/README.md.
  // select: false para que ninguna lectura la traiga y no pueda salir por la API.
  @Column({ type: 'text', nullable: true, select: false })
  password: string | null;

  @Column({ name: 'hourly_rate', type: 'numeric', precision: 12, scale: 2 })
  hourlyRate: string;

  @Column({ type: 'enum', enum: BillingCurrency, enumName: 'billing_currency', default: BillingCurrency.USD })
  currency: BillingCurrency;

  @Column({ name: 'exchange_rate', type: 'numeric', precision: 12, scale: 4, nullable: true })
  exchangeRate: string | null;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'started_date', type: 'date' })
  startedDate: string;

  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: string | null;

  @Column({ name: 'payment_method', type: 'text', nullable: true })
  paymentMethod: string | null;

  @Column({ type: 'text', nullable: true })
  phone: string | null;

  @Column({ type: 'text', nullable: true })
  city: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @Column({ type: 'text', nullable: true })
  floor: string | null;

  @Column({ type: 'text', nullable: true })
  province: string | null;

  @Column({ name: 'postal_code', type: 'text', nullable: true })
  postalCode: string | null;

  @Column({ name: 'cbu_cvu', type: 'text', nullable: true })
  cbuCvu: string | null;

  @Column({
    type: 'enum',
    enum: UserRole,
    enumName: 'user_role',
    array: true,
    default: [UserRole.COLABORADOR],
  })
  roles: UserRole[];

  @Column({ name: 'show_financial_values', type: 'boolean', default: true })
  showFinancialValues: boolean;

  @Column({ name: 'profile_image_url', type: 'text', nullable: true })
  profileImageUrl: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
