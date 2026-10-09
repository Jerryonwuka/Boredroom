// The notch's notification queue, summary and pager, as pure functions (owner decision, 9 October 2026: notch
// notifications, "A plus the grafts"). Plain JavaScript, no build step: a classic script loaded after notify-cards.js and
// before main.js, sharing their one global scope, and loadable by Node for the unit tests (tests/unit/notch-notify.test.ts).
//
// What it decides, and nothing else (main.js keeps the timers, the DOM and the calls to Boredroom; notify-cards.js the
// markup):
// - One card at a time, and nothing ever opens because a card closed: today's chain (closeCard() then
//   setTimeout(nextNotification, 600)) is gone. What arrives is decided once, on arrival (`arrival`): one alone opens its
//   card; two or more together (one poll, so within about 15 to 20 s), or what waited through quiet hours or time away,
//   open the summary instead; while a card is open they only join the bar ("+2 waiting" on the card); while the pager is
//   open they join right behind the current card.
// - The pager's order (`order`): what waits on you, then what is due, then people, then reports and routines, then good
//   news last (the approved mockup's rules note: "what waits on you first, then messages, reports, good news"; review,
//   9 October 2026, it had good news before reports); newest first within each. Mark all read (`markAllRead`) reads the
//   notices and keeps the asks.
// - What counts as arrived (review, 9 October 2026): a notification newer than anything already seen. The state carries
//   only the newest 20 unread, so an older unread one moves into it each time one is read; it is known from then on but
//   never "arrives" (it would open on its own after every read, the chain the owner banned). The state keeps only what is
//   still unread, so it never grows over a long run.
// - How long a card holds (`holdMs`): 3 s plus 0.3 s for each word on it, between 6 and 14 s; an ask 15 s (then it tucks
//   into the bar); the summary 10 s; the end card 4 s.
// - What leaving the island does (`leaveFold`): an island opened by hovering folds at once, as on 5 October; one that
//   arrived on its own stays what is left of its hold and at least 3 s more; the pager and a card opened by a press stay
//   3 s; one that waits on something being typed, pressed or said stays.
// It never reads `window`, `document` or main.js's state: everything comes in through the arguments, and every function
// returns new objects instead of changing the ones it is given.

// A global for main.js, a later classic script on the page (and module.exports for Node, at the end).
const Notify = (() => {
  /** The timings (owner decision, 9 October 2026; the mockup's rules note and the design judge's spec). */
  const T = Object.freeze({
    BURST_MS: 15_000,         // arrivals this close together are one burst (one poll is 20 s, so a poll's arrivals are one)
    AWAY_MS: 300_000,         // no pointer movement for 5 minutes: away; arrivals wait for the first movement back
    LINGER_MS: 3_000,         // an island that arrived on its own, or the pager, stays at least this long after the pointer leaves
    ASK_HOLD_MS: 15_000,      // an ask holds this long, then tucks into the bar ("Ben is waiting on you")
    SUMMARY_HOLD_MS: 10_000,  // the summary holds this long, then folds to the bar
    DONE_HOLD_MS: 4_000,      // "All caught up" holds this long (the mockup's "Holds 4 s")
    ACT_MS: 600,              // what a press did shows this long in the pager before it moves on
    ENTER_GUARD_MS: 600,      // Enter does nothing this soon after a card is drawn (an Enter meant for the last page)
    HOLD: Object.freeze({ base: 3_000, perWord: 300, min: 6_000, max: 14_000 }),
    DOTS_MAX: 12,             // the pager shows at most this many dots, a window around the current one
    SKEW_MS: 30_000,          // a notification this much older than the newest seen still arrives (written in a slower transaction)
  });

  /** The pager's order of groups: what waits on you, what is due, people, reports and routines, then good news (the mockup). */
  const GROUP_RANK = Object.freeze({ ask: 0, time: 1, people: 2, report: 3, good: 4 });
  const rankOf = (g) => (typeof g === "string" && Object.hasOwn(GROUP_RANK, g) ? GROUP_RANK[g] : GROUP_RANK.report);

  /** Words on a card: whitespace-separated tokens (anything that is not a string has none). */
  function countWords(text) {
    if (typeof text !== "string") return 0;
    const t = text.trim();
    return t ? t.split(/\s+/).length : 0;
  }

  /** How long a card holds before it folds: the end card 4 s, the summary 10 s, an ask 15 s, else 3 s + 0.3 s a word, 6 to 14 s. */
  function holdMs(o = {}) {
    if (o.done) return T.DONE_HOLD_MS;
    if (o.summary) return T.SUMMARY_HOLD_MS;
    if (o.waits) return T.ASK_HOLD_MS;
    const words = Number.isFinite(o.words) && o.words > 0 ? Math.floor(o.words) : 0;
    return Math.min(T.HOLD.max, Math.max(T.HOLD.min, T.HOLD.base + T.HOLD.perWord * words));
  }

  const atOf = (x) => (Number.isFinite(x?.at) ? x.at : 0);
  /** The pager's order: by group (GROUP_RANK), newest first within each, then by id so the order never shuffles. */
  function order(items) {
    return (Array.isArray(items) ? items : [])
      .filter((x) => !!x && typeof x.id === "string")
      .map((x, i) => ({ id: x.id, r: rankOf(x.group), at: atOf(x), i }))
      .sort((a, b) => a.r - b.r || b.at - a.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : a.i - b.i))
      .map((x) => x.id);
  }

  /**
   * A fresh arrival state: ids known (with when they were first seen), held through quiet hours or time away, shown, and
   * the newest notification time seen (null before the first poll: then everything unread has just arrived).
   */
  const initial = () => ({ known: new Map(), held: new Set(), shown: new Set(), newest: null });

  /**
   * One step of arrival, after a poll (and when quiet hours end, and on the first movement after time away). `s` is
   * { known, held, shown, newest }; `input` is { list: [{ id, at? }] (unread now, newest first; `at` its created time in
   * ms), now, cardOpen, pagerOpen, quiet, away }. Ids not known before are fresh (first seen now) when they are newer
   * than the newest seen before, less SKEW_MS (or have no time, or it is the first poll); an older one is only known (it
   * came into the state's 20 because another was read). Then, in this order: the pager open, they join it right behind
   * the current card ("pager-insert"); a card open, they only join the bar ("bar"); quiet hours or away, they wait
   * ("hold"); else what is due (held and fresh, still unread and not shown) opens: 2 or more the summary, 1 its card,
   * none nothing. Ids that left the list (read) leave `known`, `held` and `shown`. Returns { action, ids, fresh, s }.
   */
  function arrival(s, input = {}) {
    const known = new Map(s?.known instanceof Map ? s.known : []);
    const held = new Set(s?.held instanceof Set ? s.held : []);
    const shown = new Set(s?.shown instanceof Set ? s.shown : []);
    const before = Number.isFinite(s?.newest) ? s.newest : null;
    const now = Number.isFinite(input.now) ? input.now : 0;
    const items = (Array.isArray(input.list) ? input.list : []).filter((x) => typeof x?.id === "string");
    const ids = items.map((x) => x.id);
    const present = new Set(ids);
    const fresh = [];
    let newest = before;
    for (const x of items) {
      const at = Number.isFinite(x.at) ? x.at : null;
      if (at !== null && (newest === null || at > newest)) newest = at;
      if (known.has(x.id)) continue;
      known.set(x.id, now);
      if (before === null || at === null || at > before - T.SKEW_MS) fresh.push(x.id);
    }
    for (const id of [...known.keys()]) if (!present.has(id)) known.delete(id);
    for (const id of [...held]) if (!present.has(id)) held.delete(id);
    for (const id of [...shown]) if (!present.has(id)) shown.delete(id);
    const out = (action, list) => ({ action, ids: list, fresh, s: { known, held, shown, newest } });
    if (input.pagerOpen) { for (const id of fresh) shown.add(id); return out("pager-insert", fresh); }
    if (input.cardOpen) { for (const id of fresh) shown.add(id); return out("bar", fresh); }
    if (input.quiet || input.away) { for (const id of fresh) held.add(id); return out("hold", fresh); }
    const due = ids.filter((id) => (held.has(id) || fresh.includes(id)) && !shown.has(id));
    held.clear();
    for (const id of due) shown.add(id);
    return out(due.length >= 2 ? "summary" : due.length === 1 ? "single" : "none", due);
  }

  /**
   * The pager over `ids`, at `placeId` when it is among them (a place kept from before), else at the first. `seen`: the
   * cards already seen when it folded (review, 9 October 2026: their dots stay dimmed when it opens again).
   */
  function pagerStart(ids, placeId, seen) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === "string"))];
    const at = placeId ? list.indexOf(placeId) : -1;
    const index = at >= 0 ? at : 0;
    const had = seen instanceof Set ? seen : new Set(Array.isArray(seen) ? seen : []);
    const keep = new Set(list.filter((id) => had.has(id)));
    if (list.length) keep.add(list[index]);
    return { ids: list, index, seen: keep };
  }

  /** New ids (already in pager order) right behind the current card; ids already in the pager stay where they are. */
  function pagerInsert(p, newIds) {
    const have = new Set(p.ids);
    const add = [...new Set((Array.isArray(newIds) ? newIds : []).filter((id) => typeof id === "string" && !have.has(id)))];
    const ids = [...p.ids.slice(0, p.index + 1), ...add, ...p.ids.slice(p.index + 1)];
    return { ...p, ids, seen: new Set(p.seen) };
  }

  /** One step: +1 past the last finishes the pager; -1 at the first stays. The card stepped to counts as seen. */
  function pagerStep(p, dir) {
    const next = p.index + (dir < 0 ? -1 : 1);
    if (next >= p.ids.length) return { finished: true };
    if (next < 0) return p;
    const seen = new Set(p.seen); seen.add(p.ids[next]);
    return { ...p, index: next, seen };
  }

  /**
   * An id leaves the pager (read elsewhere, gone from the state). The current card stays current when it is another one;
   * when it is the one leaving, the card after it takes its place (the last one's, the one before). Empty: finished.
   */
  function pagerRemove(p, id) {
    const at = p.ids.indexOf(id);
    if (at < 0) return p;
    const ids = p.ids.filter((x) => x !== id);
    if (!ids.length) return { finished: true };
    const index = at < p.index ? p.index - 1 : Math.min(p.index, ids.length - 1);
    const seen = new Set([...p.seen].filter((x) => x !== id)); seen.add(ids[index]);
    return { ...p, ids, index, seen };
  }

  /** Which dots show: at most `max`, a window around the current one. `from` inclusive, `to` exclusive (as slice). */
  function dotWindow(count, index, max = T.DOTS_MAX) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const m = Math.max(1, Math.floor(Number(max) || T.DOTS_MAX));
    if (n <= m) return { from: 0, to: n };
    const i = Math.min(n - 1, Math.max(0, Math.floor(Number(index) || 0)));
    const from = Math.min(n - m, Math.max(0, i - Math.floor(m / 2)));
    return { from, to: from + m };
  }

  /**
   * What the pointer leaving the island does. `origin`: "hover" (opened by the pointer, and what was opened from it),
   * "auto" (arrived on its own), "pager", "user" (opened by a press). Sticky (something being typed, pressed or said)
   * stays. Hover folds after `grace` (main.js's LEAVE_GRACE_MS, 120 ms: the 5 October rule); auto after what is left of
   * its hold and at least 3 s; the pager and a pressed-open card after 3 s. Returns { mode: "stay" | "now" | "after", ms }.
   */
  function leaveFold(o = {}) {
    if (o.sticky) return { mode: "stay", ms: 0 };
    let ms;
    if (o.origin === "hover") ms = Number.isFinite(o.grace) ? Math.max(0, o.grace) : 120;
    else if (o.origin === "auto") ms = Math.max(Number.isFinite(o.left) ? o.left : 0, T.LINGER_MS);
    else ms = T.LINGER_MS;
    return ms > 0 ? { mode: "after", ms } : { mode: "now", ms: 0 };
  }

  /** Mark all read: every notice is read, every ask (group "ask") is kept until it is answered. */
  function markAllRead(items) {
    const read = [], keep = [];
    for (const x of Array.isArray(items) ? items : []) {
      if (!x || typeof x.id !== "string") continue;
      (x.group === "ask" ? keep : read).push(x.id);
    }
    return { read, keep };
  }

  /** No pointer movement for 5 minutes. */
  const away = (lastMoveAt, now) => Number.isFinite(lastMoveAt) && Number.isFinite(now) && now - lastMoveAt > T.AWAY_MS;

  return Object.freeze({ T, GROUP_RANK, countWords, holdMs, order, initial, arrival, pagerStart, pagerInsert, pagerStep, pagerRemove, dotWindow, leaveFold, markAllRead, away });
})();
if (typeof module === "object" && module && module.exports) module.exports = Notify;
