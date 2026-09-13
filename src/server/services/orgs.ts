import { z } from "zod";
import { randomUUID } from "node:crypto";
import { withUser, withSystem, isUniqueViolation, type Db } from "@/server/db";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { randomToken, sha256 } from "@/server/lib/crypto";
import { isValidTimeZone } from "@/server/lib/time";
import { mail } from "@/server/lib/mail";
import { audit, notify } from "@/server/services/common";
import type { OrgContext } from "@/server/lib/api";

export const ROLES = ["owner", "hr", "manager", "employee"] as const;
export type Role = (typeof ROLES)[number];

export const DEFAULT_NOTICE = `Boredroom records the tasks you plan, the work sessions you start and stop, the progress notes and evidence you submit, and the daily reports you file. Timers only run when you start them. Heartbeats show whether your browser is connected; they are not a measure of productivity.

Screen recording is optional and is never started for you: it only happens while your timer runs and after you press "Record screen" and choose a screen or window in your browser. Never audio, always with a visible indicator, and only people with an explicit, logged access grant can watch it. Recordings are deleted automatically after the retention period. Your organisation can switch recording off, or require it on specific tasks, by publishing a new version of this notice.

Unlogged or uncertain time leads to a clarification request, not an automatic penalty.`;

export const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/, "Use 3–64 lowercase letters, numbers and hyphens."),
  timezone: z.string().default("Africa/Lagos"),
  employeeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/).default("OWN-001"),
});

export async function createOrganisation(userId: string, input: z.infer<typeof createOrgSchema>) {
  if (!isValidTimeZone(input.timezone)) throw invalid("Unknown time zone.", { timezone: ["Choose a valid IANA time zone."] });
  return withUser(userId, async (db) => {
    // The id is generated here: RETURNING would need SELECT rights the creator only gains once their membership exists.
    const org = { id: randomUUID(), slug: input.slug };
    try {
      await db.query(`INSERT INTO organisations(id, name, slug, timezone, setup_state) VALUES ($1, $2, $3, $4, $5)`,
        [org.id, input.name, input.slug, input.timezone, JSON.stringify({ created: true })]);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("SLUG_TAKEN", "That workspace URL is already in use.");
      throw err;
    }
    const membership = await db.one<{ id: string }>(
      `INSERT INTO memberships(organisation_id, user_id, employee_code, role) VALUES ($1, $2, $3, 'owner') RETURNING id`,
      [org.id, userId, input.employeeCode]);
    const policy = await db.one<{ id: string }>(
      `INSERT INTO policies(organisation_id, version, recording_mode, retention_days, notice_text, created_by, effective_at)
       VALUES ($1, 1, 'optional', 7, $2, $3, now()) RETURNING id`, [org.id, DEFAULT_NOTICE, membership.id]);
    await db.query(`UPDATE organisations SET current_policy_id = $2 WHERE id = $1`, [org.id, policy.id]);
    await db.query(`INSERT INTO schedules(organisation_id, timezone) VALUES ($1, $2)`, [org.id, input.timezone]);
    await db.query(`INSERT INTO policy_acknowledgements(organisation_id, membership_id, policy_id, shown_notice_text) VALUES ($1, $2, $3, $4)`,
      [org.id, membership.id, policy.id, DEFAULT_NOTICE]);
    await audit(db, { organisationId: org.id, actorMembershipId: membership.id, actorUserId: userId, action: "org.created", subjectType: "organisation", subjectId: org.id });
    return { orgId: org.id, slug: org.slug, membershipId: membership.id };
  });
}

export async function listMyWorkspaces(userId: string) {
  return withUser(userId, (db) => db.query<{ id: string; slug: string; name: string; role: Role; timezone: string }>(
    `SELECT o.id, o.slug, o.name, m.role, o.timezone FROM organisations o JOIN memberships m ON m.organisation_id = o.id
     WHERE m.user_id = $1 AND m.status = 'active' AND o.status = 'active' ORDER BY o.created_at`, [userId]));
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------
export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(ROLES),
  teamId: z.string().uuid().optional().nullable(),
  employeeCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/).optional().nullable(),
});

function assertCanGrant(ctx: OrgContext, role: Role) {
  if (ctx.membership.role === "owner") return;
  if (ctx.membership.role === "hr" && (role === "manager" || role === "employee")) return;
  throw forbidden("Only owners can grant owner or HR roles.");
}

export async function createInvitation(ctx: OrgContext, input: z.infer<typeof inviteSchema>, opts: { send: boolean }) {
  assertCanGrant(ctx, input.role);
  return withUser(ctx.user.profileId, async (db) => {
    const existing = await db.maybeOne(`SELECT 1 FROM memberships m JOIN profiles p ON p.id = m.user_id WHERE m.organisation_id = $1 AND p.email = $2 AND m.status = 'active'`, [ctx.org.id, input.email]);
    if (existing) throw conflict("ALREADY_MEMBER", "That person is already a member of this workspace.");
    const ttl = await db.one<{ h: number }>(`SELECT COALESCE((SELECT invitation_ttl_hours FROM policies WHERE id = $1), 72) AS h`, [ctx.org.current_policy_id]);
    const token = randomToken(32);
    let inv: { id: string; expires_at: string };
    try {
      inv = await db.one(
        `INSERT INTO invitations(organisation_id, email, role, team_id, employee_code, token_hash, expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6, now() + ($7 || ' hours')::interval, $8) RETURNING id, expires_at`,
        [ctx.org.id, input.email, input.role, input.teamId ?? null, input.employeeCode ?? null, sha256(token), String(ttl.h), ctx.membership.id]);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("INVITE_PENDING", "A pending invitation already exists for that email. Revoke it first to resend.");
      throw err;
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "invitation.created", subjectType: "invitation", subjectId: inv.id, metadata: { email: input.email, role: input.role } });
    if (opts.send) {
      const url = `${process.env.APP_ORIGIN ?? "http://localhost:3000"}/invite/${token}`;
      await mail().send({
        to: input.email, category: "invitation",
        subject: `You're invited to ${ctx.org.name} on Boredroom`,
        text: `${ctx.user.displayName} invited you to join ${ctx.org.name} as ${input.role}.\n\nAccept the invitation (signed in with ${input.email}):\n${url}\n\nThis link is single-use and expires ${new Date(inv.expires_at).toUTCString()}.`,
      });
      await db.query(`UPDATE invitations SET sent_at = now() WHERE id = $1`, [inv.id]);
    }
    return { id: inv.id, expiresAt: inv.expires_at, token: opts.send ? undefined : token };
  });
}

export async function revokeInvitation(ctx: OrgContext, invitationId: string) {
  return withUser(ctx.user.profileId, async (db) => {
    const row = await db.maybeOne<{ id: string }>(
      `UPDATE invitations SET revoked_at = now() WHERE id = $1 AND organisation_id = $2 AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`, [invitationId, ctx.org.id]);
    if (!row) throw notFound("Invitation not found or already closed.");
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "invitation.revoked", subjectType: "invitation", subjectId: row.id });
  });
}

export type InvitationPreview = { id: string; orgName: string; orgSlug: string; role: Role; email: string; state: "pending" | "expired" | "revoked" | "accepted" };

export async function previewInvitation(token: string): Promise<InvitationPreview | null> {
  return withSystem(async (db) => {
    const row = await db.maybeOne<{ id: string; name: string; slug: string; role: Role; email: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>(
      `SELECT i.id, o.name, o.slug, i.role, i.email, i.expires_at, i.accepted_at, i.revoked_at
       FROM invitations i JOIN organisations o ON o.id = i.organisation_id WHERE i.token_hash = $1`, [sha256(token)]);
    if (!row) return null;
    const state = row.accepted_at ? "accepted" : row.revoked_at ? "revoked" : new Date(row.expires_at) < new Date() ? "expired" : "pending";
    return { id: row.id, orgName: row.name, orgSlug: row.slug, role: row.role, email: row.email, state };
  });
}

/** Email-bound, single-use acceptance. The membership role comes from the stored invitation, never the client. */
export async function acceptInvitation(userId: string, userEmail: string, token: string) {
  return withUser(userId, async (db) => {
    // The invitee is not a member yet, so only the invitation row (matched by email) is visible; the organisation is read after joining.
    const inv = await db.maybeOne<{ id: string; organisation_id: string; email: string; role: Role; team_id: string | null; employee_code: string | null; expires_at: string; accepted_at: string | null; revoked_at: string | null }>(
      `SELECT i.id, i.organisation_id, i.email, i.role, i.team_id, i.employee_code, i.expires_at, i.accepted_at, i.revoked_at
       FROM invitations i WHERE i.token_hash = $1 FOR UPDATE`, [sha256(token)]);
    if (!inv) throw notFound("This invitation is not valid.");
    if (inv.email.toLowerCase() !== userEmail.toLowerCase()) throw forbidden(`This invitation was sent to ${inv.email}. Sign in with that email to accept it.`);
    if (inv.accepted_at) throw conflict("INVITE_USED", "This invitation has already been accepted.");
    if (inv.revoked_at) throw conflict("INVITE_REVOKED", "This invitation was revoked.");
    if (new Date(inv.expires_at) < new Date()) throw conflict("INVITE_EXPIRED", "This invitation has expired. Ask your administrator for a new one.");

    const code = inv.employee_code ?? (await nextEmployeeCode(db, inv.organisation_id));
    let membership: { id: string };
    try {
      membership = await db.one(`INSERT INTO memberships(organisation_id, user_id, employee_code, role) VALUES ($1, $2, $3, $4) RETURNING id`,
        [inv.organisation_id, userId, code, inv.role]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const constraint = (err as { constraint?: string }).constraint ?? "";
        if (constraint.includes("employee_code")) throw conflict("EMPLOYEE_CODE_TAKEN", "The employee ID on this invitation is already in use. Ask your administrator to reissue it.");
        throw conflict("ALREADY_MEMBER", "You are already a member of this workspace.");
      }
      throw err;
    }
    await db.query(`UPDATE invitations SET accepted_at = now(), accepted_membership_id = $2 WHERE id = $1`, [inv.id, membership.id]);
    if (inv.team_id) {
      await db.query(`INSERT INTO team_members(organisation_id, team_id, membership_id, is_manager) VALUES ($1, $2, $3, $4)`,
        [inv.organisation_id, inv.team_id, membership.id, inv.role === "manager"]);
      await syncTeamProjectMember(db, inv.organisation_id, inv.team_id, membership.id, inv.role === "manager" ? "lead" : "contributor");
    }
    await audit(db, { organisationId: inv.organisation_id, actorMembershipId: membership.id, actorUserId: userId, action: "invitation.accepted", subjectType: "membership", subjectId: membership.id, subjectMembershipId: membership.id });
    const org = await db.one<{ slug: string }>(`SELECT slug FROM organisations WHERE id = $1`, [inv.organisation_id]);
    return { orgSlug: org.slug, membershipId: membership.id };
  });
}

async function nextEmployeeCode(db: Db, orgId: string): Promise<string> {
  const row = await db.one<{ code: string }>(`SELECT app_next_employee_code($1) AS code`, [orgId]);
  return row.code;
}

// ---------------------------------------------------------------------------
// Members, roles, offboarding
// ---------------------------------------------------------------------------
export async function changeRole(ctx: OrgContext, membershipId: string, role: Role) {
  assertCanGrant(ctx, role);
  if (membershipId === ctx.membership.id) throw forbidden("You cannot change your own role.");
  return withUser(ctx.user.profileId, async (db) => {
    const before = await db.maybeOne<{ role: Role }>(`SELECT role FROM memberships WHERE id = $1 AND organisation_id = $2 AND status = 'active'`, [membershipId, ctx.org.id]);
    if (!before) throw notFound("Member not found.");
    if (before.role === "owner" && ctx.membership.role !== "owner") throw forbidden("Only owners can change an owner's role.");
    try {
      await db.query(`UPDATE memberships SET role = $3 WHERE id = $1 AND organisation_id = $2`, [membershipId, ctx.org.id, role]);
    } catch (err) {
      throw translateMembershipError(err);
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "membership.role_changed", subjectType: "membership", subjectId: membershipId, subjectMembershipId: membershipId, metadata: { from: before.role, to: role } });
  });
}

function translateMembershipError(err: unknown) {
  const msg = (err as Error).message ?? "";
  if (msg.includes("LAST_OWNER")) return conflict("LAST_OWNER", "An organisation must keep at least one active owner. Grant the owner role to someone else first.");
  if (msg.includes("ROLE_GRANT_FORBIDDEN")) return forbidden("Only owners can grant owner or HR roles.");
  return err as Error;
}

/** Revokes access immediately; interrupts any open session at its last confirmed boundary; keeps history. */
export async function revokeMembership(ctx: OrgContext, membershipId: string) {
  if (membershipId === ctx.membership.id) throw forbidden("You cannot offboard yourself.");
  return withUser(ctx.user.profileId, async (db) => {
    const m = await db.maybeOne<{ id: string; role: Role; user_id: string }>(`SELECT id, role, user_id FROM memberships WHERE id = $1 AND organisation_id = $2 AND status = 'active' FOR UPDATE`, [membershipId, ctx.org.id]);
    if (!m) throw notFound("Member not found.");
    if (m.role === "owner" && ctx.membership.role !== "owner") throw forbidden("Only owners can offboard an owner.");
    try {
      await db.query(`UPDATE memberships SET status = 'revoked', revoked_at = now(), revoked_by = $3 WHERE id = $1 AND organisation_id = $2`, [membershipId, ctx.org.id, ctx.membership.id]);
    } catch (err) {
      throw translateMembershipError(err);
    }
    // Interrupt open session at last heartbeat; do not credit anything after it.
    const open = await db.maybeOne<{ id: string; last_heartbeat_at: string }>(
      `SELECT id, last_heartbeat_at FROM work_sessions WHERE membership_id = $1 AND state IN ('running','paused','interrupted') FOR UPDATE`, [membershipId]);
    if (open) {
      await db.query(`UPDATE session_intervals SET ended_at = GREATEST(started_at, LEAST($2::timestamptz, now())) WHERE session_id = $1 AND ended_at IS NULL`, [open.id, open.last_heartbeat_at]);
      await db.query(`UPDATE work_sessions SET state = 'stopped', ended_at = now(), stop_outcome = 'continue_later', stop_note = 'Session closed during offboarding', version = version + 1 WHERE id = $1`, [open.id]);
      await db.query(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, metadata) VALUES ($1, $2, $3, 'offboarded', $4)`,
        [ctx.org.id, open.id, ctx.user.profileId, JSON.stringify({ confirmedUntil: open.last_heartbeat_at })]);
    }
    await db.query(`UPDATE recording_grants SET revoked_at = now(), revoked_by = $3 WHERE grantee_membership_id = $1 AND organisation_id = $2 AND revoked_at IS NULL`, [membershipId, ctx.org.id, ctx.membership.id]);
    await db.query(`UPDATE auth_sessions s SET revoked_at = now() FROM profiles p WHERE p.id = $1 AND s.user_id = p.auth_user_id AND s.revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM memberships mm WHERE mm.user_id = p.id AND mm.status = 'active')`, [m.user_id]).catch(() => undefined);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "membership.revoked", subjectType: "membership", subjectId: membershipId, subjectMembershipId: membershipId, metadata: { interruptedSession: open?.id ?? null } });
  });
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------
export async function createTeam(ctx: OrgContext, name: string) {
  return withUser(ctx.user.profileId, async (db) => {
    try {
      const t = await db.one<{ id: string }>(`INSERT INTO teams(organisation_id, name) VALUES ($1, $2) RETURNING id`, [ctx.org.id, name.trim()]);
      // Every team gets a working project of the same name where its lead creates and assigns tasks.
      const p = await db.one<{ id: string }>(`INSERT INTO projects(organisation_id, name, description, created_by) VALUES ($1, $2, $3, $4) RETURNING id`, [ctx.org.id, name.trim(), `Working project for the ${name.trim()} team`, ctx.membership.id]);
      await db.query(`UPDATE teams SET project_id = $2 WHERE id = $1`, [t.id, p.id]);
      await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "team.created", subjectType: "team", subjectId: t.id, metadata: { name, projectId: p.id } });
      return t;
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("TEAM_EXISTS", "A team with that name already exists.");
      throw err;
    }
  });
}

export async function setTeamMember(ctx: OrgContext, teamId: string, membershipId: string, opts: { isManager: boolean; remove?: boolean }) {
  return withUser(ctx.user.profileId, async (db) => {
    if (opts.remove) {
      await db.query(`DELETE FROM team_members WHERE organisation_id = $1 AND team_id = $2 AND membership_id = $3`, [ctx.org.id, teamId, membershipId]);
      await syncTeamProjectMember(db, ctx.org.id, teamId, membershipId, "remove");
    } else {
      await db.query(
        `INSERT INTO team_members(organisation_id, team_id, membership_id, is_manager) VALUES ($1, $2, $3, $4)
         ON CONFLICT (team_id, membership_id) DO UPDATE SET is_manager = EXCLUDED.is_manager`, [ctx.org.id, teamId, membershipId, opts.isManager]);
      // Team leads are managers of their team; the role is raised (never lowered) so a lead can review the team's work.
      if (opts.isManager) await db.query(`UPDATE memberships SET role = 'manager' WHERE id = $1 AND organisation_id = $2 AND role = 'employee'`, [membershipId, ctx.org.id]);
      await syncTeamProjectMember(db, ctx.org.id, teamId, membershipId, opts.isManager ? "lead" : "contributor");
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: opts.remove ? "team.member_removed" : "team.member_set", subjectType: "team", subjectId: teamId, subjectMembershipId: membershipId, metadata: { isManager: opts.isManager } });
  });
}

// ---------------------------------------------------------------------------
// Settings: organisation, schedule, policy
// ---------------------------------------------------------------------------
export const orgSettingsSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  timezone: z.string().optional(),
});

export async function updateOrganisation(ctx: OrgContext, input: z.infer<typeof orgSettingsSchema>) {
  if (input.timezone && !isValidTimeZone(input.timezone)) throw invalid("Unknown time zone.", { timezone: ["Choose a valid IANA time zone."] });
  return withUser(ctx.user.profileId, async (db) => {
    await db.query(`UPDATE organisations SET name = COALESCE($2, name), timezone = COALESCE($3, timezone) WHERE id = $1`, [ctx.org.id, input.name ?? null, input.timezone ?? null]);
    if (input.timezone) {
      // Prospective change: a new schedule row from today; submitted reports keep their snapshot zone.
      await db.query(`INSERT INTO schedules(organisation_id, timezone, working_days, start_local, end_local, effective_from)
        SELECT organisation_id, $2, working_days, start_local, end_local, CURRENT_DATE FROM schedules WHERE organisation_id = $1 AND membership_id IS NULL ORDER BY effective_from DESC LIMIT 1`, [ctx.org.id, input.timezone]);
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "org.updated", subjectType: "organisation", subjectId: ctx.org.id, metadata: input });
  });
}

export const scheduleSchema = z.object({
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startLocal: z.string().regex(/^\d{2}:\d{2}$/),
  endLocal: z.string().regex(/^\d{2}:\d{2}$/),
});

export async function updateSchedule(ctx: OrgContext, input: z.infer<typeof scheduleSchema>) {
  if (input.endLocal <= input.startLocal) throw invalid("End time must be after start time.", { endLocal: ["End time must be after start time."] });
  return withUser(ctx.user.profileId, async (db) => {
    await db.query(`INSERT INTO schedules(organisation_id, timezone, working_days, start_local, end_local, effective_from) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE)`,
      [ctx.org.id, ctx.org.timezone, input.workingDays, input.startLocal, input.endLocal]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "schedule.updated", subjectType: "organisation", subjectId: ctx.org.id, metadata: input });
  });
}

export const policySchema = z.object({
  recordingMode: z.enum(["disabled", "optional", "required_on_designated_tasks"]),
  retentionDays: z.number().int().min(1).max(30),
  noticeText: z.string().trim().min(20).max(20000),
  reminderMinutesBeforeEnd: z.number().int().min(0).max(240).default(30),
});

/** Creates a new policy version and makes it current; members must acknowledge before new capture sessions. */
export async function publishPolicy(ctx: OrgContext, input: z.infer<typeof policySchema>) {
  if (ctx.membership.role !== "owner") throw forbidden("Only owners can change the monitoring policy.");
  return withUser(ctx.user.profileId, async (db) => {
    const v = await db.one<{ next: number }>(`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM policies WHERE organisation_id = $1`, [ctx.org.id]);
    const p = await db.one<{ id: string }>(
      `INSERT INTO policies(organisation_id, version, recording_mode, retention_days, notice_text, reminder_minutes_before_end, created_by, effective_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
      [ctx.org.id, v.next, input.recordingMode, input.retentionDays, input.noticeText, input.reminderMinutesBeforeEnd, ctx.membership.id]);
    await db.query(`UPDATE organisations SET current_policy_id = $2 WHERE id = $1`, [ctx.org.id, p.id]);
    await db.query(`INSERT INTO policy_acknowledgements(organisation_id, membership_id, policy_id, shown_notice_text) VALUES ($1, $2, $3, $4)`,
      [ctx.org.id, ctx.membership.id, p.id, input.noticeText]);
    const members = await db.query<{ id: string }>(`SELECT id FROM memberships WHERE organisation_id = $1 AND status = 'active' AND id <> $2`, [ctx.org.id, ctx.membership.id]);
    for (const m of members) {
      await notify(db, { organisationId: ctx.org.id, recipientMembershipId: m.id, type: "policy.updated", title: `Monitoring policy updated to version ${v.next}`, body: "Review and acknowledge the new version before starting recorded work.", href: `/app/${ctx.org.slug}/policy`, dedupKey: `policy:${p.id}` });
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "policy.published", subjectType: "policy", subjectId: p.id, metadata: { version: v.next, recordingMode: input.recordingMode, retentionDays: input.retentionDays } });
    return { id: p.id, version: v.next };
  });
}

export async function acknowledgePolicy(ctx: OrgContext) {
  return withUser(ctx.user.profileId, async (db) => {
    const p = await db.maybeOne<{ id: string; notice_text: string }>(`SELECT id, notice_text FROM policies WHERE id = $1`, [ctx.org.current_policy_id]);
    if (!p) throw notFound("No current policy.");
    await db.query(`INSERT INTO policy_acknowledgements(organisation_id, membership_id, policy_id, shown_notice_text) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [ctx.org.id, ctx.membership.id, p.id, p.notice_text]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "policy.acknowledged", subjectType: "policy", subjectId: p.id, subjectMembershipId: ctx.membership.id });
  });
}

export async function hasAcknowledgedCurrentPolicy(db: Db, ctx: OrgContext): Promise<boolean> {
  if (!ctx.org.current_policy_id) return true;
  const r = await db.maybeOne(`SELECT 1 FROM policy_acknowledgements WHERE membership_id = $1 AND policy_id = $2`, [ctx.membership.id, ctx.org.current_policy_id]);
  return !!r;
}

export async function grantRecordingAccess(ctx: OrgContext, input: { granteeMembershipId: string; scopeType: "organisation" | "team" | "privacy_admin"; scopeId?: string | null }) {
  if (ctx.membership.role !== "owner") throw forbidden("Only owners can grant recording access.");
  return withUser(ctx.user.profileId, async (db) => {
    const g = await db.one<{ id: string }>(
      `INSERT INTO recording_grants(organisation_id, grantee_membership_id, scope_type, scope_id, granted_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [ctx.org.id, input.granteeMembershipId, input.scopeType, input.scopeType === "team" ? input.scopeId : null, ctx.membership.id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "recording_grant.created", subjectType: "recording_grant", subjectId: g.id, subjectMembershipId: input.granteeMembershipId, metadata: input });
    return g;
  });
}

export async function revokeRecordingAccess(ctx: OrgContext, grantId: string) {
  if (ctx.membership.role !== "owner") throw forbidden("Only owners can revoke recording access.");
  return withUser(ctx.user.profileId, async (db) => {
    const g = await db.maybeOne<{ id: string; grantee_membership_id: string }>(`UPDATE recording_grants SET revoked_at = now(), revoked_by = $3 WHERE id = $1 AND organisation_id = $2 AND revoked_at IS NULL RETURNING id, grantee_membership_id`, [grantId, ctx.org.id, ctx.membership.id]);
    if (!g) throw notFound("Grant not found.");
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "recording_grant.revoked", subjectType: "recording_grant", subjectId: g.id, subjectMembershipId: g.grantee_membership_id });
  });
}

export { AppError };

// ---------------------------------------------------------------------------
// Join codes: the organisation account hands out a code or link; staff can only join through it.
// ---------------------------------------------------------------------------
function newJoinCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const pick = (n: number) => Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  return `${pick(4)}-${pick(4)}`;
}

export const joinCodeSchema = z.object({
  enabled: z.boolean().optional(),
  role: z.enum(["manager", "employee"]).optional(),
  teamId: z.string().uuid().nullable().optional(),
  rotate: z.boolean().optional(),
});

/** Owner/HR: enable, disable, retarget or rotate the organisation's join code. Rotating invalidates the old one immediately. */
export async function updateJoinCode(ctx: OrgContext, input: z.infer<typeof joinCodeSchema>) {
  if (!["owner", "hr"].includes(ctx.membership.role)) throw forbidden();
  return withUser(ctx.user.profileId, async (db) => {
    const cur = await db.one<{ join_code: string | null }>(`SELECT join_code FROM organisations WHERE id = $1`, [ctx.org.id]);
    const code = input.rotate || !cur.join_code ? newJoinCode() : cur.join_code;
    await db.query(
      `UPDATE organisations SET join_code = $2, join_code_enabled = COALESCE($3, join_code_enabled), join_code_role = COALESCE($4, join_code_role),
         join_code_team_id = CASE WHEN $6 THEN $5 ELSE join_code_team_id END, join_code_rotated_at = CASE WHEN $2 <> COALESCE(join_code, '') THEN now() ELSE join_code_rotated_at END
       WHERE id = $1`,
      [ctx.org.id, code, input.enabled ?? null, input.role ?? null, input.teamId ?? null, input.teamId !== undefined]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "join_code.updated", subjectType: "organisation", subjectId: ctx.org.id, metadata: { enabled: input.enabled, role: input.role, teamId: input.teamId, rotated: !!input.rotate || !cur.join_code } });
    return readJoinCode(db, ctx.org.id);
  });
}

type JoinCodeRow = { join_code: string | null; join_code_enabled: boolean; join_code_role: string; join_code_team_id: string | null; join_code_rotated_at: string | null };
const readJoinCode = (db: Db, orgId: string) => db.one<JoinCodeRow>(`SELECT join_code, join_code_enabled, join_code_role, join_code_team_id, join_code_rotated_at FROM organisations WHERE id = $1`, [orgId]);

export async function joinCodeView(ctx: OrgContext) {
  return withUser(ctx.user.profileId, (db) => readJoinCode(db, ctx.org.id));
}

export type JoinPreview = { organisationId: string; name: string; slug: string; role: "manager" | "employee"; teamId: string | null; enabled: boolean };

export async function previewJoinCode(code: string): Promise<JoinPreview | null> {
  const clean = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(clean)) return null;
  return withSystem(async (db) => {
    const r = await db.maybeOne<{ organisation_id: string; name: string; slug: string; role: "manager" | "employee"; team_id: string | null; enabled: boolean }>(`SELECT * FROM app_join_code_preview($1)`, [clean]);
    return r ? { organisationId: r.organisation_id, name: r.name, slug: r.slug, role: r.role, teamId: r.team_id, enabled: r.enabled } : null;
  });
}

/** Staff joins with the organisation's code. The role comes from the code's configuration, never from the client. */
export async function joinWithCode(userId: string, code: string) {
  const preview = await previewJoinCode(code);
  if (!preview) throw notFound("That organisation code is not valid.");
  if (!preview.enabled) throw conflict("JOIN_DISABLED", "This organisation is not accepting new members with this code right now. Ask your administrator for a new one.");
  const clean = code.trim().toUpperCase().replace(/\s+/g, "");
  return withUser(userId, async (db) => {
    await db.query(`SELECT set_config('app.join_code', $1, true)`, [clean]);
    const existing = await db.maybeOne<{ status: string }>(`SELECT status FROM memberships WHERE organisation_id = $1 AND user_id = $2`, [preview.organisationId, userId]);
    if (existing?.status === "active") throw conflict("ALREADY_MEMBER", "You are already a member of this organisation.");
    if (existing?.status === "revoked") throw forbidden("Your access to this organisation was removed. Ask your administrator to invite you again.");
    const employeeCode = await db.one<{ code: string }>(`SELECT app_next_employee_code($1) AS code`, [preview.organisationId]);
    const membership = await db.one<{ id: string }>(`INSERT INTO memberships(organisation_id, user_id, employee_code, role) VALUES ($1, $2, $3, $4) RETURNING id`,
      [preview.organisationId, userId, employeeCode.code, preview.role]);
    if (preview.teamId) {
      await db.query(`INSERT INTO team_members(organisation_id, team_id, membership_id, is_manager) VALUES ($1, $2, $3, false)`, [preview.organisationId, preview.teamId, membership.id]);
      await syncTeamProjectMember(db, preview.organisationId, preview.teamId, membership.id, "contributor");
    }
    await audit(db, { organisationId: preview.organisationId, actorMembershipId: membership.id, actorUserId: userId, action: "join_code.accepted", subjectType: "membership", subjectId: membership.id, subjectMembershipId: membership.id, metadata: { role: preview.role, teamId: preview.teamId } });
    return { orgSlug: preview.slug, membershipId: membership.id };
  });
}

/** Keeps a team's working project in step with team membership so leads can assign tasks to their people. */
export async function syncTeamProjectMember(db: Db, orgId: string, teamId: string, membershipId: string, accessRole: "lead" | "contributor" | "remove") {
  await db.query(`SELECT app_sync_team_project_member($1, $2, $3, $4)`, [orgId, teamId, membershipId, accessRole]);
}

// ---------------------------------------------------------------------------
// AI assistant connection (per organisation)
// ---------------------------------------------------------------------------
export const assistantKeySchema = z.object({
  apiKey: z.string().trim().min(20).max(400),
  model: z.string().trim().min(3).max(80).optional(),
});

export type AssistantStatus = { source: "organisation" | "environment" | "none"; hint: string | null; model: string | null; connectedAt: string | null };

export async function assistantStatus(ctx: OrgContext): Promise<AssistantStatus> {
  const row = await withSystem((db) => db.maybeOne<{ assistant_key_hint: string | null; assistant_model: string | null; assistant_connected_at: string | null; assistant_key_enc: string | null }>(`SELECT assistant_key_hint, assistant_model, assistant_connected_at, assistant_key_enc FROM organisation_secrets WHERE organisation_id = $1`, [ctx.org.id]));
  if (row?.assistant_key_enc) return { source: "organisation", hint: row.assistant_key_hint, model: row.assistant_model, connectedAt: row.assistant_connected_at };
  if (process.env.ANTHROPIC_API_KEY) return { source: "environment", hint: null, model: process.env.ASSISTANT_MODEL ?? null, connectedAt: null };
  return { source: "none", hint: null, model: null, connectedAt: null };
}

/** Stores the organisation's Anthropic API key after one real test request succeeds. Owners only. */
export async function setAssistantKey(ctx: OrgContext, input: z.infer<typeof assistantKeySchema>, verify: (apiKey: string, model: string) => Promise<{ model: string; reply: string }>) {
  if (ctx.membership.role !== "owner") throw forbidden("Only owners can connect the AI assistant.");
  const { DEFAULT_ASSISTANT_MODEL } = await import("@/server/services/assistant");
  const model = input.model || process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL;
  let test: { model: string; reply: string };
  try { test = await verify(input.apiKey, model); }
  catch (err) {
    const e = err as { status?: number; message?: string };
    if (e?.status === 401) throw invalid("Anthropic rejected this key. Copy it again from console.anthropic.com → API keys.", { apiKey: ["Key rejected."] });
    if (e?.status === 404) throw invalid(`The model "${model}" is not available to this key.`, { model: ["Model not found."] });
    if (e?.status === 429 || e?.status === 400) throw invalid(`Anthropic answered: ${(e.message ?? "request refused").slice(0, 200)}`);
    throw invalid(`Could not reach Anthropic: ${(e?.message ?? String(err)).slice(0, 200)}`);
  }
  const { encryptSecret } = await import("@/server/lib/crypto");
  await withUser(ctx.user.profileId, async (db) => {
    await db.query(`INSERT INTO organisation_secrets(organisation_id, assistant_key_enc, assistant_key_hint, assistant_model, assistant_connected_at, updated_by, updated_at)
      VALUES ($1, $2, $3, $4, now(), $5, now())
      ON CONFLICT (organisation_id) DO UPDATE SET assistant_key_enc = EXCLUDED.assistant_key_enc, assistant_key_hint = EXCLUDED.assistant_key_hint, assistant_model = EXCLUDED.assistant_model, assistant_connected_at = now(), updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [ctx.org.id, encryptSecret(input.apiKey), `…${input.apiKey.slice(-4)}`, model, ctx.membership.id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "assistant.connected", subjectType: "organisation", subjectId: ctx.org.id, metadata: { model } });
  });
  return { model: test.model, reply: test.reply };
}

export async function clearAssistantKey(ctx: OrgContext) {
  if (ctx.membership.role !== "owner") throw forbidden("Only owners can disconnect the AI assistant.");
  await withUser(ctx.user.profileId, async (db) => {
    await db.query(`DELETE FROM organisation_secrets WHERE organisation_id = $1`, [ctx.org.id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "assistant.disconnected", subjectType: "organisation", subjectId: ctx.org.id });
  });
}

/** One-click recording switch: publishes a new policy version that changes only the recording mode. Owners only. */
export async function setRecordingMode(ctx: OrgContext, mode: "disabled" | "optional" | "required_on_designated_tasks") {
  if (ctx.membership.role !== "owner") throw forbidden("Only owners can change the monitoring policy.");
  const current = await withUser(ctx.user.profileId, (db) => db.maybeOne<{ recording_mode: string; retention_days: number; notice_text: string; reminder_minutes_before_end: number }>(`SELECT recording_mode, retention_days, notice_text, reminder_minutes_before_end FROM policies WHERE id = $1`, [ctx.org.current_policy_id]));
  if (current?.recording_mode === mode) return { changed: false as const };
  const r = await publishPolicy(ctx, { recordingMode: mode, retentionDays: current?.retention_days ?? 7, noticeText: current?.notice_text ?? DEFAULT_NOTICE, reminderMinutesBeforeEnd: current?.reminder_minutes_before_end ?? 30 });
  return { changed: true as const, version: r.version };
}
