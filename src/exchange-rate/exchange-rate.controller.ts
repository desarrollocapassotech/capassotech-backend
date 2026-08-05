import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/auth.types';
import { AuthenticatedRequest, FirebaseAuthGuard } from '../auth/guards/firebase-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ExchangeRateService } from './exchange-rate.service';

@UseGuards(FirebaseAuthGuard)
@Controller('exchange-rate')
export class ExchangeRateController {
  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  @Get('usd')
  getUsdRate(@Query('month') month?: string) {
    return this.exchangeRateService.getUsdRate(month);
  }

  // Fijar el TC de un mes puntual (recibos de colaboradores y facturación de
  // clientes lo consultan por igual vía GET /usd?month=yyyy-MM).
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CONTABLE)
  @Put('usd/:month')
  setUsdRate(
    @Param('month') month: string,
    @Body() body: { rate: number },
    @CurrentUser() user: AuthenticatedRequest['user'],
  ) {
    return this.exchangeRateService.setMonthlyRate(month, body.rate, user.uid);
  }
}
