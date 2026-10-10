"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea, Field } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Alert } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { api, isApiFailure } from "@/lib/api-client";

/** Set by the sheet a DecisionForm sits in (review-sheet's DecisionSheetButton), so a saved decision closes it. */
export const DecisionDone = createContext<(() => void) | null>(null);

/**
 * Generic decision form used by the review queue (time corrections). v4: the choices as
 * a segmented control, the note under it, the action (named after the choice) at the bottom right. An option marked
 * `danger` (a deletion) cannot be undone, so choosing it asks once more before anything is sent, in place
 * (focus moves to Cancel): the form sits in a sheet, and a confirm dialog nested in it would close the sheet with it
 * (React passes a dialog's close event up its tree). One marked
 * `needsNote` (requesting changes, rejecting) makes the note required, as the server does. A saved decision says so in
 * a toast and closes the sheet it sits in.
 */
export function DecisionForm({ path, options, noteLabel = "Note", noteRequired = false, extra }: { path: string; options: { value: string; label: string; danger?: boolean; needsNote?: boolean }[]; noteLabel?: string; noteRequired?: boolean; extra?: Record<string, unknown> }) {
  const router = useRouter();
  const done = useContext(DecisionDone);
  const ids = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [decision, setDecision] = useState(options[0].value);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) cancelRef.current?.focus(); }, [confirming]);
  const chosen = options.find((o) => o.value === decision) ?? options[0];
  const needsNote = noteRequired || !!chosen.needsNote;
  const decisionKey = options[0].value === "deleted" || options[0].value === "released" ? "disposition" : "decision";
  const send = async () => {
    setPending(true); setError(null); setFieldErrors({});
    try { await api(path, { method: "POST", body: { [decisionKey]: decision, note, ...(extra ?? {}) } }); successToast("Decision saved", chosen.label); done?.(); router.refresh(); }
    catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server. Nothing was decided; try again."); }
    finally { setPending(false); }
  };
  const decisionError = fieldErrors[decisionKey]?.[0];
  return (
    <form className="grid gap-4 rounded-2xl border border-border p-4" aria-label="Decision" onSubmit={(e) => { e.preventDefault(); if (chosen.danger && !confirming) setConfirming(true); else void send(); }}>
      {error && !fieldErrors.note && !decisionError ? <Alert tone="danger">{error}</Alert> : null}
      <div>
        <p id={`${ids}-decision`} className="mb-1.5 text-sm font-medium text-foreground">Decision</p>
        <Segmented aria-label="Decision" name={`${ids}-decision-choice`} value={decision} onChange={(v) => { setDecision(v); setConfirming(false); }}
          options={options.map((o) => ({ value: o.value, label: o.label, tone: o.danger ? "danger" : undefined }))} />
        {decisionError ? <p role="alert" className="mt-1.5 text-meta font-medium text-danger">{decisionError}</p> : null}
      </div>
      <Field label={noteLabel} htmlFor={`${ids}-note`} hint={needsNote ? "Required" : "Optional"} error={fieldErrors.note}><Textarea id={`${ids}-note`} name="note" className="min-h-20" maxLength={4000} required={needsNote} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {confirming && chosen.danger ? (
        <div role="alertdialog" aria-labelledby={`${ids}-confirm-title`} aria-describedby={`${ids}-confirm-body`} className="rounded-xl border border-danger/30 bg-danger/[0.07] p-3.5"
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setConfirming(false); } }}>
          <p id={`${ids}-confirm-title`} className="text-sm font-medium text-foreground">{chosen.label}?</p>
          <p id={`${ids}-confirm-body`} className="mt-0.5 text-sm font-normal text-secondary">This cannot be undone. The decision and your note are logged.</p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button ref={cancelRef} size="sm" variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button size="sm" type="submit" variant="destructive" loading={pending}>{pending ? "Saving…" : chosen.label}</Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end"><Button type="submit" variant={chosen.danger ? "danger" : "primary"} loading={pending}>{pending ? "Saving…" : chosen.label}</Button></div>
      )}
    </form>
  );
}
