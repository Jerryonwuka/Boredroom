import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type MailMessage = { to: string; subject: string; text: string; html?: string; category: string };

export interface MailProvider {
  send(message: MailMessage): Promise<{ id: string }>;
}

/** Writes each message as a JSON file so developers and tests can inspect it. Never sends anything. */
export class SinkMailProvider implements MailProvider {
  constructor(private dir: string) {}
  async send(message: MailMessage) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const from = process.env.MAIL_FROM ?? "Boredroom <no-reply@boredroom.local>";
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

class UnconfiguredMailProvider implements MailProvider {
  async send(): Promise<{ id: string }> {
    throw new Error("MAIL_PROVIDER=smtp is not configured. See docs/providers.md for SMTP setup.");
  }
}

let provider: MailProvider | null = null;
export function mail(): MailProvider {
  if (provider) return provider;
  const kind = process.env.MAIL_PROVIDER ?? "sink";
  if (kind === "sink") provider = new SinkMailProvider(process.env.MAIL_SINK_DIR ?? "./var/mail-outbox");
  else provider = new UnconfiguredMailProvider();
  return provider;
}

/** Test hook. */
export function setMailProvider(p: MailProvider | null) { provider = p; }
