/**
 * The waitlist and the launch state. Waitlist signups are marketing contacts flagged is_waitlist; joining raises
 * WAITLIST_JOINED (which sends the confirmation and syncs Brevo). The launch mode lives in platform_settings and
 * is read by the public site, the sign-up routes and the app shell.
 */
import { z } from "zod";
import { withSystem } from "@/server/db";
import { rateLimited } from "@/server/lib/errors";
import { adminAudit, type Admin } from "@/server/admin/auth";
import { emitEvent } from "@/server/admin/events";
import { upsertContact } from "@/server/admin/marketing";
import { launchSettings, setSetting, type LaunchSettings, type LaunchMode } from "@/server/admin/settings";

export const waitlistSchema = z.object({
  firstName: z.string().trim().min(1).max(80), lastName: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().toLowerCase().email(), company: z.string().trim().max(160).optional().default(""),
  companySize: z.enum(["1-5", "6-20", "21-50", "51-200", "201-1000", "1000+"]).optional(), role: z.string().trim().max(80).optional().default(""),
  interest: z.string().trim().max(1000).optional().default(""), source: z.string().trim().max(60).optional().default("landing"),
  website: z.string().max(0).optional().default(""), // honeypot
});

export async function joinWaitlist(input: z.infer<typeof waitlistSchema>, ip: string) {
  return withSystem(async (db) => {
    const r = await db.one<{ hits: number }>(`INSERT INTO auth_rate_limits(bucket, window_start, hits) VALUES ($1, to_timestamp(floor(extract(epoch from now()) / 3600) * 3600), 1) ON CONFLICT (bucket, window_start) DO UPDATE SET hits = auth_rate_limits.hits + 1 RETURNING hits`, [`waitlist:${ip}`]);
    if (r.hits > 20) throw rateLimited();
    const c = await upsertContact(db, { email: input.email, firstName: input.firstName, lastName: input.lastName || null, company: input.company || null, companySize: input.companySize ?? null, roleTitle: input.role || null, interest: input.interest || null, source: input.source, isWaitlist: true });
    if (c.created) await emitEvent(db, "WAITLIST_JOINED", { contactId: c.id, email: input.email });
    return { id: c.id, created: c.created };
  });
}

export async function launchState() {
  const l = await launchSettings(true);
  return l;
}

export const launchSchema = z.object({ mode: z.enum(["waitlist", "live", "maintenance"]), waitlistOpen: z.boolean().optional(), appAccess: z.boolean().optional(), message: z.string().trim().max(500).optional(), reason: z.string().trim().min(3).max(1000) });

export async function setLaunchMode(admin: Admin, input: z.infer<typeof launchSchema>) {
  const before = await launchSettings(true);
  const next: LaunchSettings = { mode: input.mode as LaunchMode, waitlist_open: input.waitlistOpen ?? (input.mode === "waitlist" ? true : before.waitlist_open), app_access: input.mode === "maintenance" ? (input.appAccess ?? false) : true, message: input.message ?? before.message };
  await setSetting(admin, "launch", next, input.reason);
  await withSystem(async (db) => {
    await adminAudit(db, admin, { action: "launch.mode_changed", targetType: "platform", targetId: "launch", before, after: next, reason: input.reason });
    await emitEvent(db, "LAUNCH_MODE_CHANGED", { from: before.mode, to: next.mode, byAdmin: admin.user.email });
  });
  return next;
}
