"use client";

/**
 * How long something should take (owner decision, 26 September 2026): a `.field` button showing "3h 30m" that opens
 * a column of hours and a column of minutes with the current choice lit, plus a row of common lengths. Writes the
 * number of minutes to a hidden input under `name`, or nothing when cleared. Controlled or uncontrolled.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { AnimatedHourglass } from "@/components/ui/animated-icons";
import { cn } from "@/lib/utils";
import { liftToTopLayer, popoverHost } from "@/components/ui/top-layer";

const HOURS = Array.from({ length: 13 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];
const QUICK: { label: string; minutes: number }[] = [{ label: "15m", minutes: 15 }, { label: "30m", minutes: 30 }, { label: "1h", minutes: 60 }, { label: "2h", minutes: 120 }, { label: "4h", minutes: 240 }, { label: "1 day", minutes: 480 }];

export function durationLabel(minutes: number | null | undefined) {
  if (!minutes || minutes <= 0) return "";
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return h && m ? `${h}h ${String(m).padStart(2, "0")}m` : h ? `${h}h` : `${m}m`;
}

export function DurationPicker({ name, id, value, defaultValue, onChange, required, placeholder = "How long it should take", className, size = "md", "aria-label": ariaLabel, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy, disabled }: {
  name?: string; id?: string; value?: number | null; defaultValue?: number | null; onChange?: (minutes: number | null) => void; required?: boolean; placeholder?: string; className?: string; size?: "xs" | "sm" | "md"; "aria-label"?: string; disabled?: boolean;
  /** Set by Field when it shows an error, so the error is linked to the trigger. */
  "aria-invalid"?: boolean; "aria-describedby"?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState<number | null>(defaultValue ?? null);
  const current = controlled ? (value ?? null) : inner;
  const h = current ? Math.floor(current / 60) : null;
  const m = current ? current % 60 : null;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, up: false });
  const [host, setHost] = useState<HTMLElement | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const popId = `${useId()}-pop`;
  const commit = (minutes: number | null) => { const v = minutes && minutes > 0 ? minutes : null; if (!controlled) setInner(v); onChange?.(v); };
  const close = () => { setOpen(false); trigger.current?.focus(); };

  const place = () => {
    const r = trigger.current?.getBoundingClientRect(); if (!r) return;
    const up = r.bottom + 300 > window.innerHeight && r.top > 300;
    setPos({ top: up ? r.top - 8 : r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 264)), up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!pop.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  const text = durationLabel(current);
  const cell = "h-8 w-full rounded-lg text-sm tabular-nums transition-colors duration-75 hover:bg-fill-1 aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-primary-fg";
  return (
    <div className="relative">
      {/* A button cannot carry aria-invalid: the error shows as data-invalid (a red hairline) and is read out through aria-describedby. */}
      <button ref={trigger} type="button" id={id} disabled={disabled} aria-label={ariaLabel} data-invalid={ariaInvalid || undefined} aria-describedby={ariaDescribedBy} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popId : undefined} onClick={() => { if (disabled) return; setHost(popoverHost(trigger.current)); setOpen((o) => !o); }} className={cn("field flex items-center justify-between gap-2 text-left", size === "sm" && "field-sm", size === "xs" && "field-xs w-auto", !text && "text-subtle", className)}>
        <span className="truncate tabular-nums">{text || placeholder}</span>
        <AnimatedHourglass className="size-4 shrink-0 text-subtle" aria-hidden />
      </button>
      {name ? <input type="text" name={name} value={current ?? ""} required={required} readOnly tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-0" /> : null}
      {typeof document !== "undefined" ? createPortal(<AnimatePresence>
        {open ? (
          <motion.div ref={(n) => { pop.current = n; liftToTopLayer(n); }} key="pop" role="dialog" aria-label="Choose a length of time" initial={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ position: "fixed", top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, zIndex: "var(--z-toast)" as unknown as number }}
            id={popId} className="top-pop popover-surface w-64 p-3 text-foreground">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-subtle">Hours</span><span className="text-xs font-medium text-subtle">Minutes</span></div>
            <div className="grid grid-cols-[1.4fr_1fr] gap-2">
              <div className="prompt-scroll grid max-h-44 grid-cols-3 gap-1 overflow-y-auto pr-1">
                {HOURS.map((x) => <button key={x} type="button" aria-pressed={h === x} onClick={() => commit(x * 60 + (m ?? 0))} className={cell}>{x}h</button>)}
              </div>
              <div className="grid grid-cols-1 content-start gap-1">
                {MINUTES.map((x) => <button key={x} type="button" aria-pressed={m === x && current !== null} onClick={() => commit((h ?? 0) * 60 + x)} className={cell}>{String(x).padStart(2, "0")}m</button>)}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border pt-2.5">
              {QUICK.map((q) => <button key={q.minutes} type="button" onClick={() => { commit(q.minutes); close(); }} className={cn("inline-flex h-7 items-center rounded-lg px-2 text-xs font-medium tabular-nums transition-colors duration-75", current === q.minutes ? "bg-primary text-primary-fg" : "text-secondary hover:bg-fill-1 hover:text-foreground")}>{q.label}</button>)}
            </div>
            <div className="mt-2 flex items-center justify-between">
              <button type="button" onClick={() => { commit(null); close(); }} className="inline-flex h-7 items-center rounded-lg px-2 text-meta font-medium text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground">Clear</button>
              <button type="button" onClick={close} className="inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-meta font-medium text-primary-fg hover:bg-primary-hover">Done</button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>, host ?? document.body) : null}
    </div>
  );
}
