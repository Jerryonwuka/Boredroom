import type { OrgContext } from "@/server/lib/api";
import type { TaskViewer } from "@/components/app/tasks-page";

/** What the task pop-up needs to know about the person looking at it, from the page's context. */
export const taskViewer = (ctx: OrgContext): TaskViewer => ({ membershipId: ctx.membership.id, displayName: ctx.user.displayName, role: ctx.membership.role, timezone: ctx.org.timezone });
