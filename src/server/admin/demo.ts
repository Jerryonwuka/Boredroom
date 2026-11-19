/**
 * Demo requests from the public site (owner request, 17 November 2026: "on the website, I want us to have book a demo").
 * A request is a marketing contact (source "demo" when the address is new) with the request itself in
 * `attributes.demo_request`: when it was sent, the times that suit, what they want to see and their time zone. Asking for
 * a demo is not asking for product news, so the contact is not put on the waitlist and has no marketing consent.
 *
 * Two emails, both logged: the request to Boredroom (SUPPORT_EMAIL, which reaches the Control Center inbox; replying
 * answers the person), and a short receipt to the person. Neither failing fails the request: the contact is saved first.
 */
import { z } from "zod";
import { withSystem } from "@/server/db";
import { rateLimited } from "@/server/lib/errors";
import { demoReceivedMail, demoRequestMail } from "@/server/lib/emails";
import { sendLogged, upsertContact } from "@/server/admin/marketing";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const DEMO_SIZES = ["1-5", "6-20", "21-50", "51-200", "201-1000", "1000+"] as const;

export const demoSchema = z.object({
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().toLowerCase().email(), company: z.string().trim().min(1).max(160),
  companySize: z.enum(DEMO_SIZES).optional(), role: z.string().trim().max(80).optional().default(""),
  /** When suits them, in their own words ("weekday mornings"). */
  times: z.string().trim().max(300).optional().default(""),
  /** What they would like to see. */
  notes: z.string().trim().max(1000).optional().default(""),
  /** The browser's time zone ("Africa/Lagos"), so a time can be offered in it. */
  timezone: z.string().trim().max(60).regex(/^[A-Za-z0-9_+\-/]*$/).optional().default(""),
  source: z.string().trim().max(60).optional().default("demo"),
  website: z.string().max(0).optional().default(""), // honeypot
});

export type DemoRequest = { at: string; times: string; notes: string; timezone: string; page: string };

/** At most this many requests an hour from one address. */
const HOURLY_LIMIT = 10;

export async function requestDemo(input: z.infer<typeof demoSchema>, ip: string) {
  return withSystem(async (db) => {
    const r = await db.one<{ hits: number }>(`INSERT INTO auth_rate_limits(bucket, window_start, hits) VALUES ($1, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 1) ON CONFLICT (bucket, window_start) DO UPDATE SET hits = auth_rate_limits.hits + 1 RETURNING hits`, [`demo:${ip}`]);
    if (r.hits > HOURLY_LIMIT) throw rateLimited();
    const c = await upsertContact(db, { email: input.email, firstName: input.firstName, lastName: input.lastName || null, company: input.company, companySize: input.companySize ?? null, roleTitle: input.role || null, source: "demo", isWaitlist: false });
    const request: DemoRequest = { at: new Date().toISOString(), times: input.times, notes: input.notes, timezone: input.timezone, page: input.source };
    await db.query(`UPDATE marketing_contacts SET attributes = attributes || jsonb_build_object('demo_request', $2::jsonb), updated_at = now() WHERE id = $1`, [c.id, JSON.stringify(request)]);

    const name = [input.firstName, input.lastName].filter(Boolean).join(" ");
    const toUs = demoRequestMail({ name, email: input.email, company: input.company, companySize: input.companySize ?? null, role: input.role, times: input.times, notes: input.notes, timezone: input.timezone, page: input.source });
    await sendLogged(db, { to: SUPPORT_EMAIL, subject: `Demo request: ${name}, ${input.company}`, ...toUs, category: "transactional", headers: { "Reply-To": input.email } });
    const toThem = demoReceivedMail({ firstName: input.firstName });
    await sendLogged(db, { to: input.email, subject: "We have your demo request", ...toThem, category: "transactional", headers: { "Reply-To": SUPPORT_EMAIL } });
    return { id: c.id };
  });
}
