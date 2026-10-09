// Brenda's notifications in the notch: the cards (owner decision, 9 October 2026: notch notifications, "A plus the
// grafts"; the approved mockup is direction A, "Glance", with B's Together, row of faces and moods, and C's pager footer
// and figure box grafted in; docs/design-system.md, "Desktop notch"). Plain JavaScript, no build step, a classic script
// loaded after sound.js and before notify.js and main.js. One global, `NotifyCards`: pure functions that return markup.
// Nothing here reads the page, `data` or `card`; everything comes in through the arguments (main.js builds `env` once per
// render, `noticeEnv()`), so Node loads it too (tests/unit/notch-cards.test.ts).
//
// What a card is (owner decision, 9 October 2026, the mockup's rules): one line you can read in a second. A byline with
// the face of whoever's assistant brought the news, in the mood of the news (alert waits on you, happy and happy is good
// news, sad is late, gulp is new or not started, dimmed is no reply); a 20px headline of 30 characters or fewer, written to
// fit (each one the cards write has a short form, never an ellipsis), or the thing itself on up to two lines; then numbers
// as chips, someone's own words beside a 2px bar in their assistant's coat colour, or one figure in a box; then one or two
// buttons, the main one marked `data-main` (Enter presses it) and at most one orange, only where there is a yes to give.
// Good news is Together: both assistants cheek to cheek at 44px, one shared hop and two stars in their colours. Several at
// once are one summary ("Hey Jeremiah, you have 8 notifications", the row of faces, the kinds) and a pager the person turns
// (C's footer: dots in each kind's colour, "3 of 8", Mark all read, ‹ and Next ›, Finish on the last), ending on "All
// caught up". The compact bar never says "All clear" beside a count: the newest sender and line, or "8 new, 2 need you".
//
// Every word other people wrote (names, messages, task titles, notes) goes through env.esc() only, never Markdown, never a
// link, and only paths env.boredroomPath() accepts reach `data-href`. Colours in inline styles are only validated #rrggbb
// face colours. A kind it does not know, or facts that are missing or malformed, draw the plain card, never an error: a
// template that throws falls back to the plain card too, so a card is never drawn empty (the empty black island, owner's
// screenshot, 9 October 2026).

// A global for main.js, a later classic script on the page (and module.exports for Node, at the end).
const NotifyCards = (() => {
  const HEX = /^#[0-9a-f]{6}$/i;
  const HEADLINE_MAX = 30;      // the mockup's rule: a headline the cards write is 30 characters or fewer
  const QUOTE_MAX = 400;        // the server clips previews to 160; anything longer is cut here, the box clamps to 2 lines
  const LINE_MAX = 120;         // the bar's one line
  const NAMES_MAX = 12;         // people listed under a chip (the server sends at most 12)
  const LINEUP_MAX = 6;         // faces in the summary's row, then +N (B's lineup)
  const DOTS_MAX = 12;          // the pager's dots, a window around the current one
  const LINES_MAX = 8;          // a request's "what would change" lines without facts
  const BRENDA = { name: "Brenda", colour: "white", visor: "bean", eyes: "pill", face: { hi: "#ffffff", mid: "#ececf0", edge: "#c9cad1" } };

  // ---- words, numbers and times ---------------------------------------------------------------------------------------

  const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  const str = (v) => (typeof v === "string" ? v : "");
  /** One line: control characters to spaces, runs of white space collapsed. */
  const one = (v) => [...str(v)].map((ch) => { const c = ch.charCodeAt(0); return c < 32 || (c >= 127 && c < 160) || c === 0x2028 || c === 0x2029 ? " " : ch; }).join("").replace(/\s+/g, " ").trim();
  const chars = (s) => [...String(s)].length;
  const clip = (s, max) => { const c = [...String(s)]; return c.length > max ? `${c.slice(0, max - 1).join("").trimEnd()}…` : String(s); };
  const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const countWords = (t) => { const s = String(t ?? "").trim(); return s ? s.split(/\s+/).length : 0; };
  /** The first of the headlines that fits in 30 characters; the last one is always short and names nobody. */
  const fit = (...c) => { const list = c.filter((x) => typeof x === "string" && x); return list.find((x) => chars(x) <= HEADLINE_MAX) ?? list[list.length - 1] ?? ""; };
  const firstOf = (name) => one(name).split(" ")[0] || "";
  const plural = (n, a, b) => (n === 1 ? a : b);
  const possessive = (first) => (first ? `${first}'s` : "their");

  const dateOf = (v) => { if (typeof v !== "string" && typeof v !== "number") return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
  const hhmm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const wd = (d) => d.toLocaleDateString("en-GB", { weekday: "short" });
  const dm = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  /** "Fri 9 Oct", as main.js's dayOf writes it. */
  const dayOf = (d) => `${wd(d)} ${dm(d)}`;
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const daysBetween = (a, b) => Math.round((startOf(b) - startOf(a)) / 86_400_000);
  /** A report's local date ("2026-10-08") as noon that day here, for its weekday. */
  const localDay = (v) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(str(v))) return null; const d = new Date(`${v}T12:00:00`); return Number.isNaN(d.getTime()) ? null : d; };
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  /** A length of time as the mockup writes it: "13h 20m", "4h", "45m", "0m". */
  const hm = (minutes) => { const m = Math.max(0, Math.round(minutes)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };

  // ---- icons --------------------------------------------------------------------------------------------------------
  // The mockup's lucide paths, in main.js's icon() format (its `ic-NAME` class picks the move a button's icon makes on
  // hover, style.css). The check keeps main.js's pathLength="1" so it draws itself as main.js's does.
  const ICONS = {
    clock: `<circle cx="12" cy="12" r="9.5"/><path d="M12 7v5l3 2"/>`,
    check: `<path d="M20 6 9 17l-5-5" pathLength="1"/>`,
    checks: `<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>`,
    alert: `<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5"/><path d="M12 16.3h.01"/>`,
    userx: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 5 5"/><path d="m22 8-5 5"/>`,
    late: `<path d="M12 7v5l2.5 1.5"/><path d="M21 12a9 9 0 1 0-6.4 8.6"/><path d="M19 16v3"/><path d="M19 22h.01"/>`,
    calendar: `<rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M16 2.5v4"/><path d="M8 2.5v4"/><path d="M3 10h18"/>`,
    list: `<path d="M9 6h12"/><path d="M9 12h12"/><path d="M9 18h12"/><path d="M4 6h.01"/><path d="M4 12h.01"/><path d="M4 18h.01"/>`,
    inbox: `<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`,
    send: `<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>`,
    flag: `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>`,
    timer: `<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>`,
    hourglass: `<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>`,
    open: `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`,
    reply: `<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>`,
    x: `<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`,
    left: `<path d="m15 18-6-6 6-6"/>`,
    right: `<path d="m9 18 6-6-6-6"/>`,
    arrow: `<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>`,
    play: `<path d="M7 4.5v15l12-7.5z"/>`,
    pencil: `<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>`,
    task: `<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>`,
    snooze: `<circle cx="12" cy="13" r="8"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M10 10h4l-4 5h4"/>`,
    undo: `<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>`,
    // Blocked on the team report (lucide Ban): the mockup has no chip for it.
    ban: `<circle cx="12" cy="12" r="9.5"/><path d="m5.3 5.3 13.4 13.4"/>`,
  };
  const icon = (name) => (own(ICONS, name) ? `<svg class="ic ic-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>` : "");
  /** B's star, in an assistant's coat colour (a validated face colour only). */
  const star = (hex) => `<svg viewBox="0 0 10 10" aria-hidden="true"><path fill="${hex}" d="M5 0 6.1 3.9 10 5 6.1 6.1 5 10 3.9 6.1 0 5 3.9 3.9Z"/></svg>`;
  const DOT = { talk: "var(--talk-dot)", needs: "var(--needs-dot)", good: "var(--good-dot)", plain: "var(--plain-dot)" };
  const dotOf = (family) => (own(DOT, family) ? DOT[family] : DOT.plain);

  // ---- the words other parts of the notch use (copied verbatim from main.js, which this file cannot read) -------------

  /** LOOP_INBOX in main.js (the contract's LOOP_WORDS.inbox in src/lib/commitments.ts). */
  const LOOP_INBOX = {
    commitmentQuestion: "Add it to your to-dos?", commitmentQuestionNoTodos: "Track it as your commitment?", nothingChanges: "Nothing is added until you accept.",
    openAskQuestion: "Take it on?", askerToldOnDecline: (first) => `${first} is told what you decide.`,
    accept: "Add to my to-dos", acceptNoTodos: "Accept", takeItOn: "Take it on", decline: "Decline", dismiss: "Not a commitment",
    notMe: "Not me",
  };
  /** STANDUP_SAY in main.js (STANDUP_WORDS in src/lib/standup.ts): the parts the standup card uses. */
  const STANDUP_SAY = {
    labels: { yesterday: "Yesterday", today: "Today", blocked: "Blocked" },
    nothing: "Nothing",
    members: (n) => (Number.isInteger(n) && n > 0 ? `${n} ${n === 1 ? "person" : "people"}` : "member count not available"),
    goesTo: (to, members, name) => `Goes to ${to} (${members}), as you, sent by ${name}`,
    skip: "Skip today", edit: "Edit", post: "Post",
  };
  /** FU_BADGE in main.js: a follow-up answer's status in words. */
  const FU_BADGE = { answered: { label: "Answered", tone: "ok" }, expired: { label: "No reply", tone: "" }, declined: { label: "Not now", tone: "" }, failed: { label: "Couldn't follow up", tone: "bad" } };
  const PRIVATE_LEAD = /^Only visible to you\.\s*/;
  const STATUS = { todo: "To do", in_progress: "In progress", blocked: "Blocked", in_review: "In review", completed: "Done" };

  // ---- kinds ----------------------------------------------------------------------------------------------------------
  // Owner decision, 9 October 2026 (the contract's A.4 table): each type's template, its family (the wash and the dot:
  // talk violet, needs orange, good green, plain a white haze), its group in the pager's order (asks, then what has a
  // time, people, reports, good news last), whether it waits on the person, and the word the summary says for it.

  const T = (template, family, group, waits, word) => ({ template, family, group, waits, word });
  const TYPES = {
    "message.direct": T("message", "talk", "people", false, "message"),
    "assistant.message": T("message", "talk", "people", false, "message"),
    "assistant.reply": T("message", "talk", "people", false, "reply"),
    "task.comment": T("message", "talk", "people", false, "comment"),
    "message.mention": T("mention", "talk", "people", false, "mention"),
    "brenda.mention_reply": T("reply", "talk", "people", false, "reply"),
    "brenda.mention_private": T("reply", "talk", "people", false, "reply"),
    "assistant.tagged": T("reply", "talk", "people", false, "reply"),
    "assistant.thread_reply": T("reply", "talk", "people", false, "reply"),
    "brenda.followup_answer": T("answer", "talk", "people", false, "answer"),
    "brenda.followup_batch": T("answer", "talk", "people", false, "answer"),
    "brenda.daily_report": T("report", "plain", "report", false, "report"),
    "review.approved": T("together", "good", "good", false, "approved"),
    "brenda.commitment_accepted": T("together", "good", "good", false, "took it on"),
    "brenda.block_answered": T("together", "good", "good", false, "answered"),
    "assistant.request": T("request", "needs", "ask", true, "asks"),
    "brenda.followup_ask": T("ask", "needs", "ask", true, "asks"),
    "brenda.commitment": T("commitment", "needs", "ask", true, "commitment"),
    "brenda.open_ask": T("commitment", "needs", "ask", true, "asks"),
    "brenda.blocked_on": T("blocked", "needs", "ask", true, "blocked"),
    "brenda.standup": T("standup", "needs", "ask", true, "standup"),
    "brenda.mention_confirm": T("confirm", "needs", "ask", true, "to confirm"),
    "brenda.replan": T("confirm", "needs", "ask", true, "re-plan"),
    "review.requested": T("confirm", "needs", "ask", true, "review"),
    "adjustment.requested": T("confirm", "needs", "ask", true, "to decide"),
    "capture.exception": T("confirm", "needs", "ask", true, "to decide"),
    "brenda.reminder": T("reminder", "needs", "time", false, "reminder"),
    "task.assigned": T("assignment", "needs", "time", false, "new task"),
    "brenda.commitment_due": T("due", "needs", "time", false, "due"),
    "brenda.nudge": T("plain", "needs", "time", false, "nudge"),
    "brenda.commitment_stalled": T("plain", "needs", "time", false, "stalled"),
    "task.blocked": T("plain", "needs", "time", false, "blocked"),
    "review.changes_requested": T("plain", "needs", "time", false, "changes"),
    "brenda.routine": T("routine", "plain", "report", false, "routine"),
    "brenda.routine_bundle": T("routine", "plain", "report", false, "routine"),
    "brenda.standup_rollup": T("rollup", "plain", "report", false, "standup"),
    "brenda.clock_in": T("clockin", "good", "good", false, "clocked in"),
    // The plain card, with the family of what they are: someone's answer or question is talk, a failure is a sad report.
    "review.question": T("plain", "talk", "people", false, "update"),
    "brenda.commitment_declined": T("plain", "talk", "people", false, "update"),
    "brenda.block_not_me": T("plain", "talk", "people", false, "update"),
    "brenda.routine_failed": T("plain", "plain", "report", false, "update"),
    "brenda.standup_failed": T("plain", "plain", "report", false, "update"),
  };
  const UNKNOWN = T("plain", "plain", "report", false, "update");
  /** Kinds whose plain card shows a sad face: something couldn't be done. */
  const SAD = new Set(["brenda.routine_failed", "brenda.standup_failed"]);
  /** What the workspace's own assistant sends (its face, "Team" in the summary). */
  const FROM_WS = new Set(["brenda.daily_report", "brenda.commitment"]);

  /** A notification's facts as the server sent them (B.1), or null: anything else draws the plain card. */
  const factsOf = (n) => (n && typeof n === "object" && n.facts && typeof n.facts === "object" && n.facts.v === 1 && typeof n.facts.kind === "string" ? n.facts : null);
  const facts = (n, kind) => { const f = factsOf(n); return f && f.kind === kind ? f : null; };

  /** The template, family, group, whether it waits and its word, from the type and its facts (own keys only). */
  function classify(type, f) {
    const t = str(type);
    const F = f && typeof f === "object" ? f : null;
    if (t === "assistant.outcome") {
      return F && F.kind === "request" && F.status === "done" ? T("together", "good", "good", false, "accepted") : T("plain", "talk", "people", false, "update");
    }
    if (t === "brenda.commitment_due") return F && F.kind === "commitment" && F.overdue === true ? T("due", "needs", "time", false, "overdue") : { ...TYPES[t] };
    return own(TYPES, t) ? { ...TYPES[t] } : { ...UNKNOWN };
  }

  // ---- the environment ------------------------------------------------------------------------------------------------

  const ESC = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /** env with every part it needs: a missing part is the safe one (nothing opens, Brenda's face, nothing busy). */
  function envOf(env) {
    const x = env && typeof env === "object" ? env : {};
    const assistantOf = typeof x.assistantOf === "function" ? x.assistantOf : () => BRENDA;
    return {
      esc: typeof x.esc === "function" ? x.esc : ESC,
      face: typeof x.face === "function" ? x.face : () => "",
      me: x.me && typeof x.me === "object" ? x.me : assistantOf(null),
      ws: x.ws && typeof x.ws === "object" ? x.ws : assistantOf(null),
      assistantOf,
      displayName: str(x.displayName),
      workspaceName: str(x.workspaceName),
      now: num(x.now) ?? Date.now(),
      boredroomPath: typeof x.boredroomPath === "function" ? x.boredroomPath : () => null,
      state: x.state && typeof x.state === "object" ? x.state : {},
      busy: !!x.busy,
      canStart: !!x.canStart,
      // All the person's unread notifications, past the 20 the state carries (review, 9 October 2026); null when not known.
      unreadTotal: int(x.unreadTotal),
    };
  }
  const nameOf = (a) => one(a?.name) || "Brenda";
  const midOf = (a) => (a && a.face && HEX.test(str(a.face.mid)) ? a.face.mid : BRENDA.face.mid);
  /** A person from the facts or the state ({ name, assistant, membershipId? }), resolved; null without a name. */
  function personOf(env, p) {
    if (!p || typeof p !== "object") return null;
    const name = clip(one(p.name), 80);
    if (!name) return null;
    const id = one(p.membershipId) || one(p.id);
    return { key: id || `name:${name.toLowerCase()}`, name, first: firstOf(name), who: env.assistantOf(p.assistant && typeof p.assistant === "object" ? p.assistant : null) };
  }
  /** A path the notch may open, or null (main.js's boredroomPath decides; nothing else reaches data-href). */
  const pathOf = (env, ...hrefs) => { for (const h of hrefs) { const p = typeof h === "string" ? env.boredroomPath(h) : null; if (typeof p === "string" && p) return p; } return null; };

  // ---- the desktop state's lists (read only, with main.js's own guards) --------------------------------------------------

  const ready = (x) => (x && typeof x === "object" && x.ready === true ? x : null);
  const arr = (x) => (Array.isArray(x) ? x : []);
  const byId = (list, id) => arr(list).find((x) => x && typeof x === "object" && typeof x.id === "string" && x.id === id) ?? null;
  /** What the state carries about a notification (an item, an ask, a loop, a standup, a run), or null. */
  function stateOf(env, n) {
    const s = env.state, id = n?.resource_id, t = str(n?.type);
    if (t === "assistant.message" || t === "assistant.request" || t === "assistant.reply") return byId(ready(s.assistantItems)?.waiting, id);
    if (t === "assistant.outcome") return byId(ready(s.assistantItems)?.updates, id);
    if (t === "brenda.followup_ask") return byId(ready(s.followUps)?.waiting, id);
    if (t === "brenda.followup_answer") return byId(ready(s.followUps)?.answered, id);
    if (t === "brenda.commitment" || t === "brenda.open_ask") return byId(ready(s.loops)?.commitments, id);
    if (t === "brenda.blocked_on") return byId(ready(s.loops)?.blocks, id);
    if (t === "brenda.standup") return byId(ready(s.standup)?.entries, id);
    if (t === "brenda.standup_rollup") return byId(ready(s.standup)?.rollups, id);
    if (t === "brenda.routine") { const runs = arr(ready(s.routineRuns)?.recent); return runs.find((r) => r && r.notificationId === n.id) ?? byId(runs, id); }
    return null;
  }

  // ---- the parts of a card ------------------------------------------------------------------------------------------

  /** One render's tools: escaping, the words it puts on the card (for the hold time), and its options. */
  function kit(env, opts, c) {
    const words = [];
    const e = (s) => env.esc(s);
    const n = c && c.n && typeof c.n === "object" ? c.n : null;
    return {
      env, opts, n, words, e,
      /** Escaped, one line, and counted. */
      say: (s) => { const t = one(s); if (t) words.push(t); return e(t); },
      count: (s) => { const t = one(s); if (t) words.push(t); },
      face: (o) => env.face(o),
    };
  }

  function byline(k, faces, ctx, o = {}) {
    const more = int(k.opts.more);
    const at = o.noWhen || !k.n ? "" : whenOf(k.n.created_at, k.env);
    const tail = more ? `<span class="nc-more"><span class="n">+${more}</span>waiting</span>` : at ? `<span class="when">${k.e(at)}</span>` : "";
    return `<div class="nc-by">${faces.length ? `<span class="nc-pair">${faces.join("")}</span>` : ""}<span class="ctx">${ctx}</span>${tail}</div>`;
  }
  /** The byline's time: "15:22" today, else "Thu 13:49". */
  function whenOf(iso, env) { const d = dateOf(iso); if (!d) return ""; return sameDay(d, new Date(env.now)) ? hhmm(d) : `${wd(d)} ${hhmm(d)}`; }
  const hl = (k, text, wrap) => `<h3 class="nc-hl${wrap ? " wrap" : ""}" id="nc-hl">${k.say(text)}</h3>`;
  const lede = (k, text, two) => (one(text) ? `<p class="nc-lede${two ? " two" : ""}">${k.say(clip(one(text), QUOTE_MAX))}</p>` : "");
  const note = (k, text, id) => (one(text) ? `<p class="nc-note"${id ? ` id="${id}"` : ""}>${k.say(text)}</p>` : "");
  /** Someone's own words beside a 2px bar in their assistant's coat colour; `at` highlights the viewer's own @mention. */
  function quote(k, text, who, o = {}) {
    const t = clip(one(text), QUOTE_MAX);
    if (!t) return "";
    k.words.push(t);
    let html = k.e(t);
    const mine = o.at ? firstOf(k.env.displayName) : "";
    if (mine) {
      const name = k.e(mine).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      html = html.replace(new RegExp(`@${name}(?![\\p{L}\\p{N}])`, "giu"), (m) => `<span class="at">${m}</span>`);
    }
    return `<p class="nc-quote" style="--q:${midOf(who)}">${html}</p>`;
  }
  /** A fact chip: an icon, the number in Geist Mono, its word; `label` is the whole sentence screen readers hear. */
  function chip(k, o) {
    const parts = `${o.before ?? ""} ${o.n ?? ""} ${o.after ?? ""}`;
    k.count(parts);
    const inner = `${icon(o.icon)}${o.before ? `<span class="w">${k.e(o.before)}</span>` : ""}${o.n !== undefined && o.n !== null && o.n !== "" ? `<span class="n">${k.e(o.n)}</span>` : ""}${o.after ? `<span class="w">${k.e(o.after)}</span>` : ""}`;
    const tone = o.tone ? ` ${o.tone}` : "";
    const label = k.e(o.label || one(parts));
    if (o.names) {
      return `<button type="button" class="nc-fact${tone}" aria-expanded="false" aria-controls="nc-names-${o.names}" data-act="nc-names" data-names="${o.names}" aria-label="${label}. Show who">${inner}</button>`;
    }
    return `<span class="nc-fact${tone}" role="img" aria-label="${label}">${inner}</span>`;
  }
  const chips = (k, list) => { const l = list.filter(Boolean); return l.length ? `<div class="nc-facts">${l.map((o) => chip(k, o)).join("")}</div>` : ""; };
  /** Names on demand under the chips: the row a names chip opens (hidden until then, so its words don't count). */
  function namesRow(k, key, label, people, total, mood) {
    const list = people.slice(0, NAMES_MAX);
    if (!list.length) return "";
    const more = Math.max(0, (int(total) ?? list.length) - list.length);
    const nm = list.map((p) => `<span class="nm"${p.title ? ` title="${k.e(p.title)}"` : ""}>${p.who ? k.face({ who: p.who, small: true, cls: "still", ...(mood ? { mood } : {}) }) : ""}<span class="t">${k.e(p.name)}</span></span>`).join("");
    return `<div class="nc-names" id="nc-names-${key}" data-for="${key}" hidden><span class="lbl">${k.e(label)}</span>${nm}${more ? `<span class="nm more">and ${more} more</span>` : ""}</div>`;
  }
  /** A move: the thing, then the old value struck through, an arrow and the new one (the mockup's date that would move). */
  function moveRow(k, R) {
    if (!R || typeof R !== "object") return "";
    const kind = str(R.kind);
    const title = clip(one(kind === "add_todo" ? R.title : kind === "set_reminder" ? R.text : R.taskTitle), 120);
    if (!title) return "";
    k.count(title);
    let tail = "";
    if (kind === "task_status") {
      const from = own(STATUS, R.fromStatus) ? STATUS[R.fromStatus] : "", to = own(STATUS, R.toStatus) ? STATUS[R.toStatus] : "";
      if (to) { tail = `${from ? `<span class="from">${from}</span>` : ""}${icon("arrow")}<span class="to">${to}</span>`; k.count(`${from} ${to}`); }
    }
    if (kind === "add_todo") { const d = dateOf(R.dueAt); if (d) { tail = `${icon("arrow")}<span class="to">${dayOf(d)}</span>`; k.count(dayOf(d)); } }
    if (kind === "set_reminder") { const d = dateOf(R.at); if (d) { tail = `${icon("arrow")}<span class="to">${wd(d)} ${hhmm(d)}</span>`; k.count(`${wd(d)} ${hhmm(d)}`); } }
    return `<div class="nc-move"><span class="task">${icon(kind === "set_reminder" ? "clock" : "task")}<span class="t">${k.e(title)}</span></span>${tail}</div>`;
  }
  /** The plain list of lines (a request's "what would change", a routine's lines) when there are no facts. */
  function lines(k, list, max) {
    const l = arr(list).map((x) => clip(one(typeof x === "string" ? x : x?.text), 200)).filter(Boolean).slice(0, max);
    if (!l.length) return "";
    l.forEach((t) => k.count(t));
    return `<ul class="nc-lines">${l.map((t) => `<li title="${k.e(t)}">${k.e(t)}</li>`).join("")}</ul>`;
  }
  /** The figure box (C's `.key`): one figure in Geist Mono and a caption under it. */
  function key(k, fig, caption, bad) {
    k.count(`${fig} ${caption}`);
    return `<div class="nc-key${bad ? " bad" : ""}"><span class="fig">${k.e(fig)}</span><span class="kc">${k.e(caption)}</span></div>`;
  }

  /** A button. `html` is markup the card wrote (escaped words and its own icons); values in attributes are escaped here. */
  function btn(k, o) {
    const attrs = Object.entries(o.attrs || {}).filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "").map(([a, v]) => ` ${a}="${k.e(v)}"`).join("");
    const off = (k.env.busy && !o.free) || o.disabled ? " disabled" : "";
    return `<button type="button" class="btn${o.cls ? ` ${o.cls}` : ""}" data-act="${o.act}"${attrs}${o.main ? " data-main" : ""}${off}>${o.html}</button>`;
  }
  /**
   * OK (or Done): the notification read (`read`), or for an update `ai-ack` (main.js's Done, which also marks a reply
   * seen); without a notification (a card opened from the day card) the card just closes.
   */
  function okBtn(k, o = {}) {
    const act = o.act === "ai-ack" ? "ai-ack" : k.n ? "read" : "close";
    return btn(k, { cls: o.cls ?? "primary", act, attrs: act === "read" ? { "data-id": k.n.id } : {}, main: o.main !== false, html: `${o.icon ? icon(o.icon) : ""}${k.e(o.label ?? "OK")}` });
  }
  /** Open (a Boredroom page only); `read` marks the notification read once it is opened (C.8's data-read-id). */
  const openBtn = (k, path, o = {}) => (path ? btn(k, { cls: o.cls, act: "open-href", attrs: { "data-href": path, "data-read-id": o.read && k.n ? k.n.id : null }, main: o.main, html: o.lead ? `${icon(o.lead)}${k.e(o.label ?? "Open")}` : o.bare ? k.e(o.label ?? "Open") : `${k.e(o.label ?? "Open")}${icon("open")}` }) : "");
  /** Open and Reply, both to the conversation (or the task), each marking it read; without a page, OK. */
  const openReply = (k, path) => (path ? `${openBtn(k, path, { read: true })}${openBtn(k, path, { read: true, cls: "primary", main: true, lead: "reply", label: "Reply" })}` : okBtn(k));

  // ---- templates ------------------------------------------------------------------------------------------------------
  // Each returns { by, body, actions } or null when what it needs is missing (the plain card then). The order inside is
  // always the mockup's: byline, headline, then facts, a quote, a figure or rows, then the actions.

  /** 1. A message: a direct message, a comment, a message passed on by an assistant, a reply to one. */
  function tMessage(k, c) {
    const { env, n } = k;
    if (c.kind === "item") {
      const w = c.w; if (!w || typeof w !== "object" || w.kind !== "message") return null;
      const s = personOf(env, w.sender); if (!s) return null;
      const can = w.canReply !== false;
      const how = w.tidied ? `${nameOf(s.who)} reworded it at ${possessive(s.first)} request.` : `${s.first ? `${s.first}'s` : "Their"} words, as sent.`;
      return {
        by: byline(k, [k.face({ who: s.who })], `<b>${k.e(nameOf(s.who))}</b>, for ${k.e(s.first || "them")}`),
        body: `${hl(k, fit(s.first && `New message from ${s.first}`, "New message"))}${quote(k, w.body, s.who)}${note(k, how)}`,
        actions: `${btn(k, { cls: can ? "ghost" : "primary", act: "ai-seen", main: !can, html: "Seen" })}${can ? btn(k, { cls: "primary", act: "ai-reply", main: true, html: `${icon("reply")}Reply` }) : ""}`,
      };
    }
    if (c.kind === "item_update") {
      const u = c.u; if (!u || typeof u !== "object" || u.kind !== "reply") return null;
      const o = personOf(env, u.other); if (!o) return null;
      return {
        by: byline(k, [k.face({ who: o.who })], `<b>${k.e(nameOf(o.who))}</b>, for ${k.e(o.first || "them")}`),
        body: `${hl(k, fit(o.first && `${o.first} replied`, "New reply"))}${quote(k, unquote(u.body), o.who)}`,
        actions: `${openBtn(k, pathOf(env, u.href, n?.href))}${okBtn(k, { act: "ai-ack", label: "Done" })}`,
      };
    }
    const comment = n?.type === "task.comment";
    const F = facts(n, comment ? "comment" : "message");
    if (!F) return null;
    const from = personOf(env, F.from);
    const first = from?.first || "Someone";
    const where = one(F.where);
    const ctx = comment
      ? `<b>${k.e(first)}</b>${one(F.task) ? ` on ${k.e(one(F.task))}` : ""}`
      : `<b>${k.e(first)}</b>, ${F.direct === true ? "direct message" : where ? `in ${k.e(where)}` : "a message"}`;
    const head = comment ? fit(from && `${from.first} commented`, "New comment") : fit(from && `New message from ${from.first}`, "New message");
    return {
      by: byline(k, [k.face({ who: from?.who ?? env.assistantOf(null) })], ctx),
      body: `${hl(k, head)}${quote(k, F.preview, from?.who)}`,
      actions: openReply(k, pathOf(env, n.href)),
    };
  }
  /** The server's quoted words without their own quote marks (the bar is the quote now). */
  const unquote = (s) => { const t = one(s); return /^“[\s\S]*”$/.test(t) ? t.slice(1, -1).trim() : t; };

  /** 2. A mention: who, where, and their words with the person's own @name lit. */
  function tMention(k) {
    const { env, n } = k;
    if (!n) return null;
    const F = facts(n, "mention");
    const from = personOf(env, F?.from);
    const where = one(F?.where);
    const text = F ? (one(F.preview) || "") : str(n.body);
    if (!from) {
      return {
        by: byline(k, [k.face({})], `<b>${k.e(nameOf(env.me))}</b>, a mention`),
        body: `${hl(k, one(n.title) || "You were mentioned", !!one(n.title))}${quote(k, text, env.me, { at: true })}`,
        actions: openReply(k, pathOf(env, n.href)),
      };
    }
    return {
      by: byline(k, [k.face({ who: from.who })], `<b>${k.e(from.first)}</b>${where ? `, in ${k.e(where)}` : ""}`),
      body: `${hl(k, fit(`${from.first} mentioned you`, "You were mentioned"))}${quote(k, text, from.who, { at: true })}`,
      actions: openReply(k, pathOf(env, n.href)),
    };
  }

  /** 3. Her (or someone's) assistant answered in Messages: the title and what it said, plain, two lines. */
  function tReply(k) {
    const { env, n } = k;
    if (!n) return null;
    const raw = str(n.body).trim();
    const priv = n.type === "brenda.mention_private";
    const answered = !priv || PRIVATE_LEAD.test(raw);
    const text = priv && PRIVATE_LEAD.test(raw) ? raw.replace(PRIVATE_LEAD, "") : raw;
    const me = `<b>${k.e(nameOf(env.me))}</b>`;
    const ctx = n.type === "brenda.mention_reply" ? `${me} replied` : priv ? `${me} ${answered ? "answered you" : "couldn't answer"}` : n.type === "assistant.tagged" ? `${me} was asked` : `<b>A reply</b> to your tag`;
    return {
      by: byline(k, [k.face(answered ? { mood: "happy" } : {})], ctx),
      body: `${hl(k, one(n.title) || "A reply for you", true)}${lede(k, text, true)}${priv && answered ? note(k, "Only you can see this.") : ""}`,
      actions: `${openBtn(k, pathOf(env, n.href), { read: true })}${okBtn(k)}`,
    };
  }

  /** The two faces of a follow-up answer, by its result (B's variants). */
  const ANSWER_MOODS = { on_track: ["happy", "happy"], done: ["happy", "happy"], in_progress: ["", "happy"], in_review: ["", "happy"], blocked: ["", "sad"], not_started: ["think", "gulp"], no_reply: ["think", "blink away"] };
  const RESULT_TONE = { on_track: "r-ok", done: "r-ok", blocked: "r-blocked", not_started: "r-notstarted" };
  /** 4. A follow-up's answer: you asked, the result big in its status colour, the numbers as chips. A group's: counts. */
  function tAnswer(k, c) {
    const { env, n } = k;
    if (n?.type === "brenda.followup_batch") {
      const F = facts(n, "batch");
      const ct = F && F.counts && typeof F.counts === "object" ? F.counts : null;
      const list = ct ? [
        int(ct.answered) ? { icon: "check", n: String(ct.answered), after: "answered" } : null,
        int(ct.replied) ? { icon: "reply", n: String(ct.replied), after: "replied" } : null,
        int(ct.noReply) ? { icon: "clock", n: String(ct.noReply), after: "no reply" } : null,
        int(ct.declined) ? { icon: "x", n: String(ct.declined), after: "not now" } : null,
        int(ct.failed) ? { icon: "alert", n: String(ct.failed), after: "couldn't ask" } : null,
      ] : [];
      return {
        by: byline(k, [k.face({ mood: "happy" })], `<b>${k.e(nameOf(env.me))}</b>, group follow-up`),
        body: `${hl(k, one(n.title) || "Your group's answers", true)}${ct ? chips(k, list) : lede(k, n.body, true)}`,
        actions: `${openBtn(k, pathOf(env, n.href), { read: true, label: "Open answer" })}${okBtn(k, { label: "Done" })}`,
      };
    }
    const F = facts(n, "answer");
    const a = c.kind === "followup_answer" && c.a && typeof c.a === "object" ? c.a : null;
    if (!F && !a && !n) return null;
    const subject = personOf(env, F?.subject ?? a?.subject);
    const status = str(F?.status) || str(a?.status);
    const R = F && F.result && typeof F.result === "object" && one(F.result.label) ? F.result : null;
    const rk = R ? str(R.key) : "";
    const [mine, theirs] = rk && own(ANSWER_MOODS, rk) ? ANSWER_MOODS[rk] : status === "expired" ? ["think", "blink away"] : status === "answered" ? ["happy", "happy"] : ["", ""];
    const faces = [k.face(mine ? { mood: mine } : {})];
    if (subject) faces.push(k.face({ who: subject.who, ...(theirs ? { mood: theirs } : {}) }));
    const ctx = subject
      ? status === "expired" ? `No reply from <b>${k.e(subject.first || subject.name)}</b>` : `<b>${k.e(nameOf(subject.who))}</b> answered for ${k.e(subject.first || "them")}`
      : `<b>${k.e(nameOf(env.me))}</b>, a follow-up`;
    const href = pathOf(env, F?.href, a?.href, n?.href);
    const claude = (F?.engine ?? a?.engine) === "claude";
    const by = subject ? `Written by AI from ${subject.first ? `${subject.first}'s` : "their"} work.` : "Written by AI from their work.";
    let body;
    if (R) {
      const q = one(F.question);
      const t = F.time && typeof F.time === "object" ? F.time : null;
      const today = t ? num(t.todaySeconds) : null, week = t ? num(t.weekSeconds) : null;
      const open = int(F.openTasks);
      body = `${q ? `<p class="nc-q">You asked: ${k.say(q)}</p>` : ""}<p class="nc-result ${own(RESULT_TONE, rk) ? RESULT_TONE[rk] : "r-none"}" id="nc-hl">${k.say(R.label)}</p>${chips(k, [
        today !== null ? { icon: "clock", n: hm(today / 60), after: "today", tone: today < 60 ? "zero" : "", label: `${hm(today / 60)} logged today` } : null,
        week !== null ? { icon: "clock", n: hm(week / 60), after: "this week", tone: week < 60 ? "zero" : "", label: `${hm(week / 60)} logged this week` } : null,
        open !== null ? { icon: "list", n: String(open), after: plural(open, "open task", "open tasks"), tone: open ? "" : "zero" } : null,
      ])}${claude ? note(k, by) : ""}`;
    } else {
      // Without a result the answer's words stay as written, two lines, and a reply that never came says so as a chip.
      const badge = status && status !== "answered" && own(FU_BADGE, status) ? FU_BADGE[status] : null;
      body = `${hl(k, one(a?.title) || one(n?.title) || "Your follow-up", true)}${lede(k, a ? a.answer : n?.body, true)}${badge ? chips(k, [{ icon: status === "failed" ? "alert" : "clock", after: badge.label, tone: badge.tone === "bad" ? "bad" : "" }]) : ""}${claude && (a?.answer || n?.body) ? note(k, by) : ""}`;
    }
    return { by: byline(k, faces, ctx), body, actions: `${openBtn(k, href, { read: true, label: "Open answer" })}${okBtn(k, { label: "Done" })}` };
  }

  /** The team report's headline: how many hours on which day ("No hours logged on Thursday"), with its short forms. */
  function reportHead(F, title) {
    const day = F ? localDay(F.localDate) : null;
    const long = day ? WEEKDAYS[day.getDay()] : WEEKDAYS.find((d) => new RegExp(`\\b${d}\\b`).test(str(title))) ?? null;
    const short = long ? long.slice(0, 3) : null;
    const ts = F ? num(F.trackedSeconds) : null;
    const logged = ts === null ? "" : ts === 0 ? "0h" : hm(ts / 60);
    if (ts === null) return fit(long && `Team report for ${long}`, short && `Team report for ${short}`, "Your team report");
    if (ts === 0) return fit(long && `No hours logged on ${long}`, short && `No hours logged on ${short}`, "No hours logged");
    return fit(long && `${logged} logged on ${long}`, short && `${logged} logged on ${short}`, `${logged} logged`, "Hours logged");
  }
  /** 5. The team report: the workspace's face, how many hours, and the day's numbers as chips with names on demand. */
  function tReport(k) {
    const { env, n } = k;
    if (!n) return null;
    const F = facts(n, "report");
    const wsName = one(env.workspaceName) || nameOf(env.ws);
    const ts = F ? num(F.trackedSeconds) : null;
    const done = F ? int(F.finished) : null, overdue = F ? int(F.overdue) : null, blocked = F ? int(F.blocked) : null;
    const fromFacts = F && F.source === "facts";
    const people = (x) => arr(x?.people).map((p) => { const q = personOf(env, p); return q ? { ...q, title: num(p.minutes) !== null ? `${q.name}, ${hm(p.minutes)} late` : "" } : null; }).filter(Boolean);
    const missing = fromFacts && F.missing && typeof F.missing === "object" ? { count: int(F.missing.count) ?? 0, people: people(F.missing) } : null;
    const late = fromFacts && F.late && typeof F.late === "object" ? { count: int(F.late.count) ?? 0, people: people(F.late) } : null;
    const sad = ts === 0 && done === 0;
    const happy = !sad && overdue === 0 && blocked === 0 && (missing?.count ?? 0) === 0 && (late?.count ?? 0) === 0;
    const by = byline(k, [k.face({ who: env.ws, ...(sad ? { mood: "sad" } : happy ? { mood: "happy" } : {}) })], `<b>${k.e(wsName)}</b>, team report`);
    const actions = `${openBtn(k, pathOf(env, n.href), { read: true, label: "Open report" })}${okBtn(k)}`;
    if (!F) return { by, body: `${hl(k, reportHead(null, n.title))}${lede(k, n.body, true)}`, actions };
    const logged = ts === null ? "" : ts === 0 ? "0h" : hm(ts / 60);
    const head = reportHead(F, n.title);
    const list = [
      fromFacts && ts !== null ? { icon: "clock", n: logged, after: "logged", tone: ts === 0 ? "zero" : "", label: ts === 0 ? "No hours logged" : `${logged} logged` } : null,
      done !== null ? { icon: "task", n: String(done), after: "finished", tone: done ? "" : "zero", label: `${done} ${plural(done, "task", "tasks")} finished` } : null,
      overdue !== null ? { icon: "alert", n: String(overdue), after: "overdue", tone: overdue ? "attn" : "zero", label: `${overdue} ${plural(overdue, "task", "tasks")} overdue` } : null,
      blocked ? { icon: "ban", n: String(blocked), after: "blocked", tone: "attn", label: `${blocked} ${plural(blocked, "task", "tasks")} blocked` } : null,
      missing && missing.count ? { icon: "userx", n: String(missing.count), after: "didn't clock in", tone: "attn", label: `${missing.count} ${plural(missing.count, "person", "people")} didn't clock in`, names: missing.people.length ? "missing" : null } : null,
      late && late.count ? { icon: "late", n: String(late.count), after: "late", tone: "attn", label: `${late.count} ${plural(late.count, "person was", "people were")} late`, names: late.people.length ? "late" : null } : null,
    ];
    const names = `${missing && missing.count ? namesRow(k, "missing", "Didn't clock in", missing.people, missing.count) : ""}${late && late.count ? namesRow(k, "late", "Late", late.people, late.count, "sad") : ""}`;
    return { by, body: `${hl(k, head)}${chips(k, list)}${names}`, actions };
  }

  /** 6. Good news, Together: the other assistant and yours cheek to cheek at 44px, both happy, two stars in their colours. */
  function tTogether(k, c) {
    const { env, n } = k;
    const type = str(n?.type);
    let other = null, head = "", body = "", list = [], move = "", open = null;
    const ack = c.kind === "item_update";
    if (type === "review.approved") {
      const F = facts(n, "review"); if (!F) return null;
      other = personOf(env, F.by); if (!other) return null;
      const task = one(F.task?.title);
      head = fit(task && `${other.first} approved ${task}`, `${other.first} approved your work`, "Your work was approved");
      body = one(F.note) ? quote(k, F.note, other.who) : lede(k, "Accepted as it is.");
      const d = typeof F.daysEarly === "number" && Number.isInteger(F.daysEarly) ? F.daysEarly : null;
      const rev = int(F.revision);
      list = [
        d === null ? null : d > 0 ? { icon: "calendar", n: `${d} ${plural(d, "day", "days")}`, after: "early", tone: "ok" } : d < 0 ? { icon: "calendar", n: `${-d} ${plural(-d, "day", "days")}`, after: "late", tone: "bad" } : { icon: "calendar", after: "On its due day", tone: "ok" },
        rev !== null && rev > 1 ? { icon: "pencil", before: "Revision", n: String(rev) } : null,
      ];
      open = pathOf(env, n.href);
    } else if (type === "assistant.outcome" || c.kind === "item_update") {
      const F = facts(n, "request");
      const u = c.kind === "item_update" && c.u && typeof c.u === "object" ? c.u : null;
      other = personOf(env, F?.from ?? u?.other); if (!other) return null;
      head = fit(`${other.first} accepted your request`, `${other.first} said yes`, "Your request was accepted");
      body = lede(k, one(F?.result) || one(u?.body));
      move = moveRow(k, F?.request && (F.request.kind === "task_status" || (F.request.kind === "add_todo" && F.request.dueAt)) ? F.request : null);
    } else if (type === "brenda.commitment_accepted") {
      const F = facts(n, "commitment"); if (!F) return null;
      other = personOf(env, F.committer); if (!other) return null;
      head = fit(`${other.first} took it on`, "Your ask was taken on");
      body = lede(k, F.title);
    } else return null;
    const stage = `<div class="nc-tg-stage"><span class="nc-tg-pair"><span class="nc-tg-who">${k.face({ who: other.who, mood: "happy pleased", cls: "xl", look: [0.9, 0] })}</span><span class="nc-tg-who">${k.face({ mood: "happy pleased", cls: "xl", look: [-0.9, 0] })}</span><span class="nc-tg-stars">${star(midOf(other.who))}${star(midOf(env.me))}</span></span>${byline(k, [], `<b>${k.e(other.first ? `${other.first}'s ${nameOf(other.who)}` : nameOf(other.who))}</b> and yours`)}</div>`;
    return {
      by: stage,
      body: `${hl(k, head)}${body}${chips(k, list)}${move}`,
      actions: `${openBtn(k, open, { read: true, label: "Open task" })}${okBtn(k, ack ? { act: "ai-ack" } : {})}`,
    };
  }

  /** 7. A request from someone's assistant: what would change, drawn as the change, their note, Decline and Accept. */
  function tRequest(k, c) {
    const { env, n } = k;
    if (c.kind !== "item" || !c.w || typeof c.w !== "object" || c.w.kind !== "request") return null;
    const w = c.w, s = personOf(env, w.sender);
    if (!s) return null;
    const F = facts(n, "request");
    const R = F && F.request && typeof F.request === "object" ? F.request : null;
    const f = s.first;
    const kind = str(R?.kind);
    const head = kind === "add_todo" ? fit(f && `${f} asks you to add a to-do`, f && `${f} asks for a to-do`, "A to-do for you")
      : kind === "task_status" ? fit(f && `${f} asks to move a task`, "A task move for you")
      : kind === "task_comment" ? fit(f && `${f} asks for a comment`, "A comment for you")
      : kind === "set_reminder" ? fit(f && `${f} asks to set a reminder`, "A reminder for you")
      : fit(f && `${f} asks you to accept`, f && `${f} has a request`, "A request for you");
    // The comment a task_comment would post is the viewer's own words once accepted: labelled, beside their own colour, so
    // it never reads as the sender's note under it (review, 9 October 2026).
    const comment = kind === "task_comment" && one(R?.text) ? `${note(k, "Posted as your comment:")}${quote(k, R.text, env.me)}` : "";
    const change = R ? `${moveRow(k, R)}${comment}` : lines(k, w.lines, LINES_MAX);
    const exp = dateOf(w.expiresAt ?? F?.expiresAt);
    const why = `Nothing changes until you accept.${exp ? ` Expires ${dayOf(exp)}, ${hhmm(exp)}.` : ""}`;
    return {
      by: byline(k, [k.face({ who: s.who, mood: "alert" })], `<b>${k.e(nameOf(s.who))}</b>, for ${k.e(f || "them")}`),
      body: `${hl(k, head)}${change}${quote(k, one(w.note) || one(F?.note), s.who)}${note(k, why)}`,
      actions: `${btn(k, { act: "ai-decline", html: "Decline" })}${btn(k, { cls: "primary accent", act: "ai-accept", main: true, html: `${icon("check")}Accept` })}`,
    };
  }

  /** 8. A follow-up's ask: whose assistant asks, about what, their question; main.js brings the quick replies and note. */
  function tAsk(k, c) {
    const { env } = k;
    if (c.kind !== "followup_ask" || !c.w || typeof c.w !== "object") return null;
    const w = c.w;
    const thread = w.thread && typeof w.thread === "object" && one(w.thread.where) ? w.thread : null;
    const asker = personOf(env, w.asker);
    const who = thread ? env.me : asker ? asker.who : env.ws;
    const task = one(w.taskTitle);
    const ctx = asker ? `<b>${k.e(nameOf(who))}</b>, for ${k.e(asker.first)}` : `<b>${k.e(nameOf(env.ws))}</b>, for the team report`;
    const head = asker ? fit(task && `${asker.first} asks about ${task}`, `${asker.first} wants an update`, "Asked for an update") : fit("Update for the team report", "An update, please");
    const question = one(w.question) || (task ? "" : "What did you work on today?");
    const choice = typeof c.choice === "string" && c.choice;
    return {
      by: byline(k, [k.face({ ...(thread ? {} : { who }), mood: "alert" })], ctx),
      body: `${hl(k, head)}${quote(k, question, who)}`,
      actions: `${btn(k, { cls: "ghost", act: "fu-send", attrs: { "data-choice": "not_now" }, html: "Not now" })}${btn(k, { cls: "primary accent", act: "fu-send", main: true, disabled: !choice, html: "Send" })}`,
    };
  }

  /**
   * Whether a headline already says the quoted words (review, 9 October 2026: "Deck to Ada by Friday" over "send the deck
   * to Ada by Friday"): one holds the other, or most of the headline's words are in the quote.
   */
  function echoes(title, words) {
    const a = one(title).toLowerCase(), b = one(words).toLowerCase();
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const toks = (t) => t.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3);
    const tw = toks(a), bw = new Set(toks(b));
    if (!tw.length) return false;
    return tw.filter((w) => bw.has(w)).length / tw.length >= 0.6;
  }

  /** 9. A noted commitment or an open ask: the thing itself, when it is due, the words, and the yes to give. */
  function tCommitment(k, c) {
    const { env } = k;
    if (c.kind !== "loop" || c.lk === "block" || !c.w || typeof c.w !== "object" || !one(c.w.title)) return null;
    const w = c.w, ask = w.kind === "open_ask", from = personOf(env, w.from);
    const title = one(w.title);
    const what = clip(one(w.what), 240);
    const due = one(w.dueLabel);
    const label = clip(one(w.acceptLabel), 40) || (ask ? LOOP_INBOX.takeItOn : LOOP_INBOX.accept);
    const question = ask
      ? `${LOOP_INBOX.openAskQuestion}${from?.first ? ` ${LOOP_INBOX.askerToldOnDecline(from.first)}` : ""}`
      : `${label === LOOP_INBOX.acceptNoTodos ? LOOP_INBOX.commitmentQuestionNoTodos : LOOP_INBOX.commitmentQuestion} ${LOOP_INBOX.nothingChanges}`;
    const path = pathOf(env, w.href);
    // An open ask is brought by the asker's own assistant (review, 9 October 2026: it showed the workspace's), a noted
    // commitment by the workspace's. The words are left out when the headline already says them.
    return {
      by: byline(k, [k.face({ who: ask && from ? from.who : env.ws, mood: "alert" })], ask ? `<b>${k.e(from?.first || "Someone")}</b> asked you` : `<b>${k.e(nameOf(env.ws))}</b> noted a commitment`),
      body: `${hl(k, title, true)}${due ? lede(k, `Due ${due}`) : ""}${what && !echoes(title, what) ? quote(k, what, ask ? from?.who : env.me) : ""}${note(k, question)}`,
      actions: `${openBtn(k, path)}${ask ? btn(k, { cls: "ghost", act: "lp-decline", html: LOOP_INBOX.decline }) : btn(k, { cls: "ghost", act: "lp-dismiss", html: LOOP_INBOX.dismiss })}${btn(k, { cls: "primary accent", act: "lp-accept", main: true, html: k.e(label) })}`,
    };
  }

  /** 10. Someone is blocked on you: who, on which task, their question; answered in Boredroom, or Not me. */
  function tBlocked(k, c) {
    const { env } = k;
    if (c.kind !== "loop" || c.lk !== "block" || !c.w || typeof c.w !== "object") return null;
    const w = c.w, from = personOf(env, w.from);
    const title = one(w.taskTitle) || one(w.title);
    if (!title) return null;
    const first = from?.first;
    const path = pathOf(env, w.href);
    return {
      by: byline(k, [k.face({ ...(from ? { who: from.who } : {}), mood: "alert" })], `<b>${k.e(first || "Someone")}</b> is blocked on you`),
      body: `${hl(k, title, true)}${quote(k, w.question, from?.who ?? env.me)}${note(k, `You answer it in Boredroom, where ${first ? `${first} sees` : "they see"} it as your comment on the task.`)}`,
      actions: `${btn(k, { cls: "ghost", act: "lp-notme", html: LOOP_INBOX.notMe })}${path ? openBtn(k, path, { cls: "primary", main: true }) : btn(k, { cls: "primary", act: "close", main: true, html: "Later" })}`,
    };
  }

  /** A standup section's lines as Post would send them (main.js's sectionLines). */
  function sectionLines(e, s) {
    const texts = e.texts && typeof e.texts === "object" ? e.texts : null;
    const raw = texts ? str(texts[s]).split("\n") : arr(e.draft?.sections?.[s]).map((l) => str(l?.text));
    return raw.map((l) => l.replace(/^\s*[-*•]\s+/, "").trim()).filter(Boolean);
  }
  /** 11. The standup draft: three labelled lines, who it goes to, then Skip today, Edit and Post. */
  function tStandup(k, c) {
    const { env } = k;
    if (c.kind !== "standup" || !c.w || typeof c.w !== "object" || !c.w.team || !one(c.w.team.name)) return null;
    const e = c.w, team = one(e.team.name);
    const to = one(e.postTo?.name) || `#${team}`;
    const rows = ["yesterday", "today", "blocked"].map((s) => {
      const l = sectionLines(e, s);
      if (!l.length && s !== "blocked") return "";
      const label = s === "yesterday" ? one(e.sinceLabel) || STANDUP_SAY.labels.yesterday : STANDUP_SAY.labels[s];
      k.count(label);
      if (!l.length) { k.count(STANDUP_SAY.nothing); return `<dt>${k.e(label)}</dt><dd class="none">${STANDUP_SAY.nothing}</dd>`; }
      const more = l.length - 1;
      k.count(l[0]);
      return `<dt>${k.e(label)}</dt><dd title="${k.e(l.join("\n"))}">${k.e(clip(l[0], 200))}${more ? `<span class="more">, and ${more} more</span>` : ""}</dd>`;
    }).join("");
    const goes = STANDUP_SAY.goesTo(to, STANDUP_SAY.members(e.postTo?.members), nameOf(env.me));
    const edit = pathOf(env, e.href);
    return {
      by: byline(k, [k.face({ mood: "alert" })], `<b>${k.e(nameOf(env.me))}</b> drafted your standup`),
      body: `${hl(k, fit("Standup ready to post", "Standup ready"))}${rows ? `<dl class="nc-rows">${rows}</dl>` : ""}${note(k, goes, "nc-goes")}`,
      actions: `${btn(k, { cls: "ghost", act: "su-skip", html: STANDUP_SAY.skip })}${edit ? btn(k, { act: "open-href", attrs: { "data-href": edit, title: "Edit it in Boredroom" }, html: `${icon("pencil")}${STANDUP_SAY.edit}` }) : ""}${btn(k, { cls: "primary accent", act: "su-post", main: true, attrs: { "aria-label": `Post to ${to}`, "aria-describedby": "nc-goes" }, html: `${icon("send")}${k.e(`${STANDUP_SAY.post} to ${clip(to, 18)}`)}` })}`,
    };
  }

  const CONFIRM_CTX = { "brenda.mention_confirm": " needs you to confirm", "brenda.replan": ", a re-plan waits", "review.requested": ", review requested" };
  /** 12. Something waits for a decision elsewhere: the title, a line, Open. Never a Confirm here (its token stays on the server). */
  function tConfirm(k) {
    const { env, n } = k;
    if (!n) return null;
    const path = pathOf(env, n.href);
    return {
      by: byline(k, [k.face({ mood: "alert" })], `<b>${k.e(nameOf(env.me))}</b>${own(CONFIRM_CTX, n.type) ? CONFIRM_CTX[n.type] : ", a decision waits"}`),
      body: `${hl(k, one(n.title) || "Something waits for you", true)}${lede(k, n.body, true)}`,
      actions: path ? `${okBtn(k, { cls: "ghost", main: false })}${openBtn(k, path, { read: true, cls: "primary", main: true })}` : okBtn(k),
    };
  }

  /** 13. A reminder: the time is the biggest thing on the card, then what to do. */
  function tReminder(k) {
    const { env, n } = k;
    if (!n) return null;
    const F = facts(n, "reminder");
    const at = dateOf(F?.at) ?? dateOf(n.created_at);
    const text = one(F?.text) || one(str(n.title).replace(/^Reminder:\s*/i, "")) || "Reminder";
    const set = dateOf(F?.setAt);
    const now = new Date(env.now);
    const ago = set ? daysBetween(set, now) : null;
    const setWords = !set ? "" : ago === 0 ? `set today at ${hhmm(set)}` : ago === 1 ? "set yesterday" : ago > 1 && ago < 7 ? `set ${wd(set)}` : `set ${dayOf(set)}`;
    const time = at ? hhmm(at) : "";
    const task = one(F?.taskTitle);
    return {
      by: byline(k, [k.face({ mood: "alert" })], `<b>Reminder</b>${setWords ? `, ${setWords}` : ""}`, { noWhen: true }),
      body: `<div class="nc-remind">${time ? `<span class="time">${k.say(time)}</span><span class="rule-v"></span>` : ""}<div class="nc-remind-t">${hl(k, text, true)}${task ? lede(k, `On ${task}`) : ""}</div></div>`,
      actions: `${F && one(F.text) ? btn(k, { act: "nc-snooze", attrs: { "data-id": n.id }, html: `${icon("snooze")}Snooze 10 min` }) : ""}${okBtn(k, { label: "Done", icon: "check" })}`,
    };
  }

  /** The figure box for a date: the weekday (or the time today), and how late when it has passed. */
  function dueKey(k, due, now) {
    if (!due) return "";
    const days = daysBetween(due, now);
    if (days === 0) return key(k, hhmm(due), "due today", due.getTime() < now.getTime());
    if (days > 0) return key(k, `${days}d`, "late", true);
    return key(k, wd(due), `due ${dm(due)}`);
  }
  /** 14. A new task: who gave it, the task as the headline, the due day in the figure box, estimate and priority. */
  function tAssignment(k) {
    const { env, n } = k;
    const F = facts(n, "assignment");
    if (!F || !F.task || typeof F.task !== "object" || !one(F.task.title)) return null;
    const t = F.task, by = personOf(env, F.by);
    const est = num(t.estimateMinutes);
    const prio = t.priority === "urgent" ? "Urgent" : t.priority === "high" ? "High priority" : "";
    const start = F.canStart === true && env.canStart && typeof t.id === "string" && t.id;
    const faces = by ? [k.face({ who: by.who, mood: "happy" }), k.face({ mood: "gulp" })] : [k.face({ mood: "gulp" })];
    return {
      by: byline(k, faces, by ? `<b>${k.e(by.first)}</b> gave you a task` : "<b>New task</b> for you"),
      body: `<div class="nc-head-k"><div class="nc-head-t">${hl(k, t.title, true)}${lede(k, t.project)}</div>${dueKey(k, dateOf(t.dueAt), new Date(env.now))}</div>${chips(k, [
        est !== null && est > 0 ? { icon: "timer", n: hm(est), after: "estimate", label: `${hm(est)} estimated` } : null,
        prio ? { icon: "flag", after: prio, tone: t.priority === "urgent" ? "attn" : "" } : null,
      ])}`,
      actions: `${openBtn(k, pathOf(env, n.href), { read: true })}${start ? btn(k, { cls: "primary accent", act: "start", main: true, attrs: { "data-id": t.id }, html: `${icon("play")}Start timer` }) : okBtn(k)}`,
    };
  }

  /** 15. A commitment due today, or overdue: the thing, when, how long is left or how late (the red figure box). */
  function tDue(k) {
    const { env, n } = k;
    const F = facts(n, "commitment");
    if (!F || !one(F.title)) return null;
    const now = new Date(env.now), due = dateOf(F.dueAt);
    const overdue = F.overdue === true;
    const asker = personOf(env, F.asker);
    const path = pathOf(env, F.href, n.href);
    const id = typeof n.resource_id === "string" && n.resource_id ? n.resource_id : null;
    const actions = `${openBtn(k, path, { label: "Re-plan", bare: true })}${F.canMarkDone === true && id ? btn(k, { cls: "primary", act: "nc-commit-done", main: true, attrs: { "data-id": id }, html: `${icon("check")}Mark done` }) : okBtn(k)}`;
    if (overdue) {
      const late = due ? daysBetween(due, now) : null;
      const mins = due ? (now.getTime() - due.getTime()) / 60_000 : 0;
      const fig = late === null ? "" : late > 0 ? `${late}d` : mins >= 60 ? `${Math.floor(mins / 60)}h` : `${Math.max(1, Math.round(mins))}m`;
      return {
        by: byline(k, [k.face({ mood: "sad" })], "<b>Commitment</b> overdue"),
        body: `<div class="nc-head-k"><div class="nc-head-t">${hl(k, F.title, true)}${asker ? lede(k, `You promised it to ${asker.first}.`) : ""}</div>${fig ? key(k, fig, "late", true) : ""}</div>${due ? chips(k, [{ icon: "calendar", before: "was due", n: dayOf(due) }]) : ""}`,
        actions,
      };
    }
    const today = due ? sameDay(due, now) : true;
    const left = due ? (due.getTime() - now.getTime()) / 60_000 : null;
    return {
      by: byline(k, [k.face({ mood: "alert" })], `<b>Commitment</b> due ${due && !today ? wd(due) : "today"}`),
      body: `${hl(k, F.title, true)}${due ? chips(k, [
        { icon: "clock", before: "due", n: today ? hhmm(due) : `${wd(due)} ${hhmm(due)}` },
        left !== null && left > 0 ? { icon: "hourglass", n: left >= 60 ? `${Math.round(left / 60)}h` : `${Math.max(1, Math.round(left))}m`, after: "left" } : null,
      ]) : ""}`,
      actions,
    };
  }

  const isRun = (r) => !!r && typeof r === "object" && typeof r.id === "string" && typeof r.title === "string";
  const sectionIcon = (id) => (/overdue/.test(id) ? "alert" : /owed_to_you|to_you|waiting/.test(id) ? "inbox" : /you_owe|owe/.test(id) ? "send" : "list");
  /** 16. A routine's delivery: the count as the headline, the split as chips (or its first lines), Open. */
  function tRoutine(k, c) {
    const { env, n } = k;
    if (!n) return null;
    const runs = c.kind === "routine" ? arr(c.runs).filter(isRun) : [];
    if (n.type === "brenda.routine_bundle") {
      const names = runs.length ? runs.map((r) => one(r.title)).filter(Boolean) : str(n.body).split(",").map(one).filter(Boolean);
      if (!names.length) return null;
      return {
        by: byline(k, [k.face({})], `<b>${k.e(nameOf(env.me))}</b>, ${names.length === 1 ? "a routine" : "your routines"}`),
        body: `${hl(k, fit(`${names.length} ${plural(names.length, "routine ran", "routines ran")}`, "Your routines ran"))}${lede(k, names.join(", "), true)}`,
        actions: `${openBtn(k, pathOf(env, n.href), { read: true })}${okBtn(k)}`,
      };
    }
    const F = facts(n, "routine");
    const run = runs[0] ?? stateOf(env, n);
    if (!F && !isRun(run)) return null;
    const actions = `${openBtn(k, pathOf(env, run?.href, n.href), { read: true })}${okBtn(k)}`;
    const name = one(F?.name) || one(run?.title);
    const lead = (one(F?.lead) || one(run?.lead)).replace(/\.+$/, "");
    const head = lead && chars(lead) <= HEADLINE_MAX ? lead : name || one(n.title) || "Your routine ran";
    const sections = F ? arr(F.sections).filter((s) => s && typeof s === "object" && one(s.label) && int(s.count) !== null).slice(0, 4) : [];
    const body = F
      ? chips(k, sections.map((s) => ({ icon: sectionIcon(str(s.id)), n: String(s.count), after: clip(one(s.label), 40), tone: s.count === 0 ? "zero" : /overdue/.test(str(s.id)) ? "attn" : "" })))
      : lines(k, arr(run?.lines).filter((l) => l && typeof l === "object" && one(l.text)).map((l) => l.text), 2);
    return { by: byline(k, [k.face({})], `<b>${k.e(nameOf(env.me))}</b>, ${k.e(name || "a routine")}`), body: `${hl(k, head, true)}${body}`, actions };
  }

  /** 17. A team's standup rollup, for its lead: how many posted, blockers, who has no update (names on demand, never amber). */
  function tRollup(k, c) {
    const { env, n } = k;
    const F = facts(n, "rollup");
    const r = c.kind === "standup_rollup" && c.w && typeof c.w === "object" ? c.w : null;
    const kc = r && r.content && typeof r.content === "object" ? r.content : null;
    const team = one(r?.team?.name) || one(F?.team);
    if (!team || (!kc && !F)) return null;
    const counts = kc && kc.counts && typeof kc.counts === "object" ? kc.counts : {};
    const posted = int(counts.posted) ?? int(F?.posted) ?? 0, members = int(counts.members) ?? int(F?.members) ?? 0;
    const blockers = kc ? arr(kc.blockers).filter((b) => b && one(b.name) && one(b.text)).length : int(F?.blockers) ?? 0;
    // The state's names carry no assistant (no face then); the facts' people do.
    const people = (list) => arr(list).map((p) => { const q = personOf(env, p); return q && p.assistant && typeof p.assistant === "object" ? q : q ? { ...q, who: null } : null; }).filter(Boolean);
    const quiet = people(kc ? kc.noUpdate : F?.noUpdate), late = people(kc ? kc.late : F?.late);
    return {
      by: byline(k, [k.face({})], `<b>${k.e(team)}</b> standup`),
      body: `${hl(k, fit(`${posted} of ${members} posted`, "Standup posted"))}${chips(k, [
        { icon: "alert", n: String(blockers), after: plural(blockers, "blocker", "blockers"), tone: blockers ? "attn" : "zero" },
        quiet.length ? { icon: "userx", n: String(quiet.length), after: "no update", names: "noupdate", label: `${quiet.length} ${plural(quiet.length, "person has", "people have")} no update` } : null,
        late.length ? { icon: "late", n: String(late.length), after: "late", names: "late", label: `${late.length} posted late` } : null,
      ])}${namesRow(k, "noupdate", "No update", quiet, quiet.length)}${namesRow(k, "late", "Posted late", late, late.length)}`,
      actions: `${openBtn(k, pathOf(env, r?.href, n?.href), { read: true })}${okBtn(k)}`,
    };
  }

  /** 18. Clocked in by her: when, and her words. */
  function tClockin(k) {
    const { env, n } = k;
    if (!n) return null;
    const at = dateOf(n.created_at);
    return {
      by: byline(k, [k.face({ mood: "happy" })], `<b>${k.e(nameOf(env.me))}</b> clocked you in`),
      body: `${hl(k, at ? `Clocked in at ${hhmm(at)}` : "Clocked in")}${lede(k, n.body, true)}`,
      actions: `${openBtn(k, pathOf(env, n.href), { read: true })}${okBtn(k)}`,
    };
  }

  /** The plain card's byline word, where the summary's word would not read after a name ("Brenda, good news"). */
  const PLAIN_WORDS = { approved: "good news", accepted: "good news", "took it on": "good news", answered: "good news", asks: "a request", "clocked in": "clock-in" };
  /** 19. The plain card: every kind without a card of its own, or without the facts it needs. It never fails. */
  function tPlain(k, c, info) {
    const { env, n } = k;
    const type = str(n?.type);
    const fromWs = FROM_WS.has(type) || (c.kind === "followup_ask" && !c.w?.asker);
    const mood = SAD.has(type) || (type === "assistant.outcome" && facts(n, "request")?.status === "failed") ? "sad" : info.family === "needs" ? "alert" : info.family === "good" ? "happy" : "";
    const word = own(PLAIN_WORDS, info.word) ? PLAIN_WORDS[info.word] : info.word || "update";
    const title = one(n?.title) || one(c.w?.title) || one(c.u?.title) || "Something new";
    const ack = c.kind === "item_update";
    return {
      by: byline(k, [k.face({ ...(fromWs ? { who: env.ws } : {}), ...(mood ? { mood } : {}) })], `<b>${k.e(nameOf(fromWs ? env.ws : env.me))}</b>, ${k.e(word)}`),
      body: `${hl(k, title, true)}${lede(k, n?.body ?? c.w?.body ?? c.u?.body, true)}`,
      actions: `${openBtn(k, pathOf(env, n?.href, c.w?.href, c.u?.href), { read: !info.waits })}${okBtn(k, { label: type === "brenda.reminder" ? "Done" : "OK", ...(ack ? { act: "ai-ack" } : {}) })}`,
    };
  }

  const TEMPLATES = {
    message: tMessage, mention: tMention, reply: tReply, answer: tAnswer, report: tReport, together: tTogether, request: tRequest,
    ask: tAsk, commitment: tCommitment, blocked: tBlocked, standup: tStandup, confirm: tConfirm, reminder: tReminder,
    assignment: tAssignment, due: tDue, routine: tRoutine, rollup: tRollup, clockin: tClockin, plain: tPlain,
  };

  /** What a main.js card is: the template from its kind and what the state carried, else from the notification's type. */
  function infoOf(c) {
    const n = c && c.n && typeof c.n === "object" ? c.n : null;
    const base = n ? classify(n.type, factsOf(n)) : null;
    switch (c?.kind) {
      case "followup_answer": return base && base.template === "answer" ? base : T("answer", "talk", "people", false, "answer");
      case "followup_ask": return T("ask", "needs", "ask", true, "asks");
      case "item": return c.w?.kind === "request" ? T("request", "needs", "ask", true, "asks") : T("message", "talk", "people", false, "message");
      case "item_update":
        if (c.u?.kind === "request" && c.u.status === "done") return T("together", "good", "good", false, "accepted");
        if (c.u?.kind === "reply" || n?.type === "assistant.reply") return T("message", "talk", "people", false, "reply");
        return base ?? T("plain", "talk", "people", false, "update");
      case "loop": return c.lk === "block" ? T("blocked", "needs", "ask", true, "blocked") : c.w?.kind === "open_ask" ? T("commitment", "needs", "ask", true, "asks") : T("commitment", "needs", "ask", true, "commitment");
      case "standup": return T("standup", "needs", "ask", true, "standup");
      case "standup_rollup": return T("rollup", "plain", "report", false, "standup");
      case "routine": return base ?? T("routine", "plain", "report", false, "routine");
      default: return base ?? { ...UNKNOWN };
    }
  }

  /**
   * A result in place of the body (sent, done, gone, posted, skipped): the byline stays, the words are main.js's, read whole.
   * Its tone is a small mark before them (a green check, a red alert), the words themselves white: a word beside every
   * colour, and the mockup's quiet done line rather than a coloured headline.
   */
  function resultBody(k, r) {
    const tone = r.tone === "ok" || r.tone === "bad" ? r.tone : "";
    return `<h3 class="nc-hl wrap full${tone ? ` ${tone}` : ""}" id="nc-hl">${tone ? icon(tone === "ok" ? "check" : "alert") : ""}${k.say(one(r.title) || "Done.")}</h3>${one(r.sub) ? `<p class="nc-lede two">${k.say(r.sub)}</p>` : ""}`;
  }

  /** Builds a card: its markup, which template drew it, its family and the words on it. Never throws, never empty. */
  function build(c0, env0, opts0) {
    const env = envOf(env0);
    const c = c0 && typeof c0 === "object" ? c0 : { kind: "notification", n: null };
    const o = opts0 && typeof opts0 === "object" ? opts0 : {};
    const info = infoOf(c);
    let k = kit(env, o, c), template = info.template, t = null;
    try { t = own(TEMPLATES, template) ? TEMPLATES[template](k, c, info) : null; } catch { t = null; }
    if (!t || typeof t.by !== "string" || typeof t.body !== "string") {
      template = "plain"; k = kit(env, o, c);
      try { t = tPlain(k, c, info); } catch { t = null; }
      if (!t) t = { by: "", body: `<h3 class="nc-hl" id="nc-hl">Something new</h3>`, actions: btn(k, { cls: "primary", act: "close", main: true, html: "OK" }) };
    }
    let body = t.body;
    if (o.result && typeof o.result === "object") { k.words.length = 0; body = resultBody(k, o.result); }
    const actions = typeof o.done === "string" && o.done
      ? `<span class="nc-done">${icon("check")}${k.e(o.done)}</span>`
      : o.result && typeof o.result === "object" ? str(o.result.actions)
      : typeof o.actions === "string" ? o.actions : t.actions;
    const html = `<section class="nc${o.done ? " acted" : ""}" data-template="${template}" data-family="${info.family}" aria-labelledby="nc-hl">${t.by}${body}${typeof o.slot === "string" ? o.slot : ""}<div class="actions">${actions}</div>${typeof o.nav === "string" ? o.nav : ""}</section>`;
    return { html, template, family: info.family, group: info.group, waits: info.waits, words: countWords(k.words.join(" ")) };
  }

  // ---- notices: what the queue, the bar and the summary know about each notification ------------------------------------

  /** Who brought it (the person, "me" for her own news, "ws" for the workspace's) and their face's mood in the summary. */
  function senderOf(env, n, s, cls) {
    const t = str(n.type), F = factsOf(n);
    const pick = () => {
      switch (cls.template) {
        case "message": case "mention": return F?.from ?? s?.sender ?? s?.other ?? null;
        case "answer": return t === "brenda.followup_answer" ? F?.subject ?? s?.subject ?? null : null;
        case "report": return "ws";
        case "together": return t === "review.approved" ? F?.by : t === "assistant.outcome" ? F?.from ?? s?.other : t === "brenda.commitment_accepted" ? F?.committer : null;
        case "request": return F?.from ?? s?.sender ?? null;
        case "ask": return s ? s.asker ?? "ws" : null;
        case "commitment": return t === "brenda.commitment" ? "ws" : s?.from ?? null;
        case "blocked": return s?.from ?? null;
        case "assignment": return F?.by ?? null;
        case "plain":
          if (t === "brenda.commitment_declined") return F?.committer ?? null;
          if (t === "assistant.outcome") return F?.from ?? s?.other ?? null;
          if (t.startsWith("review.")) return F?.by ?? null;
          return FROM_WS.has(t) ? "ws" : null;
        default: return null;
      }
    };
    const p = pick();
    if (p === "ws") return { key: "ws", label: "Team", who: env.ws, mood: t === "brenda.daily_report" ? reportMood(F) : noticeMood(n, F, cls, false) };
    const who = p ? personOf(env, p) : null;
    return { ...(who ? { key: who.key, label: who.first || who.name, who: who.who } : { key: "me", label: "You", who: env.me }), mood: noticeMood(n, F, cls, !!who) };
  }
  function reportMood(F) {
    if (!F || F.kind !== "report") return "";
    if (F.trackedSeconds === 0 && F.finished === 0) return "sad";
    return F.overdue === 0 && F.blocked === 0 && !(F.missing?.count > 0) && !(F.late?.count > 0) ? "happy" : "";
  }
  /** B's mood table for a sender's face: alert waits on you, happy good news, sad late, gulp new or not started, dimmed no reply. */
  function noticeMood(n, F, cls, other) {
    const t = str(n.type);
    if (cls.waits) return "alert";
    if (cls.family === "good") return "happy";
    if (SAD.has(t)) return "sad";
    if (t === "brenda.followup_answer" && F?.kind === "answer") { const rk = str(F.result?.key); return own(ANSWER_MOODS, rk) ? ANSWER_MOODS[rk][1] : F.status === "expired" ? "blink away" : ""; }
    if (t === "brenda.commitment_due") return F?.overdue === true ? "sad" : "alert";
    if (t === "task.assigned") return other ? "happy" : "gulp";
    if (cls.group === "time") return "alert";
    return "";
  }
  /** A request's ask in a few words, for the bar ("asks to move a task"). */
  function requestLine(R) {
    const kind = str(R?.kind);
    const what = clip(one(kind === "add_todo" ? R.title : kind === "set_reminder" ? R.text : R?.taskTitle), 60);
    const head = kind === "add_todo" ? "asks you to add a to-do" : kind === "task_status" ? "asks to move a task" : kind === "task_comment" ? "asks for a comment" : kind === "set_reminder" ? "asks to set a reminder" : "";
    return head ? `${head}${what ? `: ${what}` : ""}` : "";
  }
  /** The bar's one line: their words, the result, or the title, plain. */
  function lineOf(n, s) {
    const F = factsOf(n);
    const t = str(n.type);
    let line = "";
    if (F) {
      if (F.kind === "message" || F.kind === "mention" || F.kind === "comment") line = one(F.preview);
      else if (F.kind === "answer") line = one(F.result?.label) ? `${one(F.result.label)}${one(F.question) ? `: ${one(F.question)}` : ""}` : "";
      else if (F.kind === "reminder") line = one(F.text);
      else if (F.kind === "assignment") line = one(F.task?.title);
      else if (F.kind === "commitment") line = one(F.title);
      else if (F.kind === "routine") line = one(F.lead);
      // A request: the sender's own note, else what it asks (review, 9 October 2026: the bar repeated the sender's name).
      else if (F.kind === "request" && t === "assistant.request") line = one(F.note) || requestLine(F.request);
      else if (F.kind === "report") line = reportHead(F, n.title);
    }
    if (!line && s && t === "assistant.request") line = one(s.note);
    if (!line && s) line = unquote(s.question ?? s.body ?? s.what ?? s.title ?? s.lead ?? "");
    if (!line && t === "brenda.reminder") line = one(str(n.title).replace(/^Reminder:\s*/i, ""));
    if (!line && t === "brenda.daily_report") line = reportHead(null, n.title);
    if (!line) line = one(n.title) || one(n.body);
    return clip(line, LINE_MAX);
  }
  /** A desktop-state notification as the queue, the bar and the summary see it. */
  function notice(n, env0) {
    const env = envOf(env0);
    const x = n && typeof n === "object" ? n : {};
    const cls = classify(x.type, factsOf(x));
    const s = stateOf(env, x);
    let sender;
    try { sender = senderOf(env, x, s, cls); } catch { sender = { key: "me", label: "You", who: env.me, mood: "" }; }
    return { id: str(x.id), type: str(x.type), ...cls, at: Date.parse(str(x.created_at)) || 0, sender, line: lineOf(x, s), facts: factsOf(x) };
  }
  const isNotice = (x) => !!x && typeof x === "object" && typeof x.id === "string" && x.sender && typeof x.sender === "object";

  // ---- several at once: the summary, the pager's footer and the end card ---------------------------------------------------

  const FAMILY_ORDER = ["needs", "talk", "plain", "good"];
  /** The summary's wash: every kind waiting, side by side in proportion (rounded to one decimal, zero kinds left out). */
  function mix(counts) {
    const c = counts && typeof counts === "object" ? counts : {};
    const strength = { needs: ".36", talk: ".36", plain: ".13", good: ".36" };
    const parts = FAMILY_ORDER.map((f) => ({ f, n: int(c[f]) ?? 0 })).filter((p) => p.n > 0);
    const total = parts.reduce((a, p) => a + p.n, 0);
    if (!total) return "linear-gradient(90deg, rgb(var(--plain) / .13) 0% 100%)";
    const r = (v) => Math.round(v * 10) / 10;
    let at = 0;
    const stops = parts.map((p, i) => {
      const from = at, to = i === parts.length - 1 ? 100 : at + (p.n / total) * 100;
      at = to;
      // A soft edge between kinds, as the mockup's wash: each colour holds the middle of its share.
      const pad = Math.min((to - from) * 0.18, 6);
      const a = i === 0 ? 0 : r(from + pad), b = i === parts.length - 1 ? 100 : r(to - pad);
      return `rgb(var(--${p.f}) / ${strength[p.f]}) ${a}% ${b}%`;
    });
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }

  const KIND_WORDS = { needs: ["needs you", "need you"], talk: ["message", "messages"], plain: ["report", "reports"] };
  /** The summary card: "Hey Jeremiah, you have 8 notifications", who sent them (B's row of faces), the kinds, two buttons. */
  function summary(notices, env0) {
    const env = envOf(env0);
    const e = env.esc;
    const list = arr(notices).filter(isNotice);
    const first = firstOf(env.displayName);
    // Past the 20 the state carries, the count is everyone unread; the faces stay those of the ones it carries (+N).
    const total = Math.max(list.length, env.unreadTotal ?? 0), beyond = total - list.length;
    const groups = [], keyed = new Map();
    for (const x of list) {
      const id = str(x.sender.key) || `id:${x.id}`;
      let g = keyed.get(id);
      if (!g) { g = { s: x.sender, items: [] }; keyed.set(id, g); groups.push(g); }
      g.items.push(x);
    }
    const shown = groups.slice(0, LINEUP_MAX), hidden = groups.slice(LINEUP_MAX);
    const mates = shown.map((g) => {
      const mine = g.s.key === "me";
      const mood = str(g.items[0].sender?.mood).replace(/[^a-z ]/g, "");
      const f = env.face({ ...(mine ? {} : { who: g.s.who && typeof g.s.who === "object" ? g.s.who : env.assistantOf(null) }), ...(mood ? { mood } : {}), cls: "f-lg still", look: mine ? [0, -0.4] : [0.7, -0.5] });
      const count = g.items.length;
      return `<span class="nc-mate">${f}${count > 1 ? `<i class="count">${count}</i>` : ""}<b>${e(clip(one(g.s.label) || "Someone", 40))}</b><span>${e(count > 1 ? `${count} updates` : g.items[0].word)}</span></span>`;
    });
    if (hidden.length || beyond > 0) {
      const more = hidden.reduce((a, g) => a + g.items.length, 0) + beyond;
      mates.push(`<span class="nc-mate"><span class="nc-more-n">+${more}</span><b>more</b><span>${e(hidden.length ? hidden[0].items[0].word : "older")}</span></span>`);
    }
    const counts = { needs: 0, talk: 0, plain: 0, good: 0 };
    for (const x of list) if (own(counts, x.family)) counts[x.family] += 1;
    const goodOne = list.find((x) => x.family === "good");
    const kinds = FAMILY_ORDER.filter((f) => counts[f] > 0).map((f) => {
      const nn = counts[f];
      const w = f === "good" ? (nn === 1 && (goodOne?.word === "approved" || goodOne?.word === "accepted") ? goodOne.word : "good news") : KIND_WORDS[f][nn === 1 ? 0 : 1];
      return `<button class="nc-kind" type="button" data-act="pg-kind" data-family="${f}" aria-label="${nn} ${e(w)}. Show them"><i class="dot"></i><span class="n">${nn}</span>${e(w)}</button>`;
    }).join("");
    const off = env.busy ? " disabled" : "";
    // Mark all read keeps the asks, so with only asks left it would do nothing: it is not offered (review, 9 October 2026).
    const readable = beyond > 0 || list.some((x) => x.group !== "ask");
    return `<section class="nc nc-summary" data-template="summary" data-family="mix" aria-labelledby="nc-hl"><div class="nc-sum-top"><p class="nc-hey">${first ? `Hey <b>${e(first)}</b>, you have` : "Hey, you have"}</p></div><p class="nc-big" id="nc-hl"><span class="n">${total}</span><span class="w">${total === 1 ? "notification" : "notifications"}</span></p>${mates.length ? `<div class="nc-lineup" role="group" aria-label="Who sent them">${mates.join("")}</div>` : ""}${kinds ? `<div class="nc-kinds">${kinds}</div>` : ""}<div class="actions">${readable ? `<button class="btn ghost" type="button" data-act="pg-all"${off}>${icon("checks")}Mark all read</button>` : ""}<span class="grow"></span><button class="btn primary accent" type="button" data-act="pg-show" data-main${off}>Show them</button></div></section>`;
  }

  /** The window of dots around the current one: at most `max`, the current one inside it. */
  function dotWindow(count, index, max = DOTS_MAX) {
    const c = Math.max(0, int(count) ?? 0), m = Math.max(1, int(max) ?? DOTS_MAX);
    if (c <= m) return { from: 0, to: c };
    const from = Math.min(Math.max(0, (int(index) ?? 0) - Math.floor(m / 2)), c - m);
    return { from, to: from + m };
  }
  /** C's deck row under every pager card: dots in each kind's colour, "3 of 8", Mark all read, ‹ and Next › (Finish last). */
  function nav(p, notices) {
    const list = arr(notices).filter((x) => x && typeof x === "object");
    const count = list.length;
    const index = Math.min(Math.max(0, int(p?.index) ?? 0), Math.max(0, count - 1));
    const seen = p?.seen instanceof Set ? p.seen : new Set(arr(p?.seen));
    const { from, to } = dotWindow(count, index);
    const dots = list.slice(from, to).map((x, j) => `<i class="${from + j === index ? "on" : seen.has(x.id) ? "past" : ""}" style="--kind:${dotOf(x.family)}"></i>`).join("");
    const last = index >= count - 1;
    return `<div class="nc-nav" role="group" aria-label="Notifications"><span class="nc-dots" aria-hidden="true">${dots}</span><span class="nc-pos" aria-live="polite"><b>${count ? index + 1 : 0}</b> of ${count}</span><span class="nc-sp"></span>`
      + (p?.readable === false ? "" : `<button class="btn ghost" type="button" data-act="pg-all">Mark all read</button>`)
      + `<button class="btn icon" type="button" data-act="pg-prev" aria-label="Previous" title="Previous (←)"${index === 0 ? " disabled" : ""}>${icon("left")}</button>`
      + `<button class="btn" type="button" data-act="pg-next" title="${last ? "Finish" : "Next (→)"}">${last ? "Finish" : `Next${icon("right")}`}</button></div>`;
  }

  /**
   * The end card: her face alone, "All caught up", and that she folds away in a moment. With asks still waiting (paging
   * never reads them) it does not say caught up (review, 9 October 2026): "2 still need you", and that they wait in the bar.
   */
  function done(count, env0, o = {}) {
    const env = envOf(env0);
    const nn = int(count) ?? 0, left = int(o?.left) ?? 0;
    const read = nn ? `${nn} read. ` : "";
    const head = left ? `${left} still ${plural(left, "needs", "need")} you` : nn ? "All caught up" : "Nothing left";
    const sub = left ? `${read || "Nothing else to read. "}${plural(left, "It waits", "They wait")} in the bar.` : nn ? `${read}I'll fold away in a moment.` : "Nothing to read. I'll fold away in a moment.";
    return `<section class="nc center" data-template="done" data-family="${left ? "needs" : "good"}" aria-labelledby="nc-hl"><div class="nc-duo">${env.face({ mood: left ? "alert" : "happy", cls: "lg" })}</div><h3 class="nc-hl" id="nc-hl">${head}</h3><p class="nc-lede">${sub}</p><div class="actions"><button class="btn primary" type="button" data-act="close" data-main>Close</button></div></section>`;
  }

  // ---- the compact bar --------------------------------------------------------------------------------------------------

  /** The bar's model: the newest one by name for one or two, how many (and how many need you) with faces for more. */
  function barModel(notices, env0) {
    const list = arr(notices).filter(isNotice);
    if (!list.length) return null;
    const total = Math.max(list.length, envOf(env0).unreadTotal ?? 0);
    const newest = [...list].sort((a, b) => (b.at || 0) - (a.at || 0));
    if (total <= 2) return { kind: "one", notice: newest[0], total };
    const faces = [], keys = new Set();
    for (const x of newest) { const id = str(x.sender.key) || x.id; if (keys.has(id)) continue; keys.add(id); faces.push(x.sender); if (faces.length === 3) break; }
    return { kind: "many", total, needYou: list.filter((x) => x.family === "needs").length, faces };
  }
  /** Who a bar names: the person's first name, her own assistant's name for her own news, the workspace for its report. */
  const barName = (env, s) => (s.key === "me" ? nameOf(env.me) : s.key === "ws" ? one(env.workspaceName) || "Team" : one(s.label) || "Someone");
  /** The bar's parts for main.js's compact row: a lead (dot or face), the words, the trail (count or faces); never "All clear". */
  function bar(model, env0) {
    const env = envOf(env0);
    const e = env.esc;
    const m = model && typeof model === "object" ? model : null;
    const empty = { lead: "", text: "", trail: "", wide: false, label: "" };
    if (!m) return empty;
    if (m.kind === "one" && isNotice(m.notice)) {
      const x = m.notice, who = barName(env, x.sender), total = int(m.total) ?? 1;
      return { lead: `<i class="nc-kdot" style="background:${dotOf(x.family)}"></i>`, text: `<b>${e(clip(who, 40))}</b>&ensp;${e(x.line)}`, trail: `<span class="count">${total}</span>`, wide: true, label: `${total} unread, newest from ${who}` };
    }
    if (m.kind === "many") {
      const total = int(m.total) ?? 0, need = int(m.needYou) ?? 0;
      const faces = arr(m.faces).slice(0, 3).map((s) => env.face({ ...(s?.key === "me" ? {} : { who: s?.who && typeof s.who === "object" ? s.who : env.assistantOf(null) }), small: true, cls: "still" })).join("");
      return { lead: "", text: `<span class="nc-big-n">${total} new</span>${need ? `, <span class="nc-acc">${need} ${plural(need, "needs", "need")} you</span>` : ""}`, trail: faces ? `<span class="nc-stack">${faces}</span>` : "", wide: true, label: `${total} new${need ? `, ${need} ${plural(need, "needs", "need")} you` : ""}` };
    }
    if (m.kind === "waiting") {
      const who = m.who && typeof m.who === "object" ? m.who : env.assistantOf(null);
      const name = clip(one(m.label) || "Someone", 40), count = int(m.count) ?? 0;
      return { lead: `<span class="nc-stack">${env.face({ who, small: true, mood: "alert" })}</span>`, text: `<b>${e(name)}</b> is waiting on you`, trail: count ? `<span class="count">${count}</span>` : "", wide: true, label: `${name} is waiting on you` };
    }
    return empty;
  }
  /** The bar's words as one row at the top of the home card: pressing it opens the pager (or the one notification). */
  function strip(model, env0) {
    const env = envOf(env0);
    const b = bar(model, env);
    if (!b.text) return "";
    const single = model?.kind === "one" && (int(model.total) ?? 1) === 1;
    return `<button type="button" class="nc-strip" data-act="nc-inbox" aria-label="${env.esc(`${b.label}. ${single ? "Show it" : "Show them"}`)}">${b.lead}<span class="nc-strip-t">${b.text}</span>${b.trail}${icon("right")}</button>`;
  }

  // ---- the API ----------------------------------------------------------------------------------------------------------

  const api = {
    classify: (type, f) => classify(type, f),
    notice,
    cardInfo: (c, env) => { const r = build(c, env, {}); return { template: r.template, family: r.family, group: r.group, waits: r.waits, words: r.words }; },
    card: (c, env, opts) => build(c, env, opts).html,
    summary,
    done,
    nav: (p, notices) => nav(p, notices),
    bar,
    barModel: (notices, env) => barModel(notices, env),
    strip,
    mix,
    words: (c, env) => build(c, env, {}).words,
  };
  return api;
})();
if (typeof module === "object" && module && module.exports) module.exports = NotifyCards;
