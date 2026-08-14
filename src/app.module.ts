import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ClientPaymentsModule } from './client-payments/client-payments.module';
import { ClientsModule } from './clients/clients.module';
import { CollaboratorsModule } from './collaborators/collaborators.module';
import { DatabaseModule } from './database/database.module';
import { ExchangeRateModule } from './exchange-rate/exchange-rate.module';
import { ExpensesModule } from './expenses/expenses.module';
import { HealthModule } from './health/health.module';
import { HoursAlertsModule } from './hours-alerts/hours-alerts.module';
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
    ClientsModule,
    ClientPaymentsModule,
    ExchangeRateModule,
    ExpensesModule,
    HealthModule,
    HoursAlertsModule,
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
