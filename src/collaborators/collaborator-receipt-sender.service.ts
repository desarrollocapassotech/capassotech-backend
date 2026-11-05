import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ResendService } from '../common/resend.service';
import { CollaboratorReceiptAcknowledgementService } from './collaborator-receipt-acknowledgement.service';
import {
  buildCollaboratorReceiptEmailHtml,
  RECEIPT_CONTACT_EMAIL,
} from './collaborator-receipt-email.template';
import { CollaboratorReceiptService } from './collaborator-receipt.service';
import type { SendCollaboratorReceiptEmailDto } from './collaborator-receipt.dto';

// Envío del recibo por email: lo usan la pantalla de Colaboradores y la Cuenta corriente.
@Injectable()
export class CollaboratorReceiptSenderService {
  constructor(
    private readonly receipts: CollaboratorReceiptService,
    private readonly resendService: ResendService,
    private readonly acknowledgementService: CollaboratorReceiptAcknowledgementService,
  ) {}

  async send(
    collaboratorId: string,
    body: SendCollaboratorReceiptEmailDto,
  ): Promise<{ sent: true }> {
    const to = body.to?.trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      throw new BadRequestException('El email del destinatario no es válido.');
    }
    const pdf = await this.receipts.generate(body.receipt);
    const slug = (value: string) =>
      value.trim().replace(/\s+/g, '-').toLowerCase();
    // El registro se crea antes del envío porque su id va en el link del email; si
    // el envío falla se borra, para no dejar pendiente un recibo que nunca salió.
    const acknowledgement = await this.acknowledgementService.create(
      collaboratorId,
      to,
      body.receipt,
    );
    let sent = false;
    try {
      sent = await this.resendService.send({
        to: [to],
        // Sin CC si el destinatario ya es esa casilla, para no duplicar la dirección.
        cc:
          to.toLowerCase() === RECEIPT_CONTACT_EMAIL
            ? undefined
            : [RECEIPT_CONTACT_EMAIL],
        subject: `Recibo de pago - ${body.receipt.monthYear}`,
        html: buildCollaboratorReceiptEmailHtml(
          body.receipt,
          this.acknowledgementService.buildAcknowledgementUrl(
            acknowledgement.id,
          ),
          body.hoursSummary,
        ),
        attachments: [
          {
            filename: `recibo-${slug(body.receipt.fullName)}-${slug(body.receipt.monthYear)}.pdf`,
            content: pdf,
          },
        ],
      });
    } finally {
      if (!sent) await this.acknowledgementService.remove(acknowledgement.id);
    }
    if (!sent) {
      throw new InternalServerErrorException(
        'No se pudo enviar el email. Revisá la configuración de Resend.',
      );
    }
    return { sent: true };
  }
}
