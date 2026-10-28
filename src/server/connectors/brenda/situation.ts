/**
 * Brenda's situation lines about connected apps (owner decisions, 22 October 2026: connectors; spec §9.9). Uncached, per
 * person, and only Boredroom's own words and times: never a title, a label or anything else an app wrote. Empty before
 * 0061, without the plan, or while someone else is signed in as the person (their connections are invisible then).
 */
import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { noteMissing0061, schema0061Missing } from "@/server/lib/schema-0061";
import { CATALOGUE } from "@/lib/connectors/catalogue";
import { PROVIDER_LABELS, type ProviderId } from "@/lib/connectors/types";
import { busyBlocks, meetingStateFor, personZone } from "../items";
import { policiesIn } from "../connections";
import { configuredProviders } from "../registry";

const hm = (iso: string, tz: string) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export async function connectorSituation(ctx: OrgContext, now: Date = new Date()): Promise<string[]> {
  if (!ctx.plan.features.CONNECTORS || ctx.user.impersonation) return [];
  if (schema0061Missing()) return [];
  const data = await withUser(ctx.user.profileId, async (db) => {
    const rows = await db.query<{ provider: ProviderId; kind: "workspace" | "personal"; status: string; can_read: boolean; can_act: boolean }>(
      `SELECT provider, kind, status, can_read, can_act FROM connector_connections
        WHERE organisation_id = $1 AND status <> 'disconnecting' AND (kind = 'workspace' OR membership_id = $2) ORDER BY created_at`, [ctx.org.id, ctx.membership.id]);
    const policies = await policiesIn(db, ctx.org.id);
    const tz = await personZone(db, ctx);
    const meeting = await meetingStateFor(db, ctx.membership.id, now);
    return { rows, policies, tz, meeting };
  }).catch((err: unknown) => { if (noteMissing0061(err)) return null; throw err; });
  if (!data) return [];
  // Owner request, 28 October 2026: only the apps set up on this server (never Outlook or Teams before Microsoft is).
  const ready = new Set(await configuredProviders().catch(() => [] as ProviderId[]));
  const offered = CATALOGUE.filter((e) => e.id !== "fake" && ready.has(e.id));
  const can = offered.length ? `Boredroom can connect: ${andList(offered.map((e) => e.label))}.` : "Boredroom can't connect any apps yet.";
  if (!data.rows.length) return [`Connected for this person: none. ${can}`];
  const byApp = new Map<ProviderId, string[]>();
  for (const r of data.rows) {
    const p = data.policies.get(r.provider);
    const reads = r.can_read && p?.brendaReads !== false;
    const acts = p?.brendaActs !== false && (r.kind === "workspace" || r.can_act);
    const chat = r.provider === "slack" || r.provider === "teams";
    const what = chat ? (acts ? "posting when they confirm" : "connected") : [reads ? "read" : null, acts ? "change" : null].filter(Boolean).join(" and ") || "connected";
    const words = `${r.kind === "personal" ? "theirs" : "the workspace's"}: ${what}`;
    byApp.set(r.provider, [...(byApp.get(r.provider) ?? []), words]);
  }
  const connected = [...byApp.entries()].map(([p, w]) => `${PROVIDER_LABELS[p]} (${w.join("; ")})`);
  const missing = offered.filter((e) => !byApp.has(e.id)).map((e) => e.label);
  const lines = [`Connected for this person: ${connected.join(", ")}.${missing.length ? ` Not connected yet: ${missing.join(", ")}.` : ""} ${can}`];
  if (data.rows.some((r) => r.kind === "personal" && r.can_read && ["google_calendar", "outlook_calendar", "fake"].includes(r.provider))) {
    const busy = await busyBlocks(ctx, now).catch(() => []);
    const times = busy.map((b) => `${hm(b.start, data.tz)}–${hm(b.end, data.tz)}`);
    lines.push(`Their calendar today, times only (my_calendar has titles): ${times.length ? `busy ${andList(times)}` : "nothing booked"}.${data.meeting.active && data.meeting.until ? ` In a meeting now, until ${hm(data.meeting.until, data.tz)}.` : ""}`);
  }
  for (const r of data.rows) {
    if (r.status === "needs_reauth") lines.push(r.kind === "personal" ? `Their ${PROVIDER_LABELS[r.provider]} needs reconnecting.` : `The workspace's ${PROVIDER_LABELS[r.provider]} needs reconnecting.`);
  }
  return lines;
}
