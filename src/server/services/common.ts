import type { Db } from "@/server/db";

export type AuditInput = {
  organisationId: string | null;
  actorMembershipId?: string | null;
  actorUserId?: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  subjectMembershipId?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
};

/**
 * The sha256 of the request's session token (the same cookie, else bearer token, the session was resolved from), or null
 * outside a request (the worker, scripts, tests). Imported when needed: auth reaches this module too.
 */
async function requestSessionHash(): Promise<string | null> {
  try {
    const [{ requestSessionToken }, { sha256 }] = await Promise.all([import("@/server/auth"), import("@/server/lib/crypto")]);
    const token = await requestSessionToken();
    return token ? sha256(token) : null;
  } catch (err) {
    // Next's own signals (a prerender bailing out on cookies()) go back to Next; anything else means no request.
    const { unstable_rethrow } = await import("next/navigation").catch(() => ({ unstable_rethrow: (e: unknown) => void e }));
    unstable_rethrow(err);
    return null;
  }
}

/**
 * Security audit, 23 October 2026 (issue 14): what Boredroom staff do while impersonating someone was recorded as that
 * person's own action. When the request's session is an impersonation, every row written here carries
 * `metadata.impersonationId` (the Control Center's admin_impersonations record), stamped in the same statement, and the
 * workspace's Audit page marks it. Rows the worker writes have no request, so nothing is stamped.
 */
export async function audit(db: Db, a: AuditInput) {
  const session = await requestSessionHash();
  await db.query(
    `INSERT INTO audit_events(organisation_id, actor_membership_id, actor_user_id, action, subject_type, subject_id, subject_membership_id, metadata, request_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb || COALESCE((SELECT jsonb_build_object('impersonationId', s.impersonation_id) FROM auth_sessions s
       WHERE $10::text IS NOT NULL AND s.token_hash = $10::text AND s.impersonation_id IS NOT NULL), '{}'::jsonb), $9)`,
    [a.organisationId, a.actorMembershipId ?? null, a.actorUserId ?? null, a.action, a.subjectType, a.subjectId ?? null,
     a.subjectMembershipId ?? null, JSON.stringify(a.metadata ?? {}), a.requestId ?? null, session]);
}

export type NotifyInput = {
  organisationId: string;
  recipientMembershipId: string;
  type: string;
  title: string;
  body?: string;
  resourceType?: string;
  resourceId?: string;
  href?: string;
  dedupKey: string;
};

/** Deduplicated in-app notification. Re-running with the same key is a no-op. */
export async function notify(db: Db, n: NotifyInput) {
  await db.query(`SELECT app_notify($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [n.organisationId, n.recipientMembershipId, n.type, n.title, n.body ?? null, n.resourceType ?? null, n.resourceId ?? null, n.href ?? null, n.dedupKey]);
}

export async function enqueueJob(db: Db, type: string, payload: Record<string, unknown>, opts: { dedupKey?: string; runAt?: Date } = {}) {
  await db.query(
    `INSERT INTO jobs(type, payload, dedup_key, next_run_at) VALUES ($1, $2, $3, COALESCE($4, now()))
     ON CONFLICT (dedup_key) DO NOTHING`,
    [type, JSON.stringify(payload), opts.dedupKey ?? null, opts.runAt ?? null]);
}

/** Managers of every team the membership belongs to (excluding the member themself). */
export async function managersOf(db: Db, orgId: string, membershipId: string): Promise<string[]> {
  const rows = await db.query<{ membership_id: string }>(
    `SELECT DISTINCT mgr.membership_id FROM team_members tm
     JOIN team_members mgr ON mgr.team_id = tm.team_id AND mgr.is_manager
     WHERE tm.organisation_id = $1 AND tm.membership_id = $2 AND mgr.membership_id <> $2`, [orgId, membershipId]);
  return rows.map((r) => r.membership_id);
}
