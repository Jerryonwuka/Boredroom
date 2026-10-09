"use client";

/**
 * The person's standup, waiting for their approval (owner decisions, 8–9 October 2026: phase 7c, async standup option
 * B; contract B.4 and G.2). At the team's time (09:30 by default, on the organisation's clock) the person's own
 * assistant drafts their update from their real work: Yesterday (or "Since Friday" after a weekend), Today and Blocked,
 * each line with its links. Nothing is posted until the person presses Post: that press is their consent (the act-mode
 * floor for anything to a whole team), and the update goes to the team's channel as theirs, "via Max".
 *
 * The card (her page's "Waiting for you" and /home/standup):
 * - Her small face, "Your standup for Design", the day, a status badge with a word (never orange).
 * - The three sections as labelled lists. Each drafted line ends with its sources ("task", "message"…,
 *   lib/evidence-links, built from ids only); a line the person rewrote loses its links (one left as drafted keeps them:
 *   lib/standup entryLines), and a "Sources" disclosure keeps every drafted line's sources.
 * - The readback: "Posts to #Design (6 people) as you, sent by Max." and "Rollup to David at 12:00." ("No lead: nobody
 *   receives the rollup.").
 * - **Post to #Design**, the card's one standout (orange) when `standout` (a page with two drafts, or her page while her
 *   box has text and its Send is orange, keeps the others white: never two orange buttons on a screen); **Edit**
 *   (secondary) swaps the lists for three labelled text boxes with counters (1,200 characters each; Save, Cancel, Escape
 *   cancels); **Skip today** (ghost): "Skipped. The rollup lists you under No update, like anyone who didn't post." with
 *   Undo until the cutoff.
 * - After Post: "Posted to #Design at 09:41" and Open (the message). Failed: "Max couldn't draft your standup for Design
 *   today. You can still write one in #Design." and Open channel. No reminder, no second nudge, ever.
 *
 * What a press did is announced (`aria-live="polite"`) and the focus moves to what replaced the pressed button (Undo
 * after Skip, Open after Post, Edit after Undo), else to the card; a refusal shows the server's words. Opening a ready card marks
 * it seen (POST …/seen, once per page). The card keeps what a press left until the page brings a newer copy, so a
 * posted or skipped card stays on screen after the list no longer lists it (`StandupWaiting`). The words the card shows
 * are B.4's, held here (lib/standup's STANDUP_WORDS carries the same sentences for the notch and the chat).
 */
import { Fragment, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AnimatedArrowUpRight, AnimatedRotateCcw, AnimatedSend } from "@/components/ui/animated-icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { BrendaFace } from "@/components/app/brenda-face";
import { useAssistant } from "@/components/app/assistant-context";
import { StandupRollupCard } from "@/components/app/standup-rollup-card";
import { api, isApiFailure } from "@/lib/api-client";
import { EVIDENCE_WORDS, evidenceHref, type EvidenceRef } from "@/lib/evidence-links";
import { STANDUP_LIMITS, STANDUP_SECTIONS, STANDUP_WORDS, cleanSection, clockOf, entryLines, type StandupEntryView, type StandupRollupView, type StandupSection, type StandupStatus, type StandupTexts } from "@/lib/standup";
import { cn } from "@/lib/utils";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const MAX = STANDUP_LIMITS.sectionMax;

/** The server's words for a refusal; for anything else, that nothing changed. */
function failureText(err: unknown): string {
  if (isApiFailure(err)) return err.error.status >= 500 && err.error.code !== "NOT_READY" ? "Something went wrong. Nothing was changed; try again." : err.error.message;
  return OFFLINE;
}

const SW = STANDUP_WORDS;
/** A status in a badge: never orange (accent rules), a word always (lib/standup's words). */
const TONE: Record<StandupStatus, "neutral" | "success" | "danger"> = {
  drafting: "neutral", ready: "neutral", posted: "success", skipped: "neutral", missed: "neutral", failed: "danger", cancelled: "neutral",
};

/** The card's words: lib/standup's (contract B.4), and the few only the web card says. */
export const STANDUP_CARD_WORDS = {
  title: SW.card.title,
  post: SW.card.post,
  posted: (team: string, at: string) => (at ? SW.results.posted(team, at) : `Posted to #${team}`),
  postedLate: (cutoff: string) => (cutoff ? `It came after ${cutoff}, so the rollup lists it as a late post.` : "It came after the cutoff, so the rollup lists it as a late post."),
  skipped: SW.results.skipped,
  unskipped: SW.results.unskipped,
  saved: SW.results.saved,
  failed: SW.results.failed,
  drafting: SW.card.drafting,
  missed: SW.results.missed,
  cancelled: SW.results.cancelled,
  readback: SW.card.readback,
  rollup: SW.card.rollupTo,
  editHint: "Lines you change lose their links; Sources keeps them all.",
  empty: SW.errors.empty,
  tooLong: SW.errors.tooLong,
  leftOut: "Left out",
  nothing: SW.empty.blocked,
} as const;
const W = STANDUP_CARD_WORDS;

/** A drafted or edited line, without the "- " a standup's lines start with. */
const bare = (line: string) => line.replace(/^\s*[-•]\s+/, "").trim();

/** A line's sources: " (task, message)", at most three, each page once, as small links (lib/evidence-links). */
export function StandupSources({ refs, orgSlug, about }: { refs: EvidenceRef[]; orgSlug: string; about: string }) {
  const links: { href: string; word: string }[] = [];
  for (const ref of refs) {
    if (links.length >= 3) break;
    const href = evidenceHref(orgSlug, ref);
    if (!href || links.some((l) => l.href === href)) continue;
    links.push({ href, word: EVIDENCE_WORDS[ref.kind] });
  }
  if (!links.length) return null;
  const short = about.length > 80 ? `${about.slice(0, 79).trimEnd()}…` : about;
  return (
    <span className="text-secondary">
      {" ("}
      {links.map((l, i) => (
        <Fragment key={l.href}>
          {i ? ", " : null}
          <Link href={l.href} prefetch={false} className="link-inline">{l.word}<span className="sr-only">, for {short}</span></Link>
        </Fragment>
      ))}
      {")"}
    </span>
  );
}

/** Marked seen once per page, whatever re-renders (the server answers 'ok' again anyway). */
const seenEntries = new Set<string>();
function markEntrySeen(orgSlug: string, id: string) {
  if (seenEntries.has(id)) return;
  seenEntries.add(id);
  api(`/api/orgs/${orgSlug}/standup/entries/${id}/seen`, { method: "POST", retries: 1 }).catch(() => seenEntries.delete(id));
}

type Press = "post" | "skip" | "unskip" | "save";

export function StandupCard({ orgSlug, entry: given, timeZone, standout = true, highlight = false, className, onChange }: {
  orgSlug: string; entry: StandupEntryView; timeZone: string;
  /** Post is the screen's one orange button; false keeps it white (another draft or her Send already is). */ standout?: boolean;
  /** The standup a link pointed at (`?e=`, the notification): a 1px orange border, scrolled to and focused. */ highlight?: boolean;
  className?: string;
  /** After a press changed it, with the entry as it is now. */ onChange?: (e: StandupEntryView) => void;
}) {
  const { personal } = useAssistant();
  const uid = useId();
  const titleId = `${uid}-title`;
  const cardId = `standup-${given.id}`;
  // What a press left, until the page brings a newer copy of the entry.
  const [local, setLocal] = useState<{ from: StandupEntryView; view: StandupEntryView } | null>(null);
  const e = local && local.from === given ? local.view : given;
  const [busy, setBusy] = useState<Press | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  // What Post answered ("Posted to #Design at 09:41" and the message), kept once the page's copy catches up.
  const [result, setResult] = useState<{ text: string; href: string | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StandupTexts>({ yesterday: "", today: "", blocked: "" });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const openLink = useRef<HTMLAnchorElement>(null);
  // Where the focus goes once a press's result is on screen (the pressed button is gone by then).
  const focusWant = useRef<"undo" | "open" | "edit" | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const setFocusNext = (to: "undo" | "open" | "edit") => { focusWant.current = to; setFocusTick((n) => n + 1); };
  const channel = e.postTo.name;
  // The organisation's clock: the entry's own zone when the server sends it, else the page's.
  const tz = e.timeZone ?? timeZone;
  const cutoff = clockOf(e.cutoffAt, tz);

  // A ready (or failed) standup the person opens is seen.
  useEffect(() => { if (!e.seen && (e.status === "ready" || e.status === "failed")) markEntrySeen(orgSlug, e.id); }, [orgSlug, e.id, e.seen, e.status]);
  // The one a link pointed at comes into view and takes the focus.
  useEffect(() => {
    if (!highlight) return;
    const el = document.getElementById(cardId);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    el.focus({ preventScroll: true });
  }, [highlight, cardId]);

  const took = (v: StandupEntryView) => { setLocal({ from: given, view: v }); onChange?.(v); };
  // After the render that showed a press's result: Undo, Open or Edit when there, else the card itself (fix review,
  // 9 October 2026: the focus fell to the page when the pressed button went).
  useEffect(() => {
    const want = focusWant.current;
    if (!want) return;
    focusWant.current = null;
    const el = want === "undo" ? undoButton.current : want === "open" ? openLink.current : editButton.current;
    (el ?? document.getElementById(cardId))?.focus();
  }, [focusTick, cardId]);

  /** The entry as it is now, after a press found it moved on (posted elsewhere, skipped, past its day). */
  async function reload() {
    try { took(await api<StandupEntryView>(`/api/orgs/${orgSlug}/standup/entries/${e.id}`)); } catch { /* the card keeps what it has */ }
  }

  async function press(kind: Press, run: () => Promise<void>) {
    if (busy) return;
    setBusy(kind); setError(null); setSaid("");
    try { await run(); }
    catch (err) {
      setError(failureText(err));
      if (isApiFailure(err) && (err.error.status === 409 || err.error.status === 404)) void reload();
    } finally { setBusy(null); }
  }

  const post = () => press("post", async () => {
    // One key per press: a retry after a lost answer returns the same post, and the server never posts twice anyway.
    const r = await api<{ entry: StandupEntryView; message: { id: string; conversationId: string; href: string }; already?: true }>(`/api/orgs/${orgSlug}/standup/entries/${e.id}/post`, { method: "POST" });
    took(r.entry);
    const text = W.posted(r.entry.team.name, clockOf(r.entry.posted?.at, tz));
    setResult({ text, href: r.entry.posted?.href ?? r.message?.href ?? null });
    setSaid(text);
    setFocusNext("open");
  });
  const skip = () => press("skip", async () => {
    took(await api<StandupEntryView>(`/api/orgs/${orgSlug}/standup/entries/${e.id}/skip`, { method: "POST" }));
    setSaid(W.skipped);
    setFocusNext("undo");
  });
  const unskip = () => press("unskip", async () => {
    const v = await api<StandupEntryView>(`/api/orgs/${orgSlug}/standup/entries/${e.id}/unskip`, { method: "POST" });
    took(v);
    setSaid(v.status === "ready" ? W.unskipped : W.drafting(personal.name));
    setFocusNext("edit");
  });

  const startEdit = () => {
    const t = e.texts ?? { yesterday: "", today: "", blocked: "" };
    setDraft({ yesterday: t.yesterday ?? "", today: t.today ?? "", blocked: t.blocked ?? "" });
    setFieldError(null); setError(null); setEditing(true);
  };
  const cancelEdit = () => { setEditing(false); setFieldError(null); requestAnimationFrame(() => editButton.current?.focus()); };
  const save = () => {
    const texts: StandupTexts = { yesterday: cleanSection(draft.yesterday), today: cleanSection(draft.today), blocked: cleanSection(draft.blocked) };
    if (!texts.yesterday && !texts.today && !texts.blocked) { setFieldError(W.empty); return; }
    if (STANDUP_SECTIONS.some((s) => texts[s].length > MAX)) { setFieldError(W.tooLong); return; }
    setFieldError(null);
    void press("save", async () => {
      took(await api<StandupEntryView>(`/api/orgs/${orgSlug}/standup/entries/${e.id}`, { method: "PATCH", body: texts }));
      setEditing(false); setSaid(W.saved);
      requestAnimationFrame(() => editButton.current?.focus());
    });
  };

  const heading = (s: StandupSection) => (s === "yesterday" ? e.sinceLabel || SW.card.yesterday : s === "today" ? SW.card.today : SW.card.blocked);
  const badge = { label: SW.card.status[e.status] ?? SW.card.status.ready, tone: TONE[e.status] ?? "neutral" };
  const ready = e.status === "ready";
  const showLists = (ready || e.status === "posted" || e.status === "skipped") && !!e.texts;

  const sections = (
    <div className="grid gap-3">
      {STANDUP_SECTIONS.map((s) => {
        // Drafted lines with their links; after an edit the person's lines, a line left as drafted keeping its links.
        const lines = entryLines(e, s);
        const hid = `${uid}-${s}`;
        return (
          <section key={s} aria-labelledby={hid} className="min-w-0">
            <h4 id={hid} className="text-meta font-medium text-secondary">{heading(s)}</h4>
            {lines.length ? (
              <ul className="mt-1 list-disc space-y-1 pl-[1.25em] text-sm font-normal text-foreground marker:text-secondary">
                {lines.map((l, i) => (
                  <li key={i} className="whitespace-pre-wrap break-words">{l.text}{l.refs.length ? <StandupSources refs={l.refs} orgSlug={orgSlug} about={l.text} /> : null}</li>
                ))}
              </ul>
            ) : <p className="mt-1 text-sm font-normal text-subtle">{s === "blocked" ? W.nothing : W.leftOut}</p>}
          </section>
        );
      })}
      {/* Edited: every drafted line's sources, behind a disclosure. */}
      {e.edited && e.draft ? (
        <details className="group text-meta">
          <summary className="w-fit cursor-pointer rounded-sm font-medium text-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{SW.card.sources}</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-[1.25em] font-normal text-secondary marker:text-subtle">
            {STANDUP_SECTIONS.flatMap((s) => e.draft!.sections[s].filter((l) => l.refs.length).map((l, i) => (
              <li key={`${s}-${i}`} className="break-words">{bare(l.text)}<StandupSources refs={l.refs} orgSlug={orgSlug} about={bare(l.text)} /></li>
            )))}
          </ul>
        </details>
      ) : null}
    </div>
  );

  const editor = (
    <form className="grid gap-3" noValidate onSubmit={(ev) => { ev.preventDefault(); save(); }}
      onKeyDown={(ev) => { if (ev.key === "Escape" && !busy) { ev.preventDefault(); cancelEdit(); } }}>
      {STANDUP_SECTIONS.map((s, i) => {
        const fid = `${uid}-edit-${s}`;
        const n = draft[s].length;
        return (
          <Field key={s} label={heading(s)} htmlFor={fid}
            description={<span className={cn("tabular-nums", n > MAX && "text-danger")}>{n.toLocaleString("en-GB")} of {MAX.toLocaleString("en-GB")}</span>}>
            <Textarea id={fid} rows={3} className="min-h-20 w-full" value={draft[s]} disabled={busy === "save"} autoFocus={i === 0}
              onChange={(ev) => setDraft((d) => ({ ...d, [s]: ev.target.value }))} />
          </Field>
        );
      })}
      <p className="text-meta font-normal text-secondary">{W.editHint}</p>
      {fieldError ? <p role="alert" className="text-meta font-medium text-danger">{fieldError}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy === "save"} onClick={cancelEdit}>{SW.card.cancel}</Button>
        <Button type="submit" variant="primary" size="sm" loading={busy === "save"}>{busy === "save" ? "Saving…" : SW.card.save}</Button>
      </div>
    </form>
  );

  const conversationHref = e.postTo.conversationId ? evidenceHref(orgSlug, { kind: "conversation", id: e.postTo.conversationId }) : null;
  const postedHref = e.posted?.href ?? (e.posted?.messageId && e.postTo.conversationId ? evidenceHref(orgSlug, { kind: "message", id: e.posted.messageId, conversationId: e.postTo.conversationId }) : null);
  // The line under the lists once something happened (or the state the card arrived in).
  const outcome = e.status === "posted"
    ? { text: result?.text ?? W.posted(e.team.name, clockOf(e.posted?.at, tz)), href: result?.href ?? postedHref, open: SW.card.open, tone: "success" as const, late: !!e.posted?.late }
    : e.status === "skipped" ? { text: W.skipped, href: null, open: "", tone: "neutral" as const, late: false }
    : e.status === "failed" ? { text: W.failed(personal.name, e.team.name), href: conversationHref, open: SW.card.openChannel, tone: "neutral" as const, late: false }
    : e.status === "missed" ? { text: W.missed, href: null, open: "", tone: "neutral" as const, late: false }
    : e.status === "cancelled" ? { text: W.cancelled, href: null, open: "", tone: "neutral" as const, late: false }
    : null;

  return (
    <article id={cardId} tabIndex={-1} aria-labelledby={titleId}
      className={cn("card-panel flex min-w-0 flex-col gap-3 p-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", highlight && "border-accent-ring", className)}>
      <div className="flex items-start gap-2.5">
        <BrendaFace size="sm" className="mt-px" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <h3 id={titleId} className="min-w-0 flex-[1_1_12rem] break-words text-sm font-medium text-foreground">
              {W.title(e.team.name)}<span className="font-normal text-secondary">, {e.dateLabel}</span>
            </h3>
            <Badge tone={badge.tone} className="shrink-0">{badge.label}</Badge>
          </div>
          {e.status === "drafting" ? <p className="brenda-shimmer mt-1 text-meta font-normal text-secondary">{W.drafting(personal.name)}</p> : null}
        </div>
      </div>

      {showLists ? (editing && ready ? editor : sections) : null}

      {ready && !editing ? (
        <div className="space-y-0.5 text-meta font-normal text-secondary">
          <p>{W.readback(channel, e.postTo.members, personal.name)}</p>
          <p>{e.youLead ? SW.card.rollupToYou(e.otherLeads ?? [], cutoff) : W.rollup(e.leads, cutoff)}</p>
          {e.edited ? <p>{SW.card.edited}</p> : null}
        </div>
      ) : null}

      {outcome ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className={cn("min-w-0 flex-[1_1_14rem] break-words text-meta font-normal", outcome.tone === "success" ? "text-success" : "text-secondary")}>
            {outcome.text}{outcome.late ? <span className="text-secondary"> {W.postedLate(cutoff)}</span> : null}
          </p>
          <span className="flex shrink-0 items-center gap-1">
            {e.status === "skipped" && e.canUnskip ? <Button ref={undoButton} variant="ghost" size="xs" loading={busy === "unskip"} onClick={() => void unskip()} aria-label="Undo skipping today's standup"><AnimatedRotateCcw aria-hidden />{SW.card.undo}</Button> : null}
            {outcome.href ? <Link ref={openLink} href={outcome.href} prefetch={false} className={buttonVariants({ variant: "ghost", size: "xs" })}>{outcome.open}<AnimatedArrowUpRight aria-hidden /></Link> : null}
          </span>
        </div>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {ready && !editing ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={!!busy} loading={busy === "skip"} onClick={() => void skip()}>{SW.card.skip}</Button>
          <Button ref={editButton} variant="secondary" size="sm" disabled={!!busy} onClick={startEdit}>{SW.card.edit}</Button>
          {/* The card's one standout (accent rules): posting is the person's consent, and nothing posts without it. */}
          <Button variant={standout ? "accent" : "primary"} size="sm" disabled={!!busy && busy !== "post"} loading={busy === "post"} onClick={() => void post()}>
            <AnimatedSend aria-hidden />{busy === "post" ? "Posting…" : W.post(e.team.name)}
          </Button>
        </div>
      ) : null}
      {/* Only the result of a press is announced. */}
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </article>
  );
}

/**
 * Today's standups on her page, inside "Waiting for you" (contract G.2): one card per draft ready to post, then the
 * lead's rollups not yet seen as compact rows with Open. A card the person posted or skipped here stays on screen after
 * the page refreshes without it, so they see it went (as the follow-up asks do). Renders nothing when there is nothing.
 */
export function StandupWaiting({ orgSlug, entries, rollups, timeZone, standout, cardClassName, className }: {
  orgSlug: string; entries: StandupEntryView[]; rollups: StandupRollupView[]; timeZone: string;
  /** Whether the first draft's Post may be orange (her box's Send is not orange right now). */ standout: boolean;
  cardClassName?: string; className?: string;
}) {
  const [acted, setActed] = useState<StandupEntryView[]>([]);
  const live = entries.map((x) => x.id);
  const shown = [...entries, ...acted.filter((a) => !live.includes(a.id))];
  if (!shown.length && !rollups.length) return null;
  const firstReady = shown.find((x) => x.status === "ready")?.id;
  return (
    <ul className={cn("space-y-2", className)}>
      {shown.map((x) => (
        <li key={`e-${x.id}`}>
          <StandupCard orgSlug={orgSlug} entry={acted.find((a) => a.id === x.id && !live.includes(a.id)) ?? x} timeZone={timeZone}
            standout={standout && x.id === firstReady} className={cardClassName}
            onChange={(v) => setActed((cur) => [...cur.filter((a) => a.id !== v.id), v])} />
        </li>
      ))}
      {rollups.map((r) => (
        <li key={`r-${r.id}`}><StandupRollupCard orgSlug={orgSlug} rollup={r} timeZone={timeZone} compact className={cardClassName} /></li>
      ))}
    </ul>
  );
}
