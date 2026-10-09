import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, invalid, unauthenticated, forbidden, notFound, tooLarge } from "@/server/lib/errors";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { cache } from "react";
import { withSystem, type Db } from "@/server/db";
import { SESSION_CTES, currentUserOf, requestSessionToken, type SessionRow } from "@/server/auth";
import { sha256 } from "@/server/lib/crypto";
import { explainInfraError } from "@/server/lib/health";
import { entitlementsOf, entitlementsSql, requireFeature as requireFeatureOf, type EntitlementColumns, type Entitlements } from "@/server/lib/entitlements";

export type OrgContext = {
  user: CurrentUser;
  org: { id: string; slug: string; name: string; timezone: string; current_policy_id: string | null; status: string };
  membership: { id: string; role: "owner" | "hr" | "manager" | "employee"; employee_code: string };
  /** What the workspace's plan allows right now; see server/lib/entitlements.ts. */
  plan: Entitlements;
};

export function errorResponse(err: unknown, requestId: string) {
  if (err instanceof AppError) {
    return NextResponse.json({ code: err.code, message: err.message, fieldErrors: err.fieldErrors, details: err.details, requestId }, { status: err.status });
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === "42501") {
    return NextResponse.json({ code: "FORBIDDEN", message: "You are not allowed to do that.", requestId }, { status: 403 });
  }
  // A malformed id in the address (/tasks/abc) reaches a uuid column and Postgres refuses it: that thing does not exist.
  if (code === "22P02" && err instanceof Error && /type uuid/.test(err.message)) {
    return NextResponse.json({ code: "NOT_FOUND", message: "Not found. Check the link and try again.", requestId }, { status: 404 });
  }
  console.error(`[${requestId}]`, err);
  // Infrastructure problems (database down, wrong password, migrations missing) are explained safely in every environment.
  const infra = explainInfraError(err);
  if (infra) return NextResponse.json({ code: "INFRASTRUCTURE", message: `${infra.message} ${infra.fix} (see /api/health)`, requestId }, { status: 503 });
  // Outside production, show the underlying cause of other failures.
  const detail = process.env.NODE_ENV !== "production" && err instanceof Error ? ` (${err.message})` : "";
  return NextResponse.json({ code: "INTERNAL", message: `Something went wrong. Try again.${detail}`, requestId, hint: "Check /api/health for configuration problems." }, { status: 500 });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Cookie-based auth needs an origin check on state-changing requests. */
export function assertSameOrigin(req: Request) {
  if (!MUTATING.has(req.method)) return;
  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  const expected = process.env.APP_ORIGIN ?? "http://localhost:3000";
  if (fetchSite && ["same-origin", "same-site", "none"].includes(fetchSite)) return;
  if (origin && origin === expected) return;
  if (!origin && !fetchSite) return; // non-browser clients (tests, curl) carry no ambient cookies.
  throw new AppError(403, "BAD_ORIGIN", "Cross-site request rejected.");
}

type Handler<P> = (req: Request, ctx: { params: P; requestId: string }) => Promise<Response>;

export function route<P = Record<string, string>>(fn: Handler<P>) {
  return async (req: Request, context: { params: Promise<P> }) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    try {
      assertSameOrigin(req);
      const params = await context.params;
      const res = await fn(req, { params, requestId });
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

/**
 * The body as text, refused (413) once it passes `maxBytes`: by its declared length before anything is read, else while
 * it streams in, so a small form's endpoint never buffers a large body (review, 7 October 2026: the assistant routes).
 */
async function readCapped(req: Request, maxBytes: number): Promise<string> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw tooLarge();
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => undefined); throw tooLarge(); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** Reads and checks a JSON (or form) body. `maxBytes` caps a JSON body for endpoints that only ever take a few short fields. */
export async function parseBody<T>(req: Request, schema: ZodType<T>, opts: { maxBytes?: number } = {}): Promise<T> {
  let raw: unknown = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const text = opts.maxBytes ? await readCapped(req, opts.maxBytes) : null;
    try { raw = text === null ? await req.json() : JSON.parse(text); } catch { throw invalid("Body must be valid JSON."); }
  } else if (ct.includes("form")) {
    raw = Object.fromEntries((await req.formData()).entries());
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "_";
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw invalid("Check the highlighted fields.", fieldErrors);
  }
  return result.data;
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): T {
  const url = new URL(req.url);
  const result = schema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!result.success) throw invalid("Invalid query parameters.");
  return result.data;
}

export async function requireAuth(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthenticated();
  return user;
}

type ContextRow = SessionRow & EntitlementColumns & {
  org_id: string | null; slug: string; org_name: string; timezone: string; current_policy_id: string | null; org_status: string;
  membership_id: string; role: OrgContext["membership"]["role"]; employee_code: string;
};

/**
 * The session, the caller's active membership of the workspace (by slug or id) with the organisation, and its
 * entitlements, in ONE statement: `$1` = sha256(the session token), `$2` = the slug. No row: no valid session. A row
 * without `org_id`: not a member (RLS-equivalent: the membership is bound to the session's own user id, so the system
 * role sees exactly what row security would show this user). Before (review, 9 October 2026: the natural voice's
 * latency on a slow link) this was seven round trips (BEGIN, the session, the membership, three plan queries, COMMIT)
 * plus two transactions of their own for the platform settings; now three (BEGIN, this, COMMIT), on every route and page.
 */
const CONTEXT_SQL = `WITH ${SESSION_CTES}, m AS (
       SELECT o.id AS org_id, o.slug, o.name AS org_name, o.timezone, o.current_policy_id, o.status AS org_status,
              m.id AS membership_id, m.role, m.employee_code
         FROM u JOIN memberships m ON m.user_id = u.profile_id JOIN organisations o ON o.id = m.organisation_id
        WHERE (o.slug = $2 OR o.id::text = $2) AND m.status = 'active'
        LIMIT 1
     )
     SELECT u.*, m.*, e.* FROM u LEFT JOIN m ON true LEFT JOIN LATERAL (${entitlementsSql("m.org_id")}) e ON m.org_id IS NOT NULL`;

async function contextRowIn(db: Db, orgSlug: string, token: string): Promise<ContextRow | null> {
  return db.maybeOne<ContextRow>(CONTEXT_SQL, [sha256(token), orgSlug]);
}

/** The context from that row, or the error the caller gets (401, 404, 403), as orgContext always answered. */
function contextOf(row: ContextRow | null): OrgContext | AppError {
  if (!row) return unauthenticated();
  if (!row.org_id) return notFound("Workspace not found.");
  if (row.org_status !== "active") return forbidden("This workspace is not active.");
  return {
    user: currentUserOf(row),
    org: { id: row.org_id, slug: row.slug, name: row.org_name, timezone: row.timezone, current_policy_id: row.current_policy_id, status: row.org_status },
    membership: { id: row.membership_id, role: row.role, employee_code: row.employee_code },
    plan: entitlementsOf(row),
  };
}

/**
 * Resolves the organisation from its slug through the caller's active membership (RLS hides other orgs).
 * The session, the membership and the plan are one statement in one transaction (CONTEXT_SQL): on a distant database
 * each round trip is a large share of a page load, and this runs before every page. Deduplicated per request with
 * React's cache. No session token: 401 without asking the database.
 */
export const orgContext = cache(async function orgContext(orgSlug: string): Promise<OrgContext> {
  const token = await requestSessionToken();
  if (!token) throw unauthenticated();
  const ctx = contextOf(await withSystem((db) => contextRowIn(db, orgSlug, token)));
  if (ctx instanceof AppError) throw ctx;
  return ctx;
});

/**
 * orgContext, then `fn` in the SAME transaction (the speech route: review, 9 October 2026, the natural voice's latency
 * on a slow link): one BEGIN and one COMMIT for both, instead of a transaction each. The same checks, in the same order:
 * no session 401, not a member 404, an inactive workspace 403 (answered after the COMMIT, so the session's touch stays,
 * as with orgContext). What `fn` throws rolls everything back, `fn`'s writes included.
 */
export async function orgContextTx<T>(orgSlug: string, fn: (ctx: OrgContext, db: Db) => Promise<T>): Promise<T> {
  const token = await requestSessionToken();
  if (!token) throw unauthenticated();
  const out = await withSystem(async (db): Promise<{ err: AppError } | { ok: T }> => {
    const ctx = contextOf(await contextRowIn(db, orgSlug, token));
    if (ctx instanceof AppError) return { err: ctx };
    return { ok: await fn(ctx, db) };
  });
  if ("err" in out) throw out.err;
  return out.ok;
}

/** Refuses when the workspace's plan does not include a module. */
export function requireFeature(ctx: OrgContext, key: string) { requireFeatureOf(ctx.plan, key); }

export function requireRole(ctx: OrgContext, ...roles: OrgContext["membership"]["role"][]) {
  if (!roles.includes(ctx.membership.role)) throw forbidden();
}

/**
 * Idempotent execution: same key + same body returns the stored response; same key with a
 * different body is rejected. Keys are scoped per user and route.
 */
export async function idempotent<T>(req: Request, user: CurrentUser, routeName: string, bodyForHash: unknown, fn: () => Promise<{ status: number; body: T }>): Promise<Response> {
  const key = req.headers.get("idempotency-key");
  if (!key) {
    const r = await fn();
    return NextResponse.json(r.body, { status: r.status });
  }
  const requestHash = sha256(JSON.stringify(bodyForHash ?? null));
  const existing = await withSystem((db) => db.maybeOne<{ request_hash: string; response_status: number | null; response_body: unknown }>(
    `SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE actor_user_id = $1 AND route = $2 AND key = $3 AND expires_at > now()`,
    [user.profileId, routeName, key]));
  if (existing) {
    if (existing.request_hash !== requestHash) throw new AppError(422, "IDEMPOTENCY_MISMATCH", "This idempotency key was already used with a different request.");
    if (existing.response_status != null) return NextResponse.json(existing.response_body, { status: existing.response_status });
    throw new AppError(409, "IN_PROGRESS", "A request with this key is still being processed. Retry shortly.");
  }
  try {
    await withSystem((db) => db.query(
      `INSERT INTO idempotency_keys(actor_user_id, route, key, request_hash) VALUES ($1, $2, $3, $4)`, [user.profileId, routeName, key, requestHash]));
  } catch {
    throw new AppError(409, "IN_PROGRESS", "A request with this key is still being processed. Retry shortly.");
  }
  let result: { status: number; body: T };
  try {
    result = await fn();
  } catch (err) {
    if (err instanceof AppError && err.status !== 500) {
      await withSystem((db) => db.query(
        `UPDATE idempotency_keys SET response_status = $4, response_body = $5 WHERE actor_user_id = $1 AND route = $2 AND key = $3`,
        [user.profileId, routeName, key, err.status, JSON.stringify({ code: err.code, message: err.message, details: err.details })]));
    } else {
      await withSystem((db) => db.query(`DELETE FROM idempotency_keys WHERE actor_user_id = $1 AND route = $2 AND key = $3`, [user.profileId, routeName, key]));
    }
    throw err;
  }
  await withSystem((db) => db.query(
    `UPDATE idempotency_keys SET response_status = $4, response_body = $5 WHERE actor_user_id = $1 AND route = $2 AND key = $3`,
    [user.profileId, routeName, key, result.status, JSON.stringify(result.body)]));
  return NextResponse.json(result.body, { status: result.status });
}

export const uuid = z.string().uuid();
export const ok = <T>(body: T, status = 200) => NextResponse.json(body, { status });
export type { Db };
