// Brenda and her helpers, build 1 (owner's approved brief, 12 October 2026: the doc "Brenda and her helpers", all nine
// decisions "Agree", "proceed to build"; permission rule v2 the same day, replacing "always confirm"). The notch's words and
// small rules for the front desk and the helpers, as pure functions. Plain JavaScript, no build step: a classic script
// loaded after help.js and before main.js, sharing their one global scope, and loadable by Node for the unit tests
// (tests/unit/notch-front.test.ts), as look.js, act.js and help.js are.
//
// What the person sees (helpers contract A, F, M.2, Q.1, S.2 to S.8):
// - The "Doing it" strip, the compact bar while she does something: the orange live dot (she is working) and the doing
//   line without its full stop ("Opening Figma"); a job's "23 of 64" in tabular digits and Stop; "One moment" while the
//   front desk decides; the green check and the done line, with Undo when it can be undone; amber while a job is paused.
// - Cards only where there is more than the strip can hold: the ask card (only for what asks first, or for everything
//   with "Check with me before every task" on; neutral, no orange), the chooser ("Which one?"), the found list, the done
//   card with "Show the others", the refused card (never just "I can't": Turn it on / Allow it when a switch or a
//   permission is missing), the one-time "Brenda can click and type for you" consent, and a job's running, asking and end
//   cards.
// - The first short line in her natural voice, from a clip kept on this Mac (M.2): `lineKey` and `LineCache`.
//
// What this file is not: a switch or a way to start anything. The request is the permission (owner, 12 October 2026: "when
// you hold the keys and clearly ask for a routine task, the request is the permission, and she does it. She still asks
// before anything destructive, anything sent, anything that costs money, or anything sensitive."); Rust holds the request,
// classifies every action, runs it and records it. This file only words what Rust and Boredroom said.
//
// The naming rule (owner decision, 7 October 2026): when the person's assistant is not called Brenda, every "she" and
// "her" next to the name is the name. "Brenda" stays where it is the app's name (macOS's prompts, the menu bar).

const Front = (() => {
  /** The look keys' symbols when Rust has not said (`LookStatus.keysLabel`). */
  const KEYS = "⌃ ⌘";
  /** How long an ask waits (contract C.1: 60 s; a job's Trash ask 10 minutes, G.4). */
  const ASK_MS = 60_000;
  const JOB_ASK_MS = 10 * 60_000;
  /** The short-line clips kept on this Mac (contract M.2): 40 clips, 1.5 MB, oldest first out. */
  const LINES_KEY = "brenda.lines.v1";
  const LINES_MAX = 40;
  const LINES_BYTES = 1_500_000;
  /** At most five rows in the chooser, eight in a found list, nine others after the newest (contract A.6, C). */
  const CHOOSE_MAX = 5;
  const FOUND_MAX = 8;
  const OTHERS_MAX = 9;
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const str = (v) => (typeof v === "string" ? v : "");
  // Control and invisible characters out, whitespace collapsed (as look.js and help.js: written as escapes).
  const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;
  const oneLine = (v) => str(v).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const clip = (s, n) => { const c = [...oneLine(s)]; return c.length > n ? `${c.slice(0, n - 1).join("").trimEnd()}…` : c.join(""); };
  const nameOf = (name) => oneLine(name) || "Brenda";
  const keysOf = (k) => { const v = oneLine(k); return v && v.length <= 12 ? v : KEYS; };
  const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
  const nonNeg = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

  /**
   * A line as the strip shows it (contract F.1, S.1): the full stop dropped, and "Volume 30%" for "Volume 30 percent.".
   * A line ending in "…" or "?" keeps it.
   */
  function stripLine(line) {
    let t = clip(line, 120);
    t = t.replace(/^Volume (\d{1,3}) percent\.?$/, "Volume $1%");
    return t.replace(/(?<!\.)\.$/, "");
  }

  // ---- the words (contract S.2 to S.8) ---------------------------------------------------------------------------

  /**
   * Every notch word of S.2 to S.8 in the person's naming. `name`: their assistant's name; `keys`: the look keys' symbols.
   * Functions take the numbers and names they need.
   */
  function WORDS(name, keys) {
    const n = nameOf(name);
    const k = keysOf(keys);
    const b = n === "Brenda";
    const She = b ? "She" : n, she = b ? "she" : n;
    return {
      strip: { routing: "One moment", retrying: "Claude is busy, trying again…", stop: "Stop", undo: "Undo", done: "Done" },
      paused: {
        sleep: "Paused while your Mac was asleep",
        offline: "Paused: I can't reach Boredroom",
        lock: "Paused while your Mac is locked",
        call: "Paused while you're on a call",
        share: "Paused while your screen is shared",
      },
      // S.2: "Check with me before every task", and the ask card's common words.
      check: {
        question: "Do you want me to do this?",
        hint: `Answer with Yes or No, or hold ${k} and say it. I'll wait a minute.`,
        no: "No",
        yes: "Yes, do it",
      },
      // S.3: asking first.
      ask: {
        trash: { title: "Empty the Trash for good?", because: "This can't be undone.", yes: "Empty the Trash" },
        wifi: { title: "Turn off Wi-Fi?", because: "You'll lose your connection until it's back on.", yes: "Turn off Wi-Fi" },
        jobTrash: (count, what) => (count === 1 && (!what || /^files?$/.test(what)) ? "Move 1 file to the Trash?" : `Move ${count} ${what || "files"} to the Trash?`),
        jobBecause: "You can put them back from the Trash.",
        jobWait: "I'll wait 10 minutes.",
        moveToTrash: "Move to Trash",
        no: "Okay, I won't.",
        jobNo: "Okay, I left them where they are.",
        jobNoChanged: " What I did before that stays done.",
        silence: "I didn't hear a yes, so I won't do it.",
        unclear: "I didn't catch a clear yes, so I won't do it.",
      },
      // S.4: choosing and finding.
      choose: {
        title: "Which one?",
        none: "None of these",
        found: (count) => (count === 1 ? "Found one file" : `Found ${count} files`),
        open: "Open",
        reveal: "Show in Finder",
        others: (count) => `Show the others (${count})`,
        hideOthers: "Hide the others",
        ok: "OK",
      },
      // S.6: jobs.
      job: {
        sub: "You can carry on. I'll tell you when it's done.",
        thinking: "Thinking",
        stop: "Stop",
        undo: "Undo",
        ok: "OK",
        open: "Open",
        reveal: "Show in Finder",
        settings: "Open System Settings",
        doneIn: (words) => `Done in ${words}.`,
        stopped: { title: "Stopped", changed: "I stopped. What I did stays done, and Undo puts it back.", nothing: "I stopped before changing anything." },
        failed: { title: "I couldn't finish that", tail: "What I did before that stays done." },
        // The helper's own one-sentence reason when the job couldn't be done as asked (G.3 `cannot`; integration,
        // 16 October 2026: the card said only "Stopped").
        cannot: { title: "I couldn't do that" },
        lost: { title: "I lost Boredroom, so I stopped", sub: "What I did stays done, and Undo still works." },
        undone: {
          title: "Put back",
          sub: (restored, skipped) => `I put back ${restored} ${restored === 1 ? "item" : "items"}.${skipped > 0 ? ` ${skipped} had changed since, so I left ${skipped === 1 ? "it" : "them"}.` : ""}`,
        },
        undoGone: "That can't be undone any more.",
        recent: { title: "Jobs on this Mac", empty: "No jobs yet. Ask me to organise your Desktop." },
        ownWindow: { title: "I paused", sub: "Click the app you want me to work in, then press Carry on.", stop: "Stop", go: "Carry on" },
        notClick: "Okay, I won't click for you.",
      },
      // S.7: the click consent card, once per Mac.
      consent: {
        title: `Let ${n} click and type for you?`,
        lead: `For things there's no direct way to do, ${n} can use your mouse and keyboard in your apps, like you would, while you watch.`,
        promises: [
          `${She} always stops and asks before anything that sends, submits, pays or deletes.`,
          b ? "Esc, her keys or Stop stops her at once." : `Esc, ${n}'s keys or Stop stops ${n} at once.`,
          "Never in password managers, Keychain, System Settings, Terminal or messaging and call apps, and never on banking or payment pages.",
        ],
        notNow: "Not now",
        allow: `Let ${n} click and type`,
        footer: "You can turn this off in Help on this Mac.",
      },
      // S.8: the Mac's settings card, new rows.
      settings: {
        check: {
          label: "Check with me before every task",
          sub: `${n} asks “Do you want me to do this?” before anything, even opening an app. Off: your request is the go-ahead for routine things; ${she} still asks before deleting, sending, paying or anything to do with security.`,
          error: "That couldn't be saved. Try again.",
        },
        click: { label: "Clicking and typing for you", allowed: "Allowed", off: "Turn off", notYet: "Not yet. I'll ask the first time." },
        folders: {
          label: "Folders I work in",
          sub: "Desktop, Documents and Downloads, plus folders you add. Never Library, system or hidden folders.",
          state: { granted: "allowed", denied: "not allowed", unknown: "not asked yet" },
          remove: "Remove",
          add: "Add a folder…",
          refusedSystem: "That folder can't be added: it's a system or hidden folder.",
          refusedFull: "You can add up to 10 folders.",
        },
        jobs: "Jobs on this Mac",
        // The two switches' sub-lines under permission rule v2 (phase 3's said "only after you say yes").
        useMacSub: "Opens apps, files and pages and does common things when you ask. Asks first before anything that deletes, sends, pays or touches security.",
        filesSub: "Finds, organises, renames and moves your files when you ask, with Undo. Never deletes them.",
      },
      // S.5's words for a few the page says itself (the rest come from Rust and Boredroom whole).
      refused: refusedTable(),
    };
  }

  /** S.5: why she can't, by reason (Rust sends its own words too; these stand in when it sends only the reason). */
  function refusedTable() {
    return {
      app_none: (o) => ({ title: `I couldn't find an app called “${o.name || "that"}”`, sub: "Check the name, or open it once yourself." }),
      app_not_open: (o) => ({ title: `${o.app || "That app"} isn't open`, sub: "" }),
      installer: (o) => ({ title: `I don't open ${o.app || "that"}`, sub: "It installs, updates or erases things, and I never open those." }),
      quarantined: (o) => ({ title: `I don't open ${o.app || "that"} yet`, sub: "It came from the internet and hasn't been opened before. Open it once yourself first." }),
      outside: (o) => ({ title: "I only open apps from your Applications folders", sub: `${o.app || "That app"} isn't in one.` }),
      no_file: (o) => ({ title: "I couldn't find anything like that", sub: o.where ? `I looked in ${o.where}.` : "" }),
      runs: () => ({ title: "I never open that kind of file", sub: "It's an installer, a disk image, a certificate, a script or a link file." }),
      secret: () => ({ title: "I don't open that file", sub: "It looks like a password or key file." }),
      bad_url: () => ({ title: "I can't open that address", sub: "Only ordinary web pages, never downloads of apps or scripts." }),
      accessibility: () => ({ title: "I need Accessibility to do that", sub: "Allow it once, then ask me again.", enable: "accessibility" }),
      screen: () => ({ title: "I need Screen Recording to take screenshots", sub: "Allow it once, then ask me again.", enable: "screen" }),
      folder_denied: (o) => ({ title: `Your Mac hasn't let Boredroom into ${o.folder || "that folder"}`, sub: "Allow it in System Settings › Privacy & Security › Files and Folders, then ask me again.", enable: "folder" }),
      secure: () => ({ title: "That's a password box", sub: "I never type or copy in password boxes." }),
      never_type: (o) => ({ title: `I don't type in ${o.app || "that app"}`, sub: "It's one of the apps I never look at or work in." }),
      never_copy: (o) => ({ title: `I don't copy from ${o.app || "that app"}`, sub: "It's one of the apps I never look at or work in." }),
      nothing_selected: () => ({ title: "Nothing's selected", sub: "Select the text first, then ask me again." }),
      no_box: () => ({ title: "There's no box to type in", sub: "Click in the box first, then ask me again." }),
      own: () => ({ title: "I can't quit myself", sub: "Quit Boredroom from its menu (⌘Q)." }),
      finder: () => ({ title: "Finder always stays open", sub: "" }),
      finder_denied: () => ({ title: "Finder said no", sub: "Let Boredroom ask Finder in System Settings › Privacy & Security › Automation, or empty the Trash from the Dock.", enable: "finder" }),
      wifi_admin: () => ({ title: "macOS wants an administrator for that", sub: "Turn Wi-Fi off from Control Centre instead." }),
      offline: () => ({ title: "I can't reach Boredroom right now", sub: "Simple things like opening apps still work.", retry: true }),
      no_credit: () => ({ title: "I can't think that through right now", sub: "Boredroom's AI account has run out of credit. Simple things like “open Figma” still work." }),
      // Review, 16 October 2026: these three recover with one press of Try again (the request's own words, kept on the
      // card); busy also tries once more by itself first.
      busy: () => ({ title: "Claude is busy just now", sub: "Try again in a moment.", retry: true }),
      failed: () => ({ title: "I couldn't reach Claude just now", sub: "Try again in a moment.", retry: true }),
      job_busy: () => ({ title: "I'm still on the last job", sub: "Wait for it to finish, or stop it in the notch." }),
      mac_off: () => ({ title: "“Do things when I ask” is off on this Mac.", sub: "", enable: "mac" }),
      files_off: () => ({ title: "“Work on my files” is off on this Mac.", sub: "", enable: "files" }),
      stopped: () => ({ title: "Stopped", sub: "What I did before that stays done." }),
      other: (o) => ({ title: "I couldn't do that", sub: o.message || "" }),
    };
  }

  /** The server's and Rust's codes (contract O.3, L.2) as S.5's reasons. */
  const CODE_REASONS = Object.freeze({
    AI_NO_CREDIT: "no_credit", AI_BUSY: "busy", AI_FAILED: "failed", JOB_BUSY: "job_busy",
    FRONT_OFFLINE: "offline", LOOK_OFFLINE: "offline", OFFLINE: "offline",
  });

  // ---- "Check with me" sentences (contract S.2) ------------------------------------------------------------------

  const SIDE = (s) => (s === "left" || s === "right" ? s : "left");
  /** One action's verb phrase for "Check with me" (S.2), or "" for one that never asks (find_files). */
  function checkPhrase(a) {
    const kind = str(a?.kind);
    const x = clip(a?.label || a?.app || a?.name || a?.url || "", 60) || "it";
    const y = clip(a?.app2 || "", 60);
    switch (kind) {
      case "open_app": case "open_url": case "open_folder": case "open_file": return `open ${x}`;
      case "reveal_file": return `show ${x} in Finder`;
      case "switch_app": return `switch to ${x}`;
      case "hide_app": return `hide ${x}`;
      case "hide_others": return "hide the other apps";
      case "hide_all": return "hide everything";
      case "show_all": return "show everything again";
      case "minimise": return `minimise ${x}`;
      case "fill": return `make ${x} fill the screen`;
      case "half": return `put ${x} on the ${SIDE(a?.side)}`;
      case "arrange": return `put ${x} and ${y || "the other app"} side by side`;
      case "quit_app": return `quit ${x}`;
      case "volume": return a?.change === "up" ? "turn the volume up" : a?.change === "down" ? "turn the volume down" : `set the volume to ${int(a?.level, 0, 100) ?? 0} percent`;
      case "mute": return "mute the sound";
      case "unmute": return "turn the sound back on";
      case "screenshot": return "take a screenshot and save it to your Desktop";
      case "copy_selection": return "copy what's selected";
      case "type_text": return "type that into the box you're in";
      case "wifi": return a?.on === false ? "turn Wi-Fi off" : "turn Wi-Fi on";
      case "empty_trash": return "empty the Trash";
      case "find_files": return "";
      default: return "";
    }
  }
  /** "I'll open Figma and turn the volume down." (S.2), or for a job "I'll organise your Desktop." */
  function checkSentence(actions, job) {
    if (job && oneLine(job.title)) { const t = oneLine(job.title); return `I'll ${t.charAt(0).toLowerCase()}${t.slice(1).replace(/\.$/, "")}.`; }
    const parts = (Array.isArray(actions) ? actions : []).map(checkPhrase).filter(Boolean).slice(0, 3);
    if (!parts.length) return "";
    const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `I'll ${joined}.`;
  }

  // ---- the strip and the front cards (contract F.1, F.2) ---------------------------------------------------------

  /**
   * The strip (F.1). `kind`: "front" (a request on the Mac) or "job"; `phase`: "routing", "doing", "done", "paused";
   * `line`: the doing or done line; `k`/`of`: a job's progress; `undo`: the result can be undone; `paused`: why a job is
   * paused ("sleep", "offline", "lock"); `slow` (optional): a front sequence has run longer than a second, so Stop shows.
   */
  function stripModel(o = {}) {
    const kind = o.kind === "job" ? "job" : "front";
    const w = WORDS();
    const of = nonNeg(o.of), k = Math.min(nonNeg(o.k), of || nonNeg(o.k));
    const count = kind === "job" && of > 0 ? `${k} of ${of}` : null;
    // Review, 16 October 2026: Stop on "One moment" too once it has taken a second (`slow`), as for a slow sequence:
    // saying "stop" or pressing it drops the router's answer, and nothing it would have done happens.
    if (o.phase === "routing") return { dot: "none", text: o.retrying ? w.strip.retrying : w.strip.routing, count: null, stop: o.slow === true, undo: false };
    if (o.phase === "paused" || (o.paused && o.phase !== "done")) {
      const why = typeof o.paused === "string" && w.paused[o.paused] ? o.paused : "sleep";
      return { dot: "paused", text: w.paused[why], count, stop: true, undo: false };
    }
    if (o.phase === "done") return { dot: "done", text: stripLine(o.line) || w.strip.done, count: null, stop: false, undo: o.undo === true };
    if (o.phase === "doing") return { dot: "live", text: stripLine(o.line) || w.strip.routing, count, stop: kind === "job" || o.slow === true, undo: false };
    return { dot: "none", text: stripLine(o.line), count: null, stop: false, undo: false };
  }

  /**
   * The ask card (F.2 "front · ask"): Rust's `ask` event `{ question, because, yes, waitMs }`. A "Check with me" ask
   * (a sentence "I'll …" with nothing under it) gets "Do you want me to do this?" (S.2). Neutral: no orange.
   */
  function askModel(e = {}, name, keys) {
    const w = WORDS(name, keys);
    const title = clip(e.question, 300);
    let because = clip(e.because, 200);
    if (!because && /^I'll /.test(title)) because = w.check.question;
    const wait = int(e.waitMs, 1_000, JOB_ASK_MS) ?? ASK_MS;
    return { title, because, hint: w.check.hint, no: w.check.no, yes: clip(e.yes, 40) || w.check.yes, waitMs: wait };
  }

  /** "Downloads, changed 8 October" (S.4); "8 October 2025" in another year; "Changed 8 October" with no place. */
  function meta(where, ymd, nowMs) {
    const w = clip(where, 60);
    // A day ("2026-10-08", what Rust sends), a timestamp or ms. Words someone already wrote ("changed 8 October") stay
    // as they are: Date.parse would read that as 8 October 2001 (integration, 16 October 2026).
    if (typeof ymd !== "number" && !/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/.test(str(ymd))) {
      const t = clip(ymd, 60);
      return t ? (w ? `${w}, ${t}` : t) : w;
    }
    const at = typeof ymd === "number" ? ymd : Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(str(ymd)) ? `${ymd}T12:00:00` : str(ymd));
    if (!Number.isFinite(at)) return w;
    const d = new Date(at), now = new Date(Number.isFinite(nowMs) ? nowMs : Date.now());
    const day = `${d.getDate()} ${MONTHS[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : ""}`;
    return w ? `${w}, changed ${day}` : `Changed ${day}`;
  }
  const optionsOf = (list, max, nowMs) => (Array.isArray(list) ? list : []).filter((x) => x && typeof x === "object" && oneLine(x.name)).slice(0, max)
    .map((x, i) => ({ i, name: clip(x.name, 80), meta: meta(x.where, x.when, nowMs) }));

  /** The chooser (F.2 "front · choose", A.6): "Which one?", up to five rows, None of these. */
  function chooseModel(e = {}, nowMs) {
    const w = WORDS();
    return { title: clip(e.question, 120) || w.choose.title, options: optionsOf(e.options, CHOOSE_MAX, nowMs), none: w.choose.none };
  }
  /** The found list (F.2 "front · found"): "Found 3 files", rows with Open and Show in Finder, OK. */
  function foundModel(e = {}, nowMs) {
    const w = WORDS();
    const options = optionsOf(e.options, FOUND_MAX, nowMs);
    return { title: clip(e.title, 80) || w.choose.found(options.length), options, open: w.choose.open, reveal: w.choose.reveal, ok: w.choose.ok };
  }
  /**
   * The done card (F.2 "front · done"), shown when there is more than the strip can hold: the others ("Show the others
   * (2)"), Show in Finder (a screenshot) or Undo. `others` is the matches after the newest, `show` whether Show in Finder
   * is offered.
   */
  function doneModel(e = {}, nowMs) {
    const w = WORDS();
    const others = optionsOf(e.others, OTHERS_MAX, nowMs);
    return {
      title: clip(e.line, 160) || w.strip.done,
      others, othersLabel: others.length ? w.choose.others(others.length) : "", hideOthers: w.choose.hideOthers,
      open: w.choose.open, undo: e.undo === true, undoLabel: w.strip.undo, show: e.show === true, reveal: w.choose.reveal, ok: w.choose.ok,
      card: others.length > 0 || e.show === true,
    };
  }
  /**
   * The refused card (F.2 "front · refused", S.5): Rust's own `{ title, sub, enable? }`, or a reason (`why`) with the
   * names it needs, or a server error `{ code, message }`. `enable` names what is missing: "mac" and "files" (Turn it
   * on: the setup card), "accessibility" and "screen" (Allow it: that setup step), "folder" and "finder" (Open System
   * Settings at that pane). Turn it on and Allow it are the card's main (white) button (Q.3). Q.1 passes the assistant's
   * name too; S.5's words never need it ("Brenda" there is the app), so it is not read (integration, 16 October 2026).
   */
  function refusedModel(e = {}) {
    const t = refusedTable();
    const why = typeof e.why === "string" && Object.hasOwn(t, e.why) ? e.why
      : typeof e.code === "string" && CODE_REASONS[e.code] ? CODE_REASONS[e.code]
        : e.status === 0 && !e.title ? "offline" : null;
    const base = why ? t[why]({ app: clip(e.app, 60), name: clip(e.name, 60), folder: clip(e.folder, 60), where: clip(e.where, 120), message: clip(e.message, 300) }) : null;
    const title = clip(e.title, 160) || base?.title || "I couldn't do that";
    const sub = e.title ? clip(e.sub, 300) : base ? base.sub : clip(e.sub || e.message, 300);
    const which = ["mac", "files", "accessibility", "screen", "folder", "finder"].includes(e.enable?.which ?? e.enable) ? (e.enable?.which ?? e.enable) : base?.enable ?? null;
    const enable = which ? {
      which,
      button: which === "mac" || which === "files" ? "Turn it on" : which === "accessibility" || which === "screen" ? "Allow it" : "Open System Settings",
      accent: which === "mac" || which === "files" || which === "accessibility" || which === "screen",
      pane: which === "folder" ? "files" : which === "finder" ? "automation" : which === "screen" ? "screen" : which === "accessibility" ? "accessibility" : null,
    } : null;
    // Try again (white, never orange: Q.3) only where a second go can work and there is no switch to turn on.
    return { title, sub, enable, ok: "OK", retry: !enable && base?.retry === true ? "Try again" : null, why };
  }

  // ---- jobs (contract F.2, G, S.6) ---------------------------------------------------------------------------------

  /** "0:12", "1:05", "12:40", "1:02:03" (S.6's elapsed). */
  function elapsed(ms) {
    const s = Math.floor(nonNeg(ms) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const p = (v) => String(v).padStart(2, "0");
    return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
  }
  /** "12 seconds", "1 minute", "3 minutes", "1 hour 5 minutes" (S.6 "Done in {elapsed}."). */
  function durationWords(ms) {
    const s = Math.max(1, Math.round(nonNeg(ms) / 1000));
    if (s < 60) return `${s} ${s === 1 ? "second" : "seconds"}`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} ${m === 1 ? "minute" : "minutes"}`;
    const h = Math.floor(m / 60), r = m % 60;
    return `${h} ${h === 1 ? "hour" : "hours"}${r ? ` ${r} ${r === 1 ? "minute" : "minutes"}` : ""}`;
  }

  /**
   * The running job's card (F.2 "job · running", S.6): `{ title, pct, count, elapsed, note, sub }`. `job`: `{ doing,
   * title, done, of, note, startedAt, paused }`; `pct` is 0 to 100, or null while the count is not known yet.
   */
  function jobCardModel(job = {}, nowMs) {
    const w = WORDS();
    const of = nonNeg(job.of), done = Math.min(nonNeg(job.done), of || nonNeg(job.done));
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const started = Number.isFinite(job.startedAt) ? job.startedAt : now;
    const paused = typeof job.paused === "string" && w.paused[job.paused] ? w.paused[job.paused] : job.paused ? w.paused.sleep : "";
    return {
      title: clip(job.doing || job.title, 80),
      pct: of > 0 ? Math.round((done / of) * 100) : null,
      count: of > 0 ? `${done} of ${of}` : null,
      elapsed: elapsed(now - started),
      note: clip(job.note, 60) || w.job.thinking,
      sub: paused || w.job.sub,
    };
  }
  /** A job's ask card (F.2 "job · ask", S.3): the Trash, or a question the job's step asked. Neutral: no orange. */
  function jobAskModel(ask = {}) {
    const w = WORDS();
    const count = int(ask.count, 0, 100_000);
    const trash = ask.kind === "delete";
    const what = clip(ask.what, 80).replace(/^move\s+\d+\s+/i, "").replace(/\s+to the Trash$/i, "");
    return {
      title: clip(ask.question, 200) || (trash ? w.ask.jobTrash(count ?? 0, what) : clip(ask.what, 200)),
      because: clip(ask.because, 200) || (trash ? w.ask.jobBecause : ""),
      wait: w.ask.jobWait,
      no: w.check.no,
      yes: trash ? w.ask.moveToTrash : w.check.yes,
    };
  }
  /**
   * A job's end card (F.2 "job · done / stopped / failed / undone", S.6). `e.phase`: "done", "stopped", "failed" or
   * "undone"; the rest as Rust's `brenda://job` events carry it. Undo shows while anything changed and is not undone.
   */
  function jobEndModel(e = {}, name) {
    const w = WORDS(name);
    const outputs = (Array.isArray(e.outputs) ? e.outputs : []).filter((o) => o && oneLine(o.name)).slice(0, 10)
      .map((o, i) => ({ i: int(o.i, 0, 1000) ?? i, name: clip(o.name, 80), folder: clip(o.folder, 60) }));
    const undo = e.undo === true;
    const base = { kind: e.phase, outputs, undo, undoLabel: w.job.undo, open: w.job.open, reveal: w.job.reveal, ok: w.job.ok, settings: null, folder: null };
    if (e.phase === "done") {
      // Show in Finder for the folder the job changed things in ("Desktop"; review, 16 October 2026: organising had
      // only Undo). Only from this build's Rust, which sends `folder` and has `job_show_folder`.
      const folder = oneLine(e.folder) ? { title: clip(e.folder, 60), label: w.job.reveal } : null;
      return { ...base, folder, title: clip(e.summary, 300) || w.strip.done, sub: Number.isFinite(e.ms) ? w.job.doneIn(durationWords(e.ms)) : "" };
    }
    if (e.phase === "undone") {
      const restored = nonNeg(e.restored), skipped = nonNeg(e.skipped);
      return { ...base, undo: false, outputs: [], title: w.job.undone.title, sub: w.job.undone.sub(restored, skipped) };
    }
    // A folder macOS refused (Rust's `settings`, G.5): Open System Settings at Files and Folders.
    const folderSettings = e.settings === true ? { label: w.job.settings, pane: "files" } : null;
    if (e.phase === "failed") {
      const settings = /FOLDER|EPERM/i.test(str(e.code)) || e.settings === true ? { label: w.job.settings, pane: "files" } : null;
      const msg = clip(e.message, 300);
      return { ...base, settings, title: w.job.failed.title, sub: msg ? `${msg.replace(/([^.!?])$/, "$1.")} ${w.job.failed.tail}` : w.job.failed.tail };
    }
    // Stopped: lost Boredroom, a no to the Trash, or Stop.
    if (e.why === "offline") return { ...base, title: w.job.lost.title, sub: w.job.lost.sub };
    if (e.why === "said_no") return { ...base, title: w.ask.jobNo, sub: undo ? w.ask.jobNoChanged.trim() : "" };
    if (e.why === "cannot") {
      const reason = clip(e.summary, 300);
      return { ...base, settings: folderSettings, title: w.job.cannot.title, sub: reason ? `${reason.replace(/([^.!?])$/, "$1.")}${undo ? ` ${w.job.failed.tail}` : ""}` : undo ? w.job.stopped.changed : w.job.stopped.nothing };
    }
    return { ...base, title: w.job.stopped.title, sub: undo ? w.job.stopped.changed : w.job.stopped.nothing };
  }

  /** The one-time click consent (F.2 "consent · click", S.7). */
  function consentModel(name) {
    return { ...WORDS(name).consent };
  }

  /**
   * The settings card's new rows (F.3, S.8) from `LookStatus.front` (v4): Check with me, Clicking and typing for you,
   * Folders I work in. Null when this Rust has no front desk.
   */
  function settingsRows(lookStatus, name) {
    const f = lookStatus?.front;
    if (!f || typeof f !== "object" || (lookStatus?.v ?? 1) < 4) return null;
    const w = WORDS(name).settings;
    const folders = (Array.isArray(f.folders) ? f.folders : []).filter((x) => x && oneLine(x.title || x.name)).slice(0, 13).map((x) => {
      const state = ["granted", "denied", "unknown"].includes(x.state) ? x.state : "unknown";
      const title = clip(x.title || x.name, 60);
      const added = x.source === "added";
      return { source: added ? "added" : "named", name: clip(x.name, 255), title, state, words: added ? title : `${title}: ${w.folders.state[state]}`, remove: added ? w.folders.remove : null };
    });
    const addedCount = folders.filter((x) => x.source === "added").length;
    return {
      check: { label: w.check.label, sub: w.check.sub, on: f.checkEvery === true, error: w.check.error },
      click: { label: w.click.label, on: f.clickConsent === true, words: f.clickConsent === true ? w.click.allowed : w.click.notYet, button: f.clickConsent === true ? w.click.off : null },
      folders: { label: w.folders.label, sub: w.folders.sub, rows: folders, add: addedCount < 10 ? w.folders.add : null, full: addedCount >= 10 ? w.folders.refusedFull : null },
      jobs: w.jobs,
    };
  }

  // ---- the first short line in her natural voice (contract M.2) -----------------------------------------------------

  /** The key of a short line's clip: `${id}|${speed}|${text}`, or null without a natural voice or words. */
  function lineKey(naturalVoice, text) {
    const v = naturalVoice;
    const t = oneLine(text);
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(v.id) || !t || t.length > 200) return null;
    const speed = ["slower", "normal", "faster"].includes(v.speed) ? v.speed : "normal";
    return `${v.id}|${speed}|${t}`;
  }

  /**
   * The short-line clips (M.2): in memory and in `storage` (localStorage) under `brenda.lines.v1`, at most 40 clips and
   * 1.5 MB, the oldest out first; every read and write in try/catch, so a blocked storage keeps them for the run only.
   */
  function LineCache(storage) {
    let items = null; // [{ k, a }], oldest first
    const load = () => {
      if (items) return items;
      items = [];
      try {
        const raw = storage?.getItem?.(LINES_KEY);
        const j = raw ? JSON.parse(raw) : null;
        if (j && j.v === 1 && Array.isArray(j.items)) items = j.items.filter((x) => x && typeof x.k === "string" && typeof x.a === "string" && x.a.length > 0).slice(-LINES_MAX);
      } catch { items = []; }
      return items;
    };
    const save = () => { try { storage?.setItem?.(LINES_KEY, JSON.stringify({ v: 1, items })); } catch { /* storage blocked or full: memory only */ } };
    const size = () => items.reduce((n, x) => n + x.a.length + x.k.length, 0);
    return {
      get(key) {
        if (typeof key !== "string" || !key) return null;
        const hit = load().find((x) => x.k === key);
        return hit ? hit.a : null;
      },
      put(key, audio) {
        if (typeof key !== "string" || !key || typeof audio !== "string" || !audio || audio.length + key.length > LINES_BYTES) return false;
        load();
        items = items.filter((x) => x.k !== key);
        items.push({ k: key, a: audio });
        while (items.length > LINES_MAX || size() > LINES_BYTES) items.shift();
        save();
        return true;
      },
      clear() { items = []; try { storage?.removeItem?.(LINES_KEY); } catch { /* blocked */ } },
    };
  }

  // ---- when any of this shows (contract F.0) -----------------------------------------------------------------------

  /**
   * The front desk is on here: this build's Rust (`LookStatus.v` 4 or later), told `front.ready` itself, and Boredroom
   * says migration 0060 is applied (`data.look.front.ready`). With today's binary (v2) or phase 3's (v3), or before 0060,
   * the notch behaves exactly as before.
   */
  function frontOn(lookStatus, data) {
    return (lookStatus?.v ?? 1) >= 4 && data?.look?.front?.ready === true && lookStatus?.front?.ready === true;
  }

  return Object.freeze({ WORDS, stripModel, askModel, chooseModel, foundModel, doneModel, refusedModel, jobCardModel, jobAskModel,
    jobEndModel, consentModel, settingsRows, lineKey, LineCache, meta, elapsed, frontOn,
    // Also used by the page (not part of the Q.1 contract's list, so the tests need not pin them).
    checkSentence, stripLine, durationWords, ASK_MS, JOB_ASK_MS, LINES_KEY });
})();
if (typeof module === "object" && module && module.exports) module.exports = Front;
