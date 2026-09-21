import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nodemailer, { type Transporter } from "nodemailer";

export type MailMessage = { to: string; subject: string; text: string; html?: string; category: string };

export interface MailProvider {
  send(message: MailMessage): Promise<{ id: string }>;
  /** Checks the connection and credentials without sending (throws with the reason). Providers without a handshake resolve. */
  verify?(): Promise<void>;
}

export const DEFAULT_FROM = "Boredroom <no-reply@boredroom.local>";

/** Writes each message as a JSON file so developers and tests can inspect it. Never sends anything. */
export class SinkMailProvider implements MailProvider {
  constructor(private dir: string) {}
  async send(message: MailMessage) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const from = process.env.MAIL_FROM ?? DEFAULT_FROM;
    const record = { id, from, sentAt: new Date().toISOString(), ...message };
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(join(this.dir, `${id}.json`), JSON.stringify(record, null, 2));
    } catch (err) {
      // Read-only or ephemeral filesystems (serverless hosts): never fail the user action over a dev-only sink.
      console.warn(`[mail sink] cannot write to ${this.dir} (${(err as Error).message}); message logged instead:\n${message.subject}\n${message.text}`);
    }
    return { id };
  }
}

/**
 * Real delivery over SMTP with Nodemailer. Built for Brevo's relay (smtp-relay.brevo.com:587, login = your Brevo
 * account email, password = an SMTP key from Brevo → SMTP & API) but any SMTP relay works.
 * SMTP_URL forms: smtp://login:key@host:587 (STARTTLS, required) or smtps://login:key@host:465 (TLS from the start).
 * URL-encode the login and key if they contain @, : or /.
 */
export class SmtpMailProvider implements MailProvider {
  constructor(private transporter: Transporter, private from: string) {}
  static fromUrl(url: string, from: string) {
    const secure = new URL(url).protocol === "smtps:";
    const transporter = nodemailer.createTransport({ url, requireTLS: !secure, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
    return new SmtpMailProvider(transporter, from);
  }
  async send(message: MailMessage) {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        // Brevo shows this as the message's tag in its logs; other relays pass it through as a plain header.
        headers: { "X-Mailin-Tag": message.category.replace(/[^A-Za-z0-9_-]/g, "_") },
      });
      return { id: info.messageId ?? `smtp-${Date.now()}` };
    } catch (err) {
      throw new Error(`SMTP delivery failed: ${(err as Error).message}. Check SMTP_URL (host, port, login and key) and that MAIL_FROM is a sender verified with your relay.`);
    }
  }
  async verify() {
    try { await this.transporter.verify(); }
    catch (err) { throw new Error(`Cannot log in to the SMTP relay: ${(err as Error).message}. Check the host, port, login and key in SMTP_URL.`); }
  }
}

/**
 * Real delivery through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Needs RESEND_API_KEY and a MAIL_FROM on a domain verified in the Resend dashboard. Uses fetch only; no SDK.
 */
export class ResendMailProvider implements MailProvider {
  constructor(private apiKey: string, private from: string, private fetchImpl: typeof fetch = fetch, private endpoint = "https://api.resend.com/emails") {}
  async send(message: MailMessage) {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          ...(message.html ? { html: message.html } : {}),
          tags: [{ name: "category", value: message.category.replace(/[^A-Za-z0-9_-]/g, "_") }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`Resend is not reachable: ${(err as Error).message}`);
    }
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try { const body = (await res.json()) as { message?: string; name?: string }; if (body.message) detail = `${body.name ? `${body.name}: ` : ""}${body.message}`; } catch { /* keep the status */ }
      throw new Error(`Resend refused the message (${detail}). Check RESEND_API_KEY and that MAIL_FROM uses a domain verified in Resend.`);
    }
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? `resend-${Date.now()}` };
  }
}

class UnconfiguredMailProvider implements MailProvider {
  constructor(private reason: string) {}
  async send(): Promise<{ id: string }> { throw new Error(this.reason); }
  async verify() { throw new Error(this.reason); }
}

const FROM_HINT = "set MAIL_FROM to a sender address verified with your mail provider, for example \"Boredroom <no-reply@yourdomain.com>\"";

/** Why the configured mail provider cannot send, or null when it is ready. Used by the health check and by mail(). */
export function mailConfigProblem(env: Record<string, string | undefined> = process.env): string | null {
  const kind = env.MAIL_PROVIDER ?? "sink";
  if (kind === "sink") return null;
  const from = env.MAIL_FROM ?? "";
  const fromOk = !!from && /@/.test(from) && !/boredroom\.local/.test(from);
  if (kind === "smtp") {
    const url = env.SMTP_URL ?? "";
    if (!url) return "MAIL_PROVIDER=smtp needs SMTP_URL, for example smtp://login:smtp-key@smtp-relay.brevo.com:587 (URL-encode the login and key).";
    try {
      const u = new URL(url);
      if (!/^smtps?:$/.test(u.protocol) || !u.hostname) throw new Error();
      if (!u.username || !u.password) return "SMTP_URL needs a login and password: smtp://login:smtp-key@host:port.";
    } catch { return "SMTP_URL must look like smtp://login:smtp-key@host:587 or smtps://login:smtp-key@host:465."; }
    if (!fromOk) return `MAIL_PROVIDER=smtp: ${FROM_HINT}.`;
    return null;
  }
  if (kind === "resend") {
    if (!env.RESEND_API_KEY) return "MAIL_PROVIDER=resend needs RESEND_API_KEY (an API key from resend.com).";
    if (!fromOk) return `MAIL_PROVIDER=resend: ${FROM_HINT}, on a domain verified in Resend.`;
    return null;
  }
  return `MAIL_PROVIDER=${kind} is not supported. Use sink (development), smtp (Brevo or any SMTP relay) or resend; see docs/providers.md.`;
}

let provider: MailProvider | null = null;
export function mail(): MailProvider {
  if (provider) return provider;
  const kind = process.env.MAIL_PROVIDER ?? "sink";
  const problem = mailConfigProblem();
  if (problem) provider = new UnconfiguredMailProvider(problem);
  else if (kind === "sink") provider = new SinkMailProvider(process.env.MAIL_SINK_DIR ?? "./var/mail-outbox");
  else if (kind === "smtp") provider = SmtpMailProvider.fromUrl(process.env.SMTP_URL!, process.env.MAIL_FROM!);
  else provider = new ResendMailProvider(process.env.RESEND_API_KEY!, process.env.MAIL_FROM!);
  return provider;
}

/** Test hook. */
export function setMailProvider(p: MailProvider | null) { provider = p; }
