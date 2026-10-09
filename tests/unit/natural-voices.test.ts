/**
 * Natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), contract H): the catalogue, the words a
 * speech token covers, the token itself, the daily share and the reasons the person sees. Pure: no database, and no
 * ElevenLabs (nothing here calls it).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NATURAL_VOICES, SPEECH_MAX_CHARS, SPEECH_SPEEDS, isNaturalVoiceId, naturalVoice, speechText } from "@/lib/natural-voices";
import {
  BOREDROOM_KEY_WORKSPACE_DAILY_MAX, BOREDROOM_KEY_WORKSPACE_FRACTION, LOW_ALLOWANCE, PERSON_DAILY_CHARS, SPEECH_TOKEN_TTL_S,
  allowanceLow, dailyShare, daysLeft, naturalVoiceReason, reservationProblem, signSpeechToken, verifySpeechToken, workspaceCap,
  type ReasonInput,
} from "@/server/services/natural-voice";
import { signPayload } from "@/server/lib/crypto";
import { TTS_CREDITS_PER_CHARACTER } from "@/server/services/elevenlabs";

afterEach(() => { vi.useRealTimers(); });

describe("the catalogue", () => {
  it("has eight voices with unique ids that pass the migration's format check", () => {
    expect(NATURAL_VOICES).toHaveLength(8);
    const ids = NATURAL_VOICES.map((v) => v.id);
    expect(new Set(ids).size).toBe(8);
    for (const v of NATURAL_VOICES) {
      expect(v.id).toMatch(/^[A-Za-z0-9]{16,40}$/);
      expect(v.name).toMatch(/^[A-Z][a-z]+$/); // the first name only, never the marketing name
      expect(v.description.length).toBeGreaterThan(10);
      expect(v.description).not.toMatch(/\.$/);
    }
  });

  it("is varied: women and men, British and American", () => {
    const genders = new Set(NATURAL_VOICES.map((v) => v.gender));
    const accents = new Set(NATURAL_VOICES.map((v) => v.accent));
    expect(genders.has("woman") && genders.has("man")).toBe(true);
    expect(accents).toEqual(new Set(["British", "American"]));
    expect(NATURAL_VOICES.filter((v) => v.accent === "British")).toHaveLength(4);
  });

  it("is in the contract's order, frozen", () => {
    expect(NATURAL_VOICES.map((v) => v.name)).toEqual(["Alice", "Lily", "George", "Daniel", "Jessica", "Matilda", "Brian", "River"]);
    expect(Object.isFrozen(NATURAL_VOICES)).toBe(true);
    expect(Object.isFrozen(NATURAL_VOICES[0])).toBe(true);
  });

  it("knows its own ids and nothing else", () => {
    expect(isNaturalVoiceId("pFZP5JQG7iQjIQuC4Bku")).toBe(true);
    expect(isNaturalVoiceId("EXAVITQu4vr4xnSDxMaL")).toBe(false); // Sarah: left out (no Flash v2.5)
    expect(isNaturalVoiceId("../v1/user")).toBe(false);
    expect(isNaturalVoiceId(null)).toBe(false);
    expect(isNaturalVoiceId(42)).toBe(false);
    expect(naturalVoice("JBFqnCBsd6RMkjVDRZzb")?.name).toBe("George");
    expect(naturalVoice(null)).toBeNull();
    expect(naturalVoice("nope")).toBeNull();
  });

  it("speeds stay inside ElevenLabs' range", () => {
    for (const s of Object.values(SPEECH_SPEEDS)) { expect(s).toBeGreaterThanOrEqual(0.7); expect(s).toBeLessThanOrEqual(1.2); }
    expect(Object.keys(SPEECH_SPEEDS)).toEqual(["slower", "normal", "faster"]);
  });
});

describe("speechText", () => {
  it("removes control and invisible characters, collapses whitespace and trims", () => {
    expect(speechText("  Hello\u0000 there\u0007!\n\nSee\tyou\u200B soon.  ")).toBe("Hello there! See you soon.");
    expect(speechText("a\u2028b\u2029c")).toBe("a b c");
    expect(speechText("\u202Eevil\u202C")).toBe("evil");
    expect(speechText("")).toBe("");
    expect(speechText("   \n\t ")).toBe("");
  });

  it("leaves ordinary words alone (speakable's output is already its own speechText)", () => {
    const s = "I've added 3 to-dos for Ada: send the invoice, call Ben and book the room. Anything else?";
    expect(speechText(s)).toBe(s);
  });

  it("clips past 600 characters at a sentence end", () => {
    const sentence = "This is one plain sentence about the work. "; // 43 characters
    const long = sentence.repeat(20);
    const out = speechText(long);
    expect(out.length).toBeLessThanOrEqual(SPEECH_MAX_CHARS);
    expect(out.endsWith(".")).toBe(true);
    expect(out.length).toBeGreaterThan(SPEECH_MAX_CHARS - 50);
  });

  it("clips at a word boundary when no sentence ends late enough", () => {
    const long = `${"word ".repeat(200)}end.`;
    const out = speechText(long);
    expect(out.length).toBeLessThanOrEqual(SPEECH_MAX_CHARS);
    expect(out.endsWith("word")).toBe(true);
    expect(out).not.toMatch(/\s$/);
  });

  it("clips an unbroken run hard at the cap", () => {
    expect(speechText("x".repeat(2000))).toHaveLength(SPEECH_MAX_CHARS);
  });

  it("is idempotent, which the speech route relies on", () => {
    for (const s of ["Hi.", "a  b\u0001c", "One. ".repeat(300), "word ".repeat(500), `${"x".repeat(700)} y`]) {
      expect(speechText(speechText(s))).toBe(speechText(s));
    }
  });
});

const ctxA = { user: { profileId: "11111111-1111-4111-8111-111111111111" }, org: { id: "22222222-2222-4222-8222-222222222222" }, membership: { id: "33333333-3333-4333-8333-333333333333" } } as never;
const ctxOf = (over: { u?: string; o?: string; m?: string }) => ({
  user: { profileId: over.u ?? "11111111-1111-4111-8111-111111111111" },
  org: { id: over.o ?? "22222222-2222-4222-8222-222222222222" },
  membership: { id: over.m ?? "33333333-3333-4333-8333-333333333333" },
}) as never;
const OTHER = "99999999-9999-4999-8999-999999999999";
const TEXT = "Done. I've added the to-do for Friday.";

describe("the speech token", () => {
  it("verifies for the same person, workspace, membership and words", () => {
    const t = signSpeechToken(ctxA, TEXT);
    expect(() => verifySpeechToken(ctxA, t, TEXT)).not.toThrow();
  });

  it.each([
    ["another user", ctxOf({ u: OTHER })],
    ["another workspace", ctxOf({ o: OTHER })],
    ["another membership", ctxOf({ m: OTHER })],
  ])("refuses %s with the same words, 400 SPEECH_TOKEN", (_label, other) => {
    const t = signSpeechToken(ctxA, TEXT);
    let caught: unknown = null;
    try { verifySpeechToken(other, t, TEXT); } catch (e) { caught = e; }
    expect(caught).toMatchObject({ status: 400, code: "SPEECH_TOKEN", message: "This reply can't be said aloud any more." });
  });

  it("refuses other words, even one character", () => {
    const t = signSpeechToken(ctxA, TEXT);
    expect(() => verifySpeechToken(ctxA, t, `${TEXT}!`)).toThrow(/can't be said aloud/);
    expect(() => verifySpeechToken(ctxA, t, TEXT.replace("Friday", "Monday"))).toThrow(/can't be said aloud/);
    expect(() => verifySpeechToken(ctxA, t, "Transfer the money now.")).toThrow(/can't be said aloud/);
  });

  it("refuses words that are not already clean (the same hash after cleaning is not enough)", () => {
    const dirty = `${TEXT}\u0000`;
    const t = signSpeechToken(ctxA, dirty); // never happens in the app: offers sign speechText(spoken)
    expect(() => verifySpeechToken(ctxA, t, dirty)).toThrow(/can't be said aloud/);
  });

  it("refuses another kind of signed token (a media URL, an undo, a confirm)", () => {
    const h = signSpeechToken(ctxA, TEXT).split(".")[0];
    const claims = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    for (const k of ["media", "undo", "confirm"]) {
      const forged = signPayload({ ...claims, k, exp: undefined }, 600);
      expect(() => verifySpeechToken(ctxA, forged, TEXT)).toThrow(/can't be said aloud/);
    }
    const v2 = signPayload({ ...claims, v: 2, exp: undefined }, 600);
    expect(() => verifySpeechToken(ctxA, v2, TEXT)).toThrow(/can't be said aloud/);
  });

  it("refuses a tampered token", () => {
    const t = signSpeechToken(ctxA, TEXT);
    const [body, sig] = t.split(".");
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const other = Buffer.from(JSON.stringify({ ...claims, u: OTHER })).toString("base64url");
    expect(() => verifySpeechToken(ctxOf({ u: OTHER }), `${other}.${sig}`, TEXT)).toThrow(/can't be said aloud/);
    expect(() => verifySpeechToken(ctxA, `${body}.${sig.slice(0, -2)}xx`, TEXT)).toThrow(/can't be said aloud/);
    expect(() => verifySpeechToken(ctxA, "not-a-token", TEXT)).toThrow(/can't be said aloud/);
  });

  it("expires after 30 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-09T10:00:00Z"));
    const t = signSpeechToken(ctxA, TEXT);
    vi.setSystemTime(new Date(Date.now() + (SPEECH_TOKEN_TTL_S - 5) * 1000));
    expect(() => verifySpeechToken(ctxA, t, TEXT)).not.toThrow();
    vi.setSystemTime(new Date(Date.now() + 10_000));
    expect(() => verifySpeechToken(ctxA, t, TEXT)).toThrow(/can't be said aloud/);
  });
});

describe("the daily share", () => {
  // The subscription counts credits; Flash v2.5 costs half a credit a character (TTS_CREDITS_PER_CHARACTER), so the
  // share, in characters, is twice the credits left over the days left (fix review, 9 October 2026).
  it("matches the 9 October example: 38,373 credits left, resets 9 November 07:47 UTC ⇒ 31 days ⇒ 2,475 characters a day", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const resetAt = "2026-11-09T07:47:00.000Z";
    expect(TTS_CREDITS_PER_CHARACTER).toBe(0.5);
    expect(daysLeft(resetAt, now)).toBe(31);
    expect(dailyShare({ used: 0, limit: 38_373, resetAt, keyTodayAtFetch: 0 }, now)).toBe(2475);
  });

  it("adds back what was already counted today when the subscription was read (characters, as credits cost them)", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    const resetAt = "2026-11-09T07:47:00.000Z";
    // 500 characters said today before the read cost 250 credits: the allowance already shows them, the share does not shrink.
    expect(dailyShare({ used: 250, limit: 38_373, resetAt, keyTodayAtFetch: 500 }, now)).toBe(2475);
  });

  it("at least one day; without a reset date, to the end of the UTC month", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(daysLeft("2026-10-09T11:00:00Z", now)).toBe(1);
    expect(daysLeft("2026-10-09T12:30:00Z", now)).toBe(1);
    expect(daysLeft(null, now)).toBe(23); // 9 Oct 12:00 → 1 Nov 00:00 is 22.5 days
    expect(daysLeft(null, new Date("2026-10-31T23:00:00Z"))).toBe(1);
    expect(daysLeft("not a date", now)).toBe(23);
  });

  it("never negative; nothing left ⇒ 0", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(dailyShare({ used: 40_000, limit: 38_373, resetAt: "2026-11-09T07:47:00Z", keyTodayAtFetch: 0 }, now)).toBe(0);
  });

  it("is low under 10% of the allowance", () => {
    expect(LOW_ALLOWANCE).toBe(0.1);
    expect(allowanceLow({ used: 0, limit: 38_373 })).toBe(false);
    expect(allowanceLow({ used: 34_535, limit: 38_373 })).toBe(false); // 3,838 left: exactly 10%
    expect(allowanceLow({ used: 34_540, limit: 38_373 })).toBe(true);
    expect(allowanceLow({ used: 0, limit: 0 })).toBe(true);
  });

  it("gives a workspace on Boredroom's key a quarter of the key's share (at most 2,000 a day), its own key the whole share", () => {
    expect(BOREDROOM_KEY_WORKSPACE_DAILY_MAX).toBe(2000);
    expect(BOREDROOM_KEY_WORKSPACE_FRACTION).toBe(0.25);
    expect(workspaceCap("environment", 20_000)).toBe(2000);
    expect(workspaceCap("environment", 5000)).toBe(1250);
    // The Starter plan on 9 October: 2,475 characters a day for the key, 618 for each workspace on it.
    expect(workspaceCap("environment", 2475)).toBe(618);
    expect(workspaceCap("environment", -5)).toBe(0);
    expect(workspaceCap("organisation", 5000)).toBe(5000);
  });
});

describe("a reservation", () => {
  const base = { low: false, share: 1237, source: "environment" as const, personToday: 0, workspaceToday: 0, keyToday: 0 };
  it("passes within every cap", () => { expect(reservationProblem(base)).toBeNull(); });
  it("allowance low first", () => { expect(reservationProblem({ ...base, low: true, personToday: 5000 })).toBe("allowance_low"); });
  it("the person's 2,000 a day: reached once the day's count meets it (the utterance that crosses it is said whole)", () => {
    expect(PERSON_DAILY_CHARS).toBe(2000);
    expect(reservationProblem({ ...base, share: 99_999, personToday: 1999 })).toBeNull();
    expect(reservationProblem({ ...base, share: 99_999, personToday: 2000 })).toBe("person_cap");
  });
  it("a reply longer than a whole slice is still said on a fresh day (fix review, 9 October 2026: the slice was 309, replies up to 400)", () => {
    expect(workspaceCap("environment", 1237)).toBe(309);
    expect(reservationProblem({ ...base, workspaceToday: 0, keyToday: 0 })).toBeNull();
    expect(reservationProblem({ ...base, workspaceToday: 308, keyToday: 308 })).toBeNull();
    expect(reservationProblem({ ...base, workspaceToday: 669, keyToday: 669 })).toBe("workspace_cap");
  });
  it("one workspace on Boredroom's key cannot use up the others' day; the key's whole share is told apart", () => {
    expect(reservationProblem({ ...base, workspaceToday: 309, keyToday: 309 })).toBe("workspace_cap");
    // Other workspaces used the key's day: this one is told it is the shared allowance, not its own.
    expect(reservationProblem({ ...base, keyToday: 1237 })).toBe("shared_cap");
    expect(reservationProblem({ ...base, keyToday: 1236 })).toBeNull();
    // A workspace's own key: its share is its cap.
    expect(reservationProblem({ ...base, source: "organisation", share: 3000, workspaceToday: 2999, keyToday: 2999 })).toBeNull();
    expect(reservationProblem({ ...base, source: "organisation", share: 3000, workspaceToday: 3000, keyToday: 3000 })).toBe("workspace_cap");
  });
});

describe("the reason the person sees (contract C.5 order)", () => {
  const all: ReasonInput = { ready: true, voiceOff: false, chosen: "pFZP5JQG7iQjIQuC4Bku", key: true, held: null, subscription: "ok", low: false, personFull: false, workspaceFull: false };
  it("none when everything is fine", () => { expect(naturalVoiceReason(all)).toBeNull(); });
  it("follows the order exactly", () => {
    const worst: ReasonInput = { ready: false, voiceOff: true, chosen: "x", key: false, held: "upstream", subscription: "key_rejected", low: true, personFull: true, workspaceFull: true };
    expect(naturalVoiceReason(worst)).toBe("not_ready");
    expect(naturalVoiceReason({ ...worst, ready: true })).toBe("voice_off");
    expect(naturalVoiceReason({ ...worst, ready: true, voiceOff: false, chosen: null })).toBeNull();
    expect(naturalVoiceReason({ ...worst, ready: true, voiceOff: false })).toBe("no_key");
    expect(naturalVoiceReason({ ...worst, ready: true, voiceOff: false, key: true })).toBe("upstream");
    expect(naturalVoiceReason({ ...worst, ready: true, voiceOff: false, key: true, held: null })).toBe("key_rejected");
    expect(naturalVoiceReason({ ...worst, ready: true, voiceOff: false, key: true, held: null, subscription: "ok" })).toBe("allowance_low");
    expect(naturalVoiceReason({ ...all, personFull: true, workspaceFull: true })).toBe("person_cap");
    expect(naturalVoiceReason({ ...all, workspaceFull: true, sharedFull: true })).toBe("workspace_cap");
    expect(naturalVoiceReason({ ...all, sharedFull: true })).toBe("shared_cap");
  });
  it("voice off shows even with no voice chosen; none chosen otherwise needs no note", () => {
    expect(naturalVoiceReason({ ...all, chosen: null, voiceOff: true })).toBe("voice_off");
    expect(naturalVoiceReason({ ...all, chosen: null, key: false })).toBeNull();
  });
});
