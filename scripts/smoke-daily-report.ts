import { config } from "dotenv"; config({ path: [".env.local"], quiet: true });
import { getPool, withSystem } from "../src/server/db";
import { contextFor } from "../src/server/services/fixtures";
import { runBrendaTool } from "../src/server/services/copilot";
import { getDoc, updateDoc } from "../src/server/services/docs";
import { buildDailyReport, reportMarkdown, reportRecipients, runDailyReportJob, teamReportNow, REPORT_FOLDER, dayLabel } from "../src/server/services/daily-report";
import { scheduleDailyReports } from "../worker/schedule";
import { mailConfigProblem, setMailProvider, type MailMessage } from "../src/server/lib/mail";
import { issueSession, signOut } from "../src/server/auth";
import { addDays, localMidnight, localParts, localTimeOn, todayLocal, weekdayOf } from "../src/server/lib/time";

/**
 * Brenda's end-of-day team report (owner decision, 5 October 2026) against the seeded test workspace (company-a),
 * without calling the AI model or sending real email (mail is captured). David leads Design (Ada, Ben); Olu is the
 * owner, Mary HR. A temporary person on a temporary team stands in for "someone outside David's team", and a temporary
 * lead of an otherwise empty team for "a quiet team". Covers who receives a report, the staff refusal, a quiet team
 * getting nothing, the scope of each report, attendance notes, the document (private, in Daily reports, Brenda's line
 * first), the notification and email, a second run doing nothing, a report asked for during the day being refreshed
 * until edited, the setting switched off, and the scheduler's local time (and a time changed after queuing, and the
 * days the clocks change); then the routes over HTTP when the app is running (pnpm dev).
 *
 * Leaves the workspace as it found it: removes the temporary people and teams, the smoke tasks and clock-ins, every
 * report document, sent-log row and notification made today in company-a, and the jobs it queued, and puts Brenda's
 * settings back. Today's reports in company-a are cleared first too, so an interrupted run does not block the next.
 * Brenda's action log keeps its entries, as in smoke:brenda.
 */
const BASE = process.env.SMOKE_BASE ?? "http://localhost:3000";
const PREFIX = "Daily report smoke";
const TEMP_EMAIL = "daily-report-smoke@company-a.test";
const TEMP_LEAD_EMAIL = "daily-report-smoke-lead@company-a.test";

async function main() {
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await admin.connect();
  const who = async (email: string) => {
    const r = (await admin.query("SELECT p.id, p.auth_user_id, p.email, p.display_name FROM profiles p WHERE p.email = $1", [email])).rows[0];
    return contextFor({ profileId: r.id, authUserId: r.auth_user_id, email: r.email, displayName: r.display_name, password: "" }, "company-a");
  };
  const ada = await who("ada@company-a.test"); const ben = await who("ben@company-a.test");
  const david = await who("david@company-a.test"); const owner = await who("owner@company-a.test"); const mary = await who("mary@company-a.test");
  const org = ada.org.id; const tz = ada.org.timezone;
  const today = todayLocal(tz);
  const schedule = (await admin.query("SELECT working_days FROM schedules WHERE organisation_id = $1 AND membership_id IS NULL ORDER BY effective_from DESC, created_at DESC LIMIT 1", [org])).rows[0];
  const workingDay = ((schedule?.working_days as number[] | undefined) ?? [1, 2, 3, 4, 5]).includes(weekdayOf(today));
  const settingsBefore = (await admin.query("SELECT auto_clock_in, reminders, daily_report_enabled, daily_report_time::text, daily_report_org_wide, updated_by, updated_at FROM brenda_settings WHERE organisation_id = $1", [org])).rows[0] ?? null;
  const jobsBefore = (await admin.query("SELECT type, payload, dedup_key, state, next_run_at FROM jobs WHERE dedup_key LIKE $1", [`brenda.daily_report:%:${today}`])).rows;
  const mails: MailMessage[] = [];
  setMailProvider({ send: async (m) => { mails.push(m); return { id: `smoke-${mails.length}` }; } });

  const setSettings = async (s: { enabled?: boolean; time?: string; orgWide?: boolean }) => {
    await admin.query(
      `INSERT INTO brenda_settings(organisation_id, daily_report_enabled, daily_report_time, daily_report_org_wide) VALUES ($1, COALESCE($2, true), COALESCE($3::time, '18:00'), COALESCE($4, true))
       ON CONFLICT (organisation_id) DO UPDATE SET daily_report_enabled = COALESCE($2, brenda_settings.daily_report_enabled), daily_report_time = COALESCE($3::time, brenda_settings.daily_report_time), daily_report_org_wide = COALESCE($4, brenda_settings.daily_report_org_wide)`,
      [org, s.enabled ?? null, s.time ?? null, s.orgWide ?? null]);
  };
  const clearJobs = () => admin.query("DELETE FROM jobs WHERE dedup_key LIKE $1 AND payload->>'organisationId' = $2", [`brenda.daily_report:%:${today}`, org]);
  const clearReports = async () => {
    const docs = (await admin.query("SELECT doc_id FROM brenda_report_log WHERE organisation_id = $1 AND local_date = $2 AND doc_id IS NOT NULL", [org, today])).rows.map((r) => r.doc_id as string);
    await admin.query("DELETE FROM brenda_report_log WHERE organisation_id = $1 AND local_date = $2", [org, today]);
    await admin.query("DELETE FROM documents WHERE organisation_id = $1 AND (id = ANY($2::uuid[]) OR (folder = $3 AND title = $4))", [org, docs, REPORT_FOLDER, `Team report, ${dayLabel(today)}`]);
    await admin.query("DELETE FROM notifications WHERE organisation_id = $1 AND type = 'brenda.daily_report' AND deduplication_key = $2", [org, `brenda.daily_report:${today}`]);
  };
  /** A temporary person (membership, profile, sign-in) and everything hung on them. */
  const removePerson = async (email: string) => {
    const temp = (await admin.query("SELECT m.id AS membership_id, p.id AS profile_id, u.id AS auth_user_id FROM auth_users u JOIN profiles p ON p.auth_user_id = u.id LEFT JOIN memberships m ON m.user_id = p.id WHERE u.email = $1", [email])).rows[0];
    if (!temp) return;
    if (temp.membership_id) {
      await admin.query("DELETE FROM attendance_days WHERE membership_id = $1", [temp.membership_id]);
      await admin.query("DELETE FROM team_members WHERE membership_id = $1", [temp.membership_id]);
      // The worker (`pnpm dev` runs it) can notify the temporary person between the two deletes (one of Brenda's
      // nudges); clear their notifications again and retry rather than leave them in the organisation.
      for (let attempt = 1; ; attempt++) {
        await admin.query("DELETE FROM notifications WHERE recipient_membership_id = $1", [temp.membership_id]);
        try { await admin.query("DELETE FROM memberships WHERE id = $1", [temp.membership_id]); break; }
        catch (e) { if (attempt >= 3 || (e as { code?: string }).code !== "23503") throw e; }
      }
    }
    await admin.query("DELETE FROM profiles WHERE id = $1", [temp.profile_id]);
    await admin.query("DELETE FROM auth_users WHERE id = $1", [temp.auth_user_id]);
  };
  const removeQuietTeam = async () => {
    await removePerson(TEMP_LEAD_EMAIL);
    await admin.query("DELETE FROM teams WHERE organisation_id = $1 AND name = $2", [org, `${PREFIX} quiet team`]);
  };
  const cleanup = async () => {
    await clearReports();
    await admin.query("DELETE FROM attendance_days WHERE organisation_id = $1 AND local_date = $2 AND id = ANY($3::uuid[])", [org, today, clockIns]);
    await admin.query("DELETE FROM tasks WHERE organisation_id = $1 AND title LIKE $2", [org, `${PREFIX}%`]);
    await removePerson(TEMP_EMAIL);
    await removeQuietTeam();
    await admin.query("DELETE FROM teams WHERE organisation_id = $1 AND name = $2", [org, `${PREFIX} team`]);
    await clearJobs();
    for (const j of jobsBefore) await admin.query("INSERT INTO jobs(type, payload, dedup_key, state, next_run_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedup_key) DO NOTHING", [j.type, j.payload, j.dedup_key, j.state, j.next_run_at]);
    if (settingsBefore) await admin.query("UPDATE brenda_settings SET daily_report_enabled = $2, daily_report_time = $3::time, daily_report_org_wide = $4, updated_by = $5, updated_at = $6 WHERE organisation_id = $1", [org, settingsBefore.daily_report_enabled, settingsBefore.daily_report_time, settingsBefore.daily_report_org_wide, settingsBefore.updated_by, settingsBefore.updated_at]);
    else await admin.query("DELETE FROM brenda_settings WHERE organisation_id = $1", [org]);
  };
  const clockIns: string[] = [];
  await cleanup(); // anything left by an interrupted run
  await clearJobs();
  await setSettings({ enabled: true, time: "18:00", orgWide: true });

  let failed = 0;
  const check = async (name: string, fn: () => Promise<unknown>) => {
    try { console.log("ok  ", name, "→", JSON.stringify(await fn() ?? null).slice(0, 220)); } catch (e) { failed++; console.log("FAIL", name, (e as Error).message); }
  };
  const expect = (cond: boolean, msg: string) => { if (!cond) throw new Error(msg); };
  const names = (r: { people: { name: string }[] }) => r.people.map((p) => p.name).sort();
  const logRow = async (membershipId: string) => (await admin.query("SELECT doc_id, sent_at, written_at FROM brenda_report_log WHERE membership_id = $1 AND local_date = $2", [membershipId, today])).rows[0] ?? null;
  const notes = async (membershipId: string) => (await admin.query("SELECT title, href FROM notifications WHERE recipient_membership_id = $1 AND type = 'brenda.daily_report' AND deduplication_key = $2", [membershipId, `brenda.daily_report:${today}`])).rows;
  const job = (membershipId: string) => runDailyReportJob({ organisationId: org, membershipId, localDate: today }, { useAssistant: false });
  /** A clock-in today, `min` minutes after a 09:00 start. */
  const lateBy = (min: number) => [today, tz, "09:00", "17:00", new Date(localTimeOn(today, "09:00", tz).getTime() + min * 60_000).toISOString(), min * 60];
  /** A temporary person in company-a, with a sign-in, a profile and a membership. */
  const addPerson = async (email: string, name: string, code: string, role: "employee" | "manager") => {
    const authUserId = (await admin.query("INSERT INTO auth_users(email, password_hash, email_verified_at) VALUES ($1, NULL, now()) RETURNING id", [email])).rows[0].id as string;
    const profileId = (await admin.query("INSERT INTO profiles(auth_user_id, display_name, email) VALUES ($1, $2, $3) RETURNING id", [authUserId, name, email])).rows[0].id as string;
    const membershipId = (await admin.query("INSERT INTO memberships(organisation_id, user_id, employee_code, role) VALUES ($1, $2, $3, $4) RETURNING id", [org, profileId, code, role])).rows[0].id as string;
    return { authUserId, profileId, membershipId, email, name };
  };

  try {
    // ---- Who receives it, and who may ask -----------------------------------------------------------------
    await check("recipients: David (leads Design), the owner and HR; never staff", async () => {
      const on = (await withSystem((db) => reportRecipients(db, org, true))).map((r) => r.id);
      const off = (await withSystem((db) => reportRecipients(db, org, false))).map((r) => r.id);
      expect([david, owner, mary].every((c) => on.includes(c.membership.id)) && ![ada, ben].some((c) => on.includes(c.membership.id)), JSON.stringify(on));
      expect(off.length === 1 && off[0] === david.membership.id, `org-wide off: ${JSON.stringify(off)}`);
      return { orgWideOn: on.length, orgWideOff: off.length };
    });
    await check("team_report refuses staff politely (Ada, Ben); nothing saved", async () => {
      const r = await runBrendaTool(ada, "team_report", {});
      const e = (r.out as { error?: string }).error ?? "";
      expect(/team leads/.test(e) && !r.actions.length && !r.proposals.length, JSON.stringify(r));
      expect((await teamReportNow(ben)).status === "refused", "Ben was not refused");
      expect(!(await logRow(ada.membership.id)) && !(await logRow(ben.membership.id)), "a log row was written");
      return e;
    });
    await check("a quiet team sends nothing: its lead clocked in on time, and nothing happened or needs her", async () => {
      // A lead of a team of one: nobody else's work or attendance can make her day non-empty. Clocked in on time, so
      // she is neither late nor missing whether or not the organisation clocks today.
      const yara = await addPerson(TEMP_LEAD_EMAIL, "Yara Quietlead", "SMOKE-DR-02", "manager");
      try {
        const team = (await admin.query("INSERT INTO teams(organisation_id, name) VALUES ($1, $2) RETURNING id", [org, `${PREFIX} quiet team`])).rows[0].id as string;
        await admin.query("INSERT INTO team_members(organisation_id, team_id, membership_id, is_manager) VALUES ($1, $2, $3, true)", [org, team, yara.membershipId]);
        await admin.query(`INSERT INTO attendance_days(organisation_id, membership_id, local_date, timezone, scheduled_start, scheduled_end, clock_in_at, late_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [org, yara.membershipId, ...lateBy(0)]);
        const ctx = await contextFor({ profileId: yara.profileId, authUserId: yara.authUserId, email: yara.email, displayName: yara.name, password: "" }, "company-a");
        expect((await withSystem((db) => reportRecipients(db, org, false))).some((x) => x.id === yara.membershipId), "a lead of a live team is not a recipient");
        const r = await buildDailyReport(ctx, { useAssistant: false });
        expect(r.empty && r.scope === "team" && JSON.stringify(names(r)) === JSON.stringify(["Yara Quietlead"]), JSON.stringify({ empty: r.empty, people: names(r), attention: r.attention }));
        const j = await job(yara.membershipId);
        expect(j.status === "nothing" && !(await logRow(yara.membershipId)), JSON.stringify(j));
        const asked = await teamReportNow(ctx, { useAssistant: false });
        expect(asked.status === "nothing" && !(await logRow(yara.membershipId)), JSON.stringify(asked));
        return { job: j.status, asked: asked.status };
      } finally { await removeQuietTeam(); }
    });

    // ---- A day's work: Ada finished a task and clocked in late, Ben has work in progress and did not clock in,
    // and someone outside David's team clocked in late. --------------------------------------------------------
    const project = (await admin.query("SELECT id FROM projects WHERE organisation_id = $1 ORDER BY created_at LIMIT 1", [org])).rows[0].id as string;
    await admin.query(
      `INSERT INTO tasks(organisation_id, project_id, assignee_membership_id, created_by, title, expected_output, status, completed_at, progress_percent) VALUES
         ($1, $2, $3, $5, $6, 'Done.', 'completed', now(), 100),
         ($1, $2, $4, $5, $7, 'Half way.', 'in_progress', NULL, 40)`,
      [org, project, ada.membership.id, ben.membership.id, david.membership.id, `${PREFIX}: brand colours`, `${PREFIX}: pricing table`]);
    const ins = await admin.query(
      `INSERT INTO attendance_days(organisation_id, membership_id, local_date, timezone, scheduled_start, scheduled_end, clock_in_at, late_seconds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (membership_id, local_date) DO NOTHING RETURNING id`, [org, ada.membership.id, ...lateBy(42)]);
    clockIns.push(...ins.rows.map((r) => r.id as string));
    const temp = (await addPerson(TEMP_EMAIL, "Zed Outsider", "SMOKE-DR-01", "employee")).membershipId;
    const team = (await admin.query("INSERT INTO teams(organisation_id, name) VALUES ($1, $2) RETURNING id", [org, `${PREFIX} team`])).rows[0].id as string;
    await admin.query("INSERT INTO team_members(organisation_id, team_id, membership_id) VALUES ($1, $2, $3)", [org, team, temp]);
    await admin.query(`INSERT INTO attendance_days(organisation_id, membership_id, local_date, timezone, scheduled_start, scheduled_end, clock_in_at, late_seconds) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [org, temp, ...lateBy(15)]);

    // ---- What each report says --------------------------------------------------------------------------------
    await check("David's report covers his team only, with attendance notes", async () => {
      const r = await buildDailyReport(david, { useAssistant: false });
      const p = Object.fromEntries(r.people.map((x) => [x.name, x]));
      expect(r.scope === "team" && JSON.stringify(names(r)) === JSON.stringify(["Ada Employee", "Ben Employee", "David Manager"]), JSON.stringify(names(r)));
      expect(p["Ada Employee"].completedTitles.includes(`${PREFIX}: brand colours`) && p["Ada Employee"].attendance.lateMinutes === 42, JSON.stringify(p["Ada Employee"]));
      expect(p["Ben Employee"].inProgress.some((t) => t.title === `${PREFIX}: pricing table` && t.progress === 40), JSON.stringify(p["Ben Employee"].inProgress));
      expect(p["Ben Employee"].attendance.missing === workingDay, `Ben missing: ${p["Ben Employee"].attendance.missing}, working day: ${workingDay}`);
      expect(!r.empty && r.headline.split(/(?<=\.)\s/).length === 2, r.headline);
      const body = reportMarkdown(david, r, { writtenAt: new Date(), endOfDay: true, reportTime: "18:00" });
      expect(body.startsWith("_Brenda wrote") && body.includes("## Ada Employee") && body.includes("42 minutes late") && body.includes("## Needs your attention") && !body.includes("Zed Outsider"), body.slice(0, 300));
      return { headline: r.headline, attention: r.attention };
    });
    await check("the owner's report covers the whole organisation", async () => {
      const r = await buildDailyReport(owner, { useAssistant: false });
      expect(r.scope === "organisation" && ["Ada Employee", "Ben Employee", "David Manager", "Zed Outsider"].every((n) => names(r).includes(n)), JSON.stringify(names(r)));
      expect(r.people.find((x) => x.name === "Zed Outsider")!.attendance.lateMinutes === 15, "Zed's lateness missing");
      return { people: names(r), headline: r.headline };
    });

    // ---- The setting, and the scheduler ------------------------------------------------------------------------
    await check("switched off: the job sends nothing and nothing is scheduled", async () => {
      await setSettings({ enabled: false });
      try {
        const j = await job(david.membership.id);
        const s = await scheduleDailyReports({ organisationId: org, now: localTimeOn(today, "18:00", tz) });
        expect(j.status === "off" && !(await logRow(david.membership.id)) && s.queued === 0, JSON.stringify({ j, s }));
        return { job: j.status, queued: s.queued };
      } finally { await setSettings({ enabled: true }); }
    });
    await check("the scheduler queues each recipient at the configured local time, at most an hour ahead", async () => {
      const now = new Date();
      const lp = localParts(now, tz);
      const minutes = lp.hour * 60 + lp.minute + 30;
      if (minutes >= 24 * 60) return "skipped: too close to midnight";
      const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      const at = localTimeOn(today, time, tz).getTime();
      const queued = async () => (await admin.query("SELECT payload->>'membershipId' AS m, next_run_at FROM jobs WHERE type = 'brenda.daily_report' AND dedup_key LIKE $1 AND payload->>'organisationId' = $2", [`brenda.daily_report:%:${today}`, org])).rows as { m: string; next_run_at: Date }[];
      try {
        await setSettings({ time, orgWide: true });
        const s = await scheduleDailyReports({ organisationId: org, now });
        const rows = await queued();
        if (!workingDay) { expect(s.queued === 0 && !rows.length, JSON.stringify(rows)); return "not a working day: nothing queued"; }
        const ids = rows.map((r) => r.m);
        expect([david, owner, mary].every((c) => ids.includes(c.membership.id)) && ![ada, ben].some((c) => ids.includes(c.membership.id)) && !ids.includes(temp), JSON.stringify(ids));
        expect(rows.every((r) => new Date(r.next_run_at).getTime() === at), `run at ${rows.map((r) => new Date(r.next_run_at).toISOString())}, wanted ${new Date(at).toISOString()}`);
        const again = await scheduleDailyReports({ organisationId: org, now });
        expect((await queued()).length === rows.length, "a second pass queued duplicates");
        // The time changed in Settings after the jobs were queued: the waiting jobs move with it, later or earlier.
        if (minutes + 90 < 24 * 60) {
          const later = minutes + 90;
          await setSettings({ time: `${String(Math.floor(later / 60)).padStart(2, "0")}:${String(later % 60).padStart(2, "0")}` });
          const moved = await scheduleDailyReports({ organisationId: org, now });
          const after = await queued();
          expect(moved.queued === 0 && after.length === rows.length && after.every((r) => new Date(r.next_run_at).getTime() === at + 90 * 60_000), `not moved later: ${after.map((r) => new Date(r.next_run_at).toISOString())}`);
          await setSettings({ time });
          await scheduleDailyReports({ organisationId: org, now });
          expect((await queued()).every((r) => new Date(r.next_run_at).getTime() === at), "not moved back");
        }
        await clearJobs(); await setSettings({ orgWide: false });
        await scheduleDailyReports({ organisationId: org, now });
        const leadOnly = (await queued()).map((r) => r.m);
        expect(leadOnly.length === 1 && leadOnly[0] === david.membership.id, `org-wide off: ${JSON.stringify(leadOnly)}`);
        await clearJobs(); await setSettings({ orgWide: true, time: `${String((lp.hour + 2) % 24).padStart(2, "0")}:${String(lp.minute).padStart(2, "0")}` });
        const later = lp.hour + 2 < 24 ? await scheduleDailyReports({ organisationId: org, now }) : { queued: 0 };
        expect(later.queued === 0 && !(await queued()).length, "queued more than an hour ahead");
        return { time, queued: s.queued, secondPass: again.queued };
      } finally { await clearJobs(); await setSettings({ time: "18:00", orgWide: true }); }
    });
    await check("the configured time holds on the days the clocks change (not local midnight plus the hours)", async () => {
      // The scheduler reads the time with localTimeOn; company-a's own zone may never change its clocks, so the days are
      // checked in zones that do: 18:00 must come out as 18:00 local, where midnight plus 18 hours is an hour out.
      const wall = (at: Date, zone: string) => { const p = localParts(at, zone); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };
      const days: [string, string][] = [["2026-03-29", "Europe/London"], ["2026-10-25", "Europe/London"], ["2026-03-08", "America/New_York"], ["2026-11-01", "America/New_York"], ["2026-04-24", "Africa/Cairo"]];
      const out = days.map(([d, zone]) => {
        const at = localTimeOn(d, "18:00", zone);
        const naive = new Date(localMidnight(d, zone).getTime() + 18 * 3_600_000);
        expect(wall(at, zone) === "18:00" && localParts(at, zone).day === Number(d.slice(8)), `${zone} ${d}: ${at.toISOString()} reads ${wall(at, zone)}`);
        expect(wall(naive, zone) !== "18:00", `${zone} ${d} is not a clock-change day`);
        return `${zone} ${d} ${at.toISOString().slice(11, 16)}Z`;
      });
      return out;
    });

    // ---- Sending ---------------------------------------------------------------------------------------------------
    let davidDoc = "";
    await check("David's end-of-day report: a private document in Daily reports, a notification and an email", async () => {
      const j = await job(david.membership.id);
      expect(j.status === "sent" && !!j.docId, JSON.stringify(j));
      davidDoc = j.docId!;
      const d = await getDoc(david, davidDoc);
      expect(!!d && d.visibility === "private" && d.folder === REPORT_FOLDER && d.title === `Team report, ${dayLabel(today)}` && d.createdBy.membershipId === david.membership.id, JSON.stringify(d && { v: d.visibility, f: d.folder, t: d.title }));
      expect(d!.body.startsWith("_Brenda wrote this end-of-day report"), d!.body.slice(0, 120));
      const n = await notes(david.membership.id);
      expect(n.length === 1 && n[0].href === `/app/company-a/docs/${davidDoc}`, JSON.stringify(n));
      if (mailConfigProblem() === null) expect(j.emailed === true && mails.length === 1 && mails[0].to === "david@company-a.test" && mails[0].text.includes(`/app/company-a/docs/${davidDoc}`), JSON.stringify(mails.map((m) => m.to)));
      return { title: d!.title, notification: n[0].title, email: mails[0]?.subject ?? "mail not configured" };
    });
    await check("the report is private: Ada and Ben cannot read it", async () => {
      expect(!(await getDoc(ada, davidDoc)) && !(await getDoc(ben, davidDoc)), "staff can read David's report");
      return "hidden";
    });
    await check("a second run is a no-op", async () => {
      const j = await job(david.membership.id);
      const docs = (await admin.query("SELECT count(*)::int AS n FROM documents WHERE created_by = $1 AND folder = $2 AND archived_at IS NULL AND created_at > now() - interval '1 hour'", [david.membership.id, REPORT_FOLDER])).rows[0].n;
      expect(j.status === "already_sent" && docs === 1 && (await notes(david.membership.id)).length === 1 && mails.length <= 1, JSON.stringify({ j, docs, mails: mails.length }));
      return j.status;
    });
    await check("asking afterwards returns the report that went out", async () => {
      const r = await teamReportNow(david, { useAssistant: false });
      expect(r.status === "existing" && "docId" in r && r.docId === davidDoc && r.endOfDay, JSON.stringify(r));
      const t = await runBrendaTool(david, "team_report", {});
      const o = t.out as { path?: string; headline?: string };
      expect(o.path === `/docs/${davidDoc}` && !!o.headline && t.actions.length === 1 && !t.proposals.length, JSON.stringify(t));
      return { path: o.path, action: t.actions[0].summary };
    });
    await check("the owner's report covers everyone and is private to the owner", async () => {
      const j = await job(owner.membership.id);
      expect(j.status === "sent" && !!j.docId, JSON.stringify(j));
      const d = await getDoc(owner, j.docId!);
      expect(!!d && d.body.includes("## Zed Outsider") && d.body.includes("## Ada Employee"), d?.body.slice(0, 300) ?? "missing");
      expect(!(await getDoc(david, j.docId!)) && !(await getDoc(ada, j.docId!)), "David or Ada can read the owner's report");
      return d!.title;
    });
    await check("not a recipient, or a day that has passed: skipped", async () => {
      const a = await job(ada.membership.id);
      const old = await runDailyReportJob({ organisationId: org, membershipId: mary.membership.id, localDate: addDays(today, -1) }, { useAssistant: false });
      expect(a.status === "not_a_recipient" && old.status === "stale", JSON.stringify({ a, old }));
      return { ada: a.status, yesterday: old.status };
    });
    await check("asked for during the day: saved, refreshed until edited, then sent at the end of the day", async () => {
      const first = await teamReportNow(mary, { useAssistant: false });
      expect(first.status === "saved" && "docId" in first && !first.endOfDay, JSON.stringify(first));
      const docA = (first as { docId: string }).docId;
      expect((await getDoc(mary, docA))!.body.includes("when you asked") && !(await notes(mary.membership.id)).length, "not an asked-for report, or notified");
      const again = await teamReportNow(mary, { useAssistant: false });
      expect(again.status === "saved" && (again as { docId: string }).docId === docA, `not refreshed in place: ${JSON.stringify(again)}`);
      await updateDoc(mary, docA, { appendBody: "Mary's note." });
      const third = await teamReportNow(mary, { useAssistant: false });
      const docB = (third as { docId: string }).docId;
      expect(third.status === "saved" && docB !== docA && (await getDoc(mary, docA))!.body.endsWith("Mary's note."), "her edited report was overwritten");
      const j = await job(mary.membership.id);
      const d = await getDoc(mary, docB);
      expect(j.status === "sent" && j.docId === docB && d!.body.startsWith("_Brenda wrote this end-of-day report") && (await notes(mary.membership.id)).length === 1, JSON.stringify({ j, head: d?.body.slice(0, 80) }));
      return { asked: docA.slice(0, 8), afterEdit: docB.slice(0, 8), sent: j.status };
    });

    // ---- Over HTTP ---------------------------------------------------------------------------------------------------
    const up = await fetch(`${BASE}/api/health`).then((r) => r.status < 500, () => false);
    if (!up) console.log("skip  API routes: nothing answering at", BASE, "(start pnpm dev to include them)");
    else {
      const tokens: string[] = [];
      const as = async (c: typeof ada) => { const t = await withSystem((db) => issueSession(db, c.user.authUserId, { method: "password", userAgent: "smoke-daily-report" })); tokens.push(t); return t; };
      const [tOwner, tDavid, tAda] = [await as(owner), await as(david), await as(ada)];
      const call = async (token: string, method: string, path: string, body?: unknown) => {
        const res = await fetch(`${BASE}/api/orgs/company-a${path}`, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
        return { status: res.status, json: await res.json().catch(() => null) as Record<string, unknown> | null };
      };
      const status = <R extends { status: number; json: unknown }>(r: R, want: number): R => { expect(r.status === want, `expected ${want}, got ${r.status}: ${JSON.stringify(r.json).slice(0, 200)}`); return r; };
      try {
        await check("API: GET settings carries the daily report", async () => {
          const s = status(await call(tOwner, "GET", "/brenda/settings"), 200).json!.settings as Record<string, unknown>;
          expect(s.dailyReportEnabled === true && s.dailyReportTime === "18:00" && s.dailyReportOrgWide === true, JSON.stringify(s)); return s;
        });
        await check("API: PATCH settings: owner 200, a bad time 422, a team lead 403", async () => {
          const r = status(await call(tOwner, "PATCH", "/brenda/settings", { dailyReportTime: "18:30", dailyReportOrgWide: false }), 200).json!;
          expect(r.dailyReportTime === "18:30" && r.dailyReportOrgWide === false && r.dailyReportEnabled === true, JSON.stringify(r));
          status(await call(tOwner, "PATCH", "/brenda/settings", { dailyReportTime: "25:00" }), 422);
          status(await call(tDavid, "PATCH", "/brenda/settings", { dailyReportEnabled: false }), 403);
          return r;
        });
        await check("API: POST daily-report: staff 403, the owner gets today's report", async () => {
          status(await call(tAda, "POST", "/brenda/daily-report"), 403);
          const r = status(await call(tOwner, "POST", "/brenda/daily-report"), 200).json!;
          expect(r.status === "existing" && typeof r.href === "string" && (r.href as string).startsWith("/app/company-a/docs/"), JSON.stringify(r)); return { status: r.status, title: r.title };
        });
      } finally { for (const t of tokens) await signOut(t); }
    }
  } finally {
    setMailProvider(null);
    await new Promise((res) => setTimeout(res, 300));
    await cleanup();
  }
  console.log(failed ? `${failed} failed` : "all passed");
  await admin.end(); await getPool().end();
  process.exit(failed ? 1 : 0);
}
main().catch(async (e) => { console.error(e); process.exit(1); });
