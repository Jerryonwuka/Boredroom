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
  "automations.scheduled": async () => {
    const { runScheduledAutomations, expireSubscriptions } = await import("../src/server/admin/marketing");
    await expireSubscriptions();
    await runScheduledAutomations();
  },
};

/** Once a day: expire what has lapsed and run the time-based automations. Deduplicated on the date. */
export async function scheduleControlCenter() {
  await withWorker((db) => enqueueJob(db, "automations.scheduled", {}, { dedupKey: `automations.scheduled:${new Date().toISOString().slice(0, 10)}` }));
}
