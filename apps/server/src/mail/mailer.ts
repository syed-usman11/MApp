import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** False for the console mailer: nothing actually reaches an inbox. */
  readonly delivers: boolean;
  send(message: MailMessage): Promise<void>;
}

export interface MailConfig {
  /** Sender shown to the recipient, e.g. "MApp <no-reply@example.com>". */
  from?: string;
  resendApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
}

type Log = { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void };

/**
 * Development mailer: prints the email to the server log instead of sending it.
 */
export class ConsoleMailer implements Mailer {
  readonly delivers = false;
  constructor(private readonly log: (obj: Record<string, unknown>, msg: string) => void) {}

  async send(message: MailMessage): Promise<void> {
    this.log({ to: message.to, subject: message.subject, body: message.text }, "email (console mailer, not delivered)");
  }
}

/** Any SMTP relay: Gmail with an app password, Brevo, Mailgun, Postmark, SES SMTP, ... */
export class SmtpMailer implements Mailer {
  readonly delivers = true;
  private readonly transport: Transporter;

  constructor(
    opts: { host: string; port: number; secure: boolean; user?: string; pass?: string },
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure,
      ...(opts.user ? { auth: { user: opts.user, pass: opts.pass ?? "" } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text });
  }

  /** Opens a connection and authenticates, so a bad password fails at boot instead of on the first reset. */
  verify(): Promise<true> {
    return this.transport.verify();
  }
}

/** Resend's HTTP API. Needs a verified domain to send to addresses other than your own. */
export class ResendMailer implements Mailer {
  readonly delivers = true;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const res = await this.fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Resend rejected the email (${res.status}): ${body.slice(0, 300)}`);
    }
  }
}

/**
 * Picks the transport from configuration. Order: Resend if an API key is set,
 * SMTP if a host is set, otherwise the console mailer with a loud warning in
 * production, where a silent console mailer would make password reset look
 * broken.
 */
export function createMailer(config: MailConfig, log: Log, production: boolean): Mailer {
  const from = config.from ?? (config.smtpUser ? `MApp <${config.smtpUser}>` : "MApp <onboarding@resend.dev>");
  if (config.resendApiKey) {
    log.info({ from, transport: "resend" }, "email transport");
    return new ResendMailer(config.resendApiKey, from);
  }
  if (config.smtpHost) {
    const port = config.smtpPort ?? 587;
    const mailer = new SmtpMailer({ host: config.smtpHost, port, secure: config.smtpSecure ?? port === 465, user: config.smtpUser, pass: config.smtpPass }, from);
    log.info({ from, transport: "smtp", host: config.smtpHost, port }, "email transport");
    void mailer.verify().then(
      () => log.info({ host: config.smtpHost }, "smtp login ok"),
      (err: unknown) => log.error({ err }, "smtp login failed; password reset emails will not be delivered"),
    );
    return mailer;
  }
  const console = new ConsoleMailer((obj, msg) => log.info(obj, msg));
  if (production) log.warn("No email transport configured (set SMTP_* or RESEND_API_KEY); password reset will report itself as unavailable");
  return console;
}
