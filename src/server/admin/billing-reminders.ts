import { withSystem } from "@/server/db";
import type { Db } from "@/server/db";
import { notify } from "@/server/services/common";
import { dateOnly } from "@/lib/format";

/**
 * In-app notices about money (owner decision, 25 September 2026): the people who run a workspace hear, inside
 * Boredroom, when a plan is about to end, when it has ended, when a payment failed and when a renewal went through.
 * The matching emails come from the automations engine; this is the bell in the top bar.
 */
const STEPS = [14, 7, 3, 1];

async function owners(db: Db, orgId: string) {
  return db.query<{ id: string }>(`SELECT id FROM memberships WHERE organisation_id = $1 AND status = 'active' AND role IN ('owner', 'hr')`, [orgId]);
}

/** Tells every owner and HR administrator of a workspace the same thing, once per key. */
export async function notifyBilling(db: Db, orgId: string, n: { type: string; title: string; body: string; key: string }) {
  const slug = await db.maybeOne<{ slug: string }>(`SELECT slug FROM organisations WHERE id = $1`, [orgId]);
  for (const m of await owners(db, orgId)) {
    await notify(db, { organisationId: orgId, recipientMembershipId: m.id, type: n.type, title: n.title, body: n.body, href: slug ? `/app/${slug.slug}/settings?billing=1#billing` : undefined, dedupKey: n.key });
  }
}

/** Once a day: subscriptions ending in 14, 7, 3 and 1 days, and the ones that ended today. Idempotent through the dedup key. */
export async function billingReminders() {
  return withSystem(async (db) => {
    let sent = 0;
    for (const days of STEPS) {
      const rows = await db.query<{ organisation_id: string; plan: string; end: string; auto_renew: boolean }>(
        `SELECT s.organisation_id, p.name AS plan, s.current_period_end::text AS "end", s.auto_renew
           FROM subscriptions s JOIN plans p ON p.id = s.plan_id
          WHERE s.status IN ('active', 'trial') AND s.current_period_end IS NOT NULL AND p.monthly_price > 0
            AND s.current_period_end::date = (CURRENT_DATE + $1::int)`, [days]);
      for (const r of rows) {
        const when = days === 1 ? "tomorrow" : `in ${days} days`;
        await notifyBilling(db, r.organisation_id, {
          type: "billing.expiring", key: `billing.expiring:${r.organisation_id}:${r.end.slice(0, 10)}:${days}`,
          title: `${r.plan} ${r.auto_renew ? "renews" : "ends"} ${when}`,
          body: r.auto_renew ? `The ${r.plan} plan renews on ${dateOnly(r.end)}. Nothing to do unless the card has changed.` : `The ${r.plan} plan ends on ${dateOnly(r.end)}. Renew before then to keep its modules.`,
        });
        sent++;
      }
    }
    const ended = await db.query<{ organisation_id: string; plan: string; end: string }>(
      `SELECT s.organisation_id, p.name AS plan, s.current_period_end::text AS "end" FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.status IN ('expired', 'past_due', 'payment_failed') AND s.current_period_end::date = CURRENT_DATE - 1 AND p.monthly_price > 0`);
    for (const r of ended) {
      await notifyBilling(db, r.organisation_id, { type: "billing.expired", key: `billing.expired:${r.organisation_id}:${r.end.slice(0, 10)}`, title: `${r.plan} has ended`, body: `The ${r.plan} plan ended on ${dateOnly(r.end)}. The workspace is on Free until it renews; nothing has been deleted.` });
      sent++;
    }
    return { sent };
  });
}
