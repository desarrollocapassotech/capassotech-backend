import { Controller, Get, Header, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  buildAcknowledgedPage,
  buildConfirmPage,
  buildNotFoundPage,
} from './collaborator-receipt-acknowledgement.pages';
import { CollaboratorReceiptAcknowledgementService } from './collaborator-receipt-acknowledgement.service';

// Sin FirebaseAuthGuard a propósito: el colaborador llega desde el email y puede no
// tener usuario en la app. El acceso lo da el id del link (UUID v4 aleatorio, no adivinable).
@Controller('public/receipt-acknowledgements')
export class CollaboratorReceiptAcknowledgementController {
  constructor(private readonly acknowledgementService: CollaboratorReceiptAcknowledgementService) {}

  @Get(':id')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async show(@Param('id') id: string, @Res({ passthrough: true }) response: Response): Promise<string> {
    const record = await this.acknowledgementService.findById(id);
    if (!record) {
      response.status(404);
      return buildNotFoundPage();
    }
    return record.acknowledgedAt ? buildAcknowledgedPage(record) : buildConfirmPage(record);
  }

  @Post(':id')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async acknowledge(@Param('id') id: string, @Res({ passthrough: true }) response: Response): Promise<string> {
    const record = await this.acknowledgementService.acknowledge(id);
    if (!record) {
      response.status(404);
      return buildNotFoundPage();
    }
    return buildAcknowledgedPage(record);
  }
}
