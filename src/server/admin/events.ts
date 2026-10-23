/**
 * The event engine: product events are written to platform_events and fanned out to the modules that care
 * (marketing automations, Brevo synchronisation, billing emails) through the job queue, so a slow or failing
 * integration never blocks the action that raised the event.
 */
import { type Db } from "@/server/db";
import { enqueueJob } from "@/server/services/common";

export type PlatformEventType =
  | "USER_CREATED" | "USER_ACTIVATED" | "USER_SUSPENDED"
  | "ORGANIZATION_CREATED" | "ORGANIZATION_SUSPENDED"
  | "TRIAL_STARTED" | "TRIAL_EXPIRING" | "TRIAL_EXPIRED"
  | "SUBSCRIPTION_CREATED" | "SUBSCRIPTION_RENEWING" | "SUBSCRIPTION_EXPIRING" | "SUBSCRIPTION_EXPIRED" | "SUBSCRIPTION_CANCELLED"
  | "PAYMENT_SUCCESSFUL" | "PAYMENT_FAILED" | "PAYMENT_REFUNDED"
  // A Paystack payment that changed nothing because Boredroom never created its reference, or its amount, currency or
  // domain did not match (security audit, 23 October 2026, issue 2). For an admin to look at; nothing handles it.
  | "PAYMENT_NEEDS_REVIEW"
  | "WAITLIST_JOINED" | "WAITLIST_INVITED" | "WAITLIST_CONVERTED"
  | "LAUNCH_MODE_CHANGED"
  // Someone finished or skipped the first-run welcome (owner request, 11 October 2026). Aggregate only: the workspace,
  // the role, the outcome, the step reached, the steps skipped and the seconds taken, never a person's id or name.
  // Nothing handles it (automationsForEvent ignores types it does not map); the lead reads the funnel (docs/runbooks.md).
  | "WELCOME_FINISHED";

export async function emitEvent(db: Db, type: PlatformEventType, payload: Record<string, unknown> & { organisationId?: string | null; authUserId?: string | null; contactId?: string | null }) {
  const row = await db.one<{ id: string }>(
    `INSERT INTO platform_events(type, organisation_id, auth_user_id, contact_id, payload) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [type, payload.organisationId ?? null, payload.authUserId ?? null, payload.contactId ?? null, JSON.stringify(payload)]);
  await enqueueJob(db, "platform.event", { eventId: row.id, type, ...payload }, { dedupKey: `platform.event:${row.id}` });
  return row.id;
}
