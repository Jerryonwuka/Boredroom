import { describe, it, expect, vi } from "vitest";

// The morning opener (owner decision, 8 October 2026: phase 7a, contract E.1): the counts' words and the one-tap actions,
// pure. Link actions open a page; ask actions fill the box and never send (owner decision, 5 October 2026). The server
// module is loaded only for its re-export, so the database is refused.

vi.mock("@/server/db", () => {
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withUser: refuse, withSystem: refuse, withWorker: refuse };
});

import { OPENER_MAX_ACTIONS, OPENER_MIN_ACTIONS, OPENER_WORDS, openerActions, openerCalm, openerCount, type OpenerCount, type OpenerCountKey } from "@/lib/opener";
import { openerActions as serverActions, openerSince } from "@/server/services/opener";

const SLUG = "acme";
const counts = (v: Partial<Record<OpenerCountKey, number | null>>): OpenerCount[] =>
  (Object.entries(v) as [OpenerCountKey, number | null][]).map(([k, n]) => openerCount(k, n, SLUG));
const ids = (c: OpenerCount[], role: Parameters<typeof openerActions>[1] = "employee") => openerActions(c, role, SLUG).map((a) => a.id);

describe("the counts", () => {
  it("say what is waiting, with their pages in the workspace", () => {
    expect(openerCount("requests", 2, SLUG)).toEqual({ key: "requests", value: 2, label: "2 requests waiting", href: "/app/acme/home/assistants" });
    expect(openerCount("requests", 1, SLUG).label).toBe("1 request waiting");
    expect(openerCount("overdue", 3, SLUG)).toEqual({ key: "overdue", value: 3, label: "3 overdue tasks", href: "/app/acme/tasks?status=open" });
    expect(openerCount("overdue", 1, SLUG).label).toBe("1 overdue task");
    expect(openerCount("answers", 2, SLUG)).toEqual({ key: "answers", value: 2, label: "2 answers to your follow-ups", href: "/app/acme/home/assistants/sent" });
    expect(openerCount("items", 1, SLUG)).toEqual({ key: "items", value: 1, label: "1 message from assistants", href: "/app/acme/home/assistants" });
    expect(openerCount("reviews", 4, SLUG)).toEqual({ key: "reviews", value: 4, label: "4 reviews waiting", href: "/app/acme/reviews" });
  });

  it("a count that could not be read is 'not available', never 0", () => {
    expect(openerCount("overdue", null, SLUG)).toEqual({ key: "overdue", value: null, label: "Overdue tasks: not available", href: "/app/acme/tasks?status=open" });
    expect(openerCount("requests", null, SLUG).label).toBe("Requests: not available");
    expect(openerCount("answers", null, SLUG).label).toBe("Answers to your follow-ups: not available");
    expect(openerCount("items", null, SLUG).label).toBe("Messages from assistants: not available");
    expect(openerCount("reviews", null, SLUG).label).toBe("Reviews: not available");
    expect(openerCount("overdue", Number.NaN, SLUG).value).toBeNull();
  });

  it("is calm only when every count that could be read is 0", () => {
    expect(openerCalm(counts({ requests: 0, overdue: 0, answers: 0 }))).toBe("Nothing is waiting on you. A good day to get ahead.");
    expect(OPENER_WORDS.calm).toBe("Nothing is waiting on you. A good day to get ahead.");
    expect(openerCalm(counts({ requests: 0, overdue: null }))).toBe(OPENER_WORDS.calm);
    expect(openerCalm(counts({ requests: 0, overdue: 1 }))).toBeNull();
    expect(openerCalm(counts({ overdue: null }))).toBeNull();
    expect(openerCalm([])).toBeNull();
  });
});

describe("the actions", () => {
  it("come in order, one per count above 0: requests, overdue, reviews, answers, messages", () => {
    const a = openerActions(counts({ items: 1, answers: 2, reviews: 3, overdue: 4, requests: 5 }), "manager", SLUG);
    expect(a).toEqual([
      { id: "requests", kind: "link", label: "Answer 5 requests", href: "/app/acme/home/assistants", icon: "inbox" },
      { id: "overdue", kind: "ask", label: "Plan my 4 overdue tasks", prompt: "Look at my overdue tasks and help me follow up on each one.", icon: "alert" },
      { id: "reviews", kind: "link", label: "Review 3 items", href: "/app/acme/reviews", icon: "clipboard" },
      { id: "answers", kind: "link", label: "Read 2 answers", href: "/app/acme/home/assistants/sent", icon: "reply" },
      { id: "items", kind: "link", label: "See 1 message from assistants", href: "/app/acme/home/assistants", icon: "message" },
    ]);
  });

  it("say one thing in the singular", () => {
    const a = openerActions(counts({ requests: 1, overdue: 1, reviews: 1, answers: 1 }), "manager", SLUG);
    expect(a.map((x) => x.label)).toEqual(["Answer 1 request", "Plan my 1 overdue task", "Review 1 item", "Read 1 answer"]);
  });

  it("are filled to 3 with the role's defaults, and never more than 6", () => {
    expect(OPENER_MIN_ACTIONS).toBe(3);
    expect(OPENER_MAX_ACTIONS).toBe(6);
    expect(ids(counts({ requests: 0, overdue: 0 }))).toEqual(["plan_day", "missed", "due_today"]);
    expect(ids(counts({ overdue: 2 }))).toEqual(["overdue", "plan_day", "missed"]);
    expect(ids(counts({ requests: 1, overdue: 2, answers: 1 }))).toEqual(["requests", "overdue", "answers"]);
    expect(ids(counts({ requests: 1, overdue: 2, answers: 1, items: 3 }))).toEqual(["requests", "overdue", "answers", "items"]);
    for (const role of ["employee", "manager", "owner", "hr"] as const) {
      for (const c of [counts({}), counts({ requests: 9, overdue: 9, reviews: 9, answers: 9, items: 9 })]) {
        const n = openerActions(c, role, SLUG).length;
        expect(n).toBeGreaterThanOrEqual(3);
        expect(n).toBeLessThanOrEqual(6);
      }
    }
  });

  it("staff get their own day; team leads, the owner and HR the team's", () => {
    const staff = openerActions([], "employee", SLUG);
    expect(staff).toEqual([
      { id: "plan_day", kind: "ask", label: "Plan my day", prompt: "Arrange my tasks for today in the order I should do them, and tell me why.", icon: "list" },
      { id: "missed", kind: "ask", label: "What did I miss?", prompt: "What did I miss in Messages? Catch me up.", icon: "inbox" },
      { id: "due_today", kind: "ask", label: "What's due today?", prompt: "What's waiting for me today?", icon: "calendar" },
    ]);
    for (const role of ["manager", "owner", "hr"] as const) {
      expect(openerActions([], role, SLUG)).toEqual([
        { id: "who_working", kind: "ask", label: "Who's working?", prompt: "Who is working right now, and on what?", icon: "users" },
        { id: "missed", kind: "ask", label: "What did I miss?", prompt: "What did I miss in Messages? Catch me up.", icon: "inbox" },
        { id: "week_summary", kind: "ask", label: "Week summary", prompt: "Summarise what the team got done this week.", icon: "clipboard" },
      ]);
    }
  });

  it("links open a page and asks only fill the box: a link has an href and no prompt, an ask a prompt and no href", () => {
    const all = openerActions(counts({ requests: 2, overdue: 2, reviews: 2, answers: 2, items: 2 }), "manager", SLUG);
    for (const a of all) {
      if (a.kind === "link") { expect(a.href, a.id).toMatch(/^\/app\/acme\//); expect(a.prompt).toBeUndefined(); }
      else { expect(a.prompt, a.id).toBeTruthy(); expect(a.href).toBeUndefined(); }
    }
  });

  it("offer nothing for a count that could not be read", () => {
    expect(ids(counts({ requests: null, overdue: null, reviews: null }), "manager")).toEqual(["who_working", "missed", "week_summary"]);
  });

  it("the server's openerActions is the same function", () => {
    const c = counts({ requests: 2, overdue: 1 });
    expect(serverActions(c, "employee", SLUG)).toEqual(openerActions(c, "employee", SLUG));
  });
});

describe("since when answers count", () => {
  const now = new Date("2026-10-08T08:00:00Z");
  it("is the previous opener, else 24 hours ago, never more than 7 days back nor ahead", () => {
    expect(openerSince("2026-10-07T17:30:00Z", now).toISOString()).toBe("2026-10-07T17:30:00.000Z");
    expect(openerSince(null, now).toISOString()).toBe("2026-10-07T08:00:00.000Z");
    expect(openerSince("not a date", now).toISOString()).toBe("2026-10-07T08:00:00.000Z");
    expect(openerSince("2026-09-01T08:00:00Z", now).toISOString()).toBe("2026-10-01T08:00:00.000Z");
    expect(openerSince("2026-10-09T08:00:00Z", now).toISOString()).toBe(now.toISOString());
  });
});
