/**
 * Brenda for Mac, phase 3: the person's own Mac state and "Set up on my Mac", the pure parts (owner report, 12 October
 * 2026: "when I turned this setting on, I stopped seeing my Brenda"; owner request the same day: the person sees what is
 * on, the employer still sees nothing; contract 0b.2, 0b.3, A.5, A.6, G.3, K.2). The state's exact shape (unknown fields
 * and values fail), how one Mac's report joins the list (five, newest first, replaced, not rewritten within ten seconds),
 * the card's join with the person's live Macs, and when a Set up press is fresh.
 */
import { describe, expect, it } from "vitest";
import { MAC_REPORTS_MAX, SETUP_FRESH_MINUTES, macReportBodySchema, macStateSchema, type MacState } from "@/lib/screen-help";
import { freshSetupAt, macsForCard, mergeMacReports, storedMacsOf, type StoredMac } from "@/server/services/screen-help";

const state = (o: Partial<MacState> = {}): MacState => ({
  v: 1, binary: 2, supported: true,
  look: { on: true, permission: "granted" },
  mac: { on: false, accessibility: "unknown" },
  files: { on: false, finder: "unknown", folders: null },
  companion: { on: true, shown: null, why: null },
  preview: false,
  ...o,
});
const T0 = Date.parse("2026-10-12T09:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

describe("macStateSchema (contract A.6, G.3): exact", () => {
  it("today's binary (nulls) and this build's (folders, the companion's reason)", () => {
    expect(macStateSchema.parse(state())).toEqual(state());
    const v3 = state({ binary: 3, files: { on: true, finder: "granted", folders: { documents: "granted", desktop: "denied", downloads: "unknown" } }, companion: { on: true, shown: false, why: "screen_help_off" } });
    expect(macStateSchema.parse(v3)).toEqual(v3);
  });
  it.each([
    ["an unknown field", { ...state(), extra: 1 }],
    ["an unknown permission", state({ look: { on: true, permission: "maybe" as never } })],
    ["an unknown reason", state({ companion: { on: true, shown: false, why: "asleep" as never } })],
    ["a path in a folder", state({ files: { on: true, finder: "granted", folders: { documents: "granted", desktop: "granted", downloads: "granted", "/Users/x": "granted" } as never } })],
    ["version 2", { ...state(), v: 2 }],
    ["no companion", { ...state(), companion: undefined }],
  ])("refuses %s", (_, v) => { expect(macStateSchema.safeParse(v).success).toBe(false); });
  it("the body: version 1, the state, setupSeen an ISO time or null", () => {
    expect(macReportBodySchema.safeParse({ version: 1, state: state(), setupSeen: null }).success).toBe(true);
    expect(macReportBodySchema.safeParse({ version: 1, state: state(), setupSeen: "2026-10-12T09:00:00.000Z" }).success).toBe(true);
    expect(macReportBodySchema.safeParse({ version: 1, state: state(), setupSeen: "yesterday" }).success).toBe(false);
    expect(macReportBodySchema.safeParse({ version: 1, state: state(), setupSeen: null, device: "x" }).success).toBe(false);
  });
});

describe("mergeMacReports (contract K.2)", () => {
  const S1 = "00000000-0000-4000-8000-000000000001";
  it("a new Mac goes first; the same Mac is replaced; at most five, newest first", () => {
    let list: StoredMac[] = [];
    for (let i = 0; i < 7; i++) list = mergeMacReports(list, { session: `s${i}`, state: state(), setupSeen: null }, { now: T0 + i * 1000, setupAt: null })!;
    expect(list.map((m) => m.session)).toEqual(["s6", "s5", "s4", "s3", "s2"]);
    expect(list).toHaveLength(MAC_REPORTS_MAX);
    const again = mergeMacReports(list, { session: "s3", state: state({ preview: true }), setupSeen: null }, { now: T0 + 60_000, setupAt: null })!;
    expect(again.map((m) => m.session)).toEqual(["s3", "s6", "s5", "s4", "s2"]);
    expect(again[0]).toEqual({ session: "s3", at: at(60_000), state: state({ preview: true }), setupSeenAt: null });
  });
  it("the same state within ten seconds is not written; after ten seconds it is (a fresh check-in)", () => {
    const list = mergeMacReports([], { session: S1, state: state(), setupSeen: null }, { now: T0, setupAt: null })!;
    expect(mergeMacReports(list, { session: S1, state: state(), setupSeen: null }, { now: T0 + 9_999, setupAt: null })).toBeNull();
    expect(mergeMacReports(list, { session: S1, state: state(), setupSeen: null }, { now: T0 + 10_000, setupAt: null })).not.toBeNull();
    expect(mergeMacReports(list, { session: S1, state: state({ preview: true }), setupSeen: null }, { now: T0 + 1, setupAt: null })).not.toBeNull();
  });
  it("setupSeen counts only when it is the stored Set up, to the millisecond; otherwise the last one stays", () => {
    const setupAt = at(-60_000);
    const a = mergeMacReports([], { session: S1, state: state(), setupSeen: "2026-10-12T08:59:00.000+00:00" }, { now: T0, setupAt })!;
    expect(a[0].setupSeenAt).toBe(setupAt);
    const b = mergeMacReports(a, { session: S1, state: state(), setupSeen: at(-59_999) }, { now: T0 + 20_000, setupAt })!;
    expect(b[0].setupSeenAt).toBe(setupAt);
    const c = mergeMacReports([], { session: S1, state: state(), setupSeen: at(-59_999) }, { now: T0, setupAt })!;
    expect(c[0].setupSeenAt).toBeNull();
    // A newly seen Set up is written even within ten seconds of the last report.
    const d = mergeMacReports(c, { session: S1, state: state(), setupSeen: setupAt }, { now: T0 + 1_000, setupAt });
    expect(d?.[0].setupSeenAt).toBe(setupAt);
  });
  it("storedMacsOf reads defensively: a state that no longer parses is left out", () => {
    expect(storedMacsOf([{ session: "a", at: at(0), state: state(), setupSeenAt: null }, { session: "b", at: at(0), state: { v: 9 } }, "x", null])).toEqual([{ session: "a", at: at(0), state: state(), setupSeenAt: null }]);
    expect(storedMacsOf({})).toEqual([]);
  });
});

describe("macsForCard (contract A.5, K.2)", () => {
  it("joins reports with live sessions (names, last seen), newest report first; gone sessions drop; linked Macs without a report listed", () => {
    const stored: StoredMac[] = [
      { session: "a", at: at(1_000), state: state(), setupSeenAt: null },
      { session: "gone", at: at(5_000), state: state(), setupSeenAt: null },
      { session: "b", at: at(3_000), state: state({ preview: true }), setupSeenAt: at(0) },
    ];
    const devices = [
      { id: "a", device_name: "Studio", last_seen_at: at(9_000) },
      { id: "b", device_name: " ", last_seen_at: null },
      { id: "c", device_name: "Air", last_seen_at: at(2_000) },
    ];
    expect(macsForCard(stored, devices)).toEqual({
      macs: [
        { device: "Mac", lastSeenAt: null, reportedAt: at(3_000), state: state({ preview: true }), setupSeenAt: at(0) },
        { device: "Studio", lastSeenAt: at(9_000), reportedAt: at(1_000), state: state(), setupSeenAt: null },
      ],
      linked: [{ device: "Air", lastSeenAt: at(2_000) }],
    });
  });
});

describe("freshSetupAt (contract 0b.3): 15 minutes, never while impersonated", () => {
  it.each([
    [0, false, true], [SETUP_FRESH_MINUTES * 60_000, false, true], [SETUP_FRESH_MINUTES * 60_000 + 1, false, false], [-30_000, false, true], [-120_000, false, false], [0, true, false],
  ])("%i ms old, impersonated %s → fresh %s", (age, impersonated, fresh) => {
    expect(freshSetupAt(at(0), { impersonated, now: T0 + age })).toBe(fresh ? at(0) : null);
  });
  it("none, or not a time", () => {
    expect(freshSetupAt(null, { impersonated: false })).toBeNull();
    expect(freshSetupAt("nope", { impersonated: false })).toBeNull();
  });
});
