"use client";

/**
 * Sheets and dialogs, v4 (spec §7 Dialogs), on the native <dialog>: focus moves in and is trapped, Escape closes, focus
 * returns to the trigger, the page behind is inert. The overlay is gray-150 at 30% with no blur.
 *
 * - `Sheet`: the default for forms and detail. Full height from the right, 512px (`size` sm 400, lg 720; the full
 *   width of a phone), the canvas colour, a hairline on its left, p24. Title 18/26 medium, description 14/20 in the
 *   secondary grey, a ghost close button top right, the body scrolls, the footer's actions sit right-aligned
 *   (an outline Cancel, then the primary). Slides in over 300ms (none with reduced motion).
 * - `Dialog`: centred, r16, 440px, the same parts. For short questions and small forms; confirms use ConfirmDialog.
 *
 * Both are controlled: `open` and `onClose`. Clicking the overlay closes them unless `dismissible` is false (a form with
 * unsaved work can pass false and close from its own buttons).
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/icon-button";

type DialogBase = {
  open: boolean; onClose: () => void; title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode;
  /** Actions, right-aligned: <Button variant="secondary">Cancel</Button><Button>Save</Button>. */ footer?: React.ReactNode;
  className?: string; dismissible?: boolean; closeLabel?: string;
};

/** What opening may leave the focus on: a text field, a select or a picker. Anything else hands it to Close. */
const FIELD = "input:not([type=hidden]):not([type=range]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=button]):not([type=submit]), textarea, select, .field, [contenteditable=true]";

function useNativeDialog(open: boolean) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const opener = React.useRef<Element | null>(null);
  React.useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      // showModal() focuses the first control. A form starts in its first field; a sheet of details (a task, a to-do,
      // a person's teams) starts on Close instead, so an arrow key or a second Enter never moves a slider or presses
      // an action by accident.
      const at = document.activeElement;
      if (!(at instanceof HTMLElement && d.contains(at) && at.matches(FIELD))) d.querySelector<HTMLElement>("[data-dialog-close]")?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  // A parent that drops an open sheet (`{open ? <Sheet open … /> : null}`) instead of closing it: the dialog leaves the
  // page without closing, so the browser does not hand the focus back. Once it is gone, give it to the control that
  // opened it. (A dialog still in the page here is React's development double mount, not an unmount: left alone.)
  React.useEffect(() => {
    const d = ref.current;
    return () => {
      const back = opener.current;
      if (d && !d.isConnected && d.open && back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);
  return ref;
}

function Frame({ kind, open, onClose, title, description, children, footer, className, dismissible = true, closeLabel = "Close", size }: DialogBase & { kind: "side-sheet" | "modal"; size?: "sm" | "md" | "lg" }) {
  const ref = useNativeDialog(open);
  const titleId = React.useId();
  const descId = React.useId();
  return (
    // text-left: a sheet opened from a right-aligned table cell would otherwise inherit its alignment.
    <dialog ref={ref} className={cn(kind, "text-left", className)} data-size={size === "md" ? undefined : size} aria-labelledby={open ? titleId : undefined} aria-describedby={open && description ? descId : undefined}
      // React hands a nested dialog's close and cancel (a confirm opened inside this sheet) up its tree too: answer
      // only this dialog's own.
      onCancel={(e) => { if (e.target !== e.currentTarget) return; e.preventDefault(); onClose(); }}
      onClose={(e) => { if (e.target === e.currentTarget && open) onClose(); }}
      onMouseDown={(e) => {
        if (!dismissible || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}>
      {open ? (
        <>
          <div className="shrink-0 px-6 pb-4 pr-14 pt-6">
            <h2 id={titleId} className="type-dialog-title">{title}</h2>
            {description ? <p id={descId} className="mt-1 text-sm font-medium text-secondary">{description}</p> : null}
          </div>
          <div className={cn("min-h-0 px-6", kind === "side-sheet" ? "flex-1 overflow-y-auto pb-6" : "pb-6", footer && "pb-2")}>{children}</div>
          {footer ? <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 px-6 pb-6 pt-4">{footer}</div> : null}
          {/* Last in the DOM, so opening focuses the first field rather than Close; drawn top right. */}
          <IconButton data-dialog-close aria-label={closeLabel} onClick={onClose} className="absolute right-4 top-5"><X aria-hidden /></IconButton>
        </>
      ) : null}
    </dialog>
  );
}

export function Sheet({ size = "md", ...props }: DialogBase & { size?: "sm" | "md" | "lg" }) {
  return <Frame kind="side-sheet" size={size} {...props} />;
}

export function Dialog(props: DialogBase) {
  return <Frame kind="modal" {...props} />;
}
