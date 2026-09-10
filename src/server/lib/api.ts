import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { randomUUID } from "node:crypto";
import { AppError, invalid, unauthenticated, forbidden, notFound } from "@/server/lib/errors";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { withUser, withSystem, type Db } from "@/server/db";
import { sha256 } from "@/server/lib/crypto";

export type OrgContext = {
  user: CurrentUser;
  org: { id: string; slug: string; name: string; timezone: string; current_policy_id: string | null; status: string };
  membership: { id: string; role: "owner" | "hr" | "manager" | "employee"; employee_code: string };
};

export function errorResponse(err: unknown, requestId: string) {
  if (err instanceof AppError) {
    return NextResponse.json({ code: err.code, message: err.message, fieldErrors: err.fieldErrors, details: err.details, requestId }, { status: err.status });
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === "42501") {
    return NextResponse.json({ code: "FORBIDDEN", message: "You are not allowed to do that.", requestId }, { status: 403 });
  }
  console.error(`[${requestId}]`, err);
  return NextResponse.json({ code: "INTERNAL", message: "Something went wrong. Try again.", requestId }, { status: 500 });
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

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown = {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try { raw = await req.json(); } catch { throw invalid("Body must be valid JSON."); }
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

/** Resolves the organisation from its slug through the caller's active membership (RLS hides other orgs). */
export async function orgContext(orgSlug: string): Promise<OrgContext> {
  const user = await requireAuth();
  const row = await withUser(user.profileId, (db) => db.maybeOne<{
    org_id: string; slug: string; name: string; timezone: string; current_policy_id: string | null; status: string;
    membership_id: string; role: OrgContext["membership"]["role"]; employee_code: string;
  }>(
    `SELECT o.id AS org_id, o.slug, o.name, o.timezone, o.current_policy_id, o.status,
            m.id AS membership_id, m.role, m.employee_code
     FROM organisations o JOIN memberships m ON m.organisation_id = o.id
     WHERE (o.slug = $1 OR o.id::text = $1) AND m.user_id = $2 AND m.status = 'active'`, [orgSlug, user.profileId]));
  if (!row) throw notFound("Workspace not found.");
  if (row.status !== "active") throw forbidden("This workspace is not active.");
  return {
    user,
    org: { id: row.org_id, slug: row.slug, name: row.name, timezone: row.timezone, current_policy_id: row.current_policy_id, status: row.status },
    membership: { id: row.membership_id, role: row.role, employee_code: row.employee_code },
  };
}

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
