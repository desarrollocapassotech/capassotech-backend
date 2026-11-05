import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { CollaboratorsModule } from './collaborators/collaborators.module';
import { CollaboratorPerformanceModule } from './collaborator-performance/collaborator-performance.module';
import { DatabaseModule } from './database/database.module';
import { ExchangeRateModule } from './exchange-rate/exchange-rate.module';
import { ExpensesModule } from './expenses/expenses.module';
import { HealthModule } from './health/health.module';
import { HoursAlertsModule } from './hours-alerts/hours-alerts.module';
import { IncomeModule } from './income/income.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { CuentaCorrienteModule } from './cuenta-corriente/cuenta-corriente.module';
import { FacturacionModule } from './facturacion/facturacion.module';
import { JiraModule } from './jira/jira.module';
import { TicketsModule } from './tickets/tickets.module';
import { TicketStatesModule } from './ticket-states/ticket-states.module';
import { UsersModule } from './users/users.module';
import { ProjectsModule } from './projects/projects.module';
import { TimeEntriesModule } from './time-entries/time-entries.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    AuthModule,
    CollaboratorsModule,
    CollaboratorPerformanceModule,
    ClientsModule,
    ExchangeRateModule,
    ExpensesModule,
    HealthModule,
    HoursAlertsModule,
    IncomeModule,
    IntegrationsModule,
    FacturacionModule,
    CuentaCorrienteModule,
    JiraModule,
    TicketStatesModule,
    TicketsModule,
    UsersModule,
    ProjectsModule,
    TimeEntriesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
