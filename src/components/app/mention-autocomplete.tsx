"use client";

/**
 * "@" in the Messages composer (owner decision, 8 October 2026: personal assistants, phase 5). Typing "@" offers the
 * person's OWN assistant first ("@Max", where it may reply here), then the conversation's people; picking one writes
 * "@Max " or "@Ben Okafor " into the box. Mentions are structural: on send the composer hands the server a token list
 * beside the text (`MentionToken`, contract B.1/F.1) and the server checks each against the text and the conversation;
 * nothing ever re-reads names out of a message later. A typed "@Max" with no token is plain text.
 *
 * Accessibility (contract F.1; review, 8 October 2026): `role="combobox"` is not valid on a `<textarea>`, so the box keeps
 * its own role and carries the combobox state (`aria-autocomplete="list"`, `aria-haspopup="listbox"`, `aria-expanded`,
 * `aria-controls`, `aria-activedescendant`); the list is a `listbox` of `option`s and a polite status says how many
 * suggestions there are and, as the choice moves, which one is chosen. Keys while open: Up and Down move (wrapping), Home
 * and End jump, Enter or Tab insert (Enter never sends while a suggestion is chosen), Escape closes the list only.
 * The mouse never takes the focus out of the box (mousedown is held back), so the caret stays where it was.
 *
 * Decisions (review, 8 October 2026): with no match the list says "No one here by that name" only while the "@…" is one
 * word (so "@Max what's" while asking your assistant shows nothing), and then Enter sends as usual, because there is
 * nothing to insert; where the assistant may not reply, the disabled row shows once something is typed after "@" that
 * matches it, not on a bare "@"; two people who share a name are only mentioned when picked from the list.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject, type SyntheticEvent } from "react";
import { BrendaFace } from "@/components/app/brenda-face";
import { Avatar } from "@/components/ui/avatar";
import { lookOf, type AssistantProfile } from "@/lib/assistant-look";
import { assistantLabels, findLabelAll, mentionQueryAt, MENTION_LIMITS, MENTION_WORDS, type MentionToken } from "@/lib/mentions";
import { cn } from "@/lib/utils";

/** Someone in the conversation who can be mentioned (the person writing is left out by the page). */
export type MentionPerson = { membershipId: string; name: string; profileId: string; avatarKey: string | null; role: string };
/** What the composer knows about mentions here: whether migration 0041 is in, and whether the person's assistant may reply. */
export type ComposerMentions = { ready: boolean; assistantAllowed: boolean };

const ROLE: Record<string, string> = { owner: "Owner", hr: "HR", manager: "Team lead", employee: "Staff" };
const MAX_ROWS = 8;
// The send schema's caps (contract B.2): a longer label would refuse the whole message, so it is never sent.
const MAX_ASSISTANT_LABEL = 40;
const MAX_PERSON_LABEL = 121;

const lower = (s: string) => s.toLocaleLowerCase("en-GB");

type Query = { start: number; query: string };
type Option =
  | { key: string; kind: "assistant"; label: string }
  | { key: string; kind: "person"; label: string; person: MentionPerson }
  | { key: string; kind: "off" };
type Selectable = Exclude<Option, { kind: "off" }>;

/** Whether `name`'s first name, last name or full name starts with what was typed after "@". */
function nameMatches(name: string, query: string): boolean {
  const q = lower(query.trim());
  if (!q) return true;
  const n = lower(name.trim());
  return n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q));
}

/** The body's own spelling of a label found at `at`, when it is the same label (else the label as given). */
function spelling(body: string, at: number, label: string): string {
  const s = body.slice(at, at + label.length);
  return lower(s) === lower(label) ? s : label;
}

/** The "@Full Name" labels only one person in the list has, lowercased once per list (the list changes rarely). */
const UNIQUE_LABELS = new WeakMap<MentionPerson[], { key: string; label: string; person: MentionPerson }[]>();
function uniqueLabels(people: MentionPerson[]): { key: string; label: string; person: MentionPerson }[] {
  const cached = UNIQUE_LABELS.get(people);
  if (cached) return cached;
  const byLabel = new Map<string, { label: string; list: MentionPerson[] }>();
  for (const p of people) {
    const l = `@${p.name.trim()}`;
    if (l.length < 2 || l.length > MAX_PERSON_LABEL) continue;
    const key = lower(l);
    const at = byLabel.get(key);
    if (at) at.list.push(p); else byLabel.set(key, { label: l, list: [p] });
  }
  const out = [...byLabel].filter(([, v]) => v.list.length === 1).map(([key, v]) => ({ key, label: v.label, person: v.list[0] }));
  UNIQUE_LABELS.set(people, out);
  return out;
}

/**
 * The mention tokens for a message about to be sent (contract F.1): the person's own assistant when it may reply here
 * and one of its labels stands in the text; people picked from the list whose label is still there; anyone in the
 * conversation whose "@" + full name was typed by hand. Where labels overlap the longest wins ("@Ben Okafor" is Ben
 * Okafor, not someone called Ben), a picked person wins over the assistant on the same label and the assistant over a
 * typed one; a name two people share counts only when picked.
 */
export function mentionTokens(body: string, opts: { assistantName: string; assistantAllowed: boolean; people: MentionPerson[]; picked: { membershipId: string; label: string }[] }): MentionToken[] {
  // No "@", no mention: this runs on every keystroke, over everyone in the conversation (review, 8 October 2026).
  if (!body.includes("@")) return [];
  type Candidate = { label: string; rank: number; token: (label: string) => MentionToken };
  const candidates: Candidate[] = [];
  const pickedLabels = new Set(opts.picked.map((p) => lower(p.label)));
  for (const p of opts.picked) {
    if (p.label.length > MAX_PERSON_LABEL) continue;
    candidates.push({ label: p.label, rank: 0, token: (label) => ({ kind: "person", membershipId: p.membershipId, label }) });
  }
  if (opts.assistantAllowed) {
    for (const l of assistantLabels(opts.assistantName)) {
      if (l.length <= MAX_ASSISTANT_LABEL && !pickedLabels.has(lower(l))) candidates.push({ label: l, rank: 1, token: (label) => ({ kind: "assistant", label }) });
    }
  }
  const lowered = lower(body);
  for (const u of uniqueLabels(opts.people)) {
    // A quick look first (everyone in a big workspace is a candidate in Everyone, and this runs as the person types).
    if (pickedLabels.has(u.key) || !lowered.includes(u.key)) continue;
    const p = u.person;
    candidates.push({ label: u.label, rank: 2, token: (label) => ({ kind: "person", membershipId: p.membershipId, label }) });
  }
  candidates.sort((a, b) => b.label.length - a.label.length || a.rank - b.rank);
  // Each label found is blanked out of a working copy, so a shorter label inside it is not found again.
  let masked = body;
  const out: MentionToken[] = [];
  const seen = new Set<string>();
  let assistantTaken = false;
  for (const c of candidates) {
    if (!lowered.includes(lower(c.label))) continue;
    const found = findLabelAll(masked, c.label);
    if (!found.length) continue;
    for (const at of found) masked = masked.slice(0, at) + " ".repeat(c.label.length) + masked.slice(at + c.label.length);
    const token = c.token(spelling(body, found[0], c.label));
    const key = token.kind === "assistant" ? "assistant" : token.membershipId;
    if (seen.has(key) || (token.kind === "assistant" && assistantTaken)) continue;
    seen.add(key);
    if (token.kind === "assistant") assistantTaken = true;
    out.push(token);
  }
  // The assistant first, then people in the order the server reads them.
  out.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "assistant" ? -1 : 1));
  return out.slice(0, MENTION_LIMITS.tokensPerMessage);
}

/**
 * The autocomplete's state for one composer box. `value`/`setValue` are the composer's own text; `boxRef` its textarea.
 * `onInserted` runs after a pick has been written in (the composer grows the box to fit).
 */
export function useMentionAutocomplete({ enabled, value, setValue, boxRef, people, assistant, assistantAllowed, onInserted }: {
  enabled: boolean; value: string; setValue: (v: string) => void; boxRef: RefObject<HTMLTextAreaElement | null>;
  people: MentionPerson[]; assistant: AssistantProfile; assistantAllowed: boolean; onInserted?: (el: HTMLTextAreaElement) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState<Query | null>(null);
  const [focused, setFocused] = useState(false);
  // A list closed with Escape stays closed for that "@" (query null), and one just picked from stays closed until the
  // text after its "@" changes (so backspacing into it offers the list again).
  const [closed, setClosed] = useState<{ start: number; query: string | null } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [picked, setPicked] = useState<{ membershipId: string; label: string }[]>([]);
  const caretAfter = useRef<number | null>(null);
  const labels = useMemo(() => assistantLabels(assistant.name), [assistant.name]);
  // Sorted once per list, so a bare "@" in a big Everyone does not sort the whole organisation on each keystroke.
  const sortedPeople = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name, "en-GB")), [people]);

  const options = useMemo<Option[]>(() => {
    if (!query) return [];
    const out: Option[] = [];
    const q = lower(query.query.trim());
    const meMatches = !q || labels.some((l) => lower(l.slice(1)).startsWith(q));
    if (meMatches && assistantAllowed) out.push({ key: "assistant", kind: "assistant", label: labels[0] });
    else if (meMatches && q) out.push({ key: "off", kind: "off" });
    const room = MAX_ROWS - out.length;
    const matches: MentionPerson[] = [];
    for (const p of sortedPeople) { if (matches.length >= room) break; if (nameMatches(p.name, query.query)) matches.push(p); }
    for (const p of matches) out.push({ key: p.membershipId, kind: "person", label: `@${p.name.trim()}`, person: p });
    return out;
  }, [query, labels, assistantAllowed, sortedPeople]);
  const selectable = options.filter((o): o is Selectable => o.kind !== "off");
  const active = selectable.find((o) => o.key === activeKey) ?? selectable[0] ?? null;
  // After a pick, writing on after it ("@Max hi") keeps the list closed: only editing the inserted name opens it again
  // (review, 8 October 2026: "@Max hi" offered a colleague called Max Hill, and Enter took him).
  const suppressed = !!query && !!closed && closed.start === query.start && (closed.query === null || query.query.startsWith(closed.query));
  // Nothing matched: say so while the "@…" is a single word; with a space in it the person is writing on, not looking.
  const none = !!query && options.length === 0 && query.query.trim().length > 0 && !/\s/.test(query.query);
  const open = enabled && focused && !!query && !suppressed && (options.length > 0 || none);
  const optionId = (o: Option) => `${listId}-${o.key}`;
  const activeId = open && active ? optionId(active) : undefined;

  // The chosen option stays in view as it moves through a list that scrolls.
  useEffect(() => { if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" }); }, [activeId]);
  // After a pick the caret goes just after what was written in, once the box shows the new text.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (caretAfter.current === null || !el) return;
    const at = caretAfter.current;
    caretAfter.current = null;
    el.setSelectionRange(at, at);
    onInserted?.(el);
  }, [value, boxRef, onInserted]);

  /** Reads the "@…" at the caret again (after typing, a click or a caret move). */
  const track = (el: HTMLTextAreaElement) => {
    if (!enabled) return;
    const next = el.selectionStart === el.selectionEnd ? mentionQueryAt(el.value, el.selectionStart) : null;
    setQuery((prev) => (prev?.start === next?.start && prev?.query === next?.query ? prev : next));
    if (!next) setClosed(null);
    if (next?.query !== query?.query || next?.start !== query?.start) { setActiveKey(null); setMoved(false); }
  };

  const insert = (o: Selectable) => {
    if (!query) return;
    const end = query.start + 1 + query.query.length;
    const tail = value.slice(end);
    const rest = tail.startsWith(" ") ? tail.slice(1) : tail;
    const next = `${value.slice(0, query.start)}${o.label} ${rest}`;
    const caret = query.start + o.label.length + 1;
    caretAfter.current = caret;
    setValue(next);
    setClosed({ start: query.start, query: `${o.label.slice(1)} ` });
    setQuery({ start: query.start, query: `${o.label.slice(1)} ` });
    setActiveKey(null); setMoved(false);
    if (o.kind === "person") setPicked((list) => [...list.filter((p) => p.membershipId !== o.person.membershipId), { membershipId: o.person.membershipId, label: o.label }]);
  };

  const move = (to: Selectable | undefined) => { if (to) { setActiveKey(to.key); setMoved(true); } };

  /** The box's key handler runs this first; true means the key was the list's and nothing else should happen. */
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || e.nativeEvent.isComposing) return false;
    const i = active ? selectable.indexOf(active) : -1;
    const n = selectable.length;
    switch (e.key) {
      case "ArrowDown": case "ArrowUp":
        if (!n) return false;
        e.preventDefault();
        move(selectable[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]);
        return true;
      case "Home": case "End":
        if (!n || e.shiftKey) return false;
        e.preventDefault();
        move(e.key === "Home" ? selectable[0] : selectable[n - 1]);
        return true;
      case "Enter": case "Tab":
        if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) return false;
        if (!active) {
          // Only "Assistants can't reply here" is showing: the person was reaching for their assistant, so Enter closes
          // the list instead of sending a half-typed "@m" (review, 8 October 2026). "No one by that name" still sends.
          if (e.key === "Enter" && options.length > 0 && query) {
            e.preventDefault();
            setClosed({ start: query.start, query: null });
            return true;
          }
          return false;
        }
        e.preventDefault();
        insert(active);
        return true;
      case "Escape":
        if (!query) return false;
        // The list only: the reply strip and anything else listening for Escape stay as they are.
        e.preventDefault(); e.stopPropagation();
        setClosed({ start: query.start, query: null });
        return true;
    }
    return false;
  };

  const status = !open ? "" : selectable.length ? (moved && active ? (active.kind === "assistant" ? `${assistant.name}, ${MENTION_WORDS.assistantOption}` : active.person.name) : MENTION_WORDS.suggestions(selectable.length)) : options.length ? MENTION_WORDS.assistantOff : MENTION_WORDS.noMatch;

  /** Props for the textarea: the combobox state, and the handlers that keep the query in step with the caret. */
  const boxProps = enabled ? {
    "aria-autocomplete": "list" as const, "aria-haspopup": "listbox" as const, "aria-expanded": open,
    "aria-controls": open ? listId : undefined, "aria-activedescendant": activeId,
    onSelect: (e: SyntheticEvent<HTMLTextAreaElement>) => track(e.currentTarget),
    onFocus: (e: FocusEvent<HTMLTextAreaElement>) => { setFocused(true); track(e.currentTarget); },
    onBlur: () => setFocused(false),
  } : {};

  const assistantTagged = useMemo(
    () => enabled && assistantAllowed && mentionTokens(value, { assistantName: assistant.name, assistantAllowed, people, picked }).some((t) => t.kind === "assistant"),
    [enabled, assistantAllowed, value, assistant.name, people, picked],
  );

  return {
    /** Whether mentions are on in this box now (0041 is in and no voice note is being recorded). */
    on: enabled,
    open, listId, options, active, status, boxProps, onKeyDown, track, insert, setActiveKey, optionId, assistant,
    /** The tokens for `text` as it will be sent (only once 0041 is in). */
    tokens: (text: string): MentionToken[] => (enabled ? mentionTokens(text, { assistantName: assistant.name, assistantAllowed, people, picked }) : []),
    /** Whether the person's own assistant is tagged in what is written now (the hint line under the box). */
    assistantTagged,
    /** After a send: the picks and the list start again. */
    reset: () => { setPicked([]); setQuery(null); setClosed(null); setActiveKey(null); setMoved(false); },
  };
}

export type MentionAutocomplete = ReturnType<typeof useMentionAutocomplete>;

/**
 * The suggestions, above the composer's pill: the popover surface (r12, p4, the menu's shadow), at most 280px tall and
 * scrolling; rows 32px (40px on touch), r8, the chosen one on fill-1. Rendered inside the composer's `relative` box.
 */
export function MentionListbox({ ac }: { ac: MentionAutocomplete }) {
  // Before 0041 (and while a voice note records) the composer is exactly as it was: nothing here at all.
  if (!ac.on) return null;
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only">{ac.status}</p>
      {ac.open ? (
        <div className="popover-surface absolute bottom-full left-0 z-[var(--z-dropdown)] mb-2 max-h-[280px] w-[min(20rem,100%)] overflow-y-auto p-1" style={{ animation: "pop-in var(--duration-menu) var(--ease-out) both" }}>
          <ul id={ac.listId} role="listbox" aria-label={MENTION_WORDS.listboxLabel}>
            {ac.options.map((o) => {
              const selected = o.kind !== "off" && ac.active?.key === o.key;
              return (
                <li key={o.key} id={ac.optionId(o)} role="option" aria-selected={selected} aria-disabled={o.kind === "off" || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={o.kind === "off" ? undefined : () => { if (!selected) ac.setActiveKey(o.key); }}
                  onClick={o.kind === "off" ? undefined : () => ac.insert(o)}
                  className={cn("flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors duration-75 pointer-coarse:h-10",
                    o.kind === "off" ? "cursor-default text-subtle" : "cursor-pointer text-foreground", selected && "bg-fill-1")}>
                  {o.kind === "person" ? <>
                    <Avatar profileId={o.person.profileId} name={o.person.name} avatarKey={o.person.avatarKey} size={20} />
                    <span className="min-w-0 flex-1 truncate">{o.person.name}</span>
                    {ROLE[o.person.role] ? <span className="shrink-0 text-xs font-medium text-subtle">{ROLE[o.person.role]}</span> : null}
                  </> : <>
                    <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full bg-fill-1", o.kind === "off" && "opacity-60")}><BrendaFace size="sm" look={lookOf(ac.assistant)} quiet /></span>
                    {o.kind === "assistant" ? <>
                      <span className="min-w-0 flex-1 truncate">{ac.assistant.name}</span>
                      <span className="shrink-0 text-xs font-medium text-subtle">{MENTION_WORDS.assistantOption}</span>
                    </> : <span className="min-w-0 flex-1 truncate text-meta font-normal">{MENTION_WORDS.assistantOff}</span>}
                  </>}
                </li>
              );
            })}
          </ul>
          {ac.options.length === 0 ? <p className="px-2 py-1.5 text-meta font-normal text-secondary">{MENTION_WORDS.noMatch}</p> : null}
        </div>
      ) : null}
    </>
  );
}
