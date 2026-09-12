import Link from "next/link";
import { Eye, ListChecks, Users, Clock, MonitorPlay, CalendarRange } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/server/auth";

export const metadata = { title: "Boredroom · Stop asking \"what are you working on?\"" };

export default async function LandingPage() {
  const user = await getCurrentUser().catch(() => null);
  return (
    <main id="main" className="relative overflow-hidden">
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav aria-label="Primary" className="flex items-center gap-3 text-sm">
          <a href="#how" className="hidden text-fg-muted hover:text-fg md:inline">How it works</a>
          <a href="#what" className="hidden text-fg-muted hover:text-fg md:inline">What you get</a>
          <a href="#faq" className="hidden text-fg-muted hover:text-fg md:inline">FAQ</a>
          {user ? <Link href="/app"><Button size="sm">Open workspace</Button></Link> : <><Link href="/login" className="text-fg-muted hover:text-fg">Sign in</Link><Link href="/signup"><Button size="sm">Create workspace</Button></Link></>}
        </nav>
      </header>

      <section className="relative">
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-[-520px] h-[960px] w-[1400px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,108,2,0.55),rgba(255,140,40,0.18)_50%,transparent_72%)] blur-3xl" />
        <div className="relative mx-auto max-w-4xl px-6 pb-24 pt-16 text-center md:pt-28">
          <p className="text-[12px] font-semibold uppercase tracking-[0.35em] text-accent/80">The future of remote working</p>
          <h1 className="mt-5 font-display text-5xl leading-[1.05] md:text-7xl">Stop asking <span className="gradient-text">&ldquo;what are you working on?&rdquo;</span></h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-fg-muted">Boredroom links what your remote team plans, what they report working on, what they deliver, and what their managers accept. One workflow, no check-in calls.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup?intent=org"><Button size="lg">Create an organisation account</Button></Link>
            <Link href="/join"><Button size="lg" variant="outline">Join my organisation</Button></Link>
          </div>
          <p className="mt-4 text-xs text-fg-subtle">Timers, heartbeats and recordings are never treated as proof of productivity.</p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16 text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.35em] text-accent/70">The problem</p>
        <h2 className="mt-4 font-display text-4xl md:text-5xl"><span className="gradient-text">Out of sight</span> isn&apos;t supposed to mean out of the loop.</h2>
        <p className="mx-auto mt-4 max-w-xl text-fg-muted">Your team&apos;s remote, maybe overseas, maybe just spread across time zones. Tasks quietly stall. Deadlines slip. You&apos;re always the last one to know.</p>
      </section>

      <section id="how" className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-2 md:items-center">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.35em] text-accent/70">How it works</p>
          <h2 className="mt-4 font-display text-5xl leading-tight">One dashboard.<br />Every task.<br /><span className="gradient-text">No guessing.</span></h2>
          <Link href="/signup" className="mt-8 inline-block"><Button size="lg" variant="outline">Create your workspace</Button></Link>
        </div>
        <ol className="space-y-6">
          {[
            { n: "01.", t: "Add your team.", d: "Create teams, appoint team leads, and share one join code. Staff can only join through it.", I: Users },
            { n: "02.", t: "They log the work.", d: "Plan the day, start a session, stop with a note. Time is the sum of confirmed intervals.", I: ListChecks },
            { n: "03.", t: "You see it live.", d: "Reported activity, blockers and submitted evidence, with last-sync timestamps.", I: Eye },
          ].map((s) => (
            <li key={s.n} className="flex items-center gap-5">
              <span className="tile tile-glow flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl"><s.I className="h-8 w-8 text-accent" aria-hidden /></span>
              <p className="text-xl"><span className="font-display text-accent">{s.n} {s.t}</span><br /><span className="text-fg-muted">{s.d}</span></p>
            </li>
          ))}
        </ol>
      </section>

      <section id="what" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="text-center font-display text-5xl">What <span className="gradient-text">you get</span></h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            { t: "Task visibility", d: "Every task, logged the moment it starts.", I: ListChecks },
            { t: "Time allocation", d: "How long something should take, and how long it actually took.", I: Clock },
            { t: "Screen recording", d: "Optional, explicit, video-only, with visible controls and short retention.", I: MonitorPlay },
            { t: "At-a-glance status", d: "Who is on track and who is blocked without opening a single task.", I: Eye },
            { t: "Upcoming planning", d: "Your team plans ahead, so you know what is coming before it is due.", I: CalendarRange },
            { t: "Reviewed evidence", d: "Deliverables reviewed by a designated person. No self-approval.", I: Users },
          ].map((f) => (
            <div key={f.t} className="tile flex items-start gap-4 p-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-accent-fg"><f.I className="h-5 w-5" aria-hidden /></span>
              <div><p className="font-semibold text-accent">{f.t}</p><p className="text-sm text-fg-muted">{f.d}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="relative mt-16 overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent,rgba(255,108,2,0.35)_60%,rgba(255,108,2,0.6))]" />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-6 py-20 md:grid-cols-2">
          <div><p className="text-[12px] font-semibold uppercase tracking-[0.35em] text-accent/80">FAQ&apos;s</p><h2 className="mt-3 font-display text-5xl">Frequently asked questions</h2></div>
          <div className="space-y-3">
            {[
              ["Do my staff know they're being tracked?", "Yes. Every member reads and acknowledges a versioned monitoring notice before working, and can see exactly what is recorded about them."],
              ["Is screen recording mandatory?", "No. Recording is disabled until an owner activates a policy, and even then it is explicit, video-only and can be required only on designated tasks with an exception route."],
              ["When does it launch?", "Boredroom is in a private pilot. Create a workspace to start with your own team."],
            ].map(([q, a]) => (
              <details key={q} className="rounded-full border border-accent/60 bg-black/40 px-5 py-3 open:rounded-3xl"><summary className="cursor-pointer font-semibold">{q}</summary><p className="mt-2 text-sm text-fg-muted">{a}</p></details>
            ))}
          </div>
        </div>
        <div className="relative px-6 pb-20 text-center">
          <p className="font-display text-6xl leading-none text-accent md:text-8xl">Get in before<br />everyone else does</p>
          <Link href="/signup" className="mt-8 inline-block"><Button size="lg" variant="outline">Create your workspace</Button></Link>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-fg-muted">
        <div><Logo /><p className="mt-2 max-w-md">Boredroom gives you a live view of every task your remote team is doing, hours logged, work in progress, what&apos;s coming next. No status meeting required.</p></div>
        <div className="flex gap-6"><Link href="/login" className="hover:text-fg">Sign in</Link><Link href="/signup" className="hover:text-fg">Create workspace</Link></div>
      </footer>
    </main>
  );
}
