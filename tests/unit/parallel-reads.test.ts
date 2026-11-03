import { describe, it, expect, vi } from "vitest";

// Parallel lookups (owner decision, 3 November 2026: "parallel helpers", part 1): reads asked for together in one turn run
// at the same time; anything that acts runs alone and in order. The pure parts: which tools may, and the batches.

vi.mock("@/server/db", () => {
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withUser: refuse, withSystem: refuse, withWorker: refuse };
});

import { ACTION_TOOLS, ALWAYS_CONFIRM, IMMEDIATE_TOOLS, PARALLEL_READS, PARALLEL_READS_MAX, TOOLS, readBatches } from "@/server/services/copilot";

describe("PARALLEL_READS", () => {
  it("names only real tools, and none that acts, prepares a card, links or starts research", () => {
    const names = new Set((TOOLS as { name: string }[]).map((t) => t.name));
    for (const n of PARALLEL_READS) {
      expect(names.has(n), n).toBe(true);
      expect(ACTION_TOOLS.has(n) || IMMEDIATE_TOOLS.has(n) || ALWAYS_CONFIRM.has(n), n).toBe(false);
    }
    for (const n of ["open_page", "start_research", "research_status", "team_report", "think_harder"]) expect(PARALLEL_READS.has(n)).toBe(false);
  });
});

describe("readBatches", () => {
  it("runs consecutive reads together", () => {
    expect(readBatches(["get_my_day", "list_tasks", "my_calendar"], true)).toEqual([[0, 1, 2]]);
  });

  it("keeps an action alone and in order: the reads before it finish first, the reads after it wait", () => {
    expect(readBatches(["read_conversation", "search_messages", "create_todos", "list_tasks", "get_task"], true)).toEqual([[0, 1], [2], [3, 4]]);
    expect(readBatches(["send_message", "list_tasks"], true)).toEqual([[0], [1]]);
  });

  it("never more than PARALLEL_READS_MAX at once", () => {
    const names = Array.from({ length: PARALLEL_READS_MAX * 2 + 1 }, () => "list_tasks");
    const batches = readBatches(names, true);
    expect(batches.map((b) => b.length)).toEqual([PARALLEL_READS_MAX, PARALLEL_READS_MAX, 1]);
    expect(batches.flat()).toEqual(names.map((_, i) => i));
  });

  it("an unknown or unchecked tool runs alone", () => {
    expect(readBatches(["list_tasks", "open_page", "get_task"], true)).toEqual([[0], [1], [2]]);
  });

  it("not together (a thread, a look, a Confirm press): one call a batch, in order", () => {
    expect(readBatches(["get_my_day", "list_tasks", "my_calendar"], false)).toEqual([[0], [1], [2]]);
  });
});
