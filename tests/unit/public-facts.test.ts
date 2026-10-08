import { describe, it, expect } from "vitest";
import { publicFacts } from "@/lib/mentions";
import { composeTemplate } from "@/server/services/follow-up-compose";
import type { FollowUpFacts } from "@/lib/follow-ups";

// Personal assistants, phase 6 (owner decision, 8 October 2026): what someone else's assistant may say in a thread from
// its owner's work. Only what every current reader can see (the audience rule): never time or the timer, never the
// latest update, a task only when every reader can see it, and of someone's work only the tasks every reader can see.

const T1 = "00000000-0000-4000-8000-0000000000d1";
const T2 = "00000000-0000-4000-8000-0000000000d2";
const T3 = "00000000-0000-4000-8000-0000000000d3";
const base = { v: 1 as const, gatheredAt: "2026-10-08T14:00:00Z", freshSince: "2026-10-07T14:00:00Z", fresh: true, timeVisible: true };

const taskFacts: FollowUpFacts = {
  ...base, kind: "task",
  task: { id: T1, title: "Landing page", project: "Web", status: "in_progress", progressPercent: 60, dueAt: "2026-10-09T16:00:00Z", overdue: false, blockedReason: null, completedAt: null },
  history: [{ from: "todo", to: "in_progress", at: "2026-10-08T09:00:00Z", by: "Ben Okafor", byThem: true, reason: null }],
  comments: [{ by: "Ben Okafor", byThem: true, at: "2026-10-08T12:00:00Z", body: "Hero copy done." }],
  submission: null,
  time: { todaySeconds: 5400, weekSeconds: 9000 },
  timer: { state: "running", since: "2026-10-08T13:00:00Z", taskId: T1, taskTitle: "Landing page", ownTodo: false },
  lastUpdate: { kind: "comment", at: "2026-10-08T12:00:00Z", text: "Hero copy done.", taskTitle: "Landing page" },
};

const personFacts: FollowUpFacts = {
  ...base, kind: "person",
  openTasks: [
    { id: T1, title: "Landing page", status: "in_progress", progressPercent: 60, dueAt: null, overdue: false, blockedReason: null },
    { id: T2, title: "Salary review notes", status: "todo", progressPercent: 0, dueAt: null, overdue: false, blockedReason: null },
  ],
  openMore: 4,
  completedToday: [{ id: T3, title: "Pricing page" }],
  time: { todaySeconds: 3600, weekSeconds: 7200 },
  timer: { state: "running", since: "2026-10-08T13:00:00Z", taskId: T2, taskTitle: "Salary review notes", ownTodo: false },
  lastUpdate: { kind: "status", at: "2026-10-08T11:00:00Z", text: "in_progress", taskTitle: "Salary review notes" },
};

describe("publicFacts", () => {
  it("strips time, the timer and the latest update from a task everyone can see, and keeps its record", () => {
    const p = publicFacts(taskFacts, new Set([T1]));
    expect(p).not.toBeNull();
    expect(p?.timeVisible).toBe(false);
    expect(p?.time).toBeNull();
    expect(p?.timer).toBeNull();
    expect(p?.lastUpdate).toBeNull();
    expect(p?.task).toEqual(taskFacts.task);
    expect(p?.comments).toEqual(taskFacts.comments);
    expect(p?.history).toEqual(taskFacts.history);
  });

  it("is nothing for a task not every reader can see (the answer then goes privately)", () => {
    expect(publicFacts(taskFacts, new Set())).toBeNull();
    expect(publicFacts(taskFacts, new Set([T2]))).toBeNull();
    expect(publicFacts({ ...taskFacts, task: undefined }, new Set([T1]))).toBeNull();
  });

  it("keeps only the open and finished work every reader can see, without counting the rest", () => {
    const p = publicFacts(personFacts, new Set([T1.toUpperCase(), T3]));
    expect(p?.openTasks?.map((t) => t.id)).toEqual([T1]);
    expect(p?.completedToday?.map((t) => t.id)).toEqual([T3]);
    expect(p?.openMore).toBeUndefined();
    expect(p?.time).toBeNull();
    expect(p?.timer).toBeNull();
    expect(p?.lastUpdate).toBeNull();
    expect(JSON.stringify(p)).not.toContain("Salary review");
  });

  it("is nothing when none of someone's work is visible to every reader", () => {
    expect(publicFacts(personFacts, new Set([T2.replace("d2", "ff")]))).toBeNull();
    expect(publicFacts({ ...personFacts, openTasks: [], completedToday: [] }, new Set([T1]))).toBeNull();
  });

  it("gives a public answer in the template's words that names nothing private", () => {
    const p = publicFacts(personFacts, new Set([T1, T3]));
    const text = composeTemplate({
      question: "", kind: "person", answeredFrom: "facts", facts: p!, capped: false, reply: null,
      subject: { name: "Ben Okafor", firstName: "Ben", assistantName: "Brenda" }, requester: null, deadlineAt: null, timeZone: "Europe/London", now: new Date("2026-10-08T15:00:00Z"),
    });
    expect(text).toBe("Open: “Landing page” (in progress, 60%). Finished today: “Pricing page”.");
    expect(text).not.toMatch(/Salary|Logged|working on|timer/i);
  });
});
