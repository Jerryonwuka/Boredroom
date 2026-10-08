"use client";

/**
 * What a routine sends, drawn (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"). Two parts:
 *
 * - `RoutineOutputView`: a run's output (or a preview's), shared by the preview in Settings and the run page
 *   (/home/routines/{id}). The lead in bold (the calm line when there was nothing), then each section under its bold
 *   label as a list, one line per item: the item's words, its detail after a comma in grey, then its sources as small
 *   links ("task", "message", "follow-up"…; lib/evidence-links builds them from ids only, so nothing typed becomes a
 *   link). A section that could not be read says "not available", never 0; "And 4 more." closes a long one. Last, what it
 *   did (a run) or what it would do (a preview), with "Not asked: …" and the reason for an ask that was refused. Every
 *   word in it is plain text: titles, other people's words and reasons are never formatted.
 * - `useRoutinePreview` and `RoutinePreviewPanel`: the "Preview" step of the routine's sheet (J.2). POST
 *   …/routines/{id}/preview runs the template now as the person, sending nothing and writing nothing; the panel says so
 *   ("What it would send now. Nothing was sent."), shows the output, then "When it's on, Max will:" with the consent lines
 *   as a list: exactly what Enable agrees to, each time it runs (the sheet's Enable sends the preview's hash, so a routine
 *   changed since is refused and previewed again).
 *
 * No orange here: the sheet's Enable is the screen's one accent. Lists are lists; it reads at 400px.
 */
import { Fragment, useCallback, useEffect, useId, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, Skeleton } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { EVIDENCE_WORDS, NOT_AVAILABLE, evidenceHref, type EvidenceRef } from "@/lib/evidence-links";
import { ROUTINE_WORDS, type RoutineActionRecord, type RoutineOutput, type RoutinePreview } from "@/lib/routines";
import { cn } from "@/lib/utils";

const W = ROUTINE_WORDS.output;
const OFFLINE = "Cannot reach the server. Check your connection and try again.";
/** A list's look in her outputs: bullets with grey markers and a hanging indent, items a little apart. */
const LIST = "list-disc space-y-1.5 pl-5 marker:text-subtle";

/** The sources of an action: its follow-up, then its task. */
function actionSources(a: RoutineActionRecord): EvidenceRef[] {
  const refs: EvidenceRef[] = [];
  if (a.followUpId) refs.push({ kind: "follow_up", id: a.followUpId });
  if (a.taskId) refs.push({ kind: "task", id: a.taskId });
  return refs;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/**
 * A line's sources: " (task, follow-up)", at most three, each page once, as small links. A screen reader hears what
 * each one is for ("task, for “Landing page” (Ben Okafor)").
 */
function Sources({ refs, orgSlug, about }: { refs: EvidenceRef[]; orgSlug: string; about: string }) {
  const links: { href: string; word: string }[] = [];
  for (const ref of refs) {
    if (links.length >= 3) break;
    const href = evidenceHref(orgSlug, ref);
    if (!href || links.some((l) => l.href === href)) continue;
    links.push({ href, word: EVIDENCE_WORDS[ref.kind] });
  }
  if (!links.length) return null;
  return (
    <span className="text-secondary">
      {" ("}
      {links.map((l, i) => (
        <Fragment key={l.href}>
          {i ? ", " : null}
          <Link href={l.href} className="link-inline">{l.word}<span className="sr-only">, for {clip(about, 80)}</span></Link>
        </Fragment>
      ))}
      {")"}
    </span>
  );
}

/**
 * A run's output (or a preview's): the lead, the sections as lists with their sources, "not available" for a section
 * that could not be read, and what it did or would do. `headingLevel`: the level of the section labels (3 under a page's
 * or a sheet's own heading).
 */
export function RoutineOutputView({ output, orgSlug, className, headingLevel = 3 }: { output: RoutineOutput; orgSlug: string; className?: string; headingLevel?: 2 | 3 | 4 }) {
  const H = `h${headingLevel}` as "h2" | "h3" | "h4";
  // A preview describes ("Would ask …"); a run did (or was refused, with a reason).
  const acted = output.actions.some((a) => a.done || !!a.reason);
  const sections = output.sections.filter((s) => s.missing || s.items.length);
  const label = "text-sm font-semibold text-foreground";
  return (
    <div className={cn("space-y-4 text-sm", className)}>
      <p className="font-semibold text-foreground">{output.empty ? (output.calm ?? output.lead) : output.lead}</p>
      {sections.map((s) => (
        <section key={s.id} aria-label={s.label}>
          <H className={label}>{s.label}</H>
          {s.missing ? <p className="mt-1 font-normal text-secondary">{NOT_AVAILABLE}</p> : (
            <ul className={cn(LIST, "mt-1.5")}>
              {s.items.map((it, i) => (
                <li key={i} className="break-words font-normal text-foreground">
                  {it.text}
                  {it.detail ? <span className="text-secondary">, {it.detail}</span> : null}
                  <Sources refs={it.sources} orgSlug={orgSlug} about={it.text} />
                </li>
              ))}
              {s.more > 0 ? <li className="font-normal text-secondary">{W.andMore(s.more)}</li> : null}
            </ul>
          )}
        </section>
      ))}
      {output.actions.length ? (
        <section aria-label={acted ? W.whatItDid : W.whatItWouldDo}>
          <H className={label}>{acted ? W.whatItDid : W.whatItWouldDo}</H>
          <ul className={cn(LIST, "mt-1.5")}>
            {output.actions.map((a, i) => (
              <li key={i} className="break-words font-normal text-foreground">
                {!a.done && a.reason ? <>{W.notAsked}: {a.text}<span className="text-secondary">: {a.reason}</span></> : a.text}
                {a.done ? <Sources refs={actionSources(a)} orgSlug={orgSlug} about={a.text} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** `final`: a refusal that trying again cannot change (no rights, a team that is gone): no "Try again", and what to do. */
export type PreviewState = { status: "loading" } | { status: "ready"; preview: RoutinePreview } | { status: "error"; message: string; final?: boolean };

/** A preview's refusal in words, and whether it is final (review, 8 October 2026: a 403 offered "Try again"). */
function previewError(err: unknown): { message: string; final: boolean } {
  if (!isApiFailure(err) || (err.error.status >= 500 && err.error.code !== "NOT_READY")) return { message: OFFLINE, final: false };
  const { status, message } = err.error;
  if (status === 403) return { message: `${message} ${ROUTINE_WORDS.preview.noRightsNext}`, final: true };
  if (status === 422 || status === 404 || status === 402) return { message, final: true };
  return { message, final: false };
}

/**
 * The preview of a saved routine: POST …/routines/{id}/preview (nothing sent, nothing written) whenever `routineId` is
 * set, again when `rev` changes (the step opened again, the routine saved) and on `reload` (after a 409 at Enable: the
 * routine changed since). Only the answer to the latest request shows; until it comes, "loading".
 */
export function useRoutinePreview(orgSlug: string, routineId: string | null, rev = 0) {
  const [reloads, setReloads] = useState(0);
  const want = routineId ? `${routineId}:${rev}:${reloads}` : null;
  const [result, setResult] = useState<{ key: string; state: PreviewState } | null>(null);
  useEffect(() => {
    if (!want || !routineId) return;
    let alive = true;
    api<RoutinePreview>(`/api/orgs/${orgSlug}/brenda/routines/${routineId}/preview`, { method: "POST", retries: 1 }).then(
      (preview) => { if (alive) setResult({ key: want, state: { status: "ready", preview } }); },
      (err) => { if (alive) setResult({ key: want, state: { status: "error", ...previewError(err) } }); },
    );
    return () => { alive = false; };
  }, [orgSlug, routineId, want]);
  const state: PreviewState = result && result.key === want ? result.state : { status: "loading" };
  const reload = useCallback(() => setReloads((n) => n + 1), []);
  return { state, reload };
}

/**
 * The "Preview" step (J.2): "Preview" and "What it would send now. Nothing was sent.", the output, then the consent card
 * "When it's on, Max will:" with its lines. `error`: what Enable said when it was refused (a 409 reloads the preview).
 */
export function RoutinePreviewPanel({ state, orgSlug, assistantName, onRetry, error, enabled }: {
  state: PreviewState; orgSlug: string; assistantName: string; onRetry: () => void; error?: string | null;
  /** The routine is on already: the card says what it does each time rather than what Enable agrees to. */ enabled?: boolean;
}) {
  const P = ROUTINE_WORDS.preview;
  const consentId = useId();
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{P.heading}</h3>
        <p className="mt-0.5 text-meta font-normal text-secondary">{P.note}</p>
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {state.status === "loading" ? (
        <div className="space-y-3" role="status" aria-label="Getting the preview">
          <Skeleton className="h-5 w-2/3" /><Skeleton className="h-4 w-1/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" />
        </div>
      ) : state.status === "error" ? (
        <Alert tone="danger" action={state.final ? undefined : <Button size="xs" variant="secondary" onClick={onRetry}>Try again</Button>}>{state.message}</Alert>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-fill-0 px-4 py-3">
            <RoutineOutputView output={state.preview.output} orgSlug={orgSlug} headingLevel={4} />
          </div>
          {state.preview.consent.lines.length ? (
            <section aria-labelledby={consentId} className="card-panel px-4 py-3">
              <h3 id={consentId} className="text-sm font-semibold text-foreground">{P.whenOn(assistantName)}</h3>
              <ul className={cn(LIST, "mt-2 text-sm font-normal text-foreground")}>
                {state.preview.consent.lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}
              </ul>
              {enabled ? null : <p className="mt-2 text-meta font-normal text-secondary">Enabling it is your yes to exactly this, each time it runs. Nothing else.</p>}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
