import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SendEmailOptions {
  to: string[];
  subject: string;
  html: string;
}

// Cliente mínimo de la API HTTP de Resend (https://resend.com/docs/api-reference/emails/send-email),
// sin el SDK oficial: es una sola llamada, no justifica la dependencia.
//
// A diferencia de MailService (SMTP/nodemailer), acá el constructor NO lanza si
// falta RESEND_API_KEY: MailService lo hacía y eso rompió el boot del backend en
// Render cuando SMTP_HOST no estaba configurado (ver tickets.service.ts). Sin la
// key, send() simplemente loguea y no envía, para que el resto del backend siga
// funcionando aunque el email no esté configurado en un entorno dado.
@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);
  private readonly apiKey?: string;
  private readonly fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('RESEND_API_KEY');
    this.fromEmail = this.configService.get<string>('RESEND_FROM_EMAIL') ?? 'notificaciones@capassotech.com';
  }

  async send(options: SendEmailOptions): Promise<void> {
    if (!this.apiKey) {
      this.logger.warn('RESEND_API_KEY no está configurado; se omite el envío de email.');
      return;
    }
    if (options.to.length === 0) {
      this.logger.warn('No hay destinatarios para el email; se omite el envío.');
      return;
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      this.logger.error(`Resend respondió ${response.status} al enviar "${options.subject}": ${body}`);
    }
  }
}
