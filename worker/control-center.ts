/**
 * Control Center jobs: platform events fan out to automations and Brevo; campaigns send in batches; the scheduler
 * expires subscriptions and runs time-based automations once a day.
 */
import type { Handler } from "./handlers";
import { enqueueJob } from "../src/server/services/common";
import { withWorker } from "../src/server/db";

export const controlCenterHandlers: Record<string, Handler> = {
  "platform.event": async (payload) => {
    const { automationsForEvent } = await import("../src/server/admin/marketing");
    await automationsForEvent(String(payload.type ?? ""), payload);
    if (payload.contactId) await withWorker((db) => enqueueJob(db, "brevo.sync_contact", { contactId: payload.contactId }, { dedupKey: `brevo.sync:${payload.contactId}:${String(payload.eventId ?? "").slice(0, 8)}` }));
  },
  "brevo.sync_contact": async (payload) => {
    const { syncContactToBrevo } = await import("../src/server/admin/marketing");
    await syncContactToBrevo(String(payload.contactId));
  },
  "campaign.send": async (payload) => {
    const { runCampaignBatch } = await import("../src/server/admin/marketing");
    const r = await runCampaignBatch(String(payload.campaignId), 40);
    // More to send: queue the next batch under a fresh key so the rate stays gentle on the relay.
    if (r.remaining > 0) await withWorker((db) => enqueueJob(db, "campaign.send", { campaignId: payload.campaignId }, { dedupKey: `campaign.send:${payload.campaignId}:${Date.now()}`, runAt: new Date(Date.now() + 5_000) }));
  },
  "brenda.tick": async (payload) => {
    const { brendaTick } = await import("../src/server/services/brenda");
    // `nudges: false`: queued outside every working window (worker night mode): reminders only.
    const r = await brendaTick(new Date(), { nudges: payload.nudges !== false });
    if (r.sent) console.log(`[worker] brenda sent ${r.sent} reminder(s)`);
  },
  "automations.scheduled": async () => {
    const { runScheduledAutomations, expireSubscriptions } = await import("../src/server/admin/marketing");
    const { billingReminders } = await import("../src/server/admin/billing-reminders");
    await expireSubscriptions();
    await runScheduledAutomations();
    await billingReminders();
  },
};

/**
 * Once a day: expire what has lapsed and run the time-based automations. Deduplicated on the date. `quiet`: outside
 * every working window (worker night mode, owner request, 23 October 2026: realtime plan, phase 0), Brenda's tick sends
 * due reminders only, no nudges; its own key, so a day tick in the same five minutes still runs. `night`: a night pass
 * (nobody active): the pass woke for something, often a reminder, so its tick is keyed on the second, not the five
 * minutes (fix review, 23 October 2026: jobs.dedup_key is unique and never purged, so a pass at 02:00:10 used up the
 * bucket's key and the pass that woke at 02:03 for a reminder queued nothing; the reminder went an hour late). A night
 * pass comes at least a second after the last, so each one gets its tick: one row per pass, a few dozen a night.
 */
export async function scheduleControlCenter(opts: { quiet?: boolean; night?: boolean } = {}) {
  await withWorker((db) => enqueueJob(db, "automations.scheduled", {}, { dedupKey: `automations.scheduled:${new Date().toISOString().slice(0, 10)}` }));
  // Brenda's reminders and nudges: every five minutes, one job per window (by night, one per pass).
  const now = Date.now();
  const bucket = Math.floor(now / 300_000);
  if (opts.night) await withWorker((db) => enqueueJob(db, "brenda.tick", { nudges: false }, { dedupKey: `brenda.tick:n${Math.floor(now / 1000)}:quiet` }));
  else if (opts.quiet) await withWorker((db) => enqueueJob(db, "brenda.tick", { nudges: false }, { dedupKey: `brenda.tick:${bucket}:quiet` }));
  else await withWorker((db) => enqueueJob(db, "brenda.tick", {}, { dedupKey: `brenda.tick:${bucket}` }));
}
