import { describe, it, expect, vi } from "vitest";

// Act without asking (owner decision, 8 October 2026): what a saved chat keeps. A reopened chat shows that an action ran
// without asking, that it was undone, why a Confirm still asked, and that a reply read other people's words (sent back so
// the next turn still asks); it never keeps an Undo token, as it never keeps a Confirm token (the offer belongs to the
// window it was made in).

vi.mock("@/server/db", () => {
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withUser: refuse, withSystem: refuse, withWorker: refuse };
});

import { createConversationSchema, stripTokens, updateConversationSchema } from "@/server/services/brenda-history";

const UNDO = { token: `${"u".repeat(400)}.sig`, until: "2026-10-08T14:32:00.000Z" };
const CONFIRM_TOKEN = `${"c".repeat(600)}.sig`;
const ITEM = "00000000-0000-4000-8000-0000000000e9";

const saved = (messages: unknown[]) => stripTokens(createConversationSchema.parse({ messages }).messages);
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("saving a chat with Act without asking", () => {
  it("keeps tainted, auto, undone and why; drops Undo and Confirm tokens", () => {
    const out = json(saved([
      { role: "user", content: "Tell Ben's assistant the client moved the deadline" },
      {
        role: "assistant", content: "Done: I passed it to Ben's Brenda.", engine: "claude", tainted: true,
        actions: [
          { kind: "assistant_message", summary: "Passed your message to Ben's Brenda", href: `/app/acme/home/assistants/items/${ITEM}`, assistantItemId: ITEM, auto: true, undo: UNDO },
          { kind: "todo", summary: "Added to-do: Call Josh", auto: true, undo: UNDO, undone: "Removed the to-do" },
        ],
        proposals: [{ kind: "confirm", token: CONFIRM_TOKEN, summary: "Message #general (team channel):", tool: "send_message", detail: "Hello all", why: "Still asking: this goes to a whole team.", done: "Not done" }],
      },
    ]));
    expect(out).toEqual([
      { role: "user", content: "Tell Ben's assistant the client moved the deadline" },
      {
        role: "assistant", content: "Done: I passed it to Ben's Brenda.", engine: "claude", tainted: true,
        actions: [
          { kind: "assistant_message", summary: "Passed your message to Ben's Brenda", href: `/app/acme/home/assistants/items/${ITEM}`, assistantItemId: ITEM, auto: true },
          { kind: "todo", summary: "Added to-do: Call Josh", auto: true, undone: "Removed the to-do" },
        ],
        proposals: [{ kind: "confirm", summary: "Message #general (team channel):", tool: "send_message", detail: "Hello all", why: "Still asking: this goes to a whole team.", done: "Not done" }],
      },
    ]);
    const text = JSON.stringify(out);
    expect(text).not.toContain(UNDO.token);
    expect(text).not.toContain(CONFIRM_TOKEN);
    expect(text).not.toContain("until");
  });

  it("keeps tainted as sent (false too: a reply without it counts as tainted), other flags only when set, and a chat saved before this change reads as it did", () => {
    const out = json(saved([
      { role: "assistant", content: "Here you go.", tainted: false, actions: [{ kind: "todo", summary: "Added to-do: Call Josh", auto: false }] },
      { role: "assistant", content: "Older reply", actions: [{ kind: "todo", summary: "Added to-do: Pay the invoice", href: "/app/acme/tasks/1" }], proposals: [{ kind: "confirm", summary: "Assign it", tool: "assign_task" }] },
    ]));
    expect(out).toEqual([
      { role: "assistant", content: "Here you go.", tainted: false, actions: [{ kind: "todo", summary: "Added to-do: Call Josh" }] },
      { role: "assistant", content: "Older reply", actions: [{ kind: "todo", summary: "Added to-do: Pay the invoice", href: "/app/acme/tasks/1" }], proposals: [{ kind: "confirm", summary: "Assign it", tool: "assign_task" }] },
    ]);
  });

  it("shortens a long why rather than refusing the save, and refuses a flag that is not a yes or no", () => {
    const [m] = saved([{ role: "assistant", content: "x", proposals: [{ kind: "confirm", summary: "s", tool: "send_message", why: "Still asking: ".padEnd(400, "x") }] }]);
    const why = (m.proposals?.[0] as { why?: string }).why ?? "";
    expect(why.length).toBe(300);
    expect(why.endsWith("…")).toBe(true);
    expect(createConversationSchema.safeParse({ messages: [{ role: "assistant", content: "x", tainted: "yes" }] }).success).toBe(false);
    expect(createConversationSchema.safeParse({ messages: [{ role: "assistant", content: "x", actions: [{ kind: "todo", summary: "s", auto: 1 }] }] }).success).toBe(false);
  });

  it("keeps a Confirm's readback (phase 7a: who it would have gone to), shortened to fit, never its token", () => {
    const readback = { to: ["#Design, a team channel of 6 people"], what: "Your message, marked as sent by Max" };
    const out = json(saved([{ role: "assistant", content: "x", proposals: [{ kind: "confirm", token: CONFIRM_TOKEN, summary: "Message #Design (team channel):", tool: "send_message", readback, done: "Not done" }] }]));
    expect(out).toEqual([{ role: "assistant", content: "x", proposals: [{ kind: "confirm", summary: "Message #Design (team channel):", tool: "send_message", readback, done: "Not done" }] }]);
    expect(JSON.stringify(out)).not.toContain(CONFIRM_TOKEN);
    const [long] = saved([{ role: "assistant", content: "x", proposals: [{ kind: "confirm", summary: "s", tool: "follow_up", readback: { to: ["x".repeat(400)], what: "y".repeat(1200) } }] }]);
    const rb = (long.proposals?.[0] as { readback?: { to: string[]; what?: string } }).readback;
    expect(rb?.to[0].length).toBe(300);
    expect(rb?.what?.length).toBe(1000);
    // An empty one is not kept; a card from before it has none.
    expect(json(saved([{ role: "assistant", content: "x", proposals: [{ kind: "confirm", summary: "s", tool: "mark_read", readback: { to: [] } }] }]))[0].proposals[0].readback).toBeUndefined();
    expect(createConversationSchema.safeParse({ messages: [{ role: "assistant", content: "x", proposals: [{ kind: "confirm", summary: "s", tool: "t", readback: { to: "Ben" } }] }] }).success).toBe(false);
  });

  it("an update keeps the same things as a create", () => {
    const parsed = updateConversationSchema.parse({ messages: [{ role: "assistant", content: "x", tainted: true, actions: [{ kind: "todo", summary: "s", auto: true, undo: UNDO }] }] });
    expect(json(stripTokens(parsed.messages))).toEqual([{ role: "assistant", content: "x", tainted: true, actions: [{ kind: "todo", summary: "s", auto: true }] }]);
  });
});
