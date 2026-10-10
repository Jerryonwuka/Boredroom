// Incoming calls' own sound switch (owner decision, 10 October 2026: "incoming calls get their own sound setting,
// separate from Brenda's sound effects, default on"; fix review the same day: muting Brenda's chimes silenced the ring
// too). src/lib/brenda-sound.ts with a fake Web Audio context and storage: no sound is ever played.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let notes = 0;
const param = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
class FakeAudio {
  state = "running";
  currentTime = 0;
  destination = {};
  createGain() { return { gain: param, connect() {} }; }
  createOscillator() { notes++; return { type: "sine", frequency: param, connect() {}, start() {}, stop() {} }; }
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
}

beforeEach(() => {
  notes = 0;
  const store = new Map<string, string>();
  const target = new EventTarget();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  vi.stubGlobal("window", Object.assign(target, { AudioContext: FakeAudio }));
  vi.resetModules();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("the incoming-call sound", () => {
  it("is on by default, and Brenda's chimes switch does not silence it", async () => {
    const s = await import("@/lib/brenda-sound");
    expect(s.callRingOff()).toBe(false);
    s.setSoundsMuted(true);
    s.playSound("reply");
    expect(notes).toBe(0);
    s.playCallSound("ring");
    expect(notes).toBeGreaterThan(0);
  });

  it("has its own switch: off stops the ring and the second-call note, never the hang-up, and tells every listener", async () => {
    const s = await import("@/lib/brenda-sound");
    const heard = vi.fn();
    const stop = s.subscribeCallRing(heard);
    s.setCallRingOff(true);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(s.callRingOff()).toBe(true);
    s.playCallSound("ring");
    s.playCallSound("attention");
    expect(notes).toBe(0);
    s.playCallSound("hangup");
    expect(notes).toBe(1);
    // Brenda's chimes stay as they were.
    expect(s.soundsMuted()).toBe(false);
    s.setCallRingOff(false);
    expect(s.callRingOff()).toBe(false);
    stop();
    s.setCallRingOff(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
