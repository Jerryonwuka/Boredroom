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
 *
 * Someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6, contract H.4): after the
 * person's own assistant and the people come the conversation's people's assistants (`Thread.taggable`), "Ben's Brenda"
 * with "Ben's assistant" beside it and THEIR assistant's 20px face (quiet: only the viewer's own face talks along). A
 * query matches the person's first, last or full name, their assistant's name, or the label as typed ("@Ben's B").
 * Rows: the own assistant (1), people up to 4 and others' assistants up to 3, either filling what the other leaves, 8 in
 * all. One whose owner switched tags off is a disabled row ("Ben isn't taking tags") once something typed matches it;
 * where assistants may not reply here, the one "Assistants can't reply in this conversation" row stands for them all.
 * A pick writes the server's label ("@Ben's Brenda ", or "@Ben Okafor's Brenda " when another reader is also called
 * Ben) and is sent as an `others_assistant` token. One assistant answers a message at most: the first assistant tag in
 * the text, own or someone else's; the server keeps the first assistant token it is given, so it goes first.
 *
 * Abilities (owner decisions, 8–9 October 2026: phase 7c): a person who switched "@mentions in Messages" off for their
 * own assistant (Settings → Your assistant → Abilities) is no longer offered it here (`OwnAssistantOffScope`, set by the
 * Messages page from the person's abilities), and the hint "Max replies here for everyone to see" does not show for it.
 * Typed in full it is still sent as a token, so the server's private note says why nothing answered and where to switch
 * it on ("You switched off @Max in Messages…"). Other people's assistants and people are offered as before.
 */
import { createContext, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode, type RefObject, type SyntheticEvent } from "react";
import { BrendaFace } from "@/components/app/brenda-face";
import { Avatar } from "@/components/ui/avatar";
import { lookOf, type AssistantProfile } from "@/lib/assistant-look";
import { assistantLabels, findLabelAll, mentionQueryAt, otherAssistantLabels, MENTION_LIMITS, MENTION_WORDS, type MentionToken, type TaggableAssistant } from "@/lib/mentions";
import { cn } from "@/lib/utils";

/** Someone in the conversation who can be mentioned (the person writing is left out by the page). */
export type MentionPerson = { membershipId: string; name: string; profileId: string; avatarKey: string | null; role: string };
/** What the composer knows about mentions here: whether migration 0041 is in, and whether the person's assistant may reply. */
export type ComposerMentions = { ready: boolean; assistantAllowed: boolean };
/** A pick from the list: a person, or someone else's assistant (phase 6), by the owner's membership. */
export type PickedMention = { membershipId: string; label: string; kind?: "person" | "others_assistant" };

const ROLE: Record<string, string> = { owner: "Owner", hr: "HR", manager: "Team lead", employee: "Staff" };
const MAX_ROWS = 8;
// Phase 6 (contract H.4): of the 8, people take up to 4 and others' assistants up to 3, then either fills the rest.
const PEOPLE_ROWS = 4;
const OTHER_ROWS = 3;
// The send schema's caps (contract B.2; phase 6 D.1): a longer label would refuse the whole message, so it is never sent.
const MAX_ASSISTANT_LABEL = 40;
const MAX_PERSON_LABEL = 121;
const MAX_OTHER_LABEL = 160;
/** No one else's assistant: before migration 0043, and wherever the page passes none. */
const NO_OTHERS: TaggableAssistant[] = [];

/**
 * Whether the person switched @mentions off for their own assistant (phase 7c, the `mentions` ability; contract C.3).
 * The Messages page sets it around the composer, so the composer needs no new prop; false everywhere else.
 */
const OwnAssistantOff = createContext(false);
export function OwnAssistantOffScope({ off, children }: { off: boolean; children: ReactNode }) {
  return <OwnAssistantOff.Provider value={off}>{children}</OwnAssistantOff.Provider>;
}

const lower = (s: string) => s.toLocaleLowerCase("en-GB");
/** Lowercased with curly apostrophes made straight: "@Ben’s" (a Mac's smart quote) is typed "@Ben's". */
const plain = (s: string) => lower(s).replace(/[’‘]/g, "'");

type Query = { start: number; query: string };
type Option =
  | { key: string; kind: "assistant"; label: string }
  | { key: string; kind: "person"; label: string; person: MentionPerson }
  | { key: string; kind: "other"; label: string; other: TaggableAssistant }
  | { key: string; kind: "off" }
  | { key: string; kind: "other_off"; other: TaggableAssistant };
type Selectable = Extract<Option, { kind: "assistant" | "person" | "other" }>;
const isSelectable = (o: Option): o is Selectable => o.kind === "assistant" || o.kind === "person" || o.kind === "other";

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
 * Every label of someone else's assistant that only one of them answers to (phase 6, contract D.1), lowercased once per
 * list: the one autocomplete inserts (`label`), then the rest the server accepts (`otherAssistantLabels`: the first-name
 * form only while no other reader shares the first name, always the full-name form), each also with curly apostrophes.
 * A label two assistants share (two Ben Okafors who both kept Brenda) counts only when picked, as for people.
 */
const OTHER_LABELS = new WeakMap<TaggableAssistant[], { key: string; label: string; other: TaggableAssistant }[]>();
function otherLabels(others: TaggableAssistant[]): { key: string; label: string; other: TaggableAssistant }[] {
  const cached = OTHER_LABELS.get(others);
  if (cached) return cached;
  // The server's rule for the short form: the first name is unique among the readers other than the sender, who are
  // exactly the people `taggable` lists.
  const firsts = new Map<string, number>();
  for (const o of others) { const f = lower(o.firstName.trim()); firsts.set(f, (firsts.get(f) ?? 0) + 1); }
  const byLabel = new Map<string, { label: string; list: TaggableAssistant[] }>();
  for (const o of others) {
    const unique = firsts.get(lower(o.firstName.trim())) === 1;
    const own = new Set<string>();
    for (const l of [o.label, ...otherAssistantLabels(o.personName, o.assistant.name, unique)].flatMap((x) => [x, x.replace(/'/g, "’")])) {
      const key = lower(l);
      if (l.length < 2 || l.length > MAX_OTHER_LABEL || own.has(key)) continue;
      own.add(key);
      const at = byLabel.get(key);
      if (at) at.list.push(o); else byLabel.set(key, { label: l, list: [o] });
    }
  }
  const out = [...byLabel].filter(([, v]) => v.list.length === 1).map(([key, v]) => ({ key, label: v.label, other: v.list[0] }));
  OTHER_LABELS.set(others, out);
  return out;
}

/** Whether what was typed after "@" finds someone else's assistant: the person's names, the assistant's, or the label. */
function otherMatches(o: TaggableAssistant, query: string): boolean {
  const q = plain(query.trim());
  return !q || nameMatches(o.personName, query) || nameMatches(o.assistant.name, query) || plain(o.label.slice(1)).startsWith(q);
}

/**
 * The mention tokens for a message about to be sent (contract F.1): the person's own assistant when it may reply here
 * and one of its labels stands in the text; people picked from the list whose label is still there; anyone in the
 * conversation whose "@" + full name was typed by hand. Where labels overlap the longest wins ("@Ben Okafor" is Ben
 * Okafor, not someone called Ben), a picked person wins over the assistant on the same label and the assistant over a
 * typed one; a name two people share counts only when picked.
 *
 * Phase 6 (contract D.1, H.4): someone else's assistant, picked or typed in full ("@Ben's Brenda"), as an
 * `others_assistant` token with its owner's membership, when assistants may reply here and its owner takes tags. Its
 * label still covers the "@Ben" inside it when it may not be sent, so Ben is not mentioned by a tag meant for his
 * assistant. At most one assistant token in all: the first assistant tag in the text, own or someone else's, first.
 */
export function mentionTokens(body: string, opts: { assistantName: string; assistantAllowed: boolean; people: MentionPerson[]; picked: PickedMention[]; others?: TaggableAssistant[] }): MentionToken[] {
  // No "@", no mention: this runs on every keystroke, over everyone in the conversation (review, 8 October 2026).
  if (!body.includes("@")) return [];
  // `token` null: a label that only covers its text (someone else's assistant that may not be tagged here).
  type Candidate = { label: string; rank: number; token: ((label: string) => MentionToken) | null };
  const candidates: Candidate[] = [];
  const others = opts.others ?? NO_OTHERS;
  const othersById = new Map(others.map((o) => [o.membershipId, o]));
  const taggable = (o: TaggableAssistant) => opts.assistantAllowed && o.allowed;
  const theirs = (o: TaggableAssistant) => (taggable(o) ? (label: string): MentionToken => ({ kind: "others_assistant", membershipId: o.membershipId, label }) : null);
  const pickedLabels = new Set(opts.picked.map((p) => lower(p.label)));
  for (const p of opts.picked) {
    if (p.kind === "others_assistant") {
      const o = othersById.get(p.membershipId);
      if (o && p.label.length <= MAX_OTHER_LABEL) candidates.push({ label: p.label, rank: 0, token: theirs(o) });
      continue;
    }
    if (p.label.length > MAX_PERSON_LABEL) continue;
    candidates.push({ label: p.label, rank: 0, token: (label) => ({ kind: "person", membershipId: p.membershipId, label }) });
  }
  if (opts.assistantAllowed) {
    for (const l of assistantLabels(opts.assistantName)) {
      if (l.length <= MAX_ASSISTANT_LABEL && !pickedLabels.has(lower(l))) candidates.push({ label: l, rank: 1, token: (label) => ({ kind: "assistant", label }) });
    }
  }
  const lowered = lower(body);
  // A quick look first (everyone in a big workspace is a candidate in Everyone, and this runs as the person types).
  for (const u of otherLabels(others)) {
    if (pickedLabels.has(u.key) || !lowered.includes(u.key)) continue;
    candidates.push({ label: u.label, rank: 2, token: theirs(u.other) });
  }
  for (const u of uniqueLabels(opts.people)) {
    if (pickedLabels.has(u.key) || !lowered.includes(u.key)) continue;
    const p = u.person;
    candidates.push({ label: u.label, rank: 3, token: (label) => ({ kind: "person", membershipId: p.membershipId, label }) });
  }
  candidates.sort((a, b) => b.label.length - a.label.length || a.rank - b.rank);
  // Each label found is blanked out of a working copy, so a shorter label inside it is not found again.
  let masked = body;
  const found: { at: number; token: MentionToken }[] = [];
  // Where each one was first found: the same assistant under two labels ("@Max … @assistant") stands where it first does.
  const seen = new Map<string, { at: number; token: MentionToken }>();
  for (const c of candidates) {
    if (!lowered.includes(lower(c.label))) continue;
    const at = findLabelAll(masked, c.label);
    if (!at.length) continue;
    for (const i of at) masked = masked.slice(0, i) + " ".repeat(c.label.length) + masked.slice(i + c.label.length);
    if (!c.token) continue;
    const token = c.token(spelling(body, at[0], c.label));
    const key = token.kind === "assistant" ? "assistant" : token.kind === "others_assistant" ? `assistant:${token.membershipId}` : token.membershipId;
    const before = seen.get(key);
    if (before) { before.at = Math.min(before.at, at[0]); continue; }
    const f = { at: at[0], token };
    seen.set(key, f);
    found.push(f);
  }
  // One assistant answers: the first assistant tag in the text goes first, the others are not sent; then people in the
  // order the server reads them.
  const assistant = found.filter((f) => f.token.kind !== "person").sort((a, b) => a.at - b.at)[0];
  const out = [...(assistant ? [assistant.token] : []), ...found.filter((f) => f.token.kind === "person").map((f) => f.token)];
  return out.slice(0, MENTION_LIMITS.tokensPerMessage);
}

/**
 * The autocomplete's state for one composer box. `value`/`setValue` are the composer's own text; `boxRef` its textarea.
 * `onInserted` runs after a pick has been written in (the composer grows the box to fit). `others`: the conversation's
 * people's assistants (phase 6; none before migration 0043).
 */
export function useMentionAutocomplete({ enabled, value, setValue, boxRef, people, assistant, assistantAllowed, others = NO_OTHERS, onInserted }: {
  enabled: boolean; value: string; setValue: (v: string) => void; boxRef: RefObject<HTMLTextAreaElement | null>;
  people: MentionPerson[]; assistant: AssistantProfile; assistantAllowed: boolean; others?: TaggableAssistant[]; onInserted?: (el: HTMLTextAreaElement) => void;
}) {
  const listId = useId();
  // Phase 7c: the person's own assistant is not offered while they switched @mentions off for it.
  const ownOff = useContext(OwnAssistantOff);
  const [query, setQuery] = useState<Query | null>(null);
  const [focused, setFocused] = useState(false);
  // A list closed with Escape stays closed for that "@" (query null), and one just picked from stays closed until the
  // text after its "@" changes (so backspacing into it offers the list again).
  const [closed, setClosed] = useState<{ start: number; query: string | null } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const caretAfter = useRef<number | null>(null);
  const labels = useMemo(() => assistantLabels(assistant.name), [assistant.name]);
  // Sorted once per list, so a bare "@" in a big Everyone does not sort the whole organisation on each keystroke.
  const sortedPeople = useMemo(() => [...people].sort((a, b) => a.name.localeCompare(b.name, "en-GB")), [people]);
  const sortedOthers = useMemo(() => [...others].sort((a, b) => a.personName.localeCompare(b.personName, "en-GB")), [others]);

  const options = useMemo<Option[]>(() => {
    if (!query) return [];
    const out: Option[] = [];
    const q = lower(query.query.trim());
    const meMatches = !q || labels.some((l) => lower(l.slice(1)).startsWith(q));
    // Others' assistants that match (phase 6). Where assistants may not reply here, finding one is enough: the one
    // "Assistants can't reply" row stands for them all. One whose owner switched tags off shows once something typed
    // matches it, never on a bare "@".
    const theirs: TaggableAssistant[] = [];
    let theirsMatch = false;
    for (const o of sortedOthers) {
      if (theirs.length >= MAX_ROWS) break;
      if (!otherMatches(o, query.query)) continue;
      theirsMatch = true;
      if (!assistantAllowed) break;
      if (o.allowed || q) theirs.push(o);
    }
    if (meMatches && assistantAllowed && !ownOff) out.push({ key: "assistant", kind: "assistant", label: labels[0] });
    else if (!assistantAllowed && q && (meMatches || theirsMatch)) out.push({ key: "off", kind: "off" });
    const matches: MentionPerson[] = [];
    for (const p of sortedPeople) { if (matches.length >= MAX_ROWS) break; if (nameMatches(p.name, query.query)) matches.push(p); }
    // People up to 4 and others' assistants up to 3, then either fills what the other left, 8 rows in all.
    let spare = MAX_ROWS - out.length;
    let nPeople = Math.min(matches.length, PEOPLE_ROWS, spare);
    let nTheirs = Math.min(theirs.length, OTHER_ROWS, spare - nPeople);
    spare -= nPeople + nTheirs;
    const morePeople = Math.min(spare, matches.length - nPeople);
    nPeople += morePeople;
    nTheirs += Math.min(spare - morePeople, theirs.length - nTheirs);
    for (const p of matches.slice(0, nPeople)) out.push({ key: p.membershipId, kind: "person", label: `@${p.name.trim()}`, person: p });
    for (const o of theirs.slice(0, nTheirs)) {
      out.push(o.allowed ? { key: `assistant-${o.membershipId}`, kind: "other", label: o.label, other: o } : { key: `assistant-${o.membershipId}`, kind: "other_off", other: o });
    }
    return out;
  }, [query, labels, assistantAllowed, ownOff, sortedPeople, sortedOthers]);
  const selectable = options.filter(isSelectable);
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
    if (o.kind === "person") setPicked((list) => [...list.filter((p) => p.kind === "others_assistant" || p.membershipId !== o.person.membershipId), { kind: "person", membershipId: o.person.membershipId, label: o.label }]);
    if (o.kind === "other") setPicked((list) => [...list.filter((p) => p.kind !== "others_assistant" || p.membershipId !== o.other.membershipId), { kind: "others_assistant", membershipId: o.other.membershipId, label: o.label }]);
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
          // Only "Assistants can't reply here" (or "Ben isn't taking tags", phase 6) is showing: the person was reaching
          // for an assistant, so Enter closes the list instead of sending a half-typed "@m" (review, 8 October 2026).
          // "No one by that name" still sends.
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

  // What the polite status says: the chosen row once the person moves, else how many there are; with only a disabled
  // row, why ("Assistants can't reply in this conversation", or "Ben isn't taking tags").
  const said = (o: Selectable) => (o.kind === "assistant" ? `${assistant.name}, ${MENTION_WORDS.assistantOption}`
    : o.kind === "person" ? o.person.name : `${o.label.slice(1)}, ${MENTION_WORDS.otherAssistantSecondary(o.other.firstName)}`);
  const offRow = options.find((o) => o.kind === "off" || o.kind === "other_off");
  const offSaid = offRow?.kind === "other_off" ? MENTION_WORDS.otherOff(offRow.other.firstName) : MENTION_WORDS.assistantOff;
  const status = !open ? "" : selectable.length ? (moved && active ? said(active) : MENTION_WORDS.suggestions(selectable.length)) : options.length ? offSaid : MENTION_WORDS.noMatch;

  /** Props for the textarea: the combobox state, and the handlers that keep the query in step with the caret. */
  const boxProps = enabled ? {
    "aria-autocomplete": "list" as const, "aria-haspopup": "listbox" as const, "aria-expanded": open,
    "aria-controls": open ? listId : undefined, "aria-activedescendant": activeId,
    onSelect: (e: SyntheticEvent<HTMLTextAreaElement>) => track(e.currentTarget),
    onFocus: (e: FocusEvent<HTMLTextAreaElement>) => { setFocused(true); track(e.currentTarget); },
    onBlur: () => setFocused(false),
  } : {};

  // The assistant that answers what is written now, if any (the hint line under the box): the server keeps the first
  // assistant token, which mentionTokens puts first.
  const tagged = useMemo(() => {
    if (!enabled || !assistantAllowed) return null;
    const first = mentionTokens(value, { assistantName: assistant.name, assistantAllowed, people, picked, others })[0];
    return first && first.kind !== "person" ? first : null;
  }, [enabled, assistantAllowed, value, assistant.name, people, picked, others]);
  const otherTagged = tagged?.kind === "others_assistant" ? (others.find((o) => o.membershipId === tagged.membershipId) ?? null) : null;

  return {
    /** Whether mentions are on in this box now (0041 is in and no voice note is being recorded). */
    on: enabled,
    open, listId, options, active, status, boxProps, onKeyDown, track, insert, setActiveKey, optionId, assistant,
    /** The tokens for `text` as it will be sent (only once 0041 is in). */
    tokens: (text: string): MentionToken[] => (enabled ? mentionTokens(text, { assistantName: assistant.name, assistantAllowed, people, picked, others }) : []),
    /** Whether the person's own assistant is tagged in what is written now (the hint line under the box). */
    assistantTagged: tagged?.kind === "assistant" && !ownOff,
    /** Someone else's assistant tagged in what is written now (phase 6: "Ben's Brenda answers here …"), or null. */
    otherTagged,
    /** After a send: the picks and the list start again. */
    reset: () => { setPicked([]); setQuery(null); setClosed(null); setActiveKey(null); setMoved(false); },
  };
}

export type MentionAutocomplete = ReturnType<typeof useMentionAutocomplete>;

/** An assistant's 20px face on a fill-1 disc, quiet (it never talks along); dimmed on a disabled row. */
function RowFace({ look, off = false }: { look: AssistantProfile; off?: boolean }) {
  return <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full bg-fill-1", off && "opacity-60")}><BrendaFace size="sm" look={lookOf(look)} quiet /></span>;
}

/** One row's contents: the picture or face, the name, and what it is in the quiet colour on the right. */
function OptionRow({ o, own }: { o: Option; own: AssistantProfile }) {
  switch (o.kind) {
    case "person": return <>
      <Avatar profileId={o.person.profileId} name={o.person.name} avatarKey={o.person.avatarKey} size={20} />
      <span className="min-w-0 flex-1 truncate">{o.person.name}</span>
      {ROLE[o.person.role] ? <span className="shrink-0 text-xs font-medium text-subtle">{ROLE[o.person.role]}</span> : null}
    </>;
    case "assistant": return <>
      <RowFace look={own} />
      <span className="min-w-0 flex-1 truncate">{own.name}</span>
      <span className="shrink-0 text-xs font-medium text-subtle">{MENTION_WORDS.assistantOption}</span>
    </>;
    // Someone else's assistant (phase 6): THEIR assistant's face, "Ben's Brenda" (the label it writes in), "Ben's assistant".
    case "other": return <>
      <RowFace look={o.other.assistant} />
      <span className="min-w-0 flex-1 truncate">{o.label.slice(1)}</span>
      <span className="max-w-[45%] shrink-0 truncate text-xs font-medium text-subtle">{MENTION_WORDS.otherAssistantSecondary(o.other.firstName)}</span>
    </>;
    case "other_off": return <>
      <RowFace look={o.other.assistant} off />
      <span className="min-w-0 flex-1 truncate text-meta font-normal">{MENTION_WORDS.otherOff(o.other.firstName)}</span>
    </>;
    case "off": return <>
      <RowFace look={own} off />
      <span className="min-w-0 flex-1 truncate text-meta font-normal">{MENTION_WORDS.assistantOff}</span>
    </>;
  }
}

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
              const can = isSelectable(o);
              const selected = can && ac.active?.key === o.key;
              return (
                <li key={o.key} id={ac.optionId(o)} role="option" aria-selected={selected} aria-disabled={!can || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={can ? () => { if (!selected) ac.setActiveKey(o.key); } : undefined}
                  onClick={can ? () => ac.insert(o) : undefined}
                  className={cn("flex h-8 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors duration-75 pointer-coarse:h-10",
                    can ? "cursor-pointer text-foreground" : "cursor-default text-subtle", selected && "bg-fill-1")}>
                  <OptionRow o={o} own={ac.assistant} />
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
