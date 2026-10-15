/**
 * The Control Center inbox: mail received to any @boredroom.cc address.
 *
 * Receiving runs on Resend inbound (free, receive-only): Resend posts an `inbox.email.received` webhook to
 * /api/inbound/resend; `ingestResend` fetches the body from Resend's Retrieve-Thread-Email API and stores the whole
 * message in `inbound_emails`, so the inbox reads our own database. Replies and new mail go out through the normal
 * mail() provider (Brevo), but From is set to the address that received the mail — which works because boredroom.cc
 * is an authenticated sending domain in Brevo.
 */
import { z } from "zod";
import { withSystem, type Db } from "@/server/db";
import { mail } from "@/server/lib/mail";
import { adminAudit, type Admin } from "@/server/admin/auth";
import { notFound } from "@/server/lib/errors";

export type InboundRow = {
  id: string; from_addr: string; to_addr: string; cc: string | null; subject: string | null;
  body_text: string | null; body_html: string | null; attachments: { id: string; filename: string | null; size: number | null }[];
  message_id: string | null; received_at: string; read_at: string | null; replied_at: string | null;
};

/** "Name <e@x.com>" or "e@x.com" -> "e@x.com". */
export function extractEmail(s: string): string {
  const m = /<([^>]+)>/.exec(s ?? "");
  return (m ? m[1] : (s ?? "")).trim();
}

// ---- Inbound (Resend) -------------------------------------------------------------------------------------------

type ResendEmail = { id: string; from: string; to?: string[]; cc?: string[]; subject?: string | null; message_id?: string | null; html?: string | null; text?: string | null; received_at?: string; attachments?: { id: string; filename: string | null; size: number | null }[] };

/** Fetches the full email (with body) from Resend; returns null if it cannot (keys unset, beta shape change, etc.). */
async function fetchResendEmail(inboxId: string, threadId: string, emailId: string): Promise<ResendEmail | null> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !inboxId || !threadId || !emailId) return null;
  try {
    const res = await fetch(`https://api.resend.com/inboxes/${inboxId}/threads/${threadId}/emails/${emailId}`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: ResendEmail } & ResendEmail;
    return body.data ?? body;
  } catch { return null; }
}

/** Stores one received email from a Resend `inbox.email.received` webhook. Idempotent on the Resend email id. */
export async function ingestResend(payload: { type?: string; data?: Record<string, unknown> }): Promise<{ stored: boolean }> {
  if (payload.type !== "inbox.email.received") return { stored: false };
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const inboxId = String(data.inbox_id ?? "");
  const threadId = String(data.thread_id ?? "");
  const hook = (data.email ?? {}) as ResendEmail;
  const emailId = String(hook.id ?? data.email_id ?? "");
  if (!emailId) return { stored: false };
  const full = (await fetchResendEmail(inboxId, threadId, emailId)) ?? hook;
  const to = full.to ?? hook.to ?? [];
  const toAddr = (to.find((a) => /@boredroom\.cc$/i.test(extractEmail(a))) ?? to[0] ?? "").trim();
  await withSystem((db) => db.query(
    `INSERT INTO inbound_emails(provider, resend_inbox_id, resend_thread_id, resend_email_id, message_id, from_addr, to_addr, cc, subject, body_text, body_html, attachments, received_at)
     VALUES ('resend', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12::timestamptz, now()))
     ON CONFLICT (resend_email_id) DO UPDATE SET body_text = COALESCE(EXCLUDED.body_text, inbound_emails.body_text), body_html = COALESCE(EXCLUDED.body_html, inbound_emails.body_html)`,
    [inboxId || null, threadId || null, emailId, full.message_id ?? hook.message_id ?? null, full.from ?? hook.from ?? "unknown", toAddr || "unknown",
     (full.cc ?? []).join(", ") || null, full.subject ?? hook.subject ?? null, full.text ?? null, full.html ?? null,
     JSON.stringify(full.attachments ?? hook.attachments ?? []), full.received_at ?? hook.received_at ?? null]));
  return { stored: true };
}

// ---- Reading ----------------------------------------------------------------------------------------------------

export async function listInbound(f: { q?: string; page?: number } = {}) {
  const page = Math.max(1, f.page ?? 1), size = 25;
  const where: string[] = []; const params: unknown[] = [];
  if (f.q?.trim()) { params.push(`%${f.q.trim()}%`); where.push(`(from_addr ILIKE $${params.length} OR to_addr ILIKE $${params.length} OR subject ILIKE $${params.length})`); }
  const cond = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return withSystem(async (db) => {
    const rows = await db.query<{ id: string; from_addr: string; to_addr: string; subject: string | null; received_at: string; read_at: string | null; replied_at: string | null; snippet: string | null }>(
      `SELECT id, from_addr, to_addr, subject, received_at, read_at, replied_at, left(regexp_replace(COALESCE(body_text, ''), '\\s+', ' ', 'g'), 140) AS snippet
       FROM inbound_emails ${cond} ORDER BY received_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM inbound_emails ${cond}`, params);
    const unread = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM inbound_emails WHERE read_at IS NULL`);
    return { rows, total: total.n, unread: unread.n, page, pageSize: size };
  });
}

/** Loads one message and marks it read. */
export async function openInbound(id: string): Promise<InboundRow> {
  return withSystem(async (db) => {
    const row = await db.maybeOne<InboundRow>(`SELECT id, from_addr, to_addr, cc, subject, body_text, body_html, attachments, message_id, received_at, read_at, replied_at FROM inbound_emails WHERE id = $1`, [id]);
    if (!row) throw notFound("Message not found.");
    if (!row.read_at) await db.query(`UPDATE inbound_emails SET read_at = now() WHERE id = $1`, [id]);
    return row;
  });
}

// ---- Replying ---------------------------------------------------------------------------------------------------

export const replySchema = z.object({ body: z.string().trim().min(1).max(20000) });

/** Sends a reply from the address that received the mail (works via Brevo's authenticated boredroom.cc domain). */
export async function replyInbound(admin: Admin, id: string, input: z.infer<typeof replySchema>) {
  return withSystem(async (db) => {
    const msg = await db.maybeOne<InboundRow>(`SELECT id, from_addr, to_addr, subject, message_id FROM inbound_emails WHERE id = $1`, [id]);
    if (!msg) throw notFound("Message not found.");
    const to = extractEmail(msg.from_addr);
    const from = /@/.test(msg.to_addr) ? msg.to_addr : (process.env.MAIL_FROM ?? "Boredroom <info@boredroom.cc>");
    const subject = (msg.subject ?? "").toLowerCase().startsWith("re:") ? (msg.subject as string) : `Re: ${msg.subject ?? "(no subject)"}`;
    const html = `<div>${input.body.split(/\n/).map((l) => l.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]!))).join("<br>")}</div>`;
    const headers = msg.message_id ? { "In-Reply-To": msg.message_id, References: msg.message_id } : undefined;
    let status = "sent", error: string | null = null, providerId: string | null = null;
    try { const r = await mail().send({ to, from, subject, text: input.body, html, category: "admin", headers }); providerId = r.id; }
    catch (e) { status = "failed"; error = (e as Error).message.slice(0, 500); }
    await db.query(`INSERT INTO email_log(to_email, subject, category, provider, provider_id, status, error, sent_by) VALUES ($1, $2, 'admin', $3, $4, $5, $6, $7)`,
      [to, subject, (process.env.MAIL_PROVIDER ?? "smtp"), providerId, status, error, admin.user.authUserId]);
    if (status === "sent") await db.query(`UPDATE inbound_emails SET replied_at = now(), read_at = COALESCE(read_at, now()) WHERE id = $1`, [id]);
    await adminAudit(db, admin, { action: "inbox.replied", targetType: "inbound_email", targetId: id, targetLabel: to });
    if (status === "failed") throw new Error(`The reply could not be sent: ${error}`);
    return { ok: true as const };
  });
}
