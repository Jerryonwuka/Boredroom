import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool, withSystem } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import { runBrendaTool, confirmAction } from "../src/server/services/copilot";
import { listDocs, getDoc, createDoc, updateDoc, archiveDoc, type Doc } from "../src/server/services/docs";
import { workSummary, periodRange } from "../src/server/services/work-summary";
import { issueSession, signOut } from "../src/server/auth";
import { todayLocal } from "../src/server/lib/time";

/**
 * Docs and Brenda's round-two tools (owner decision, 5 October 2026) against the seeded test workspace (company-a),
 * without calling the AI model. Ada and Ben are staff on Design, David leads Design, Olu is the owner; a temporary
 * team with only David in it stands in for "a team Ada is not on". Covers who can read private, team and
 * organisation documents, search, folders, a stale save, archiving, the document tools with their confirmation
 * gating, plan_day (Ada's own plan for today is put back afterwards), get_policy and work_summary scoping, then the API routes over HTTP when the app is running (pnpm dev).
 * Removes what it creates: every "Docs smoke" document and the temporary team.
 */
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const PREFIX = "Docs smoke";
const SMOKE_TEAM = "Docs smoke team";

async function main() {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  const who = async (email: string) => {
    const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = $1", [email])).rows[0];
    return contextFor({ profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, password: "" }, "company-a");
  };
  const ada = await who("ada@company-a.test"); const ben = await who("ben@company-a.test");
  const david = await who("david@company-a.test"); const owner = await who("owner@company-a.test");
  const org = ada.org.id;
  const created: string[] = [];
  const cleanup = async () => {
    await admin.query("DELETE FROM documents WHERE organisation_id = $1 AND (title LIKE $2 OR id = ANY($3::uuid[]))", [org, `${PREFIX}%`, created]);
    await admin.query("DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE organisation_id = $1 AND name = $2)", [org, SMOKE_TEAM]);
    await admin.query("DELETE FROM teams WHERE organisation_id = $1 AND name = $2", [org, SMOKE_TEAM]);
  };
  await cleanup(); // anything left by an interrupted run
  const design = (await admin.query("SELECT id FROM teams WHERE organisation_id = $1 AND name = 'Design'", [org])).rows[0].id as string;
  const smokeTeam = (await admin.query("INSERT INTO teams(organisation_id, name) VALUES ($1, $2) RETURNING id", [org, SMOKE_TEAM])).rows[0].id as string;
  await admin.query("INSERT INTO team_members(organisation_id, team_id, membership_id) VALUES ($1, $2, $3)", [org, smokeTeam, david.membership.id]);

  let failed = 0;
  const check = async (name: string, fn: () => Promise<unknown>) => {
    try { console.log("ok  ", name, "→", JSON.stringify(await fn() ?? null).slice(0, 220)); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  };
  const expect = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
  /** The call must fail with this HTTP status (403, 404, 409, 422). */
  const refused = async (fn: () => Promise<unknown>, status: number) => {
    try { await fn(); } catch (e) {
      const s = (e as { status?: number }).status;
      expect(s === status, `expected ${status}, got ${s ?? "an error"}: ${(e as Error).message}`);
      return `${s} ${(e as Error).message}`;
    }
    throw new Error(`expected ${status}, but it was allowed`);
  };
  const keep = (d: Doc) => { created.push(d.id); return d; };
  const sees = async (ctx: typeof ada, id: string) => !!(await getDoc(ctx, id));

  // ---- The service: who can read what ----------------------------------------------------------------
  let adaNotes!: Doc, davidPlan!: Doc, designSop!: Doc, smokeBrief!: Doc, handbook!: Doc;
  await check("Ada writes a private document (folder tidied, excerpt plain)", async () => {
    adaNotes = keep(await createDoc(ada, { title: `${PREFIX}: Ada's notes`, body: "# Notes\n\nThe **zebracorn** rollout starts on [Monday](https://example.com).\n\n- one\n- two", folder: "  Smoke   folder " }));
    expect(adaNotes.visibility === "private" && adaNotes.canEdit && adaNotes.folder === "Smoke folder", JSON.stringify(adaNotes));
    expect(!/[#*[\]]/.test(adaNotes.excerpt), `excerpt not plain: ${adaNotes.excerpt}`);
    return { folder: adaNotes.folder, excerpt: adaNotes.excerpt };
  });
  await check("David writes a private document", async () => {
    davidPlan = keep(await createDoc(david, { title: `${PREFIX}: David's private plan`, body: "Quarterly zebracorn budget." }));
    return davidPlan.visibility;
  });
  await check("Ada cannot read or find David's private document", async () => {
    expect(!(await sees(ada, davidPlan.id)), "Ada can read it");
    const found = (await listDocs(ada, { q: "zebracorn" })).docs.map((d) => d.id);
    expect(!found.includes(davidPlan.id) && found.includes(adaNotes.id), JSON.stringify(found));
    return { adaFinds: found.length };
  });
  await check("Ben cannot read Ada's private document", async () => { expect(!(await sees(ben, adaNotes.id)), "Ben can read it"); return false; });
  await check("the owner reads private documents and may change them", async () => {
    const d = await getDoc(owner, davidPlan.id); expect(!!d && d.canEdit, JSON.stringify(d)); return { canEdit: d!.canEdit };
  });
  await check("a Design document is read by the team, changed only by its writer", async () => {
    designSop = keep(await createDoc(ada, { title: `${PREFIX}: Design team SOP`, body: "## Handover\n\nEvery file goes in the shared drive.", visibility: "team", teamId: design }));
    const benView = await getDoc(ben, designSop.id), davidView = await getDoc(david, designSop.id);
    expect(designSop.teamName === "Design" && !!benView && !!davidView && !benView.canEdit, "team members should read, not edit");
    return { team: designSop.teamName, benCanEdit: benView!.canEdit };
  });
  await check("a team document is hidden from people outside the team", async () => {
    smokeBrief = keep(await createDoc(owner, { title: `${PREFIX}: Smoke team brief`, body: "Only for the smoke team.", visibility: "team", teamId: smokeTeam }));
    const r = { david: await sees(david, smokeBrief.id), ada: await sees(ada, smokeBrief.id), ben: await sees(ben, smokeBrief.id), owner: await sees(owner, smokeBrief.id) };
    expect(r.david && !r.ada && !r.ben && r.owner, JSON.stringify(r)); return r;
  });
  await check("an organisation document is read by everyone", async () => {
    handbook = keep(await createDoc(owner, { title: `${PREFIX}: Staff handbook`, body: "## Annual leave\n\nStaff get 20 working days of annual leave a year. Ask HR to book it.", visibility: "organisation", folder: "Policies" }));
    const r = { ada: await sees(ada, handbook.id), ben: await sees(ben, handbook.id), david: await sees(david, handbook.id) };
    expect(r.ada && r.ben && r.david && !(await getDoc(ada, handbook.id))!.canEdit, JSON.stringify(r)); return r;
  });
  await check("bad input is refused (422)", async () => [
    await refused(() => createDoc(ada, { title: "   " }), 422),
    await refused(() => createDoc(ada, { title: `${PREFIX}: x`, visibility: "team" }), 422),
    await refused(() => createDoc(ada, { title: `${PREFIX}: x`, visibility: "team", teamId: "00000000-0000-4000-8000-000000000000" }), 422),
  ]);

  // ---- Search, folders, pinning ---------------------------------------------------------------------
  await check("search ranks text matches and finds a half-typed title", async () => {
    const leave = (await listDocs(ada, { q: "annual leave" })).docs;
    expect(leave.some((d) => d.id === handbook.id), "handbook not found for 'annual leave'");
    const half = (await listDocs(ada, { q: "handb" })).docs;
    expect(half.some((d) => d.id === handbook.id), "half-typed title not found");
    return { leaveRank: leave.findIndex((d) => d.id === handbook.id) + 1, halfTyped: half.length };
  });
  await check("folders narrow the list and are counted", async () => {
    const r = await listDocs(ada, { folder: "Smoke folder" });
    expect(r.docs.length === 1 && r.docs[0].id === adaNotes.id, JSON.stringify(r.docs.map((d) => d.title)));
    expect(r.folders.some((f) => f.name === "Smoke folder" && f.count === 1) && r.folders.some((f) => f.name === "Policies"), JSON.stringify(r.folders));
    const none = await listDocs(ada, { folder: null });
    expect(none.docs.every((d) => d.folder === null), "folder: null should list only unfiled documents");
    return r.folders;
  });
  await check("pinning puts a document first without counting as an edit", async () => {
    const d = await updateDoc(ada, designSop.id, { pinned: true });
    expect(d.pinned && d.updatedAt === designSop.updatedAt, "pinning changed updatedAt");
    const list = (await listDocs(ada)).docs;
    const firstUnpinned = list.findIndex((x) => !x.pinned);
    expect(firstUnpinned === -1 || list.slice(firstUnpinned).every((x) => !x.pinned), "pinned documents should come first");
    return { first: list[0].title };
  });

  // ---- Changing and archiving -----------------------------------------------------------------------
  await check("a save against an old version is refused (409)", async () => {
    const v1 = adaNotes.updatedAt;
    const saved = await updateDoc(ada, adaNotes.id, { expectedUpdatedAt: v1, title: `${PREFIX}: Ada's notes v2` });
    expect(saved.updatedAt !== v1 && saved.title.endsWith("v2"), "first save should go through");
    let code = "";
    const r = await refused(async () => { try { await updateDoc(ada, adaNotes.id, { expectedUpdatedAt: v1, body: "stale" }); } catch (e) { code = (e as { code?: string }).code ?? ""; throw e; } }, 409);
    expect(code === "VERSION_CONFLICT", code); adaNotes = saved; return r;
  });
  await check("append adds to the end after a blank line", async () => {
    const d = await updateDoc(ada, adaNotes.id, { appendBody: "Added later." });
    expect(d.body.endsWith("- two\n\nAdded later."), JSON.stringify(d.body.slice(-40))); adaNotes = d; return d.body.length;
  });
  await check("replacing and appending at once is refused (422)", async () => refused(() => updateDoc(ada, adaNotes.id, { body: "a", appendBody: "b" }), 422));
  await check("readers cannot change a document (403), outsiders cannot see it (404)", async () => [
    await refused(() => updateDoc(ada, handbook.id, { title: `${PREFIX}: renamed` }), 403),
    await refused(() => updateDoc(ben, designSop.id, { appendBody: "Ben was here" }), 403),
    await refused(() => updateDoc(ada, davidPlan.id, { title: `${PREFIX}: renamed` }), 404),
  ]);
  await check("the owner changes someone else's document", async () => {
    const d = await updateDoc(owner, designSop.id, { appendBody: "Reviewed by the owner." });
    expect(d.body.endsWith("Reviewed by the owner.") && d.createdBy.membershipId === ada.membership.id, "owner edit failed"); designSop = d; return d.updatedAt;
  });
  await check("making a team document private hides it from the team; naming the team shares it again", async () => {
    const p = await updateDoc(ada, designSop.id, { visibility: "private" });
    expect(p.visibility === "private" && p.teamId === null && !(await sees(ben, designSop.id)), "still visible to Ben");
    const back = await updateDoc(ada, designSop.id, { teamId: design });
    expect(back.visibility === "team" && (await sees(ben, designSop.id)), "not shared again"); designSop = back; return back.visibility;
  });
  await check("archiving hides a document from everyone; only its writer, the owner or HR may", async () => {
    const no = await refused(() => archiveDoc(ben, designSop.id), 403);
    const r = await archiveDoc(ada, adaNotes.id);
    expect(r.archived && !(await sees(ada, adaNotes.id)) && !(await sees(owner, adaNotes.id)), "still visible after archiving");
    expect(!(await listDocs(owner, { q: "zebracorn" })).docs.some((d) => d.id === adaNotes.id), "archived document still listed");
    return { ben: no, again: await refused(() => archiveDoc(ada, adaNotes.id), 404) };
  });
  await check("creating, changing and archiving are audited", async () => {
    const rows = (await admin.query("SELECT action, count(*)::int AS n FROM audit_events WHERE subject_type = 'document' AND subject_id = ANY($1::uuid[]) GROUP BY action ORDER BY action", [created])).rows as { action: string; n: number }[];
    const has = (a: string) => rows.some((r) => r.action === a && r.n > 0);
    expect(has("document.created") && has("document.updated") && has("document.archived"), JSON.stringify(rows)); return rows;
  });

  // ---- Brenda's document tools ------------------------------------------------------------------------
  let meeting = "";
  await check("create_doc: a private document is saved at once", async () => {
    const r = await runBrendaTool(ada, "create_doc", { title: `${PREFIX}: Kickoff meeting notes`, body: "# Kickoff\n\n- Scope agreed\n- Next call on Friday", folder: "Meeting notes" });
    const o = r.out as { docId?: string; path?: string; done?: boolean };
    expect(!!o.done && !!o.docId && r.proposals.length === 0 && r.actions[0]?.href === `/app/company-a/docs/${o.docId}`, JSON.stringify(r));
    meeting = o.docId!; created.push(meeting);
    const d = await getDoc(ada, meeting); expect(d?.visibility === "private" && d.folder === "Meeting notes", JSON.stringify(d));
    return { summary: r.actions[0].summary, path: o.path };
  });
  await check("create_doc: shared with the person's own team when no team is named", async () => {
    const r = await runBrendaTool(ada, "create_doc", { title: `${PREFIX}: Design checklist`, body: "- [ ] Check contrast", visibility: "team" });
    const o = r.out as { docId?: string }; expect(!!o.docId && r.proposals.length === 0, JSON.stringify(r.out)); created.push(o.docId!);
    const d = await getDoc(ben, o.docId!); expect(d?.teamName === "Design", "Ben should read it"); return r.actions[0].summary;
  });
  await check("create_doc: on two teams with none named, she asks which", async () => {
    const r = await runBrendaTool(david, "create_doc", { title: `${PREFIX}: Which team`, body: "x", visibility: "team" });
    expect(/Which team/.test((r.out as { error?: string }).error ?? ""), JSON.stringify(r.out)); return r.out;
  });
  let share = "", shared = "";
  await check("create_doc for everyone: saved as a private draft, shared only on Confirm", async () => {
    const r = await runBrendaTool(ada, "create_doc", { title: `${PREFIX}: How we name files`, body: "Use the date first: 2026-10-05 Brief.", visibility: "organisation" });
    const o = r.out as { needsConfirmation?: boolean; savedAsPrivateDraft?: boolean; docId?: string };
    expect(o.needsConfirmation === true && o.savedAsPrivateDraft === true && r.proposals.length === 1 && r.proposals[0].kind === "confirm", JSON.stringify(r));
    shared = o.docId!; created.push(shared); share = (r.proposals[0] as { token: string }).token;
    expect(!(await sees(ben, shared)) && (await getDoc(ada, shared))?.visibility === "private", "the draft should be private until confirmed");
    return (r.proposals[0] as { summary: string }).summary;
  });
  await check("someone else cannot confirm it", async () => {
    try { await confirmAction(ben, share); } catch (e) { return (e as Error).message; }
    throw new Error("token accepted for the wrong person");
  });
  await check("confirming shares it with everyone", async () => {
    const r = await confirmAction(ada, share); expect(!r.error && r.actions.length === 1, r.error ?? "no action");
    expect((await getDoc(ben, shared))?.visibility === "organisation", "Ben should read it now"); return r.actions[0].summary;
  });
  await check("list_docs finds the handbook and says who reads it; read_doc gives the text", async () => {
    const l = (await runBrendaTool(ada, "list_docs", { q: "annual leave" })).out as { docs: { id: string; readBy: string; path: string }[] };
    const hit = l.docs.find((d) => d.id === handbook.id); expect(!!hit && hit.readBy === "everyone" && hit.path === `/docs/${handbook.id}`, JSON.stringify(l.docs.slice(0, 3)));
    const d = (await runBrendaTool(ada, "read_doc", { docId: handbook.id })).out as { text?: string; youCanEdit?: boolean };
    expect(!!d.text?.includes("20 working days") && d.youCanEdit === false, JSON.stringify(d)); return { found: l.docs.length, text: d.text!.slice(0, 40) };
  });
  await check("read_doc refuses a document the person cannot see", async () => {
    const r = await runBrendaTool(ada, "read_doc", { docId: davidPlan.id }); expect(!!(r.out as { error?: string }).error, JSON.stringify(r.out)); return r.out;
  });
  await check("update_doc on her own document runs at once", async () => {
    const r = await runBrendaTool(ada, "update_doc", { docId: meeting, append: "## Actions\n\n- Ada: send the brief" });
    expect(!!(r.out as { done?: boolean }).done && r.proposals.length === 0, JSON.stringify(r.out));
    expect(!!(await getDoc(ada, meeting))?.body.endsWith("- Ada: send the brief"), "not appended"); return r.actions[0].summary;
  });
  await check("update_doc cannot change a document she only reads", async () => {
    const r = await runBrendaTool(ada, "update_doc", { docId: handbook.id, title: `${PREFIX}: renamed` });
    expect(!!(r.out as { error?: string }).error && r.proposals.length === 0, JSON.stringify(r.out)); return r.out;
  });
  await check("update_doc on someone else's document waits for Confirm, then runs", async () => {
    const r = await runBrendaTool(owner, "update_doc", { docId: meeting, append: "Owner note: looks good." });
    expect((r.out as { needsConfirmation?: boolean }).needsConfirmation === true && r.proposals.length === 1, JSON.stringify(r.out));
    expect(!(await getDoc(ada, meeting))!.body.includes("Owner note"), "changed before Confirm");
    const c = await confirmAction(owner, (r.proposals[0] as { token: string }).token); expect(!c.error && c.actions.length === 1, c.error ?? "no action");
    expect((await getDoc(ada, meeting))!.body.endsWith("Owner note: looks good."), "not changed after Confirm"); return c.actions[0].summary;
  });
  await check("update_doc: her own edits run now, sharing with everyone waits", async () => {
    const r = await runBrendaTool(ada, "update_doc", { docId: meeting, title: `${PREFIX}: Kickoff notes`, visibility: "organisation" });
    const o = r.out as { needsConfirmation?: boolean; alsoDone?: string };
    const d = await getDoc(ada, meeting);
    expect(o.needsConfirmation === true && !!o.alsoDone && d?.title === `${PREFIX}: Kickoff notes` && d.visibility === "private", JSON.stringify({ o, title: d?.title, vis: d?.visibility }));
    return { alsoDone: o.alsoDone, waiting: (r.proposals[0] as { summary: string }).summary };
  });
  await check("open_page links a document inside the workspace", async () => {
    const r = await runBrendaTool(ada, "open_page", { path: `/docs/${meeting}`, label: "Kickoff notes" });
    const p = r.proposals[0] as { href?: string }; expect(p?.href === `/app/company-a/docs/${meeting}`, JSON.stringify(r.proposals)); return p.href;
  });

  // ---- Arranging the day -----------------------------------------------------------------------------------
  await check("plan_day: orders her own open tasks for today, skips anyone else's; organisation accounts have none", async () => {
    const today = todayLocal(ada.org.timezone);
    const planOf = async () => (await admin.query("SELECT task_id FROM daily_plan_items WHERE membership_id = $1 AND local_date = $2 ORDER BY position", [ada.membership.id, today])).rows.map((r) => r.task_id as string);
    const openOf = async (membershipId: string) => (await admin.query("SELECT id FROM tasks WHERE organisation_id = $1 AND assignee_membership_id = $2 AND archived_at IS NULL AND status IN ('todo', 'in_progress') ORDER BY created_at LIMIT 3", [org, membershipId])).rows.map((r) => r.id as string);
    const mine = await openOf(ada.membership.id), bens = await openOf(ben.membership.id);
    if (!mine.length) return "skipped: Ada holds no open tasks in the seed";
    const before = await planOf(); // Ada's own plan for today, put back afterwards
    try {
      const wanted = [...mine].reverse();
      const r = await runBrendaTool(ada, "plan_day", { taskIds: [...wanted, ...bens.slice(0, 1)] });
      const o = r.out as { done?: boolean; skipped?: number };
      expect(!!o.done && r.proposals.length === 0 && (o.skipped ?? 0) === Math.min(1, bens.length), JSON.stringify(r.out));
      expect(JSON.stringify(await planOf()) === JSON.stringify(wanted), "the saved order differs");
      const own = (await runBrendaTool(owner, "plan_day", { taskIds: mine })).out as { error?: string };
      expect(!!own.error, "organisation accounts should have no plan");
      return { summary: r.actions[0].summary, owner: own.error };
    } finally {
      await admin.query("DELETE FROM daily_plan_items WHERE membership_id = $1 AND local_date = $2", [ada.membership.id, today]);
      for (const [i, id] of before.entries()) await admin.query("INSERT INTO daily_plan_items(organisation_id, membership_id, local_date, task_id, position) VALUES ($1, $2, $3, $4, $5)", [org, ada.membership.id, today, id, i]);
    }
  });

  // ---- Policy and the work summary -----------------------------------------------------------------------
  // Phase 8 (owner decisions, 8 October 2026): the notice and how calls are handled; nothing about who agreed to what.
  await check("get_policy: schedule, notice and calls from real data (staff)", async () => {
    const o = (await runBrendaTool(ada, "get_policy", {})).out as { workSchedule: { workingDays: string[]; starts: string; ends: string; graceMinutes: number; timeZone: string; lateAfter: string }; monitoringNotice: { version: number; notice: string } | null; calls: { recorded: boolean; notes: string }; whoToAsk: string[] };
    const s = o.workSchedule;
    expect(s.workingDays.length > 0 && /^\d\d:\d\d$/.test(s.starts) && /^\d\d:\d\d$/.test(s.ends) && typeof s.graceMinutes === "number" && !!s.timeZone, JSON.stringify(s));
    expect(!!o.monitoringNotice && o.calls?.recorded === false && o.whoToAsk.some((w) => w.startsWith(owner.user.displayName)), JSON.stringify(o).slice(0, 300));
    return { days: s.workingDays.join(","), hours: `${s.starts}-${s.ends}`, lateAfter: s.lateAfter, notice: `v${o.monitoringNotice!.version}`, calls: o.calls.notes };
  });
  await check("get_policy: organisation accounts get the same rules", async () => {
    const o = (await runBrendaTool(owner, "get_policy", {})).out as Record<string, unknown>; expect(!!o.monitoringNotice && !Object.keys(o).some((k) => /agreed/i.test(k)), JSON.stringify(o).slice(0, 200)); return Object.keys(o).join(",");
  });
  type Summary = { scope: string; from: string; to: string; people: { name: string; hoursTracked: number; tasksCompleted: number; overdue: number; daysClockedIn: number }[] };
  await check("work_summary: staff see only themselves", async () => {
    const o = (await runBrendaTool(ada, "work_summary", { period: "week" })).out as Summary;
    expect(o.scope === "self" && o.people.length === 1 && o.people[0].name === ada.user.displayName, JSON.stringify(o)); return { from: o.from, to: o.to, me: o.people[0] };
  });
  await check("work_summary: staff cannot summarise someone else", async () => {
    const r = await runBrendaTool(ada, "work_summary", { period: "week", person: david.user.displayName });
    expect(!!(r.out as { error?: string }).error, JSON.stringify(r.out));
    return [(r.out as { error: string }).error, await refused(() => workSummary(ada, { period: "week", membershipId: david.membership.id }), 403)];
  });
  await check("work_summary: the team lead sees the team", async () => {
    const o = (await runBrendaTool(david, "work_summary", { period: "month" })).out as Summary;
    const names = o.people.map((p) => p.name).sort();
    expect(o.scope === "team" && [ada, ben, david].every((c) => names.includes(c.user.displayName)) && !names.includes(owner.user.displayName), JSON.stringify(names)); return names;
  });
  await check("work_summary: a lead cannot summarise someone outside the teams they lead", async () =>
    refused(() => runBrendaTool(david, "work_summary", { period: "week", person: owner.user.displayName }), 403));
  await check("work_summary: the owner sees everyone who holds work; a name narrows it", async () => {
    const all = (await runBrendaTool(owner, "work_summary", { period: "last_month" })).out as Summary;
    const one = (await runBrendaTool(owner, "work_summary", { period: "today", person: "Ada" })).out as Summary;
    expect(all.scope === "organisation" && all.people.length >= 3 && one.people.length === 1 && one.people[0].name === ada.user.displayName, JSON.stringify({ all: all.people.length, one: one.people }));
    return { lastMonth: `${all.from}..${all.to}`, people: all.people.length };
  });
  await check("work_summary: an unknown period is refused", async () => {
    const r = await runBrendaTool(owner, "work_summary", { period: "year" }); expect(!!(r.out as { error?: string }).error, JSON.stringify(r.out)); return r.out;
  });
  await check("periods: weeks start on Monday, last month is the whole month", async () => {
    const w = periodRange("week", "2026-10-07"), lw = periodRange("last_week", "2026-10-07"), sun = periodRange("week", "2026-10-11"), lm = periodRange("last_month", "2026-10-05"), jan = periodRange("last_month", "2026-01-15");
    expect(w.from === "2026-10-05" && w.to === "2026-10-07" && lw.from === "2026-09-28" && lw.to === "2026-10-04" && sun.from === "2026-10-05" && lm.from === "2026-09-01" && lm.to === "2026-09-30" && jan.from === "2025-12-01" && jan.to === "2025-12-31", JSON.stringify({ w, lw, sun, lm, jan }));
    return { w, lw, lm };
  });

  // ---- The API routes, over HTTP, when the app is running ---------------------------------------------------
  const up = await fetch(`${BASE}/api/health`).then((r) => r.status < 500, () => false);
  if (!up) console.log("skip  API routes: nothing answering at", BASE, "(start pnpm dev to include them)");
  else {
    const token = await withSystem((db) => issueSession(db, ada.user.authUserId, { method: "password", userAgent: "smoke-docs" }));
    const call = async (method: string, path: string, body?: unknown, auth = true) => {
      const res = await fetch(`${BASE}/api/orgs/company-a${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(auth ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null };
    };
    const status = <R extends { status: number; json: unknown }>(r: R, want: number): R => { expect(r.status === want, `expected ${want}, got ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`); return r; };
    let apiDoc: Doc | null = null;
    await check("API: signed out is 401", async () => status(await call("GET", "/docs", undefined, false), 401).status);
    await check("API: GET /docs searches", async () => {
      const r = status(await call("GET", `/docs?q=${encodeURIComponent("annual leave")}`), 200).json as { docs: Doc[]; folders: unknown[] };
      expect(r.docs.some((d) => d.id === handbook.id) && Array.isArray(r.folders), "handbook missing"); return r.docs.length;
    });
    await check("API: GET /docs?folder= narrows", async () => {
      const r = status(await call("GET", "/docs?folder=Policies"), 200).json as { docs: Doc[] };
      expect(r.docs.length > 0 && r.docs.every((d) => d.folder === "Policies"), JSON.stringify(r.docs.map((d) => d.folder))); return r.docs.length;
    });
    await check("API: POST /docs creates (201)", async () => {
      const r = status(await call("POST", "/docs", { title: `${PREFIX}: API note`, body: "From the API.", folder: "Smoke folder" }), 201);
      apiDoc = r.json as unknown as Doc; created.push(apiDoc.id); expect(apiDoc.visibility === "private" && apiDoc.canEdit, JSON.stringify(apiDoc)); return apiDoc.id;
    });
    await check("API: POST /docs without a title is 422", async () => status(await call("POST", "/docs", { title: "" }), 422).json?.code);
    await check("API: GET /docs/[id] reads; not shared or not an id is 404", async () => {
      status(await call("GET", `/docs/${apiDoc!.id}`), 200);
      return [status(await call("GET", `/docs/${davidPlan.id}`), 404).status, status(await call("GET", "/docs/not-an-id"), 404).status];
    });
    await check("API: PATCH with an old version is 409; with the current one, 200", async () => {
      const stale = new Date(Date.parse(apiDoc!.updatedAt) - 60_000).toISOString();
      const c = status(await call("PATCH", `/docs/${apiDoc!.id}`, { expectedUpdatedAt: stale, title: `${PREFIX}: API note (stale)` }), 409);
      const okRes = status(await call("PATCH", `/docs/${apiDoc!.id}`, { expectedUpdatedAt: apiDoc!.updatedAt, title: `${PREFIX}: API note v2` }), 200);
      expect((okRes.json as unknown as Doc).title === `${PREFIX}: API note v2`, "title not saved"); return c.json?.code;
    });
    await check("API: PATCH someone else's document as a reader is 403", async () => status(await call("PATCH", `/docs/${handbook.id}`, { title: `${PREFIX}: nope` }), 403).json?.code);
    await check("API: DELETE archives; afterwards it is 404", async () => {
      const r = status(await call("DELETE", `/docs/${apiDoc!.id}`), 200); expect(r.json?.archived === true, JSON.stringify(r.json));
      return status(await call("GET", `/docs/${apiDoc!.id}`), 404).status;
    });
    await signOut(token);
  }

  // Clean up: the smoke documents and the temporary team. Brenda's action log keeps its entries, as in smoke:brenda.
  await new Promise((res) => setTimeout(res, 500)); // let the fire-and-forget action log writes finish
  await cleanup();
  console.log(failed ? `${failed} failed` : "all passed");
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main();
