import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { buildEmailRowsTable, buildEmailShell } from '../common/email-template.util';
import { ResendService } from '../common/resend.service';
import { CollaboratorReceiptAcknowledgementEntity } from '../database/entities';
import { RECEIPT_CONTACT_EMAIL } from './collaborator-receipt-email.template';
import type { GenerateCollaboratorReceiptDto } from './collaborator-receipt.dto';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CollaboratorReceiptAcknowledgementService {
  private readonly logger = new Logger(CollaboratorReceiptAcknowledgementService.name);

  constructor(
    @InjectRepository(CollaboratorReceiptAcknowledgementEntity)
    private readonly repository: Repository<CollaboratorReceiptAcknowledgementEntity>,
    private readonly configService: ConfigService,
    private readonly resendService: ResendService,
  ) {}

  // El link va en un email, así que tiene que ser una URL pública del backend.
  // Render define RENDER_EXTERNAL_URL solo; BACKEND_PUBLIC_URL es para cualquier
  // otro entorno. Sin ninguna de las dos se corta el envío: un recibo sin botón o
  // con un link roto no se notaría hasta que un colaborador lo reporte.
  buildAcknowledgementUrl(id: string): string {
    const baseUrl =
      this.configService.get<string>('BACKEND_PUBLIC_URL') ?? this.configService.get<string>('RENDER_EXTERNAL_URL');
    if (!baseUrl) {
      throw new InternalServerErrorException(
        'Falta configurar BACKEND_PUBLIC_URL para generar el link de confirmación del recibo.',
      );
    }
    return `${baseUrl.replace(/\/+$/, '')}/public/receipt-acknowledgements/${id}`;
  }

  create(
    collaboratorId: string,
    recipientEmail: string,
    receipt: GenerateCollaboratorReceiptDto,
  ): Promise<CollaboratorReceiptAcknowledgementEntity> {
    return this.repository.save(
      this.repository.create({
        collaboratorId,
        recipientEmail,
        fullName: receipt.fullName.trim(),
        monthYear: receipt.monthYear,
        total: receipt.total,
        currency: receipt.currency?.trim() || null,
      }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  // Null también para un id con formato inválido: Postgres rechazaría el cast a UUID.
  findById(id: string): Promise<CollaboratorReceiptAcknowledgementEntity | null> {
    if (!UUID_REGEX.test(id)) return Promise.resolve(null);
    return this.repository.findOneBy({ id });
  }

  // El update condicional hace que un doble click (o dos pestañas) confirme y
  // notifique una sola vez, y conserva la fecha de la primera confirmación.
  async acknowledge(id: string): Promise<CollaboratorReceiptAcknowledgementEntity | null> {
    if (!UUID_REGEX.test(id)) return null;
    const result = await this.repository.update({ id, acknowledgedAt: IsNull() }, { acknowledgedAt: new Date() });
    const record = await this.repository.findOneBy({ id });
    if (record && result.affected) {
      await this.notifyAcknowledged(record);
    }
    return record;
  }

  // La confirmación ya quedó guardada: si falla el aviso, el colaborador no debe ver un error.
  private async notifyAcknowledged(record: CollaboratorReceiptAcknowledgementEntity): Promise<void> {
    const html = buildEmailShell({
      eyebrow: 'Recibos',
      title: `${record.fullName} recibió el pago`,
      intro: 'El colaborador confirmó que recibió el dinero de este recibo.',
      bodyHtml: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${buildEmailRowsTable(
        [
          ['Colaborador', record.fullName],
          ['Período', record.monthYear],
          ['Total', `${record.total} ${record.currency ?? ''}`.trim()],
        ],
      )}</table>`,
    });
    try {
      await this.resendService.send({
        to: [RECEIPT_CONTACT_EMAIL],
        subject: `${record.fullName} confirmó el pago de ${record.monthYear}`,
        html,
      });
    } catch (error) {
      this.logger.error(`No se pudo avisar la confirmación del recibo ${record.id}`, error);
    }
  }
}
