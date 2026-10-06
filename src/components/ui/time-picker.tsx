"use client";

/**
 * The time field (owner decision, 25 September 2026: no native pickers). A `.field` button showing the time, which
 * opens two columns, hours and minutes, with the current choice in the inverted primary, plus a row of common times. Writes
 * "HH:MM" to a hidden input under `name`, exactly what the native time input produced. Controlled or uncontrolled.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { liftToTopLayer } from "@/components/ui/top-layer";

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];
const QUICK = ["08:00", "09:00", "12:00", "13:00", "17:00", "18:00"];

function parse(v: string | undefined) {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? "");
  if (!m) return null;
  return { h: Math.min(23, Number(m[1])), m: Math.min(59, Number(m[2])) };
}
function label(v: string | undefined) {
  const t = parse(v);
  if (!t) return "";
  const h12 = t.h % 12 === 0 ? 12 : t.h % 12;
  return `${pad(t.h)}:${pad(t.m)}  ${h12}${t.m ? `:${pad(t.m)}` : ""} ${t.h < 12 ? "am" : "pm"}`;
}

export function TimePicker({ name, id, value, defaultValue, onChange, required, placeholder = "Pick a time", className, size = "md", "aria-label": ariaLabel, "aria-invalid": ariaInvalid, "aria-describedby": ariaDescribedBy, disabled }: {
  name?: string; id?: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; required?: boolean; placeholder?: string; className?: string; size?: "xs" | "sm" | "md"; "aria-label"?: string; disabled?: boolean;
  /** Set by Field when it shows an error, so the error is linked to the trigger. */
  "aria-invalid"?: boolean; "aria-describedby"?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = controlled ? value : inner;
  const t = parse(current);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, up: false });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hoursRef = useRef<HTMLDivElement>(null);
  const popId = `${useId()}-pop`;
  const commit = (h: number, m: number) => { const v = `${pad(h)}:${pad(m)}`; if (!controlled) setInner(v); onChange?.(v); };

  const place = () => {
    const r = trigger.current?.getBoundingClientRect(); if (!r) return;
    const up = r.bottom + 300 > window.innerHeight && r.top > 300;
    setPos({ top: up ? r.top - 8 : r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), up });
  };
  useLayoutEffect(() => { if (open) { place(); requestAnimationFrame(() => hoursRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.scrollIntoView({ block: "center" })); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  const text = label(current);
  const cell = "h-8 w-full rounded-lg text-sm tabular-nums transition-colors duration-75 hover:bg-fill-1 aria-pressed:bg-primary aria-pressed:font-semibold aria-pressed:text-primary-fg";
  return (
    <div ref={root} className="relative">
      {/* A button cannot carry aria-invalid: the error shows as data-invalid (a red hairline) and is read out through aria-describedby. */}
      <button ref={trigger} type="button" id={id} disabled={disabled} aria-label={ariaLabel} data-invalid={ariaInvalid || undefined} aria-describedby={ariaDescribedBy} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popId : undefined} onClick={() => !disabled && setOpen((o) => !o)} className={cn("field flex items-center justify-between gap-2 text-left", size === "sm" && "field-sm", size === "xs" && "field-xs w-auto", !text && "text-subtle", className)}>
        <span className="truncate tabular-nums">{text ? <><span>{text.split("  ")[0]}</span><span className="ml-2 text-xs text-subtle">{text.split("  ")[1]}</span></> : placeholder}</span>
        <Clock3 className="size-4 shrink-0 text-subtle" aria-hidden />
      </button>
      {name ? <input type="text" name={name} value={current} required={required} readOnly tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-0" /> : null}
      <AnimatePresence>
        {open ? (
          <motion.div ref={liftToTopLayer} key="pop" role="dialog" aria-label="Choose a time" initial={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ position: "fixed", top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, zIndex: "var(--z-toast)" as unknown as number }}
            id={popId} className="top-pop popover-surface w-60 p-3 text-foreground">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium text-subtle">Hour</span><span className="text-xs font-medium text-subtle">Minute</span></div>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <div ref={hoursRef} className="prompt-scroll grid max-h-52 grid-cols-2 gap-1 overflow-y-auto pr-1">
                {HOURS.map((h) => <button key={h} type="button" aria-pressed={t?.h === h} onClick={() => commit(h, t?.m ?? 0)} className={cell}>{pad(h)}</button>)}
              </div>
              <div className="prompt-scroll grid max-h-52 grid-cols-2 gap-1 overflow-y-auto pr-1">
                {MINUTES.map((m) => <button key={m} type="button" aria-pressed={t?.m === m} onClick={() => commit(t?.h ?? 9, m)} className={cell}>{pad(m)}</button>)}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-2.5">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => { const p = parse(q)!; commit(p.h, p.m); setOpen(false); trigger.current?.focus(); }} className={cn("inline-flex h-7 items-center rounded-lg px-2 text-xs font-medium tabular-nums transition-colors duration-75", current === q ? "bg-primary text-primary-fg" : "text-secondary hover:bg-fill-1 hover:text-foreground")}>{q}</button>)}
              <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }} className="ml-auto inline-flex h-7 items-center rounded-lg bg-primary px-2.5 text-meta font-medium text-primary-fg hover:bg-primary-hover">Done</button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
