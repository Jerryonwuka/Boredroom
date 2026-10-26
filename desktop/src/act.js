// Brenda for Mac, phase 2: doing things on the Mac only when the person asks and says yes (owner rule, 12 October 2026:
// "Brenda cannot take any action except I explicitly give an instruction … if it's a core task, Brenda should confirm, oh,
// do you want me to do this? And then I'll say, yes, I need you to do this"). The act cards' words and small rules, as
// pure functions. Plain JavaScript, no build step: a classic script loaded after look.js and before main.js, sharing their
// one global scope, and loadable by Node for the unit tests (tests/unit/notch-act.test.ts), as look.js is.
//
// What this file is not: the gate. The rule is enforced by Rust (the request and the yes came from the person's own hands
// and voice: a real press on Yes, or Rust's own transcript passing the yes grammar) and by Boredroom (this person, this
// plan, this yes, this step; contract 0.2). The page only shows what it is told and passes presses on; nothing here
// starts a task, and there is no button anywhere that offers to do something the person did not ask for (rule a). The
// grammar below is a copy of the contract's (0.5) so the notch can say at once what it heard when the person types an
// answer; Rust checks it again and its verdict is the one that counts.
//
// The words are the contract's (A.6 to A.10, E.2 to E.4), in both naming versions: when the person's assistant is not
// called Brenda, every "she" and "her" attached to the name is the name (the notch's naming rule, owner decision,
// 7 October 2026). "Brenda" stays where it is the app's name (System Settings, macOS's prompts). The asking card is
// neutral on purpose: no orange and not her colour, so a question never reads as an alarm or a nudge (contract A.4).
//
// Phase 3 (owner report and requests, 12 October 2026: "I wanted Brenda to assist me with some things, like open an app
// on my desktop, and it said it can't do that"; "Brenda is meant to assist you do anything you need it to do";
// companion2 contract D, M.7). A request can now be a plan: one sentence and up to eight lines saying exactly what each
// part touches ("Open Figma (Applications)", "Read the 14 documents in Documents … and save “Documents summary.docx”
// there"), one question and one yes for all of it. The asking card shows the sentence and the lines as text, waits while
// Brenda for Mac finds what the lines name ("Getting that ready…"), and lists a folder's files on request ("Show the 14";
// their names never leave this Mac before the yes). Then "Part 2 of 3" with what she is opening, a folder job's "Reading
// 4 of 14", the step card again before a Boredroom change that reaches anyone else, and the done card with what she saved.
// The two consents' words live on under the setup card's "Read everything" (help.js).

const Act = (() => {
  /** The fixed question after every plan (contract 0.4). */
  const QUESTION = "Do you want me to do this?";
  /** A proposal waits this long for an answer; silence is no (contract 0.1 b). */
  const ANSWER_MS = 60_000;
  /** How long the small outcome lines stay (contract A.6.3, A.7.5, A.10). */
  const T = Object.freeze({ SAID_YES_MS: 1_000, NO_MS: 3_000, UNCLEAR_MS: 5_000, EXPIRED_MS: 5_000, DONE_MS: 8_000, REFUSED_MS: 10_000, HEARD_MS: 1_000, ESC_HINT_MS: 5_000 });
  /** The look keys' symbols when Rust has not said (`LookStatus.keysLabel`). */
  const KEYS_LABEL = "⌃ ⌘";
  /** A step note in the companion's pill and the doing card (contract A.4: 48 characters at most). */
  const NOTE_MAX = 48;

  const str = (v) => (typeof v === "string" ? v : "");
  // Control and invisible characters out, whitespace collapsed (as look.js: written as escapes, never the characters).
  const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;
  const oneLine = (v) => str(v).replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const chars = (s) => [...s];
  const clip = (s, n) => { const c = chars(oneLine(s)); return c.length > n ? `${c.slice(0, n - 1).join("").trimEnd()}…` : c.join(""); };
  /** The person's assistant's name ("Brenda" unless they renamed theirs). */
  const nameOf = (name) => oneLine(name) || "Brenda";
  /** A sentence ends with a full stop (or its own mark). */
  const stop = (s) => { const t = oneLine(s); return !t ? "" : /[.!?…]$/.test(t) ? t : `${t}.`; };
  /** A file's or app's name as a card shows it: one line, at most 120 characters. */
  const fileName = (v) => clip(v, 120);
  const appName = (app) => clip(typeof app === "string" ? app : app?.name, 80) || "this app";
  const keysLabelOf = (label) => { const k = oneLine(label); return k && k.length <= 12 ? k : KEYS_LABEL; };

  // ---- the consents (contract E.2, E.3; the same shape as look.js's) ------------------------------------------------

  /**
   * "Let Brenda use my Mac" (contract E.2): the person's own opt-in on this Mac, never offered from the menu bar as a
   * one-click switch. When the assistant is Brenda, exactly the contract's words; for any other name, the name wherever
   * "she" or "her" would sit next to it.
   */
  function consentMac(name) {
    const n = nameOf(name);
    const b = n === "Brenda";
    return {
      title: `Let ${n} do things on your Mac when you ask`,
      paras: [
        { text: b
          ? "When you ask her to do something on your screen, like “rename these files” or “fill in this form from my notes”, Brenda can move the pointer, click and type for you, one step at a time, while you watch."
          : `When you ask ${n} to do something on your screen, like “rename these files” or “fill in this form from my notes”, ${n} can move the pointer, click and type for you, one step at a time, while you watch.` },
        { lead: "Only when you ask, and only after you say yes.", text: b
          ? "She tells you exactly what she'll do and asks “Do you want me to do this?”. Nothing happens until you press Yes or say “yes”. Silence means no. Before anything she can't undo, like sending, deleting, paying or signing in, she asks again."
          : `${n} tells you exactly what ${n} will do and asks “Do you want me to do this?”. Nothing happens until you press Yes or say “yes”. Silence means no. Before anything ${n} can't undo, like sending, deleting, paying or signing in, ${n} asks again.` },
        { lead: b ? "You can stop her at once." : `You can stop ${n} at once.`, text: b
          ? "Press Esc, hold her keys, or press Stop. If you move the mouse or type while she works, she pauses and asks."
          : `Press Esc, hold ${n}'s keys, or press Stop. If you move the mouse or type while ${n} works, ${n} pauses and asks.` },
        { lead: b ? "Where she never works." : `Where ${n} never works.`, text: b
          ? "Password managers, Keychain, System Settings, Terminal, messaging and call apps, the apps on your never-look list, and banking and payment pages (she spots those by their addresses, which can miss some). Never during a Boredroom call, or while she can tell your screen is being shared (she can't always tell, so stop her before you share)."
          : `Password managers, Keychain, System Settings, Terminal, messaging and call apps, the apps on your never-look list, and banking and payment pages (${n} spots those by their addresses, which can miss some). Never during a Boredroom call, or while ${n} can tell your screen is being shared (${n} can't always tell, so stop ${n} before you share).` },
        { lead: "What leaves your Mac.", text: b
          ? "While she works, a picture of the screen after each step goes, through Boredroom's own account, to Anthropic, to decide the next step. The pictures and the steps are never kept. A short note of what she did stays in your Activity for 30 days, and only you can see it."
          : `While ${n} works, a picture of the screen after each step goes, through Boredroom's own account, to Anthropic, to decide the next step. The pictures and the steps are never kept. A short note of what ${n} did stays in your Activity for 30 days, and only you can see it.` },
        // "Brenda" in the first sentence is the app's name in System Settings, whatever the assistant is called.
        { lead: "Your Mac will ask.", text: `macOS will ask you to allow Brenda under Accessibility. That's the permission that lets an app use the mouse and keyboard. ${b ? "She" : n} uses it only during a task you said yes to.` },
      ],
      notNow: "Not now",
      turnOn: `Let ${n} use my Mac`,
      footer: "Turn it off any time from the menu bar or Settings › Your assistant.",
    };
  }

  /** "Let Brenda work on files" (contract E.3), both naming versions. */
  function consentFiles(name) {
    const n = nameOf(name);
    const b = n === "Brenda";
    return {
      title: `Let ${n} work on files when you ask`,
      paras: [
        { text: b
          ? "Ask her to summarise a PDF, tidy a spreadsheet or draft a document from a file, and Brenda works on it while you carry on. Select the file in Finder, have it open in front of you, or drop it on her."
          : `Ask ${n} to summarise a PDF, tidy a spreadsheet or draft a document from a file, and ${n} works on it while you carry on. Select the file in Finder, have it open in front of you, or drop it on ${n}.` },
        { lead: b ? "Only the file you give her, and only after you say yes." : `Only the file you give ${n}, and only after you say yes.`, text: b
          ? "She tells you what she'll make and where she'll save it, and asks “Do you want me to do this?”. She reads only that file."
          : `${n} tells you what ${n} will make and where ${n} will save it, and asks “Do you want me to do this?”. ${n} reads only that file.` },
        { lead: "Your file stays as it is.", text: b ? "She always saves a new file next to it. She never changes or replaces yours." : `${n} always saves a new file next to it. ${n} never changes or replaces yours.` },
        // Rule f (review, 12 October 2026): a file job stops as a screen task does.
        { lead: "Stopping.", text: b ? "Press Esc, hold her keys, or press Stop, and she stops at once. While she works on a file, Esc and her keys are hers to stop it, so she looks at your screen again once it's done." : `Press Esc, hold ${n}'s keys, or press Stop, and ${n} stops at once. While ${n} works on a file, Esc and ${n}'s keys are there to stop it, so ${n} looks at your screen again once it's done.` },
        { lead: "What leaves your Mac.", text: `The file's text (or, for small PDFs and pictures, the file itself) goes through Boredroom's own account to Anthropic to do the work. Nothing from it is kept on Boredroom's servers, and your workspace can't see it. The file's name and what ${b ? "she" : n} made stay in your Activity for 30 days, only for you.` },
        // "whether Brenda can control Finder": macOS names the app.
        { lead: "Your Mac will ask.", text: `Next, your Mac asks whether Brenda can control Finder, so ${b ? "she" : n} can see which files you've selected. It may also ask about your Documents or Desktop folder the first time ${b ? "she" : n} opens a file there.` },
      ],
      notNow: "Not now",
      turnOn: `Let ${n} work on files`,
      footer: "",
    };
  }

  /** A consent as plain text, paragraph by paragraph (the tests, and the card's accessible description). */
  function consentText(c) {
    return [c.title, ...c.paras.map((p) => (p.lead ? `${p.lead} ${p.text}` : p.text)), `[ ${c.notNow} ] [ ${c.turnOn} ]`, ...(c.footer ? [c.footer] : [])].join("\n\n");
  }

  /** The Mac's own permission steps (contract E.4). */
  function permissionWords(name) {
    const n = nameOf(name);
    return {
      accessibility: {
        title: "One more step on your Mac",
        sub: `Your Mac will ask you to allow Boredroom under Privacy & Security › Accessibility. Turn on Boredroom there. ${n} uses it only during a task you said yes to.`,
        notNow: "Not now", go: "Continue",
      },
      accessibilityDenied: {
        title: "Allow Boredroom in System Settings",
        sub: "Privacy & Security › Accessibility, then turn on Boredroom. You may need to quit and reopen Boredroom afterwards.",
        notNow: "Not now", check: "Check again", open: "Open System Settings",
        stillOff: "Boredroom isn't allowed yet. Turn it on in that list, then check again.",
      },
      finder: {
        title: "One more step on your Mac",
        sub: `Your Mac will ask whether Brenda can control Finder. Say OK so ${n} can see which files you select. You can say no: dropping files on ${n} still works.`,
        notNow: "Not now", go: "Continue",
      },
      finderDenied: {
        title: "Finder said no",
        sub: `Finder said no, so drop files on ${n} instead. You can change it in System Settings › Privacy & Security › Automation.`,
        ok: "OK",
      },
    };
  }

  // ---- asking (contract A.6) --------------------------------------------------------------------------------------

  /** "Q3 report.pdf → Q3 report (Brenda summary).md", or "" (contract A.6.1: both names as text, never markup). */
  function fileLine(file, output) {
    const from = fileName(file?.name);
    const to = output?.format === "doc" ? (fileName(output?.name) ? `“${fileName(output.name)}” in Boredroom` : "") : fileName(output?.name);
    return from && to ? `${from} → ${to}` : from || to || "";
  }

  /** The step kinds of a plan, and what each part opens (companion2 contract H.2.1). */
  const STEP_KINDS = Object.freeze(["open", "folder", "file", "screen", "boredroom"]);
  const OPEN_TARGETS = Object.freeze(["app", "url", "folder", "file", "recent", "reveal"]);
  const NAMED_FOLDERS = Object.freeze({ home: "home folder", desktop: "Desktop", documents: "Documents", downloads: "Downloads", pictures: "Pictures", movies: "Movies", music: "Music" });
  /** A folder reference as the page shows it: { source, name } (named folders by their key), or null. */
  function folderRefOf(f) {
    if (!f || typeof f !== "object") return null;
    const source = ["named", "front_folder", "finder_selection", "none"].includes(f.source) ? f.source : null;
    if (!source) return null;
    const name = clip(f.name, 120);
    if (source === "named" && !Object.hasOwn(NAMED_FOLDERS, name)) return null;
    return { source, name };
  }
  /** A folder's display name: "Documents", "your home folder", or the folder's own name. */
  function folderName(f) {
    const r = folderRefOf(f);
    if (!r || r.source === "none") return "";
    if (r.source === "named") return r.name === "home" ? "your home folder" : NAMED_FOLDERS[r.name];
    return r.name;
  }
  /** One step of a v2 TaskView, as the page keeps it (only what the cards show), or null when it is not one. */
  function stepOf(s, i) {
    if (!s || typeof s !== "object" || s.i !== i || !STEP_KINDS.includes(s.kind)) return null;
    if (s.kind === "open") {
      if (!OPEN_TARGETS.includes(s.target)) return null;
      return { i, kind: "open", target: s.target, name: clip(s.name, 120), url: clip(s.url, 2000), folder: folderRefOf(s.folder) ?? { source: "none", name: "" } };
    }
    if (s.kind === "folder") {
      const output = s.output && typeof s.output === "object" ? { format: str(s.output.format), name: fileName(s.output.name) } : null;
      return { i, kind: "folder", folder: folderRefOf(s.folder) ?? { source: "none", name: "" }, perFile: s.perFile === true, job: clip(s.job, 120), output };
    }
    if (s.kind === "file") {
      const output = s.output && typeof s.output === "object" ? { format: str(s.output.format), name: fileName(s.output.name) } : null;
      return { i, kind: "file", file: s.file && typeof s.file === "object" ? { source: oneLine(s.file.source), name: fileName(s.file.name) } : null, output };
    }
    if (s.kind === "screen") return { i, kind: "screen", goal: clip(s.goal, 200) };
    return { i, kind: "boredroom", summary: clip(s.summary, 200), outward: s.outward === true };
  }
  /** A plan's lines (companion2 contract H.2.1): at most 8, each one line of at most 200 characters, or null. */
  function linesOf(v) {
    if (!Array.isArray(v)) return null;
    const out = v.slice(0, 8).map((l) => clip(l, 200)).filter(Boolean);
    return out.length ? out : null;
  }

  /**
   * A TaskView (contract B.6.1, and companion2 H.2.1 for a plan) as the notch may show it, or null: an id, a plan that
   * starts "I'll", one line. A plan (`kind: "plan"`, `v: 2`) brings its steps in order (each `i` its place) and, once
   * Brenda for Mac has found what they name, its lines. Rust has checked it already (`view_ok_v2`, the hash over the
   * sentence and the lines); the page only draws it, as text.
   */
  function taskOf(t) {
    if (!t || typeof t !== "object") return null;
    const id = oneLine(t.id);
    const plan = oneLine(t.plan);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || !plan.startsWith("I'll ") || chars(plan).length > 240) return null;
    if (t.kind === "plan") {
      if (t.v !== 2 || !Array.isArray(t.steps) || t.steps.length < 1 || t.steps.length > 6) return null;
      const steps = t.steps.map((s, i) => stepOf(s, i));
      if (steps.some((s) => !s)) return null;
      const by = typeof t.answerBy === "string" ? Date.parse(t.answerBy) : NaN;
      return { id, kind: "plan", v: 2, plan, question: QUESTION, risky: t.risky === true, steps, lines: linesOf(t.lines), needsScope: t.needsScope === true, file: null, output: null,
        answerBy: Number.isFinite(by) ? by : null, stepCap: Number.isInteger(t.stepCap) ? t.stepCap : null };
    }
    const kind = t.kind === "file" ? "file" : "screen";
    const file = t.file && typeof t.file === "object" && oneLine(t.file.name) ? { source: oneLine(t.file.source), name: fileName(t.file.name) } : null;
    const output = t.output && typeof t.output === "object" && oneLine(t.output.name)
      ? { format: ["md", "txt", "csv", "docx", "pdf", "doc"].includes(t.output.format) ? t.output.format : "md", name: fileName(t.output.name) } : null;
    const by = typeof t.answerBy === "string" ? Date.parse(t.answerBy) : NaN;
    return { id, kind, plan, question: QUESTION, risky: t.risky === true, file, output, answerBy: Number.isFinite(by) ? by : null, stepCap: Number.isInteger(t.stepCap) ? t.stepCap : null };
  }

  /** The asking card's words (contract A.6.1). `o`: { name, keysLabel, escRegistered }. */
  function askCard(task, o = {}) {
    const t = taskOf(task);
    const k = keysLabelOf(o.keysLabel);
    return {
      plan: t ? t.plan : "",
      question: QUESTION,
      file: t && t.kind === "file" ? fileLine(t.file, t.output) : "",
      // A plan's lines (M.7), each with the kind of the step it says, for its small icon.
      lines: t && t.kind === "plan" ? planLines(t) : [],
      risky: t?.risky ? "I'll ask again before anything I can't undo." : "",
      hint: `Answer with Yes or No, or hold ${k} and say it. I'll wait a minute.`,
      listening: "Listening for your answer…",
      placeholder: "Or type yes or no",
      label: "Your answer",
      no: "No",
      yes: "Yes, do it",
      wait: "One moment…",
      saidYes: "You said yes.",
    };
  }

  /** Why she is waiting at an outward step (contract A.7.3). */
  const BECAUSE = Object.freeze({
    send: "this sends something", submit: "this submits a form", delete: "this deletes something", pay: "this pays for something",
    share: "this shares something", publish: "this publishes something", sign_in: "this signs in", accept_terms: "this accepts terms",
    overwrite: "this replaces a file", quit: "this quits an app", other: "this can't be undone",
  });
  /** The step card (contract A.7.3): "Next I'll press Send on the email to Ada." and why it asks. */
  function stepCard(ask) {
    const what = oneLine(ask?.what).replace(/[.!?…]+$/, "");
    const kind = Object.hasOwn(BECAUSE, ask?.kind) ? ask.kind : "other";
    return {
      title: what ? `Next I'll ${clip(what, 200)}.` : "Next I'll do something I can't undo.",
      question: QUESTION,
      because: `I'm waiting because ${BECAUSE[kind]}.`,
      no: "No, stop here",
      yes: "Yes, do it",
      saidNo: { title: "Stopped before that step.", sub: "What I did before it stays done." },
    };
  }

  /** What an answer led to (contract A.6.3): the line, how long it stays, and what the chat keeps. */
  function outcome(kind) {
    switch (kind) {
      case "no": return { title: "Okay, I won't.", ms: T.NO_MS };
      case "unclear": return { title: "I didn't catch a clear yes, so I won't do it.", ms: T.UNCLEAR_MS };
      case "expired": return { title: "I didn't hear a yes, so I won't do it.", ms: T.EXPIRED_MS };
      // Review, 12 October 2026: words that change the request ("yes but only the first three"); a new question follows.
      case "new_request": return { title: "Okay, I'll ask you about that instead.", ms: T.NO_MS };
      case "unresolved": return { title: "That proposal didn't arrive whole, so I won't do it.", ms: T.UNCLEAR_MS };
      default: return { title: "Okay, I won't.", ms: T.NO_MS };
    }
  }

  // ---- plans (companion2 contract D, M.7) --------------------------------------------------------------------------

  /** The small icon beside a line, by its step's kind (contract J.3). */
  const LINE_ICON = Object.freeze({ open: "open", folder: "folder", file: "doc", screen: "pointer", boredroom: "check" });
  /**
   * A plan's lines with their icons: one per step when there are as many (Boredroom writes them in step order), else the
   * neutral tick. Before Brenda for Mac has found what they name there are none (the card waits: "Getting that ready…").
   */
  function planLines(t) {
    const lines = Array.isArray(t?.lines) ? t.lines : [];
    const steps = Array.isArray(t?.steps) ? t.steps : [];
    return lines.map((text, i) => ({ text, icon: lines.length === steps.length ? LINE_ICON[steps[i]?.kind] ?? "check" : "check" }));
  }
  /** The waiting form of the asking card while Brenda for Mac finds what the plan names (M.7). */
  const scopingWords = (plan) => ({ plan: oneLine(plan), wait: "Getting that ready…" });
  /** "Show the 14" / "Hide them" under a folder job's line (local names, never sent before the yes). */
  const showWhich = (n, open) => (open ? "Hide them" : `Show the ${Number.isInteger(n) && n > 0 ? n : ""}`.trim());
  /** A local file name as the "Show which" list draws it. */
  const localNames = (v) => (Array.isArray(v) ? v.slice(0, 25).map((x) => fileName(x)).filter(Boolean) : []);

  /** A web address's host ("figma.com"), or "" when it is not one. */
  function hostOf(url) {
    try { const u = new URL(oneLine(url)); return u.protocol === "https:" || u.protocol === "http:" ? u.hostname.replace(/^www\./, "") : ""; } catch { return ""; }
  }
  /** What a part of the plan is doing now (M.7), from its step: "Opening Figma…", "Making the change in Boredroom…". */
  function partNote(step) {
    if (!step || typeof step !== "object") return "";
    if (step.kind === "boredroom") return "Making the change in Boredroom…";
    if (step.kind !== "open") return "";
    if (step.target === "app") return step.name ? noteOf(`Opening ${step.name}…`) : "";
    if (step.target === "url") { const h = hostOf(step.url); return h ? noteOf(`Opening ${h}…`) : ""; }
    if (step.target === "folder") { const f = folderName(step.folder) || step.name; return f ? noteOf(`Opening ${f}…`) : ""; }
    if (step.target === "reveal") return step.name ? noteOf(`Showing ${step.name} in Finder…`) : "";
    return step.name ? noteOf(`Opening ${step.name}…`) : "";
  }
  /** The doing card's "Part 2 of 3" for a plan (M.7), or "" when Rust did not say. */
  function partWords(part) {
    const k = Number.isInteger(part?.k) ? part.k : null, of = Number.isInteger(part?.of) ? part.of : null;
    return k && of && k >= 1 && k <= of ? `Part ${k} of ${of}` : "";
  }
  const nounOf = (n, kinds) => (kinds === "image" ? (n === 1 ? "picture" : "pictures") : n === 1 ? "document" : "documents");
  /**
   * A folder job's bar and card (M.7): "Reading 4 of 14, 1:05"; "Working on Documents"; then "Saving “…”…" once every
   * file is read. `o`: { folder: { name, done, of }, output, ms, escRegistered }.
   */
  function folderWorkingWords(o = {}) {
    const f = o.folder && typeof o.folder === "object" ? o.folder : {};
    const where = clip(f.name, 80) || "your folder";
    const of = Number.isInteger(f.of) && f.of > 0 ? f.of : 0;
    const done = Number.isInteger(f.done) && f.done >= 0 ? Math.min(f.done, of) : 0;
    const k = Math.min(done + 1, of);
    const out = o.output?.format === "doc" ? clip(o.output?.name, 120) : fileName(o.output?.name ?? o.output);
    const saving = of > 0 && done >= of;
    const esc = o.escRegistered === false ? "" : " Esc stops me.";
    return {
      bar: saving ? `Saving “${out}”…` : `Reading ${k} of ${of}, ${elapsed(o.ms)}`,
      reading: `Reading ${k} of ${of}`,
      title: `Working on ${where}`,
      sub: saving ? `Saving “${out}”…` : `Reading ${k} of ${of} ${nounOf(of)}.${out ? ` I'll save “${out}” ${o.output?.format === "doc" ? "in Boredroom" : `in ${where}`}.` : ""} You can carry on.${esc}`,
      stop: "Stop",
      saving,
    };
  }
  /**
   * A plan's done card (M.7): its title is Boredroom's summary; "Saved in Documents." when it saved a file, "Done."
   * otherwise, and how many files a folder job skipped.
   */
  function planDoneCard(evt = {}) {
    const summary = stop(clip(evt.summary, 500));
    const outputs = Array.isArray(evt.outputs) ? evt.outputs.filter((x) => x && typeof x === "object" && oneLine(x.name)).slice(0, 4).map((x) => ({ name: fileName(x.name), folder: clip(x.folder, 80) })) : [];
    const skipped = Number.isInteger(evt.skipped) && evt.skipped > 0 ? evt.skipped : 0;
    const saved = outputs.length ? (outputs[0].folder ? `Saved in ${outputs[0].folder}.` : "Saved.") : "Done.";
    const sub = `${saved}${skipped ? ` I skipped ${skipped}: they were too long or couldn't be read.` : ""}`;
    const doc = evt.doc && typeof evt.doc === "object" ? { title: clip(evt.doc.title, 120), href: str(evt.doc.href) } : null;
    return { kind: "plan", title: summary || "Done.", sub, outputs, doc, reveal: "Show in Finder", open: "Open", ok: "OK", said: summary || "Done." };
  }
  /** A plan Brenda for Mac could not get ready (M.7): Boredroom's words, and what was (not) done. */
  function unresolvedCard(evt = {}, task = null) {
    const opens = Array.isArray(task?.steps) && task.steps.length > 0 && task.steps.every((s) => s.kind === "open");
    return { title: stop(clip(evt.message, 300)) || "I couldn't get that ready.", sub: opens ? "Nothing was opened." : "Nothing was done.", settings: evt.settings === "files" ? "files" : null, open: "Open System Settings", ok: "OK" };
  }

  // ---- doing, pausing, working (contract A.7, A.8) ------------------------------------------------------------------

  /** A step note as the companion's pill and the doing card show it: one line, 48 characters at most. */
  const noteOf = (note) => clip(note, NOTE_MAX);
  /** "0:42", "12:05", "1:02:09": the working bar's clock (tabular digits in the page). */
  function elapsed(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const pad = (n) => String(n).padStart(2, "0");
    return s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
  }
  /** The doing bar and card (contract A.7.1). `escRegistered` false: the global Esc could not be had, so Stop is the way. */
  function doingWords(o = {}) {
    const esc = o.escRegistered !== false;
    const step = Number.isInteger(o.step) && o.step > 0 ? o.step : 1;
    return {
      bar: esc ? "Working on it, Esc stops me" : "Working on it",
      title: "Working on it",
      // A plan says which part it is on (M.7: "Part 2 of 3"); a screen task, its step.
      step: partWords(o.part) || `Step ${step}`,
      note: noteOf(o.note),
      first: esc ? "I'm using your mouse and keyboard. Press Esc to stop me." : "I'm using your mouse and keyboard. Press Stop to stop me.",
      stop: "Stop",
      kbd: esc ? "esc" : "",
    };
  }
  /** Why she paused (contract A.7.4). */
  function whyPaused(why) {
    if (why === "typed") return "You typed something, so I stopped for a moment.";
    if (why === "focus") return "Another window came to the front, so I stopped for a moment.";
    return "You moved the pointer, so I stopped for a moment.";
  }
  const pausedWords = (why) => ({ title: "I paused", sub: whyPaused(why), stop: "Stop", go: "Carry on" });
  /** The working bar and card for a file job (contract A.8.3). */
  function workingWords(o = {}) {
    const file = fileName(o.file?.name ?? o.file) || "your file";
    const out = o.output?.format === "doc" ? `“${fileName(o.output?.name) || "a document"}” in Boredroom` : fileName(o.output?.name ?? o.output);
    return {
      bar: `Working on ${file}, ${elapsed(o.ms)}`,
      title: `Working on ${file}`,
      sub: `${out ? (o.output?.format === "doc" ? `I'll save ${out}. You can carry on.` : `I'll save ${out} next to it. You can carry on.`) : "You can carry on."}${o.escRegistered === false ? "" : " Esc stops me."}`,
      stop: "Stop",
    };
  }

  // ---- endings (contract A.7.5, A.7.6, A.8.4) -----------------------------------------------------------------------

  /** The done card from Rust's `done` event: a screen task, a file saved next to the original, or a Boredroom document. */
  function doneCard(evt = {}, task = null) {
    const summary = stop(clip(evt.summary, 500));
    if (evt.doc && typeof evt.doc === "object") {
      const title = clip(evt.doc.title, 120) || "your document";
      return { kind: "doc", title: `Saved “${title}” in Boredroom`, sub: summary, open: "Open", ok: "OK", said: summary || `Saved ${title} in Boredroom.` };
    }
    if (evt.output && typeof evt.output === "object" && oneLine(evt.output.name)) {
      const name = fileName(evt.output.name);
      const from = fileName(task?.file?.name);
      const folder = clip(evt.output.folder, 80);
      const where = from ? `Next to ${from}${folder ? ` in ${folder}` : ""}.` : folder ? `In ${folder}.` : "";
      return { kind: "file", title: `Saved ${name}`, sub: where, reveal: "Show in Finder", open: "Open", ok: "OK", said: summary || `I've saved ${name}.` };
    }
    const n = Number.isInteger(evt.steps) && evt.steps > 0 ? evt.steps : null;
    return { kind: "screen", title: summary || "Done.", sub: n ? `Done in ${n} step${n === 1 ? "" : "s"}.` : "", ok: "OK", said: summary || "Done." };
  }

  /** What `stopped` says (contract A.7.6, A.9, A.10): the reason's row when there is one, else where she stopped. */
  function stoppedCard(evt = {}, o = {}) {
    const step = Number.isInteger(evt.step) ? evt.step : null;
    const note = noteOf(evt.note);
    const last = note ? `The last thing I did: ${note}` : "";
    if (o.kind === "file") return { title: "Stopped.", sub: "Your file is as it was.", last: "" };
    if (o.saidNo || evt.why === "said_no" || evt.why === "step_no") return { ...stepCard({}).saidNo, last };
    const row = { locked: "locked", display: "display_gone", offline: "offline", call: "on_call", share: "sharing" }[evt.why];
    if (row) { const r = refusal(row, o); return { title: r.title, sub: `${r.sub ? `${r.sub} ` : ""}What I did before that stays done.`.trim(), last }; }
    if (evt.why === "paused_timeout") return { title: "Stopped.", sub: "You didn't answer, so I stopped. What I did before that stays done.", last };
    return { title: "Stopped.", sub: step && step > 1 ? `I stopped before step ${step}. What I did before that stays done.` : "I stopped before doing anything.", last };
  }
  /** `cannot_continue` (the model's reason, as text) and a failure (contract A.7.6). */
  const cannotCard = (reason) => ({ title: "I stopped", sub: stop(clip(reason, 300)), last: "What I did before that stays done." });
  function failedCard(evt = {}, o = {}) {
    const msg = stop(clip(evt.message, 300));
    if (evt.code === "ACT_LIMIT") return { title: "You've used today's requests", sub: msg, last: "" };
    if (o.kind === "file") return { title: "I couldn't finish that", sub: `${msg ? `${msg} ` : ""}Your file is as it was.`, last: "" };
    if (o.started === false) return { title: "I couldn't start that", sub: msg || "Nothing was done.", last: "" };
    return { title: "I couldn't finish that", sub: `${msg ? `${msg} ` : ""}What I did before that stays done.`, last: "" };
  }

  /** What the chat keeps when a task ends (contract C.3: request, proposal, outcome; nothing else about the task). */
  function chatLine(kind, evt = {}, task = null) {
    if (kind === "done") return task?.kind === "plan" || evt.kind === "plan" ? planDoneCard(evt).said : doneCard(evt, task).said;
    if (kind === "stopped") return "Stopped.";
    if (kind === "said_no") return outcome(evt.verdict === "unclear" ? "unclear" : "no").title;
    if (kind === "expired") return outcome("expired").title;
    if (kind === "cannot") return `I stopped: ${stop(clip(evt.reason, 300)) || "I couldn't carry on."}`;
    if (kind === "failed") return failedCard(evt).title + ".";
    if (kind === "unresolved") return unresolvedCard(evt, task).title;
    return "";
  }

  // ---- refusals (contract A.10) -------------------------------------------------------------------------------------

  /** A refusal's title and sub-line. `o`: { name, app, n, pages, message }. `answer_first` stays on the asking card. */
  function refusal(reason, o = {}) {
    const n = nameOf(o.name);
    const app = appName(o.app);
    const steps = Number.isInteger(o.n) && o.n > 0 ? o.n : null;
    const after = steps ? `I stopped after ${steps} step${steps === 1 ? "" : "s"}. What I did stays done.` : "I stopped. What I did stays done.";
    switch (reason) {
      // Phase 3 (M.7): the switches' new names, and the card offers "Turn it on" (main.js), never just "off".
      case "use_mac_off": return { title: "Doing things on your Mac is off", sub: `Turn on “Do things when I ask” in Help on this Mac. ${n} asks before every task.` };
      case "files_off": return { title: "Working on files is off", sub: "Turn on “Work on my files” in Help on this Mac." };
      // A plan Brenda for Mac could not get ready (contract D.3): Boredroom's words, as they came.
      case "unresolved": return { title: stop(clip(o.message, 300)) || "I couldn't get that ready", sub: "Nothing was done." };
      case "act_not_available": return { title: "On-screen actions aren't on in this workspace", sub: "" };
      case "forbidden_app": return { title: `I never work in ${app}`, sub: "Password managers, Keychain, System Settings, Terminal, and messaging and call apps are always off limits." };
      case "payment_page": return { title: "I don't work on banking or payment pages", sub: "Do this one yourself." };
      case "on_call": return { title: "I don't look or work on your screen during a Boredroom call", sub: "Try again when the call ends." };
      case "sharing": return { title: "Your screen looks shared", sub: "I don't look or work while it's being shared." };
      case "busy_task": return { title: "I'm still on the last job", sub: "Wait for it to finish, or stop it in the notch." };
      case "answer_first": return { title: "Answer this one first", sub: "" };
      // Boredroom's own window (owner request, 24 October 2026): never clicked or typed in.
      case "own_window": return { title: "That's Boredroom itself", sub: "I can't click or type in it." };
      case "cap": return { title: "That took more steps than I'm allowed", sub: after };
      case "too_big": return { title: "This task got too big to send", sub: after };
      case "time": return { title: "That took longer than ten minutes", sub: "I stopped. What I did stays done." };
      case "display_gone": return { title: "That screen went away", sub: "So I stopped." };
      case "locked": return { title: "Your Mac locked", sub: "So I stopped." };
      case "offline": return { title: "I can't reach Boredroom right now", sub: "So I stopped." };
      case "file_unresolved": return { title: "I couldn't find that file", sub: "Select it in Finder or drop it on me, then ask again." };
      case "file_too_big": return { title: "That file is too big for me", sub: "I can work on files up to 25 MB." };
      case "file_type": return { title: "I can't read that kind of file yet", sub: "PDF, Word, text, Markdown, CSV, Excel and pictures work." };
      case "file_scan": return { title: "That PDF is a scan", sub: "It's too big for me to read as pictures. Try a smaller one." };
      case "file_long": return { title: "That file is too long for me", sub: `It's about ${Number.isInteger(o.pages) && o.pages > 0 ? o.pages : "too many"} pages; I can read about 150.` };
      case "file_failed": return { title: "I couldn't make that file", sub: `${stop(clip(o.message, 300)) ? `${stop(clip(o.message, 300))} ` : ""}Your file is as it was.` };
      case "pdf_unavailable": return { title: "I can't make PDFs on this Mac yet", sub: "Ask for a Word document or Markdown instead." };
      case "ACT_LIMIT": return { title: "You've used today's requests", sub: stop(clip(o.message, 300)) };
      default: return { title: "I couldn't do that", sub: stop(clip(o.message, 300)) };
    }
  }

  // ---- the yes grammar (contract 0.5; the same vectors as Rust's yes.rs and src/lib/act.ts) ---------------------------

  const words = (list) => new Set(list.split(" "));
  const YES_WORD = words("yes yeah yep yup sure ok okay alright correct absolutely definitely certainly");
  const TAIL = ["do it", "do that", "do this", "go ahead", "go for it", "go on", "carry on", "continue", "proceed", "please do",
    "please do it", "i need you to do this", "i need you to do that", "i need you to do it", "i want you to do this",
    "i want you to do that", "i want you to do it", "thats right", "thats fine",
    // Review, 12 October 2026: everyday yeses that were refused.
    "go", "you can do it", "you can do that", "you can do this", "you can go ahead", "you can"].map((t) => t.split(" "));
  const THANKS = [["please"], ["thanks"], ["thank", "you"]];
  const NOW = [["now"], ["right", "now"]];
  const NO_FIRST = words("no nope nah dont stop cancel never");
  const NO_PHRASES = new Set(["not now", "never mind", "leave it", "no thanks", "no thank you", "not yet", "dont do it", "dont"]);
  // "and" is allowed only between two TAIL phrases ("go ahead and do it"; review, 12 October 2026).
  const BLOCK = words("no nope nah not dont never stop wait cancel hold hang but except instead actually only first before after rather change different wrong maybe later if unless or why what how which who where when");
  const FILLERS = words("um uh er erm hmm so well oh");

  /** Text to tokens as the grammar reads it (steps 1 and 3): NFKC, lower case, straight quotes, [a-z0-9' ] only. */
  function tokens(text) {
    let s = str(text);
    try { s = s.normalize("NFKC"); } catch { /* an engine without normalize: as typed */ }
    s = s.toLowerCase().replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, "\"");
    return { s, list: s.replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean) };
  }
  /** Whether `list` from `at` starts with `seq`. */
  const startsAt = (list, at, seq) => seq.every((w, i) => list[at + i] === w);
  /**
   * Step 9: YES_WORD+ ["please"] [TAIL [["and"] TAIL]] ["now"] [THANKS], or ["please"] TAIL [["and"] TAIL] ["now"]
   * [THANKS], over the whole list (with backtracking).
   */
  function yesShape(t) {
    const thanksEnd = (at) => at === t.length || THANKS.some((th) => startsAt(t, at, th) && at + th.length === t.length);
    const nowThen = (at) => thanksEnd(at) || NOW.some((n) => startsAt(t, at, n) && thanksEnd(at + n.length));
    const secondTail = (at) => TAIL.some((tl) => startsAt(t, at, tl) && nowThen(at + tl.length));
    const tails = (at) => TAIL.some((tl) => startsAt(t, at, tl) && (nowThen(at + tl.length) || secondTail(at + tl.length) || (t[at + tl.length] === "and" && secondTail(at + tl.length + 1))));
    const tailThen = (at) => nowThen(at) || tails(at);
    const afterYes = (at) => tailThen(at) || (t[at] === "please" && tailThen(at + 1));
    let i = 0;
    while (i < t.length && YES_WORD.has(t[i])) { i++; if (afterYes(i)) return true; }
    // ["please"] TAIL …
    return tails(0) || (t[0] === "please" && tails(1));
  }
  /** Her name (all its words), "brenda" and "hey" taken out wherever they stand (a form of address), fillers off both ends. */
  function answerTokens(list, assistantName) {
    const own = tokens(assistantName).list;
    const t = [];
    for (let i = 0; i < list.length;) {
      if (own.length && startsAt(list, i, own)) { i += own.length; continue; }
      if (list[i] === "brenda" || list[i] === "hey") { i++; continue; }
      t.push(list[i]);
      i++;
    }
    while (t.length && FILLERS.has(t[0])) t.shift();
    while (t.length && FILLERS.has(t[t.length - 1])) t.pop();
    return t.map((w) => (w === "don't" ? "dont" : w === "that's" ? "thats" : w));
  }
  /**
   * The verdict on an answer: "yes", "no" or "unclear" (unclear is treated as no: nothing happens). `assistantName`'s
   * own words, "brenda" and "hey" are dropped wherever they stand ("Max, yes go ahead", "Yes, Brenda"; review, 12 October
   * 2026).
   */
  function verdict(text, assistantName) {
    const { s, list } = tokens(text);
    if (s.includes("?")) return "unclear";
    const t = answerTokens(list, assistantName);
    if (!t.length || t.length > 10) return "unclear";
    if (NO_PHRASES.has(t.join(" ")) || NO_FIRST.has(t[0])) return "no";
    if (t.some((w) => BLOCK.has(w))) return "unclear";
    return yesShape(t) ? "yes" : "unclear";
  }

  // ---- small rules ----------------------------------------------------------------------------------------------------

  /** Rust's ActStatus as the page keeps it, or null (an older Rust has no act commands, so nothing of this shows). */
  function statusOf(s) {
    if (!s || typeof s !== "object" || typeof s.supported !== "boolean") return null;
    const ax = ["granted", "denied", "unknown"].includes(s.accessibility) ? s.accessibility : "unknown";
    const finder = ["granted", "denied", "unknown"].includes(s.finder) ? s.finder : "unknown";
    const phases = ["scoping", "asking", "confirming", "running", "step_ask", "paused", "working"];
    const t = s.task && typeof s.task === "object" && typeof s.task.id === "string" && phases.includes(s.task.phase)
      ? { id: s.task.id, kind: ["file", "plan"].includes(s.task.kind) ? s.task.kind : "screen", phase: s.task.phase, plan: oneLine(s.task.plan), step: Number.isInteger(s.task.step) ? s.task.step : 0, startedAt: typeof s.task.startedAt === "number" ? s.task.startedAt : null }
      : null;
    // Phase 3 (companion2 contract I.2): this build's Rust says what macOS answered for each folder, and that it runs plans.
    const perm = (v) => (["granted", "denied", "unknown"].includes(v) ? v : "unknown");
    const folders = s.folders && typeof s.folders === "object" ? { documents: perm(s.folders.documents), desktop: perm(s.folders.desktop), downloads: perm(s.folders.downloads) } : null;
    return { supported: s.supported, available: s.available === true, useMac: s.useMac === true, fileWork: s.fileWork === true, accessibility: ax, finder, escRegistered: s.escRegistered === true, task: t,
      folders, plans: Number.isInteger(s.plans) && s.plans > 0 ? s.plans : 0 };
  }
  /** Whether the ask box's typed words are an answer the notch can send (Enter in the asking card's own box). */
  const typedAnswer = (text, name) => { const v = verdict(text, name); return { verdict: v, answer: v === "yes" ? "yes" : "no" }; };

  return Object.freeze({ QUESTION, ANSWER_MS, T, NOTE_MAX, BECAUSE, consentMac, consentFiles, consentText, permissionWords, fileLine, taskOf, askCard,
    stepCard, outcome, noteOf, elapsed, doingWords, whyPaused, pausedWords, workingWords, doneCard, stoppedCard, cannotCard, failedCard, chatLine,
    refusal, verdict, typedAnswer, statusOf,
    STEP_KINDS, LINE_ICON, folderName, planLines, scopingWords, showWhich, localNames, hostOf, partNote, partWords, folderWorkingWords, planDoneCard, unresolvedCard });
})();
if (typeof module === "object" && module && module.exports) module.exports = Act;
