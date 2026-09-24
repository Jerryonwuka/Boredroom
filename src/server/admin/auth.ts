/**
 * Who is an administrator, what they may do, and how every administrative action is recorded.
 *
 * An administrator is an ordinary Boredroom account with a row in platform_admins. Access to the Control Center
 * is explicitly privileged: services run in the system context (cross-tenant) only after `requireAdmin` has
 * checked the permission. The first super admins come from PLATFORM_SUPER_ADMINS (comma-separated emails) so the
 * console can be entered before any admin exists; after that, Admins & permissions manages the list.
 */
import { cache } from "react";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { withSystem, type Db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { AppError, forbidden, unauthenticated } from "@/server/lib/errors";
import { errorResponse, assertSameOrigin } from "@/server/lib/api";
import { permissionsFor, type AdminRole, type Permission } from "@/server/admin/permissions";
import { randomUUID } from "node:crypto";

export type Admin = { user: CurrentUser; adminId: string; role: AdminRole; permissions: Set<Permission>; ip: string | null };

function bootstrapEmails(): Set<string> {
  return new Set((process.env.PLATFORM_SUPER_ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

async function adminRowFor(db: Db, user: CurrentUser): Promise<{ id: string; role: AdminRole; status: string } | null> {
  const row = await db.maybeOne<{ id: string; role: AdminRole; status: string }>(`SELECT id, role, status FROM platform_admins WHERE auth_user_id = $1`, [user.authUserId]);
  if (row) return row;
  if (!bootstrapEmails().has(user.email.toLowerCase())) return null;
  // First entry by a bootstrap email: the row is created and recorded.
  const created = await db.one<{ id: string; role: AdminRole; status: string }>(`INSERT INTO platform_admins(auth_user_id, role, status, last_login_at) VALUES ($1, 'super_admin', 'active', now()) ON CONFLICT (auth_user_id) DO UPDATE SET last_login_at = now() RETURNING id, role, status`, [user.authUserId]);
  await db.query(`INSERT INTO platform_audit_events(admin_user_id, action, target_type, target_id, target_label, metadata) VALUES ($1, 'admin.bootstrap', 'admin', $1, $2, $3)`, [user.authUserId, user.email, JSON.stringify({ via: "PLATFORM_SUPER_ADMINS" })]);
  return created;
}

/** The current administrator, or null. Cached per request. */
export const getAdmin = cache(async function getAdmin(): Promise<Admin | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const row = await withSystem((db) => adminRowFor(db, user));
  if (!row || row.status !== "active") return null;
  let ip: string | null = null;
  try { ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null; } catch { ip = null; }
  return { user, adminId: row.id, role: row.role, permissions: permissionsFor(row.role), ip };
});

export async function requireAdmin(permission?: Permission): Promise<Admin> {
  const admin = await getAdmin();
  if (!admin) { const user = await getCurrentUser(); throw user ? forbidden("This area is for Boredroom administrators.") : unauthenticated(); }
  if (permission && !admin.permissions.has(permission)) throw forbidden(`Your administrator role does not include ${permission}.`);
  return admin;
}

export function can(admin: Admin, permission: Permission) { return admin.permissions.has(permission); }

/** Records an administrative action. Called inside the same transaction as the change where there is one. */
export async function adminAudit(db: Db, admin: Admin | null, a: { action: string; targetType: string; targetId?: string | null; targetLabel?: string | null; organisationId?: string | null; before?: unknown; after?: unknown; reason?: string | null; metadata?: Record<string, unknown> }) {
  await db.query(
    `INSERT INTO platform_audit_events(admin_user_id, action, target_type, target_id, target_label, organisation_id, before, after, reason, ip, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [admin?.user.authUserId ?? null, a.action, a.targetType, a.targetId ?? null, a.targetLabel ?? null, a.organisationId ?? null, a.before === undefined ? null : JSON.stringify(a.before), a.after === undefined ? null : JSON.stringify(a.after), a.reason ?? null, admin?.ip ?? null, JSON.stringify(a.metadata ?? {})]);
}

type Handler<P> = (req: Request, ctx: { params: P; admin: Admin; requestId: string }) => Promise<Response>;

/** A route that only an administrator with `permission` may call. Same-origin, JSON errors, request ids as elsewhere. */
export function adminRoute<P = Record<string, string>>(permission: Permission, fn: Handler<P>) {
  return async (req: Request, context: { params: Promise<P> }) => {
    const requestId = req.headers.get("x-request-id") ?? randomUUID();
    try {
      assertSameOrigin(req);
      const admin = await requireAdmin(permission);
      const params = await context.params;
      const res = await fn(req, { params, admin, requestId });
      res.headers.set("x-request-id", requestId);
      return res;
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

export const ok = <T>(body: T, status = 200) => NextResponse.json(body, { status });

/** Reason text for actions that require one. */
export function requireReason(reason: unknown): string {
  const r = typeof reason === "string" ? reason.trim() : "";
  if (r.length < 3) throw new AppError(422, "REASON_REQUIRED", "Give a reason; it is written to the audit trail.", { fieldErrors: { reason: ["Required."] } });
  return r.slice(0, 1000);
}
