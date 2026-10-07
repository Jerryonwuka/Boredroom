"use client";

/**
 * Docs, the editor (owner decision, 5 October 2026). v4: a clean writing surface. The title in the display face
 * (28/36), a byline, one quiet toolbar on hairlines (folder, who can see it, the pin, Edit and Preview), then the text
 * in Markdown on a calm r16 surface whose hairline firms up while you write. Nothing to press: every change saves itself
 * a second after you pause, carrying the version it was based on, so two people (or a person and Brenda) never write
 * over each other unseen. If the document changed elsewhere, the editor stops and asks whose version to keep.
 * People who can read but not change a document get the reading view only.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, Check, CircleAlert, Eye, Folder, Globe, LoaderCircle, Lock, Pencil, Pin, Users } from "lucide-react";
import { AnimatedArrowLeft } from "@/components/ui/animated-icons";
import { Button, buttonVariants } from "@/components/ui/button";
import { InputAdorned, Select } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton, ConfirmDialog } from "@/components/ui/confirm";
import { Markdown } from "@/components/app/docs-markdown";
import { VisibilityBadge, updatedLabel } from "@/components/app/docs-library";
import { successToast } from "@/components/ui/toast";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { Doc } from "@/server/services/docs";

type Visibility = Doc["visibility"];
type Draft = { title: string; body: string; folder: string; visibility: Visibility; teamId: string | null; pinned: boolean };
type Status = "saved" | "dirty" | "saving" | "error" | "conflict";
type Patch = { title?: string; body?: string; folder?: string | null; visibility?: Visibility; teamId?: string | null; pinned?: boolean };

// The service's limits (DOC_TITLE_MAX and friends), restated: importing them would pull server code into the page.
const TITLE_MAX = 200;
const BODY_MAX = 200_000;
const FOLDER_MAX = 80;

const toIso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));
const fromDoc = (d: Doc): Draft => ({ title: d.title, body: d.body ?? "", folder: d.folder ?? "", visibility: d.visibility, teamId: d.teamId ?? null, pinned: d.pinned });

/** One line, single spaces: how the server stores titles and folder names, so a draft compares equal once saved. */
const oneLine = (v: string) => v.replace(/\s+/g, " ").trim();

/** What differs between the draft and the last saved version, in the API's shape. A blank title is never sent. */
function changes(d: Draft, s: Draft): Patch {
  const out: Patch = {};
  const title = oneLine(d.title);
  if (title && title !== s.title) out.title = title;
  if (d.body !== s.body) out.body = d.body;
  const folder = oneLine(d.folder) || null;
  if (folder !== (oneLine(s.folder) || null)) out.folder = folder;
  if (d.visibility !== s.visibility || (d.visibility === "team" && d.teamId !== s.teamId)) {
    out.visibility = d.visibility;
    out.teamId = d.visibility === "team" ? d.teamId : null;
  }
  if (d.pinned !== s.pinned) out.pinned = d.pinned;
  return out;
}

const failure = (err: unknown) => (isApiFailure(err) ? err.error.message : "Cannot reach the server. Check your connection; your text is still here.");

/** Grows a textarea with its text. Native where the browser can (field-sizing), measured where it cannot. */
function useAutoSize(ref: React.RefObject<HTMLTextAreaElement | null>, value: string, active = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !active || (typeof CSS !== "undefined" && CSS.supports("field-sizing", "content"))) return;
    const y = window.scrollY;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
    if (window.scrollY !== y) window.scrollTo({ top: y });
  }, [ref, value, active]);
}

export type DocsEditorProps = {
  orgSlug: string; orgName: string; doc: Doc;
  /** Existing folder names, offered as suggestions. */
  folders: string[];
  /** Teams this person can share with (their own; every team for the organisation owner and HR). */
  teams: { id: string; name: string }[];
  viewerMembershipId: string; isNew: boolean;
  /** The server's clock when the page rendered. */
  now: number;
};

export function DocsEditor(props: DocsEditorProps) {
  return props.doc.canEdit ? <DocWriter {...props} /> : <DocReader {...props} />;
}

function BackToDocs({ base, onClick }: { base: string; onClick?: React.MouseEventHandler<HTMLAnchorElement> }) {
  return (
    <Link href={`${base}/docs`} onClick={onClick} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2.5")}>
      <AnimatedArrowLeft aria-hidden />Docs
    </Link>
  );
}

/** The server's clock until the page is live, then the browser's every half minute, so "updated 2m ago" keeps up. */
function useClock(serverNow: number) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Who wrote it and when it last changed; the reading view adds who can see it, the folder and the pin. */
function Byline({ doc, mine, updatedAt, now: serverNow, full = false }: { doc: Doc; mine: boolean; updatedAt: string; now: number; full?: boolean }) {
  const now = useClock(serverNow);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-meta font-normal text-secondary">
      {full ? <VisibilityBadge visibility={doc.visibility} teamName={doc.teamName} /> : null}
      {full && doc.folder ? <Badge><Folder className="size-3 shrink-0" aria-hidden /><span className="sr-only">Folder: </span>{doc.folder}</Badge> : null}
      {full && doc.pinned ? <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground"><Pin className="size-3.5" aria-hidden />Pinned</span> : null}
      <span>Written by {mine ? "you" : doc.createdBy.name}, updated <time dateTime={updatedAt} suppressHydrationWarning>{updatedLabel(updatedAt, now)}</time></span>
    </div>
  );
}

/** The reading view, for people who can see a document but not change it. */
function DocReader({ orgSlug, doc, viewerMembershipId, now }: DocsEditorProps) {
  const base = `/app/${orgSlug}`;
  const updatedAt = toIso(doc.updatedAt);
  return (
    <article className="mx-auto max-w-[880px]">
      <BackToDocs base={base} />
      <h1 className="type-headline mt-4 break-words">{doc.title}</h1>
      <div className="mt-3"><Byline full doc={doc} mine={doc.createdBy.membershipId === viewerMembershipId} updatedAt={updatedAt} now={now} /></div>
      {/* Who can change it is a page note at the bottom (docs/[id]/page.tsx). */}
      <div className="mt-6 rounded-2xl border border-border px-6 py-6 md:px-10 md:py-9">
        {doc.body.trim() ? <Markdown source={doc.body} /> : <p className="text-sm font-normal text-secondary">Nothing written here yet.</p>}
      </div>
    </article>
  );
}

function SaveStatus({ status, blankTitle, onRetry }: { status: Status; blankTitle: boolean; onRetry: () => void }) {
  return (
    <p role="status" aria-live="polite" className="inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap text-meta font-normal text-secondary">
      {status === "saving" || status === "dirty" ? <><LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />Saving…</>
        : status === "error" ? <><CircleAlert className="size-3.5 text-danger" aria-hidden /><span className="text-danger">Couldn&apos;t save.</span><button type="button" onClick={onRetry} className="link-inline ml-1">Retry</button></>
        : status === "conflict" ? <><CircleAlert className="size-3.5 text-warning" aria-hidden /><span className="text-warning">Not saved, changed elsewhere</span></>
        : blankTitle ? <><CircleAlert className="size-3.5 text-warning" aria-hidden />Needs a title</>
        : <><Check className="size-3.5 text-success" aria-hidden />Saved</>}
    </p>
  );
}

function DocWriter({ orgSlug, orgName, doc, folders, teams, viewerMembershipId, isNew, now }: DocsEditorProps) {
  const router = useRouter();
  const base = `/app/${orgSlug}`;
  const url = `/api/orgs/${orgSlug}/docs/${doc.id}`;
  const ids = useId();
  const mine = doc.createdBy.membershipId === viewerMembershipId;

  const [initial] = useState(() => fromDoc(doc));
  const [draft, setDraft] = useState<Draft>(initial);
  const [status, setStatusState] = useState<Status>("saved");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState(() => toIso(doc.updatedAt));
  const [teamName, setTeamName] = useState<string | null>(doc.teamName);
  const [mode, setMode] = useState<"edit" | "preview">(isNew || !doc.body.trim() ? "edit" : "preview");
  const [resolving, setResolving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // The save machinery lives in refs: timers and network replies must see the latest text, not the render they began in.
  const draftRef = useRef(initial);
  const savedRef = useRef(initial);
  const updatedAtRef = useRef(toIso(doc.updatedAt));
  const statusRef = useRef<Status>("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The save on the wire, if any: a second save waits for it (queued), and leaving waits for both. */
  const flight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const archived = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const setStatus = (s: Status) => { statusRef.current = s; setStatusState(s); };

  function schedule(delay: number) {
    if (statusRef.current === "conflict" || archived.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void saveRef.current(); }, delay);
  }

  /**
   * Takes a version from the server as the saved one. After a save of our own (`sent`), fields this save did not carry
   * and that are untouched here follow the server as well: pinning does not change updatedAt, so a pin someone else set
   * arrives with an ordinary save, and without this the next save would quietly undo it.
   */
  function accept(next: Doc, sent?: Patch) {
    const prev = savedRef.current;
    updatedAtRef.current = toIso(next.updatedAt);
    savedRef.current = fromDoc(next);
    if (sent) {
      const d = draftRef.current;
      const rebased: Draft = { ...d };
      let moved = false;
      for (const k of Object.keys(prev) as (keyof Draft)[]) {
        if (k in sent || d[k] !== prev[k] || d[k] === savedRef.current[k]) continue;
        (rebased as Record<keyof Draft, unknown>)[k] = savedRef.current[k];
        moved = true;
      }
      if (moved) { draftRef.current = rebased; setDraft(rebased); }
    }
    setSavedAt(updatedAtRef.current);
    setTeamName(next.teamName);
  }

  /** After a save lands: saved, or another round if the text moved on while it was on the wire. */
  function settle(sentPatch: Patch) {
    // Still different only because the server stored the same thing another way: saved, and no second save.
    const left = changes(draftRef.current, savedRef.current);
    const more = Object.keys(left).length > 0 && JSON.stringify(left) !== JSON.stringify(sentPatch);
    setStatus(more ? "dirty" : "saved");
    if (more || queued.current) { queued.current = false; schedule(500); }
  }

  function save(): Promise<void> {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (statusRef.current === "conflict" || archived.current) return Promise.resolve();
    if (flight.current) { queued.current = true; return flight.current; }
    const sent = draftRef.current;
    const patch = changes(sent, savedRef.current);
    if (Object.keys(patch).length === 0) { setStatus("saved"); setError(null); return Promise.resolve(); }
    setStatus("saving");
    setError(null);
    const run = (async () => {
      try {
        accept(await api<Doc>(url, { method: "PATCH", body: { ...patch, expectedUpdatedAt: updatedAtRef.current } }), patch);
        flight.current = null;
        settle(patch);
      } catch (err) {
        if (isApiFailure(err) && err.error.status === 409) {
          // The browser retries a save that timed out; if the first attempt did land, the retry meets it as a
          // conflict. When the stored version holds exactly what was sent, it is this save, not someone else's.
          const latest = await api<Doc>(url).catch(() => null);
          flight.current = null;
          if (latest && Object.keys(changes(sent, fromDoc(latest))).length === 0) { accept(latest, patch); settle(patch); return; }
          queued.current = false;
          setStatus("conflict");
          return;
        }
        flight.current = null;
        queued.current = false;
        setStatus("error");
        setError(failure(err));
      }
    })();
    flight.current = run;
    return run;
  }

  /** Waits for what is on the wire and sends what is still waiting, so leaving never races the last save. */
  async function flush() {
    for (let round = 0; round < 4; round++) {
      if (flight.current) { await flight.current; continue; }
      if (statusRef.current === "dirty") { await save(); continue; }
      return;
    }
  }

  /**
   * Back to Docs with a save still pending: finish it first, so the library shows the latest title and text. With
   * changes that could not be saved (a failed save, or a newer version saved elsewhere) it asks first, as closing the
   * tab does, and so does a save that fails on the way out.
   */
  function leave(e: React.MouseEvent<HTMLAnchorElement>) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const unsaved = () => statusRef.current === "error" || statusRef.current === "conflict";
    if (unsaved()) { e.preventDefault(); setConfirmLeave(true); return; }
    if (statusRef.current !== "dirty" && statusRef.current !== "saving") return;
    e.preventDefault();
    void flush().then(() => {
      if (statusRef.current === "saved") router.push(`${base}/docs`);
      else if (unsaved()) setConfirmLeave(true);
    });
  }

  // Timers and listeners call the newest save, whichever render scheduled them.
  useEffect(() => { saveRef.current = save; });

  /** Every edit: the draft changes now, the save follows a pause later (sooner for a click than for typing). */
  function update(patch: Partial<Draft>, delay = 1000) {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    if (statusRef.current !== "conflict") setStatus("dirty");
    schedule(delay);
  }

  // A newer version arriving from the server (a refresh after someone else's edit, or Brenda's) is taken as it is
  // when nothing here is waiting to be saved; otherwise the next save meets it as a conflict and asks.
  const propUpdatedAt = toIso(doc.updatedAt);
  const [seen, setSeen] = useState(propUpdatedAt);
  if (propUpdatedAt !== seen) {
    setSeen(propUpdatedAt);
    if (status === "saved" && Date.parse(propUpdatedAt) > Date.parse(savedAt)) {
      setDraft(fromDoc(doc));
      setSavedAt(propUpdatedAt);
      setTeamName(doc.teamName);
    }
  }
  useEffect(() => {
    if (savedAt !== updatedAtRef.current && Date.parse(savedAt) > Date.parse(updatedAtRef.current) && statusRef.current === "saved") {
      updatedAtRef.current = savedAt;
      savedRef.current = draft;
      draftRef.current = draft;
    }
  }, [savedAt, draft]);

  // A new document opens with its placeholder title selected, so typing replaces it.
  useEffect(() => {
    if (!isNew) return;
    titleRef.current?.focus();
    titleRef.current?.select();
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [isNew]);

  // The browser tab follows the title as it is written: the page's metadata only knew the title the document opened
  // with ("Untitled document" for a new one) until a reload. " · Boredroom" is the root layout's title template.
  const tabTitle = oneLine(draft.title) || "Untitled document";
  useEffect(() => { document.title = `${tabTitle} · Boredroom`; }, [tabTitle]);

  // Leaving: send what is waiting; closing the tab with unsaved text asks first. Cmd or Ctrl+S saves at once.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (statusRef.current !== "saved" && !archived.current) { e.preventDefault(); e.returnValue = ""; } };
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void saveRef.current(); } };
    const pending = timer;
    const latest = saveRef;
    window.addEventListener("beforeunload", warn);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("keydown", onKey);
      if (pending.current) { clearTimeout(pending.current); pending.current = null; void latest.current(); }
    };
  }, []);

  useAutoSize(titleRef, draft.title);
  useAutoSize(bodyRef, draft.body, mode === "edit");

  async function resolve(keep: "theirs" | "mine") {
    setResolving(true);
    try {
      const latest = await api<Doc>(url);
      accept(latest);
      setError(null);
      if (keep === "theirs") {
        draftRef.current = fromDoc(latest);
        setDraft(draftRef.current);
        setStatus("saved");
      } else {
        setStatus("dirty");
        await save();
      }
    } catch (err) {
      setError(isApiFailure(err) && err.error.status === 404 ? "This document has been archived, or it is no longer shared with you." : failure(err));
    } finally {
      setResolving(false);
    }
  }

  async function archive() {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    archived.current = true;
    try {
      await api(url, { method: "DELETE" });
    } catch (err) {
      // The browser retries a request whose reply was lost; if the first attempt landed, the retry finds the document
      // already archived (404). Gone either way, so carry on to the library.
      if (!(isApiFailure(err) && err.error.status === 404)) {
        archived.current = false;
        setNotice(failure(err));
        // The edit that was waiting when Archive was pressed still needs saving.
        if (statusRef.current === "dirty") schedule(0);
        return;
      }
    }
    successToast("Document archived", draft.title.trim() || undefined);
    router.push(`${base}/docs`);
  }

  const words = useMemo(() => { const t = draft.body.trim(); return t ? t.split(/\s+/).length : 0; }, [draft.body]);
  // Parsed once per text, not on every status change while the preview is open.
  const preview = useMemo(() => (mode === "preview" && draft.body.trim() ? <Markdown source={draft.body} /> : null), [mode, draft.body]);
  const blankTitle = !draft.title.trim();
  const team = teams.find((t) => t.id === draft.teamId);
  const audience = draft.visibility === "private" ? `Only ${mine ? "you" : doc.createdBy.name} can see it, along with the organisation owner and HR.`
    : draft.visibility === "team" ? `Everyone on ${team?.name ?? teamName ?? "the team"} can see it, along with the organisation owner and HR.`
    : `Everyone in ${orgName} can see it.`;
  const suggestions = folders.filter((f) => f !== draft.folder.trim());
  const visibilityOptions = [
    { value: "private", label: <><Lock className="size-3.5" aria-hidden />Private</> },
    ...(teams.length ? [{ value: "team", label: <><Users className="size-3.5" aria-hidden />Team</> }] : []),
    { value: "organisation", label: <><Globe className="size-3.5" aria-hidden />Everyone</> },
  ];

  return (
    <div className="mx-auto max-w-[880px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <BackToDocs base={base} onClick={leave} />
        <div className="flex items-center gap-1">
          <SaveStatus status={status} blankTitle={blankTitle} onRetry={() => void save()} />
          <ConfirmButton variant="ghost" size="sm" title="Archive this document?" confirmLabel="Archive document" onConfirm={archive}
            description="It leaves Docs for everyone it is shared with, and Brenda stops using it. Your other documents are not affected.">
            <Archive aria-hidden />Archive
          </ConfirmButton>
        </div>
      </div>
      <ConfirmDialog open={confirmLeave} onClose={() => setConfirmLeave(false)} title="Leave without saving?" cancelLabel="Stay and fix it" confirmLabel="Leave without saving"
        description={status === "conflict"
          ? "A newer version was saved somewhere else, so your latest changes here are not saved. If you leave now, they are lost. Stay to load their version or keep yours."
          : "Your latest changes could not be saved. If you leave now, they are lost. Stay to retry, or copy your text somewhere safe first."}
        // Leaving on purpose: the archived flag also stops the save machinery, so nothing is sent on the way out.
        onConfirm={() => { archived.current = true; router.push(`${base}/docs`); }} />

      {status === "conflict" ? (
        <Alert tone="warning" title="This document changed somewhere else" className="mt-4">
          <p>Someone, or Brenda, saved a newer version while you were writing, so your latest changes here are not saved yet. Take their version to carry on from it, or keep yours and save it over theirs.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={resolving} onClick={() => void resolve("theirs")}>Load their version</Button>
            <Button size="sm" variant="ghost" disabled={resolving} onClick={() => void resolve("mine")}>Keep mine</Button>
          </div>
        </Alert>
      ) : null}
      {error && status !== "saving" ? <Alert tone="danger" className="mt-4">{error}</Alert> : null}
      {notice ? <Alert tone="danger" className="mt-4">{notice}</Alert> : null}

      <form className="mt-4" aria-label="Document" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <h1 className="sr-only">{draft.title.trim() || "Untitled document"}</h1>
        <label htmlFor={`${ids}-title`} className="sr-only">Title</label>
        <textarea id={`${ids}-title`} ref={titleRef} rows={1} maxLength={TITLE_MAX} value={draft.title} placeholder="Untitled document" spellCheck
          aria-invalid={blankTitle || undefined} aria-describedby={blankTitle ? `${ids}-title-hint` : undefined}
          onChange={(e) => update({ title: e.target.value.replace(/\n/g, " ") })}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (mode === "edit") bodyRef.current?.focus(); else setMode("edit"); } }}
          className="-mx-2 block w-[calc(100%+1rem)] resize-none overflow-hidden rounded-xl border-0 bg-transparent px-2 py-1 font-display text-3xl font-normal text-foreground outline-none transition-colors duration-75 [field-sizing:content] placeholder:text-faint hover:bg-fill-0 focus:bg-fill-0 focus:outline-none focus-visible:outline-none" />
        {blankTitle ? <p id={`${ids}-title-hint`} className="mt-2 text-meta font-medium text-warning">A document needs a title. Everything else keeps saving.</p> : null}
        <div className="mt-2">
          <Byline doc={doc} mine={mine} updatedAt={savedAt} now={now} />
        </div>

        {/* The quiet toolbar: the document's settings and the Edit or Preview face, on hairlines. */}
        <fieldset className="mt-6 border-y border-border py-2">
          <legend className="sr-only">Document settings</legend>
          <div className="flex flex-wrap items-center gap-2">
            <InputAdorned fieldSize="sm" className="w-44" aria-label="Folder" list={`${ids}-folders`} maxLength={FOLDER_MAX} autoComplete="off"
              prefix={<Folder aria-hidden />} placeholder="No folder" value={draft.folder} onChange={(e) => update({ folder: e.target.value })} />
            <datalist id={`${ids}-folders`}>{suggestions.map((f) => <option key={f} value={f} />)}</datalist>
            <Segmented aria-label="Who can see it" name={`${ids}-visibility`} value={draft.visibility} options={visibilityOptions}
              onChange={(v) => {
                const visibility = v as Visibility;
                update({ visibility, teamId: visibility === "team" ? (draft.teamId && teams.some((t) => t.id === draft.teamId) ? draft.teamId : teams[0]?.id ?? null) : null }, 250);
              }} />
            {draft.visibility === "team" && teams.length > 1 ? (
              <Select aria-label="Team" fieldSize="sm" className="w-auto max-w-[14rem]" value={draft.teamId ?? ""} onChange={(e) => update({ teamId: e.target.value }, 250)}>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            ) : null}
            <Button size="sm" variant={draft.pinned ? "subtle" : "ghost"} aria-pressed={draft.pinned} aria-describedby={`${ids}-pin-hint`} onClick={() => update({ pinned: !draft.pinned }, 250)}>
              <Pin aria-hidden className={cn(draft.pinned && "fill-current")} />{draft.pinned ? "Pinned" : "Pin to top"}
            </Button>
            <span id={`${ids}-pin-hint`} className="sr-only">Pinned documents sit at the top of Docs for everyone who can see them.</span>
            <Segmented className="ml-auto" aria-label="Editor view" name={`${ids}-mode`} value={mode} onChange={(v) => setMode(v as "edit" | "preview")}
              options={[{ value: "edit", label: <><Pencil className="size-3.5" aria-hidden />Edit</> }, { value: "preview", label: <><Eye className="size-3.5" aria-hidden />Preview</> }]} />
          </div>
        </fieldset>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="text-meta font-normal text-secondary" aria-live="polite">{audience}</p>
          <p className="text-meta font-normal tabular-nums text-secondary">{words.toLocaleString("en-GB")} {words === 1 ? "word" : "words"}</p>
        </div>

        {mode === "edit" ? (
          <div className="mt-4">
            <div className="rounded-2xl border border-border transition-colors duration-75 focus-within:border-border-input-hover hover:border-border-input">
              <label htmlFor={`${ids}-body`} className="sr-only">Text, in Markdown</label>
              <textarea id={`${ids}-body`} ref={bodyRef} value={draft.body} maxLength={BODY_MAX} spellCheck aria-describedby={`${ids}-body-hint`}
                placeholder={"Start writing. Markdown works: # Heading, **bold**, - a list, - [ ] a checklist."}
                onChange={(e) => update({ body: e.target.value })}
                className="block min-h-[52vh] w-full resize-none overflow-hidden rounded-2xl border-0 bg-transparent px-6 py-6 text-base font-normal leading-7 text-foreground outline-none [field-sizing:content] placeholder:text-subtle focus:outline-none md:px-10 md:py-9" />
            </div>
            <p id={`${ids}-body-hint`} className="mt-2 text-meta font-normal text-secondary">
              Markdown: # for a heading, **bold**, *italic*, - for a list, 1. for steps, - [ ] for a checklist, &gt; for a quote, ``` for code. Changes save as you pause; Cmd or Ctrl+S saves at once.
              {draft.body.length > BODY_MAX - 20_000 ? <span className="text-warning"> {(BODY_MAX - draft.body.length).toLocaleString("en-GB")} characters left.</span> : null}
            </p>
          </div>
        ) : (
          <div className="mt-4 min-h-[52vh] rounded-2xl border border-border px-6 py-6 md:px-10 md:py-9" onDoubleClick={() => setMode("edit")}>
            {preview ?? <p className="text-sm font-normal text-secondary">Nothing written yet. Choose Edit to start.</p>}
          </div>
        )}
      </form>
    </div>
  );
}
