/**
 * Connected apps: who a person is in their apps (owner decisions, 22 October 2026: connectors; spec §3 table 8, §4.2).
 * A person's own identity comes from their personal connection (`connector_identities`, theirs alone); a workspace
 * item "assigned to me" matches it, or a keyed digest of the person's sign-in email (an assignee's email is never
 * stored, only `keyedDigest`). Server-only.
 */
import { keyedDigest } from "@/server/lib/crypto";

/** The keyed digest an assignee's email is kept as (HMAC with APP_SECRET; equal addresses match, none can be read back). */
export function emailDigest(email: string): string {
  return keyedDigest(`connector-email:${email.trim().toLowerCase()}`);
}

/**
 * SQL: the item `i` is assigned to the person `$m` (membership) whose email digest is `$d`: their own personal item
 * marked `mine`, or a workspace item whose assignee is one of their identities in that app, or whose assignee email
 * digest is theirs. Run under the person's row security: their identities are theirs alone.
 */
export function assignedToSql(i: string, m: string, d: string): string {
  return `((${i}.visibility = 'personal' AND ${i}.membership_id = ${m} AND ${i}.mine)
     OR (${i}.visibility = 'workspace' AND (
          EXISTS (SELECT 1 FROM connector_identities ci WHERE ci.membership_id = ${m} AND ci.provider = ${i}.provider
                   AND ci.external_user_id = ${i}.assignee_external_id)
          OR (${i}.assignee_digest IS NOT NULL AND ${i}.assignee_digest = ${d}))))`;
}
