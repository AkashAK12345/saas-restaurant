import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Outgoing email over SMTP (e.g. Gmail with an App password).
 *
 * Configured from the environment — SMTP_HOST, SMTP_PORT (465 = TLS),
 * SMTP_USER, SMTP_PASS and optionally MAIL_FROM. Until those are set,
 * `configured` is false and nothing is sent; callers say so plainly rather
 * than pretending a message went out.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return !!(this.config.get('SMTP_HOST') && this.config.get('SMTP_USER') && this.config.get('SMTP_PASS'));
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.configured) throw new Error('Email is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
    const user = this.config.get<string>('SMTP_USER')!;
    const from = this.config.get<string>('MAIL_FROM') || `SAMCO <${user}>`;
    try {
      await this.transport().sendMail({ from, ...message });
    } catch (e) {
      // The provider's message, never the credentials.
      this.logger.error(`Sending "${message.subject}" failed: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  }

  private transport(): Transporter {
    if (!this.transporter) {
      const port = Number(this.config.get('SMTP_PORT') ?? 465);
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port,
        secure: port === 465,
        auth: { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASS') },
      });
    }
    return this.transporter;
  }
}
