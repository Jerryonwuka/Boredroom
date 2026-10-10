"use client";

/**
 * Brenda's notes on a call (owner decisions, 8 October 2026, confirmed 10 October 2026: phase 8, "Brenda can join calls:
 * notes, recap and commitments, WITH CONSENT"; contract E.7). The call page (calls_web's stage) renders these slots:
 * - `CallNotesToggle` in the controls bar: "{ws} takes notes" opens a centred confirm that says exactly what happens;
 *   "Stop notes" needs none. It is a round 44px call toggle like the others, drawn inverted while notes are on (fix
 *   review, 10 October 2026: on and off looked the same). Without the plan, an AI connection or the workspace's switch it
 *   is a faded button whose tooltip says why, and a press (a touch has no tooltip) says it in a toast.
 * - `CallNotesBanner` at the top of the live stage while notes are on: who turned them on, whose words are included (never
 *   who said no), and the viewer's own choice: Include me / Not me, then the engine's status line. Before answering,
 *   everyone reads what a yes means (contract E.2; fix review, 10 October 2026): only the words of people who agree, on
 *   their own device, the recap to everyone on the call and a short version into the thread, by name, and the
 *   transcript's deletion after 7 days.
 * - `NoteTakerTile`: one more tile in the grid while notes are on, the workspace assistant's face; quiet (no orange). It
 *   fills its cell like a person's tile; the stage gives it the strip's 16:9 shape beside a screen share.
 * - `CallNotesRunner` (headless; CallHost mounts it while connected, so notes go on while the person opens other pages):
 *   runs the on-device transcriber only while notes are on, the viewer said yes, they are connected and their microphone
 *   is published (src/lib/call-transcriber/runner). Its status reaches the banner through a small store in this file.
 * - `CallRecapPanel` on an ended call's page: the notes (summary, decisions, action items; the viewer's own items link to
 *   their commitment to accept) and the transcript for the people who were on the call, until it is deleted.
 * Plain British English; orange is never used here (the call's one orange is Join, or nothing).
 */
import * as React from "react";
import Link from "next/link";
import { ChevronDown, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Dialog } from "@/components/ui/sheet";
import { Alert, Skeleton } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { BrendaFace } from "@/components/app/brenda-face";
import { callToggleClass } from "@/components/app/call-controls";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { AssistantProfile } from "@/lib/assistant-look";
import { CHANGE_EVENT } from "@/components/app/realtime";
import type { CallView, RecapState } from "@/lib/calls";
import { NOTES_WORDS as W, type CallRecapView, type NotesAvailability, type RecapSkipReason, type TranscriptLine } from "@/lib/call-notes";
import { prepareEngine } from "@/lib/call-transcriber/engine";
import type { RunnerStatus } from "@/lib/call-transcriber/runner";

export type CallNotesSlotProps = {
  orgSlug: string;
  call: CallView;                       // the stage's current view
  availability: NotesAvailability;      // from the call page (E.1)
  workspaceAssistant: AssistantProfile; // the note-taker's name and face
  onChanged: (call: CallView) => void;  // the notes and consent routes answer a new view
};
export type CallNotesRunnerProps = { orgSlug: string; call: CallView | null; connected: boolean; micTrack: MediaStreamTrack | null };
export type CallRecapPanelProps = { orgSlug: string; callId: string; recapState: RecapState; wasOn: boolean; impersonated: boolean; workspaceAssistant: AssistantProfile };

const base = (slug: string, id: string) => `/api/orgs/${encodeURIComponent(slug)}/calls/${encodeURIComponent(id)}`;
const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;
const errorText = (err: unknown) => (isApiFailure(err) && err.error.status < 500 ? err.error.message : "That didn't go through. Try again.");
const inRoom = (call: CallView) => call.state !== "ended" && call.me.state === "joined";
/** Where the short recap goes, as the confirm says it: "#Design", or the direct thread. */
function whereWords(call: CallView): string {
  if (call.kind === "direct") {
    const other = call.participants.find((p) => !p.you);
    return other ? `your messages with ${other.firstName}` : "your messages";
  }
  return call.where.name ?? "the channel";
}

// ---- The runner's status, shared with the banner (one per tab) ---------------------------------------------------------

type NotesStatus = { callId: string; status: RunnerStatus } | null;
let current: NotesStatus = null;
const listeners = new Set<() => void>();
function setStatus(s: NotesStatus) { current = s; for (const l of listeners) l(); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
function useNotesStatus(callId: string): RunnerStatus | null {
  const s = React.useSyncExternalStore(subscribe, () => current, () => null);
  return s && s.callId === callId ? s.status : null;
}

function statusLine(s: RunnerStatus | null): string | null {
  if (!s) return null;
  switch (s.kind) {
    case "preparing": return W.engine.preparing(s.mb);
    case "local": return W.engine.local;
    case "none": return W.engine.none;
    case "behind": return W.engine.behind;
    case "muted": return W.engine.muted;
    case "stopped": return s.reason === "failed" ? W.engine.none : null;
  }
}

// ---- The toggle ---------------------------------------------------------------------------------------------------------

/** In the controls bar: switch notes on (after the confirm) or off. Only for someone in the room. */
export function CallNotesToggle(p: CallNotesSlotProps): React.ReactElement | null {
  const { call, availability, workspaceAssistant: ws } = p;
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const descId = React.useId();
  if (!inRoom(call)) return null;
  const on = call.notes.state === "on";

  if (!availability.available) {
    const why = W.unavailable[availability.reason ?? "not_ready"];
    return (
      <>
        <IconButton variant="round" aria-label={W.toggleOn(ws.name)} aria-disabled="true" aria-describedby={descId} data-tip={why}
          className={cn(callToggleClass(false), "cursor-not-allowed opacity-50 hover:bg-fill-1")} onClick={(e) => { e.preventDefault(); notify(why, { tone: "neutral" }); }}>
          <NotebookPen aria-hidden />
        </IconButton>
        <span id={descId} className="sr-only">{why}</span>
      </>
    );
  }

  const send = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ call: CallView }>(`${base(p.orgSlug, call.id)}/notes`, { method: "POST", body: { on: next } });
      p.onChanged(r.call);
      setConfirming(false);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  };

  return (
    <>
      <IconButton variant="round" className={callToggleClass(on)} aria-label={W.toggleOn(ws.name)} data-tip={on ? W.toggleOff : W.toggleOn(ws.name)} aria-pressed={on} disabled={busy}
        onClick={() => (on ? void send(false) : (setError(null), setConfirming(true)))}>
        <NotebookPen aria-hidden />
      </IconButton>
      {error && !confirming ? <span role="alert" className="sr-only">{error}</span> : null}
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={W.confirmTitle(ws.name)}
        footer={<>
          <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>{W.cancel}</Button>
          <Button variant="primary" loading={busy} onClick={() => void send(true)}>{W.confirm}</Button>
        </>}>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-secondary">
          {W.confirmBody(ws.name, whereWords(call)).map((line) => <li key={line}>{line}</li>)}
        </ul>
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      </Dialog>
    </>
  );
}

// ---- The banner ---------------------------------------------------------------------------------------------------------

/** At the top of the live stage while notes are on: what is happening and the viewer's own choice. */
export function CallNotesBanner(p: CallNotesSlotProps): React.ReactElement | null {
  const { call, workspaceAssistant: ws } = p;
  const status = useNotesStatus(call.id);
  const [busy, setBusy] = React.useState<"yes" | "no" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (call.state === "ended" || call.notes.state !== "on") return null;
  const n = call.notes;
  const by = n.onBy && n.onBy.membershipId === call.me.membershipId ? W.bannerYou(ws.name) : W.bannerOn(n.onBy ? firstOf(n.onBy.name) : "Someone", ws.name);
  const names = n.included.map((x) => (x.membershipId === call.me.membershipId ? "you" : x.firstName));
  const mine = n.myConsent;

  const answer = async (consent: "yes" | "no") => {
    setBusy(consent);
    setError(null);
    // "Include me" is a user gesture: the browser's on-device engine is installed from it when it can be.
    if (consent === "yes") void prepareEngine();
    try {
      const r = await api<{ call: CallView }>(`${base(p.orgSlug, call.id)}/consent`, { method: "POST", body: { consent } });
      p.onChanged(r.call);
    } catch (err) { setError(errorText(err)); } finally { setBusy(null); }
  };

  const line = mine === "yes" ? statusLine(status) : null;
  return (
    <section role="region" aria-label={W.recap.title} className="card-panel flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <NotebookPen className="mt-0.5 size-4 shrink-0 text-secondary" aria-hidden />
        <div className="min-w-0" aria-live="polite">
          <p className="text-sm font-medium text-foreground">{by} <span className="font-normal text-secondary">{W.from(names)}</span></p>
          {mine === null ? null
            : mine === "pending" ? <><p className="text-meta font-medium text-foreground">{W.ask}</p><p className="text-meta text-secondary">{W.consentInfo(whereWords(call))}</p></>
            : mine === "yes" ? <p className="text-meta text-secondary">{W.included}{line ? ` ${line}` : ""}</p>
            : <p className="text-meta text-secondary">{W.leftOut}</p>}
          {error ? <p role="alert" className="text-meta text-danger">{error}</p> : null}
        </div>
      </div>
      {mine === null ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {mine === "pending" ? <>
            <Button variant="secondary" size="sm" loading={busy === "no"} disabled={!!busy} onClick={() => void answer("no")}>{W.notMe}</Button>
            <Button variant="primary" size="sm" loading={busy === "yes"} disabled={!!busy} onClick={() => void answer("yes")}>{W.include}</Button>
          </> : mine === "yes" ? (
            <Button variant="ghost" size="sm" loading={busy === "no"} disabled={!!busy} onClick={() => void answer("no")}>{W.stopIncluding}</Button>
          ) : (
            <Button variant="secondary" size="sm" loading={busy === "yes"} disabled={!!busy} onClick={() => void answer("yes")}>{W.include}</Button>
          )}
        </div>
      )}
    </section>
  );
}

// ---- The note-taker's tile ----------------------------------------------------------------------------------------------

/** One more tile while notes are on: the workspace assistant's face, quiet. */
export function NoteTakerTile(p: CallNotesSlotProps): React.ReactElement | null {
  const { call, workspaceAssistant: ws } = p;
  if (call.state === "ended" || call.notes.state !== "on") return null;
  const n = call.notes.included.length;
  return (
    <div role="group" aria-label={`${W.tile.title(ws.name)}, ${W.tile.from(n).toLowerCase()}`}
      className="relative flex h-full min-h-0 w-full min-w-0 flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl bg-fill-1 p-4">
      <BrendaFace size="lg" look={ws} quiet />
      <div className="min-w-0 text-center">
        <p className="truncate text-sm font-medium text-foreground">{W.tile.title(ws.name)}</p>
        <p className="text-meta text-secondary">{W.tile.from(n)}</p>
      </div>
    </div>
  );
}

// ---- The runner (headless) ----------------------------------------------------------------------------------------------

/** Runs the on-device transcriber while notes are on, the viewer said yes, they are connected and their mic is on. */
export function CallNotesRunner(p: CallNotesRunnerProps): null {
  const { call, connected, micTrack, orgSlug } = p;
  const wanted = !!call && call.state !== "ended" && call.notes.state === "on" && call.notes.myConsent === "yes" && connected;
  const callId = call?.id ?? null;
  const startedAt = call?.startedAt ?? null;
  // The server's clock as it was when this view arrived (a line's seq and time are on it). Declared before the effect
  // that starts the runner, so it is current when that one runs.
  const serverNow = call?.serverNow ?? null;
  const clockRef = React.useRef<{ serverNow: string; receivedAt: number } | null>(null);
  React.useEffect(() => { if (serverNow) clockRef.current = { serverNow, receivedAt: Date.now() }; }, [serverNow]);

  React.useEffect(() => {
    if (!wanted || !callId || !startedAt) {
      setStatus(null);
      return;
    }
    if (!micTrack) { setStatus({ callId, status: { kind: "muted" } }); return; }
    let stopped = false;
    let stop: (() => void) | null = null;
    void import("@/lib/call-transcriber/runner").then(({ startCallNotes }) => {
      if (stopped) return;
      const c = clockRef.current ?? { serverNow: new Date().toISOString(), receivedAt: Date.now() };
      const r = startCallNotes({
        orgSlug, callId, callStartedAt: startedAt, serverNow: c.serverNow, receivedAt: c.receivedAt, micTrack,
        onStatus: (status) => { if (!stopped) setStatus({ callId, status }); },
      });
      stop = () => r.stop();
    }).catch(() => { if (!stopped) setStatus({ callId, status: { kind: "none" } }); });
    return () => { stopped = true; stop?.(); setStatus(null); };
  }, [wanted, callId, startedAt, micTrack, orgSlug]);
  return null;
}

// ---- The recap on an ended call's page ------------------------------------------------------------------------------------

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const dueFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clockFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayOf = (iso: string) => dayFmt.format(new Date(iso)).replace(/,/g, "");
const dueOf = (iso: string) => dueFmt.format(new Date(iso)).replace(/,(?=\s\d{2}:)/, ",").replace(/^(\w+),/, "$1");

/** The ended call's notes (E.7): writing, done, skipped or failed; the transcript for the people who were on it. */
export function CallRecapPanel(p: CallRecapPanelProps): React.ReactElement | null {
  const { orgSlug, callId, wasOn, impersonated, workspaceAssistant: ws } = p;
  // What the recap route said last; until then the page's own state.
  const [fetched, setFetched] = React.useState<RecapState | null>(null);
  const state = fetched ?? p.recapState;
  const [recap, setRecap] = React.useState<CallRecapView | null>(null);
  // Why there is none, when it was skipped (fix review, 10 October 2026).
  const [skipped, setSkipped] = React.useState<RecapSkipReason | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Failed: until when the transcript stays (from the transcript route; not read while impersonated).
  const [until, setUntil] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const r = await api<{ state: RecapState; recap: CallRecapView | null; skipped?: RecapSkipReason | null }>(`${base(orgSlug, callId)}/recap`);
      setFetched(r.state);
      setRecap(r.recap);
      setSkipped(r.skipped ?? null);
      setError(null);
      if (r.state === "failed" && !impersonated) {
        const t = await api<{ deleteAfter: string | null }>(`${base(orgSlug, callId)}/lines`).catch(() => null);
        setUntil(t?.deleteAfter ?? null);
      }
    } catch (err) { setError(errorText(err)); } finally { setLoaded(true); }
  }, [orgSlug, callId, impersonated]);

  React.useEffect(() => {
    if (!wasOn || p.recapState === "none") return;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [wasOn, load, p.recapState]);

  // While it is being written: every 5 s for 2 minutes, and on the calls events.
  React.useEffect(() => {
    if (!wasOn || (state !== "pending" && state !== "writing")) return;
    const started = Date.now();
    const t = setInterval(() => { if (Date.now() - started > 120_000) clearInterval(t); else void load(); }, 5_000);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onChange = (e: Event) => {
      const table = (e as CustomEvent<{ table?: string }>).detail?.table;
      if (table && table !== "calls") return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void load(), 300);
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => { clearInterval(t); if (debounce) clearTimeout(debounce); window.removeEventListener(CHANGE_EVENT, onChange); };
  }, [wasOn, state, load]);

  if (state === "none") return null;
  if (!wasOn) {
    return <section aria-label={W.recap.title} className="card-panel p-4"><p className="text-sm text-secondary">{W.recap.onlyParticipants}</p></section>;
  }

  const head = (
    <div className="flex items-center gap-2.5">
      <BrendaFace size="sm" look={ws} quiet />
      <h2 className="type-section-title">{W.recap.title}</h2>
    </div>
  );

  let body: React.ReactNode;
  if (!loaded) body = <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>;
  else if (state === "pending" || state === "writing") body = <p className="text-sm text-secondary brenda-shimmer" aria-live="polite">{W.recap.writing(ws.name)}</p>;
  else if (state === "skipped") body = <p className="text-sm text-secondary">{skipped === "not_answered" ? W.recap.skippedNotAnswered : skipped === "switched_off" ? W.recap.skippedOff : W.recap.skipped}</p>;
  else if (state === "failed") body = <p className="text-sm text-secondary">{W.recap.failed(until ? dayOf(until) : "7 days after the call")}</p>;
  else if (recap) body = <RecapBody recap={recap} orgSlug={orgSlug} />;
  // Done, but the server shows the viewer no recap: they were not on the call (rung, never joined).
  else body = error ? null : <p className="text-sm text-secondary">{W.recap.onlyParticipants}</p>;

  const showTranscript = (state === "done" && !!recap) || state === "failed";
  return (
    <section aria-label={W.recap.title} className="card-panel flex min-w-0 flex-col gap-4 p-4">
      {head}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {body}
      {showTranscript ? (impersonated
        ? <p className="text-meta text-secondary">{W.errors.transcriptImpersonated}</p>
        : <Transcript orgSlug={orgSlug} callId={callId} />) : null}
    </section>
  );
}

function RecapBody({ recap, orgSlug }: { recap: CallRecapView; orgSlug: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h3 className="text-meta font-medium text-secondary">{W.recap.summary}</h3>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{recap.summary}</p>
      </div>
      {recap.decisions.length ? (
        <div>
          <h3 className="text-meta font-medium text-secondary">{W.recap.decisions}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
            {recap.decisions.map((d) => <li key={d} className="break-words">{d}</li>)}
          </ul>
        </div>
      ) : null}
      {recap.actionItems.length ? (
        <div>
          <h3 className="text-meta font-medium text-secondary">{W.recap.actions}</h3>
          <ul className="mt-1 divide-y divide-border">
            {recap.actionItems.map((a) => (
              <li key={a.n} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <div className="min-w-0 flex-[1_1_14rem]">
                  <p className="break-words text-sm text-foreground">{a.what}</p>
                  <p className="text-meta text-secondary">
                    {[a.owner ? (a.mine ? "You" : a.owner.name) : W.recap.noOwner, a.dueAt ? `due ${dueOf(a.dueAt)}` : a.dueWords ? `“${a.dueWords}”` : null].filter(Boolean).join(", ")}
                  </p>
                </div>
                {a.mine && a.commitmentId ? (
                  <Link href={`/app/${orgSlug}/commitments?c=${a.commitmentId}`} prefetch={false} className="link-inline shrink-0 text-meta">{W.recap.open}</Link>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-meta text-secondary">{W.recap.acceptHint}</p>
        </div>
      ) : null}
    </div>
  );
}

function Transcript({ orgSlug, callId }: { orgSlug: string; callId: string }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<{ lines: TranscriptLine[]; deleteAfter: string | null; deleted: boolean } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  React.useEffect(() => {
    if (!open || data) return;
    api<{ lines: TranscriptLine[]; deleteAfter: string | null; deleted: boolean }>(`${base(orgSlug, callId)}/lines`)
      .then(setData).catch((err) => setError(errorText(err)));
  }, [open, data, orgSlug, callId]);
  return (
    <div className="border-t border-border pt-3">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-lg text-left text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
        {W.recap.transcript}
        <ChevronDown className={cn("size-4 shrink-0 text-subtle transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
      </button>
      {open ? (
        <div id={id} className="mt-2">
          {error ? <Alert tone="danger">{error}</Alert>
            : !data ? <Skeleton className="h-4 w-2/3" />
            : data.deleted ? <p className="text-meta text-secondary">{W.recap.deleted}</p>
            : (
              <>
                {data.deleteAfter ? <p className="text-meta text-secondary">{W.recap.deletesOn(dayOf(data.deleteAfter))}</p> : null}
                {data.lines.length ? (
                  <ol className="mt-2 space-y-1.5">
                    {data.lines.map((l) => (
                      <li key={l.id} className="break-words text-sm">
                        <span className="tabular-nums text-subtle">{clockFmt.format(new Date(l.spokenAt))}</span>{" "}
                        <span className="font-medium text-foreground">{firstOf(l.speaker.name)}:</span>{" "}
                        <span className="text-secondary">{l.text}</span>
                      </li>
                    ))}
                  </ol>
                ) : <p className="mt-1 text-meta text-secondary">{W.recap.noLines}</p>}
              </>
            )}
        </div>
      ) : null}
    </div>
  );
}
