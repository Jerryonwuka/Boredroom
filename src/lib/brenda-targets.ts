/**
 * Brenda points inside Boredroom (owner decisions, 11 October 2026: screen help, phase 1, part c: "point inside
 * Boredroom", with no screen access). Boredroom marks its key buttons and sections with a stable attribute
 * (`data-brenda-target="<key>"`); when someone asks how to do something here, her answer can carry a target, and the web
 * app shows a small Brenda that glides to that element, draws a soft ring round it with the catalogue's own label, and
 * fades. From the notch the same answer opens the page in the browser with `?point=<key>`.
 *
 * This catalogue is the one list of what she may point at: the key (the attribute's value and the `point` parameter),
 * the label the pill shows (never the model's words), the page it is on, who has it (the same roles as the page or the
 * button), and a short phrase for the model. Keys use [a-z0-9-] only, so open_page's path check accepts them. It imports
 * nothing, so client components can use it.
 */

export type BrendaTargetRole = "owner" | "hr" | "manager" | "employee";
export const TARGET_ATTR = "data-brenda-target";
export const POINT_PARAM = "point";

/**
 * `page`: the path relative to the workspace where it is (an `anywhere` target is in the shell, on every page: its `page` is
 * the assistant's own page, which always opens); `roles`: who has it.
 */
export type BrendaTarget = { key: string; label: string; page: string; anywhere: boolean; roles: readonly BrendaTargetRole[]; what: string };

const ALL: readonly BrendaTargetRole[] = ["owner", "hr", "manager", "employee"];
const ORG: readonly BrendaTargetRole[] = ["owner", "hr"];
const LEADS: readonly BrendaTargetRole[] = ["owner", "hr", "manager"];
const WORKERS: readonly BrendaTargetRole[] = ["manager", "employee"];

/** A sidebar link: its key is nav-<the href's first part after /app/<slug>/>. */
const nav = (segment: string, label: string, roles: readonly BrendaTargetRole[], what: string): BrendaTarget =>
  ({ key: `nav-${segment}`, label, page: "/home", anywhere: true, roles, what });

export const BRENDA_TARGETS: readonly BrendaTarget[] = Object.freeze([
  // The sidebar (components/app/sidebar.tsx): every page.
  nav("home", "Your assistant's page", ALL, "open your assistant's own page"),
  nav("dashboard", "Dashboard", ORG, "see the organisation right now"),
  nav("my-day", "My Day", WORKERS, "see your day and the running timer"),
  nav("todos", "To-dos", WORKERS, "see your to-do list"),
  nav("clock", "Clock in", WORKERS, "clock in or out"),
  nav("attendance", "Attendance", LEADS, "see who has clocked in today"),
  nav("workroom", "Workroom", LEADS, "see who is working now"),
  nav("tasks", "Tasks", ALL, "see every task you can see"),
  nav("commitments", "Commitments", ALL, "see commitments from group chats"),
  nav("messages", "Messages", ALL, "read and send messages"),
  nav("calls", "Calls", ALL, "see your calls and notes"),
  nav("docs", "Docs", ALL, "find and write documents"),
  nav("reviews", "Reviews", LEADS, "check work waiting for a decision"),
  nav("timesheets", "Timesheets", ALL, "see confirmed hours and export them"),
  nav("projects", "Projects", LEADS, "see projects and their members"),
  nav("people", "People and teams", ORG, "invite people and manage teams"),
  nav("settings", "Settings", ALL, "change settings"),
  nav("audit", "Audit", ORG, "see who did what and when"),
  // The top bar and the shell: every page.
  { key: "search", label: "Search", page: "/home", anywhere: true, roles: ALL, what: "search for tasks, people, projects and teams" },
  { key: "notifications", label: "Notifications", page: "/home", anywhere: true, roles: ALL, what: "see your notifications" },
  { key: "ask-assistant", label: "Ask your assistant", page: "/home", anywhere: true, roles: ALL, what: "open the chat with your assistant" },
  // Pages.
  { key: "tasks-new", label: "New task", page: "/tasks", anywhere: false, roles: [...ORG, "manager"], what: "start a task for someone" },
  { key: "tasks-search", label: "Search tasks", page: "/tasks", anywhere: false, roles: ALL, what: "find a task by its name" },
  { key: "task-edit", label: "Edit task", page: "/tasks/<id>", anywhere: false, roles: ALL, what: "change who holds a task, its due date or reviewer" },
  { key: "task-blocked", label: "Mark blocked", page: "/tasks/<id>", anywhere: false, roles: WORKERS, what: "mark a task you hold as blocked" },
  { key: "todos-add", label: "Add a to-do", page: "/todos", anywhere: false, roles: WORKERS, what: "add a to-do for yourself" },
  { key: "clock-button", label: "Clock in or out", page: "/clock", anywhere: false, roles: WORKERS, what: "clock in before work and out after" },
  { key: "messages-new", label: "New conversation", page: "/messages", anywhere: false, roles: ALL, what: "start a channel or message someone" },
  { key: "docs-new", label: "New document", page: "/docs", anywhere: false, roles: ALL, what: "write a new document" },
  { key: "docs-search", label: "Search documents", page: "/docs", anywhere: false, roles: ALL, what: "find a document" },
  { key: "people-invite", label: "Invite someone", page: "/people", anywhere: false, roles: ORG, what: "invite someone by email" },
  { key: "timesheets-export", label: "Export CSV", page: "/timesheets", anywhere: false, roles: ALL, what: "download hours as a CSV file" },
  { key: "settings-assistant", label: "Your assistant", page: "/settings?section=assistant", anywhere: false, roles: ALL, what: "rename your assistant or change its look and voice" },
  { key: "settings-permissions", label: "Permissions", page: "/settings?section=assistant", anywhere: false, roles: ALL, what: "choose whether your assistant asks before acting" },
  { key: "settings-quiet-hours", label: "Quiet hours", page: "/settings?section=assistant", anywhere: false, roles: ALL, what: "set when your assistant stays quiet" },
  // Phase 3 (owner request, 12 October 2026): the card shows what is on on each Mac and opens the setup there.
  { key: "settings-screen-help-mine", label: "Your Mac", page: "/settings?section=assistant", anywhere: false, roles: ALL, what: "see what's on on your Macs, set them up or turn them off, and list apps never to look at" },
  { key: "settings-screen-help", label: "Screen help on Brenda for Mac", page: "/settings?section=brenda", anywhere: false, roles: ORG, what: "allow or switch off screen help for the workspace" },
  { key: "settings-notice", label: "Monitoring notice", page: "/settings?section=notice", anywhere: false, roles: ORG, what: "change the monitoring notice" },
]);

const BY_KEY: ReadonlyMap<string, BrendaTarget> = new Map(BRENDA_TARGETS.map((t) => [t.key, t]));

/** A key in the catalogue. */
export function isTargetKey(v: unknown): v is string {
  return typeof v === "string" && BY_KEY.has(v);
}

export function targetFor(key: string): BrendaTarget | null {
  return BY_KEY.get(key) ?? null;
}

/** What this role may be pointed at (the same roles as the pages and buttons). */
export function targetsForRole(role: BrendaTargetRole): BrendaTarget[] {
  return BRENDA_TARGETS.filter((t) => t.roles.includes(role));
}

/** The `point` parameter of a query string ("?point=tasks-new&x=1" or "point=…"), when it is a known key; else null. */
export function readPointParam(search: string): string | null {
  const q = String(search ?? "");
  const query = q.includes("?") ? q.slice(q.indexOf("?") + 1) : q;
  let v: string | null = null;
  try { v = new URLSearchParams(query.split("#")[0]).get(POINT_PARAM); } catch { return null; }
  return isTargetKey(v) ? v : null;
}

/** The same address without its `point` parameter; everything else (the path, other parameters, the hash) is kept. */
export function withoutPointParam(url: string): string {
  const s = String(url ?? "");
  const hashAt = s.indexOf("#");
  const hash = hashAt >= 0 ? s.slice(hashAt) : "";
  const beforeHash = hashAt >= 0 ? s.slice(0, hashAt) : s;
  const qAt = beforeHash.indexOf("?");
  if (qAt < 0) return s;
  const path = beforeHash.slice(0, qAt);
  const kept = beforeHash.slice(qAt + 1).split("&").filter((p) => p && decodeURIComponentSafe(p.split("=")[0]) !== POINT_PARAM);
  return `${path}${kept.length ? `?${kept.join("&")}` : ""}${hash}`;
}

function decodeURIComponentSafe(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

/**
 * The line her chat's situation gains (contract D.12): every place she may point at for this role, and how to point.
 * The same for everyone with the role, in the uncached situation (RULES and TOOLS never change).
 */
export function pointingLine(role: BrendaTargetRole): string {
  const list = targetsForRole(role).map((t) => `${t.label} on ${t.anywhere ? "every page" : t.page} (${t.key})`).join("; ");
  return `Places you can point at in Boredroom: ${list}. When the person asks how to do something here or where something is, say in one sentence what to press, and call open_page with that place's page and ?point=<key> (or &point= when the path already has a ?): Boredroom opens the page and points at it.`;
}
