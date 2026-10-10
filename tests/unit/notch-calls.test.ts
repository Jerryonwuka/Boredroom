// The notch and calls (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, calls; contract F). The notch
// rings, answers and declines; the call itself opens in the browser. Loads desktop/src/notify-cards.js and notify.js as
// Node sees them (module.exports) and checks: the incoming card (escaping, exactly one orange button and it is Accept, the
// main action; the waiting line; the three quick messages, the web's words; "+1 more calling"; what a press did), the
// strip and the bars; what a ring does to what is open (Notify.ringAction), the ring poll's pace (ringPollMs, ringRetryMs);
// and the missed call's card (Join while it is still on, Call back for a direct call, Open for a group call that ended;
// on another call, "Leave it and join", also after the server's 409: fix review, 10 October 2026).
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CALL_LIMITS, CALL_WORDS, callClock } from "@/lib/calls";

type Assistant = { name: string; colour: string; visor: string; eyes: string; face: { hi: string; mid: string; edge: string } };
type FaceOptions = { who?: Assistant; mood?: string; small?: boolean; cls?: string };
type Env = Record<string, unknown> & { esc: (s: unknown) => string; face: (o?: FaceOptions) => string; now: number };
type Bar = { lead: string; text: string; trail: string; wide: boolean; label: string };
type Cards = {
  classify: (type: string, facts: unknown) => { template: string; family: string; group: string; waits: boolean };
  card: (c: Record<string, unknown>, env: Env, opts?: Record<string, unknown>) => string;
  cardInfo: (c: Record<string, unknown>, env: Env) => { template: string };
  notice: (n: unknown, env: Env) => { sender: { label: string; mood: string }; line: string; family: string; group: string };
  ringCard: (ring: unknown, env: Env, o?: Record<string, unknown>) => string;
  ringStrip: (ring: unknown, env: Env) => string;
  ringBar: (ring: unknown, env: Env) => Bar;
  callBar: (active: unknown, env: Env) => Bar;
  callClock: (seconds: number) => string;
  onCallWords: (active: unknown) => string;
  CALL_QUICK: readonly string[];
};
type NotifyApi = {
  CALL_POLL: { MIN_MS: number; MAX_MS: number; IDLE_MS: number; OLD_SERVER_MS: number; RETRY_MS: number };
  ringAction: (o: { ringing?: boolean; cardKind?: string | null; sticky?: boolean; quiet?: boolean; micOpen?: boolean }) => "show" | "bar" | "none";
  ringPollMs: (pollMs: unknown) => number;
  ringRetryMs: (status: unknown) => number;
};

const req = createRequire(import.meta.url);
const cardsFile = fileURLToPath(new URL("../../desktop/src/notify-cards.js", import.meta.url));
const notifyFile = fileURLToPath(new URL("../../desktop/src/notify.js", import.meta.url));
const NC = req(cardsFile) as Cards;
const Notify = req(notifyFile) as NotifyApi;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
const BRENDA: Assistant = { name: "Brenda", colour: "white", visor: "bean", eyes: "pill", face: { hi: "#ffffff", mid: "#ececf0", edge: "#c9cad1" } };
const assistantOf = (p: unknown): Assistant => (p && typeof p === "object" && typeof (p as Assistant).name === "string" ? (p as Assistant) : BRENDA);
const boredroomPath = (h: unknown) => (typeof h === "string" && /^\/(?![/\\])[^\s\\]{0,2000}$/.test(h) ? h : null);
const NOW = new Date(2026, 9, 10, 14, 0).getTime();
const env = (o: Record<string, unknown> = {}): Env => ({
  esc, now: NOW, assistantOf, boredroomPath, me: BRENDA, ws: BRENDA, displayName: "Jeremiah Onwuka", workspaceName: "Khronocorp", state: {}, busy: false, canStart: true,
  face: (f = {}) => `<span class="face ${f.small ? "small" : ""} ${f.mood ?? ""}" data-who="${esc(f.who?.name ?? "me")}"></span>`, ...o,
});
const E = env();

const NOVA: Assistant = { name: "Nova", colour: "purple", visor: "screen", eyes: "square", face: { hi: "#e9dfff", mid: "#a88cff", edge: "#7559d6" } };
const ADA = { membershipId: "b1a00000-0000-4000-8000-000000000001", name: "Ada Obi", firstName: "Ada", profileId: "p1", avatarKey: null, assistant: NOVA };
const CALL = "ca110000-0000-4000-8000-000000000001";
const ring = (o: Record<string, unknown> = {}) => ({
  id: CALL, kind: "direct", caller: ADA, where: { conversationId: "c1", kind: "direct", name: "Ada Obi", href: "/app/k/messages?c=c1" },
  rangAt: new Date(NOW - 5_000).toISOString(), expiresAt: new Date(NOW + 25_000).toISOString(), href: `/app/k/calls/${CALL}`, inAnotherCall: false, ...o,
});
const group = (o: Record<string, unknown> = {}) => ring({ kind: "group", where: { conversationId: "c2", kind: "team", name: "#Design", href: "/app/k/messages?c=c2" }, ...o });
const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;
const accentButtons = (html: string) => [...html.matchAll(/<button [^>]*class="btn [^"]*\baccent\b[^"]*"[^>]*>/g)].map((m) => m[0]);

describe("the incoming card (NotifyCards.ringCard)", () => {
  it("names the caller, says where, and has exactly one orange button: Accept, the main action", () => {
    const html = NC.ringCard(ring(), E);
    expect(html.startsWith('<section class="nc nc-call"')).toBe(true);
    expect(html).toContain('data-family="needs"');
    expect(html).toContain('id="nc-hl">Ada Obi is calling</h3>');
    // The byline says where; the name is said once, in the headline (fix review, 10 October 2026).
    expect(html).toContain(`<span class="ctx">${CALL_WORDS.incoming.direct}</span>`);
    expect(html).not.toContain("<b>Ada Obi</b>");
    expect(count(html, /Ada Obi/g)).toBe(1);
    expect(html).toContain('data-who="Nova"');
    expect(html).toContain("alert");
    const accents = accentButtons(html);
    expect(accents).toHaveLength(1);
    expect(accents[0]).toContain('data-act="call-accept"');
    expect(accents[0]).toContain("data-main");
    expect(count(html, / data-main/g)).toBe(1);
    expect(html).toMatch(/class="btn ghost" data-act="call-decline"/);
    expect(html).toMatch(/class="btn ghost" data-act="call-message"/);
    expect(html).not.toContain(esc(CALL_WORDS.incoming.waiting));
  });

  it("says a group call's place and how many more are calling", () => {
    const html = NC.ringCard(group(), E, { more: 1 });
    expect(html).toContain(`<span class="ctx">${CALL_WORDS.incoming.group("#Design")}</span>`);
    expect(html).toContain('<span class="nc-more"><span class="n">+1</span>more calling</span>');
  });

  it("says accepting leaves the other call when the person is on one", () => {
    expect(NC.ringCard(ring({ inAnotherCall: true }), E)).toContain(esc(CALL_WORDS.incoming.waiting));
  });

  it("runs a hairline down to the ring's end", () => {
    const html = NC.ringCard(ring(), E);
    expect(html).toMatch(/<div class="nc-ringtime" aria-hidden="true"><i style="--from:0\.833;animation-duration:25000ms"><\/i><\/div>/);
    expect(NC.ringCard(ring({ expiresAt: new Date(NOW - 1000).toISOString() }), E)).toContain("--from:0.000;animation-duration:0ms");
    expect(NC.ringCard(ring({ expiresAt: "soon" }), E)).not.toContain("nc-ringtime");
  });

  it("offers the web's three quick messages, word for word, each a decline that sends it", () => {
    expect([...NC.CALL_QUICK]).toEqual([...CALL_WORDS.quickMessages]);
    expect(NC.ringCard(ring(), E)).not.toContain("call-decline-msg");
    const html = NC.ringCard(ring(), E, { messages: true });
    expect(count(html, /data-act="call-decline-msg"/g)).toBe(3);
    CALL_WORDS.quickMessages.forEach((m, i) => expect(html).toContain(`data-i="${i}">${esc(m)}</button>`));
    expect(html).toContain('aria-expanded="true" aria-controls="nc-quick"');
    expect(accentButtons(html)).toHaveLength(1);
  });

  it("writes headlines of 30 characters or fewer, the short form for long names", () => {
    const long = { ...ADA, name: `${"Bartholomew".repeat(5)} Obi` };
    expect(NC.ringCard(ring({ caller: long }), E)).toContain('id="nc-hl">Incoming call</h3>');
    expect(NC.ringCard(ring({ caller: { ...ADA, name: "Adaeze Chukwuemeka-Obi Okonkwo" } }), E)).toContain('id="nc-hl">Adaeze is calling</h3>');
  });

  it("escapes every name and never puts an unchecked id or colour on the page", () => {
    const evil = "<script>alert(1)</script>";
    const villain = { ...ADA, name: `${evil} Smith`, assistant: { ...NOVA, name: evil, face: { hi: "red;background:url(x)", mid: evil, edge: "#000" } } };
    const html = NC.ringCard(group({ caller: villain, where: { kind: "channel", name: evil } }), E, { messages: true, more: 2 });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(NC.ringStrip(ring({ caller: villain }), E)).not.toContain("<script>");
    expect(NC.ringBar(ring({ caller: villain }), E).text).not.toContain("<script>");
    // A ring whose id is not an id is not drawn as one (nothing to answer): a card with no call buttons.
    const bad = NC.ringCard(ring({ id: `"><img src=x onerror=alert(1)>` }), E);
    expect(bad).not.toContain("<img");
    expect(bad).not.toContain("call-accept");
    expect(bad).toContain('id="nc-hl">Incoming call</h3>');
    expect(NC.ringStrip(ring({ id: "nope" }), E)).toBe("");
  });

  it("never throws, and draws what a press did in place of the body and the buttons", () => {
    for (const r of [null, undefined, 42, "x", {}, { id: CALL }, { id: CALL, caller: { name: "" } }, { id: CALL, caller: { name: 5 } }]) {
      let html = "";
      expect(() => { html = NC.ringCard(r, E); }).not.toThrow();
      expect(html).toContain('id="nc-hl"');
      expect(count(html, / data-main/g)).toBe(1);
    }
    expect(() => NC.ringCard(ring(), {} as Env)).not.toThrow();
    const done = NC.ringCard(ring(), E, { result: { title: "Opening the call in your browser", tone: "ok", actions: "" } });
    expect(done).toContain("Opening the call in your browser");
    expect(done).not.toContain("call-accept");
    expect(done).toContain('<div class="actions"></div>');
  });

  it("disables its buttons while a press is in flight", () => {
    expect(count(NC.ringCard(ring(), env({ busy: true })), /<button [^>]*disabled/g)).toBe(3);
  });
});

describe("the strip and the bars", () => {
  it("rings on a card that must stay: the caller's face, their first name, Accept in white (never the main action)", () => {
    const html = NC.ringStrip(ring(), E);
    expect(html).toContain('<b>Ada</b> is calling');
    expect(html).toContain(`data-act="call-accept" data-call="${CALL}"`);
    expect(html).not.toContain("accent");
    expect(html).not.toContain("data-main");
    // A quiet Decline too (fix review, 10 October 2026: the strip offered only Accept).
    expect(html).toContain(`class="btn ghost icon" data-act="call-decline" data-call="${CALL}" aria-label="${esc(CALL_WORDS.incoming.declineFrom("Ada"))}"`);
    expect(html.indexOf('data-act="call-decline"')).toBeLessThan(html.indexOf('data-act="call-accept"'));
  });

  it("keeps the name in the byline when even the first name is too long for the headline", () => {
    const html = NC.ringCard(ring({ caller: { ...ADA, name: "Adaezechukwuemekaobiokonkwo Obi" } }), E);
    expect(html).toContain('id="nc-hl">Incoming call</h3>');
    expect(html).toContain("<b>Adaezechukwuemekaobiokonkwo Obi</b>");
    expect(html).toContain(`>${CALL_WORDS.incoming.direct}</p>`);
  });

  it("one ringer: the poll tells the server whether the notch rings aloud", () => {
    const main = readFileSync(fileURLToPath(new URL("../../desktop/src/main.js", import.meta.url)), "utf8");
    expect(main).toContain("const ringsAloud = () => soundsOn && !quietNow();");
    expect(main).toContain('call("GET", org(`/calls/now?ring=${ringsAloud() ? 1 : 0}`))');
    expect(main).toMatch(/listen\("brenda:\/\/sounds", \(\{ payload \}\) => \{ soundsOn = payload !== false;[^\n]*kickCalls\(\); \}\);/);
  });

  it("says who is calling in the compact bar, with Accept", () => {
    const b = NC.ringBar(ring(), E);
    expect(b.text).toBe("<b>Ada</b> is calling");
    expect(b.trail).toContain('data-act="call-accept"');
    expect(b.label).toBe("Ada is calling");
    expect(NC.ringBar(null, E).text).toBe("");
  });

  it("says the person is on a call, with the call's clock from when it was answered", () => {
    const active = { id: CALL, kind: "group", where: { kind: "team", name: "#Design" }, startedAt: new Date(NOW - 800_000).toISOString(), answeredAt: new Date(NOW - 724_000).toISOString(), joinedAt: new Date(NOW - 60_000).toISOString(), inRoom: 3, href: `/app/k/calls/${CALL}` };
    const b = NC.callBar(active, E);
    expect(b.text).toBe('<span class="clock live" id="cclock" role="timer">12:04</span>&ensp;On a call in #Design');
    expect(b.lead).toContain("nc-live");
    expect(NC.callBar({ ...active, answeredAt: null }, E).text).toContain(">1:00<");
    expect(NC.onCallWords({ where: { kind: "direct", name: "Ben Okafor" } })).toBe("On a call with Ben");
    expect(NC.onCallWords({ where: { kind: "direct", name: null } })).toBe("On a call");
    expect(NC.callBar({ ...active, where: { kind: "channel", name: "<b>x</b>" } }, E).text).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("keeps the same clock as the web (callClock in src/lib/calls.ts)", () => {
    for (const s of [0, 9, 42, 60, 724, 3599, 3600, 3729, 36_000, -5, 12.9]) expect(NC.callClock(s)).toBe(callClock(s));
  });
});

describe("what a ring does (Notify.ringAction)", () => {
  const table: [string, Parameters<NotifyApi["ringAction"]>[0], "show" | "bar" | "none"][] = [
    ["nothing rings", { ringing: false }, "none"],
    ["nothing rings, the call card open (it closes)", { ringing: false, cardKind: "call" }, "none"],
    ["it rings, nothing open", { ringing: true, cardKind: null }, "show"],
    ["it rings over a notification", { ringing: true, cardKind: "notification" }, "show"],
    ["it rings over the summary", { ringing: true, cardKind: "summary" }, "show"],
    ["it rings over the morning opener", { ringing: true, cardKind: "opener" }, "show"],
    ["quiet hours", { ringing: true, quiet: true }, "none"],
    ["quiet hours, the call card open", { ringing: true, quiet: true, cardKind: "call" }, "none"],
    ["quiet hours, the talk keys held", { ringing: true, quiet: true, micOpen: true }, "none"],
    ["the talk keys held", { ringing: true, cardKind: "voice", micOpen: true }, "bar"],
    ["a card being typed in", { ringing: true, cardKind: "followup_ask", sticky: true }, "bar"],
    ["the call card already open", { ringing: true, cardKind: "call" }, "show"],
  ];
  it.each(table)("%s: %s", (_, input, want) => expect(Notify.ringAction(input)).toBe(want));
  it("is quiet with nothing to go on", () => expect(Notify.ringAction(undefined as never)).toBe("none"));
});

describe("the ring poll's pace", () => {
  it("follows the server's pollMs, clamped to 2 to 60 s, 4 s when it sent none", () => {
    expect(Notify.ringPollMs(CALL_LIMITS.pollMs.idle)).toBe(4_000);
    expect(Notify.ringPollMs(CALL_LIMITS.pollMs.ringing)).toBe(2_000);
    expect(Notify.ringPollMs(CALL_LIMITS.pollMs.notReady)).toBe(60_000);
    expect(Notify.ringPollMs(10)).toBe(2_000);
    expect(Notify.ringPollMs(10 * 60_000)).toBe(60_000);
    for (const v of [undefined, null, "4000", NaN, Infinity]) expect(Notify.ringPollMs(v)).toBe(4_000);
    expect(Notify.CALL_POLL.MIN_MS).toBe(CALL_LIMITS.pollMs.min);
    expect(Notify.CALL_POLL.MAX_MS).toBe(CALL_LIMITS.pollMs.max);
  });
  it("waits 5 minutes for a server from before phase 8 (404), 15 s after any other failure", () => {
    expect(Notify.ringRetryMs(404)).toBe(300_000);
    for (const s of [500, 503, 429, undefined, 0]) expect(Notify.ringRetryMs(s)).toBe(15_000);
  });
});

describe("a missed call (call.missed) and a call's notes (call.recap)", () => {
  const BEN = { membershipId: "b1a00000-0000-4000-8000-000000000002", name: "Ben Okafor", assistant: { ...NOVA, name: "Max" } };
  const facts = (o: Record<string, unknown> = {}) => ({ v: 1, kind: "call", callId: CALL, from: { membershipId: ADA.membershipId, name: ADA.name, assistant: NOVA }, where: null, direct: true, at: new Date(NOW - 240_000).toISOString(), live: false, callBack: { membershipId: ADA.membershipId }, ...o });
  const n = (f: unknown, o: Record<string, unknown> = {}) => ({ id: "n1", type: "call.missed", title: "Missed call from Ada Obi", body: null, href: `/app/k/calls/${CALL}`, resource_id: CALL, created_at: new Date(NOW - 200_000).toISOString(), facts: f, ...o });
  const card = (f: unknown, o: Record<string, unknown> = {}) => NC.card({ kind: "notification", n: n(f, o) }, E);
  const main = (html: string) => /<button [^>]*data-main[^>]*>/.exec(html)?.[0] ?? "";

  it("offers Join while the call is still on", () => {
    const html = card(facts({ live: true, direct: false, where: "#Design", callBack: null, from: BEN }));
    expect(main(html)).toContain('data-act="call-join"');
    expect(main(html)).toContain(`data-call="${CALL}"`);
    expect(main(html)).toContain('data-read-id="n1"');
    expect(main(html)).toContain("accent");
    expect(html).toContain('id="nc-hl">Missed call from Ben Okafor</h3>');
    expect(html).toContain("<b>Ben</b>, in #Design");
    expect(html).toContain("The call is still going.");
  });

  it("on another call, says so and offers Leave it and join, which leaves that call first (fix review, 10 October 2026)", () => {
    const live = facts({ live: true, direct: false, where: "#Design", callBack: null, from: BEN });
    const html = NC.card({ kind: "notification", n: n(live) }, E, { leaveOther: true });
    expect(main(html)).toContain('data-act="call-join"');
    expect(main(html)).toContain(`data-call="${CALL}"`);
    expect(main(html)).toContain('data-leave-other="1"');
    expect(main(html)).toContain("accent");
    expect(html).toContain(`${esc(CALL_WORDS.leaveAndJoin)}</button>`);
    expect(html).toContain(`>${esc(CALL_WORDS.errors.inAnotherCall)}</p>`);
    expect(count(html, / data-main/g)).toBe(1);
    expect(accentButtons(html)).toHaveLength(1);
    // Not on another call: plain Join, nothing about leaving.
    const plain = card(live);
    expect(plain).not.toContain("data-leave-other");
    expect(plain).toContain(`${esc(CALL_WORDS.join)}</button>`);
    expect(plain).not.toContain(esc(CALL_WORDS.errors.inAnotherCall));
    // A call that ended has nothing to leave for: Call back, as before.
    const ended = NC.card({ kind: "notification", n: n(facts()) }, E, { leaveOther: true });
    expect(main(ended)).toContain('data-act="call-back"');
    expect(ended).not.toContain("data-leave-other");
    expect(ended).not.toContain(esc(CALL_WORDS.errors.inAnotherCall));
  });

  it("offers Call back for a direct call that ended", () => {
    const html = card(facts());
    expect(main(html)).toContain('data-act="call-back"');
    expect(main(html)).toContain(`data-to="${ADA.membershipId}"`);
    expect(html).toContain("<b>Ada</b>, direct call");
    expect(html).toContain('class="face  sad"');
  });

  it("offers Open for a group call that ended (and OK reads it)", () => {
    const html = card(facts({ direct: false, where: "#Design", callBack: null }));
    expect(main(html)).toContain('data-act="open-href"');
    expect(main(html)).toContain(`data-href="/app/k/calls/${CALL}"`);
    expect(html).toContain('data-act="read" data-id="n1"');
    // Without a page to open, OK is the main action.
    expect(main(card(facts({ direct: false, callBack: null }), { href: "javascript:alert(1)" }))).toContain('data-act="read"');
  });

  it("has one main action and at most one orange button, whatever it is", () => {
    for (const f of [facts(), facts({ live: true }), facts({ direct: false, callBack: null }), facts({ callBack: { membershipId: "not-an-id" } }), null, { v: 1, kind: "call" }]) {
      const html = card(f);
      expect(count(html, / data-main/g)).toBe(1);
      expect(accentButtons(html).length).toBeLessThanOrEqual(1);
    }
  });

  it("draws the plain card without its facts, or with an id that is not one", () => {
    expect(NC.cardInfo({ kind: "notification", n: n(null) }, E).template).toBe("plain");
    expect(NC.cardInfo({ kind: "notification", n: n(facts({ callId: "x" })) }, E).template).toBe("plain");
    expect(NC.cardInfo({ kind: "notification", n: n(facts()) }, E).template).toBe("call");
    // A Call back to an id that is not one is not offered: Open instead.
    expect(main(card(facts({ callBack: { membershipId: '"><b>' } })))).toContain('data-act="open-href"');
  });

  it("writes headlines of 30 characters or fewer", () => {
    const html = card(facts({ from: { ...ADA, name: "Bartholomew Chukwuemeka-Okonkwo" } }));
    expect(html).toContain('id="nc-hl">Missed call from Bartholomew</h3>');
    expect(card(facts({ from: { ...ADA, name: "Bartholomewbartholomewbart Obi" } }))).toContain('id="nc-hl">Missed call</h3>');
  });

  it("is people's news in the bar and the summary: the caller's face, sad, and where", () => {
    const x = NC.notice(n(facts({ direct: false, where: "#Design" })), E);
    expect(x).toMatchObject({ family: "talk", group: "people", line: "Missed call in #Design", sender: { label: "Ada", mood: "sad" } });
    expect(NC.notice(n(facts()), E).line).toBe("Missed call");
  });

  it("draws a call's notes as the plain card, from the workspace's assistant", () => {
    const html = NC.card({ kind: "notification", n: { ...n(null), type: "call.recap", title: "Notes from your call with Ada", body: "We agreed it ships Friday." } }, env({ ws: { ...BRENDA, name: "Atlas" } }));
    expect(html).toContain('data-template="plain"');
    expect(html).toContain("<b>Atlas</b>, call notes");
    expect(html).toContain('data-act="open-href"');
  });
});

describe("the notch's scripts", () => {
  it("parse as plain JavaScript (node --check), as the notch loads them", () => {
    for (const f of ["desktop/src/notify-cards.js", "desktop/src/notify.js", "desktop/src/main.js", "desktop/src/sound.js"]) {
      expect(() => execFileSync(process.execPath, ["--check", f], { stdio: "pipe" })).not.toThrow();
    }
  });
  it("ring with the web's pattern, and say nothing more of screen recording", () => {
    const sound = readFileSync(fileURLToPath(new URL("../../desktop/src/sound.js", import.meta.url)), "utf8");
    expect(sound).toMatch(/ring: \(\) => \{ \[0, 0\.4\]\.forEach/);
    const main = readFileSync(fileURLToPath(new URL("../../desktop/src/main.js", import.meta.url)), "utf8");
    expect(main).not.toMatch(/captureMode:/);
    expect(main).not.toContain('"capture.exception"');
    expect(main).toContain('setTimeout(pollCalls, next)');
    expect(main).not.toMatch(/setInterval\(pollCalls/);
    expect(readFileSync(cardsFile, "utf8")).not.toMatch(/"capture\.exception": T\(/);
  });
  it("join a missed call by leaving another one only from the card that says so, and never dead-end on 409", () => {
    const main = readFileSync(fileURLToPath(new URL("../../desktop/src/main.js", import.meta.url)), "utf8");
    // The button's choice reaches the server; a plain Join sends nothing extra.
    expect(main).toContain('joinMissed(target.dataset.call, target.dataset.readId, target.dataset.leaveOther === "1")');
    expect(main).toContain("call(\"POST\", org(`/calls/${id}/accept`), leaveOther ? { leaveOther: true } : {})");
    // The server's 409 IN_ANOTHER_CALL turns the card into the choice; the card's options carry it to NotifyCards.
    expect(main).toMatch(/if \(!leaveOther && err\?\.code === "IN_ANOTHER_CALL" && c && card === c\) \{ c\.joinLeaves = id; return render\(\); \}/);
    expect(main).toMatch(/c\.n\?\.type === "call\.missed" && missedJoinLeaves\(c\)\) o\.leaveOther = true;/);
  });
});
