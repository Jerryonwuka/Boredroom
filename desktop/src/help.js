// Brenda for Mac, phase 3: one clear setup, and never just "I can't" (owner report and requests, 12 October 2026: "I
// wanted Brenda to assist me with some things, like open an app on my desktop, and it said it can't do that, why?";
// "when I turned this setting on, I stopped seeing my Brenda"; "Brenda is meant to assist you do anything you need it to
// do"). The setup card's words and small rules, as pure functions. Plain JavaScript, no build step: a classic script
// loaded after act.js and before main.js, sharing their one global scope, and loadable by Node for the unit tests
// (tests/unit/notch-help.test.ts), as look.js and act.js are.
//
// What the person sees (contract A.1, A.3, A.4, F; words M.1, M.2, M.5, M.6): one card, "Let Brenda help on this Mac",
// with three ticks (See my screen when I ask, Do things when I ask, Work on my files), three promises and "Read
// everything" (the phase 1 and phase 2 consents' words, kept whole); then the Mac's own permission steps in order, each
// only when it is needed; then the done card, which offers "Ask again" with the person's own words when the setup was
// opened from one of her replies. The companion's status sentence (why she is hidden, when she is). The state this Mac
// tells Boredroom for the person alone (A.6). When a "Set up on my Mac" press in Boredroom should open the card here.
//
// What this file is not: a switch. Setup is not a task and turns nothing on by itself (contract 0.3 a): only the card's
// own "Turn these on", a real press that Rust checks, turns anything on; the "Set up" and "Turn it on" buttons under her
// replies, the tray's items and Boredroom's "Set up on my Mac" only open the card. The permission rule (owner, 12 October
// 2026) is untouched: she does nothing unless the person asks, says what she will do, and waits for a yes.
//
// The naming rule (owner decision, 7 October 2026): when the person's assistant is not called Brenda, every "she" and
// "her" next to the name is the name. "Brenda" stays where it is the app's name (macOS's prompts, System Settings).

const Help = (() => {
  /** The look keys' symbols when Rust has not said (`LookStatus.keysLabel`). */
  const KEYS = "⌃ ⌘";
  /** How long a "Set up on my Mac" press in Boredroom opens the card here (contract 0b.3: 15 minutes). */
  const SETUP_FRESH_MS = 15 * 60_000;
  /** How long the person's words are kept for "Ask again" (contract A.4: 10 minutes, memory only). */
  const KEEP_MS = 10 * 60_000;
  /** The three abilities, in the card's order. */
  const ABILITIES = Object.freeze(["look", "mac", "files"]);
  /** The folders the setup asks macOS about (contract A.1, `help_request_folders`). */
  const FOLDERS = Object.freeze(["documents", "desktop", "downloads"]);
  const FOLDER_NAMES = Object.freeze({ documents: "Documents", desktop: "Desktop", downloads: "Downloads" });
  const PERMISSIONS = Object.freeze(["granted", "denied", "unknown"]);
  /** The companion's reasons (src/lib/screen-help.ts COMPANION_WHYS; contract F). The first six read as shown. */
  const SHOWN_WHYS = Object.freeze(["idle", "exchange", "act", "typing", "still", "pressing"]);
  const HIDDEN_WHYS = Object.freeze(["setting_off", "screen_help_off", "signed_out", "locked", "call", "sharing", "screenshot_tool", "mirrored", "full_screen"]);
  const WHYS = Object.freeze([...SHOWN_WHYS, ...HIDDEN_WHYS]);

  const str = (v) => (typeof v === "string" ? v : "");
  // Control and invisible characters out, whitespace collapsed (as look.js: written as escapes, never the characters).
  const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;
  const oneLine = (v) => str(v).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const clip = (s, n) => { const c = [...oneLine(s)]; return c.length > n ? `${c.slice(0, n - 1).join("").trimEnd()}…` : c.join(""); };
  /** The person's assistant's name ("Brenda" unless they renamed theirs). */
  const nameOf = (name) => oneLine(name) || "Brenda";
  const keysOf = (k) => { const v = oneLine(k); return v && v.length <= 12 ? v : KEYS; };
  const permissionOf = (v) => (PERMISSIONS.includes(v) ? v : "unknown");

  // ---- the setup card (contract A.1; words M.1) ------------------------------------------------------------------

  /** The setup card's words. `keys`: the look keys' symbols (⌃ ⌘). */
  function setupWords(name, keys) {
    const n = nameOf(name);
    const k = keysOf(keys);
    const b = n === "Brenda";
    const She = b ? "She" : n;
    return {
      title: `Let ${n} help on this Mac`,
      lead: b ? "Choose what Brenda can do here. She does something only when you ask, and checks with you first." : `Choose what ${n} can do here. ${n} does something only when you ask, and checks with you first.`,
      rows: {
        look: { label: "See my screen when I ask", sub: `Hold ${k} and ask. ${She} looks once at the screen your pointer is on, answers, and can point at things. The picture is never kept.` },
        mac: { label: "Do things when I ask", sub: `Open apps, files, folders and pages, and click and type for you, one step at a time. ${b ? "She says exactly what she'll do" : `${n} says exactly what ${n} will do`} and asks “Do you want me to do this?”. Nothing happens until you say yes.` },
        files: { label: "Work on my files", sub: `Find your files, read them and write summaries or new files next to them while you carry on. ${She} never changes or replaces yours.` },
      },
      on: "On",
      needsLook: `Doing things and working on files need this: it's how ${b ? "she" : n} knows what you mean.`,
      promises: [
        `Only when you ask. Silence means no. Esc, ${b ? "her keys or Stop stops her" : `${n}'s keys or Stop stops ${n}`} at once.`,
        "Never in password managers, Keychain, System Settings, Terminal, or messaging and call apps, never on banking or payment pages, and never installers or scripts.",
        "Your workspace can't see any of this. Only you can see which of these are on, in Boredroom › Settings › Your assistant.",
      ],
      read: "Read everything",
      less: "Show less",
      headings: { look: "Seeing your screen", mac: "Doing things", files: "Your files", leaves: "What leaves your Mac", kept: "What's kept" },
      notNow: "Not now",
      turnOnMany: "Turn these on",
      turnOnOne: "Turn this on",
      footer: "Your Mac asks for its own permissions next. Turn any of it off from the menu bar or Settings › Your assistant.",
      errors: { failed: "That couldn't be turned on. Try again.", needsLook: "Seeing your screen needs to be on for that." },
    };
  }

  // Look and Act, from the page's one scope (look.js and act.js load first; the unit test puts them there too).
  /* global Look, Act */
  const look = () => (typeof Look === "object" && Look ? Look : null);
  const act = () => (typeof Act === "object" && Act ? Act : null);

  /**
   * "Read everything" (contract A.1 item 5): the old consents' words, kept whole, in five sections. Seeing your screen:
   * look.js's consent paragraphs 1 to 3 and its fixed line (version 1 for a phase 1 Rust, else 2); Doing things and Your
   * files: act.js's paragraphs 1 to 4; What leaves your Mac: the look's "Who else sees the picture." and the two "What
   * leaves your Mac." paragraphs; What's kept: the look's "Nothing is kept." and "Your workspace can't see it.", then the
   * card's privacy promise. Each paragraph is { lead?, text, keys? }; the page escapes every word.
   */
  function readEverything(name, keys, v = 2) {
    const L = look(), A = act();
    const w = setupWords(name, keys);
    if (!L || !A) return [];
    const c = L.consent(name, L.DEFAULT_KEYS, v === 1 ? 1 : 2);
    const mac = A.consentMac(name), files = A.consentFiles(name);
    const byLead = (paras, lead) => paras.find((p) => p.lead === lead);
    const leaves = [byLead(c.paras, "Who else sees the picture."), byLead(mac.paras, "What leaves your Mac."), byLead(files.paras, "What leaves your Mac.")].filter(Boolean);
    const kept = [byLead(c.paras, "Nothing is kept."), byLead(c.paras, "Your workspace can't see it."), { text: w.promises[2] }].filter(Boolean);
    return [
      { key: "look", heading: w.headings.look, paras: [...c.paras.slice(0, 3), { text: c.fixed }] },
      { key: "mac", heading: w.headings.mac, paras: mac.paras.slice(0, 4) },
      { key: "files", heading: w.headings.files, paras: files.paras.slice(0, 4) },
      { key: "leaves", heading: w.headings.leaves, paras: leaves },
      { key: "kept", heading: w.headings.kept, paras: kept },
    ];
  }

  /**
   * The three ticks (contract 0b.1, A.1 items 2 and 3). `st`: { look, mac, files } (each on already on this Mac), and
   * `offer`: { mac, files } (whether this Mac and workspace have them at all; false hides the row). A row already on is
   * ticked and disabled ("On"). Pre-ticked: every ability that is off, when there is no focus, when the card opens for
   * something the person asked for (`o.request`: Turn it on, Set up, Ask again later) or when nothing is on yet (the
   * hold, the Look button, the tray); otherwise (one switch flipped while others are on) only the focused ability, and
   * See when it is off. Review, 12 October 2026: from the owner's all-off state, seeing alone was ticked, so "find last
   * week's invoice and open it" took three separate setups. Without See, Do and Files cannot be ticked (they need it).
   */
  function setupTicks(st = {}, focus = null, o = {}) {
    const offer = { look: true, mac: st.offer?.mac !== false, files: st.offer?.files !== false };
    const f = ABILITIES.includes(focus) ? focus : null;
    const noneOn = ABILITIES.every((a) => !offer[a] || st[a] !== true);
    const all = !f || o.request === true || noneOn;
    const rows = {};
    for (const a of ABILITIES) {
      const on = st[a] === true;
      const ticked = on || (offer[a] && (all || f === a || (a === "look" && f !== null)));
      rows[a] = { shown: offer[a], on, ticked: offer[a] && ticked, disabled: on || !offer[a], needsLook: false };
    }
    return gate(rows);
  }
  /** Without See (off and unticked), Do and Files are unticked and disabled, with the needs-look line. */
  function gate(rows) {
    const out = { look: { ...rows.look }, mac: { ...rows.mac }, files: { ...rows.files } };
    const seeing = out.look.on || out.look.ticked;
    for (const a of ["mac", "files"]) {
      if (out[a].on) continue;
      out[a].needsLook = !seeing && out[a].shown;
      out[a].disabled = !seeing || !out[a].shown;
      if (!seeing) out[a].ticked = false;
    }
    return out;
  }
  /** A press on one row's box: ticks or unticks it (an ability already on stays ticked). */
  function toggleTick(rows, which) {
    if (!ABILITIES.includes(which) || !rows?.[which] || rows[which].disabled) return rows;
    const next = { look: { ...rows.look }, mac: { ...rows.mac }, files: { ...rows.files } };
    next[which].ticked = !next[which].ticked;
    // Ticking See again lets Do and Files be ticked; it does not tick them for the person.
    return gate(next);
  }
  /** What "Turn these on" turns on: the ticked abilities that are off. */
  const toTurnOn = (rows) => ABILITIES.filter((a) => rows?.[a]?.shown && rows[a].ticked && !rows[a].on);
  /** "Turn these on" or "Turn this on"; null when nothing is ticked (the button is disabled). */
  function turnOnLabel(rows, name) {
    const n = toTurnOn(rows).length;
    const w = setupWords(name);
    return n === 0 ? null : n === 1 ? w.turnOnOne : w.turnOnMany;
  }

  // ---- the Mac's own steps (contract A.1's table; words M.2) ------------------------------------------------------

  /**
   * The steps after "Turn these on", in order, each only when its ability is on now and its permission is missing:
   * `screen` (or `screen-denied` when macOS was asked before and said no: it will not ask again), `accessibility` (or
   * `accessibility-denied`), `finder` (a binary of this build only: today's asked during Turn these on; `finder-denied`
   * when today's binary's Finder said no just now, `finderAsked`), `folders` (this build only), then `done`.
   * `look`: { on, permission }; `act`: { useMac, fileWork, accessibility, finder, folders } or null; `binary`: LookStatus.v.
   */
  function setupSteps(lookS, actS, binary, o = {}) {
    const steps = [];
    const l = lookS ?? {};
    const a = actS ?? {};
    const v3 = Number(binary) >= 3;
    if (l.on === true && l.permission !== "granted") steps.push(l.permission === "denied" ? "screen-denied" : "screen");
    if (a.useMac === true && a.accessibility !== "granted") steps.push(a.accessibility === "denied" ? "accessibility-denied" : "accessibility");
    if (a.fileWork === true) {
      if (v3 && permissionOf(a.finder) === "unknown") steps.push("finder");
      else if (!v3 && o.finderAsked && a.finder === "denied") steps.push("finder-denied");
      const folders = a.folders && typeof a.folders === "object" ? a.folders : null;
      if (v3 && folders && FOLDERS.some((f) => permissionOf(folders[f]) === "unknown")) steps.push("folders");
    }
    steps.push("done");
    return steps;
  }

  /** The steps' words (M.2). The titles carry the assistant's name; macOS's prompts and System Settings say Brenda. */
  function stepWords(name, keys) {
    const n = nameOf(name);
    const k = keysOf(keys);
    const b = n === "Brenda";
    const she = b ? "she" : n, She = b ? "She" : n, her = b ? "her" : n;
    return {
      screen: { title: `Next: let ${n} see the screen`, sub: `Your Mac will ask to let Brenda record this computer's screen. That's how ${she} sees it when you ask: one picture each time, never a video.`, skip: "Skip", go: "Continue" },
      "screen-denied": { title: "Allow Brenda in System Settings", sub: "Privacy & Security › Screen & System Audio Recording, then turn on Brenda. You may need to quit and reopen Brenda afterwards.", skip: "Skip", check: "Check again", open: "Open System Settings", stillOff: "Brenda isn't allowed yet. Turn it on in that list, then check again." },
      accessibility: { title: `Next: let ${n} use the mouse and keyboard`, sub: `Your Mac will ask you to allow Brenda under Privacy & Security › Accessibility. ${She} uses it only during a task you said yes to. Opening apps, files and pages works without it; clicking and typing need it.`, skip: "Skip", go: "Continue" },
      "accessibility-denied": { title: "Allow Brenda in System Settings", sub: "Privacy & Security › Accessibility, then turn on Brenda. You may need to quit and reopen Brenda afterwards.", skip: "Skip", check: "Check again", open: "Open System Settings", stillOff: "Brenda isn't allowed yet. Turn it on in that list, then check again." },
      finder: { title: `Next: let ${n} ask Finder`, sub: `Your Mac will ask whether Brenda can control Finder. Say OK so ${she} can see which files and folders you've selected. You can say no: dropping files on ${her} still works.`, skip: "Skip", go: "Continue" },
      "finder-denied": { title: "Finder said no", sub: `So drop files on ${her}, or name the folder. You can change it in System Settings › Privacy & Security › Automation.`, open: "Open System Settings", ok: "OK" },
      folders: {
        title: "Last: your folders",
        sub: `Your Mac will ask, once for each, whether Brenda may use your Documents, Desktop and Downloads folders. Say OK to the ones you want ${her} to work in. ${She} looks in a folder only when you ask.`,
        skip: "Skip", go: "Continue",
        allowed: (folder) => `${folder}: allowed`, notAllowed: (folder) => `${folder}: not allowed`,
        denied: "You can change it in System Settings › Privacy & Security › Files and Folders.", open: "Open System Settings", ok: "OK",
      },
      done: {
        title: `${n} can help on this Mac`,
        look: "Seeing your screen: on", mac: "Doing things: on", files: "Working on your files: on",
        needsAx: "(clicking and typing need Accessibility)", finderNo: "(Finder said no)", needsScreen: "(Screen Recording isn't allowed yet)",
        sub: `Hold ${k} and ask ${b ? "her" : n} anything about your screen, or to do something.`,
        asked: (words) => `You asked: “${clip(words, 200)}”.`,
        again: "Ask again", ok: "Done",
      },
      // The fallback when a press was not taken as the person's (today's binary turns each ability on with its own check).
      again: { title: (label) => `Turn on “${label}”`, sub: "Press Continue to turn it on.", skip: "Skip", go: "Continue" },
    };
  }

  /** The folders step's result lines (M.2), in Documents, Desktop, Downloads order, and whether any was refused. */
  function folderLines(folders, name) {
    const w = stepWords(name).folders;
    const f = folders && typeof folders === "object" ? folders : {};
    const lines = FOLDERS.filter((k) => permissionOf(f[k]) !== "unknown").map((k) => (f[k] === "granted" ? w.allowed(FOLDER_NAMES[k]) : w.notAllowed(FOLDER_NAMES[k])));
    return { lines, denied: FOLDERS.some((k) => f[k] === "denied") };
  }

  /** The done card's lines (M.2): only the abilities on, each with what it still needs. */
  function doneLines(lookS, actS, name) {
    const w = stepWords(name).done;
    const l = lookS ?? {}, a = actS ?? {};
    const out = [];
    if (l.on === true) out.push(l.permission === "granted" ? w.look : `${w.look} ${w.needsScreen}`);
    if (a.useMac === true) out.push(a.accessibility === "granted" ? w.mac : `${w.mac} ${w.needsAx}`);
    if (a.fileWork === true) out.push(a.finder === "denied" ? `${w.files} ${w.finderNo}` : w.files);
    return out;
  }

  // ---- never just "I can't" (contract A.4; words M.6) --------------------------------------------------------------

  /**
   * The fixed line under her reply when a switch is off, and its button. Null for an unknown switch. `needs`: every
   * switch the request needs that is off (review, 12 October 2026: one Turn it on covers the whole request, so the line
   * names them all and the setup card ticks them all).
   */
  function enableWords(which, name, needs = null) {
    const n = nameOf(name);
    const all = Array.isArray(needs) ? needs : [];
    if ((which === "mac" || which === "files") && all.includes("mac") && all.includes("files")) {
      return { line: "“Do things when I ask” and “Work on my files” are off on this Mac.", button: "Turn them on", focus: which };
    }
    if (which === "mac") return { line: "“Do things when I ask” is off on this Mac.", button: "Turn it on", focus: "mac" };
    if (which === "files") return { line: "“Work on my files” is off on this Mac.", button: "Turn it on", focus: "files" };
    if (which === "accessibility") return { line: `${n} needs Accessibility to click and type for you.`, button: "Allow it", focus: "accessibility" };
    return null;
  }
  /** "Set up" under her reply (the offer_setup tool), and the button "Use my screen" becomes while screen help is off. */
  function offerWords(name) {
    const n = nameOf(name);
    return { setup: "Set up", setupTitle: "Opens the setup on this Mac. Nothing turns on until you say so there.", screenOff: `Set up ${n} on this Mac` };
  }
  /** A reply's `setup` ({ which }) as the page takes it: the focus for the card (all: none), or undefined when not one. */
  function setupOf(r) {
    const w = r && typeof r === "object" ? r.which : undefined;
    if (w === "all") return null;
    return ["look", "mac", "files"].includes(w) ? w : undefined;
  }
  /** A reply's `enable` ({ which }), or null. */
  const enableOf = (r) => (r && typeof r === "object" && ["mac", "files", "accessibility"].includes(r.which) ? r.which : null);
  /** Every switch a reply's `enable` says is off ({ which, needs? }), `which` first; [] when there is none. */
  function enableNeedsOf(r) {
    const which = enableOf(r);
    if (!which) return [];
    const more = Array.isArray(r.needs) ? r.needs.filter((x) => ["mac", "files", "accessibility"].includes(x)) : [];
    return [...new Set([which, ...more])];
  }
  /** The person's words kept for "Ask again" (10 minutes, memory only), or null once too old or empty. */
  function keptOf(k, now = Date.now()) {
    if (!k || typeof k !== "object") return null;
    const words = clip(k.words, 4000);
    return words && typeof k.at === "number" && now - k.at >= 0 && now - k.at < KEEP_MS ? { words, at: k.at } : null;
  }

  // ---- the companion's status (contract F; words M.5) --------------------------------------------------------------

  /**
   * Why the companion is shown or hidden, as words: the settings card's sentence and the tray's short form. `why` is
   * LookStatus.companionWhy (this build's Rust), or null with today's binary (then the page works out what it can: the
   * setting off, or screen help off, else "while screen help is on").
   */
  function companionWords(why, name) {
    const n = nameOf(name);
    const b = n === "Brenda";
    const She = b ? "She's" : `${n} is`, her = b ? "her" : n;
    if (SHOWN_WHYS.includes(why)) return { shown: true, sentence: `${She} by your pointer. ${b ? "She" : n} steps aside while you type or keep still.`, tray: "By your pointer" };
    switch (why) {
      case "setting_off": return { shown: false, sentence: `Hidden: “Show ${n} by my pointer” is off.`, tray: "Hidden: switched off" };
      case "screen_help_off": return { shown: false, sentence: `Hidden: seeing your screen is off. Set ${her} up again to bring ${her} back.`, tray: "Hidden: seeing your screen is off" };
      case "signed_out": return { shown: false, sentence: "Hidden: you're signed out.", tray: "Hidden: signed out" };
      case "locked": return { shown: false, sentence: "Hidden while your Mac is locked.", tray: "Hidden: Mac locked" };
      case "call": return { shown: false, sentence: "Hidden during a Boredroom call.", tray: "Hidden during a call" };
      case "sharing": return { shown: false, sentence: "Hidden while your screen may be shared.", tray: "Hidden: screen may be shared" };
      case "screenshot_tool": return { shown: false, sentence: "Hidden while you take a screenshot.", tray: "Hidden: taking a screenshot" };
      case "mirrored": return { shown: false, sentence: "Hidden while your screen is mirrored.", tray: "Hidden: screen mirrored" };
      case "full_screen": return { shown: false, sentence: "Hidden while an app is full screen.", tray: "Hidden: an app is full screen" };
      default: return { shown: null, sentence: `${She} by your pointer while screen help is on. ${b ? "She" : n} steps aside while you type or keep still.`, tray: "" };
    }
  }
  /** The reason that counts now: Rust's (this build), else what the page knows (the setting, screen help), else null. */
  function companionWhyOf(lookS) {
    const s = lookS ?? {};
    if (WHYS.includes(s.companionWhy)) return s.companionWhy;
    if (s.companion === false) return "setting_off";
    if (s.on !== true) return "screen_help_off";
    return null;
  }

  // ---- what this Mac tells Boredroom, for the person alone (contract A.6, 0b.2) -------------------------------------

  /**
   * The body of `PUT /screen-help/mac` (contract A.6), from what Rust says now. Today's binary leaves the folders and the
   * companion's reasons null. Only which abilities are on, which permissions macOS has given and whether she shows: no
   * names, no paths, nothing about what she saw or did.
   */
  function macStateBody(lookS, actS, setupSeen = null) {
    const l = lookS ?? {}, a = actS ?? null;
    const folders = a?.folders && typeof a.folders === "object" ? { documents: permissionOf(a.folders.documents), desktop: permissionOf(a.folders.desktop), downloads: permissionOf(a.folders.downloads) } : null;
    const why = WHYS.includes(l.companionWhy) ? l.companionWhy : null;
    const shown = typeof l.companionShown === "boolean" ? l.companionShown : null;
    return {
      version: 1,
      state: {
        v: 1,
        binary: Number.isInteger(l.v) && l.v >= 1 ? l.v : 1,
        supported: l.supported === true,
        look: { on: l.on === true && Number.isInteger(l.consent) && l.consent >= 2, permission: permissionOf(l.permission) },
        mac: { on: a?.useMac === true, accessibility: permissionOf(a?.accessibility) },
        files: { on: a?.fileWork === true, finder: permissionOf(a?.finder), folders },
        companion: { on: l.companion !== false, shown, why },
        preview: l.preview === true,
      },
      setupSeen: typeof setupSeen === "string" && setupSeen ? setupSeen : null,
    };
  }

  /**
   * Whether Boredroom's "Set up on my Mac" should open the card here now (contract 0b.3): pressed within 15 minutes on
   * the server's clock (`serverNowMs`), and not the press this Mac already acted on (`lastSeen`, the same ISO string).
   */
  function setupFresh(setupAt, lastSeen, serverNowMs) {
    if (typeof setupAt !== "string" || !setupAt) return false;
    const at = Date.parse(setupAt);
    if (!Number.isFinite(at) || setupAt === lastSeen) return false;
    const now = Number.isFinite(serverNowMs) ? serverNowMs : Date.now();
    return now - at <= SETUP_FRESH_MS && at - now <= 60_000;
  }

  return Object.freeze({ KEYS, SETUP_FRESH_MS, KEEP_MS, ABILITIES, FOLDERS, FOLDER_NAMES, WHYS, SHOWN_WHYS, HIDDEN_WHYS, setupWords, readEverything, setupTicks, toggleTick, toTurnOn, turnOnLabel,
    setupSteps, stepWords, folderLines, doneLines, enableWords, offerWords, setupOf, enableOf, enableNeedsOf, keptOf, companionWords, companionWhyOf, macStateBody, setupFresh });
})();
if (typeof module === "object" && module && module.exports) module.exports = Help;
