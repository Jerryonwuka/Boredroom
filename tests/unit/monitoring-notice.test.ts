import { describe, expect, it } from "vitest";
import { DEFAULT_NOTICE, PREVIOUS_DEFAULT_NOTICE, noticeMentionsScreenRecording } from "@/server/services/orgs";

// The monitoring notice's Settings alert (owner decisions, 8 October 2026: phase 8, D12; fix review, 10 October 2026):
// owners and HR are told only while their notice still describes screen recording as something Boredroom does. The new
// standard notice says screens are NOT recorded, and was itself flagged, so the warning never went away. Pure.

describe("noticeMentionsScreenRecording", () => {
  it("never flags the new standard notice, however its spacing came back", () => {
    expect(noticeMentionsScreenRecording(DEFAULT_NOTICE)).toBe(false);
    expect(noticeMentionsScreenRecording(`  ${DEFAULT_NOTICE.replace(/\n/g, "\r\n")}\n`)).toBe(false);
    // Edited a little elsewhere: still only says screens are not recorded.
    expect(noticeMentionsScreenRecording(DEFAULT_NOTICE.replace("Timers only run when you start them.", "Timers run only when you start them."))).toBe(false);
  });

  it("flags the old standard notice, also once someone edited it", () => {
    expect(noticeMentionsScreenRecording(PREVIOUS_DEFAULT_NOTICE)).toBe(true);
    expect(noticeMentionsScreenRecording(PREVIOUS_DEFAULT_NOTICE.replace("after the retention period", "after 14 days"))).toBe(true);
    expect(noticeMentionsScreenRecording(PREVIOUS_DEFAULT_NOTICE.replace(/Recordings are deleted automatically after the retention period\. /, ""))).toBe(true);
  });

  it.each([
    "Screen recording is optional.",
    "Screen recording is on for design tasks.",
    "We record your screen while your timer runs.",
    "We record your screen while your timer runs, but never your audio.",
    "Your screen is recorded while you work.",
    "Recordings are deleted after 30 days.",
    "Press “Record screen” to start.",
    'Press "Record screen" to share a window.',
    "Managers can watch screen recordings of your tasks.",
  ])("flags words that describe recording as happening: %s", (text) => {
    expect(noticeMentionsScreenRecording(text)).toBe(true);
  });

  it.each([
    "We do not record your screen.",
    "We don't use screen recording.",
    "Boredroom never records screens or calls.",
    "There is no screen recording.",
    "Screen recording has been removed.",
    "Screen recording is switched off for this workspace.",
    "Screens and calls are never recorded.",
    "Your screen is not recorded, and calls aren't either.",
    "Nothing about your screen is recorded.",
    "We stopped recording screens in October.",
    "Calls are never recorded, and Brenda only takes notes with consent.",
    "Boredroom records the tasks you plan and the timers you start.",
  ])("does not flag a notice that says it doesn't happen, or never mentions it: %s", (text) => {
    expect(noticeMentionsScreenRecording(text)).toBe(false);
  });

  it("reads each clause on its own: a denial in one never hides a description in another", () => {
    expect(noticeMentionsScreenRecording("Calls are never recorded. Screen recording is optional on design tasks.")).toBe(true);
    expect(noticeMentionsScreenRecording("We never record calls; we record your screen while your timer runs.")).toBe(true);
    expect(noticeMentionsScreenRecording("We do not record your screen, and calls are never recorded.")).toBe(false);
  });

  it("is false for nothing at all", () => {
    for (const t of [null, undefined, "", "   "]) expect(noticeMentionsScreenRecording(t)).toBe(false);
  });
});
