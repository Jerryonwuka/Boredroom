// Brenda's notch (owner decision, 3 October 2026). Plain JavaScript, no build step.
//
// Signed out: a link code to approve in Boredroom. Signed in: a compact bar (Brenda's face, the running timer or what
// is due), which opens into one card at a time: Brenda's notifications (clock-in, reminders, nudges, assignments), the
// morning briefing once a day, or the timer with its progress ring. Cards close on their own after a few seconds
// unless the pointer is on them. Every action goes through Boredroom's own API with the person's permissions.
//
// Voice, step one (owner decision, 3 October 2026): hold the talk shortcut, speak, let go. The Rust side records only
// while the keys are held, turns the speech into text on this computer and sends `brenda://voice` events; this page
// shows each step, sends the text to Brenda's chat, shows and speaks the reply, and offers Confirm for anything Brenda
// prepared that needs a yes.
//
// Motion, face and sound (owner decision, 4 October 2026; ideas and timings from Coucou by Louis Raillé, MIT — its
// character, sounds and artwork are not used): the window is a fixed transparent stage and the island inside it springs
// open and eases shut; content blurs in once per view; Brenda's eyes follow the cursor, she blinks and breathes, and her
// face and the card's glow follow what is happening; small synthesised sounds mark opening, arrivals, success and voice.
//
// Also from Coucou (owner decision, 4 October 2026): drop a file on Brenda to attach it to one of your tasks and send it
// for review; team leads see small faces for the teammates who are working; the notch tucks away when nothing needs you
// and peeks out when the pointer reaches the top of the screen; and Brenda reacts to being poked or admired.
//
// The notch follows the web (owner decision, 5 October 2026): the timer laid out like My Day's, and what is said to
// Brenda up here kept with her past chats in Boredroom, so it can be carried on there. A Confirm that already ran counts
// as done, and nothing here points at the Reports or Policy pages, which are gone.
//
// Design system v4 (owner decision, 6 October 2026): style.css follows the web's v4 (the ElevenLabs app's language, with
// orange as the accent): Inter, near-black surfaces and hairlines, white primary pills, outline and ghost buttons, badges
// on fill-1, orange only for focus, the unread count, the open microphone and the timer's estimate and progress. The
// voice card matches the web's (src/components/app/voice-capture.tsx) in the same restyle. Only the markup changed here;
// shape, motion and behaviour are as they were.
//
// The accent rules (owner decision, 6 October 2026: "it looks too monochromatic, let's add nice accents of orange"):
// orange marks what is live, active, chosen or the one thing to do, as on the web (docs/design-system.md). Here that is
// a running timer's dot and digits (`live`), Brenda listening or working, teammates' running timers, progress, the
// unread count, the ask pill's focus ring, and one standout button per card (`btn primary accent`): Send once there are
// words, Start on the briefing, Resume on a paused timer, Link to Boredroom / Open Boredroom, Turn on voice. style.css
// turns the card's other orange button white while Send is lit. Only classes changed; behaviour is as it was.
//
// The recording look and her reactions (owner decisions, 7 October 2026: "I want our voice note recording to look exactly
// like ElevenLabs' one, the whole wave thing when recording, let the change also reflect in the notch", and "I want
// Brenda to give reactions when you do actions"). While the talk keys are held the voice card shows the live waveform
// (`Wave` below, the web's src/components/ui/live-waveform.tsx in plain JavaScript) with the time running beside the
// orange live dot, and Brenda listens: her eyes widen and swell with the voice, her glow with them. While the person
// types in the ask box her eyes read along, following the caret; once it is sent she thinks; a reply pleases her. The
// island's shape, hover-open, click-through and every action are as they were.
//
// Replies easy to scan and icons that move (owner requests, 7 October 2026: "if you're listing things, it should not be in
// a paragraph; list it", and "I want our icons to be animated icons"). Her replies arrive as light Markdown and are drawn
// here as on the web: paragraphs, bulleted and numbered lists, bold, and links to Boredroom pages (`md` below, which
// escapes every piece of text it is given and writes only its own few tags); the spoken version stays plain (`plain`).
// The icons on buttons play a small move once on hover and keyboard focus (style.css, "Icons that move"), as the web's
// animated icons do; never a loop, and nothing under reduced motion.
//
// Personal assistants (owner decision, 7 October 2026: phase 1). Each person has their own assistant in each workspace,
// with a name, a sphere colour, a visor and eyes (Brenda as she is unless they choose otherwise); the workspace has one of
// its own that signs what it sends by itself. The desktop state carries both, resolved, with the face colours to draw
// (`assistant`; this page cannot import src/lib/assistant-look). Every face here is the person's own assistant and every
// label names it ("Ask Max…", "Max is on it…"); the end-of-day report's card shows the workspace's. Signed out, and where
// the words name the product (the plan gate), she is Brenda. The last profile seen is kept per workspace on this
// computer, so the first paint after launch already shows theirs. Teammates' small faces are unchanged.
//
// Her voice (owner decision, 7 October 2026: phase 2). She reads her replies aloud with the Mac's own voice when the
// person chose so in Boredroom (`data.assistant.speak`: "voice", the default, answers aloud what was said with the talk
// keys; "always"; "never"), saying the words the server made speakable (`spoken`: no Markdown, links, ids or tokens;
// `plain` stays for an older server). Rust renders the reply, measures it and sends `speaking` with the real level of
// what is playing every 30 ms, then `spoken`; meanwhile her own faces talk (`.face.talk` and `--talk` in style.css): her
// eyes squash and open with each syllable, she bobs a little and her glow brightens in her own colour, and under reduced
// motion she holds a still speaking pose. When Rust could only speak the plain way (`synthetic`), this page makes the
// syllables itself. The reply card has a Listen / Stop button whatever the preference and stays open while she talks;
// she stops when the person types to her, asks something new, closes the card or signs out (the talk keys stop her in
// Rust, and she never speaks over an open microphone).
//
// Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4). "Instead of following up
// with the people, the assistants follow up with each other's assistants." When someone's assistant asks about the
// person's work and their work does not answer it, their own assistant asks them once: an unread `brenda.followup_ask`
// whose follow-up is waiting (the desktop state's `followUps.waiting`) opens the request card, which stays until it is
// answered, Not now or Esc. It shows the asker's assistant, the question quoted, when the reply is due, four quick replies
// (On track, Blocked, Done, Not started), a one-line note typed or said (while it is open the talk keys write into the
// note instead of asking her), what their assistant will share, and that a reply never changes the task. Not now tells
// the asker's assistant they can't answer right now. The person's own follow-ups come back as `brenda.followup_answer`
// (or `brenda.followup_batch` for a group): the answer card shows both assistants' faces and the answer as plain text,
// never Markdown, with Open and Done. Everything other people wrote goes through esc() only, and only Boredroom paths
// open. An older server (no `followUps`) gets the plain notification cards, as before.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const island = document.getElementById("island");
const el = document.getElementById("notch");
const countdown = document.getElementById("countdown");
const COMPACT = { w: 220, h: 40 };
const PEEK = 14;            // the compact bar widens a little under the pointer
const WIDE = 420;
const POLL_MS = 20_000;
const PRESENCE_MS = 10 * 60_000;
const CLOSE_AFTER_MS = 8_000;

let config = null;          // { baseUrl, signedIn, workspaceSlug, workspaceName, displayName }
let data = null;            // the last desktop state from Boredroom
let offsetMs = 0;           // server clock minus ours, for the timer
let link = null;            // { deviceCode, userCode, verifyUrl, interval, expiresAt }
let card = null;            // what is open: { kind, ... } or null for the compact bar
const shown = new Set();    // notification ids already shown on this run
let closeTimer = null, pollTimer = null, linkTimer = null, presenceTimer = null;
let hovering = false, busy = false, error = null, editingServer = false;
let voice = { enabled: false, modelReady: false, downloading: false, shortcut: "⌥ Space" };
let talk = [];              // the spoken conversation so far, forgotten after a few quiet minutes
let talkAt = 0;
let cursor = null;          // the cursor in window coordinates, from Rust (for the eyes and hover)
let gaze = null;            // the caret in the ask box while the person types to her (she reads along), or null
// The boxes the person types in: the ask box, and a follow-up's note (phase 4, 8 October 2026). Typing in either keeps
// the notch focused, cuts her off and has the face on the card read along.
const TYPING = new Set(["ask", "fnote"]);
let viewKey = "";           // which view is showing; content animates in only when it changes
let wasOpen = false;
let tucked = false, tuckTimer = null, alwaysVisible = false;
let fx = null, fxTimer = null, loveTimer = null;   // a passing reaction on Brenda's face: squash, dizzy, love
const pokes = [];
// Her voice (owner decision, 7 October 2026): she is talking (Rust said `speaking`), the pulse standing in for levels
// when Rust has none (`synthetic`), she was asked to speak and has not started yet (rendering takes a moment), and the
// last level, put back on her faces after a render.
let talking = false, talkSynthetic = null;
let talkWaiting = false, talkWaitTimer = null, talkLast = 0;
const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const TUCK = { w: 96, h: 5 };
const TALK_MEMORY_MS = 3 * 60_000;
const REPLY_CLOSE_MS = 16_000;

// ---- helpers -------------------------------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The person's assistant (owner decision, 7 October 2026: personal assistants). The desktop state's `assistant` is
// { personal, workspace }, each { name, colour, visor, eyes, face: { hi, mid, edge } } (src/server/services/desktop.ts).
// Nothing from it is drawn unchecked: the visor and eyes must be one of their three shapes, the face colours #rrggbb (else
// Brenda's three), and the name goes into the page only through esc() or as an attribute set by the DOM.
const BRENDA = { name: "Brenda", colour: "white", visor: "bean", eyes: "pill", face: { hi: "#ffffff", mid: "#ececf0", edge: "#c9cad1" } };
const VISORS = ["bean", "band", "screen"];
const EYES = ["pill", "round", "square"];
const HEX = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 24;        // the server's rule (src/lib/assistant-look.ts); a longer one is cut, never trusted
let cached = null;          // the person's assistant as last seen in this workspace on this computer (localStorage)

/** A profile as the notch may draw it: anything missing or unexpected is Brenda's. */
function assistantOf(p) {
  if (!p || typeof p !== "object") return BRENDA;
  const name = typeof p.name === "string" ? [...p.name.replace(/\s+/g, " ").trim()].slice(0, NAME_MAX).join("").trim() : "";
  const f = p.face && typeof p.face === "object" ? p.face : {};
  const shades = [f.hi, f.mid, f.edge].every((v) => typeof v === "string" && HEX.test(v));
  return {
    name: name || BRENDA.name,
    colour: typeof p.colour === "string" && /^[a-z]{1,16}$/.test(p.colour) ? p.colour : BRENDA.colour,
    visor: VISORS.includes(p.visor) ? p.visor : BRENDA.visor,
    eyes: EYES.includes(p.eyes) ? p.eyes : BRENDA.eyes,
    face: shades ? { hi: f.hi, mid: f.mid, edge: f.edge } : BRENDA.face,
  };
}
/** The person's own assistant in this workspace (Brenda while signed out). */
const me = () => (config?.signedIn ? assistantOf(data?.assistant?.personal ?? cached) : BRENDA);
/** The workspace's own assistant, which signs the end-of-day team report. */
const ws = () => (config?.signedIn ? assistantOf(data?.assistant?.workspace) : BRENDA);
const cacheKey = () => `brenda-assistant:${config?.workspaceSlug ?? ""}`;
/** The first paint after launch draws the assistant last seen in this workspace, before the first poll answers. */
function loadCached() {
  cached = null;
  if (!config?.signedIn || !config.workspaceSlug) return;
  try { const raw = localStorage.getItem(cacheKey()); if (raw) cached = assistantOf(JSON.parse(raw)); } catch { /* storage blocked or unreadable */ }
}
/** Each poll keeps the person's assistant for next time (written only when it changed). */
function keepCached() {
  const p = data?.assistant?.personal;
  if (!p || !config?.signedIn || !config.workspaceSlug) return;
  const next = assistantOf(p), json = JSON.stringify(next);
  if (cached && JSON.stringify(cached) === json) return;
  cached = next;
  try { localStorage.setItem(cacheKey(), json); } catch { /* storage blocked */ }
}

/**
 * Brenda's face, drawn as the person's own assistant (or `o.who`, such as the workspace's): its sphere colours, visor
 * and eyes (style.css `--sphere-*`, `data-visor`, `data-eyes`). mood: happy | alert | sad | think | listen; tone: the
 * glow (accent, ok, warn, bad; blue and violet draw none). Her own faces (`data-own`, no `o.who`) talk while she speaks
 * (`talk`, owner decision, 7 October 2026: her voice); the workspace's assistant never does.
 */
const face = (o = {}) => {
  const a = assistantOf(o.who ?? me());
  const own = !o.who;
  return `<span class="face ${o.small ? "small" : ""} ${o.mood ?? ""}${own && talking ? " talk" : ""}"${own ? " data-own" : ""} data-sphere="${esc(a.colour)}" data-visor="${esc(a.visor)}" data-eyes="${esc(a.eyes)}" style="--sphere-hi:${esc(a.face.hi)};--sphere-mid:${esc(a.face.mid)};--sphere-edge:${esc(a.face.edge)}" ${o.tone ? `data-tone="${esc(o.tone)}"` : ""}><span class="eyes"><span></span><span></span></span>${o.dot ? `<i class="dot ${esc(o.dot)}"></i>` : ""}</span>`;
};
/** A teammate's small face, in a colour of their own (style.css `--mate-*`), with a dot when their timer is running (orange), paused (amber) or interrupted (red). */
const MATES = 8;
const hue = (id) => `var(--mate-${[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % MATES})`;
const who = (p) => `${esc(p.name)}${p.task ? `, ${esc(p.task)}` : ""}`;
const mini = (p) => `<span class="face mini" style="--c:${hue(p.id)}" title="${who(p)}"><span class="eyes"><span></span><span></span></span>${p.state ? `<i class="st ${esc(p.state)}"></i>` : ""}</span>`;
const pad = (n) => String(n).padStart(2, "0");
const hms = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
/** A length of time the way the web writes it: "3h 00m", "45m". */
const dur = (minutes) => { const m = Math.max(0, Math.round(minutes)); return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`; };
const when = (iso) => { if (!iso) return ""; const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return d.toLocaleString(undefined, today ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" }); };
const org = (path) => `/api/orgs/${config.workspaceSlug}${path}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** The task's progress ring, as the web's ProgressArc (tone accent): orange over a 10% track, green once done, the percentage in the middle. */
const ring = (value) => {
  const p = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const r = 14.5, c = 2 * Math.PI * r, done = p >= 100;
  return `<svg class="ring" viewBox="0 0 32 32" role="img" aria-label="${p}% done"><circle class="track" cx="16" cy="16" r="${r}"/>${p > 0 ? `<circle class="arc ${done ? "full" : ""}" cx="16" cy="16" r="${r}" stroke-linecap="round" stroke-dasharray="${((p / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 16 16)"/>` : ""}<text class="${done ? "full" : ""}" x="16" y="16" dy=".35em" text-anchor="middle">${p}%</text></svg>`;
};
/** Line icons for controls, drawn like the web's lucide set. Never a generic AI icon: Brenda is her face. */
const ICONS = {
  mic: `<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>`,
  send: `<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`,
  pause: `<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>`,
  play: `<polygon points="6 3 20 12 6 21 6 3"/>`,
  stop: `<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>`,
  check: `<path d="M20 6 9 17l-5-5" pathLength="1"/>`,
  shield: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`,
  open: `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`,
  plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
  alarm: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>`,
  volume: `<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`,
  chevron: `<path d="m9 18 6-6-6-6"/>`,
};
/** An icon; its class (`ic-<name>`) picks the small move it makes when its button is hovered or focused (style.css). */
const icon = (name) => `<svg class="ic ic-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
// The Reports and Policy pages are gone (owner decision, 5 October 2026): an older notification or answer that still
// points at one gets no Open button.
const removedPage = (href) => /^(?:https?:\/\/[^/]+)?\/app\/[^/?#]+\/(?:reports|policy)(?:[/?#]|$)/.test(String(href ?? ""));
/** How far the running session is through its estimate, 0 to 1, or null without one. */
const estimateShare = () => { const t = data?.timer; return t?.estimateMinutes ? Math.min(1, elapsed() / (t.estimateMinutes * 60)) : null; };

function elapsed() {
  const t = data?.timer; if (!t) return 0;
  if (t.state !== "running" || !t.openIntervalStartedAt) return t.confirmedSeconds;
  return t.confirmedSeconds + Math.max(0, Math.floor((Date.now() + offsetMs - Date.parse(t.serverNow)) / 1000));
}

async function call(method, path, body) {
  try { return await invoke("api", { method, path, body: body ?? null }); }
  catch (e) {
    if (e && e.status === 401) { await signedOut(); throw e; }
    throw e;
  }
}

// ---- size and placement ---------------------------------------------------------------------------------------

/** Sizes the island to its content. Opening springs (with a little overshoot), closing eases, like Coucou's island. */
function fit() {
  const open = !!card || !config?.signedIn;
  island.classList.toggle("open", open);
  island.classList.toggle("growing", open && !wasOpen);
  const tuck = tucked && !open;
  island.classList.toggle("tucked", tuck);
  el.style.width = `${open ? WIDE : COMPACT.w}px`;
  const w = open ? WIDE : tuck ? TUCK.w : COMPACT.w + (hovering ? PEEK : 0);
  const h = open ? Math.ceil(el.offsetHeight) : tuck ? TUCK.h : COMPACT.h;
  if (open !== wasOpen) Sound.play(open ? "open" : "close");
  wasOpen = open;
  island.style.width = `${w}px`;
  island.style.height = `${h}px`;
  invoke("set_island_rect", { x: (window.innerWidth - w) / 2, y: 0, w, h }).catch(() => {});
}

/** The card's glow and Brenda's mood follow what is showing. */
function moodOf() {
  if (!config?.signedIn || !card) return data?.timer?.state === "running" ? { tone: "blue" } : {};
  if (card.kind === "notification") {
    const t = card.n.type;
    if (t === "brenda.clock_in") return { mood: "happy", tone: "ok" };
    if (t === "brenda.daily_report") return { mood: "happy", tone: "violet" };
    if (t.startsWith("review")) return { mood: "alert", tone: "warn" };
    return { mood: "alert", tone: "accent" };
  }
  if (card.kind === "error") return { mood: "sad", tone: "bad" };
  // Follow-ups (owner decision, 8 October 2026: phase 4): an ask waits on the person (alert, the accent glow) until it is
  // sent (happy, green); an answer pleases only when it is one (happy, green), and a no-reply, a not now or a failure
  // stays neutral.
  if (card.kind === "followup_ask") return card.phase === "sent" ? { mood: "happy", tone: "ok" } : card.phase === "gone" ? {} : { mood: "alert", tone: "accent" };
  if (card.kind === "followup_answer") return !card.a || card.a.status === "answered" ? { mood: "happy", tone: "ok" } : {};
  if (card.kind === "drop") {
    if (card.phase === "over") return { mood: "gulp", tone: card.hot ? "ok" : "blue" };
    if (card.phase === "uploading") return { mood: "think", tone: "violet" };
    return { mood: "happy", tone: "ok" };
  }
  if (card.kind === "home" && data?.timer) return { tone: "blue" };
  if (card.kind === "voice") {
    if (card.phase === "error") return { mood: "sad", tone: "bad" };
    if (card.phase === "listening") return { mood: "listen", tone: "accent" };
    if (card.phase === "thinking" || card.phase === "transcribing" || card.phase === "downloading") return { mood: "think", tone: "violet" };
    if (card.phase === "ready") return { mood: "happy", tone: "ok" };
    if (card.phase === "reply") {
      if ((card.proposals ?? []).some((p) => p.kind === "confirm")) return { mood: "alert", tone: "warn" };
      // An answer pleases her: happy eyes and a small hop as it arrives (green glow when she did something).
      if (card.actions?.length) return { mood: "happy pleased", tone: "ok" };
      return { mood: "happy pleased" };
    }
  }
  return {};
}

/** The bar that shows when an open card will fold away; it pauses while the pointer is on the island. */
function restartCountdown(ms) {
  countdown.classList.remove("run");
  if (!ms) return;
  countdown.style.animationDuration = `${ms}ms`;
  void countdown.offsetWidth;
  countdown.classList.add("run");
}

function scheduleClose() {
  clearTimeout(closeTimer);
  if (!card || card.sticky) return;
  const ms = card.closeAfter ?? CLOSE_AFTER_MS;
  closeTimer = setTimeout(() => { if (!hovering) closeCard(); else scheduleClose(); }, ms);
  restartCountdown(ms);
}

function openCard(c) { card = c; restartCountdown(0); render(); scheduleClose(); }
// Closing a card (Done, Esc, leaving it, opening a link or the chat in Boredroom) stops her (owner decision, 7 October 2026).
function closeCard() { hush(); card = null; error = null; restartCountdown(0); render(); setTimeout(nextNotification, 600); }

// Brenda opens the moment the pointer reaches her and folds away as soon as it leaves (owner decision, 5 October 2026;
// a click in the menu bar strip does not reach her anyway). A card that is waiting on the person stays open: something
// to confirm, a question being typed, the mic listening, a file being attached. The short grace on leaving only
// stops her flickering when the pointer grazes her edge while she is still growing.
const LEAVE_GRACE_MS = 120;
let leaveTimer = null;
function setHover(on) {
  if (on === hovering) return;
  hovering = on;
  island.classList.toggle("hover", on);
  clearTimeout(leaveTimer);
  if (on && !card && config?.signedIn) { tucked = false; openCard({ kind: "home" }); }
  else if (!on && card && !card.sticky) leaveTimer = setTimeout(() => { if (!hovering && card && !card.sticky) closeCard(); }, LEAVE_GRACE_MS);
  else if (!card) fit();
  updateTuck();
}

/** Nothing needs the person (no card, no timer, nothing unread): tuck the notch away after a moment. */
function idle() {
  return !!config?.signedIn && !card && !alwaysVisible && !data?.timer && !(data?.notifications ?? []).some((n) => !shown.has(n.id));
}
function updateTuck() {
  clearTimeout(tuckTimer);
  if (!idle() || hovering) { if (tucked) { tucked = false; fit(); } return; }
  if (!tucked) tuckTimer = setTimeout(() => { if (idle() && !hovering) { tucked = true; fit(); } }, 1500);
}
island.addEventListener("pointerenter", () => setHover(true));
island.addEventListener("pointerleave", () => setHover(false));
island.addEventListener("pointerdown", () => Sound.unlock());

// ---- rendering ---------------------------------------------------------------------------------------------------

function render() {
  el.classList.toggle("compact", !!config?.signedIn && !card);
  const key = !config?.signedIn ? `link:${!!link}:${editingServer}` : card ? `${card.kind}:${card.phase ?? ""}:${card.n?.id ?? card.w?.id ?? ""}` : "compact";
  // A follow-up's note keeps its words (they live on the card), its focus and its caret when the card is drawn again.
  const noting = document.activeElement?.id === "fnote" ? { from: document.activeElement.selectionStart, to: document.activeElement.selectionEnd } : null;
  if (!config?.signedIn) el.innerHTML = linkView();
  else if (!card) el.innerHTML = compactView();
  else el.innerHTML = `${cardView()}${error ? `<p class="err">${esc(error)}</p>` : ""}`;
  if (noting) { const n = document.getElementById("fnote"); if (n && !n.disabled) { n.focus(); try { n.setSelectionRange(noting.from, noting.to); } catch { /* not a text field any more */ } } }
  el.setAttribute("aria-label", me().name); // the notch is named after the person's assistant (Brenda while signed out)
  const m = moodOf();
  island.dataset.tone = m.tone ?? "";
  if (key !== viewKey) {
    viewKey = key;
    el.classList.remove("enter", "steady"); void el.offsetWidth; el.classList.add("enter");
  } else el.classList.add("steady"); // the same view drawn again (busy, a poll, a sent reply): no second blur-in (review, 8 October 2026)
  if (gaze && !TYPING.has(document.activeElement?.id)) gaze = null; // the box she was reading has gone
  fit();
  applyFx();
  if (talking) talkLevel(talkLast); // the faces were drawn again: the level she is at, at once
  stepFace();
  updateTuck();
}

/** Team leads and organisation accounts: who is working right now, each with their own small face. */
function teamView() {
  const team = data?.team ?? [];
  if (!team.length) return "";
  return `<div class="team">${team.slice(0, 6).map((p) => `<button class="mate" style="--c:${hue(p.id)}" data-act="open-href" data-href="/app/${esc(config.workspaceSlug)}/workroom" title="${who(p)}">${mini(p)}<span class="nm">${esc(p.name.split(" ")[0])}</span><span class="tk">${p.task ? esc(p.task) : p.state ? esc(cap(p.state)) : "Not working"}</span></button>`).join("")}</div>`;
}

function compactView() {
  const t = data?.timer;
  const b = data?.briefing;
  const unread = (data?.notifications ?? []).filter((n) => !shown.has(n.id)).length;
  const dot = data?.me?.presence ?? "active";
  let text = "All clear";
  if (t) text = `<span class="clock ${t.state === "running" ? "live" : ""}" id="tclock">${hms(elapsed())}</span>&ensp;${esc(t.taskTitle)}`;
  else if (b && (b.overdue.length || b.dueToday.length)) text = [b.dueToday.length ? `${b.dueToday.length} due today` : "", b.overdue.length ? `${b.overdue.length} overdue` : ""].filter(Boolean).join(", ");
  else if (data?.clock?.status === "not_in" && data.clock.workingDay) text = "Not clocked in yet";
  const working = (data?.team ?? []).filter((p) => p.state === "running" || p.state === "paused").slice(0, 3);
  return `<div class="row" data-act="home" aria-label="Open ${esc(me().name)}">${face({ small: true, ...moodOf(), dot })}<span class="tiny grow">${text}</span>${working.length ? `<span class="minis">${working.map(mini).join("")}</span>` : ""}${unread ? `<span class="count">${unread}</span>` : ""}</div>`;
}

function linkView() {
  if (editingServer) {
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Which Boredroom?</p><p class="sub">Leave empty for boredroom.cc. While developing, use http://localhost:3000.</p></div></div>
      <input class="field" id="server" value="${esc(config?.baseUrl ?? "")}" placeholder="https://boredroom.cc" spellcheck="false">
      <div class="actions"><button class="btn ghost" data-act="server-cancel">Cancel</button><button class="btn primary" data-act="server-save">Save</button></div>`;
  }
  if (!link) {
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Hi, I'm Brenda.</p><p class="sub">Link me to your Boredroom and I'll keep your day in view up here.</p></div></div>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
      <div class="actions"><button class="link" data-act="server">${esc(config?.baseUrl ?? "boredroom.cc")}</button><span class="grow"></span><button class="btn primary accent" data-act="link-start" ${busy ? "disabled" : ""}>Link to Boredroom</button></div>`;
  }
  return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Approve this code in Boredroom</p><p class="sub">Check it matches, pick your workspace, approve. I'll be ready in a few seconds.</p></div></div>
    <div class="code fade">${esc(link.userCode)}</div>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <div class="actions"><button class="btn ghost" data-act="link-cancel">Cancel</button><button class="btn primary accent" data-act="link-open">Open Boredroom</button></div>`;
}

function cardView() {
  const b = data?.briefing;
  if (card.kind === "notification") {
    const n = card.n;
    // Badges as on the web: neutral on fill-1, green for clocked in, amber for a review, and the orange "New" badge only
    // for a task that has just arrived.
    const pill = n.type === "brenda.reminder" ? `<span class="pill">Reminder</span>` : n.type === "brenda.clock_in" ? `<span class="pill ok"><span class="d"></span>In</span>` : n.type === "brenda.daily_report" ? `<span class="pill">Daily report</span>` : n.type === "task.assigned" ? `<span class="pill acc">New task</span>` : n.type.startsWith("review") ? `<span class="pill warn">Review</span>` : "";
    // The end-of-day report is sent by the workspace, so its card shows the workspace's assistant (owner decision,
    // 7 October 2026: personal assistants); everything else comes from the person's own.
    const from = n.type === "brenda.daily_report" ? ws() : me();
    return `<div class="row fade">${face({ ...moodOf(), who: from })}<div class="grow"><p class="title">${esc(n.title)}</p>${n.body ? `<p class="sub">${esc(n.body)}</p>` : `<p class="sub">${esc(when(n.created_at))}</p>`}</div>${pill}</div>
      <div class="actions">${n.href && !removedPage(n.href) ? `<button class="btn" data-act="open-href" data-href="${esc(n.href)}">Open${icon("open")}</button>` : ""}<button class="btn primary" data-act="read" data-id="${esc(n.id)}">${n.type === "brenda.reminder" ? "Done" : "OK"}</button></div>`;
  }
  if (card.kind === "briefing" && b) {
    const items = [
      ...b.overdue.map((t) => ({ t, k: "overdue", bad: true })),
      ...b.dueToday.map((t) => ({ t, k: `due ${when(t.due)}` })),
      ...b.dueTomorrow.map((t) => ({ t, k: "due tomorrow" })),
    ].slice(0, 3);
    const extra = [b.waitingForYourReview.length ? `${b.waitingForYourReview.length} waiting for your review` : "", b.assignmentsNotPickedUp.length ? `${b.assignmentsNotPickedUp.length} not picked up` : ""].filter(Boolean).join(", ");
    const first = items[0]?.t;
    const greet = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
    return `<div class="row fade">${face({ ...moodOf(), dot: data.me.presence })}<div class="grow"><p class="title">${greet}${config.displayName ? `, ${esc(config.displayName.split(" ")[0])}` : ""}. ${b.openTasks} open task${b.openTasks === 1 ? "" : "s"}.</p><p class="sub">${extra || (first ? `First up: ${esc(first.title)}` : "Nothing is waiting on you.")}</p></div></div>
      ${items.length ? `<ul class="list fade">${items.map((i) => `<li><span class="t">${esc(i.t.title)}</span><span class="k ${i.bad ? "bad" : ""}">${esc(i.k)}</span></li>`).join("")}</ul>` : ""}
      ${waitingView()}
      ${teamView()}
      ${askBox()}
      <div class="actions">${talkButton()}<button class="btn ghost" data-act="close">Later</button><button class="btn" data-act="open-href" data-href="/app/${esc(config.workspaceSlug)}/tasks">Tasks</button>${first && !data.timer && data.clock ? `<button class="btn primary accent" data-act="start" data-id="${esc(first.id)}" ${busy ? "disabled" : ""}>Start ${esc(first.title.length > 22 ? `${first.title.slice(0, 21)}…` : first.title)}</button>` : ""}</div>`;
  }
  if (card.kind === "home") {
    const t = data?.timer;
    if (t) {
      // Laid out like My Day's timer card: the task and its state on the left, the clock large on the right, the
      // estimate as an orange hairline underneath, and the controls with their words on them. Running, the dot and
      // digits are orange (live); paused, Resume is the card's orange standout action.
      const live = t.state === "running";
      const state = live ? "On the clock" : t.state === "paused" ? "Paused" : "Connection interrupted";
      const share = estimateShare();
      return `<div class="row fade">${face({ ...moodOf(), dot: data.me.presence })}<div class="grow"><p class="title">${esc(t.taskTitle)}</p><p class="sub"><span class="status"><span class="d ${esc(t.state)}"></span>${state}</span>${t.estimateMinutes ? `, estimated ${dur(t.estimateMinutes)}` : ""}</p></div><span class="big ${live ? "live" : "dim"}" id="tclock" role="timer">${hms(elapsed())}</span>${t.taskVersion ? `<button class="ring-btn" data-act="progress" title="Add 10% progress" aria-label="Add 10% progress">${ring(t.progress)}</button>` : ""}</div>
        ${share !== null ? `<div class="est fade" aria-hidden="true"><i id="testimate" style="transform:scaleX(${share.toFixed(3)})"></i></div>` : ""}
        ${askBox()}
        <div class="actions">${talkButton()}<button class="btn ghost" data-act="briefing">Today</button>${live ? `<button class="btn" data-act="pause" ${busy ? "disabled" : ""}>${icon("pause")}Pause</button>` : `<button class="btn primary accent" data-act="resume" ${busy ? "disabled" : ""}>${icon("play")}Resume</button>`}<button class="btn danger" data-act="stop" ${busy ? "disabled" : ""}>${icon("stop")}Stop</button></div>`;
    }
    card = { kind: "briefing" };
    return cardView();
  }
  if (card.kind === "voice") return voiceView();
  if (card.kind === "drop") return dropView();
  if (card.kind === "followup_ask") return followUpAskView();
  if (card.kind === "followup_answer") return followUpAnswerView();
  if (card.kind === "error") return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Can't reach Boredroom</p><p class="sub">${esc(card.message)}</p></div></div><div class="actions"><button class="btn" data-act="close">OK</button></div>`;
  return "";
}

// ---- actions -----------------------------------------------------------------------------------------------------

el.addEventListener("click", async (e) => {
  const f = e.target.closest(".face");
  if (f && card && !f.classList.contains("mini")) return poke();
  const target = e.target.closest("[data-act]");
  if (!target) return;
  const act = target.dataset.act;
  error = null;
  try {
    if (act === "home") return openCard({ kind: "home" });
    if (act === "close") return closeCard();
    if (act === "briefing") return openCard({ kind: "briefing" });
    if (act === "server") { editingServer = true; return render(); }
    if (act === "server-cancel") { editingServer = false; return render(); }
    if (act === "server-save") { config = await invoke("set_base_url", { url: document.getElementById("server").value }); editingServer = false; return render(); }
    if (act === "link-start") return startLink();
    if (act === "link-cancel") { link = null; clearTimeout(linkTimer); return render(); }
    if (act === "link-open") return invoke("open_in_browser", { path: link.verifyUrl });
    if (act === "open-href") { if (!removedPage(target.dataset.href)) await invoke("open_in_browser", { path: target.dataset.href }); return closeCard(); }
    if (act === "open-chat") return openChat();
    if (act === "listen") return aloud() ? hush() : sayAloud(card?.spokenText);
    if (act === "offer") return takeOffer(Number(target.dataset.i));
    if (act === "voice-on") { voice = await invoke("set_voice", { enabled: true }); return openCard({ kind: "voice", phase: voice.modelReady ? "ready" : "downloading", progress: 0, sticky: !voice.modelReady }); }
    if (act === "voice-setup") return openCard({ kind: "voice", phase: voice.enabled ? (voice.modelReady ? "ready" : "downloading") : "off", progress: 0 });
    if (act === "confirm") return confirmProposal(target.dataset.token);
    if (act === "drop-send") return sendDrop();
    if (act === "drop-task") { card.taskId = target.value; return; }
    if (act === "not-now") return declineConfirms(target.dataset.token);
    // Follow-ups (phase 4, 8 October 2026): pick a quick reply, send it (or Not now), see what will be shared, open the
    // task without losing the reply, or open a waiting ask from the day card.
    if (act === "fu-choice") return chooseReply(target.dataset.choice);
    if (act === "fu-send") return sendFollowUpReply(target.dataset.choice || null);
    if (act === "fu-facts") return toggleFacts(target);
    if (act === "fu-task") { const path = boredroomPath(target.dataset.href); if (path) await invoke("open_in_browser", { path }); return; }
    if (act === "fu-open") return openWaiting(target.dataset.id);
    if (act === "read") { await call("PATCH", org(`/notifications/${target.dataset.id}`)); data.notifications = data.notifications.filter((n) => n.id !== target.dataset.id); return closeCard(); }
    busy = true; render();
    const t = data?.timer;
    if (act === "start") await call("POST", org("/sessions/start"), { taskId: target.dataset.id, captureMode: "none" });
    if (act === "pause" && t) await call("POST", org(`/sessions/${t.id}/pause`), { expectedVersion: t.version });
    if (act === "resume" && t) await call("POST", org(`/sessions/${t.id}/resume`), { expectedVersion: t.version });
    if (act === "stop" && t) await call("POST", org(`/sessions/${t.id}/stop`), { expectedVersion: t.version, note: "", outcome: "continue_later" });
    if (act === "progress" && t?.taskVersion) await call("PATCH", org(`/tasks/${t.taskId}`), { expectedVersion: t.taskVersion, progressPercent: Math.min(100, (t.progress ?? 0) + 10) });
    busy = false;
    Sound.play(act === "start" || act === "stop" ? "success" : "tick");
    await refresh();
    openCard({ kind: act === "stop" ? "briefing" : "home" });
  } catch (err) {
    busy = false;
    error = err?.message ?? String(err);
    Sound.play("error");
    render();
  }
});

// ---- linking -----------------------------------------------------------------------------------------------------

async function startLink() {
  busy = true; error = null; render();
  try {
    const r = await invoke("link_start");
    link = { ...r, expiresAt: Date.now() + r.expiresIn * 1000 };
    await invoke("open_in_browser", { path: r.verifyUrl });
    pollLink();
  } catch (err) { error = err?.message ?? "Can't reach Boredroom."; link = null; }
  busy = false; render();
}

async function pollLink() {
  clearTimeout(linkTimer);
  if (!link) return;
  if (Date.now() > link.expiresAt) { link = null; error = "The code expired. Start again."; return render(); }
  try {
    const r = await invoke("link_poll", { deviceCode: link.deviceCode });
    if (r.status === "approved") { config = r.config; link = null; Sound.play("success"); return start(); }
  } catch (err) {
    if (err?.status === 410 || err?.status === 404) { link = null; error = err.message; return render(); }
  }
  linkTimer = setTimeout(pollLink, (link.interval ?? 3) * 1000);
}

async function signedOut() {
  clearInterval(pollTimer); clearInterval(presenceTimer);
  config = await invoke("sign_out"); // which also stops her; its `spoken` ends her talking face
  data = null; card = null; link = null; talk = []; chat = newChat(); cached = null;
  talkWaiting = false; clearTimeout(talkWaitTimer);
  render();
}

// ---- data --------------------------------------------------------------------------------------------------------

async function refresh() {
  try {
    data = await call("GET", org("/brenda/desktop"));
    offsetMs = Date.parse(data.serverNow) - Date.now();
    keepCached();
    if (!card) render();
    else followUpClosedElsewhere();
  } catch (err) {
    if (err?.status && err.status !== 401 && !card) openCard({ kind: "error", message: err.message });
  }
}

/** One Brenda notification at a time, newest first, only once per run. */
function nextNotification() {
  if (card || !data) return;
  const n = (data.notifications ?? []).find((x) => !shown.has(x.id));
  if (!n) return;
  shown.add(n.id);
  // A follow-up's ask or answer gets its own card when the desktop state knows it (phase 4); otherwise, and always with
  // an older server, the plain notification card.
  const fu = followUpCard(n);
  if (fu) { openCard(fu); return Sound.play(fu.kind === "followup_ask" ? "attention" : "reply"); }
  openCard({ kind: "notification", n });
  Sound.play(n.type === "brenda.clock_in" ? "success" : "notify");
}

/** The morning briefing, once per day per computer. */
function maybeBriefing() {
  const key = `brenda-briefing:${config.workspaceSlug}:${new Date().toDateString()}`;
  try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, "1"); } catch { /* storage blocked */ }
  if (!data?.briefing) return false;
  openCard({ kind: "briefing" });
  return true;
}

/** The activity signal for automatic clock-in: Boredroom decides whether it may clock the person in. */
async function presence() {
  if (!data?.brendaEnabled || !data.clock) return;
  try { const r = await call("POST", org("/brenda/presence")); if (r.clockedIn) await refresh(); } catch { /* not allowed or offline */ }
}

async function start() {
  loadCached();
  render();
  await refresh();
  if (!data) return;
  await presence();
  await refresh();
  if (!maybeBriefing()) nextNotification();
  clearInterval(pollTimer); pollTimer = setInterval(async () => { await refresh(); nextNotification(); }, POLL_MS);
  clearInterval(presenceTimer); presenceTimer = setInterval(presence, PRESENCE_MS);
}

// ---- voice -------------------------------------------------------------------------------------------------------

const mic = icon("mic");

/** Typing to Brenda: the same chat as talking, without the spoken reply. The send button lights up orange once there are words. */
function askBox(placeholder) {
  if (data && !data.brendaEnabled) return "";
  const name = me().name;
  return `<form class="ask fade" data-ask><input class="field" id="ask" name="q" maxlength="4000" placeholder="${esc(placeholder ?? `Ask ${name}…`)}" autocomplete="off" spellcheck="true" aria-label="${esc(`Message ${name}`)}"><button class="btn accent icon-send" aria-label="Send" title="Send">${icon("send")}</button></form>`;
}

el.addEventListener("submit", (e) => {
  // Return in a follow-up's note sends the reply once one is chosen.
  if (e.target.closest("[data-fu]")) { e.preventDefault(); return sendFollowUpReply(null); }
  const form = e.target.closest("[data-ask]");
  if (!form) return;
  e.preventDefault();
  const q = form.q.value.trim();
  if (q) ask(q, { spoken: false });
});
// While the person is typing, the card stays open even if the pointer leaves it. (A follow-up's ask is sticky anyway; its
// note only needs the notch to take the keyboard.)
el.addEventListener("focusin", (e) => {
  if (e.target.id === "fnote") return void invoke("focus_notch").catch(() => {});
  if (e.target.id === "ask" && card) { card.sticky = true; clearTimeout(closeTimer); invoke("focus_notch").catch(() => {}); }
});
el.addEventListener("focusout", (e) => { if (e.target.id === "ask" && card && !e.target.value.trim() && !(card.proposals ?? []).some((p) => p.kind === "confirm")) { card.sticky = false; scheduleClose(); } });
el.addEventListener("pointerdown", (e) => { if (TYPING.has(e.target.id)) invoke("focus_notch").catch(() => {}); });
// Typing to her cuts her off (owner decision, 7 October 2026: her voice), as on the web; so does typing a follow-up's note,
// which is kept on the card as it is typed.
el.addEventListener("input", (e) => {
  if (TYPING.has(e.target.id) && aloud()) hush();
  if (e.target.id === "fnote" && card?.kind === "followup_ask") { card.note = e.target.value; showCount(); }
});
// Keys while the notch has focus: Esc folds the card away; on a Confirm, Y confirms and N declines (not while typing).
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && card) { if (TYPING.has(e.target.id)) e.target.blur(); return closeCard(); }
  if (TYPING.has(e.target.id) || !card || busy) return;
  const confirm = (card.proposals ?? []).find((p) => p.kind === "confirm");
  if (!confirm) return;
  if (e.key === "y" || e.key === "Y") confirmProposal(confirm.token);
  if (e.key === "n" || e.key === "N") declineConfirms(confirm.token);
});

function talkButton() {
  const name = esc(me().name);
  if (voice.enabled && voice.modelReady) return `<span class="hint" title="Hold to talk to ${name}">${mic}<kbd>${esc(voice.shortcut)}</kbd></span>`;
  return `<button class="btn ghost icon" data-act="voice-setup" title="Talk to ${name}" aria-label="Talk to ${name}">${mic}</button>`;
}

/**
 * What Brenda said, readable aloud: no markdown marks, links as their words, list markers dropped (a numbered item
 * keeps its number) and each list line ending as a sentence, so the voice pauses between items.
 */
const plain = (s) => String(s ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1")
  .replace(/^[ \t]*[-*+•][ \t]+(.*)$/gm, (_, t) => (/[.!?:;]$/.test(t.trim()) ? t : `${t.trim()}.`))
  .replace(/^([ \t]*\d{1,3}[.)][ \t]+)(.*)$/gm, (_, n, t) => `${n}${/[.!?:;]$/.test(t.trim()) ? t : `${t.trim()}.`}`)
  .replace(/^[ \t]*(\*\*|__)((?:(?!\1).)+)\1:?[ \t]*$/gm, "$2:")
  .replace(/[*_`#>]+/g, "").replace(/\s+\n/g, "\n").trim();

// ---- her voice -----------------------------------------------------------------------------------------------------
// Owner decision, 7 October 2026 (phase 2; the header says what she does). Rust's `speaking` and `spoken` drive `talking`;
// `talkWaiting` covers the moment between asking Rust to speak and her first sound, so Stop shows at once. Nothing here
// draws the card again (that would lose words typed in the ask box): `showTalking` changes her faces and the Listen
// button where they are.

/**
 * When she reads replies aloud, as the person chose in Boredroom (the desktop state's `assistant.speak`): "voice" (the
 * default, and what an older server means) answers aloud what was said with the talk keys, "always" every answer,
 * "never" none. Listen on the reply card works whatever it says.
 */
const speakPref = () => { const s = data?.assistant?.speak; return s === "always" || s === "never" ? s : "voice"; };
/** Whether she is speaking or about to. */
const aloud = () => talking || talkWaiting;
/** Whether this answer is read aloud on its own: always, or when it answers something said with the talk keys. */
const speaksFor = (spoken) => speakPref() === "always" || (speakPref() === "voice" && !!spoken);

/** Asks Rust to read `text` aloud (it renders first, so the first sound comes a moment later). */
function sayAloud(text) {
  if (!text) return;
  talkWaiting = true;
  clearTimeout(talkWaitTimer);
  // She never started (nothing to say, or the microphone opened meanwhile): the button goes back to Listen.
  talkWaitTimer = setTimeout(() => { talkWaiting = false; showTalking(); }, 12_000);
  invoke("speak", { text }).catch(() => { talkWaiting = false; showTalking(); });
  showTalking();
}

/** Stops her, and anything about to be said. Rust answers with `spoken` if she was heard. */
function hush() {
  clearTimeout(talkWaitTimer);
  if (!aloud()) return;
  talkWaiting = false;
  invoke("stop_speaking").catch(() => {});
  showTalking();
}

/**
 * The reply card's Listen / Stop (owner decision, 7 October 2026: her voice), first in its actions row: the name stays,
 * `aria-pressed` carries the state and the tooltip says what a press does. Stop's square is orange (live, accent rules).
 * Only when the answer has something to say.
 */
const listenButton = () => (card?.spokenText ? `<button class="btn ghost icon" data-act="listen" aria-label="Listen to this reply" aria-pressed="${aloud()}" title="${aloud() ? "Stop" : "Listen"}">${icon(aloud() ? "stop" : "volume")}</button>` : "");

/** Her faces and the Listen button as `talking` and `talkWaiting` now say, in place. */
function showTalking() {
  for (const f of el.querySelectorAll(".face[data-own]")) {
    f.classList.toggle("talk", talking);
    if (!talking) f.style.removeProperty("--talk");
  }
  const on = aloud();
  for (const b of el.querySelectorAll('[data-act="listen"]')) {
    b.setAttribute("aria-pressed", String(on));
    b.title = on ? "Stop" : "Listen";
    b.innerHTML = icon(on ? "stop" : "volume");
  }
  if (talking) talkLevel(talkLast);
}

/** Her talking faces follow `level` (0 to 1): eyes open and squash, glow brightens (style.css `.face.talk`, `--talk`). Under reduced motion they hold a still pose. */
function talkLevel(level) {
  talkLast = Math.max(0, Math.min(1, Number(level) || 0));
  if (reduceMotion?.matches) return;
  const lv = talkLast.toFixed(3);
  for (const f of el.querySelectorAll(".face.talk")) f.style.setProperty("--talk", lv);
}

/**
 * Syllables for when Rust has no level to send (it spoke the plain way): pulses 4 to 6 times a second, each rising in
 * 35 ms to a peak of 0.45 to 0.85 and fading (90 ms), never below 0.08, as the web's fallback
 * (src/lib/assistant-speech/envelope.ts).
 */
function startPulse() {
  stopPulse();
  if (reduceMotion?.matches) return;
  const pulses = [];
  let next = performance.now();
  talkSynthetic = setInterval(() => {
    const now = performance.now();
    while (next <= now) { pulses.push({ at: next, peak: 0.45 + 0.4 * Math.random() }); next += 1000 / (4 + 2 * Math.random()); }
    pulses.splice(0, Math.max(0, pulses.length - 4));
    let lv = 0.08;
    for (const p of pulses) { const dt = now - p.at; lv = Math.max(lv, dt < 35 ? (p.peak * dt) / 35 : p.peak * Math.exp(-(dt - 35) / 90)); }
    talkLevel(lv);
  }, 33);
}
function stopPulse() { clearInterval(talkSynthetic); talkSynthetic = null; }

// ---- her replies, as light Markdown ------------------------------------------------------------------------------
// Brenda writes light Markdown (copilot.ts): the answer first, lists with each item's key words in bold, bold labels over
// grouped lists, links to Boredroom pages. `md` draws it as the web's chat does (docs-markdown.tsx, variant "chat"):
// paragraphs (a single line break kept), bulleted and numbered lists, bold, italic, inline code and links. It is safe by
// construction: every piece of her text goes through `esc` before it is placed, and the only markup is the handful of
// tags written here. A link becomes a link button only for a path inside Boredroom (a path without the workspace is
// read as one inside it, as on the web) that is not a removed page; anything else shows its words only.

const MD_ESCAPABLE = "\\`*_{}[]()#+-.!|~>";
/** A Boredroom path the notch may open, or null. */
function mdHref(raw) {
  const url = String(raw ?? "").trim().replace(/^<|>$/g, "");
  if (!/^\/(?![/\\])[^\s\\]{0,2000}$/.test(url)) return null;
  const slug = config?.workspaceSlug ? `/app/${config.workspaceSlug}` : "";
  const path = !slug || url === slug || url.startsWith(`${slug}/`) || url.startsWith(`${slug}?`) || /^\/(?:app|api)(?:[/?#]|$)/.test(url) ? url : `${slug}${url}`;
  return removedPage(path) ? null : path;
}
/** One line of her text as escaped HTML: bold, italic, inline code and links; everything else is text. */
function mdInline(text, depth = 0, inLink = false) {
  const s = String(text ?? "");
  if (depth > 4) return esc(s);
  let out = "", buf = "", i = 0;
  const flush = () => { out += esc(buf); buf = ""; };
  // Where a mark was last found to have no closer: later openers of it are text without searching again.
  const none = {};
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && MD_ESCAPABLE.includes(s[i + 1] ?? "")) { buf += s[i + 1]; i += 2; continue; }
    if (c === "`") {
      const close = s.indexOf("`", i + 1);
      if (close > i + 1) { flush(); out += `<code>${esc(s.slice(i + 1, close))}</code>`; i = close + 1; continue; }
    }
    if (c === "[" && !inLink) {
      const m = /^\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})(?:\s+"[^"]*")?\)/.exec(s.slice(i, i + 2400));
      if (m) {
        flush();
        const href = mdHref(m[2]);
        const label = mdInline(m[1], depth + 1, true);
        out += href ? `<button type="button" class="link" data-act="open-href" data-href="${esc(href)}">${label}</button>` : label;
        i += m[0].length; continue;
      }
    }
    if (c === "*" || c === "_") {
      const d = s[i + 1] === c ? c + c : c;
      const next = s[i + d.length];
      // Opens before a non-space; "_" inside a word (snake_case) is text.
      if (next && !/\s/.test(next) && !(c === "_" && /[\p{L}\p{N}]/u.test(s[i - 1] ?? "")) && !(none[d] <= i)) {
        let close = s.indexOf(d, i + d.length);
        // Not after a space, not an escaped mark ("\*" is text), and a single mark is not half of a double one.
        while (close !== -1 && (/\s/.test(s[close - 1]) || s[close - 1] === "\\" || (d.length === 1 && s[close + 1] === c))) close = s.indexOf(d, close + 1);
        if (close === -1) none[d] = i;
        if (close > i + d.length) {
          flush();
          const inner = mdInline(s.slice(i + d.length, close), depth + 1, inLink);
          out += d.length === 2 ? `<strong>${inner}</strong>` : `<em>${inner}</em>`;
          i = close + d.length; continue;
        }
      }
      buf += d; i += d.length; continue;
    }
    buf += c; i++;
  }
  flush();
  return out;
}
/** Her reply as escaped HTML blocks: paragraphs, labels (a paragraph that is only bold), bulleted and numbered lists. */
function md(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").slice(0, 400);
  const out = [];
  let para = [], list = null, gap = false;
  const endPara = () => {
    if (!para.length) return;
    const label = para.length === 1 && /^(\*\*|__)(?:(?!\1).)+\1:?$/.test(para[0]);
    out.push(`<p${label ? ' class="label"' : ""}>${para.map((l) => mdInline(l)).join("<br>")}</p>`);
    para = [];
  };
  const endList = () => {
    if (!list) return;
    const start = list.tag === "ol" && list.start !== 1 ? ` start="${list.start}"` : "";
    out.push(`<${list.tag}${start}>${list.items.map((it) => `<li>${it.map((l) => mdInline(l)).join("<br>")}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim()) { endPara(); gap = true; continue; }
    const wasGap = gap; gap = false;
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) { endPara(); endList(); continue; } // a rule: a break only
    const item = /^ {0,12}([-*+•]|\d{1,3}[.)])[ \t]+(.+)$/.exec(line);
    if (item) {
      const tag = /\d/.test(item[1]) ? "ol" : "ul";
      endPara();
      if (!list || list.tag !== tag) { endList(); list = { tag, start: tag === "ol" ? Math.max(1, parseInt(item[1], 10)) : 1, items: [] }; }
      list.items.push([item[2].trim()]);
      continue;
    }
    // A line under an item, before any blank line, carries the item on.
    if (list && !wasGap) { list.items[list.items.length - 1].push(line.trim()); continue; }
    endList();
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/.exec(line);
    if (heading) { endPara(); out.push(`<p class="label">${mdInline(heading[1])}</p>`); continue; } // no headings, only labels
    para.push(line.trim().replace(/^>[ ]?/, ""));
  }
  endPara(); endList();
  return out.join("");
}

/** The voice card's time, m:ss: running while listening, stopped once the keys come up. */
const mss = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const voiceSeconds = (c) => (c?.startedAt ? Math.max(0, Math.floor(((c.endedAt ?? Date.now()) - c.startedAt) / 1000)) : 0);

function voiceView() {
  const c = card;
  if (c.phase === "listening") {
    // ElevenLabs' recording look, as on the web's voice card: Brenda listening, the orange live dot with the time, and
    // under them the live waveform scrolling with the voice.
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Listening…</p><p class="cap">Let go of <kbd>${esc(voice.shortcut)}</kbd> when you're done.</p></div><span class="mic"><span class="rec-dot"></span><span class="clock live" id="vtime" role="timer">${mss(voiceSeconds(c))}</span></span></div>
      <div class="wave live fade" aria-hidden="true"><canvas id="wave"></canvas></div>`;
  }
  if (c.phase === "transcribing" || c.phase === "thinking") {
    // She thinks; what is happening first (shimmering), then the words heard, in italic quotes. While the words are
    // written out the waveform carries on as a slow travelling wave and the time stays where it stopped.
    const words = c.phase === "transcribing";
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title shimmer">${words ? "Getting your words…" : `${esc(me().name)} is on it…`}</p>${c.heard ? `<p class="said">“${esc(c.heard)}”</p>` : ""}</div>${words && c.startedAt ? `<span class="mic"><span class="clock">${mss(voiceSeconds(c))}</span></span>` : ""}</div>
      ${words ? `<div class="wave fade" aria-hidden="true"><canvas id="wave"></canvas></div>` : ""}`;
  }
  if (c.phase === "reply") {
    const proposals = c.proposals ?? [];
    const confirms = proposals.filter((p) => p.kind === "confirm");
    const opens = proposals.filter((p) => p.kind === "open" && !removedPage(p.href)).slice(0, 2);
    // What the built-in helper offers as one press (a to-do, clocking in or out, a timer), as on the web; not while
    // something waits for a yes, so the card keeps its height.
    const offers = confirms.length ? [] : proposals.map((p, i) => ({ p, i })).filter(({ p }) => OFFER[p.kind]).slice(0, 3);
    // The note under her answer (past the daily limit, or Claude could not be reached), as the web shows it.
    const note = c.msg?.note ? `<p class="cap note">${esc(c.msg.note)}</p>` : "";
    return `<div class="row fade top">${face(moodOf())}<div class="grow"><p class="said">“${esc(c.heard)}”</p><div class="reply">${md(c.reply)}</div>${note}</div></div>
      ${c.actions?.length ? `<ul class="list fade">${c.actions.slice(0, confirms.length ? 2 : 4).map((a) => `<li class="done"><span class="k ok">${icon("check")}</span><span class="t">${esc(a.summary)}</span></li>`).join("")}</ul>` : ""}
      ${offers.length ? `<ul class="list fade">${offers.map(({ p, i }) => `<li><span class="t">${offerLabel(p)}</span>${p.done ? `<span class="k ok end">${esc(p.done)}</span>` : `<button class="btn" data-act="offer" data-i="${i}" ${busy ? "disabled" : ""}>${icon(OFFER[p.kind].icon)}${OFFER[p.kind].label}</button>`}</li>`).join("")}</ul>` : ""}
      ${confirms.map((p, i) => `<div class="confirm fade"><p class="sub">${icon("shield")}<span>${esc(p.summary)}</span></p>${p.detail ? `<div class="detail" tabindex="0" aria-label="The full message">${esc(p.detail)}</div>` : ""}<div class="actions">${i === 0 ? listenButton() : ""}<button class="btn ghost" data-act="not-now" data-token="${esc(p.token)}">Not now${i === 0 ? " <kbd>N</kbd>" : ""}</button><button class="btn primary" data-act="confirm" data-token="${esc(p.token)}" ${busy ? "disabled" : ""}>${icon("check")}Confirm${i === 0 ? " <kbd>Y</kbd>" : ""}</button></div></div>`).join("")}
      ${!confirms.length ? askBox("Ask a follow-up…") : ""}
      ${!confirms.length ? `<div class="actions">${listenButton()}${opens.map((p) => `<button class="btn" data-act="open-href" data-href="${esc(p.href)}">${esc(p.label)}${icon("open")}</button>`).join("")}<button class="btn ghost" data-act="open-chat" title="Carry on with this chat on ${esc(`${me().name}'s`)} page in Boredroom">Open chat</button><button class="btn ghost" data-act="close">Done</button></div>` : ""}`;
  }
  if (c.phase === "off") {
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Talk to ${esc(me().name)}</p><p class="sub">Hold <kbd>${esc(voice.shortcut)}</kbd>, say what you need, let go. I only listen while you hold the keys, and your voice is turned into text on this computer. The first time, I download a 148 MB speech model.</p></div></div>
      <div class="actions"><button class="btn ghost" data-act="close">Not now</button><button class="btn primary accent" data-act="voice-on">Turn on voice</button></div>`;
  }
  if (c.phase === "downloading") {
    const p = Math.round((c.progress ?? 0) * 100);
    return `<div class="row fade"><span class="orb think"><i></i></span><div class="grow"><p class="title shimmer">Getting my ears ready… <span class="num">${p}%</span></p><p class="sub">Downloading the speech model once (148 MB). You can keep working.</p></div></div><div class="bar"><i style="width:${p}%"></i></div>`;
  }
  if (c.phase === "ready") {
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Voice is on</p><p class="sub">Hold <kbd>${esc(voice.shortcut)}</kbd> and talk. Try “What's on today?” or “Remind me to call Josh at 3.”</p></div></div><div class="actions"><button class="btn primary" data-act="close">Got it</button></div>`;
  }
  if (c.phase === "error") return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">${esc(c.title ?? "I didn't catch that")}</p><p class="sub">${esc(c.message)}</p></div></div><div class="actions"><button class="btn" data-act="close">OK</button></div>`;
  return "";
}

/**
 * The text (spoken or typed) goes to Brenda's chat with the last few turns. The answer is read aloud as the person chose
 * (`speakPref`; by default a spoken question gets a spoken reply), and Listen on the card reads it on demand.
 */
async function ask(text, { spoken = true } = {}) {
  hush(); // a new question cuts her off
  if (Date.now() - talkAt > TALK_MEMORY_MS) { talk = []; chat = newChat(); }
  talk.push({ role: "user", content: text });
  talkAt = Date.now();
  if (!spoken) Sound.play("send");
  openCard({ kind: "voice", phase: "thinking", heard: text, sticky: true });
  try {
    if (data && !data.brendaEnabled) throw new Error("Brenda isn't part of your workspace's plan yet.");
    const r = await call("POST", org("/assistant/chat"), { messages: talk.slice(-12).map(({ role, content }) => ({ role, content })) });
    // Kept whole (what she did and offered too) for Past chats; only the words go back to her.
    const msg = { role: "assistant", content: r.reply, actions: r.actions ?? [], proposals: r.proposals ?? [], engine: r.engine, note: r.note ?? null };
    talk.push(msg);
    const needsYes = msg.proposals.some((p) => p.kind === "confirm");
    // What she says: the server's speakable version (B3 in the phase 2 contract; "" when nothing in it can be said), or
    // the plain words from an older server.
    const spokenText = typeof r.spoken === "string" ? r.spoken.trim() : plain(r.reply);
    openCard({ kind: "voice", phase: "reply", heard: text, spoken, spokenText, reply: r.reply, actions: r.actions, proposals: msg.proposals.map((p, at) => ({ ...p, at })), msg, sticky: needsYes, closeAfter: REPLY_CLOSE_MS });
    Sound.play(needsYes ? "attention" : r.actions?.length ? "success" : "reply");
    if (speaksFor(spoken)) sayAloud(spokenText);
    if (!spoken) document.getElementById("ask")?.focus(); // typed: carry straight on with a follow-up
    if (r.actions?.length) refresh();
    saveChat();
  } catch (err) {
    talk.pop();
    openCard({ kind: "voice", phase: "error", title: `${me().name} couldn't answer`, message: err?.message ?? "Can't reach Boredroom.", closeAfter: REPLY_CLOSE_MS });
    Sound.play("error");
  }
}

/**
 * Marks proposals done in a kept answer (by their place in it, `at`), with what running them did, and on the reply card
 * too while it still shows that answer.
 */
function markDone(msg, at, done, actions = []) {
  if (!msg) return;
  msg.proposals = (msg.proposals ?? []).map((p, i) => (at.includes(i) ? { ...p, done } : p));
  if (actions.length) msg.actions = [...(msg.actions ?? []), ...actions];
  if (card?.msg === msg) card = { ...card, proposals: (card.proposals ?? []).map((p) => (at.includes(p.at) ? { ...p, done } : p)) };
}

async function confirmProposal(token) {
  const msg = card?.msg;
  const at = (card?.proposals ?? []).filter((p) => p.kind === "confirm" && p.token === token).map((p) => p.at);
  busy = true; render();
  let r;
  try { r = await call("POST", org("/brenda/confirm"), { token }); }
  catch (err) {
    busy = false;
    // A Confirm that already ran (pressed twice, or answered in Boredroom meanwhile) is done, not an error.
    if (err?.code !== "ALREADY_CONFIRMED") { error = err?.message ?? String(err); Sound.play("error"); return render(); }
    r = { actions: [], error: null };
  }
  busy = false;
  const said = r.error ?? (r.actions?.map((a) => a.summary).join(". ") || "Done.");
  // Refused, the Confirm stays unanswered in the kept conversation, where it reads as expired.
  if (!r.error) markDone(msg, at, "Done", r.actions ?? []);
  saveChat();
  refresh();
  Sound.play(r.error ? "error" : "success");
  if (!card || card.msg !== msg) return render(); // the card moved on meanwhile
  // Only the Confirm that was pressed leaves the card: another one (a second message in the same answer) still waits for
  // its own yes or no, and the card stays open until it has one (review, 8 October 2026).
  const rest = (card.proposals ?? []).filter((p) => !(p.kind === "confirm" && p.token === token));
  const waiting = rest.some((p) => p.kind === "confirm");
  card = { ...card, proposals: rest, sticky: waiting, reply: said, actions: r.error ? [] : r.actions,
    // The server's speakable words (never a URL, an id or a `say` command from a typed title); an older server's plain().
    spokenText: typeof r.spoken === "string" ? r.spoken : plain(said) };
  render(); if (!waiting) scheduleClose();
  // What the Confirm did is read aloud under the same rule as the answer; otherwise she stops reading the question.
  if (speaksFor(card.spoken)) sayAloud(card.spokenText);
  else hush();
}

/**
 * Not now: nothing runs, and the kept conversation says it was declined. With a token, only that Confirm is declined and
 * any other one stays on the card waiting for its answer; without one, all of them.
 */
function declineConfirms(token) {
  if (!card) return;
  const declined = (p) => p.kind === "confirm" && (!token || p.token === token);
  markDone(card.msg, (card.proposals ?? []).filter(declined).map((p) => p.at), "Not done");
  const rest = (card.proposals ?? []).filter((p) => !declined(p));
  const waiting = rest.some((p) => p.kind === "confirm");
  card = { ...card, proposals: rest, sticky: waiting };
  render(); if (!waiting) scheduleClose();
  saveChat();
}

// What the built-in helper offers as one press, with the label it gets once done (the web's chat uses the same words).
const OFFER = {
  todo: { label: "Add", done: "Added", icon: "plus" },
  clock_in: { label: "Clock in", done: "Clocked in", icon: "alarm" },
  clock_out: { label: "Clock out", done: "Clocked out", icon: "alarm" },
  start_timer: { label: "Start", done: "Started", icon: "play" },
};
const offerLabel = (p) => (p.kind === "todo" ? `${esc(p.title)}${p.assigneeName ? `<span class="s"> for ${esc(p.assigneeName)}</span>` : ""}`
  : p.kind === "start_timer" ? `Start <span class="s">${esc(p.taskTitle)}</span>` : p.kind === "clock_in" ? "Clock in" : "Clock out");

async function takeOffer(i) {
  const p = card?.proposals?.[i];
  const o = p && OFFER[p.kind];
  if (!o || p.done || busy) return;
  const msg = card.msg;
  busy = true; render();
  try {
    if (p.kind === "todo") await call("POST", org("/todos"), { title: p.title, description: p.description, dueAt: p.dueAt, assigneeMembershipId: p.assigneeMembershipId, estimateMinutes: p.estimateMinutes });
    if (p.kind === "clock_in") await call("POST", org("/clock/in"));
    if (p.kind === "clock_out") await call("POST", org("/clock/out"));
    if (p.kind === "start_timer") await call("POST", org("/sessions/start"), { taskId: p.taskId, captureMode: "none" });
    busy = false;
    markDone(msg, [p.at], o.done);
    Sound.play("success");
    render(); scheduleClose();
    refresh();
    saveChat();
  } catch (err) { busy = false; error = err?.message ?? String(err); Sound.play("error"); render(); }
}

// ---- past chats --------------------------------------------------------------------------------------------------
// What is said to Brenda up here is kept with her chats in Boredroom (owner decision, 5 October 2026), privately to the
// person, through the same conversations API the web uses (server/services/brenda-history.ts), so it shows in Past
// chats on Brenda's page and Open chat carries it on there. One conversation per run of talk: it starts with the first
// question and ends when the notch forgets the talk, after a few quiet minutes. It is saved whole after each answer,
// Confirm, Not now and offer taken, one save at a time; a failed save is let go without a word (the next one sends
// everything again). As on the web, a Confirm is kept without its token: it can only be answered where it was offered.
//
// Each save says which copy it was made from (`expectedUpdatedAt`, the updatedAt the last save returned), so a
// conversation carried on somewhere else meanwhile (Brenda's page, another window) is not saved over: the save is
// refused (409 VERSION_CONFLICT) and the copy there stands. What was said up here since the last save then starts a
// new conversation of its own, the way Open chat hands one over. A refused save that had in fact landed (only its
// answer was lost on the way) is recognised and kept.

const KEEP = { messages: 200, content: 8000, title: 200 };   // CONVERSATION_LIMITS on the server
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
// from: where in the talk this conversation starts; savedTo: how much of the talk its last save held.
const newChat = (from = 0) => ({ id: null, updatedAt: null, saving: null, again: false, last: "", from, savedTo: from });
let chat = newChat();

function forSaving(messages) {
  return messages.slice(-KEEP.messages).map((m) => ({
    role: m.role,
    content: clip(String(m.content ?? ""), KEEP.content),
    ...(m.actions?.length ? { actions: m.actions } : {}),
    ...(m.proposals?.length ? { proposals: m.proposals.map((p) => (p.kind === "confirm" ? { kind: p.kind, summary: p.summary, tool: p.tool, ...(p.detail ? { detail: p.detail } : {}), ...(p.done ? { done: p.done } : {}) } : p)) } : {}),
    ...(m.engine ? { engine: m.engine } : {}),
    ...(m.note ? { note: m.note } : {}),
  }));
}

/** A message with what was made of it (Done, Not done, what a Confirm did), as the web's chat compares two copies. */
const marks = (m) => JSON.stringify([m.role, m.content, (m.proposals ?? []).map((p) => p.done ?? ""), m.actions?.length ?? 0]);

/** Saves the conversation as it is now: the first save creates it, later ones replace it (or create it again if it was deleted on the web). */
function saveChat(c = chat, messages = talk) {
  if (!config?.signedIn || !data?.brendaEnabled) return Promise.resolve();
  if (c.saving) { c.again = true; return c.saving; }
  // Cleared in a .finally, which always runs after this assignment: a save with nothing to send finishes without
  // awaiting anything, and clearing it from inside would leave it set for good, so no later save would ever run.
  c.saving = (async () => {
    try {
      do {
        c.again = false;
        const upTo = messages.length;
        const kept = forSaving(messages.slice(c.from, upTo));
        const json = JSON.stringify(kept);
        if (kept[kept.length - 1]?.role !== "assistant" || (c.id && json === c.last)) return; // nothing new to keep
        let saved = null;
        if (c.id) {
          try { saved = await call("PUT", org(`/brenda/conversations/${c.id}`), { messages: kept, ...(c.updatedAt ? { expectedUpdatedAt: c.updatedAt } : {}) }); }
          catch (err) {
            if (err?.code === "VERSION_CONFLICT") { if (await conflicted(c, messages, kept, upTo)) c.again = true; continue; }
            if (err?.status !== 404) throw err;
          }
        }
        if (!saved) {
          const first = kept.find((m) => m.role === "user" && m.content.trim())?.content.replace(/\s+/g, " ").trim();
          // Untitled, it is a "New chat", not "Chat with Brenda": a stored title must not go stale when the person renames
          // their assistant (owner decision, 7 October 2026: personal assistants; the web uses the same words).
          saved = await call("POST", org("/brenda/conversations"), { title: first ? clip(first, KEEP.title) : "New chat", messages: kept });
        }
        c.id = saved?.id ?? c.id;
        c.updatedAt = saved?.updatedAt ?? null;
        c.last = json;
        c.savedTo = upTo;
      } while (c.again);
    } catch { /* never interrupts Brenda */ }
  })().finally(() => { c.saving = null; });
  return c.saving;
}

/**
 * A save refused because the conversation was saved from somewhere else since. If the copy there is this very save
 * (it landed and only the answer was lost), it is kept; if it is an earlier save from here that landed the same way,
 * with nothing added anywhere since, this one is made again on top of it. Otherwise that copy stands, and what was
 * said up here since the last save goes into a new conversation. Returns whether there is something left to save.
 */
async function conflicted(c, messages, kept, upTo) {
  const theirs = await call("GET", org(`/brenda/conversations/${c.id}`)).catch(() => null);
  // Whether the copy there is this save, or the start of it (asked once its length is known to be no more than this save's).
  const ours = () => theirs.messages.every((m, i) => marks(m) === marks(kept[i]));
  if (theirs && theirs.messages?.length === kept.length && ours()) {
    c.updatedAt = theirs.updatedAt; c.last = JSON.stringify(kept); c.savedTo = upTo;
    return false;
  }
  if (theirs && theirs.updatedAt !== c.updatedAt && theirs.messages?.length < kept.length && ours()) {
    c.updatedAt = theirs.updatedAt;
    return true;
  }
  Object.assign(c, { id: null, updatedAt: null, last: "", from: c.savedTo });
  return messages.slice(c.from).some((m) => m.role === "assistant");
}

/**
 * Open chat: this conversation on Brenda's page, where it carries on (her page opens it from `?chat=`). It is handed
 * over: the next thing said up here starts a new one, because the conversation now goes on there (a save from here
 * would be refused once the web has saved it; see past chats above).
 */
async function openChat() {
  await saveChat();
  const slug = encodeURIComponent(config.workspaceSlug);
  const id = chat.id;
  talk = []; chat = newChat();
  await invoke("open_in_browser", { path: `/app/${slug}/home${id ? `?chat=${encodeURIComponent(id)}` : ""}` });
  closeCard();
}

// ---- the live waveform -------------------------------------------------------------------------------------------
// ElevenLabs' recording look in the notch (owner decision, 7 October 2026). A plain-JavaScript port of the web's
// src/components/ui/live-waveform.tsx, which adapts ElevenLabs UI's live-waveform (https://github.com/elevenlabs/ui,
// apps/www/registry/elevenlabs-ui/ui/live-waveform.tsx; MIT licence, notice below). Thin rounded white bars on a centre
// line scroll in from the right, one every 30 ms, each as tall as the voice was loud then (the level Rust sends about
// every 70 ms while the keys are held, eased: quick to rise, slow to fall), softer when quiet (0.4 + 0.6 × level), the
// edges fading out; slots not heard yet are quiet dots. While the words are written out the bars become ElevenLabs'
// travelling "processing" wave, blended over about a second from what was last heard. Reduced motion keeps the bars
// still and lets only their strength follow the voice. The loop runs only while a card with the strip (#wave) shows,
// and it also keeps the voice card's time (#vtime) up to date.
//
// MIT License
//
// Copyright (c) 2025 Eleven Labs Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

const Wave = (() => {
  // 2px bars 1px apart, never shorter than 4px (silence is a row of short bars), as ElevenLabs' recording parts.
  const BAR = 2, GAP = 1, STEP = BAR + GAP, MIN = 4, RATE = 30, FADE = 20;
  const reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let mode = "idle";        // live | processing | idle
  let hist = [];            // what was heard, newest last
  let from = [];            // what was heard when the processing wave began, to blend from
  let target = 0, smooth = 0, lastPush = 0, since = 0, raf = 0, shownSecs = -1;
  /** A fixed, speech-like outline for the still bars of reduced motion, taller towards the middle. */
  const still = (i, n) => Math.max(0.15, (1 - Math.abs((i - n / 2) / (n / 2)) * 0.5) * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))));
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function frame(now) {
    raf = 0;
    const cv = document.getElementById("wave");
    if (!cv || mode === "idle") return;
    const reduced = !!reduce?.matches;
    if (mode === "live") {
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.15);
      if (!lastPush || now - lastPush > RATE * 4) lastPush = now - RATE; // first sample now; never catch up in a burst
      while (now - lastPush >= RATE) { hist.push(Math.max(0.05, Math.min(1, smooth))); lastPush += RATE; }
      const keep = Math.ceil((cv.clientWidth || 400) / STEP) + 3;
      if (hist.length > keep) hist.splice(0, hist.length - keep);
      const secs = voiceSeconds(card);
      if (secs !== shownSecs) { shownSecs = secs; const t = document.getElementById("vtime"); if (t) t.textContent = mss(secs); }
    }
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    const g = cv.getContext("2d");
    if (w && h && g) {
      const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, w, h);
      g.fillStyle = getComputedStyle(cv).color || "#fff";
      const bar = (x, v, alpha, dot = false) => {
        const height = dot ? BAR : Math.max(MIN, v * h * 0.8);
        const y = Math.round(((h - height) / 2) * dpr) / dpr;
        g.globalAlpha = alpha;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y, BAR, height, Math.min(BAR / 2, height / 2)); else g.rect(x, y, BAR, height);
        g.fill();
      };
      const n = Math.floor(w / STEP), x0 = (w - n * STEP + GAP) / 2;
      if (mode === "live" && reduced) {
        for (let i = 0; i < n; i++) bar(x0 + i * STEP, still(i, n) * 0.7, 0.25 + smooth * 0.75);
      } else if (mode === "live") {
        // Newest on the right; everything slides left by device pixels until the next sample lands.
        const shift = Math.min(1, (now - lastPush) / RATE) * STEP;
        const count = Math.ceil(w / STEP) + 1;
        for (let i = 0; i < count; i++) {
          const x = Math.round((w - (i + 1) * STEP - shift) * dpr) / dpr;
          if (x + BAR < 0) break;
          const v = hist[hist.length - 1 - i];
          if (v === undefined) bar(x, 0, 0.2, true); else bar(x, v, 0.4 + v * 0.6);
        }
      } else if (reduced) {
        for (let i = 0; i < n; i++) bar(x0 + i * STEP, still(i, n) * 0.5, 0.35);
      } else {
        const t = ((now - since) / 1000) * 1.8, blend = Math.min(1, (now - since) / 900);
        for (let i = 0; i < n; i++) {
          const pos = (i - n / 2) / (n / 2);
          const wave = Math.sin(t * 1.5 + i * 0.15) * 0.25 + Math.sin(t * 0.8 - i * 0.1) * 0.2 + Math.cos(t * 2 + i * 0.05) * 0.15;
          let v = (0.2 + wave) * (1 - Math.abs(pos) * 0.4);
          if (from.length && blend < 1) v = (from[Math.floor((i / n) * from.length)] ?? 0) * (1 - blend) + v * blend;
          v = Math.max(0.05, Math.min(1, v));
          bar(x0 + i * STEP, v, 0.4 + v * 0.6);
        }
      }
      // The edges fade out (ElevenLabs' destination-out gradient).
      const p = Math.min(0.3, FADE / w);
      const fade = g.createLinearGradient(0, 0, w, 0);
      fade.addColorStop(0, "rgba(255,255,255,1)"); fade.addColorStop(p, "rgba(255,255,255,0)");
      fade.addColorStop(1 - p, "rgba(255,255,255,0)"); fade.addColorStop(1, "rgba(255,255,255,1)");
      g.globalAlpha = 1;
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = fade;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
    }
    if (mode === "live" || (mode === "processing" && !reduced) || !w || !h) raf = requestAnimationFrame(frame);
  }

  return {
    /** The keys went down: a fresh strip. */
    start(level = 0) { mode = "live"; hist = []; from = []; target = Math.max(0, Math.min(1, level)); smooth = 0; lastPush = 0; shownSecs = -1; kick(); },
    /** A level event from Rust, 0 to 1. */
    level(level) { target = Math.max(0, Math.min(1, level)); if (mode === "live") kick(); },
    /** The keys came up: the words are being written out. */
    process() { from = hist.slice(); mode = "processing"; since = performance.now(); kick(); },
  };
})();

/** Brenda listening: her eyes widen and swell with the voice, her glow with them (style.css `.face.listen`, `--lvl`). */
function hearLevel(level) {
  const lvl = Math.max(0, Math.min(1, level)).toFixed(2);
  for (const f of el.querySelectorAll(".face.listen")) f.style.setProperty("--lvl", lvl);
}

listen("brenda://voice", ({ payload: e }) => {
  // Her voice (owner decision, 7 October 2026): `speaking` starts her talking face (with the level of what is playing,
  // or `synthetic` when there is none to send) and keeps the reply card open; `spoken` ends it, once per utterance, and
  // the card may fold away again. Handled even when signed out, so a face never keeps talking.
  if (e.phase === "speaking") {
    if (!talking) {
      talking = true; talkWaiting = false; clearTimeout(talkWaitTimer);
      if (card?.kind === "voice" && card.phase === "reply") { card.sticky = true; clearTimeout(closeTimer); restartCountdown(0); }
      showTalking();
    }
    if (e.synthetic) startPulse();
    else if (!talkSynthetic) talkLevel(e.level ?? 0);
    return;
  }
  // Asked but never heard (the microphone was open, nothing could be said, no sound came of the render; review,
  // 7 October 2026): the Listen button turns back at once, not after the 12 s wait. A hold of the talk keys does the
  // same, as it cuts off a reply still being rendered.
  if (e.phase === "unspoken" || (e.phase === "listening" && talkWaiting && !talking)) {
    if (!talking && talkWaiting) { talkWaiting = false; clearTimeout(talkWaitTimer); showTalking(); }
    if (e.phase === "unspoken") return;
  }
  if (e.phase === "spoken") {
    talking = false; stopPulse();
    showTalking();
    if (card?.kind === "voice" && card.phase === "reply") {
      card.sticky = (card.proposals ?? []).some((p) => p.kind === "confirm") || document.activeElement?.id === "ask";
      scheduleClose();
    }
    return;
  }
  if (e.phase === "downloading" || e.phase === "ready") {
    voice = { ...voice, downloading: e.phase === "downloading", modelReady: e.phase === "ready" };
    if (card?.kind === "voice" && (card.phase === "downloading" || card.phase === "ready" || card.phase === "off")) {
      card = { ...card, phase: e.phase, progress: e.progress, sticky: e.phase === "downloading" };
      render(); if (e.phase === "ready") scheduleClose();
    }
    return;
  }
  if (!config?.signedIn) return;
  // A follow-up's ask is open: the talk keys write its note instead of asking her (phase 4, 8 October 2026).
  if (card?.kind === "followup_ask" && card.phase === "ask" && dictate(e)) return;
  if (e.phase === "listening") {
    if (card?.kind === "voice" && card.phase === "listening") {
      card.level = e.level;
      Wave.level(e.level ?? 0);
      hearLevel(e.level ?? 0);
      return;
    }
    Sound.play("listen");
    openCard({ kind: "voice", phase: "listening", level: e.level, sticky: true, startedAt: Date.now() });
    Wave.start(e.level ?? 0);
    hearLevel(e.level ?? 0);
    return;
  }
  if (e.phase === "transcribing") {
    Sound.play("heard");
    const startedAt = card?.kind === "voice" && card.phase === "listening" ? card.startedAt : undefined;
    openCard({ kind: "voice", phase: "transcribing", sticky: true, startedAt, endedAt: Date.now() });
    return Wave.process();
  }
  if (e.phase === "heard") return ask(e.text);
  if (e.phase === "too-short") return card?.kind === "voice" ? closeCard() : undefined;
  if (e.phase === "limit") return;
  if (e.phase === "off") return openCard({ kind: "voice", phase: "off", sticky: true });
  if (e.phase === "needs-model") return openCard({ kind: "voice", phase: "downloading", progress: 0, sticky: true });
  if (e.phase === "error") { Sound.play("error"); return openCard({ kind: "voice", phase: "error", message: e.message, closeAfter: REPLY_CLOSE_MS }); }
});

listen("brenda://voice-status", ({ payload }) => {
  voice = payload;
  if (!config?.signedIn) return;
  openCard({ kind: "voice", phase: !voice.enabled ? "off" : voice.modelReady ? "ready" : "downloading", progress: 0, sticky: voice.enabled && !voice.modelReady });
  if (!voice.enabled) { card.phase = "off"; card.sticky = false; render(); scheduleClose(); }
});

// ---- dropping a file on Brenda ----------------------------------------------------------------------------------

const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

function dropView() {
  const c = card;
  if (c.phase === "over") {
    return `<div class="row">${face(moodOf())}<div class="grow"><p class="title">${c.count > 1 ? `Drop ${c.count} files on me` : "Drop it on me"}</p><p class="sub">I'll attach ${c.count > 1 ? "them" : "it"} to one of your tasks and send ${c.count > 1 ? "them" : "it"} for review. PDF, PNG, JPEG, WebP or TXT, up to 25 MB.</p></div></div>
      <div class="dropzone">Drop here</div>`;
  }
  if (c.phase === "choose") {
    const ok = c.files.filter((f) => !f.problem);
    const tasks = data?.myTasks ?? [];
    return `<div class="row">${face(moodOf())}<div class="grow"><p class="title">${ok.length ? `Got ${ok.length === 1 ? "it" : `${ok.length} files`}. Which task is this for?` : "I can't take these"}</p><p class="sub">${ok.length ? "It goes in with a short note, and your reviewer is told." : "Only PDF, PNG, JPEG, WebP and TXT files up to 25 MB."}</p></div></div>
      <ul class="list">${c.files.map((f) => `<li><span class="t">${esc(f.name)}</span><span class="k ${f.problem ? "bad" : ""}">${esc(f.problem ?? kb(f.size))}</span></li>`).join("")}</ul>
      ${ok.length ? `<select class="field" id="droptask" data-act="drop-task" aria-label="Task">${tasks.map((t) => `<option value="${esc(t.id)}" ${t.id === c.taskId ? "selected" : ""}>${esc(t.title)}${t.id === data?.timer?.taskId ? " (timer running)" : ""}</option>`).join("")}</select>
      <input class="field" id="dropnote" maxlength="2000" placeholder="Note for your reviewer (optional)" autocomplete="off">` : ""}
      <div class="actions"><button class="btn ghost" data-act="close">Cancel</button>${ok.length ? `<button class="btn primary" data-act="drop-send" ${busy ? "disabled" : ""}>Send for review</button>` : ""}</div>`;
  }
  if (c.phase === "uploading") {
    const p = Math.round((c.done / Math.max(1, c.total)) * 100);
    return `<div class="row">${face(moodOf())}<div class="grow"><p class="title shimmer">Attaching ${Math.min(c.done + 1, c.total)} of ${c.total}…</p><p class="sub">To “${esc(c.taskTitle ?? "your task")}”</p></div></div><div class="bar"><i style="width:${p}%"></i></div>`;
  }
  if (c.phase === "done") {
    return `<div class="row">${face(moodOf())}<div class="grow"><p class="title">Sent “${esc(c.taskTitle ?? "your task")}” for review</p><p class="sub">${c.count} file${c.count === 1 ? "" : "s"} attached.${c.failed?.length ? ` Not attached: ${esc(c.failed.join("; "))}` : ""}</p></div></div>
      <div class="actions"><button class="btn" data-act="open-href" data-href="/app/${esc(config.workspaceSlug)}/tasks/${esc(c.taskId)}">Open task</button><button class="btn primary" data-act="close">Done</button></div>`;
  }
  return "";
}

async function sendDrop() {
  const taskId = document.getElementById("droptask")?.value || card.taskId;
  const note = document.getElementById("dropnote")?.value.trim() ?? "";
  const files = card.files.filter((f) => !f.problem);
  if (!taskId || !files.length) return;
  const taskTitle = (data?.myTasks ?? []).find((t) => t.id === taskId)?.title;
  card = { ...card, phase: "uploading", done: 0, total: files.length, sticky: true, taskId, taskTitle };
  Sound.play("send");
  render();
  const ids = [], failed = [];
  for (const f of files) {
    try { const r = await invoke("upload_dropped", { index: f.index, taskId }); if (r?.id) ids.push(r.id); }
    catch (err) { failed.push(`${f.name}: ${err?.message ?? "upload failed"}`); }
    card.done++; render();
  }
  if (!ids.length) { Sound.play("error"); return openCard({ kind: "voice", phase: "error", title: "Nothing was attached", message: failed.join(" ") || "The upload failed.", closeAfter: REPLY_CLOSE_MS }); }
  try {
    await call("POST", org(`/tasks/${taskId}/submissions`), { note, links: [], fileIds: ids });
    Sound.play("success");
    openCard({ kind: "drop", phase: "done", taskId, taskTitle, count: ids.length, failed, closeAfter: 12_000 });
    refresh();
  } catch (err) {
    Sound.play("error");
    openCard({ kind: "voice", phase: "error", title: "Attached, but not sent for review", message: `${err?.message ?? "Boredroom refused it."} The files are on the task; send it from Boredroom.`, closeAfter: REPLY_CLOSE_MS });
  }
}

listen("brenda://drag", ({ payload: d }) => {
  if (!config?.signedIn) return;
  const inDrop = card?.kind === "drop";
  if (d.phase === "enter") {
    if (inDrop && card.phase !== "over") return;
    tucked = false;
    return openCard({ kind: "drop", phase: "over", count: d.count, sticky: true });
  }
  if (d.phase === "over") {
    if (!inDrop || card.phase !== "over") return;
    cursor = { x: d.x, y: d.y }; stepFace();
    const r = island.getBoundingClientRect();
    const hot = d.x >= r.left - 20 && d.x <= r.right + 20 && d.y <= r.bottom + 30;
    if (hot !== !!card.hot) { card.hot = hot; island.classList.toggle("hot", hot); island.dataset.tone = moodOf().tone ?? ""; const f = el.querySelector(".face"); if (f) f.dataset.tone = island.dataset.tone; }
    return;
  }
  island.classList.remove("hot");
  if (d.phase === "leave") { if (inDrop && card.phase === "over") closeCard(); return; }
  if (d.phase === "drop") {
    Sound.play("gulp");
    setFx("squash", 600);
    const tasks = data?.myTasks ?? [];
    if (!data?.clock) return openCard({ kind: "voice", phase: "error", title: "Evidence goes on your own tasks", message: "Staff and team leads attach files to the tasks they hold.", closeAfter: REPLY_CLOSE_MS });
    if (!tasks.length) return openCard({ kind: "voice", phase: "error", title: "No open task to attach it to", message: "Pick up or add a task first, then drop the file again.", closeAfter: REPLY_CLOSE_MS });
    const pre = tasks.some((t) => t.id === data.timer?.taskId) ? data.timer.taskId : tasks[0].id;
    return openCard({ kind: "drop", phase: "choose", files: d.files, taskId: pre, sticky: true });
  }
});

// ---- follow-ups between assistants -------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (personal assistants, phase 4; the header says what the cards do). The desktop state's
// `followUps` (src/server/services/desktop.ts, DesktopFollowUps) is { ready, waiting, answered }: `waiting` are the asks
// about this person still open (asker null: the workspace's own collection for the team report), with `facts` already
// worded for them (factLines); `answered` are their own follow-ups closed in the last day. The reply goes to
// POST /follow-ups/<id>/reply as { choice, note }, and the ask's notification is then marked read. A reply never changes
// the task: "Done" is words. Nothing a person wrote is drawn as Markdown or a link; only Boredroom paths open.

const FU_CHOICES = [["on_track", "On track"], ["blocked", "Blocked"], ["done", "Done"], ["not_started", "Not started"]];
const FU_NOTE_MAX = 280;    // FOLLOW_UP_LIMITS.noteMax on the server
const FU_COUNT_FROM = 240;  // the counter shows from here, as on the web
/** The answer card's badge, as the web's FollowUpBadge (a word with every colour). */
const FU_BADGE = { answered: { label: "Answered", tone: "ok" }, expired: { label: "No reply", tone: "" }, declined: { label: "Not now", tone: "" }, failed: { label: "Couldn't follow up", tone: "bad" } };
const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] || "";
const hhmm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayOf = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
/** A deadline as the server words it: "15:30" today, "12:00 tomorrow", else "Mon 12 Oct 12:00". */
function byWhen(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  const now = new Date(), tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  return sameDay(d, now) ? hhmm(d) : sameDay(d, tomorrow) ? `${hhmm(d)} tomorrow` : `${dayOf(d)} ${hhmm(d)}`;
}
/** A moment that has passed: "15:40" today, else "Wed 7 Oct 16:02". */
function atWhen(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  return sameDay(d, new Date()) ? hhmm(d) : `${dayOf(d)} ${hhmm(d)}`;
}
/** A path inside Boredroom the notch may open (never another site, never a removed page), or null. */
const boredroomPath = (href) => (typeof href === "string" && /^\/(?![/\\])[^\s\\]{0,2000}$/.test(href) && !removedPage(href) ? href : null);
/** The note as it may be sent: spaces collapsed, at most 280 characters. */
const cleanNote = (s) => [...String(s ?? "").replace(/\s+/g, " ").trim()].slice(0, FU_NOTE_MAX).join("").trim();
const followUps = () => (data?.followUps && data.followUps.ready === true ? data.followUps : null);
const isItem = (x) => !!x && typeof x === "object" && typeof x.id === "string" && typeof x.title === "string";
const waitingList = () => (followUps()?.waiting ?? []).filter(isItem);

/** The card a follow-up notification opens, or null for the plain notification card (an older server, or not known). */
function followUpCard(n) {
  if (!followUps()) return null;
  if (n.type === "brenda.followup_ask") {
    const w = waitingList().find((x) => x.id === n.resource_id);
    return w ? askCard(w, n) : null;
  }
  if (n.type === "brenda.followup_answer") {
    const a = (followUps().answered ?? []).filter(isItem).find((x) => x.id === n.resource_id);
    return a ? { kind: "followup_answer", n, a, closeAfter: REPLY_CLOSE_MS } : null;
  }
  // A group's answers arrive together, with the batch's summary as the notification's body.
  if (n.type === "brenda.followup_batch") return { kind: "followup_answer", n, a: null, closeAfter: REPLY_CLOSE_MS };
  return null;
}
const askCard = (w, n) => ({ kind: "followup_ask", phase: "ask", w, n: n ?? null, choice: null, note: "", factsOpen: false, dictating: null, dictMessage: null, sticky: true });

/** The asker's assistant: theirs, or the workspace's for its own collection before the team report. */
const askerOf = (w) => (w.asker ? assistantOf(w.asker.assistant) : ws());

function followUpAskView() {
  const c = card, w = c.w, from = askerOf(w), ra = from.name;
  const m = moodOf();
  if (c.phase === "sent") {
    const notNow = c.sent === "not_now";
    const label = FU_CHOICES.find(([k]) => k === c.sent)?.[1] ?? "";
    return `<div class="row fade">${face({ ...m, who: from })}<div class="grow"><p class="title wrap">${notNow ? `Told ${esc(ra)} you can't answer right now.` : `Sent. ${esc(ra)} gets your answer.`}</p><p class="sub">${notNow ? `${esc(ra)} gets what your work shows instead.` : `Your answer: ${esc(label)}${c.sentNote ? `, “${esc(c.sentNote)}”` : ""}`}</p></div></div>
      <div class="actions"><button class="btn primary" data-act="close">OK</button></div>`;
  }
  if (c.phase === "gone") {
    return `<div class="row fade">${face({ ...m, who: from })}<div class="grow"><p class="title wrap">${esc(w.title)}</p><p class="sub">${esc(c.message)}</p></div></div>
      <div class="actions">${c.n ? `<button class="btn primary" data-act="read" data-id="${esc(c.n.id)}">OK</button>` : `<button class="btn primary" data-act="close">OK</button>`}</div>`;
  }
  const by = w.deadlineAt ? byWhen(w.deadlineAt) : "";
  const due = w.asker
    ? `${by ? `Reply by ${by}. ` : ""}If you don't, ${ra} gets what your work shows.`
    : `${by ? `Reply by ${by}. ` : ""}Your reply goes in the report your team lead, the owner and HR receive.`;
  const facts = (Array.isArray(w.facts) ? w.facts : []).filter((l) => typeof l === "string" && l.trim()).slice(0, 12);
  const task = boredroomPath(w.taskHref);
  const off = busy ? "disabled" : "";
  return `<div class="row top fade">${face({ ...m, who: from })}<div class="grow"><p class="title wrap">${esc(w.title)}</p><p class="sub">${esc(due)}</p></div></div>
    ${w.question ? `<p class="quote fade">“${esc(w.question)}”</p>` : ""}
    <div class="choices fade" role="group" aria-label="Your answer">${FU_CHOICES.map(([k, label]) => `<button type="button" class="btn choice" data-act="fu-choice" data-choice="${k}" aria-pressed="${c.choice === k}" ${off}>${label}</button>`).join("")}</div>
    <form class="fu-note fade" data-fu><div class="fu-field"><input class="field" id="fnote" name="note" maxlength="${FU_NOTE_MAX}" value="${esc(c.note)}" placeholder="Add a line, if you like" aria-label="Add a line, if you like" aria-describedby="fhold fdict" autocomplete="off" spellcheck="true" ${off}>${talkKeys()}</div><div class="fu-meta"><div class="grow" id="fdict">${dictView()}</div><span class="cap num" id="fcount">${countText(c.note)}</span></div></form>
    ${facts.length || task ? `<div class="fu-foot fade">${facts.length ? `<button type="button" class="link toggle" data-act="fu-facts" aria-expanded="${!!c.factsOpen}" aria-controls="ffacts">${icon("chevron")}What your assistant will share</button>` : ""}${task ? `<button type="button" class="link" data-act="fu-task" data-href="${esc(task)}">Open task${icon("open")}</button>` : ""}</div>` : ""}
    ${facts.length ? `<ul class="facts fade" id="ffacts" ${c.factsOpen ? "" : "hidden"}>${facts.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}
    <div class="actions"><span class="cap lead">${w.taskTitle ? "This doesn't change the task." : "This doesn't change any of your tasks."}</span><button class="btn ghost" data-act="fu-send" data-choice="not_now" ${off}>Not now</button><button class="btn primary accent" data-act="fu-send" ${busy || !c.choice ? "disabled" : ""}>Send</button></div>`;
}

/** The talk keys inside the note's field while voice is on: hold them and say the line (it goes into the note). */
const talkKeys = () => (voice.enabled && voice.modelReady
  ? `<span class="fu-keys" id="fhold">${mic}<kbd>${esc(voice.shortcut)}</kbd><span class="sr">Or hold ${esc(voice.shortcut)} and say it.</span></span>`
  : "");

/** Under the note: the microphone while the talk keys are held, the words being written out, or why it could not listen. */
function dictView() {
  const c = card;
  if (c?.kind !== "followup_ask") return "";
  if (c.dictating === "listening") {
    return `<div class="dict"><span class="mic"><span class="rec-dot"></span><span class="clock live" id="vtime" role="timer">${mss(voiceSeconds(c))}</span></span><span class="cap">Listening. Let go of <kbd>${esc(voice.shortcut)}</kbd> when you're done.</span></div><div class="wave live" aria-hidden="true"><canvas id="wave"></canvas></div>`;
  }
  if (c.dictating === "transcribing") return `<p class="cap shimmer">Getting your words…</p><div class="wave" aria-hidden="true"><canvas id="wave"></canvas></div>`;
  if (c.dictMessage) return `<p class="cap">${esc(c.dictMessage)}</p>`;
  return "";
}
const countText = (s) => { const n = [...String(s ?? "")].length; return n > FU_COUNT_FROM ? `${n}/${FU_NOTE_MAX}` : ""; };
function showCount() {
  const t = document.getElementById("fcount");
  if (!t || card?.kind !== "followup_ask") return;
  const next = countText(card.note), was = t.textContent;
  if (next === was) return;
  t.textContent = next;
  if (!next !== !was) fit(); // the line under the note came or went
}
function showDictation() { const d = document.getElementById("fdict"); if (d) d.innerHTML = dictView(); fit(); }

/** One quick reply chosen, in place (the note keeps its words and focus); Send lights up. */
function chooseReply(choice) {
  if (card?.kind !== "followup_ask" || card.phase !== "ask" || busy || !FU_CHOICES.some(([k]) => k === choice)) return;
  card.choice = choice;
  hush();
  for (const b of el.querySelectorAll('[data-act="fu-choice"]')) b.setAttribute("aria-pressed", String(b.dataset.choice === choice));
  const send = el.querySelector('[data-act="fu-send"]:not([data-choice])');
  if (send) send.disabled = false;
  el.querySelector(".err")?.remove();
  Sound.play("tick");
  fit();
}

function toggleFacts(button) {
  const list = document.getElementById("ffacts");
  if (!list || card?.kind !== "followup_ask") return;
  list.hidden = !list.hidden;
  card.factsOpen = !list.hidden;
  button.setAttribute("aria-expanded", String(card.factsOpen));
  fit();
  if (card.factsOpen) list.scrollIntoView({ block: "nearest" }); // a tall card scrolls inside the island
}

/**
 * Sends the reply: the chosen one with the note, or Not now (no note). Closed meanwhile (answered on the web, past its
 * time, cancelled) the card says so in the server's words; any other refusal stays on the card under it.
 */
async function sendFollowUpReply(choice) {
  const c = card;
  if (c?.kind !== "followup_ask" || c.phase !== "ask" || busy) return;
  const pick = choice ?? c.choice;
  if (!pick) { error = "Pick an answer first."; Sound.play("error"); return render(); }
  const input = document.getElementById("fnote");
  const note = pick === "not_now" ? "" : cleanNote(input?.value ?? c.note);
  c.note = input?.value ?? c.note;
  hush();
  busy = true; error = null; render();
  Sound.play("send");
  try {
    await call("POST", org(`/follow-ups/${encodeURIComponent(c.w.id)}/reply`), { choice: pick, ...(note ? { note } : {}) });
  } catch (err) {
    busy = false;
    const still = card?.kind === "followup_ask" && card.w.id === c.w.id;
    Sound.play("error");
    if (err?.status === 404 || err?.status === 409) {
      forgetAsk(c, false);
      if (still) { card = { ...card, phase: "gone", message: err?.message || "This follow-up is already closed.", dictating: null, sticky: true }; render(); holdThenClose(CLOSE_AFTER_MS); }
      return;
    }
    error = err?.message ?? String(err);
    return still ? render() : undefined;
  }
  busy = false;
  forgetAsk(c, true);
  Sound.play("success");
  if (card?.kind === "followup_ask" && card.w.id === c.w.id) {
    card = { ...card, phase: "sent", sent: pick, sentNote: note, dictating: null, sticky: true };
    render(); holdThenClose(CLOSE_AFTER_MS);
  }
  refresh();
}

/**
 * "Sent." stays for the usual delay and then folds away, even though the shorter card has slipped out from under the
 * pointer that pressed Send (a card that is not sticky folds the moment the pointer leaves it). OK and Esc close it at
 * once; the pointer resting on it holds it, as on every card.
 */
function holdThenClose(ms) {
  const held = card;
  clearTimeout(closeTimer);
  restartCountdown(ms);
  const tick = () => { if (card !== held) return; if (hovering) closeTimer = setTimeout(tick, 1000); else closeCard(); };
  closeTimer = setTimeout(tick, ms);
}

/** The ask is no longer waiting: off the day card, and its notification read once it was answered from here. */
function forgetAsk(c, answered) {
  const ids = new Set((data?.notifications ?? []).filter((n) => n.type === "brenda.followup_ask" && n.resource_id === c.w.id).map((n) => n.id));
  if (c.n) ids.add(c.n.id);
  if (answered) for (const id of ids) call("PATCH", org(`/notifications/${encodeURIComponent(id)}`)).catch(() => {});
  if (data) {
    if (answered) data.notifications = (data.notifications ?? []).filter((n) => !ids.has(n.id));
    if (followUps()) data.followUps = { ...data.followUps, waiting: waitingList().filter((x) => x.id !== c.w.id) };
  }
}

/** A waiting ask opened from the day card (its notification may have been shown and folded away already). */
function openWaiting(id) {
  const w = waitingList().find((x) => x.id === id);
  if (!w) return;
  const n = (data?.notifications ?? []).find((x) => x.type === "brenda.followup_ask" && x.resource_id === id) ?? null;
  if (n) shown.add(n.id);
  openCard(askCard(w, n));
}

/** The day card's waiting asks, at most two, each with Reply (the rest wait in Boredroom). */
function waitingView() {
  const list = waitingList();
  if (!list.length) return "";
  return `<ul class="list fade" aria-label="Waiting for your reply">${list.slice(0, 2).map((w) => `<li><span class="t">${esc(w.title)}</span><button class="btn" data-act="fu-open" data-id="${esc(w.id)}">Reply</button></li>`).join("")}</ul>`;
}

/** After a poll: the ask on the card was answered on the web, ran out of time or was cancelled meanwhile. */
function followUpClosedElsewhere() {
  if (card?.kind !== "followup_ask" || card.phase !== "ask" || busy || !followUps()) return;
  if (waitingList().some((x) => x.id === card.w.id)) return;
  card = { ...card, phase: "gone", message: "This follow-up is already closed.", dictating: null, sticky: true };
  render(); holdThenClose(CLOSE_AFTER_MS);
}

/**
 * The talk keys while an ask is open: the waveform and the time under the note while they are held, then the words heard
 * added to the note (never sent to her). Returns whether the event was the card's.
 */
function dictate(e) {
  const c = card;
  if (busy) return ["listening", "transcribing", "heard", "too-short", "limit", "off", "needs-model", "error"].includes(e.phase);
  if (e.phase === "listening") {
    if (c.dictating === "listening") { Wave.level(e.level ?? 0); return true; }
    hush(); Sound.play("listen");
    Object.assign(c, { dictating: "listening", dictMessage: null, startedAt: Date.now(), endedAt: null });
    showDictation(); Wave.start(e.level ?? 0);
    return true;
  }
  if (e.phase === "transcribing") { Sound.play("heard"); Object.assign(c, { dictating: "transcribing", endedAt: Date.now() }); showDictation(); Wave.process(); return true; }
  if (e.phase === "heard") {
    const input = document.getElementById("fnote");
    const before = String(input?.value ?? c.note ?? "").trim();
    c.note = cleanNote(before ? `${before} ${e.text ?? ""}` : e.text);
    c.dictating = null;
    if (input) input.value = c.note;
    showDictation(); showCount(); Sound.play("tick");
    return true;
  }
  if (e.phase === "limit") return true;
  const why = { "too-short": null, off: "Voice is off, so type the line instead.", "needs-model": "Voice is still getting ready. Type the line for now.", error: e.message || "I didn't catch that. Type the line instead." };
  if (!(e.phase in why)) return false;
  if (e.phase === "error") Sound.play("error");
  Object.assign(c, { dictating: null, dictMessage: why[e.phase] });
  showDictation();
  return true;
}

function followUpAnswerView() {
  const c = card, a = c.a, n = c.n, m = moodOf();
  const subject = a ? assistantOf(a.subject?.assistant) : null;
  const title = a?.title || n.title;
  const text = a ? a.answer : n.body;
  const href = boredroomPath(a?.href) ?? boredroomPath(n.href);
  const badge = a ? FU_BADGE[a.status] : null;
  // Both names, as on the web's exchange ("Olu's Max asked Ben's Brenda"), and when it was answered.
  const mine = firstName(data?.me?.displayName ?? config?.displayName);
  const theirs = firstName(a?.subject?.name);
  const at = a?.answeredAt ? atWhen(a.answeredAt) : n.created_at ? atWhen(n.created_at) : "";
  const line = a ? `${mine ? `${mine}'s ${me().name}` : `Your ${me().name}`} asked ${theirs ? `${theirs}'s ${subject.name}` : subject.name}${at ? `, ${at}` : ""}` : at;
  return `<div class="row top fade"><span class="faces">${face(m)}${subject ? face({ ...m, who: subject }) : ""}</span><div class="grow"><p class="title wrap">${esc(title)}</p>${line ? `<p class="cap">${esc(line)}</p>` : ""}</div>${badge ? `<span class="pill ${badge.tone}">${badge.label}</span>` : ""}</div>
    ${text ? `<p class="answer fade">${esc(text)}</p>` : ""}
    ${a?.engine === "claude" && text ? `<p class="cap fade">Written by AI from ${theirs ? `${esc(theirs)}'s` : "their"} work.</p>` : ""}
    <div class="actions">${href ? `<button class="btn" data-act="open-href" data-href="${esc(href)}">Open${icon("open")}</button>` : ""}<button class="btn primary" data-act="read" data-id="${esc(n.id)}">Done</button></div>`;
}

// ---- poking and admiring Brenda -----------------------------------------------------------------------------------
// A click on her face in an open card squashes her and she looks cross for a moment; three in under 1.7 seconds make
// her dizzy for three; resting the pointer on her for 1.9 seconds gives her heart eyes (Coucou's rules).

function applyFx() {
  for (const f of el.querySelectorAll(".face:not(.mini)")) {
    f.classList.remove("squash", "dizzy", "love");
    if (fx) { void f.offsetWidth; f.classList.add(fx); }
  }
}
function setFx(name, ms) {
  fx = name; applyFx();
  clearTimeout(fxTimer);
  fxTimer = setTimeout(() => { fx = null; applyFx(); }, ms);
}
function poke() {
  const now = Date.now();
  pokes.push(now);
  while (pokes.length && now - pokes[0] > 1700) pokes.shift();
  if (pokes.length >= 3) { pokes.length = 0; setFx("dizzy", 3000); return Sound.play("dizzy"); }
  if (fx !== "dizzy") { setFx("squash", 800); Sound.play("poke"); }
}
function watchAdmiration() {
  const f = card ? el.querySelector(".face:not(.mini):not(.small)") : null;
  clearTimeout(loveTimer);
  if (!f || !cursor || fx) return;
  const r = f.getBoundingClientRect();
  if (cursor.x < r.left || cursor.x > r.right || cursor.y < r.top || cursor.y > r.bottom) return;
  loveTimer = setTimeout(() => { setFx("love", 2600); Sound.play("love"); }, 1900);
}

// ---- Brenda's face ----------------------------------------------------------------------------------------------
// Her eyes follow the cursor with a lag (tanh of the distance, eased each frame, as in Coucou's engine), she blinks
// every 2.2 to 5.4 seconds (twice in a row about one time in five), and the frame loop stops once her eyes settle.
// While the person types to her (owner decision, 7 October 2026) she reads along instead: her eyes go to the ask box
// and follow the caret, more keenly than they follow the pointer, until the box loses focus. A follow-up's note is read
// the same way, by the face on its card (phase 4, 8 October 2026).

const look = { x: 0, y: 0 };
let lookFrame = null;
let measure = null;         // a canvas context for measuring the typed words in the box's own font

/** Where the caret sits in the ask box, in window coordinates. */
function caretAt(input) {
  const r = input.getBoundingClientRect();
  const cs = getComputedStyle(input);
  measure ??= document.createElement("canvas").getContext("2d");
  const left = r.left + (parseFloat(cs.paddingLeft) || 0), right = r.right - (parseFloat(cs.paddingRight) || 0);
  let x = left;
  if (measure) {
    measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    x = left + measure.measureText(input.value.slice(0, input.selectionEnd ?? input.value.length)).width - input.scrollLeft;
  }
  return { x: Math.max(left, Math.min(right, x)), y: r.top + r.height / 2 };
}
function readAlong(e) {
  if (!TYPING.has(e.target?.id)) return;
  gaze = caretAt(e.target);
  stepFace();
}
for (const type of ["focusin", "input", "keyup", "pointerup", "select"]) el.addEventListener(type, readAlong);
el.addEventListener("focusout", (e) => { if (TYPING.has(e.target?.id)) { gaze = null; stepFace(); } });

function stepFace() {
  if (lookFrame) return;
  lookFrame = requestAnimationFrame(() => {
    lookFrame = null;
    const faces = el.querySelectorAll(".face");
    const at = gaze ?? cursor;
    if (!faces.length || !at) return;
    const r = faces[0].getBoundingClientRect();
    const tx = Math.tanh((at.x - (r.left + r.width / 2)) / (gaze ? 150 : 260));
    const ty = Math.tanh((at.y - (r.top + r.height / 2)) / (gaze ? 70 : 200));
    look.x += (tx - look.x) * 0.2;
    look.y += (ty - look.y) * 0.2;
    for (const f of faces) { f.style.setProperty("--lx", look.x.toFixed(3)); f.style.setProperty("--ly", look.y.toFixed(3)); }
    if (Math.abs(tx - look.x) > 0.003 || Math.abs(ty - look.y) > 0.003) stepFace();
  });
}

function blink(twice) {
  for (const f of el.querySelectorAll(".face")) f.classList.add("blink");
  setTimeout(() => {
    for (const f of el.querySelectorAll(".face")) f.classList.remove("blink");
    if (twice) setTimeout(() => blink(false), 160);
  }, 130);
}
(function blinkLoop() { setTimeout(() => { blink(Math.random() < 0.22); blinkLoop(); }, 2200 + Math.random() * 3200); })();

listen("brenda://cursor", ({ payload }) => {
  cursor = payload;
  const r = island.getBoundingClientRect();
  // Tucked away, the menu bar around the notch wakes it (anywhere in its height); otherwise the island itself.
  setHover(tucked
    ? payload.y >= 0 && payload.y <= COMPACT.h + 4 && Math.abs(payload.x - window.innerWidth / 2) <= 140
    : payload.x >= r.left && payload.x <= r.right && payload.y >= r.top && payload.y <= r.bottom + 4);
  stepFace();
  watchAdmiration();
});
listen("brenda://sounds", ({ payload }) => { Sound.setEnabled(payload); if (payload) Sound.play("tick"); });
listen("brenda://always-visible", ({ payload }) => { alwaysVisible = !!payload; updateTuck(); });
// Inter can arrive just after a card is drawn (font-display: swap): the island measures its content again when it does.
document.fonts?.addEventListener?.("loadingdone", () => { if (config) fit(); });

// The running timer in the compact bar and the timer card, and the timer card's estimate hairline.
setInterval(() => {
  if (!data?.timer) return;
  const c = document.getElementById("tclock"); if (c) c.textContent = hms(elapsed());
  const e = document.getElementById("testimate"), share = estimateShare(); if (e && share !== null) e.style.transform = `scaleX(${share.toFixed(3)})`;
}, 1000);

listen("brenda://signed-out", () => { config = { ...config, signedIn: false }; data = null; card = null; talk = []; chat = newChat(); cached = null; talkWaiting = false; clearTimeout(talkWaitTimer); render(); });

(async () => {
  config = await invoke("get_config");
  // Sitting in the menu bar, the compact bar is exactly as tall as it (24 to 40 px).
  const bar = await invoke("menu_bar_height").catch(() => 0);
  if (bar > 0) COMPACT.h = Math.round(Math.min(40, Math.max(24, bar)));
  document.documentElement.style.setProperty("--compact-h", `${COMPACT.h}px`);
  Sound.setEnabled(config.sounds !== false);
  alwaysVisible = !!config.alwaysVisible;
  voice = await invoke("voice_status");
  if (config.signedIn) start(); else render();
})();
