"use client";

/**
 * The time field (owner decision, 25 September 2026: no native pickers). A `.field` button showing the time, which
 * opens two columns, hours and minutes, with the current choice lit in orange, plus a row of common times. Writes
 * "HH:MM" to a hidden input under `name`, exactly what the native time input produced. Controlled or uncontrolled.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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

export function TimePicker({ name, id, value, defaultValue, onChange, required, placeholder = "Pick a time", className, size = "md", "aria-label": ariaLabel, disabled }: {
  name?: string; id?: string; value?: string; defaultValue?: string; onChange?: (v: string) => void; required?: boolean; placeholder?: string; className?: string; size?: "sm" | "md"; "aria-label"?: string; disabled?: boolean;
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
  const commit = (h: number, m: number) => { const v = `${pad(h)}:${pad(m)}`; if (!controlled) setInner(v); onChange?.(v); };

  const place = () => {
    const r = trigger.current?.getBoundingClientRect(); if (!r) return;
    const up = r.bottom + 300 > window.innerHeight && r.top > 300;
    setPos({ top: up ? r.top - 8 : r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 248)), up });
  };
  useLayoutEffect(() => { if (open) { place(); requestAnimationFrame(() => hoursRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.scrollIntoView({ block: "center" })); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey); window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = label(current);
  const cell = "h-8 w-full rounded-[8px] text-sm tabular-nums transition-colors duration-[var(--duration-fast)] hover:bg-wash-strong aria-pressed:bg-accent aria-pressed:font-semibold aria-pressed:text-accent-fg";
  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" id={id} disabled={disabled} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} onClick={() => !disabled && setOpen((o) => !o)} className={cn("field flex items-center justify-between gap-2 text-left", size === "sm" && "field-sm", !text && "text-fg-subtle", className)}>
        <span className="truncate tabular-nums">{text ? <><span>{text.split("  ")[0]}</span><span className="ml-2 text-xs text-fg-subtle">{text.split("  ")[1]}</span></> : placeholder}</span>
        <Clock3 className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      </button>
      {name ? <input type="text" name={name} value={current} required={required} readOnly tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-0" /> : null}
      <AnimatePresence>
        {open ? (
          <motion.div ref={liftToTopLayer} key="pop" role="dialog" aria-label="Choose a time" initial={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ position: "fixed", top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, zIndex: "var(--z-toast)" as unknown as number }}
            className="top-pop w-60 rounded-[var(--radius)] border border-border-strong bg-popover p-3 text-fg shadow-[var(--card-shadow)]">
            <div className="mb-2 flex items-center justify-between"><span className="eyebrow">Hour</span><span className="eyebrow">Minute</span></div>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <div ref={hoursRef} className="prompt-scroll grid max-h-52 grid-cols-2 gap-1 overflow-y-auto pr-1">
                {HOURS.map((h) => <button key={h} type="button" aria-pressed={t?.h === h} onClick={() => commit(h, t?.m ?? 0)} className={cell}>{pad(h)}</button>)}
              </div>
              <div className="prompt-scroll grid max-h-52 grid-cols-2 gap-1 overflow-y-auto pr-1">
                {MINUTES.map((m) => <button key={m} type="button" aria-pressed={t?.m === m} onClick={() => commit(t?.h ?? 9, m)} className={cell}>{pad(m)}</button>)}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1 border-t border-border-soft pt-2.5">
              {QUICK.map((q) => <button key={q} type="button" onClick={() => { const p = parse(q)!; commit(p.h, p.m); setOpen(false); trigger.current?.focus(); }} className={cn("rounded-full px-2.5 py-1 text-xs tabular-nums transition-colors", current === q ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-wash hover:text-fg")}>{q}</button>)}
              <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }} className="ml-auto rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-fg">Done</button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
