import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { IncomeService } from './income.service';
import type { CreateIncomeDto, UpdateIncomeDto } from './income.dto';

// Mismo criterio que Gastos: los ingresos de la empresa solo los ve/gestiona
// admin (Super Admin) y contable.
@UseGuards(FirebaseAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CONTABLE)
@Controller('income')
export class IncomeController {
  constructor(private readonly incomeService: IncomeService) {}

  @Get()
  findAll() {
    return this.incomeService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.incomeService.findOne(id);
  }

  @Post()
  create(@Body() body: CreateIncomeDto, @CurrentUser() user: AuthenticatedRequest['user']) {
    return this.incomeService.create(body, user.email);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpdateIncomeDto) {
    return this.incomeService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.incomeService.remove(id);
  }
}
