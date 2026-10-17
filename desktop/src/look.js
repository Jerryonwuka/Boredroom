// Screen help on Brenda for Mac, phase 1: the look cards' words and rules, as pure functions (owner decisions,
// 11 October 2026: "start building with your recommendations"; owner request the same day: "press the two buttons, ask
// Brenda a question about what I'm pointing at on my screen and she helps me out with it"). Plain JavaScript, no build
// step: a classic script loaded after natural-voice.js and before main.js, sharing their one global scope, and loadable
// by Node for the unit tests (tests/unit/notch-look.test.ts), as notify.js is.
//
// What the person sees (contract C.4): the first-time consent in the notch (the proposal's exact words, section 6), the
// Screen Recording step and "Allow Brenda in System Settings", "Screen help is on" and "Screen help is off"; while she
// looks, "Looking at Figma…"; then the preview of the one picture, with Send and Don't send; the refusals in plain words.
// This file holds those words and the small rules main.js asks about: what the preview caption says, when Send may be
// pressed, when the Mac must turn screen help off because the person pressed "Turn off on my Macs" in Boredroom, whether a
// Boredroom call is live, and the messages a look sends. It never reads `window`, `document` or main.js's state, and it
// never sees the picture's bytes (only checks that a preview is an image data URL).
//
// Promises the words make, and where they are kept: "Only when you ask" (her keys or her Look button; Rust polls the modifier keys only while
// the person opted in on this Mac and never creates an event tap; the consent shows only on a press, never on a hold);
// "Nothing is kept" (the picture lives in Rust's memory until Send or Don't send, 120 s at most, and the server never stores
// it; Past chats keep only `look: { app }`); "Your workspace can't see it" (the opt-in is the person's own; since phase 3,
// owner request of 12 October 2026, Brenda for Mac tells Boredroom which abilities are on for the person alone, and no
// owner, HR or lead can read it); "You see it first" (the preview: nothing leaves the Mac until Send). The retention words are one constant (`RETENTION`): no
// zero data retention with Anthropic yet (contract 0.10), so the consent says 30 days, "normally": Anthropic keeps what
// it flags for a usage-policy breach for longer (up to 2 years; review, 11 October 2026).
//
// What the words don't promise (review, 11 October 2026): the never-look list is by app, so a web chat, call or password
// page in a browser tab can't be told apart (the consent says so and says to add the browser); "during a call" means a
// Boredroom call (Rust knows no other); and Boredroom's servers keep the person's Past chats (her answer and the app's
// name), so the words say nothing in Boredroom shows anyone else, not that nothing exists.
//
// Phase 2 (owner request, 12 October 2026: "the preview step is a bad experience", "it must see the desktop and anything
// under the pointer"; contract E.1, A.2, A.11). Rust v2 (`LookStatus.v === 2`) looks at once: hold, ask, let go, and the
// picture of the whole screen the pointer is on goes as soon as the words are written out, unless the person turned on
// "Show me the picture first". So the consent changed (version 2, `consent(name, keys, 2)`): it no longer promises "You see
// it first", says she sees the whole screen (never-look apps blanked out), that she keeps the picture in memory for a
// minute for a follow-up, and that seeing is not doing (doing things on the Mac is a separate choice, act.js). The phase 1
// words stay for today's Rust (`consent(name, keys, 1)`), whose flow still shows every picture first: each binary is
// described by the words that are true of it. People who opted in under version 1 see the update card once before their
// next look (`consentUpdate`).

const Look = (() => {
  /** Anthropic's retention, as the consent says it (contract 0.10: one constant to flip once zero retention is agreed). */
  const RETENTION = "normally deletes it within 30 days";
  /** The look keys' name when Rust has not said (look.rs `LOOK_KEYS`, owner decision, 11 October 2026). */
  const DEFAULT_KEYS = "Control+Command";
  /** A question is 1 to 4,000 characters after trimming (contract A.5, `look_send`). */
  const QUESTION_MAX = 4000;
  /** Messages sent with a look: the last 11 of the chat and the question (Rust allows 30; `ask()` sends 12). */
  const HISTORY = 11;
  /** The app's name as the cards show it (the server's own limit, contract A.6). */
  const APP_MAX = 80;
  /** A person's never-look list (APP_RULE_LIMITS on the server). */
  const RULES_MAX = 50;
  /** How long the small lines stay: the off card 8 s, a refusal 10 s, "I let that picture go." and Never look 3 s. */
  const T = Object.freeze({ OFF_MS: 8_000, REFUSED_MS: 10_000, GONE_MS: 3_000, NEVER_MS: 3_000 });

  const str = (v) => (typeof v === "string" ? v : "");
  // Control characters out, whitespace collapsed (an app's name or a person's words drawn on a card).
  // Written as escapes, never as the invisible characters themselves (integration review, 11 October 2026: a raw
  // line separator in a regex broke the server's copy): zero-width, direction marks and embeddings, invisible operators, BOM.
  const CONTROL = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
  const oneLine = (v) => str(v).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const chars = (s) => [...s];

  /** The keys' words: Rust's `LookStatus.keys`, else Control+Command. */
  const keysOf = (status) => {
    const k = oneLine(status?.keys);
    return k && k.length <= 40 ? k : DEFAULT_KEYS;
  };
  /** An app's name as a card shows it: one line, at most 80 characters, or "this app". */
  const appName = (app) => {
    const n = chars(oneLine(typeof app === "string" ? app : app?.name)).slice(0, APP_MAX).join("").trim();
    return n || "this app";
  };
  /** The person's assistant's name ("Brenda" unless they renamed theirs). */
  const nameOf = (name) => oneLine(name) || "Brenda";

  // ---- the consent (contract C.4.1: the proposal's section 6, word for word) -------------------------------------------

  /**
   * The first-time consent, as data: a title, paragraphs (each with an optional bold lead), the fixed line, the buttons and
   * the line under them. When the person's assistant is Brenda, exactly the proposal's words; for any other name, her name
   * where "Brenda" stands and where "she" or "her" would sit next to it (the notch's naming rule, owner decision,
   * 7 October 2026). `keys` replaces "Control+Command" if the constant ever changes. "Brenda for Mac" and Boredroom stay.
   */
  function consent(name, keys = DEFAULT_KEYS, v = 2) {
    const n = nameOf(name);
    const k = oneLine(keys) || DEFAULT_KEYS;
    const brenda = n === "Brenda";
    if (v === 1) return consentV1(n, k, brenda);
    // Version 2 (contract E.1, 12 October 2026): the whole screen the pointer is on, answered at once.
    return {
      title: `Let ${n} see your screen when you ask`,
      paras: [
        { keys: k, text: `Hold ${k} and ask. ${n} looks once at the screen your pointer is on and answers straight away: where a setting is, what an error means, how to do something. ${brenda ? "She" : n} can point at things for you.` },
        { lead: "Only when you ask.", text: brenda
          ? "With her keys or her Look button. Never on her own, never on a timer, never during a Boredroom call. You'll see her listening by your pointer, and your Mac may show its own screen-recording icon in the menu bar."
          : `With ${n}'s keys or Look button. Never by itself, never on a timer, never during a Boredroom call. You'll see ${n} listening by your pointer, and your Mac may show its own screen-recording icon in the menu bar.` },
        { lead: `${brenda ? "She" : n} sees the whole screen.`, text: "Everything on the screen your pointer is on, except apps on the never-look list, which are blanked out before the picture leaves your Mac. To check each picture first, turn on “Show me the picture first” in screen help settings." },
        { lead: "Nothing is kept.", text: brenda
          ? "The picture answers your question and is thrown away. It is never saved on your Mac or on Boredroom's servers. For a minute after she answers she keeps it in memory so you can ask a follow-up, then it's gone. Your question and her answer go into your Past chats like any chat, and you can delete them."
          : `The picture answers your question and is thrown away. It is never saved on your Mac or on Boredroom's servers. For a minute after ${n} answers, ${n} keeps it in memory so you can ask a follow-up, then it's gone. Your question and ${n}'s answer go into your Past chats like any chat, and you can delete them.` },
        { lead: "Your workspace can't see it.", text: `Not your manager, HR or the owner. Nothing in Boredroom shows anyone else what ${n} saw, or whether you use this, and Boredroom's staff never look. Using it or not changes nothing about how your work is seen.` },
        { lead: "Who else sees the picture.", text: `${n} sends it, through Boredroom's own account, to Anthropic, the company that makes Claude, the AI ${brenda ? "she" : n} uses. Anthropic doesn't train on it and ${RETENTION}. If you chose a natural voice, the words of ${brenda ? "her" : `${n}'s`} answer go to ElevenLabs to be spoken, only ever through Boredroom's own account, never your workspace's.` },
        { lead: "Seeing isn't doing.", text: `Looking never lets ${brenda ? "her" : n} click, type or open your files. Doing things on your Mac is a separate choice, and even then ${brenda ? "she" : n} asks “Do you want me to do this?” before every task.` },
      ],
      fixed: `${brenda ? "She" : n} never looks at password manager, messaging or call apps. In a browser ${brenda ? "she" : n} can't tell a web chat or call from any other page, so add your browser in Settings if you want those kept out. You can add other apps there too.`,
      notNow: "Not now",
      turnOn: "Turn on screen help",
      footer: "Turn it off any time from the menu bar or Settings › Your assistant.",
    };
  }
  /** Phase 1's consent (contract C.4.1 of 11 October 2026), true of today's Rust: one window, and every picture shown first. */
  function consentV1(n, k, brenda) {
    return {
      title: `Let ${n} see your screen when you ask`,
      paras: [
        { keys: k, text: `Hold ${k} and ask. ${n} looks once at the window in front of you to help with it: where a setting is, what an error means, how to do something.` },
        { lead: "Only when you ask.", text: brenda
          ? "With her keys or her Look button. Never on her own, never on a timer, never during a Boredroom call. You'll see her looking, and your Mac may show its own screen-recording icon in the menu bar."
          : `With ${n}'s keys or Look button. Never by itself, never on a timer, never during a Boredroom call. You'll see ${n} looking, and your Mac may show its own screen-recording icon in the menu bar.` },
        { lead: "Nothing is kept.", text: `The picture answers your question and is thrown away. It is never saved on your Mac or on Boredroom's servers. Your question and ${brenda ? "her" : `${n}'s`} answer go into your Past chats like any chat, and you can delete them.` },
        { lead: "Your workspace can't see it.", text: `Not your manager, HR or the owner. Nothing in Boredroom shows anyone else what ${n} saw, or whether you use this, and Boredroom's staff never look. Using it or not changes nothing about how your work is seen.` },
        { lead: "Who else sees the picture.", text: `${n} sends it, through Boredroom's own account, to Anthropic, the company that makes Claude, the AI ${brenda ? "she" : n} uses. Anthropic doesn't train on it and ${RETENTION}. If you chose a natural voice, the words of ${brenda ? "her" : `${n}'s`} answer go to ElevenLabs to be spoken, only ever through Boredroom's own account, never your workspace's.` },
        { lead: "You see it first.", text: "Before anything leaves your Mac, you see the picture and can cancel." },
      ],
      fixed: `${brenda ? "She" : n} never looks at password manager, messaging or call apps. In a browser ${brenda ? "she" : n} can't tell a web chat or call from any other page, so add your browser in Settings if you want those kept out. You can add other apps there too.`,
      notNow: "Not now",
      turnOn: "Turn on screen help",
      footer: "Turn it off any time from the menu bar or Settings › Your assistant.",
    };
  }
  /**
   * The update card (contract E.1.1): someone who turned screen help on under the phase 1 consent sees this once before
   * their next look, because what is seen changed. Keep it on is a real press (Rust's `set_screen_help(true)`, consent 2).
   */
  function consentUpdate(name) {
    const n = nameOf(name);
    return {
      title: "Screen help works differently now",
      sub: `${n} now sees the whole screen your pointer is on, not just one window, and answers straight away without showing you the picture first. Apps on the never-look list are blanked out. You can still check each picture first in screen help settings.`,
      off: "Turn it off", keep: "Keep it on", read: "Read everything",
    };
  }
  /**
   * Help on this Mac (companion2 contract A.3, words M.4 and M.10; phase 2's "Screen help on this Mac", contract A.11):
   * the notch's settings card. Every switch is the person's own; turning an ability on opens the setup card (help.js)
   * focused on it, consent first, never the switch itself; turning anything off is at once. The companion's sub-line is
   * the status sentence (help.js `companionWords`), set by main.js.
   */
  function settingsWords(name, keys) {
    const n = nameOf(name);
    const brenda = n === "Brenda";
    const k = oneLine(keys) && oneLine(keys).length <= 12 ? oneLine(keys) : "⌃ ⌘";
    return {
      title: "Help on this Mac",
      look: { label: "See my screen when I ask", sub: `Hold ${k} and ask. ${brenda ? "She" : n} looks once and answers.`, needs: "Needs Screen Recording" },
      useMac: { label: "Do things when I ask", sub: "Opens apps, files and pages, and clicks and types, only after you say yes.", needs: "Needs Accessibility to click and type" },
      files: { label: "Work on my files", sub: "Finds and reads your files, and saves new ones next to them.", finderNo: "Finder not allowed", folderNo: (folder) => `Can't open ${folder}` },
      companion: { label: `Show ${n} by my pointer` },
      preview: { label: "Show me the picture first", sub: "Check each picture before it's sent." },
      // Owner request, 12 October 2026 (companion2 0b.2, M.10): the person can see what is on in Boredroom; no one else.
      note: "Only you can see these, here and in Boredroom › Settings › Your assistant. Your workspace can't.",
      off: "Turn off help on this Mac", done: "Done", on: "On", offWord: "Off",
      setUp: `Set up ${n} on this Mac…`,
      open: "Settings",
    };
  }
  /** The consent as plain text, paragraph by paragraph (for the tests and the card's accessible description). */
  function consentText(name, keys, v) {
    const c = consent(name, keys, v);
    return [c.title, ...c.paras.map((p) => (p.lead ? `${p.lead} ${p.text}` : p.text)), c.fixed, `[ ${c.notNow} ] [ ${c.turnOn} ]`, c.footer].join("\n\n");
  }

  // ---- the other cards' words (contract C.4.2 to C.4.8) --------------------------------------------------------------

  /**
   * Where a look is (contract A.2.1, phase 2): over the desktop (Rust's `looking` names Finder with `desktop: true`), on
   * the whole screen (the Look button of a v2 Rust, or no app known), or in an app.
   */
  const placeOf = (app) => (app && typeof app === "object" && app.desktop === true ? "desktop" : app && typeof app === "object" && app.screen === true ? "screen" : oneLine(typeof app === "string" ? app : app?.name) ? "app" : "screen");

  /** Every other fixed word on the look cards. `o`: { name, keys, app, from }. */
  function words(o = {}) {
    const n = nameOf(o.name);
    const k = oneLine(o.keys) || DEFAULT_KEYS;
    const app = appName(o.app);
    const place = placeOf(o.app);
    const at = place === "desktop" ? "your desktop" : place === "screen" ? "your screen" : app;
    return {
      permission: {
        title: "One more step on your Mac",
        sub: `Your Mac will ask whether ${n} may record the screen. That's what macOS calls letting an app see a window. ${n} looks only when you hold ${k} or press Look, and nothing is kept.`,
        notNow: "Not now", go: "Continue",
      },
      denied: {
        // "Brenda" here is the app's name in System Settings, whatever the person calls their assistant.
        title: "Allow Brenda in System Settings",
        // Sonoma (14) calls the list Screen Recording; Sequoia (15) and later, Screen & System Audio Recording.
        sub: "Privacy & Security › Screen Recording (Screen & System Audio Recording on newer macOS), then turn on Brenda. You may need to quit and reopen Brenda afterwards.",
        notNow: "Not now", check: "Check again", open: "Open System Settings",
        stillOff: "Brenda isn't allowed yet. Turn it on in that list, then check again.",
      },
      on: { title: "Screen help is on", sub: `Hold ${k} and ask about what's in front of you. Point at something first and ask “what's this?”`, ok: "Got it" },
      off: {
        title: "Screen help is off",
        sub: o.from === "settings" ? "It was turned off from Boredroom Settings. Turn it on again from the menu bar." : "Turn it on again from the menu bar.",
        ok: "OK",
      },
      looking: { title: `Looking at ${at}…`, keys: `Let go of ${k} when you're done.`, button: "One moment…" },
      preview: {
        title: `Send this to ${n}?`,
        waiting: "Getting your words…",
        placeholder: "Ask about this…",
        label: "Your question about this window",
        alt: `The window ${n} will look at, in ${app}`,
        nothingLeaves: "Nothing leaves your Mac until you press Send.",
        never: `Never look at ${app}`,
        discard: "Don't send",
        send: "Send",
      },
      sending: { title: `${n} is looking…` },
      never: { done: `${n} won't look at ${app} again. Change it in Boredroom: Settings, Your assistant.`, failed: "I couldn't save that" },
      looked: `Looked at ${at}`,
      // Phase 2 (contract A.2, A.3, A.12): instant looks, the stream, follow-ups for a minute, and voice off on this Mac.
      v2: {
        getting: "Getting your words…",
        thinking: `${n} is looking…`,
        missed: `I didn't catch that. Hold ${k} and ask again.`,
        followUp: "Ask a follow-up about this screen for the next minute.",
        followPlaceholder: "Ask about this…",
        followLabel: "A follow-up about this screen",
        voiceOff: "Voice is off, so type your question.",
        typePlaceholder: "Ask about your screen…",
        typeLabel: "Your question about your screen",
        send: "Ask",
      },
      gone: "I let that picture go.",
      dictation: {
        off: "Voice is off, so type your question instead.",
        notReady: "Voice is still getting ready. Type your question for now.",
        busy: "The microphone is busy, so type your question instead.",
        missed: "I didn't catch that. Type your question instead.",
      },
      button: { label: o.v === 2 ? "Look at your screen" : "Look at the window in front of you", title: `Look (${k})` },
      show: "Show me",
    };
  }

  /**
   * A refusal's title and sub-line (contract C.4.9), or null for `permission` (main.js opens the permission card instead).
   * `o`: { name, app, source ("fixed", "workspace" or "you", for never_look), message (a capture error's or the server's
   * words) }. Each ends calmly; a failure says that nothing was kept.
   */
  function refusalWords(reason, o = {}) {
    const n = nameOf(o.name);
    const app = appName(o.app);
    const msg = oneLine(o.message);
    // A message that only repeats the card's title is left out (review, 11 October 2026: "I couldn't take the picture"
    // above "I couldn't take the picture. Nothing was kept.").
    const same = (a, b) => a.replace(/[.!?]+$/, "").trim().toLowerCase() === b.replace(/[.!?]+$/, "").trim().toLowerCase();
    const kept = (m, title) => `${m && !same(m, title) ? `${/[.!?]$/.test(m) ? m : `${m}.`} ` : ""}Nothing was kept.`;
    switch (reason) {
      case "on_call": return { title: "I don't look at the screen during a Boredroom call", sub: "Try again when the call ends." };
      case "call_unknown": return { title: "I can't check for a call right now", sub: "So I won't look. Try again in a moment." };
      // Rust hasn't heard the workspace's rules for 120 s, or Send couldn't reach Boredroom (review, 11 October 2026).
      case "offline": return { title: "I can't reach Boredroom right now", sub: "So I won't look. Try again in a moment." };
      case "offline_send": return { title: "I can't reach Boredroom right now", sub: "So I didn't send it. Nothing was kept." };
      case "never_look":
        if (o.source === "workspace") return { title: `I don't look at ${app}`, sub: "Your workspace asked me not to." };
        if (o.source === "you") return { title: `I don't look at ${app}`, sub: "You asked me not to. Change it in Boredroom: Settings, Your assistant." };
        return { title: `I never look at ${app}`, sub: "Password manager, messaging and call apps, and System Settings, are always off limits." };
      case "own_window": return { title: "That's my own window", sub: "Click the window you want help with, then try again." };
      case "no_window": return { title: "I couldn't find a window in front of you", sub: "Click the window you want help with, then try again." };
      case "busy": return { title: "I'm still answering", sub: "Wait a moment, then try again." };
      // Phase 2 (contract B.2, A.6.4): a screen that looks shared, and a hold while a question waits for its answer.
      case "sharing": return { title: "Your screen looks shared", sub: "I don't look or work while it's being shared." };
      case "answer_first": return { title: "Answer this one first", sub: "" };
      // The consent changed since it was given (contract E.1.1): main.js opens the update card instead.
      case "consent_update": return null;
      case "unsupported": return { title: "Screen help needs macOS 14 Sonoma or later", sub: "Everything else works as before." };
      case "not_available": return { title: "Screen help isn't on in this workspace", sub: "" };
      case "permission": return null;
      case "error": return { title: "I couldn't take the picture", sub: kept(msg, "I couldn't take the picture") };
      case "send": return { title: `${n} couldn't look`, sub: kept(msg, `${n} couldn't look`) };
      // "Never look at Figma" could not be saved in Boredroom: the picture was let go all the same.
      case "never": return { title: "I couldn't save that", sub: `${msg ? `${/[.!?]$/.test(msg) ? msg : `${msg}.`} ` : ""}Nothing was sent. Add it in Boredroom: Settings, Your assistant.` };
      default: return { title: "I couldn't look this time", sub: "Try again in a moment." };
    }
  }

  /**
   * Why a keys look isn't listening, from the `looking` event's `mic` (review, 11 October 2026): the preview says to type
   * the question instead. Null when it is listening (or for a reason this page doesn't know).
   */
  function micWords(mic) {
    const d = words().dictation;
    return mic === "off" ? d.off : mic === "needs-model" ? d.notReady : mic === "busy" ? d.busy : null;
  }

  /** Under the picture: what the ring is, or why there is none (contract C.4.7). */
  function previewCaption(source, pointer, name) {
    if (source === "button") return `You pressed Look, so ${nameOf(name)} sees the whole window.`;
    return pointOf(pointer) ? "The ring is your pointer." : "Your pointer wasn't on this window.";
  }
  /** A pointer in the picture's own pixels ({ x, y }, whole numbers, not negative), or null. */
  function pointOf(p) {
    return !!p && typeof p === "object" && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0 ? { x: p.x, y: p.y } : null;
  }

  // ---- rules -------------------------------------------------------------------------------------------------------

  /**
   * Whether this Mac must turn screen help off: the person pressed "Turn off on my Macs" in Boredroom (`offAt`, ISO on the
   * server's clock) after they turned it on here (`onAt`, unix ms on this Mac's clock). `offsetMs` is the server's clock
   * minus this Mac's, as main.js keeps it. An "off" with no time for the "on" wins (the person asked for it off).
   */
  function shouldTurnOff(onAt, offAt, offsetMs = 0) {
    const off = typeof offAt === "string" ? Date.parse(offAt) : NaN;
    if (!Number.isFinite(off)) return false;
    const offHere = off - (Number.isFinite(offsetMs) ? offsetMs : 0);
    if (typeof onAt !== "number" || !Number.isFinite(onAt)) return true;
    return offHere > onAt;
  }

  /**
   * Whether a Boredroom call is live for the person, for Rust's `set_call_state` (contract B.5): they are on one, or one
   * rings for them (quiet hours included: it still rings for them, only silently). `rings` is what still rings here (the
   * page's ringsNow(), without the ones answered or declined from here); without it, the answer's own list.
   */
  function liveOf(calls, rings) {
    if (!calls || typeof calls !== "object") return false;
    if (calls.active) return true;
    const list = Array.isArray(rings) ? rings : Array.isArray(calls.ringing) ? calls.ringing : [];
    return list.length > 0;
  }

  /** The question as it is sent: trimmed, at most 4,000 characters. */
  const cleanQuestion = (s) => chars(str(s).replace(/\s+/g, " ").trim()).slice(0, QUESTION_MAX).join("").trim();
  /** Words heard added to what is in the field already, as dictation into a note adds them. */
  const joinQuestion = (before, heard) => cleanQuestion(`${cleanQuestion(before)} ${str(heard)}`);

  /**
   * The preview card's state (contract C.4.6, C.4.7): it shows once there is a picture and, from the keys, once the keys
   * have come up; Send waits while words are being written out (from the look's own recording or Option+Space) and until
   * there are words.
   */
  function previewModel(c = {}) {
    const shows = !!c.image && (c.source === "button" || !!c.released);
    const waiting = !!c.transcribing || c.dictating === "listening" || c.dictating === "transcribing";
    const q = cleanQuestion(c.question);
    return { shows, waiting, canSend: shows && !waiting && !c.busy && q.length > 0 };
  }

  /**
   * The messages a look sends (contract A.5, C.5): the last turns of the chat as `ask()` sends them (only the role, the
   * words and, on her answers, whether they read other people's words), then the question. Rust checks that the last one
   * is the question.
   */
  function messagesFor(talk, question) {
    const q = cleanQuestion(question);
    const past = (Array.isArray(talk) ? talk : [])
      .filter((m) => !!m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .slice(-HISTORY)
      .map(({ role, content, tainted }) => ({ role, content, ...(role === "assistant" ? { tainted: tainted !== false } : {}) }));
    return [...past, { role: "user", content: q }];
  }

  /**
   * The person's never-look list with one more app (contract C.4.7, "Never look at Figma"): the same app (by bundle id,
   * else by name, either case) is not added twice; at most 50.
   */
  function addRule(list, app) {
    const clean = (r) => {
      const name = chars(oneLine(r?.name)).slice(0, APP_MAX).join("").trim();
      const id = oneLine(r?.bundleId);
      return name ? { name, bundleId: id && id.length <= 255 && /^[A-Za-z0-9.\-_]+$/.test(id) ? id : null } : null;
    };
    const same = (a, b) => (a.bundleId && b.bundleId ? a.bundleId.toLowerCase() === b.bundleId.toLowerCase() : a.name.toLowerCase() === b.name.toLowerCase());
    const out = [];
    for (const r of [...(Array.isArray(list) ? list : []), app]) {
      const c = clean(r);
      if (c && !out.some((x) => same(x, c))) out.push(c);
    }
    return out.slice(-RULES_MAX);
  }

  /**
   * Her sentences as they stream in (contract C.2, B.10 `speak_queue`): the first of a look cuts off whatever was being
   * said, the rest queue behind it in order, at most 8 to a look, each at most 400 characters. `sent` is how many of this
   * look's sentences were queued already. Returns what to say, or null when there is nothing (more) to say.
   */
  const SAYS_MAX = 8, SAY_CHARS = 400;
  function says(sent, text) {
    const t = chars(oneLine(text)).slice(0, SAY_CHARS).join("").trim();
    const n = Number.isInteger(sent) && sent >= 0 ? sent : 0;
    if (!t || n >= SAYS_MAX) return null;
    return { text: t, first: n === 0 };
  }

  /** The preview Rust sends: a JPEG or PNG data URL in base64, nothing else (the card's CSP allows `img-src data:`). */
  const IMAGE = /^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;
  const safeImage = (v) => (typeof v === "string" && v.length < 4_000_000 && IMAGE.test(v) ? v : null);

  /** An `open` proposal that points at something in Boredroom (`?point=key`, contract E): drawn as Show me. */
  const POINT = /[?&]point=[a-z0-9-]{1,60}(?:[&#]|$)/;
  const points = (href) => typeof href === "string" && href.startsWith("/") && POINT.test(href);

  return Object.freeze({ RETENTION, DEFAULT_KEYS, QUESTION_MAX, T, SAYS_MAX, keysOf, appName, placeOf, consent, consentText, consentUpdate, settingsWords, words, refusalWords, micWords, previewCaption, pointOf,
    shouldTurnOff, liveOf, cleanQuestion, joinQuestion, previewModel, messagesFor, addRule, safeImage, points, says });
})();
if (typeof module === "object" && module && module.exports) module.exports = Look;
