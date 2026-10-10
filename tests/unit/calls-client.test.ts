// Calls in the browser (owner decisions, 8 October 2026: phase 8, calls; contract D.11): the pure rules the call screens
// share (src/lib/calls-client.ts): the tiles' grid per count and its pages, where the incoming-call card goes, which tab
// rings, the ring's 30 seconds, the assistant-colour ring, the clock and durations from src/lib/calls.ts, the words a
// failed request shows, the tiles' accessible names and the connection's bars. No network, no LiveKit.
import { describe, expect, it } from "vitest";
import { ApiFailure } from "@/lib/api-client";
import { PALETTE } from "@/lib/assistant-look";
import { CALL_LIMITS, CALL_WORDS, callClock, callDurationLabel, type CallWhere } from "@/lib/calls";
import {
  assistantRingColour, callElapsedSeconds, callErrorWords, callTitle, callWhen, escSilencesRing, gridShape, isRingShortcut, messageCounter, onCallWith,
  otherCallOf, overlayPlacement, pageOf, qualityBars, readStamp, ringLines, ringStillDue, shouldThisTabRing, skewOf, startedWhen, tileLabel,
} from "@/lib/calls-client";

const fail = (status: number, code: string, message = "server words", details?: Record<string, unknown>) => new ApiFailure({ status, code, message, details });

describe("grid", () => {
  it("1 fills, 2 side by side (stacked on a phone), 3-4 two by two, 5-9 three by three, more 9 a page", () => {
    expect(gridShape(1)).toEqual({ cols: 1, rows: 1, perPage: 1, pages: 1 });
    expect(gridShape(2)).toMatchObject({ cols: 2, rows: 1 });
    expect(gridShape(2, true)).toMatchObject({ cols: 1, rows: 2 });
    for (const n of [3, 4]) expect(gridShape(n)).toMatchObject({ cols: 2, rows: 2, pages: 1 });
    for (const n of [5, 7, 9]) expect(gridShape(n)).toMatchObject({ cols: 3, rows: 3, pages: 1 });
    expect(gridShape(10)).toMatchObject({ cols: 3, perPage: 9, pages: 2 });
    expect(gridShape(50)).toMatchObject({ pages: 6 });
    expect(gridShape(0)).toMatchObject({ cols: 1 });
  });
  it("pages clamp", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    expect(pageOf(xs, 0, 9).items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(pageOf(xs, 2, 9)).toMatchObject({ items: [18, 19], page: 2, pages: 3 });
    expect(pageOf(xs, 9, 9).page).toBe(2);
    expect(pageOf(xs, -1, 9).page).toBe(0);
    expect(pageOf([], 0, 9)).toMatchObject({ items: [], pages: 1 });
  });
});

describe("the incoming-call card's place", () => {
  it("top right on a wide screen, the bottom on a phone, inside an open dialog", () => {
    expect(overlayPlacement(1280, false)).toEqual({ edge: "corner", host: "body" });
    expect(overlayPlacement(641, false).edge).toBe("corner");
    expect(overlayPlacement(640, false).edge).toBe("bottom");
    expect(overlayPlacement(400, true)).toEqual({ edge: "bottom", host: "dialog" });
  });
  it("its lines", () => {
    const where: CallWhere = { conversationId: "c", kind: "team", name: "#Design", href: null };
    expect(ringLines({ kind: "direct", where: { ...where, kind: "direct", name: "Ada Lovelace" }, inAnotherCall: false })).toEqual(["Call"]);
    expect(ringLines({ kind: "group", where, inAnotherCall: true })).toEqual(["Call in #Design", CALL_WORDS.incoming.waiting]);
    expect(ringLines({ kind: "group", where: { ...where, name: null }, inAnotherCall: false })).toEqual(["Call"]);
  });
  it("the quick message's counter from 240 characters", () => {
    expect(messageCounter("x".repeat(239))).toBeNull();
    expect(messageCounter("x".repeat(240))).toBe(`240 of ${CALL_LIMITS.declineMessageMax}`);
  });
});

describe("which tab rings", () => {
  const now = 1_000_000;
  it("the tab in view always rings", () => {
    expect(shouldThisTabRing({ visible: true, tab: "a", stamp: { tab: "b", at: now }, now })).toBe(true);
  });
  it("a hidden tab rings only when it was in view last, or nobody stamped lately", () => {
    expect(shouldThisTabRing({ visible: false, tab: "a", stamp: { tab: "a", at: now - 5_000 }, now })).toBe(true);
    expect(shouldThisTabRing({ visible: false, tab: "a", stamp: { tab: "b", at: now - 1_000 }, now })).toBe(false);
    expect(shouldThisTabRing({ visible: false, tab: "a", stamp: { tab: "b", at: now - 61_000 }, now })).toBe(true);
    expect(shouldThisTabRing({ visible: false, tab: "a", stamp: null, now })).toBe(true);
  });
  it("reads stamps, old and broken ones too", () => {
    expect(readStamp(JSON.stringify({ tab: "x", at: 5 }))).toEqual({ tab: "x", at: 5 });
    expect(readStamp("12345")).toEqual({ tab: "", at: 12345 });
    expect(readStamp("{bad")).toBeNull();
    expect(readStamp(null)).toBeNull();
  });
  it("the ring lasts its 30 seconds on the server's clock", () => {
    const rang = new Date(now).toISOString();
    expect(ringStillDue(rang, now + 29_000)).toBe(true);
    expect(ringStillDue(rang, now + 30_000)).toBe(false);
    expect(ringStillDue(rang, now + 25_000, 6_000)).toBe(false);
    expect(ringStillDue("not a date", now)).toBe(false);
  });
});

describe("faces and tiles", () => {
  it("the ring is the assistant's colour; White uses its rim", () => {
    expect(assistantRingColour({ colour: "orange" })).toBe(PALETTE.orange.sphere.mid);
    expect(assistantRingColour({ colour: "white" })).toBe(PALETTE.white.sphere.rim);
    expect(assistantRingColour(null)).toBe(PALETTE.white.sphere.rim);
  });
  it("a tile's accessible name says it all", () => {
    expect(tileLabel({ name: "Ada", micOn: false, cameraOn: false, speaking: true })).toBe("Ada, microphone off, camera off, speaking");
    expect(tileLabel({ name: "Ben", you: true, micOn: true, cameraOn: true, sharing: true })).toBe("Ben (you), microphone on, camera on, sharing their screen");
  });
  it("connection bars with words", () => {
    expect(qualityBars("excellent")).toEqual({ lit: 3, words: CALL_WORDS.quality.excellent });
    expect(qualityBars("poor").lit).toBe(1);
    expect(qualityBars("lost")).toEqual({ lit: 0, words: CALL_WORDS.quality.lost });
    expect(qualityBars(undefined).words).toBe(CALL_WORDS.quality.unknown);
  });
});

describe("time", () => {
  it("the clock and durations (src/lib/calls.ts)", () => {
    expect(callClock(42)).toBe("0:42");
    expect(callClock(12 * 60 + 4)).toBe("12:04");
    expect(callClock(3600 + 2 * 60 + 9)).toBe("1:02:09");
    expect(callClock(-5)).toBe("0:00");
    expect(callDurationLabel(null)).toBe("under a minute");
    expect(callDurationLabel(59)).toBe("under a minute");
    expect(callDurationLabel(12 * 60)).toBe("12 min");
    expect(callDurationLabel(3600)).toBe("1 h");
    expect(callDurationLabel(3900)).toBe("1 h 5 min");
  });
  it("elapsed time on the server's clock", () => {
    const from = new Date(1_000_000).toISOString();
    expect(callElapsedSeconds(from, 1_000_000 + 61_500)).toBe(61);
    expect(callElapsedSeconds(from, 1_000_000, 10_000)).toBe(10);
    expect(callElapsedSeconds(null, 5)).toBe(0);
    expect(callElapsedSeconds(from, 0)).toBe(0);
    expect(skewOf(new Date(2_000).toISOString(), 1_000)).toBe(1_000);
    expect(skewOf(null, 1_000)).toBe(0);
  });
  it("when, with commas and never a middle dot", () => {
    const now = new Date("2026-10-10T15:00:00Z");
    expect(callWhen("2026-10-10T14:05:00Z", now, "UTC")).toBe("Today, 14:05");
    expect(callWhen("2026-10-09T09:30:00Z", now, "UTC")).toBe("Yesterday, 09:30");
    expect(callWhen("2026-10-06T16:20:00Z", now, "UTC")).toBe("Tue 6 Oct, 16:20");
    expect(callWhen("2026-10-06T16:20:00Z", now, "UTC")).not.toContain("·");
  });
});

describe("words", () => {
  it("titles", () => {
    expect(callTitle({ conversationId: "c", kind: "direct", name: "Ada Lovelace", href: null })).toBe("Call with Ada Lovelace");
    expect(callTitle({ conversationId: "c", kind: "team", name: "#Design", href: null })).toBe("#Design call");
    expect(onCallWith({ conversationId: "c", kind: "channel", name: "#Launch", href: null })).toBe("On a call in #Launch");
    expect(onCallWith({ conversationId: "c", kind: "direct", name: null, href: null })).toBe("On a call");
  });
  it("a failed request says the contract's words", () => {
    expect(callErrorWords(fail(503, "NOT_READY"))).toBe(CALL_WORDS.notReady);
    expect(callErrorWords(fail(503, "CALLS_NOT_CONFIGURED"))).toBe(CALL_WORDS.notConfigured);
    expect(callErrorWords(fail(409, "CALL_FULL"))).toBe(CALL_WORDS.errors.full);
    expect(callErrorWords(fail(409, "IN_ANOTHER_CALL"))).toBe(CALL_WORDS.errors.inAnotherCall);
    expect(callErrorWords(fail(429, "RATE_LIMITED", CALL_WORDS.errors.rateLimited))).toBe(CALL_WORDS.errors.rateLimited);
    expect(callErrorWords(new Error("Network error: offline"))).toMatch(/Can't reach the server/);
  });
  it("the other call named by a 409", () => {
    const where: CallWhere = { conversationId: "c", kind: "team", name: "#Design", href: "/x" };
    expect(otherCallOf(fail(409, "IN_ANOTHER_CALL", "x", { callId: "abc", where }))).toEqual({ callId: "abc", where });
    expect(otherCallOf(fail(409, "CALL_FULL", "x", { callId: "abc" }))).toBeNull();
    expect(otherCallOf(new Error("x"))).toBeNull();
  });
});

// Fix review, 10 October 2026 (the design findings): reaching Accept from the keyboard, what Esc silences, "Started …"
// in sentence case, the pre-join line, the buttons' full names.
describe("fix review: the incoming card's keys", () => {
  const keys = { altKey: true, shiftKey: true, ctrlKey: false, metaKey: false };
  it("Alt+Shift+A moves the focus to Accept, on any layout (the key's position), and nothing else does", () => {
    expect(isRingShortcut({ ...keys, code: "KeyA", key: "Å" })).toBe(true);
    expect(isRingShortcut({ ...keys, key: "A" })).toBe(true);
    expect(isRingShortcut({ ...keys, shiftKey: false, code: "KeyA" })).toBe(false);
    expect(isRingShortcut({ ...keys, ctrlKey: true, code: "KeyA" })).toBe(false);
    expect(isRingShortcut({ ...keys, metaKey: true, code: "KeyA" })).toBe(false);
    expect(isRingShortcut({ ...keys, code: "KeyS", key: "S" })).toBe(false);
    expect(CALL_WORDS.incoming.announce("Ada")).toBe("Ada is calling. Press Alt Shift A, then Enter, to answer.");
  });
  it("Esc silences the ring only when it is meant for the card, never a menu's, a dialog's or a field's", () => {
    const quiet = { defaultPrevented: false, inCard: false, openElsewhere: false, editable: false };
    expect(escSilencesRing(quiet)).toBe(true);
    expect(escSilencesRing({ ...quiet, inCard: true, defaultPrevented: true, editable: true })).toBe(true);
    expect(escSilencesRing({ ...quiet, defaultPrevented: true })).toBe(false);
    expect(escSilencesRing({ ...quiet, openElsewhere: true })).toBe(false);
    expect(escSilencesRing({ ...quiet, editable: true })).toBe(false);
  });
});

describe("fix review: words", () => {
  it("Happening now says when in the organisation's zone, in sentence case", () => {
    const now = new Date("2026-10-10T15:00:00Z");
    expect(startedWhen("2026-10-10T14:05:00Z", now, "UTC")).toBe("14:05");
    expect(startedWhen("2026-10-09T23:50:00Z", now, "UTC")).toBe("yesterday, 23:50");
    expect(startedWhen("2026-10-10T14:05:00Z", now, "Africa/Lagos")).toBe("15:05");
    expect(CALL_WORDS.history.started(startedWhen("2026-10-09T23:50:00Z", now, "UTC"), 3)).toBe("Started yesterday, 23:50, 3 people");
  });
  it("the pre-join line never says 'You is in it'", () => {
    expect(CALL_WORDS.stage.inIt([{ firstName: "Ada", you: true }])).toBe("You're in it");
    expect(CALL_WORDS.stage.inIt([{ firstName: "Ada", you: false }])).toBe("Ada is in it");
    expect(CALL_WORDS.stage.inIt([])).toBe(CALL_WORDS.stage.waiting);
    expect(CALL_WORDS.stage.inIt([{ firstName: "Ada", you: false }, { firstName: "Ben", you: true }])).toBe("2 people");
  });
  it("every row's button says who or where it calls", () => {
    expect(CALL_WORDS.names.callBack("Ada Obi")).toBe("Call back Ada");
    expect(CALL_WORDS.names.callAgainWith("Ada Obi")).toBe("Call again with Ada");
    expect(CALL_WORDS.names.callAgainIn("#Design")).toBe("Call again in #Design");
    expect(CALL_WORDS.names.join({ kind: "team", name: "#Design" }, 3)).toBe("Join the call in #Design, 3 people in it");
    expect(CALL_WORDS.names.join({ kind: "direct", name: "Ada" }, 1)).not.toContain("(");
  });
  it("end reasons and starting a call while on another say what happened", () => {
    expect(CALL_WORDS.stage.endReasons.alone).toBe("Ended after 15 minutes with only one person on it");
    expect(CALL_WORDS.stage.leaveAndStart("#Design")).toBe("You're on a call in #Design. Leave it and start this one?");
    expect(CALL_WORDS.onCall).toBe("on a call");
  });
});
