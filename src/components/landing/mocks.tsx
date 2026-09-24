"use client";
import { GlassCard } from "@/components/landing/glass-card";
import { useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

/** My Day: the one card a staff member lives in. */
export function MyDayMock() {
  const rows = [
    { t: "Homepage design", m: "Fri, 2h 30m", state: "running" },
    { t: "Client kickoff notes", m: "today, 45m", state: "todo" },
    { t: "Brand deck, revision 2", m: "Thu", state: "todo" },
    { t: "Export the logo pack", m: "done 10:40", state: "done" },
  ];
  return (
    <GlassCard className="overflow-hidden">
      <div className="flex items-center justify-between border-b px-5 py-3 text-sm lp-line"><span className="font-semibold">Your to-dos for today</span><span className="lp-muted">Tuesday 23 September</span></div>
      <div className="p-5">
        <p className="font-display text-6xl leading-none tabular-nums text-accent">1:42:07</p>
        <div className="mt-2 h-px w-full bg-border-strong"><div className="h-px w-2/3 bg-accent" /></div>
        <p className="lp-muted mt-1 text-xs">Homepage design, estimate 2h 30m</p>
        <ul className="mt-5 space-y-2">
          {rows.map((r) => (
            <li key={r.t} className={cn("flex items-center justify-between lp-glass rounded-xl px-4 py-3 text-sm", r.state === "running" ? "border-[rgba(255,108,2,0.5)]" : "lp-line", r.state === "done" && "lp-muted line-through")}>
              <span>{r.t}</span>
              <span className="flex items-center gap-3"><span className="lp-muted text-xs no-underline">{r.m}</span>{r.state === "running" ? <span className="lp-btn lp-btn-primary lp-btn-sm">Done</span> : r.state === "todo" ? <span className="lp-btn lp-btn-secondary lp-btn-sm">Start</span> : null}</span>
            </li>
          ))}
        </ul>
      </div>
    </GlassCard>
  );
}

/** Attendance for a month: a dot per person per day. */
export function AttendanceMock() {
  const people = ["Ada", "Ben", "Chidi", "Mary"];
  const pattern = ["g", "g", "a", "g", "g", "g", "x", "g", "g", "g", "g", "a", "g", "g"];
  return (
    <div className="lp-card-sm p-4">
      <div className="mb-3 flex items-center justify-between text-xs"><span className="font-semibold">September</span><span className="lp-muted">12 days in, 2 late, 1 missed</span></div>
      <div className="space-y-2">
        {people.map((p, r) => (
          <div key={p} className="flex items-center gap-3 text-xs"><span className="w-10 lp-muted">{p}</span>
            <div className="flex gap-1.5">{pattern.map((k, i) => { const v = pattern[(i + r * 3) % pattern.length]; return <span key={i} className={cn("h-2.5 w-2.5 rounded-full", v === "g" && "bg-success", v === "a" && "bg-warning", v === "x" && "bg-white/10")} />; })}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Reports: hours by team, bars that grow in. */
export function ReportsMock() {
  const teams = [["Design", 72], ["Tech", 58], ["Graphics", 44], ["Marketing", 31]] as const;
  return (
    <div className="lp-card-sm p-4">
      <div className="mb-3 flex items-center justify-between text-xs"><span className="font-semibold">Confirmed hours, this week</span><span className="lp-muted">205h</span></div>
      <ul className="space-y-2.5">
        {teams.map(([t, v], i) => (
          <li key={t} className="text-xs"><div className="mb-1 flex justify-between"><span>{t}</span><span className="lp-muted tabular-nums">{v}h</span></div>
            <div className="h-1.5 rounded-full bg-white/10"><motion.div className="h-1.5 origin-left rounded-full bg-accent" style={{ width: `${(v / 72) * 100}%` }} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: EASE, delay: 0.1 + i * 0.1 }} /></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Messages with the task attached; the tabs are real. */
export function MessagesMock() {
  const [tab, setTab] = useState(0);
  const tabs = ["Everyone", "Design", "Ada"];
  const threads = [
    [{ who: "Mary", t: "09:02", body: "Client call moved to 15:00, please be on the clock." }, { who: "Ben", t: "09:04", body: "Noted. Deck will be at revision 2 by then." }, { who: "You", t: "09:06", body: "Great. Ada, how far with the homepage?", task: "Homepage design" }],
    [{ who: "David", t: "10:12", body: "Reviewing revision 2 now." }, { who: "Ada", t: "10:13", body: "Hero spacing tightened as asked.", task: "Homepage design" }, { who: "David", t: "10:20", body: "Approved. Nice work." }],
    [{ who: "You", t: "11:30", body: "How far with the invoice page?", task: "Invoice page" }, { who: "Ada", t: "11:32", body: "Two sections left, done by 14:00. Timer's running." }],
  ];
  return (
    <GlassCard className="overflow-hidden">
      <div className="flex gap-1 border-b p-2 lp-line" role="tablist" aria-label="Threads">
        {tabs.map((t, i) => <button key={t} role="tab" aria-selected={tab === i} onClick={() => setTab(i)} className={cn("rounded-full px-3.5 py-1.5 text-sm transition-colors", tab === i ? "bg-wash-active text-fg" : "lp-muted hover:text-fg")}>{t}</button>)}
      </div>
      <ul className="min-h-[230px] space-y-4 p-5">
        {threads[tab].map((m) => (
          <li key={m.t + m.who} className="text-sm"><span className={cn("font-semibold", m.who === "You" && "text-accent")}>{m.who}</span><span className="lp-muted ml-2 text-xs">{m.t}</span>
            <p className="mt-0.5 lp-muted">{m.body}</p>
            {m.task ? <span className="mt-1.5 inline-flex items-center gap-2 lp-glass rounded-lg px-2.5 py-1 text-xs"><img src="/icons/card-check.png" alt="" className="h-4 w-4" />{m.task}</span> : null}
          </li>
        ))}
      </ul>
      <div className="border-t p-3 lp-line"><div className="flex items-center justify-between lp-glass rounded-xl px-4 py-2.5 text-sm lp-line"><span className="lp-muted">Ask for an update…</span><span className="lp-btn lp-btn-primary lp-btn-sm">Send</span></div></div>
    </GlassCard>
  );
}

/** The organisation dashboard, in the style of a metrics page: three verdict cards and one chart. */
export function DashboardMock() {
  const nav = ["Dashboard", "Clock in", "Attendance", "Workroom", "Messages", "Tasks", "People and teams", "Reviews", "Recordings", "Reports"];
  const cards = [
    { k: "Attendance", v: "Good", rows: [["Clocked in", "12", "100%", "bg-success"], ["Late", "1", "8%", "bg-warning"]] },
    { k: "Focus", v: "Good", rows: [["Working now", "9", "75%", "bg-accent"], ["Paused", "2", "17%", "bg-fg-subtle"]] },
    { k: "Delivery", v: "Needs a look", rows: [["Sent for check", "4", "", "bg-info"], ["Blocked", "2", "", "bg-danger"]] },
  ];
  const pts = [30, 44, 38, 52, 60, 55, 70, 64, 78, 72, 86, 80];
  const w = 600, h = 160;
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${(i / (pts.length - 1)) * w},${h - (p / 100) * h}`).join(" ");
  return (
    <div className="h-full overflow-hidden">
      <div className="grid md:grid-cols-[200px_1fr]">
        <aside className="hidden border-r bg-wash-soft p-4 lp-line md:block">
          <p className="mb-4 font-display text-sm">BOREDROOM<span className="text-accent">.</span></p>
          <ul className="space-y-1 text-sm">{nav.map((n, i) => <li key={n} className={cn("rounded-lg px-3 py-1.5", i === 0 ? "bg-wash-active text-fg" : "lp-muted")}>{n}</li>)}</ul>
        </aside>
        <div className="p-5 md:p-7">
          <p className="font-display text-xl">Dashboard</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {cards.map((c) => (
              <div key={c.k} className="lp-card-sm p-4">
                <p className="lp-muted text-[11px] uppercase tracking-wider">{c.k}</p>
                <p className="mt-1 font-display text-2xl">{c.v}</p>
                <ul className="mt-4 divide-y divide-border-soft text-sm">
                  {c.rows.map(([l, n, pct, dot]) => <li key={l} className="flex items-center gap-2 py-2"><span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} /><span className="flex-1 truncate">{l}</span><span className="lp-muted tabular-nums">{n}</span><span className="w-10 text-right tabular-nums">{pct}</span></li>)}
                </ul>
              </div>
            ))}
          </div>
          <div className="lp-card-sm mt-3 p-4">
            <p className="lp-muted text-[11px] uppercase tracking-wider">Confirmed hours</p>
            <p className="mt-1 font-display text-3xl tabular-nums">41h 20m</p>
            <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 h-40 w-full" preserveAspectRatio="none" aria-hidden>
              <defs><linearGradient id="lpfill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#ff6c02" stopOpacity="0.35" /><stop offset="1" stopColor="#ff6c02" stopOpacity="0" /></linearGradient></defs>
              <motion.path d={`${path} L${w},${h} L0,${h} Z`} fill="url(#lpfill)" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: 1.2, delay: 0.6 }} />
              <motion.path d={path} fill="none" stroke="#ff6c02" strokeWidth="2.5" strokeLinejoin="round" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: EASE, delay: 0.2 }} />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
