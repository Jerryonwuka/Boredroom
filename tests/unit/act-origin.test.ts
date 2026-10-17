/**
 * The owner's permission rule by construction (12 October 2026: "Brenda cannot take any action except I explicitly give
 * an instruction … Brenda cannot just be doing things in the background on its own"; contract 0.8, 0.9 (d)):
 * - act.no_act_mode_import: the task service and the step loop import nothing that reads "Act without asking";
 * - a task row is created in one place (proposeTask), which one place calls (the v2 look turn), which one route calls
 *   (POST /assistant/look); no chat, routine, follow-up, notification or worker path can propose or run a task;
 * - propose_task exists only in the look turn's tools, never in TOOLS (ordinary chat, mentions, routines).
 * Phase 3 (owner report and requests, 12 October 2026; contract 0.5): the same for plans. act-plan.ts and the new routes
 * import nothing about act mode; a plan row is inserted only by proposePlan, which only proposeTask calls; the scope,
 * progress, run and folder routes never create a row; the setup flag opens nothing.
 * Brenda and her helpers (owner brief, 12 October 2026: permission rule v2; contract 0.3, 0.5, R.9): the front desk and
 * the jobs import nothing about act mode either; a job row is inserted in one place (createJob, from the router's signed
 * token for the person's own request); a front-capable Mac's look never offers propose_task.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { LOOK_TOOLS, LOOK_TOOLS_FRONT, LOOK_TOOLS_FRONT_THINK, LOOK_TOOLS_NO_TASKS, LOOK_TOOLS_PLAN, MAC_CHAT_TOOLS, TOOLS } from "@/server/services/copilot";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(root, dir))) {
    const p = join(dir, name);
    if (statSync(join(root, p)).isDirectory()) files(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const all = [...files("src"), ...files("worker")];
const importsOf = (src: string) => [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]);

describe("act.no_act_mode_import (contract 0.9)", () => {
  it.each(["src/server/services/act.ts", "src/server/services/act-model.ts", "src/lib/act.ts",
    "src/app/api/orgs/[org]/assistant/act/[id]/answer/route.ts", "src/app/api/orgs/[org]/assistant/act/[id]/step/route.ts",
    "src/app/api/orgs/[org]/assistant/act/[id]/step-answer/route.ts", "src/app/api/orgs/[org]/assistant/act/[id]/stop/route.ts",
    "src/app/api/orgs/[org]/assistant/act/[id]/file/route.ts",
    // Phase 3 (contract 0.3 d, 0.5): plans.
    "src/server/services/act-plan.ts", "src/app/api/orgs/[org]/assistant/act/[id]/scope/route.ts", "src/app/api/orgs/[org]/assistant/act/[id]/progress/route.ts",
    "src/app/api/orgs/[org]/assistant/act/[id]/run/route.ts", "src/app/api/orgs/[org]/assistant/act/[id]/folder/route.ts",
    "src/app/api/orgs/[org]/assistant/act/[id]/folder/finish/route.ts", "src/app/api/orgs/[org]/screen-help/mac/route.ts",
    // Brenda and her helpers (contract 0.5 act.no_act_mode_import, extended).
    "src/server/services/front.ts", "src/server/services/front-model.ts", "src/server/services/jobs.ts", "src/server/services/jobs-model.ts",
    "src/server/lib/mac-context.ts", "src/lib/front.ts", "src/lib/mac-risk.ts",
    "src/app/api/orgs/[org]/assistant/front/route.ts", "src/app/api/orgs/[org]/assistant/front/record/route.ts", "src/app/api/orgs/[org]/assistant/front/line/route.ts",
    "src/app/api/orgs/[org]/assistant/jobs/route.ts", "src/app/api/orgs/[org]/assistant/jobs/[id]/step/route.ts", "src/app/api/orgs/[org]/assistant/jobs/[id]/state/route.ts",
    "src/app/api/orgs/[org]/assistant/jobs/[id]/undone/route.ts"])("%s imports nothing about Act without asking", (p) => {
    const src = read(p);
    for (const i of importsOf(src)) expect(i, `${p} imports ${i}`).not.toMatch(/(?:^|\/)act-(?:decision|mode)$/);
    expect(src).not.toMatch(/decideAct|actStateOf|act_mode|effective\s*===\s*"auto"/);
  });
});

describe("only the person's own look request can start a task (contract 0.8)", () => {
  it("a task row is inserted only by proposeTask, and a plan's only by proposePlan, which only proposeTask calls", () => {
    const writers = all.filter((p) => /INSERT INTO assistant_tasks/.test(read(p))).map((p) => relative(root, join(root, p))).sort();
    expect(writers).toEqual(["src/server/services/act-plan.ts", "src/server/services/act.ts", "src/server/services/jobs.ts"]);
    // A job (Brenda and her helpers): one insert, in createJob, after the token, the nonce and the yes are checked.
    const jobs = read("src/server/services/jobs.ts");
    expect(jobs.match(/INSERT INTO assistant_tasks/g)).toHaveLength(1);
    expect(jobs.indexOf("INSERT INTO assistant_tasks")).toBeGreaterThan(jobs.indexOf("export async function createJob"));
    expect(jobs.indexOf("INSERT INTO assistant_tasks")).toBeGreaterThan(jobs.indexOf("verifyPayload<JobToken>(body.token)"));
    expect(jobs.indexOf("INSERT INTO assistant_tasks")).toBeLessThan(jobs.indexOf("export async function filesStep"));
    const creators = all.filter((p) => /createJob\(/.test(read(p)) && !p.endsWith("services/jobs.ts"));
    expect(creators).toEqual(["src/app/api/orgs/[org]/assistant/jobs/route.ts"]);
    const src = read("src/server/services/act.ts");
    expect(src.match(/INSERT INTO assistant_tasks/g)).toHaveLength(1);
    expect(src.indexOf("INSERT INTO assistant_tasks")).toBeGreaterThan(src.indexOf("export async function proposeTask"));
    expect(src.indexOf("INSERT INTO assistant_tasks")).toBeLessThan(src.indexOf("export async function answerTask"));
    const plan = read("src/server/services/act-plan.ts");
    expect(plan.match(/INSERT INTO assistant_tasks/g)).toHaveLength(1);
    expect(plan.indexOf("INSERT INTO assistant_tasks")).toBeGreaterThan(plan.indexOf("export async function proposePlan"));
    expect(plan.indexOf("INSERT INTO assistant_tasks")).toBeLessThan(plan.indexOf("export async function scopePlan"));
    const callers = all.filter((p) => /proposePlan\(/.test(read(p)) && !p.endsWith("services/act-plan.ts"));
    expect(callers).toEqual(["src/server/services/act.ts"]);
    expect(src.indexOf("proposePlan(")).toBeGreaterThan(src.indexOf("export async function proposeTask"));
    expect(src.indexOf("proposePlan(")).toBeLessThan(src.indexOf("export async function answerTask"));
    // proposePlan is reached only after proposeTask's gates: the person's own fresh request, and an instruction.
    expect(src.indexOf("proposePlan(")).toBeGreaterThan(src.indexOf("if (!isInstruction(look.request.text, o.name))"));
  });
  // Contract 0.5's plan.propose.refuses_non_look_paths (integration, 12 October 2026: named here; a plan is proposed only
  // through proposeTask, as the test above shows, so no other path can propose one).
  it("plan.propose.refuses_non_look_paths: proposeTask (and so proposePlan) is called only from the v2 look turn, and the look turn only from the look route", () => {
    const callers = all.filter((p) => /proposeTask\(/.test(read(p)) && !p.endsWith("services/act.ts"));
    expect(callers).toEqual(["src/server/services/copilot.ts"]);
    const streamCallers = all.filter((p) => /lookChatStream\(/.test(read(p)) && !p.endsWith("services/copilot.ts"));
    expect(streamCallers).toEqual(["src/app/api/orgs/[org]/assistant/look/route.ts"]);
  });
  it("nothing in the worker, routines, follow-ups, mentions or notifications reaches the act service except the purge", () => {
    for (const p of all) {
      if (!/services\/act"|services\/act'/.test(read(p))) continue;
      expect(["src/server/services/copilot.ts", "worker/handlers.ts", "src/server/services/act-plan.ts", "src/server/services/jobs.ts"].includes(p)
        || p.startsWith("src/app/api/orgs/[org]/assistant/act/") || p.startsWith("src/app/api/orgs/[org]/assistant/jobs/")
        || p === "src/app/api/orgs/[org]/brenda/activity/tasks/[id]/route.ts", p).toBe(true);
    }
    expect(read("worker/handlers.ts")).toMatch(/const \{ purgeTasks \} = await import\("..\/src\/server\/services\/act"\)/);
  });
  it("propose_task is only in the look turn's tools; TOOLS (chat, mentions, routines) never has it", () => {
    const names = (ts: { name?: string }[]) => ts.map((t) => t.name);
    expect(names(TOOLS)).not.toContain("propose_task");
    expect(names(TOOLS)).not.toContain("point_at");
    expect(names(LOOK_TOOLS).slice(-3)).toEqual(["point_at", "offer_setup", "propose_task"]);
    expect(names(LOOK_TOOLS_PLAN).slice(-3)).toEqual(["point_at", "offer_setup", "propose_task"]);
    expect(names(LOOK_TOOLS_NO_TASKS)).not.toContain("propose_task");
    expect(names(MAC_CHAT_TOOLS)).not.toContain("propose_task");
    // Plans are offered only in a look turn whose words ask for something, from a Mac that runs them (contract D.1.1).
    const copilot = read("src/server/services/copilot.ts");
    expect(copilot).toMatch(/const plans = asked && \(v2\?\.look\.abilities\.plans \?\? 0\) >= 1 && /);
    expect(copilot).toMatch(/: asked \? \(plans \? LOOK_TOOLS_PLAN : LOOK_TOOLS\) : LOOK_TOOLS_NO_TASKS/);
    // A front-capable Mac's look never proposes (decision 0b.4): its tools have no propose_task, and asked is false.
    expect(names(LOOK_TOOLS_FRONT)).not.toContain("propose_task");
    expect(names(LOOK_TOOLS_FRONT_THINK)).not.toContain("propose_task");
    expect(names(LOOK_TOOLS_FRONT).slice(-1)).toEqual(["think_harder"]);
    expect(names(LOOK_TOOLS_FRONT_THINK)).not.toContain("think_harder");
    expect(copilot).toMatch(/const asked = !!v2 && !front && /);
  });
  it("no page of the notch calls the act or look routes (only Rust does)", () => {
    for (const p of readdirSync(join(root, "desktop", "src"))) {
      if (!/\.(js|html)$/.test(p)) continue;
      const src = readFileSync(join(root, "desktop", "src", p), "utf8");
      expect(src, p).not.toMatch(/\/assistant\/act/);
      // Brenda and her helpers (contract T.3.5): nor the front desk's or the jobs' (the first short line's offer only).
      expect(src.replace(/\/assistant\/front\/line/g, ""), p).not.toMatch(/\/assistant\/(?:front|jobs)/);
    }
  });
});

describe("phase 3: plans by construction (contract 0.3, 0.5)", () => {
  it("the scope, progress, run and folder routes create nothing: no insert, and they reach only their own plan service", () => {
    for (const r of ["scope", "progress", "run", "folder", "folder/finish"]) {
      const src = read(`src/app/api/orgs/[org]/assistant/act/[id]/${r}/route.ts`);
      expect(src, r).not.toMatch(/INSERT INTO|proposeTask|proposePlan/);
      expect(src, r).toMatch(/from "@\/server\/services\/act-plan"/);
    }
  });
  it("screen_help.setup_flag_opens_nothing: the desktop state carries only setupAt; no route or service acts on it", () => {
    // The column is named only by the service that reads and writes it, the schema check, and a comment in the shared types.
    const users = all.filter((p) => /screen_help_setup_at/.test(read(p))).sort();
    // Brenda and her helpers (contract K.5.1): the one-trip Mac context reads it into the same desktop look.
    expect(users).toEqual(["src/lib/screen-help.ts", "src/server/lib/mac-context.ts", "src/server/lib/schema-0059.ts", "src/server/services/screen-help.ts"]);
    expect(read("src/server/lib/mac-context.ts")).not.toMatch(/SET screen_help_setup_at|UPDATE assistant_private/);
    expect(read("src/lib/screen-help.ts")).not.toMatch(/^[^*/]*screen_help_setup_at/m);
    const src = read("src/server/services/screen-help.ts");
    // Written only by the person's own PUT (Set up, or Turn off clearing it); read only into the desktop state and the card.
    expect(src.match(/SET screen_help_setup_at/g)).toHaveLength(1);
    expect(src).not.toMatch(/screen_help_setup_at[\s\S]{0,200}(proposeTask|INSERT INTO assistant_tasks)/);
  });
  it("act-plan.ts runs a Boredroom change only through confirmAction, the Confirm path", () => {
    const src = read("src/server/services/act-plan.ts");
    expect(src).toMatch(/const \{ confirmAction \} = await import\("@\/server\/services\/copilot"\)/);
    expect(src).not.toMatch(/runTool|runWithoutAsking|runBrendaTool/);
  });
});
