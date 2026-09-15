"use client";

/**
 * Confirmation for destructive or irreversible actions, built on the native <dialog>: focus is trapped, Escape
 * closes, focus returns to the trigger, and the page behind is inert. Replaces window.confirm(), which cannot be
 * styled, announced consistently, or given a specific action label.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

type ConfirmProps = {
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => unknown | Promise<unknown>;
};

export function ConfirmDialog({ open, onClose, title, description, confirmLabel, cancelLabel = "Cancel", tone = "danger", onConfirm }: ConfirmProps & { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby={titleId} aria-describedby={description ? descId : undefined} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <form method="dialog" className="grid gap-4 p-6" onSubmit={(e) => e.preventDefault()}>
        <div>
          <h2 id={titleId} className="font-display text-xl">{title}</h2>
          {description ? <p id={descId} className="mt-2 text-sm text-fg-muted">{description}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{cancelLabel}</Button>
          <Button type="button" variant={tone === "danger" ? "danger" : "primary"} disabled={busy} autoFocus onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}>{busy ? "Working…" : confirmLabel}</Button>
        </div>
      </form>
    </dialog>
  );
}

/** A button that asks before acting. Use for delete, archive, disconnect, rotate, publish. */
export function ConfirmButton({ title, description, confirmLabel, cancelLabel, tone = "danger", onConfirm, children, ...button }: ConfirmProps & Omit<ButtonProps, "onClick" | "title">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button {...button} onClick={() => setOpen(true)}>{children}</Button>
      <ConfirmDialog open={open} onClose={() => setOpen(false)} title={title} description={description} confirmLabel={confirmLabel} cancelLabel={cancelLabel} tone={tone} onConfirm={onConfirm} />
    </>
  );
}
