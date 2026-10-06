"use client";

/**
 * Confirmation for destructive or irreversible actions, built on the native <dialog>: focus is trapped, Escape
 * closes, focus returns to the trigger, and the page behind is inert. Replaces window.confirm(), which cannot be
 * styled, announced consistently, or given a specific action label. A destructive dialog opens with focus on Cancel,
 * so Enter never deletes by accident; if the action fails, the dialog stays open and says why.
 *
 * v4 look (spec §7 Dialogs): centred, r16, 440px, the canvas colour and a hairline over a gray-150/30 overlay with no
 * blur; the title 18/26 medium, the description 14/20 medium in the secondary grey; the actions right-aligned: an
 * outline Cancel, then the action (red fill for a destructive one, the white primary otherwise).
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { isApiFailure } from "@/lib/api-client";

/** What a failed action says: the server's own message, or how to recover when the server could not be reached. */
function failureText(err: unknown) {
  if (isApiFailure(err)) return err.error.message;
  if (err instanceof Error && err.message && !err.message.startsWith("Network error")) return `That did not go through: ${err.message.replace(/\.$/, "")}. Try again.`;
  return "Cannot reach the server. Check your connection and try again.";
}

type ConfirmProps = {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** What the confirm button says while the action runs ("Deleting…"); "Working…" by default. */
  pendingLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => unknown | Promise<unknown>;
};

export function ConfirmDialog({ open, onClose, title, description, confirmLabel, cancelLabel = "Cancel", pendingLabel = "Working…", tone = "danger", onConfirm }: ConfirmProps & { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const errorId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); (tone === "danger" ? cancelRef : confirmRef).current?.focus(); }
    if (!open && d.open) d.close();
  }, [open, tone]);
  const close = () => { setError(null); onClose(); };
  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} onClose={(e) => { if (e.target === e.currentTarget) close(); }} onCancel={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); if (!busy) close(); }}>
      <form method="dialog" className="grid gap-5 p-6" onSubmit={(e) => e.preventDefault()}>
        <div>
          <h2 id={titleId} className="type-dialog-title">{title}</h2>
          {description ? <div id={descId} className="mt-1.5 text-sm font-medium text-secondary">{description}</div> : null}
        </div>
        {error ? <p id={errorId} role="alert" className="rounded-xl border border-danger/30 bg-danger/[0.07] px-3.5 py-2.5 text-sm font-normal text-foreground">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button ref={cancelRef} type="button" variant="secondary" onClick={close} disabled={busy}>{cancelLabel}</Button>
          <Button ref={confirmRef} type="button" variant={tone === "danger" ? "destructive" : "primary"} loading={busy} aria-describedby={error ? errorId : undefined}
            onClick={async () => {
              setBusy(true); setError(null);
              try { await onConfirm(); close(); }
              catch (err) { setError(failureText(err)); }
              finally { setBusy(false); }
            }}>{busy ? pendingLabel : confirmLabel}</Button>
        </div>
      </form>
    </dialog>
  );
}

/** A button that asks before acting. Use for delete, archive, disconnect, rotate, publish. */
export function ConfirmButton({ title, description, confirmLabel, cancelLabel, pendingLabel, tone = "danger", onConfirm, children, ...button }: ConfirmProps & Omit<ButtonProps, "onClick" | "title">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...button} aria-haspopup="dialog" onClick={() => setOpen(true)}>{children}</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title={title} description={description} confirmLabel={confirmLabel} cancelLabel={cancelLabel} pendingLabel={pendingLabel} tone={tone} onConfirm={onConfirm} />
    </>
  );
}
