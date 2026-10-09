import { describe, it, expect, vi, beforeEach } from "vitest";

// Abilities in her chat (owner decisions, 8–9 October 2026: phase 7c, contract C.3): a tool whose ability the workspace
// or the person switched off refuses first, in the catalogue's words and naming where it is switched on, in chat and at
// a Confirm press alike; cleaning up routines stays allowed; the built-in helper says what it can do and what is off. The
// abilities service is a fake (its integration tests run the real one); the idempotency store is an in-memory fake.

const st = vi.hoisted(() => ({ claims: new Set<string>(), logs: [] as Record<string, unknown>[], abilities: { ready: true, workspaceOff: [] as string[], personalOff: [] as string[] },
  /** The catalogue as Settings shows it (abilitiesView): null reads as nothing governed by an existing switch being off. */
  view: null as null | { cards: Record<string, unknown>[] } }));
vi.mock("@/server/db", () => {
  const fake = {
    maybeOne: async (sql: string, p: unknown[]) => {
      if (!/INSERT INTO idempotency_keys/.test(sql)) return null;
      const key = p.slice(0, 3).join("|");
      if (st.claims.has(key)) return null;
      st.claims.add(key);
      return { id: key };
    },
    query: async (sql: string, p: unknown[]) => { if (/DELETE FROM idempotency_keys/.test(sql)) st.claims.delete(p.slice(0, 3).join("|")); return []; },
    one: async () => { throw new Error("no such read in these tests"); },
  };
  return { withUser: async (_id: string, fn: (d: typeof fake) => Promise<unknown>) => fn(fake), withSystem: async (fn: (d: typeof fake) => Promise<unknown>) => fn(fake), withWorker: async () => { throw new Error("no"); } };
});
vi.mock("@/server/services/abilities", () => ({ abilitiesFor: async () => st.abilities, abilitiesView: async () => st.view }));
vi.mock("@/server/lib/schema-0046", () => ({ schema0046Ready: async () => false, forget0046: () => undefined, isMissingSchema: () => false, retryWithout0046: (fn: () => unknown) => fn() }));
vi.mock("@/server/services/brenda", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/brenda")>()),
  recordAction: async (_ctx: unknown, e: Record<string, unknown>) => { st.logs.push(e); },
}));
vi.mock("@/server/services/assistant-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/services/assistant-profile")>()),
  assistantProfiles: async () => ({
    personal: { name: "Max", colour: "white", visor: "bean", eyes: "pill" }, workspace: { name: "Brenda", colour: "white", visor: "bean", eyes: "pill" },
    setupDone: true, canEditWorkspace: false, speak: "voice", act: { ready: true, mode: "ask", allowed: true, effective: "ask", locked: null },
  }),
}));

import { ABILITIES_ASK, TOOLS, chatBuiltin, confirmAction, prepareConfirm, runBrendaTool } from "@/server/services/copilot";
import { ABILITY_CATALOGUE, TOOL_ABILITY } from "@/lib/abilities";
import { ROUTINES_NOT_READY } from "@/lib/routines";
import type { ActContext } from "@/server/services/act-decision";
import type { OrgContext } from "@/server/lib/api";

const ROUTINE = "00000000-0000-4000-8000-0000000000e1";
const act: ActContext = { state: { ready: true, mode: "ask", allowed: true, effective: "ask", locked: null }, engine: "claude", earlierTaint: false, assistantName: "Max" };
const ctx = {
  user: { profileId: "00000000-0000-4000-8000-0000000000f1", authUserId: "00000000-0000-4000-8000-0000000000f2", email: "olu@example.test", displayName: "Olu Ade", emailVerified: true, sessionId: "test" },
  org: { id: "00000000-0000-4000-8000-0000000000a1", slug: "acme", name: "Acme", timezone: "Africa/Lagos", current_policy_id: null, status: "active" },
  membership: { id: "00000000-0000-4000-8000-0000000000b1", role: "employee", employee_code: "E1" },
  plan: { features: { AI_ASSISTANT: true } },
} as unknown as OrgContext;
const WORKSPACE_OFF = (title: string) => `${title} is switched off in this workspace. An owner or HR can switch it on in Settings → Brenda → Abilities.`;
const PERSONAL_OFF = (title: string) => `${title} is switched off for Max. You can switch it on in Settings → Your assistant → Abilities.`;

beforeEach(() => { st.claims.clear(); st.logs = []; st.abilities = { ready: true, workspaceOff: [], personalOff: [] }; });

describe("which tools each ability governs", () => {
  it("names only real tools", () => {
    const names = new Set(TOOLS.map((x) => x.name));
    for (const n of Object.keys(TOOL_ABILITY)) expect(names.has(n), n).toBe(true);
    expect(ABILITY_CATALOGUE).toHaveLength(11);
  });
});

describe("a switched-off ability's tools refuse first", () => {
  it("with the workspace's words, or the person's, and nothing else runs", async () => {
    st.abilities = { ready: true, workspaceOff: ["catch_up"], personalOff: [] };
    expect((await runBrendaTool(ctx, "list_conversations", {}, "chat", { act })).out).toEqual({ error: WORKSPACE_OFF("Catch-up") });
    expect((await runBrendaTool(ctx, "read_conversation", { conversation: "#design" }, "chat", { act })).out).toEqual({ error: WORKSPACE_OFF("Catch-up") });
    // A refused read is logged once, as refused, in words that say only what was tried.
    expect(st.logs).toEqual([expect.objectContaining({ tool: "list_conversations", outcome: "refused" }), expect.objectContaining({ tool: "read_conversation", outcome: "refused" })]);
    st.abilities = { ready: true, workspaceOff: [], personalOff: ["follow_ups", "assistant_talk", "loose_ends", "standup"] };
    expect((await runBrendaTool(ctx, "follow_up", { people: ["Ben"] }, "chat", { act })).out).toEqual({ error: PERSONAL_OFF("Follow-ups") });
    expect((await runBrendaTool(ctx, "pass_message", { to: "Ben", body: "hi" }, "chat", { act })).out).toEqual({ error: PERSONAL_OFF("Messages and requests between assistants") });
    expect((await runBrendaTool(ctx, "loose_ends", {}, "chat", { act })).out).toEqual({ error: PERSONAL_OFF("Loose ends") });
    expect((await runBrendaTool(ctx, "standup", {}, "chat", { act })).out).toEqual({ error: PERSONAL_OFF("Standup") });
    // The workspace wins when both are off.
    st.abilities = { ready: true, workspaceOff: ["standup"], personalOff: ["standup"] };
    expect((await runBrendaTool(ctx, "standup_action", { entryId: ROUTINE, action: "skip" }, "chat", { act })).out).toEqual({ error: WORKSPACE_OFF("Standup") });
  });

  it("before migration 0050 (nothing read) everything is on", async () => {
    st.abilities = { ready: false, workspaceOff: [], personalOff: [] };
    const out = (await runBrendaTool(ctx, "loose_ends", {}, "chat", { act })).out as { error?: string };
    expect(out.error ?? "").not.toMatch(/switched off/);
  });

  it("at a Confirm press too: the ability is read again", async () => {
    const p = prepareConfirm(ctx, "mark_read", { conversationIds: ["00000000-0000-4000-8000-0000000000c1"] }, "Mark #design as read", undefined, { thread: false });
    if ("error" in p) throw new Error(p.error);
    st.abilities = { ready: true, workspaceOff: [], personalOff: ["catch_up"] };
    const r = await confirmAction(ctx, p.token);
    expect(r).toEqual({ actions: [], error: PERSONAL_OFF("Catch-up") });
    // Nothing was claimed: pressing again after switching it back on still works.
    expect(st.claims.size).toBe(0);
  });

  it("cleaning up routines stays allowed: listing, pausing and deleting", async () => {
    st.abilities = { ready: true, workspaceOff: ["routines"], personalOff: [] };
    expect((await runBrendaTool(ctx, "list_routines", {}, "chat", { act })).out).toEqual({ error: ROUTINES_NOT_READY });
    for (const action of ["pause", "delete"]) expect((await runBrendaTool(ctx, "update_routine", { routineId: ROUTINE, action }, "chat", { act })).out, action).toEqual({ error: ROUTINES_NOT_READY });
    for (const action of ["turn_on", "change"]) expect((await runBrendaTool(ctx, "update_routine", { routineId: ROUTINE, action }, "chat", { act })).out, action).toEqual({ error: WORKSPACE_OFF("Routines") });
    expect((await runBrendaTool(ctx, "create_routine", { template: "still_owed", cadence: "daily", time: "16:00" }, "chat", { act })).out).toEqual({ error: WORKSPACE_OFF("Routines") });
  });
});

describe("the built-in helper", () => {
  const ask = (text: string) => chatBuiltin(ctx, [{ role: "user", content: text }]);

  it("'what can you do?' lists the catalogue, then what is switched off and where to switch it on", async () => {
    st.abilities = { ready: true, workspaceOff: ["voice"], personalOff: ["catch_up"] };
    const r = await ask("What can you do?");
    expect(r.reply.startsWith("Here's what I can do for you:\n\n- **Loose ends**: Max finds promises you made")).toBe(true);
    expect(r.reply).toContain("- **Commitments**: Brenda notes promises and agreed asks in group chats");
    expect(r.reply).toContain(`**Switched off**\n- **Catch-up**: ${PERSONAL_OFF("Catch-up")}\n- **Voice**: ${WORKSPACE_OFF("Voice")}`);
    expect(r.proposals).toEqual([{ kind: "open", href: "/app/acme/settings?section=assistant#abilities", label: "Settings" }]);
    expect(ABILITIES_ASK.test("what are your abilities")).toBe(true);
    expect(ABILITIES_ASK.test("what can you tell me about Ben")).toBe(false);
  });

  it("'what can you do?' lists an ability its own existing switch keeps off under Switched off, as Settings shows it", async () => {
    st.abilities = { ready: true, workspaceOff: [], personalOff: [] };
    st.view = { cards: [
      { key: "commitments", effective: false, state: "Off until an owner or HR turns it on", workspace: { kind: "existing", on: false, label: "", href: "" }, personal: { kind: "none", label: "" } },
      { key: "mentions", effective: false, state: "Off for this workspace", workspace: { kind: "existing", on: false, label: "", href: "" }, personal: { kind: "none", label: "" } },
    ] };
    try {
      const r = await ask("What can you do?");
      expect(r.reply).not.toContain("- **Commitments**: Brenda notes promises");
      expect(r.reply).toContain("**Switched off**\n");
      expect(r.reply).toContain("- **Commitments**: Off until an owner or HR turns it on. An owner or HR can switch it on in Settings → Brenda → Commitments in group chats.");
      expect(r.reply).toContain("- **@mentions in Messages**: Off for this workspace.");
    } finally { st.view = null; }
  });

  it("answers a catch-up question with the reason when catch-up is off", async () => {
    st.abilities = { ready: true, workspaceOff: ["catch_up"], personalOff: [] };
    const r = await ask("What did I miss?");
    expect(r.reply).toBe(WORKSPACE_OFF("Catch-up"));
    expect(r.proposals).toEqual([]);
  });
});
