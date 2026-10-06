"use client";
import { useState } from "react";
import { ArrowUp, SquareCheckBig } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Avatar } from "@/components/ui/avatar";
import { Pane } from "@/components/landing/parts";

const THREADS = [
  { value: "everyone", label: "Everyone", messages: [{ who: "Mary Eze", t: "09:02", body: "Client call moved to 15:00, please be on the clock." }, { who: "Ben Adeyemi", t: "09:04", body: "Noted. Deck will be at revision 2 by then." }, { who: "You", t: "09:06", body: "Great. Ada, how far with the homepage?", task: "Homepage design" }] },
  { value: "design", label: "Design", count: 2, messages: [{ who: "David Okafor", t: "10:12", body: "Reviewing revision 2 now." }, { who: "Ada Obi", t: "10:13", body: "Hero spacing tightened as asked.", task: "Homepage design" }, { who: "David Okafor", t: "10:20", body: "Approved. Nice work." }] },
  { value: "ada", label: "Ada", messages: [{ who: "You", t: "11:30", body: "How far with the invoice page?", task: "Invoice page" }, { who: "Ada Obi", t: "11:32", body: "Two sections left, done by 14:00. Timer's running." }] },
] as const;

/**
 * Messages with the task attached, on real v4 underline tabs (the Design channel's unread count is an orange
 * attention pill until it is opened, as in the app). The thread is a picture of the app; the tabs work.
 */
export function MessagesDemo() {
  const [tab, setTab] = useState<string>(THREADS[0].value);
  const [read, setRead] = useState<string[]>([]);
  const thread = THREADS.find((t) => t.value === tab) ?? THREADS[0];
  const open = (v: string) => { setTab(v); setRead((r) => (r.includes(v) ? r : [...r, v])); };
  return (
    <Pane className="lp-reveal overflow-hidden shadow-chart">
      <Tabs tabs={THREADS.map((t) => ({ label: t.label, value: t.value, count: "count" in t && !read.includes(t.value) ? t.count : undefined, attention: true }))} value={tab} onChange={open} label="Threads" className="px-5 pt-3" />
      <div role="tabpanel" aria-label={thread.label} className="min-h-[248px] p-5">
        <ul className="space-y-4">
          {thread.messages.map((m) => (
            <li key={m.t + m.who} className="flex gap-3">
              <Avatar profileId={`landing-${m.who}`} name={m.who === "You" ? "Owner Admin" : m.who} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-sm"><span className="font-semibold text-foreground">{m.who === "You" ? "You" : m.who.split(" ")[0]}</span><span className="ml-2 text-xs font-normal tabular-nums text-subtle">{m.t}</span></p>
                <p className="mt-0.5 text-sm font-normal text-secondary">{m.body}</p>
                {"task" in m ? (
                  <span className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-lg border border-border-input px-2 text-xs font-medium text-foreground">
                    <SquareCheckBig className="size-3.5 text-secondary" aria-hidden />{m.task}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-border p-3" aria-hidden>
        <div className="flex items-center gap-2 rounded-[22px] bg-surface py-1.5 pl-4 pr-1.5 shadow-[0_0_0_1px_var(--border)]">
          <span className="min-w-0 flex-1 truncate text-sm font-normal text-subtle">Ask for an update…</span>
          <span className="grid size-8 place-items-center rounded-full bg-fill-150 text-subtle"><ArrowUp className="size-4" strokeWidth={2.25} /></span>
        </div>
      </div>
    </Pane>
  );
}
