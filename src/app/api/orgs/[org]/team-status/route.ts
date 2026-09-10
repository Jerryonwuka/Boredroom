import { z } from "zod";
import { route, parseQuery, orgContext, ok } from "@/server/lib/api";
import { teamStatus } from "@/server/services/views";
import { forbidden } from "@/server/lib/errors";

/** Scoped last-reported activity and staleness (managers: own teams; HR/owner: organisation). */
export const GET = route<{ org: string }>(async (req, { params }) => {
  const ctx = await orgContext(params.org);
  if (ctx.membership.role === "employee") throw forbidden("Team status is available to managers, HR and owners.");
  const q = parseQuery(req, z.object({ teamId: z.string().uuid().optional() }));
  const data = await teamStatus(ctx, { teamId: q.teamId ?? null });
  return ok({
    serverNow: data.serverNow, staleAfterSeconds: data.staleAfterSeconds, today: data.today,
    members: data.rows.map((r) => ({
      membershipId: r.membership_id, displayName: r.display_name, employeeCode: r.employee_code, role: r.role, teams: r.teams,
      session: r.session_id ? { id: r.session_id, state: r.session_state, taskId: r.task_id, taskTitle: r.task_title, startedAt: r.started_at, lastHeartbeatAt: r.last_heartbeat_at, stale: r.session_state === "running" && r.last_heartbeat_at != null && new Date(data.serverNow).getTime() - new Date(r.last_heartbeat_at).getTime() > data.staleAfterSeconds * 1000 } : null,
      todaySeconds: r.today_seconds, blockedTasks: r.blocked_tasks, openTasks: r.open_tasks, inReviewTasks: r.in_review_tasks, lastActivityAt: r.last_activity_at,
    })),
  });
});
