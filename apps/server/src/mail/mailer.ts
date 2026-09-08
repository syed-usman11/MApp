export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Development mailer: prints the email to the server log instead of sending it.
 * Swap for a real provider (Resend, SES, Postmark) by implementing `Mailer`.
 */
export class ConsoleMailer implements Mailer {
  constructor(private readonly log: (obj: Record<string, unknown>, msg: string) => void) {}

  async send(message: MailMessage): Promise<void> {
    this.log({ to: message.to, subject: message.subject, body: message.text }, "email (console mailer, not delivered)");
  }
}
