/**
 * Marketing: contacts (waitlist and product users), dynamic segments, email templates, campaigns, lifecycle
 * automations, and the Brevo synchronisation. Sending goes through the platform's mail provider (Brevo's SMTP
 * relay in production) one recipient at a time from the worker, on the design-system template, and every send
 * is written to email_log. Unsubscribed contacts never receive marketing; transactional mail is unaffected.
 */
import { z } from "zod";
import { withSystem, type Db } from "@/server/db";
import { invalid, notFound } from "@/server/lib/errors";
import { mail } from "@/server/lib/mail";
import { renderEmail } from "@/server/lib/emails";
import { adminAudit, type Admin } from "@/server/admin/auth";
import { emitEvent } from "@/server/admin/events";
import { enqueueJob } from "@/server/services/common";
import { money } from "@/server/admin/billing";

// ---- Contacts -------------------------------------------------------------------------------------------------

export const contactSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  firstName: z.string().trim().max(80).optional().nullable(),
  lastName: z.string().trim().max(80).optional().nullable(),
  company: z.string().trim().max(160).optional().nullable(),
  companySize: z.string().trim().max(40).optional().nullable(),
  roleTitle: z.string().trim().max(80).optional().nullable(),
  country: z.string().trim().max(80).optional().nullable(),
  interest: z.string().trim().max(1000).optional().nullable(),
  source: z.string().trim().max(60).default("waitlist"),
  isWaitlist: z.boolean().default(true),
});

export type ContactRow = { id: string; email: string; first_name: string | null; last_name: string | null; company: string | null; company_size: string | null; role_title: string | null; country: string | null; interest: string | null; source: string; status: string; is_waitlist: boolean; auth_user_id: string | null; invited_at: string | null; unsubscribed_at: string | null; brevo_synced_at: string | null; brevo_error: string | null; created_at: string };

export type ContactFilter = { q?: string; status?: string; waitlist?: boolean; source?: string; companySize?: string; country?: string; from?: string; to?: string; page?: number; pageSize?: number };

function contactWhere(f: ContactFilter) {
  const where: string[] = []; const params: unknown[] = [];
  if (f.q?.trim()) { params.push(`%${f.q.trim()}%`); where.push(`(c.email::text ILIKE $${params.length} OR c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.company ILIKE $${params.length})`); }
  if (f.status && f.status !== "all") { params.push(f.status); where.push(`c.status = $${params.length}`); }
  if (f.waitlist !== undefined) { params.push(f.waitlist); where.push(`c.is_waitlist = $${params.length}`); }
  if (f.source) { params.push(f.source); where.push(`c.source = $${params.length}`); }
  if (f.companySize) { params.push(f.companySize); where.push(`c.company_size = $${params.length}`); }
  if (f.country) { params.push(f.country); where.push(`c.country ILIKE $${params.length}`); }
  if (f.from) { params.push(f.from); where.push(`c.created_at >= $${params.length}::timestamptz`); }
  if (f.to) { params.push(f.to); where.push(`c.created_at < $${params.length}::timestamptz + interval '1 day'`); }
  return { where: where.length ? ` WHERE ${where.join(" AND ")}` : "", params };
}

export async function listContacts(f: ContactFilter = {}) {
  const page = Math.max(1, f.page ?? 1), size = Math.min(200, Math.max(10, f.pageSize ?? 25));
  const { where, params } = contactWhere(f);
  return withSystem(async (db) => {
    const rows = await db.query<ContactRow>(`SELECT c.* FROM marketing_contacts c${where} ORDER BY c.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM marketing_contacts c${where}`, params);
    return { rows, total: total.n, page, pageSize: size };
  });
}

export async function exportContacts(f: ContactFilter = {}) {
  const { where, params } = contactWhere(f);
  return withSystem((db) => db.query<ContactRow>(`SELECT c.* FROM marketing_contacts c${where} ORDER BY c.created_at DESC LIMIT 20000`, params));
}

/** Creates or updates a contact by email. Used by the waitlist form, signups and imports. */
export async function upsertContact(db: Db, input: z.infer<typeof contactSchema> & { authUserId?: string | null; status?: string }) {
  const row = await db.one<{ id: string; created: boolean }>(
    `INSERT INTO marketing_contacts(email, first_name, last_name, company, company_size, role_title, country, interest, source, is_waitlist, auth_user_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, 'waiting'))
     ON CONFLICT (email) DO UPDATE SET
       first_name = COALESCE(EXCLUDED.first_name, marketing_contacts.first_name), last_name = COALESCE(EXCLUDED.last_name, marketing_contacts.last_name),
       company = COALESCE(EXCLUDED.company, marketing_contacts.company), company_size = COALESCE(EXCLUDED.company_size, marketing_contacts.company_size),
       role_title = COALESCE(EXCLUDED.role_title, marketing_contacts.role_title), country = COALESCE(EXCLUDED.country, marketing_contacts.country),
       interest = COALESCE(EXCLUDED.interest, marketing_contacts.interest), auth_user_id = COALESCE(EXCLUDED.auth_user_id, marketing_contacts.auth_user_id),
       is_waitlist = marketing_contacts.is_waitlist OR EXCLUDED.is_waitlist,
       status = CASE WHEN $12::text IS NOT NULL AND marketing_contacts.status <> 'unsubscribed' THEN $12 ELSE marketing_contacts.status END,
       updated_at = now()
     RETURNING id, (xmax = 0) AS created`,
    [input.email, input.firstName ?? null, input.lastName ?? null, input.company ?? null, input.companySize ?? null, input.roleTitle ?? null, input.country ?? null, input.interest ?? null, input.source, input.isWaitlist, input.authUserId ?? null, input.status ?? null]);
  await enqueueJob(db, "brevo.sync_contact", { contactId: row.id }, { dedupKey: `brevo.sync:${row.id}:${Date.now().toString(36).slice(0, 6)}` });
  return row;
}

export async function setContactStatus(admin: Admin | null, id: string, status: string, reason?: string | null) {
  await withSystem(async (db) => {
    const c = await db.maybeOne<{ email: string; status: string }>(`SELECT email, status FROM marketing_contacts WHERE id = $1`, [id]);
    if (!c) throw notFound("Contact not found.");
    await db.query(`UPDATE marketing_contacts SET status = $2, invited_at = CASE WHEN $2 = 'invited' THEN COALESCE(invited_at, now()) ELSE invited_at END, unsubscribed_at = CASE WHEN $2 = 'unsubscribed' THEN now() ELSE unsubscribed_at END, updated_at = now() WHERE id = $1`, [id, status]);
    await adminAudit(db, admin, { action: `contact.${status}`, targetType: "contact", targetId: id, targetLabel: c.email, before: { status: c.status }, after: { status }, reason });
    if (status === "invited") await emitEvent(db, "WAITLIST_INVITED", { contactId: id, email: c.email });
    await enqueueJob(db, "brevo.sync_contact", { contactId: id }, { dedupKey: `brevo.sync:${id}:${status}:${Date.now().toString(36).slice(0, 6)}` });
  });
}

/** Links a new account to its waitlist contact (same email) and moves it along the lifecycle. */
export async function contactRegistered(db: Db, authUserId: string, email: string, name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  const r = await upsertContact(db, { email, firstName: first || null, lastName: rest.join(" ") || null, source: "signup", isWaitlist: false, authUserId, status: "registered" });
  const c = await db.maybeOne<{ is_waitlist: boolean }>(`SELECT is_waitlist FROM marketing_contacts WHERE id = $1`, [r.id]);
  if (c?.is_waitlist) await emitEvent(db, "WAITLIST_CONVERTED", { contactId: r.id, authUserId, email });
  await emitEvent(db, "USER_CREATED", { authUserId, email, contactId: r.id });
}

export async function marketingMetrics() {
  return withSystem((db) => db.one<{ contacts: number; waitlist: number; waiting: number; invited: number; registered: number; activated: number; paid: number; unsubscribed: number; today: number; week: number; month: number; campaigns_sent: number; emails_sent: number; emails_failed: number }>(
    `SELECT (SELECT count(*)::int FROM marketing_contacts) AS contacts,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist) AS waitlist,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist AND status = 'waiting') AS waiting,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist AND status = 'invited') AS invited,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist AND status IN ('registered','activated','trial','paid')) AS registered,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist AND status IN ('activated','trial','paid')) AS activated,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist AND status = 'paid') AS paid,
            (SELECT count(*)::int FROM marketing_contacts WHERE status = 'unsubscribed') AS unsubscribed,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist AND created_at::date = CURRENT_DATE) AS today,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist AND created_at > now() - interval '7 days') AS week,
            (SELECT count(*)::int FROM marketing_contacts WHERE is_waitlist AND created_at > now() - interval '30 days') AS month,
            (SELECT count(*)::int FROM campaigns WHERE status = 'sent') AS campaigns_sent,
            (SELECT count(*)::int FROM email_log WHERE status = 'sent' AND category IN ('marketing','lifecycle','billing')) AS emails_sent,
            (SELECT count(*)::int FROM email_log WHERE status = 'failed') AS emails_failed`));
}

// ---- Segments ---------------------------------------------------------------------------------------------------

/** A segment is a list of conditions, all of which must hold. Evaluated in SQL against contacts joined to their account. */
export const segmentRuleSchema = z.object({
  field: z.enum(["status", "is_waitlist", "source", "company_size", "country", "account_age_days", "plan", "subscription_status", "expires_within_days", "inactive_days", "role"]),
  op: z.enum(["eq", "neq", "lte", "gte", "contains"]),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export const segmentSchema = z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).nullable().optional(), rules: z.array(segmentRuleSchema).max(12) });
export type SegmentRule = z.infer<typeof segmentRuleSchema>;

const CONTACT_BASE = `
  FROM marketing_contacts c
  LEFT JOIN auth_users u ON u.id = c.auth_user_id
  LEFT JOIN profiles pr ON pr.auth_user_id = u.id
  LEFT JOIN LATERAL (SELECT m.role, m.organisation_id FROM memberships m WHERE m.user_id = pr.id AND m.status = 'active' ORDER BY m.created_at LIMIT 1) mem ON true
  LEFT JOIN subscriptions s ON s.organisation_id = mem.organisation_id
  LEFT JOIN plans p ON p.id = s.plan_id`;

function ruleSql(r: SegmentRule, params: unknown[]): string {
  const push = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const cmp = (col: string, cast = "") => {
    switch (r.op) {
      case "eq": return `${col} = ${push(r.value)}${cast}`;
      case "neq": return `${col} <> ${push(r.value)}${cast}`;
      case "lte": return `${col} <= ${push(r.value)}${cast}`;
      case "gte": return `${col} >= ${push(r.value)}${cast}`;
      case "contains": return `${col}::text ILIKE ${push(`%${r.value}%`)}`;
    }
  };
  switch (r.field) {
    case "status": return cmp("c.status");
    case "is_waitlist": return cmp("c.is_waitlist", "::boolean");
    case "source": return cmp("c.source");
    case "company_size": return cmp("c.company_size");
    case "country": return cmp("c.country");
    case "role": return cmp("mem.role");
    case "plan": return cmp("p.code");
    case "subscription_status": return cmp("s.status");
    case "account_age_days": return cmp("EXTRACT(EPOCH FROM (now() - u.created_at)) / 86400", "::numeric");
    case "expires_within_days": return `s.current_period_end IS NOT NULL AND s.current_period_end BETWEEN now() AND now() + (${push(String(Number(r.value)))} || ' days')::interval`;
    case "inactive_days": return `COALESCE((SELECT MAX(last_seen_at) FROM auth_sessions a WHERE a.user_id = u.id), u.created_at) < now() - (${push(String(Number(r.value)))} || ' days')::interval`;
  }
}

export function audienceSql(audience: { kind: string; segmentId?: string | null }, rules: SegmentRule[] = []): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const conds: string[] = [`c.status <> 'unsubscribed'`];
  switch (audience.kind) {
    case "waitlist": conds.push(`c.is_waitlist AND c.status IN ('waiting','invited')`); break;
    case "free": conds.push(`p.code = 'free'`); break;
    case "paid": conds.push(`p.monthly_price > 0 AND s.status = 'active'`); break;
    case "trial": conds.push(`s.status = 'trial'`); break;
    case "expiring": conds.push(`s.current_period_end BETWEEN now() AND now() + interval '14 days'`); break;
    case "users": conds.push(`c.auth_user_id IS NOT NULL`); break;
    case "segment": for (const r of rules) conds.push(`(${ruleSql(r, params)})`); break;
    default: break; // all
  }
  return { sql: `${CONTACT_BASE} WHERE ${conds.join(" AND ")}`, params };
}

export async function listSegments() {
  return withSystem(async (db) => {
    const segs = await db.query<{ id: string; name: string; description: string | null; rules: SegmentRule[]; created_at: string }>(`SELECT id, name, description, rules, created_at FROM marketing_segments ORDER BY name`);
    const out = [];
    for (const s of segs) {
      const a = audienceSql({ kind: "segment" }, s.rules);
      const n = await db.one<{ n: number }>(`SELECT count(*)::int AS n ${a.sql}`, a.params);
      out.push({ ...s, size: n.n });
    }
    return out;
  });
}

export async function saveSegment(admin: Admin, id: string | null, input: z.infer<typeof segmentSchema>) {
  return withSystem(async (db) => {
    const row = id
      ? await db.one<{ id: string }>(`UPDATE marketing_segments SET name = $2, description = $3, rules = $4, updated_at = now() WHERE id = $1 RETURNING id`, [id, input.name, input.description ?? null, JSON.stringify(input.rules)])
      : await db.one<{ id: string }>(`INSERT INTO marketing_segments(name, description, rules) VALUES ($1, $2, $3) RETURNING id`, [input.name, input.description ?? null, JSON.stringify(input.rules)]);
    await adminAudit(db, admin, { action: id ? "segment.updated" : "segment.created", targetType: "segment", targetId: row.id, targetLabel: input.name, after: input });
    return row;
  });
}

export async function deleteSegment(admin: Admin, id: string) {
  await withSystem(async (db) => {
    const s = await db.maybeOne<{ name: string }>(`DELETE FROM marketing_segments WHERE id = $1 RETURNING name`, [id]);
    if (s) await adminAudit(db, admin, { action: "segment.deleted", targetType: "segment", targetId: id, targetLabel: s.name });
  });
}

// ---- Templates -----------------------------------------------------------------------------------------------------

export const templateSchema = z.object({ code: z.string().trim().regex(/^[a-z0-9_]{2,40}$/), name: z.string().trim().min(1).max(80), category: z.enum(["marketing", "lifecycle", "billing", "transactional"]), subject: z.string().trim().min(1).max(200), eyebrow: z.string().trim().max(40).nullable().optional(), title: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(8000), ctaLabel: z.string().trim().max(60).nullable().optional(), ctaUrl: z.string().trim().max(500).nullable().optional() });
export type TemplateRow = { id: string; code: string; name: string; category: string; subject: string; eyebrow: string | null; title: string; body: string; cta_label: string | null; cta_url: string | null; created_at: string; updated_at: string };

export const listTemplates = () => withSystem((db) => db.query<TemplateRow>(`SELECT * FROM email_templates ORDER BY category, name`));

export async function saveTemplate(admin: Admin, id: string | null, input: z.infer<typeof templateSchema>) {
  return withSystem(async (db) => {
    const row = id
      ? await db.one<{ id: string }>(`UPDATE email_templates SET code = $2, name = $3, category = $4, subject = $5, eyebrow = $6, title = $7, body = $8, cta_label = $9, cta_url = $10, updated_at = now() WHERE id = $1 RETURNING id`, [id, input.code, input.name, input.category, input.subject, input.eyebrow ?? null, input.title, input.body, input.ctaLabel ?? null, input.ctaUrl ?? null])
      : await db.one<{ id: string }>(`INSERT INTO email_templates(code, name, category, subject, eyebrow, title, body, cta_label, cta_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [input.code, input.name, input.category, input.subject, input.eyebrow ?? null, input.title, input.body, input.ctaLabel ?? null, input.ctaUrl ?? null]);
    await adminAudit(db, admin, { action: id ? "template.updated" : "template.created", targetType: "template", targetId: row.id, targetLabel: input.name });
    return row;
  });
}

export type Vars = Record<string, string | number | boolean | null | undefined>;
export function fill(text: string, vars: Vars) { return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => String(vars[k] ?? "")); }

/** Renders a template (or an inline campaign body) with variables into the design-system email. */
export function renderTemplate(t: { subject: string; eyebrow?: string | null; title: string; body: string; cta_label?: string | null; cta_url?: string | null }, vars: Vars, reason?: string) {
  const v: Vars = { app_url: process.env.APP_ORIGIN ?? "http://localhost:3000", ...vars };
  const paragraphs = fill(t.body, v).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const cta = t.cta_label && t.cta_url ? { label: fill(t.cta_label, v), url: fill(t.cta_url, v) } : undefined;
  const { html, text } = renderEmail({ eyebrow: t.eyebrow ? fill(t.eyebrow, v) : undefined, title: fill(t.title, v), intro: paragraphs, cta, reason, preheader: paragraphs[0]?.slice(0, 120) });
  return { subject: fill(t.subject, v), html, text };
}

/** Sends one email through the platform provider and writes the log row. Never throws to the caller; the log carries the outcome. */
export async function sendLogged(db: Db, m: { to: string; subject: string; html: string; text: string; category: string; campaignId?: string | null; automationId?: string | null; organisationId?: string | null; sentBy?: string | null }) {
  const provider = process.env.MAIL_PROVIDER ?? "sink";
  try {
    const r = await mail().send({ to: m.to, subject: m.subject, text: m.text, html: m.html, category: m.category });
    await db.query(`INSERT INTO email_log(to_email, subject, category, provider, provider_id, status, campaign_id, automation_id, organisation_id, sent_by) VALUES ($1, $2, $3, $4, $5, 'sent', $6, $7, $8, $9)`, [m.to, m.subject, m.category, provider, r.id, m.campaignId ?? null, m.automationId ?? null, m.organisationId ?? null, m.sentBy ?? null]);
    return { ok: true as const, id: r.id };
  } catch (err) {
    await db.query(`INSERT INTO email_log(to_email, subject, category, provider, status, error, campaign_id, automation_id, organisation_id, sent_by) VALUES ($1, $2, $3, $4, 'failed', $5, $6, $7, $8, $9)`, [m.to, m.subject, m.category, provider, (err as Error).message.slice(0, 500), m.campaignId ?? null, m.automationId ?? null, m.organisationId ?? null, m.sentBy ?? null]);
    return { ok: false as const, error: (err as Error).message };
  }
}

/** Standard variables for a contact, with account and billing details when it has an account. */
export async function contactVars(db: Db, contactId: string): Promise<Vars & { email: string; unsubscribed: boolean }> {
  const c = await db.one<{ email: string; first_name: string | null; last_name: string | null; company: string | null; status: string; org_name: string | null; plan_name: string | null; period_end: string | null; amount: number | null; currency: string | null }>(
    `SELECT c.email, c.first_name, c.last_name, c.company, c.status, o.name AS org_name, p.name AS plan_name, s.current_period_end AS period_end,
            CASE WHEN s.billing_interval = 'annual' THEN p.annual_price ELSE p.monthly_price END AS amount, p.currency
     ${CONTACT_BASE} LEFT JOIN organisations o ON o.id = mem.organisation_id WHERE c.id = $1`, [contactId]);
  return { email: c.email, unsubscribed: c.status === "unsubscribed", first_name: c.first_name ?? c.email.split("@")[0], last_name: c.last_name ?? "", organization_name: c.org_name ?? c.company ?? "your organisation", plan_name: c.plan_name ?? "Free", subscription_expiry: c.period_end ? new Date(c.period_end).toDateString() : "", renewal_amount: c.amount != null ? money(c.amount, c.currency ?? "NGN") : "" };
}

// ---- Campaigns -----------------------------------------------------------------------------------------------------

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120), subject: z.string().trim().min(1).max(200), templateId: z.string().uuid().nullable().optional(),
  eyebrow: z.string().trim().max(40).nullable().optional(), title: z.string().trim().max(120).nullable().optional(), body: z.string().trim().max(8000).nullable().optional(),
  ctaLabel: z.string().trim().max(60).nullable().optional(), ctaUrl: z.string().trim().max(500).nullable().optional(),
  audience: z.object({ kind: z.enum(["all", "waitlist", "users", "free", "paid", "trial", "expiring", "segment"]), segmentId: z.string().uuid().nullable().optional() }),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});
export type CampaignRow = { id: string; name: string; subject: string; template_id: string | null; eyebrow: string | null; title: string | null; body: string | null; cta_label: string | null; cta_url: string | null; audience: { kind: string; segmentId?: string | null }; status: string; scheduled_at: string | null; started_at: string | null; finished_at: string | null; recipients: number; sent: number; failed: number; skipped: number; created_at: string; template_name: string | null };

export const listCampaigns = () => withSystem((db) => db.query<CampaignRow>(`SELECT c.*, t.name AS template_name FROM campaigns c LEFT JOIN email_templates t ON t.id = c.template_id ORDER BY c.created_at DESC`));

export async function campaignDetail(id: string) {
  return withSystem(async (db) => {
    const c = await db.maybeOne<CampaignRow>(`SELECT c.*, t.name AS template_name FROM campaigns c LEFT JOIN email_templates t ON t.id = c.template_id WHERE c.id = $1`, [id]);
    if (!c) throw notFound("Campaign not found.");
    const recipients = await db.query<{ email: string; status: string; error: string | null; sent_at: string | null }>(`SELECT email, status, error, sent_at FROM campaign_recipients WHERE campaign_id = $1 ORDER BY sent_at DESC NULLS LAST LIMIT 500`, [id]);
    return { campaign: c, recipients, ...(await audienceCount(db, c.audience)) };
  });
}

async function audienceCount(db: Db, audience: { kind: string; segmentId?: string | null }) {
  const rules = audience.kind === "segment" && audience.segmentId ? (await db.maybeOne<{ rules: SegmentRule[] }>(`SELECT rules FROM marketing_segments WHERE id = $1`, [audience.segmentId]))?.rules ?? [] : [];
  const a = audienceSql(audience, rules);
  const n = await db.one<{ n: number }>(`SELECT count(*)::int AS n ${a.sql}`, a.params);
  const unsub = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM marketing_contacts WHERE status = 'unsubscribed'`);
  return { audienceSize: n.n, unsubscribed: unsub.n };
}

/** The effective content of a campaign: its template's, overridden by anything set on the campaign itself. */
async function campaignContent(db: Db, c: CampaignRow) {
  const t = c.template_id ? await db.maybeOne<TemplateRow>(`SELECT * FROM email_templates WHERE id = $1`, [c.template_id]) : null;
  return { subject: c.subject || t?.subject || "", eyebrow: c.eyebrow ?? t?.eyebrow ?? null, title: c.title || t?.title || c.subject, body: c.body || t?.body || "", cta_label: c.cta_label ?? t?.cta_label ?? null, cta_url: c.cta_url ?? t?.cta_url ?? null };
}

export async function saveCampaign(admin: Admin, id: string | null, input: z.infer<typeof campaignSchema>) {
  return withSystem(async (db) => {
    if (id) { const cur = await db.maybeOne<{ status: string }>(`SELECT status FROM campaigns WHERE id = $1`, [id]); if (!cur) throw notFound("Campaign not found."); if (cur.status === "sending" || cur.status === "sent") throw invalid("A campaign that has been sent cannot be edited. Duplicate it instead."); }
    const row = id
      ? await db.one<{ id: string }>(`UPDATE campaigns SET name = $2, subject = $3, template_id = $4, eyebrow = $5, title = $6, body = $7, cta_label = $8, cta_url = $9, audience = $10, updated_at = now() WHERE id = $1 RETURNING id`, [id, input.name, input.subject, input.templateId ?? null, input.eyebrow ?? null, input.title ?? null, input.body ?? null, input.ctaLabel ?? null, input.ctaUrl ?? null, JSON.stringify(input.audience)])
      : await db.one<{ id: string }>(`INSERT INTO campaigns(name, subject, template_id, eyebrow, title, body, cta_label, cta_url, audience, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`, [input.name, input.subject, input.templateId ?? null, input.eyebrow ?? null, input.title ?? null, input.body ?? null, input.ctaLabel ?? null, input.ctaUrl ?? null, JSON.stringify(input.audience), admin.user.authUserId]);
    await adminAudit(db, admin, { action: id ? "campaign.updated" : "campaign.created", targetType: "campaign", targetId: row.id, targetLabel: input.name });
    return row;
  });
}

export async function previewCampaign(id: string) {
  return withSystem(async (db) => {
    const c = await db.maybeOne<CampaignRow>(`SELECT c.*, NULL AS template_name FROM campaigns c WHERE c.id = $1`, [id]);
    if (!c) throw notFound("Campaign not found.");
    const content = await campaignContent(db, c);
    return renderTemplate(content, { first_name: "Ada", organization_name: "Acme Ltd", plan_name: "Pro", subscription_expiry: "18 Oct 2026", renewal_amount: "₦15,000" }, "You received this because you asked to hear from Boredroom.");
  });
}

export async function sendCampaignTest(admin: Admin, id: string, to: string) {
  await withSystem(async (db) => {
    const c = await db.maybeOne<CampaignRow>(`SELECT c.*, NULL AS template_name FROM campaigns c WHERE c.id = $1`, [id]);
    if (!c) throw notFound("Campaign not found.");
    const r = renderTemplate(await campaignContent(db, c), { first_name: admin.user.displayName.split(" ")[0], organization_name: "Acme Ltd", plan_name: "Pro", subscription_expiry: "18 Oct 2026", renewal_amount: "₦15,000" }, "This is a test send from the Control Center.");
    const out = await sendLogged(db, { to, subject: `[Test] ${r.subject}`, html: r.html, text: r.text, category: "marketing", campaignId: id, sentBy: admin.user.authUserId });
    if (!out.ok) throw invalid(`The test could not be sent: ${out.error}`);
  });
}

/** Queues the campaign: the audience is frozen into campaign_recipients now, and the worker sends in batches. */
export async function launchCampaign(admin: Admin, id: string, when: string | null) {
  await withSystem(async (db) => {
    const c = await db.maybeOne<CampaignRow>(`SELECT c.*, NULL AS template_name FROM campaigns c WHERE c.id = $1 FOR UPDATE`, [id]);
    if (!c) throw notFound("Campaign not found.");
    if (c.status !== "draft" && c.status !== "scheduled") throw invalid("This campaign has already been sent.");
    const rules = c.audience.kind === "segment" && c.audience.segmentId ? (await db.maybeOne<{ rules: SegmentRule[] }>(`SELECT rules FROM marketing_segments WHERE id = $1`, [c.audience.segmentId]))?.rules ?? [] : [];
    const a = audienceSql(c.audience, rules);
    await db.query(`DELETE FROM campaign_recipients WHERE campaign_id = $1`, [id]);
    const ins = await db.query<{ id: string }>(`INSERT INTO campaign_recipients(campaign_id, contact_id, email) SELECT $${a.params.length + 1}, c.id, c.email ${a.sql} ON CONFLICT DO NOTHING RETURNING id`, [...a.params, id]);
    const scheduled = when ? new Date(when) : null;
    await db.query(`UPDATE campaigns SET status = $2, scheduled_at = $3, recipients = $4, sent = 0, failed = 0, skipped = 0, updated_at = now() WHERE id = $1`, [id, scheduled && scheduled > new Date() ? "scheduled" : "sending", scheduled?.toISOString() ?? null, ins.length]);
    await enqueueJob(db, "campaign.send", { campaignId: id }, { dedupKey: `campaign.send:${id}`, runAt: scheduled && scheduled > new Date() ? scheduled : undefined });
    await adminAudit(db, admin, { action: scheduled && scheduled > new Date() ? "campaign.scheduled" : "campaign.sent", targetType: "campaign", targetId: id, targetLabel: c.name, metadata: { recipients: ins.length, scheduledAt: scheduled?.toISOString() ?? null, audience: c.audience } });
  });
}

export async function cancelCampaign(admin: Admin, id: string) {
  await withSystem(async (db) => {
    const c = await db.maybeOne<{ name: string; status: string }>(`SELECT name, status FROM campaigns WHERE id = $1`, [id]);
    if (!c) throw notFound("Campaign not found.");
    if (c.status !== "scheduled") throw invalid("Only a scheduled campaign can be cancelled.");
    await db.query(`UPDATE campaigns SET status = 'cancelled', updated_at = now() WHERE id = $1`, [id]);
    await db.query(`DELETE FROM jobs WHERE dedup_key = $1 AND state = 'pending'`, [`campaign.send:${id}`]);
    await adminAudit(db, admin, { action: "campaign.cancelled", targetType: "campaign", targetId: id, targetLabel: c.name });
  });
}

/** Worker: sends the queued recipients of a campaign, a batch at a time, and closes it when none are left. */
export async function runCampaignBatch(campaignId: string, batch = 40): Promise<{ remaining: number }> {
  return withSystem(async (db) => {
    const c = await db.maybeOne<CampaignRow>(`SELECT c.*, NULL AS template_name FROM campaigns c WHERE c.id = $1`, [campaignId]);
    if (!c || c.status === "cancelled") return { remaining: 0 };
    if (c.status !== "sending") await db.query(`UPDATE campaigns SET status = 'sending', started_at = COALESCE(started_at, now()), updated_at = now() WHERE id = $1`, [campaignId]);
    const content = await campaignContent(db, c);
    const queued = await db.query<{ id: string; contact_id: string | null; email: string }>(`SELECT id, contact_id, email FROM campaign_recipients WHERE campaign_id = $1 AND status = 'queued' ORDER BY id LIMIT $2`, [campaignId, batch]);
    for (const r of queued) {
      const vars = r.contact_id ? await contactVars(db, r.contact_id) : { email: r.email, unsubscribed: false, first_name: r.email.split("@")[0] };
      if (vars.unsubscribed) { await db.query(`UPDATE campaign_recipients SET status = 'skipped', error = 'unsubscribed' WHERE id = $1`, [r.id]); continue; }
      const m = renderTemplate(content, vars, "You received this because you asked to hear from Boredroom. Reply with “unsubscribe” to stop.");
      const out = await sendLogged(db, { to: r.email, subject: m.subject, html: m.html, text: m.text, category: "marketing", campaignId });
      await db.query(`UPDATE campaign_recipients SET status = $2, provider_id = $3, error = $4, sent_at = now() WHERE id = $1`, [r.id, out.ok ? "sent" : "failed", out.ok ? out.id : null, out.ok ? null : out.error.slice(0, 500)]);
    }
    const counts = await db.one<{ sent: number; failed: number; skipped: number; queued: number }>(`SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent, count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'skipped')::int AS skipped, count(*) FILTER (WHERE status = 'queued')::int AS queued FROM campaign_recipients WHERE campaign_id = $1`, [campaignId]);
    await db.query(`UPDATE campaigns SET sent = $2, failed = $3, skipped = $4, status = CASE WHEN $5 = 0 THEN 'sent' ELSE status END, finished_at = CASE WHEN $5 = 0 THEN now() ELSE finished_at END, updated_at = now() WHERE id = $1`, [campaignId, counts.sent, counts.failed, counts.skipped, counts.queued]);
    return { remaining: counts.queued };
  });
}

// ---- Automations -----------------------------------------------------------------------------------------------------

export const automationSchema = z.object({ name: z.string().trim().min(1).max(120), trigger: z.enum(["user_created", "account_age_days", "user_inactive_days", "subscription_expiring_days", "subscription_expired", "payment_failed", "payment_successful", "waitlist_joined"]), triggerValue: z.number().int().min(0).max(3650).nullable().optional(), templateId: z.string().uuid(), enabled: z.boolean().default(true) });
export type AutomationRow = { id: string; name: string; trigger: string; trigger_value: number | null; template_id: string; template_name: string; enabled: boolean; runs: number; last_run: string | null; created_at: string };

export const listAutomations = () => withSystem((db) => db.query<AutomationRow>(`SELECT a.*, t.name AS template_name, (SELECT count(*)::int FROM automation_runs r WHERE r.automation_id = a.id) AS runs, (SELECT MAX(ran_at) FROM automation_runs r WHERE r.automation_id = a.id) AS last_run FROM automations a JOIN email_templates t ON t.id = a.template_id ORDER BY a.trigger, a.trigger_value`));

export async function saveAutomation(admin: Admin, id: string | null, input: z.infer<typeof automationSchema>) {
  return withSystem(async (db) => {
    const row = id
      ? await db.one<{ id: string }>(`UPDATE automations SET name = $2, trigger = $3, trigger_value = $4, template_id = $5, enabled = $6, updated_at = now() WHERE id = $1 RETURNING id`, [id, input.name, input.trigger, input.triggerValue ?? null, input.templateId, input.enabled])
      : await db.one<{ id: string }>(`INSERT INTO automations(name, trigger, trigger_value, template_id, enabled) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [input.name, input.trigger, input.triggerValue ?? null, input.templateId, input.enabled]);
    await adminAudit(db, admin, { action: id ? "automation.updated" : "automation.created", targetType: "automation", targetId: row.id, targetLabel: input.name, after: input });
    return row;
  });
}

/** Runs one automation for one subject once; the unique (automation, subject) row guards against repeats. */
async function runAutomationFor(db: Db, a: { id: string; template_id: string; name: string }, subjectKey: string, contactId: string, organisationId: string | null, extra: Vars = {}) {
  const claimed = await db.query<{ id: string }>(`INSERT INTO automation_runs(automation_id, subject_key, email, status) SELECT $1, $2, c.email, 'skipped' FROM marketing_contacts c WHERE c.id = $3 ON CONFLICT DO NOTHING RETURNING id`, [a.id, subjectKey, contactId]);
  if (claimed.length === 0) return false;
  const t = await db.one<TemplateRow>(`SELECT * FROM email_templates WHERE id = $1`, [a.template_id]);
  const vars = await contactVars(db, contactId);
  // Lifecycle and marketing mail respects unsubscribes; billing and transactional mail does not.
  if (vars.unsubscribed && (t.category === "marketing" || t.category === "lifecycle")) { await db.query(`UPDATE automation_runs SET status = 'skipped', error = 'unsubscribed' WHERE id = $1`, [claimed[0].id]); return false; }
  const m = renderTemplate(t, { ...vars, ...extra }, t.category === "billing" ? "You received this because your organisation has a Boredroom subscription." : t.category === "transactional" ? "You received this because of an action on your Boredroom account." : "You received this because you have a Boredroom account.");
  const out = await sendLogged(db, { to: vars.email, subject: m.subject, html: m.html, text: m.text, category: t.category, automationId: a.id, organisationId });
  await db.query(`UPDATE automation_runs SET status = $2, error = $3, ran_at = now() WHERE id = $1`, [claimed[0].id, out.ok ? "sent" : "failed", out.ok ? null : out.error.slice(0, 500)]);
  return out.ok;
}

/** Event-driven automations, called by the worker for each platform event. */
export async function automationsForEvent(type: string, payload: Record<string, unknown>) {
  const map: Record<string, string> = { USER_CREATED: "user_created", WAITLIST_JOINED: "waitlist_joined", SUBSCRIPTION_EXPIRED: "subscription_expired", PAYMENT_FAILED: "payment_failed", PAYMENT_SUCCESSFUL: "payment_successful" };
  const trigger = map[type];
  if (!trigger) return;
  await withSystem(async (db) => {
    const autos = await db.query<{ id: string; template_id: string; name: string }>(`SELECT id, template_id, name FROM automations WHERE enabled AND trigger = $1`, [trigger]);
    if (autos.length === 0) return;
    const contactIds: string[] = [];
    if (payload.contactId) contactIds.push(String(payload.contactId));
    else if (payload.organisationId) {
      const owners = await db.query<{ id: string }>(`SELECT c.id FROM marketing_contacts c JOIN auth_users u ON u.id = c.auth_user_id JOIN profiles pr ON pr.auth_user_id = u.id JOIN memberships m ON m.user_id = pr.id WHERE m.organisation_id = $1 AND m.role IN ('owner','hr') AND m.status = 'active'`, [String(payload.organisationId)]);
      contactIds.push(...owners.map((o) => o.id));
    } else if (payload.authUserId) {
      const c = await db.maybeOne<{ id: string }>(`SELECT id FROM marketing_contacts WHERE auth_user_id = $1`, [String(payload.authUserId)]);
      if (c) contactIds.push(c.id);
    }
    const extra: Vars = { payment_reference: (payload.reference as string) ?? "", renewal_amount: typeof payload.amount === "number" ? money(payload.amount, (payload.currency as string) ?? "NGN") : undefined, reason: (payload.reason as string) ?? "" };
    for (const a of autos) for (const cid of contactIds) await runAutomationFor(db, a, `${type}:${payload.eventId ?? cid}`, cid, (payload.organisationId as string) ?? null, extra);
  });
}

/** Time-driven automations, run by the worker's schedule: account age, inactivity, subscription expiry. */
export async function runScheduledAutomations() {
  return withSystem(async (db) => {
    const autos = await db.query<{ id: string; template_id: string; name: string; trigger: string; trigger_value: number | null }>(`SELECT id, template_id, name, trigger, trigger_value FROM automations WHERE enabled AND trigger IN ('account_age_days','user_inactive_days','subscription_expiring_days')`);
    let ran = 0;
    for (const a of autos) {
      const days = a.trigger_value ?? 0;
      let rows: { contact_id: string; organisation_id: string | null; key: string }[] = [];
      if (a.trigger === "account_age_days") rows = await db.query(`SELECT c.id AS contact_id, NULL::uuid AS organisation_id, u.id::text AS key FROM marketing_contacts c JOIN auth_users u ON u.id = c.auth_user_id WHERE u.status = 'active' AND u.created_at::date = (CURRENT_DATE - $1::int)`, [days]);
      else if (a.trigger === "user_inactive_days") rows = await db.query(`SELECT c.id AS contact_id, NULL::uuid AS organisation_id, u.id::text || ':' || CURRENT_DATE::text AS key FROM marketing_contacts c JOIN auth_users u ON u.id = c.auth_user_id WHERE u.status = 'active' AND COALESCE((SELECT MAX(last_seen_at) FROM auth_sessions s WHERE s.user_id = u.id), u.created_at)::date = (CURRENT_DATE - $1::int)`, [days]);
      else rows = await db.query(`SELECT c.id AS contact_id, s.organisation_id, s.organisation_id::text || ':' || s.current_period_end::date::text AS key FROM subscriptions s JOIN memberships m ON m.organisation_id = s.organisation_id AND m.role = 'owner' AND m.status = 'active' JOIN profiles pr ON pr.id = m.user_id JOIN marketing_contacts c ON c.auth_user_id = pr.auth_user_id WHERE s.status IN ('active','trial','past_due') AND s.current_period_end::date = (CURRENT_DATE + $1::int)`, [days]);
      for (const r of rows) if (await runAutomationFor(db, a, r.key, r.contact_id, r.organisation_id)) ran++;
    }
    return ran;
  });
}

/** Marks subscriptions past their period end as expired and raises the event, once per subscription. */
export async function expireSubscriptions() {
  return withSystem(async (db) => {
    const grace = (await db.maybeOne<{ value: { grace_days?: number } }>(`SELECT value FROM platform_settings WHERE key = 'billing'`))?.value?.grace_days ?? 3;
    const rows = await db.query<{ organisation_id: string; status: string }>(`UPDATE subscriptions SET status = 'expired', updated_at = now() WHERE status IN ('active','trial','past_due','payment_failed') AND current_period_end IS NOT NULL AND current_period_end < now() - ($1 || ' days')::interval RETURNING organisation_id, status`, [String(grace)]);
    for (const r of rows) await emitEvent(db, "SUBSCRIPTION_EXPIRED", { organisationId: r.organisation_id });
    return rows.length;
  });
}

// ---- Brevo --------------------------------------------------------------------------------------------------------------

export function brevoConfigured(env: Record<string, string | undefined> = process.env) { return !!env.BREVO_API_KEY; }

async function brevo<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const key = process.env.BREVO_API_KEY;
  if (!key) throw new Error("BREVO_API_KEY is not set");
  const res = await fetch(`https://api.brevo.com/v3${path}`, { method: init.method ?? "GET", headers: { "api-key": key, "content-type": "application/json", accept: "application/json" }, body: init.body ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(15_000) });
  if (res.status === 204) return {} as T;
  const body = (await res.json().catch(() => ({}))) as T & { message?: string; code?: string };
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${body.message ?? body.code ?? "error"}`);
  return body;
}

export async function brevoAccount() { return brevo<{ email: string; companyName: string; plan: { type: string }[] }>("/account"); }

/** Pushes one contact and its attributes to Brevo (and the configured list). Errors are kept on the row, never thrown to the worker. */
export async function syncContactToBrevo(contactId: string) {
  if (!brevoConfigured()) return { skipped: true };
  return withSystem(async (db) => {
    const c = await db.maybeOne<{ email: string; first_name: string | null; last_name: string | null; company: string | null; status: string; is_waitlist: boolean; country: string | null; created_at: string; org_name: string | null; plan: string | null; sub_status: string | null; period_end: string | null; last_seen: string | null }>(
      `SELECT c.email, c.first_name, c.last_name, c.company, c.status, c.is_waitlist, c.country, c.created_at, o.name AS org_name, p.name AS plan, s.status AS sub_status, s.current_period_end AS period_end, (SELECT MAX(last_seen_at) FROM auth_sessions a WHERE a.user_id = u.id) AS last_seen
       ${CONTACT_BASE} LEFT JOIN organisations o ON o.id = mem.organisation_id WHERE c.id = $1`, [contactId]);
    if (!c) return { skipped: true };
    const listId = Number(process.env.BREVO_LIST_ID ?? 0) || undefined;
    try {
      const r = await brevo<{ id?: number }>("/contacts", { method: "POST", body: {
        email: c.email, updateEnabled: true, emailBlacklisted: c.status === "unsubscribed", listIds: listId ? [listId] : undefined,
        attributes: { FIRSTNAME: c.first_name ?? "", LASTNAME: c.last_name ?? "", ORGANIZATION: c.org_name ?? c.company ?? "", PLAN: c.plan ?? "", SUBSCRIPTION_STATUS: c.sub_status ?? "", SUBSCRIPTION_EXPIRY: c.period_end ? c.period_end.slice(0, 10) : "", SIGNUP_DATE: c.created_at.slice(0, 10), LAST_ACTIVITY: c.last_seen ? c.last_seen.slice(0, 10) : "", COUNTRY: c.country ?? "", STATUS: c.status, WAITLIST: c.is_waitlist ? "yes" : "no" },
      } });
      await db.query(`UPDATE marketing_contacts SET brevo_id = COALESCE($2, brevo_id), brevo_synced_at = now(), brevo_error = NULL WHERE id = $1`, [contactId, r.id ?? null]);
      return { ok: true };
    } catch (err) {
      await db.query(`UPDATE marketing_contacts SET brevo_error = $2 WHERE id = $1`, [contactId, (err as Error).message.slice(0, 300)]);
      throw err;
    }
  });
}

export async function emailLog(f: { q?: string; status?: string; category?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, f.page ?? 1), size = Math.min(200, Math.max(10, f.pageSize ?? 50));
  const where: string[] = []; const params: unknown[] = [];
  if (f.q?.trim()) { params.push(`%${f.q.trim()}%`); where.push(`(l.to_email::text ILIKE $${params.length} OR l.subject ILIKE $${params.length})`); }
  if (f.status && f.status !== "all") { params.push(f.status); where.push(`l.status = $${params.length}`); }
  if (f.category && f.category !== "all") { params.push(f.category); where.push(`l.category = $${params.length}`); }
  const w = where.length ? ` WHERE ${where.join(" AND ")}` : "";
  return withSystem(async (db) => {
    const rows = await db.query<{ id: string; to_email: string; subject: string; category: string; provider: string; status: string; error: string | null; created_at: string; campaign_name: string | null; sent_by_email: string | null }>(`SELECT l.*, c.name AS campaign_name, u.email AS sent_by_email FROM email_log l LEFT JOIN campaigns c ON c.id = l.campaign_id LEFT JOIN auth_users u ON u.id = l.sent_by${w} ORDER BY l.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, params);
    const total = await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM email_log l${w}`, params);
    return { rows, total: total.n, page, pageSize: size };
  });
}

/** Compose: one email to an address, a contact, or every owner of an organisation. */
export const composeSchema = z.object({ to: z.string().trim().email().optional(), organisationId: z.string().uuid().optional(), contactId: z.string().uuid().optional(), templateId: z.string().uuid().nullable().optional(), subject: z.string().trim().min(1).max(200), title: z.string().trim().max(120).optional(), body: z.string().trim().min(1).max(8000), ctaLabel: z.string().trim().max(60).nullable().optional(), ctaUrl: z.string().trim().max(500).nullable().optional() });

export async function composeAndSend(admin: Admin, input: z.infer<typeof composeSchema>) {
  return withSystem(async (db) => {
    let recipients: { email: string; contactId: string | null; organisationId: string | null }[] = [];
    if (input.to) recipients = [{ email: input.to, contactId: (await db.maybeOne<{ id: string }>(`SELECT id FROM marketing_contacts WHERE email = $1`, [input.to]))?.id ?? null, organisationId: null }];
    else if (input.contactId) { const c = await db.maybeOne<{ email: string }>(`SELECT email FROM marketing_contacts WHERE id = $1`, [input.contactId]); if (!c) throw notFound("Contact not found."); recipients = [{ email: c.email, contactId: input.contactId, organisationId: null }]; }
    else if (input.organisationId) recipients = (await db.query<{ email: string; contact_id: string | null }>(`SELECT pr.email, c.id AS contact_id FROM memberships m JOIN profiles pr ON pr.id = m.user_id LEFT JOIN marketing_contacts c ON c.auth_user_id = pr.auth_user_id WHERE m.organisation_id = $1 AND m.role IN ('owner','hr') AND m.status = 'active'`, [input.organisationId])).map((r) => ({ email: r.email, contactId: r.contact_id, organisationId: input.organisationId! }));
    if (recipients.length === 0) throw invalid("Choose who the email is for.");
    let sent = 0;
    for (const r of recipients) {
      const vars = r.contactId ? await contactVars(db, r.contactId) : { email: r.email, unsubscribed: false, first_name: r.email.split("@")[0] };
      const m = renderTemplate({ subject: input.subject, title: input.title || input.subject, body: input.body, cta_label: input.ctaLabel ?? null, cta_url: input.ctaUrl ?? null, eyebrow: "From Boredroom" }, vars, "You received this because a Boredroom administrator wrote to you.");
      const out = await sendLogged(db, { to: r.email, subject: m.subject, html: m.html, text: m.text, category: "admin", organisationId: r.organisationId, sentBy: admin.user.authUserId });
      if (out.ok) sent++;
    }
    await adminAudit(db, admin, { action: "communication.sent", targetType: "email", targetLabel: input.subject, organisationId: input.organisationId ?? null, metadata: { recipients: recipients.length, sent } });
    return { recipients: recipients.length, sent };
  });
}
