import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Screen help on Brenda for Mac, phase 1 (owner decisions, 11 October 2026: "start building with your recommendations";
// contract C.10): desktop/src/look.js, a classic browser script that also loads in Node. The consent in the proposal's
// exact words (both versions: Brenda, and a renamed assistant), every refusal, the preview's caption, when the Mac turns
// screen help off after "Turn off on my Macs", whether a Boredroom call is live, when Send may be pressed, the messages a
// look sends and the never-look list.
//
// Phase 2 (owner request, 12 October 2026: "the preview step is a bad experience"; contract C.9, E.1): the consent is now
// version 2 (the whole screen, answered at once, a minute held for a follow-up, seeing isn't doing), and phase 1's words
// stay for today's Rust, whose flow still shows each picture first (`consent(name, keys, 1)`). Plus the update card, the
// settings card, the instant look's words, the new refusals and the sentence queue's rule.

type Para = { lead?: string; text: string; keys?: string };
type Consent = { title: string; paras: Para[]; fixed: string; notNow: string; turnOn: string; footer: string };
type Group = Record<string, string>;
type Words = { permission: Group; denied: Group; on: Group; off: Group; looking: Group; preview: Group; sending: Group; never: Group; looked: string; gone: string; dictation: Group; button: Group; show: string };
type LookApi = {
  RETENTION: string;
  DEFAULT_KEYS: string;
  QUESTION_MAX: number;
  T: { OFF_MS: number; REFUSED_MS: number; GONE_MS: number; NEVER_MS: number };
  keysOf(status: unknown): string;
  appName(app: unknown): string;
  consent(name: string, keys?: string, v?: number): Consent;
  consentText(name: string, keys?: string, v?: number): string;
  consentUpdate(name: string): Record<string, string>;
  settingsWords(name: string): Record<string, Record<string, string> | string>;
  placeOf(app: unknown): string;
  says(sent: number, text: unknown): { text: string; first: boolean } | null;
  SAYS_MAX: number;
  words(o?: { name?: string; keys?: string; app?: unknown; from?: string; v?: number }): Words & { v2: Group };
  refusalWords(reason: string, o?: { name?: string; app?: unknown; source?: string; message?: string }): { title: string; sub: string } | null;
  micWords(mic: unknown): string | null;
  previewCaption(source: string, pointer: unknown, name?: string): string;
  pointOf(p: unknown): { x: number; y: number } | null;
  shouldTurnOff(onAt: unknown, offAt: unknown, offsetMs?: number): boolean;
  liveOf(calls: unknown, rings?: unknown[]): boolean;
  cleanQuestion(s: unknown): string;
  joinQuestion(before: unknown, heard: unknown): string;
  previewModel(c: Record<string, unknown>): { shows: boolean; waiting: boolean; canSend: boolean };
  messagesFor(talk: unknown, question: string): { role: string; content: string; tainted?: boolean }[];
  addRule(list: unknown, app: unknown): { name: string; bundleId: string | null }[];
  safeImage(v: unknown): string | null;
  points(href: unknown): boolean;
};

const require = createRequire(import.meta.url);
const Look = require("../../desktop/src/look.js") as LookApi;
const file = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

// Phase 2's consent, contract E.1, word for word (12 October 2026).
const BRENDA_CONSENT_V2 = `Let Brenda see your screen when you ask

Hold Control+Command and ask. Brenda looks once at the screen your pointer is on and answers straight away: where a setting is, what an error means, how to do something. She can point at things for you.

Only when you ask. With her keys or her Look button. Never on her own, never on a timer, never during a Boredroom call. You'll see her listening by your pointer, and your Mac may show its own screen-recording icon in the menu bar.

She sees the whole screen. Everything on the screen your pointer is on, except apps on the never-look list, which are blanked out before the picture leaves your Mac. To check each picture first, turn on “Show me the picture first” in screen help settings.

Nothing is kept. The picture answers your question and is thrown away. It is never saved on your Mac or on Boredroom's servers. For a minute after she answers she keeps it in memory so you can ask a follow-up, then it's gone. Your question and her answer go into your Past chats like any chat, and you can delete them.

Your workspace can't see it. Not your manager, HR or the owner. Nothing in Boredroom shows anyone else what Brenda saw, or whether you use this, and Boredroom's staff never look. Using it or not changes nothing about how your work is seen.

Who else sees the picture. Brenda sends it, through Boredroom's own account, to Anthropic, the company that makes Claude, the AI she uses. Anthropic doesn't train on it and normally deletes it within 30 days. If you chose a natural voice, the words of her answer go to ElevenLabs to be spoken, only ever through Boredroom's own account, never your workspace's.

Seeing isn't doing. Looking never lets her click, type or open your files. Doing things on your Mac is a separate choice, and even then she asks “Do you want me to do this?” before every task.

She never looks at password manager, messaging or call apps. In a browser she can't tell a web chat or call from any other page, so add your browser in Settings if you want those kept out. You can add other apps there too.

[ Not now ] [ Turn on screen help ]

Turn it off any time from the menu bar or Settings › Your assistant.`;

const MAX_CONSENT_V2 = `Let Max see your screen when you ask

Hold Control+Command and ask. Max looks once at the screen your pointer is on and answers straight away: where a setting is, what an error means, how to do something. Max can point at things for you.

Only when you ask. With Max's keys or Look button. Never by itself, never on a timer, never during a Boredroom call. You'll see Max listening by your pointer, and your Mac may show its own screen-recording icon in the menu bar.

Max sees the whole screen. Everything on the screen your pointer is on, except apps on the never-look list, which are blanked out before the picture leaves your Mac. To check each picture first, turn on “Show me the picture first” in screen help settings.

Nothing is kept. The picture answers your question and is thrown away. It is never saved on your Mac or on Boredroom's servers. For a minute after Max answers, Max keeps it in memory so you can ask a follow-up, then it's gone. Your question and Max's answer go into your Past chats like any chat, and you can delete them.

Your workspace can't see it. Not your manager, HR or the owner. Nothing in Boredroom shows anyone else what Max saw, or whether you use this, and Boredroom's staff never look. Using it or not changes nothing about how your work is seen.

Who else sees the picture. Max sends it, through Boredroom's own account, to Anthropic, the company that makes Claude, the AI Max uses. Anthropic doesn't train on it and normally deletes it within 30 days. If you chose a natural voice, the words of Max's answer go to ElevenLabs to be spoken, only ever through Boredroom's own account, never your workspace's.

Seeing isn't doing. Looking never lets Max click, type or open your files. Doing things on your Mac is a separate choice, and even then Max asks “Do you want me to do this?” before every task.

Max never looks at password manager, messaging or call apps. In a browser Max can't tell a web chat or call from any other page, so add your browser in Settings if you want those kept out. You can add other apps there too.

[ Not now ] [ Turn on screen help ]

Turn it off any time from the menu bar or Settings › Your assistant.`;

// The proposal's section 6 consent, as contract C.4.1 fixes it (the retention bracket resolved, the Phase 2 note left out).
const BRENDA_CONSENT = `Let Brenda see your screen when you ask

Hold Control+Command and ask. Brenda looks once at the window in front of you to help with it: where a setting is, what an error means, how to do something.

Only when you ask. With her keys or her Look button. Never on her own, never on a timer, never during a Boredroom call. You'll see her looking, and your Mac may show its own screen-recording icon in the menu bar.

Nothing is kept. The picture answers your question and is thrown away. It is never saved on your Mac or on Boredroom's servers. Your question and her answer go into your Past chats like any chat, and you can delete them.

Your workspace can't see it. Not your manager, HR or the owner. Nothing in Boredroom shows anyone else what Brenda saw, or whether you use this, and Boredroom's staff never look. Using it or not changes nothing about how your work is seen.

Who else sees the picture. Brenda sends it, through Boredroom's own account, to Anthropic, the company that makes Claude, the AI she uses. Anthropic doesn't train on it and normally deletes it within 30 days. If you chose a natural voice, the words of her answer go to ElevenLabs to be spoken, only ever through Boredroom's own account, never your workspace's.

You see it first. Before anything leaves your Mac, you see the picture and can cancel.

She never looks at password manager, messaging or call apps. In a browser she can't tell a web chat or call from any other page, so add your browser in Settings if you want those kept out. You can add other apps there too.

[ Not now ] [ Turn on screen help ]

Turn it off any time from the menu bar or Settings › Your assistant.`;

const MAX_CONSENT = `Let Max see your screen when you ask

Hold Control+Command and ask. Max looks once at the window in front of you to help with it: where a setting is, what an error means, how to do something.

Only when you ask. With Max's keys or Look button. Never by itself, never on a timer, never during a Boredroom call. You'll see Max looking, and your Mac may show its own screen-recording icon in the menu bar.

Nothing is kept. The picture answers your question and is thrown away. It is never saved on your Mac or on Boredroom's servers. Your question and Max's answer go into your Past chats like any chat, and you can delete them.

Your workspace can't see it. Not your manager, HR or the owner. Nothing in Boredroom shows anyone else what Max saw, or whether you use this, and Boredroom's staff never look. Using it or not changes nothing about how your work is seen.

Who else sees the picture. Max sends it, through Boredroom's own account, to Anthropic, the company that makes Claude, the AI Max uses. Anthropic doesn't train on it and normally deletes it within 30 days. If you chose a natural voice, the words of Max's answer go to ElevenLabs to be spoken, only ever through Boredroom's own account, never your workspace's.

You see it first. Before anything leaves your Mac, you see the picture and can cancel.

Max never looks at password manager, messaging or call apps. In a browser Max can't tell a web chat or call from any other page, so add your browser in Settings if you want those kept out. You can add other apps there too.

[ Not now ] [ Turn on screen help ]

Turn it off any time from the menu bar or Settings › Your assistant.`;

describe("the script", () => {
  it("parses as plain JavaScript and loads before main.js in the notch and the preview", () => {
    for (const f of ["desktop/src/look.js", "desktop/src/main.js"]) expect(() => execFileSync(process.execPath, ["--check", f], { stdio: "pipe" })).not.toThrow();
    for (const page of ["desktop/src/index.html", "desktop/preview.html"]) {
      const html = file(page);
      expect(html.indexOf('src="look.js"') >= 0 || html.indexOf('src="src/look.js"') >= 0).toBe(true);
      expect(html.search(/src="(?:src\/)?look\.js"/)).toBeLessThan(html.search(/src="(?:src\/)?main\.js"/));
    }
  });
  it("is frozen and never reads the page", () => {
    expect(Object.isFrozen(Look)).toBe(true);
    const src = file("desktop/src/look.js");
    expect(src).not.toMatch(/\bdocument\.[a-z]|\bwindow\.[a-z_]|\binvoke\(|__TAURI__/);
  });
});

describe("the consent (contract C.4.1; phase 2, E.1)", () => {
  it("is phase 1's words, as the review corrected them (11 October 2026), for Brenda on today's Rust", () => {
    expect(Look.consentText("Brenda", undefined, 1)).toBe(BRENDA_CONSENT);
  });
  it("names a renamed assistant everywhere she would be named, and never says she or her beside the name", () => {
    expect(Look.consentText("Max", undefined, 1)).toBe(MAX_CONSENT);
    expect(MAX_CONSENT).not.toMatch(/\b(she|her|She|Her)\b/);
  });
  it("is version 2 by default, word for word (12 October 2026), in both naming versions", () => {
    expect(Look.consentText("Brenda")).toBe(BRENDA_CONSENT_V2);
    expect(Look.consentText("Brenda", undefined, 2)).toBe(BRENDA_CONSENT_V2);
    expect(Look.consentText("Max")).toBe(MAX_CONSENT_V2);
    expect(MAX_CONSENT_V2).not.toMatch(/\b(she|her|She|Her)\b/);
    // Version 2 no longer promises a picture first, and says what changed.
    expect(BRENDA_CONSENT_V2).not.toContain("You see it first");
    expect(BRENDA_CONSENT_V2).toContain("Seeing isn't doing.");
  });
  it("asks again once when it changed (contract E.1.1)", () => {
    expect(Look.consentUpdate("Max")).toEqual({
      title: "Screen help works differently now",
      sub: "Max now sees the whole screen your pointer is on, not just one window, and answers straight away without showing you the picture first. Apps on the never-look list are blanked out. You can still check each picture first in screen help settings.",
      off: "Turn it off", keep: "Keep it on", read: "Read everything",
    });
  });
  it("keeps the retention words in one constant: 30 days, normally, until zero retention is agreed", () => {
    // "normally": Anthropic keeps what it flags for a usage-policy breach for longer (review, 11 October 2026).
    expect(Look.RETENTION).toBe("normally deletes it within 30 days");
    expect(Look.consentText("Brenda")).toContain(Look.RETENTION);
  });
  it("says the look keys from Rust's constant, bolded by the card", () => {
    const c = Look.consent("Brenda", "Control+Option");
    expect(c.paras[0].text.startsWith("Hold Control+Option and ask.")).toBe(true);
    expect(c.paras[0].keys).toBe("Control+Option");
    expect(Look.consentText("Brenda", "Control+Option")).not.toContain("Control+Command");
    expect(Look.keysOf({ keys: "Control+Command" })).toBe("Control+Command");
    expect(Look.keysOf(null)).toBe("Control+Command");
    expect(Look.keysOf({ keys: "x".repeat(80) })).toBe("Control+Command");
  });
  it("falls back to Brenda for an empty name, and the plain card words stay plain", () => {
    expect(Look.consent("  ").title).toBe("Let Brenda see your screen when you ask");
    expect(Look.consent("Max").turnOn).toBe("Turn on screen help");
  });
});

describe("the other cards' words (contract C.4.2 to C.4.8)", () => {
  const w = Look.words({ name: "Max", keys: "Control+Command", app: { name: "Figma" }, from: "settings" });
  it("asks for the Mac's permission and says where to allow it", () => {
    expect(w.permission.title).toBe("One more step on your Mac");
    expect(w.permission.sub).toBe("Your Mac will ask whether Max may record the screen. That's what macOS calls letting an app see a window. Max looks only when you hold Control+Command or press Look, and nothing is kept.");
    expect(w.denied.title).toBe("Allow Brenda in System Settings");
    expect(w.denied.sub).toBe("Privacy & Security › Screen Recording (Screen & System Audio Recording on newer macOS), then turn on Brenda. You may need to quit and reopen Brenda afterwards.");
    expect([w.denied.notNow, w.denied.check, w.denied.open]).toEqual(["Not now", "Check again", "Open System Settings"]);
  });
  it("says on and off", () => {
    expect(w.on.title).toBe("Screen help is on");
    expect(w.on.sub).toBe("Hold Control+Command and ask about what's in front of you. Point at something first and ask “what's this?”");
    expect(w.off.sub).toBe("It was turned off from Boredroom Settings. Turn it on again from the menu bar.");
    expect(Look.words({ from: "tray" }).off.sub).toBe("Turn it on again from the menu bar.");
  });
  it("words the looking card, the preview and sending", () => {
    expect(w.looking.title).toBe("Looking at Figma…");
    expect(w.looking.keys).toBe("Let go of Control+Command when you're done.");
    expect(w.looking.button).toBe("One moment…");
    expect(w.preview.title).toBe("Send this to Max?");
    expect(w.preview.waiting).toBe("Getting your words…");
    expect(w.preview.placeholder).toBe("Ask about this…");
    expect(w.preview.label).toBe("Your question about this window");
    expect(w.preview.nothingLeaves).toBe("Nothing leaves your Mac until you press Send.");
    expect([w.preview.never, w.preview.discard, w.preview.send]).toEqual(["Never look at Figma", "Don't send", "Send"]);
    expect(w.sending.title).toBe("Max is looking…");
    expect(w.never.done).toBe("Max won't look at Figma again. Change it in Boredroom: Settings, Your assistant.");
    expect(w.looked).toBe("Looked at Figma");
    expect(w.gone).toBe("I let that picture go.");
    expect(w.button).toEqual({ label: "Look at the window in front of you", title: "Look (Control+Command)" });
  });
  it("keeps an app's name to one line of at most 80 characters", () => {
    expect(Look.appName({ name: "  Fig\nma  " })).toBe("Fig ma");
    expect(Look.appName("x".repeat(200))).toHaveLength(80);
    expect(Look.appName(null)).toBe("this app");
  });
});

describe("phase 2's words (contract A.2, A.3, A.11, A.12)", () => {
  it("words the instant look, over an app, the desktop or the whole screen", () => {
    const w = Look.words({ name: "Max", keys: "Control+Command", app: { name: "Finder", desktop: true } });
    expect(w.looking.title).toBe("Looking at your desktop…");
    expect(w.looked).toBe("Looked at your desktop");
    expect(Look.words({ app: { name: "Figma" } }).looking.title).toBe("Looking at Figma…");
    expect(Look.words({ app: { name: "", screen: true } }).looked).toBe("Looked at your screen");
    expect(Look.placeOf("your desktop")).toBe("app");
    expect(w.v2).toMatchObject({ getting: "Getting your words…", thinking: "Max is looking…", missed: "I didn't catch that. Hold Control+Command and ask again.", followUp: "Ask a follow-up about this screen for the next minute.", followPlaceholder: "Ask about this…", voiceOff: "Voice is off, so type your question.", typePlaceholder: "Ask about your screen…" });
    expect(Look.words({ v: 2 }).button.label).toBe("Look at your screen");
  });
  // Phase 3 (owner report, 12 October 2026; companion2 contract A.3, M.4, M.10): Help on this Mac, five switches.
  it("words Help on this Mac, every switch the person's own", () => {
    const s = Look.settingsWords("Brenda") as Record<string, Record<string, string | ((f: string) => string)> & string>;
    expect(s.title).toBe("Help on this Mac");
    expect(s.look).toEqual({ label: "See my screen when I ask", sub: "Hold ⌃ ⌘ and ask. She looks once and answers.", needs: "Needs Screen Recording" });
    expect(s.useMac).toEqual({ label: "Do things when I ask", sub: "Opens apps, files and pages, and clicks and types, only after you say yes.", needs: "Needs Accessibility to click and type" });
    expect([s.files.label, s.files.sub, s.files.finderNo, (s.files.folderNo as (f: string) => string)("Documents")]).toEqual(["Work on my files", "Finds and reads your files, and saves new ones next to them.", "Finder not allowed", "Can't open Documents"]);
    expect(s.companion).toEqual({ label: "Show Brenda by my pointer" });
    expect(s.preview).toEqual({ label: "Show me the picture first", sub: "Check each picture before it's sent." });
    const max = Look.settingsWords("Max") as Record<string, Record<string, string>>;
    expect([max.look.sub, max.companion.label]).toEqual(["Hold ⌃ ⌘ and ask. Max looks once and answers.", "Show Max by my pointer"]);
    // The person sees what is on, here and in Boredroom; their workspace can't (owner request, 12 October 2026: M.10).
    expect([s.note, s.off, s.done, s.on, s.offWord]).toEqual(["Only you can see these, here and in Boredroom › Settings › Your assistant. Your workspace can't.", "Turn off help on this Mac", "Done", "On", "Off"]);
  });
  it("says her streamed sentences in order: the first cuts off, the rest queue, at most 8 of 400 characters", () => {
    expect(Look.says(0, "That's the Export button.")).toEqual({ text: "That's the Export button.", first: true });
    expect(Look.says(3, "Then press Export.")).toEqual({ text: "Then press Export.", first: false });
    expect(Look.says(Look.SAYS_MAX, "One too many.")).toBeNull();
    expect(Look.says(0, "   ")).toBeNull();
    expect(Look.says(1, "x".repeat(500))?.text).toHaveLength(400);
  });
  it("refuses while the screen looks shared, asks for an answer first, and opens the update card for a changed consent", () => {
    expect(Look.refusalWords("sharing")).toEqual({ title: "Your screen looks shared", sub: "I don't look or work while it's being shared." });
    expect(Look.refusalWords("answer_first")).toEqual({ title: "Answer this one first", sub: "" });
    expect(Look.refusalWords("consent_update")).toBeNull();
  });
});

describe("refusals (contract C.4.9)", () => {
  const r = (reason: string, o: Record<string, string> = {}) => Look.refusalWords(reason, { name: "Max", app: { name: "Figma" }, ...o });
  it("says every row of the table in plain words", () => {
    expect(r("on_call")).toEqual({ title: "I don't look at the screen during a Boredroom call", sub: "Try again when the call ends." });
    expect(r("offline")).toEqual({ title: "I can't reach Boredroom right now", sub: "So I won't look. Try again in a moment." });
    expect(r("offline_send")).toEqual({ title: "I can't reach Boredroom right now", sub: "So I didn't send it. Nothing was kept." });
    expect(r("call_unknown")).toEqual({ title: "I can't check for a call right now", sub: "So I won't look. Try again in a moment." });
    expect(r("never_look", { source: "fixed", app: "1Password" } as Record<string, string>)).toEqual({ title: "I never look at 1Password", sub: "Password manager, messaging and call apps, and System Settings, are always off limits." });
    expect(r("never_look", { source: "workspace" })).toEqual({ title: "I don't look at Figma", sub: "Your workspace asked me not to." });
    expect(r("never_look", { source: "you" })).toEqual({ title: "I don't look at Figma", sub: "You asked me not to. Change it in Boredroom: Settings, Your assistant." });
    expect(r("own_window")).toEqual({ title: "That's my own window", sub: "Click the window you want help with, then try again." });
    expect(r("no_window")).toEqual({ title: "I couldn't find a window in front of you", sub: "Click the window you want help with, then try again." });
    expect(r("busy")).toEqual({ title: "I'm still answering", sub: "Wait a moment, then try again." });
    expect(r("unsupported")).toEqual({ title: "Screen help needs macOS 14 Sonoma or later", sub: "Everything else works as before." });
    expect(r("not_available")).toEqual({ title: "Screen help isn't on in this workspace", sub: "" });
    expect(r("permission")).toBeNull();
    expect(r("error", { message: "That window is too big to send." })).toEqual({ title: "I couldn't take the picture", sub: "That window is too big to send. Nothing was kept." });
    expect(r("send", { message: "Your workspace has switched off screen help." })).toEqual({ title: "Max couldn't look", sub: "Your workspace has switched off screen help. Nothing was kept." });
  });
  it("a never-look rule with no source is the fixed list, and a message without a full stop gets one", () => {
    expect(r("never_look")?.title).toBe("I never look at Figma");
    expect(r("send", { message: "Cannot reach Boredroom: timed out" })?.sub).toBe("Cannot reach Boredroom: timed out. Nothing was kept.");
    expect(r("error")?.sub).toBe("Nothing was kept.");
    // A message that only repeats the title is left out (review, 11 October 2026).
    expect(r("error", { message: "I couldn't take the picture." })).toEqual({ title: "I couldn't take the picture", sub: "Nothing was kept." });
    expect(r("send", { message: "Max couldn't look" })?.sub).toBe("Nothing was kept.");
    expect(r("send", { message: "Claude couldn't be reached just now, so Max has no answer for that." })).toEqual({ title: "Max couldn't look", sub: "Claude couldn't be reached just now, so Max has no answer for that. Nothing was kept." });
  });
  it("says why a held look is not listening, so the question is typed (review, 11 October 2026)", () => {
    expect(Look.micWords("off")).toBe("Voice is off, so type your question instead.");
    expect(Look.micWords("needs-model")).toBe("Voice is still getting ready. Type your question for now.");
    expect(Look.micWords("busy")).toBe("The microphone is busy, so type your question instead.");
    expect(Look.micWords(undefined)).toBeNull();
    expect(Look.micWords("other")).toBeNull();
    expect(r("whatever")).toEqual({ title: "I couldn't look this time", sub: "Try again in a moment." });
  });
});

describe("the preview", () => {
  it("captions the ring, a pointer off the window, and Look pressed on her card", () => {
    expect(Look.previewCaption("keys", { x: 640, y: 212 }, "Max")).toBe("The ring is your pointer.");
    expect(Look.previewCaption("keys", null, "Max")).toBe("Your pointer wasn't on this window.");
    expect(Look.previewCaption("keys", { x: -1, y: 4 }, "Max")).toBe("Your pointer wasn't on this window.");
    expect(Look.previewCaption("keys", { x: 1.5, y: 4 }, "Max")).toBe("Your pointer wasn't on this window.");
    expect(Look.previewCaption("button", { x: 3, y: 4 }, "Max")).toBe("You pressed Look, so Max sees the whole window.");
  });
  it("shows once there is a picture and the keys are up; Send waits for words and for the words being written out", () => {
    const img = "data:image/jpeg;base64,AAAA";
    expect(Look.previewModel({ image: img, source: "keys", released: false, question: "What is this?" })).toEqual({ shows: false, waiting: false, canSend: false });
    expect(Look.previewModel({ image: img, source: "keys", released: true, question: "What is this?" })).toEqual({ shows: true, waiting: false, canSend: true });
    expect(Look.previewModel({ image: img, source: "button", question: "" }).canSend).toBe(false);
    expect(Look.previewModel({ image: img, source: "button", question: "   " }).canSend).toBe(false);
    expect(Look.previewModel({ image: img, source: "keys", released: true, question: "Hi", transcribing: true })).toEqual({ shows: true, waiting: true, canSend: false });
    expect(Look.previewModel({ image: img, source: "button", question: "Hi", dictating: "listening" }).canSend).toBe(false);
    expect(Look.previewModel({ image: img, source: "button", question: "Hi", busy: true }).canSend).toBe(false);
    expect(Look.previewModel({ image: null, source: "button", question: "Hi" }).shows).toBe(false);
  });
  it("accepts only an image data URL from Rust", () => {
    expect(Look.safeImage("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe("data:image/jpeg;base64,/9j/4AAQSkZJRg==");
    expect(Look.safeImage("data:image/png;base64,iVBORw0KGgo=")).not.toBeNull();
    expect(Look.safeImage("data:image/svg+xml;base64,PHN2Zz4=")).toBeNull();
    expect(Look.safeImage("https://example.com/a.jpg")).toBeNull();
    expect(Look.safeImage('data:image/jpeg;base64,AAAA" onerror="x')).toBeNull();
    expect(Look.safeImage(42)).toBeNull();
  });
  it("keeps a question to 4,000 characters and adds the words heard to what was typed", () => {
    expect(Look.cleanQuestion("  what   is\nthis? ")).toBe("what is this?");
    expect(Look.cleanQuestion("x".repeat(5000))).toHaveLength(Look.QUESTION_MAX);
    expect(Look.joinQuestion("Why is", "this red?")).toBe("Why is this red?");
    expect(Look.joinQuestion("", "  What is this?")).toBe("What is this?");
  });
});

describe("turning off from Boredroom (contract C.2: Turn off on my Macs)", () => {
  const on = Date.parse("2026-10-11T09:00:00Z");
  it("turns off only when the press came after it was turned on here, on the server's clock less the offset", () => {
    expect(Look.shouldTurnOff(on, "2026-10-11T09:05:00Z", 0)).toBe(true);
    expect(Look.shouldTurnOff(on, "2026-10-11T08:55:00Z", 0)).toBe(false);
    // The server runs 10 minutes ahead: 09:05 there is 08:55 here, before it was turned on.
    expect(Look.shouldTurnOff(on, "2026-10-11T09:05:00Z", 10 * 60_000)).toBe(false);
    // The server runs 10 minutes behind: 08:55 there is 09:05 here.
    expect(Look.shouldTurnOff(on, "2026-10-11T08:55:00Z", -10 * 60_000)).toBe(true);
  });
  it("never without a press, and an off wins when the on has no time", () => {
    expect(Look.shouldTurnOff(on, null, 0)).toBe(false);
    expect(Look.shouldTurnOff(on, "not a date", 0)).toBe(false);
    expect(Look.shouldTurnOff(null, "2026-10-11T08:55:00Z", 0)).toBe(true);
  });
});

describe("a live Boredroom call (contract B.5)", () => {
  it("is live on a call or while one rings for the person", () => {
    expect(Look.liveOf({ active: { id: "a" }, ringing: [] })).toBe(true);
    expect(Look.liveOf({ active: null, ringing: [{ id: "r" }] })).toBe(true);
    expect(Look.liveOf({ active: null, ringing: [] })).toBe(false);
    expect(Look.liveOf(null)).toBe(false);
  });
  it("leaves out rings answered or declined here, when the page says what still rings", () => {
    expect(Look.liveOf({ active: null, ringing: [{ id: "r" }] }, [])).toBe(false);
    expect(Look.liveOf({ active: { id: "a" }, ringing: [] }, [])).toBe(true);
  });
});

describe("what a look sends (contract A.5, C.5)", () => {
  it("sends the last turns as ask() does, then the question, last", () => {
    const talk = Array.from({ length: 20 }, (_, i) => (i % 2 ? { role: "assistant", content: `a${i}`, tainted: i === 3 ? false : undefined, actions: [{ x: 1 }] } : { role: "user", content: `q${i}`, look: { app: "Figma" } }));
    const m = Look.messagesFor(talk, "  What is this? ");
    expect(m).toHaveLength(12);
    expect(m.at(-1)).toEqual({ role: "user", content: "What is this?" });
    expect(m[0]).toEqual({ role: "assistant", content: "a9", tainted: true });
    expect(Object.keys(m[1])).toEqual(["role", "content"]);
    expect(JSON.stringify(m)).not.toContain("look");
    expect(Look.messagesFor([{ role: "assistant", content: "x", tainted: false }], "Hi")[0]).toEqual({ role: "assistant", content: "x", tainted: false });
    expect(Look.messagesFor(null, "Hi")).toEqual([{ role: "user", content: "Hi" }]);
  });
});

describe("Never look at Figma (contract C.4.7)", () => {
  it("adds the app once, by bundle id or name, and keeps at most 50", () => {
    const fig = { name: "Figma", bundleId: "com.figma.Desktop" };
    expect(Look.addRule([], fig)).toEqual([fig]);
    expect(Look.addRule([{ name: "figma", bundleId: "COM.FIGMA.DESKTOP" }], fig)).toHaveLength(1);
    expect(Look.addRule([{ name: "Notes", bundleId: null }], { name: "notes", bundleId: null })).toHaveLength(1);
    expect(Look.addRule([], { name: "Odd", bundleId: "bad id!" })).toEqual([{ name: "Odd", bundleId: null }]);
    expect(Look.addRule([], { name: "  ", bundleId: null })).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `App ${i}`, bundleId: null }));
    const out = Look.addRule(many, fig);
    expect(out).toHaveLength(50);
    expect(out.at(-1)).toEqual(fig);
  });
});

describe("Show me (contract C.6)", () => {
  it("is an open suggestion that points inside Boredroom", () => {
    expect(Look.points("/app/acme/tasks?point=tasks-new")).toBe(true);
    expect(Look.points("/app/acme/settings?section=assistant&point=settings-quiet-hours")).toBe(true);
    expect(Look.points("/app/acme/tasks")).toBe(false);
    expect(Look.points("/app/acme/tasks?point=BAD KEY")).toBe(false);
    expect(Look.points("https://evil.example/?point=tasks-new")).toBe(false);
  });
});

describe("the notch page", () => {
  const main = file("desktop/src/main.js");
  it("guards every look command, so today's Rust (without them) keeps working", () => {
    for (const cmd of ["look_status", "set_screen_help", "look_request_permission", "look_open_privacy_settings", "look_now", "look_send", "look_discard", "set_call_state", "set_look_rules"]) {
      expect(main).toContain(`"${cmd}"`);
    }
    // Each fire-and-forget call is caught; the awaited ones sit in try blocks or end in .catch.
    for (const m of main.matchAll(/invoke\("(set_call_state|set_look_rules|look_discard|look_open_privacy_settings)"/g)) {
      const call = main.slice(m.index, main.indexOf(";\n", m.index));
      expect(call, m[1]).toMatch(/\.catch\(/);
    }
    expect(main).toMatch(/lookStatus = await invoke\("look_status"\)\.then\(lookStatusOf\)\.catch\(\(\) => null\);/);
  });
  it("never sends the picture through the generic api command, and keeps only the app in Past chats", () => {
    expect(main).not.toMatch(/assistant\/look/);
    expect(main).toMatch(/look: \{ app: clip\(m\.look\.app\.trim\(\), 80\) \}/);
  });
  it("has the outline page Rust shows round the captured window, with no script", () => {
    const html = file("desktop/src/outline.html");
    expect(html).toContain('<body aria-hidden="true"><i class="ring"></i></body>');
    expect(html).not.toMatch(/<script/i);
    const css = file("desktop/src/outline.css");
    expect(css).toMatch(/html\.flash \.ring \{ animation: flash 700ms ease-out; \}/);
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
