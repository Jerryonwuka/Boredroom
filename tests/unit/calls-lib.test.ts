/**
 * Calls' shared words and limits (owner decisions, 8 October 2026: phase 8, calls). CALL_LIMITS must match the numbers
 * migration 0054's SQL uses (the ring's 30 seconds, a device's 45 seconds, the 4-hour cap, 15 minutes alone, 50 people):
 * read straight from the file, so a change on one side only fails here. Plus the duration words and the live clock, and
 * no middle dot in anything a person reads.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CALL_LIMITS, CALL_WORDS, callClock, callDurationLabel, callHref, ringExpiresAt } from "@/lib/calls";

const SQL = readFileSync(join(process.cwd(), "db", "migrations", "0054_calls.sql"), "utf8");

describe("CALL_LIMITS match migration 0054", () => {
  it("the ring's 30 seconds", () => {
    expect(CALL_LIMITS.ringMs).toBe(30_000);
    expect(SQL).toContain("rang_at <= at_time - interval '30 seconds'");
  });
  it("a device silent for 45 seconds has left, and a join gives it 45 seconds more (90 to connect)", () => {
    expect(CALL_LIMITS.staleMs).toBe(45_000);
    expect(CALL_LIMITS.connectGraceMs).toBe(90_000);
    expect(SQL).toContain("last_seen_at < at_time - interval '45 seconds'");
    expect(SQL).toContain("now() + interval '45 seconds'");
    expect(CALL_LIMITS.heartbeatMs).toBeLessThan(CALL_LIMITS.staleMs);
  });
  it("the 4-hour cap", () => {
    expect(CALL_LIMITS.maxCallMs).toBe(4 * 3_600_000);
    expect(SQL).toContain("k.created_at <= at_time - interval '4 hours'");
  });
  it("15 minutes alone", () => {
    expect(CALL_LIMITS.aloneMs).toBe(15 * 60_000);
    expect(SQL).toContain("<= at_time - interval '15 minutes' THEN reason := 'alone'");
  });
  it("50 people", () => {
    expect(CALL_LIMITS.maxParticipants).toBe(50);
    expect(CALL_LIMITS.ringGroupMax).toBe(50);
    expect(SQL).toContain("IF others >= 50 THEN RETURN jsonb_build_object('word', 'full')");
    expect(SQL).toContain("IF cardinality(rung) > 50 THEN RETURN jsonb_build_object('word', 'too_many')");
  });
  it("a join token lasts 2 minutes, and its two forms agree (fix review, 10 October 2026: LiveKit cannot revoke one)", () => {
    expect(CALL_LIMITS.tokenTtl).toBe("2m");
    expect(CALL_LIMITS.tokenTtlMs).toBe(2 * 60_000);
    expect(CALL_LIMITS.reconcileEveryMs).toBe(CALL_LIMITS.heartbeatMs);
    expect(SQL).toMatch(/reconciled_at\s+timestamptz/);
  });
  it("who is on a call follows who reads its conversation (fix review, 10 October 2026)", () => {
    // Joining, beating, ending, notes and lines all ask; a settle takes out whoever no longer reads it.
    const fn = (name: string) => SQL.slice(SQL.indexOf(`FUNCTION ${name}(`), SQL.indexOf("END $$;", SQL.indexOf(`FUNCTION ${name}(`)));
    for (const name of ["app_call_join", "app_call_heartbeat", "app_call_end", "app_call_set_notes", "app_call_add_lines"]) {
      expect(fn(name), name).toContain("app_can_read_conversation(k.conversation_id)");
    }
    expect(fn("app_call_settle_at")).toContain("NOT app_member_can_read_conversation(membership_id, k.conversation_id)");
  });
  it("polling stays inside its bounds", () => {
    const p = CALL_LIMITS.pollMs;
    for (const v of [p.idle, p.ringing, p.notReady]) {
      expect(v).toBeGreaterThanOrEqual(p.min);
      expect(v).toBeLessThanOrEqual(p.max);
    }
  });
});

describe("words and helpers", () => {
  it("durations in plain words", () => {
    expect(callDurationLabel(null)).toBe("under a minute");
    expect(callDurationLabel(Number.NaN)).toBe("under a minute");
    expect(callDurationLabel(59)).toBe("under a minute");
    expect(callDurationLabel(60)).toBe("1 min");
    expect(callDurationLabel(12 * 60 + 30)).toBe("12 min");
    expect(callDurationLabel(3600)).toBe("1 h");
    expect(callDurationLabel(3600 + 5 * 60)).toBe("1 h 5 min");
  });
  it("the live clock", () => {
    expect(callClock(0)).toBe("0:00");
    expect(callClock(42)).toBe("0:42");
    expect(callClock(12 * 60 + 4)).toBe("12:04");
    expect(callClock(3600 + 2 * 60 + 9)).toBe("1:02:09");
    expect(callClock(-5)).toBe("0:00");
  });
  it("links and the ring's end", () => {
    expect(callHref("company-a", "abc")).toBe("/app/company-a/calls/abc");
    expect(ringExpiresAt("2026-10-10T12:00:00.000Z")).toBe("2026-10-10T12:00:30.000Z");
  });
  it("first names where the words say so", () => {
    expect(CALL_WORDS.callPerson("Ada Obi")).toBe("Call Ada");
    expect(CALL_WORDS.thread.missed("Ada Obi")).toBe("Missed call from Ada");
    expect(CALL_WORDS.thread.declined("Ada Obi")).toBe("Declined call from Ada");
    expect(CALL_WORDS.thread.done(12 * 60)).toBe("Call, 12 min");
    expect(CALL_WORDS.thread.endedGroup(3600, 1)).toBe("Call ended, 1 h, 1 person");
    expect(CALL_WORDS.notifications.missed("Ada Obi", "#Design")).toBe("Missed call from Ada Obi in #Design");
    expect(CALL_WORDS.notifications.missed("Ada Obi", null)).toBe("Missed call from Ada Obi");
  });
  it("no middle dot anywhere a person reads", () => {
    const strings: string[] = [];
    // Functions are called with a name and a number, or with a list of names (`stage.onTheCall`) when that throws.
    const call = (f: (...a: unknown[]) => unknown) => { try { return f("Ada Obi", 2); } catch { return f(["Ada Obi", "Ben Okafor"], 2); } };
    const walk = (v: unknown) => {
      if (typeof v === "string") strings.push(v);
      else if (typeof v === "function") strings.push(String(call(v as (...a: unknown[]) => unknown)));
      else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x);
    };
    walk(CALL_WORDS);
    expect(strings.length).toBeGreaterThan(50);
    for (const s of strings) expect(s).not.toContain("·");
  });
});
