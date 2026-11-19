import { Entity, PrimaryColumn } from 'typeorm';

// tracker.expense_clients: los clientes que pagan un gasto. La empresa lo paga y se lo recobra a
// cada uno por la Cuenta corriente, en partes iguales. Sin filas, el gasto es de la empresa.
@Entity({ name: 'expense_clients', schema: 'tracker' })
export class ExpenseClientEntity {
  @PrimaryColumn({ name: 'expense_id', type: 'text' })
  expenseId: string;

  @PrimaryColumn({ name: 'client_id', type: 'text' })
  clientId: string;
}
