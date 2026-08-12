import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ExpensesService } from './expenses.service';
import type { CreateExpenseDto, CreateExpenseInstallmentsDto, UpdateExpenseDto } from './expenses.dto';

// A diferencia de proyectos/clientes, acá ni siquiera la lectura queda abierta:
// los gastos de la empresa solo los ve/gestiona admin (Super Admin) y contable.
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CONTABLE)
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  findAll() {
    return this.expensesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.expensesService.findOne(id);
  }

  @Post()
  create(@Body() body: CreateExpenseDto, @CurrentUser() user: AuthenticatedRequest['user']) {
    return this.expensesService.create(body, user.email);
  }

  @Post('installments')
  createInstallments(@Body() body: CreateExpenseInstallmentsDto, @CurrentUser() user: AuthenticatedRequest['user']) {
    return this.expensesService.createInstallments(body, user.email);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateExpenseDto, @CurrentUser() user: AuthenticatedRequest['user']) {
    return this.expensesService.update(id, body, user.email);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.expensesService.remove(id);
  }
}
