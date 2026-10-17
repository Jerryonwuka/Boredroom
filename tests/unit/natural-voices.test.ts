/**
 * Natural voice (owner decision, 9 October 2026: natural voice (ElevenLabs), contract H): the catalogue, the words a
 * speech token covers, the token itself and the reasons the person sees. Boredroom sets no limit of its own since the owner's
 * request (12 October 2026: "remove the limit for ElevenLabs voice"): no daily share, no per-person or workspace cap, no
 * stop under 10% left; only ElevenLabs' own refusal for credits stops the natural voice. Pure: no database, and no
 * ElevenLabs (nothing here calls it).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NATURAL_VOICES, SPEECH_MAX_CHARS, SPEECH_SPEEDS, isNaturalVoiceId, naturalVoice, speechText } from "@/lib/natural-voices";
import * as service from "@/server/services/natural-voice";
import { NO_LIMIT, SPEECH_TOKEN_TTL_S, naturalVoiceReason, outOfCredits, signSpeechToken, verifySpeechToken, type ReasonInput } from "@/server/services/natural-voice";
import { signPayload } from "@/server/lib/crypto";

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
    expect(verifySpeechToken(ctxA, t, TEXT)).toEqual({ boredroomKeyOnly: false });
  });

  it("a look's token says it may be said only on Boredroom's own key (review, 11 October 2026)", () => {
    const t = signSpeechToken(ctxA, TEXT, { boredroomKeyOnly: true });
    expect(verifySpeechToken(ctxA, t, TEXT)).toEqual({ boredroomKeyOnly: true });
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

describe("no limit of Boredroom's (owner request, 12 October 2026)", () => {
  it("the caps and the daily share are gone from the service", () => {
    expect(NO_LIMIT).toBe(0);
    for (const gone of ["PERSON_DAILY_CHARS", "BOREDROOM_KEY_WORKSPACE_DAILY_MAX", "BOREDROOM_KEY_WORKSPACE_FRACTION", "LOW_ALLOWANCE", "SHARE_DAYS_AHEAD",
      "dailyShare", "daysLeft", "allowanceLow", "workspaceCap", "reservationProblem"]) {
      expect(gone in service).toBe(false);
    }
  });

  it("out of credits only by ElevenLabs' own figures (for Settings; nothing is refused for it)", () => {
    expect(outOfCredits({ used: 0, limit: 38_373 })).toBe(false);
    expect(outOfCredits({ used: 38_000, limit: 38_373 })).toBe(false); // nearly used up is no longer a stop
    expect(outOfCredits({ used: 38_373, limit: 38_373 })).toBe(true);
    expect(outOfCredits({ used: 0, limit: 0 })).toBe(true);
  });
});

describe("the reason the person sees (contract C.5 order, no caps)", () => {
  const all: ReasonInput = { ready: true, voiceOff: false, chosen: "pFZP5JQG7iQjIQuC4Bku", key: true, held: null };
  it("none when everything is fine", () => { expect(naturalVoiceReason(all)).toBeNull(); });
  it("follows the order exactly", () => {
    const worst: ReasonInput = { ready: false, voiceOff: true, chosen: "x", key: false, held: "upstream" };
    expect(naturalVoiceReason(worst)).toBe("not_ready");
    expect(naturalVoiceReason({ ...worst, ready: true })).toBe("voice_off");
    expect(naturalVoiceReason({ ...worst, ready: true, voiceOff: false, chosen: null })).toBeNull();
    expect(naturalVoiceReason({ ...worst, ready: true, voiceOff: false })).toBe("no_key");
    expect(naturalVoiceReason({ ...worst, ready: true, voiceOff: false, key: true })).toBe("upstream");
  });
  it("only ElevenLabs' own refusals, held by the breaker, stop it: a rejected key or no credits", () => {
    expect(naturalVoiceReason({ ...all, held: "key_rejected" })).toBe("key_rejected");
    expect(naturalVoiceReason({ ...all, held: "allowance_low" })).toBe("allowance_low");
  });
  it("voice off shows even with no voice chosen; none chosen otherwise needs no note", () => {
    expect(naturalVoiceReason({ ...all, chosen: null, voiceOff: true })).toBe("voice_off");
    expect(naturalVoiceReason({ ...all, chosen: null, key: false })).toBeNull();
  });
});
