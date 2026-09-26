"use client";

/**
 * The calendar picker behind every date, month and date-and-time field (owner decision, 25 September 2026: no
 * native pickers). It is a `.field` button that opens a small calendar; the chosen value goes into a hidden input
 * under the given `name`, in the same strings the native inputs used (yyyy-mm-dd, yyyy-mm, yyyy-mm-ddThh:mm), so
 * every form and query parameter keeps working. Works uncontrolled (defaultValue) or controlled (value/onChange).
 * The heading is a button: days → months → years, so any date is three taps away rather than a long scroll.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { liftToTopLayer } from "@/components/ui/top-layer";
import { TimePicker } from "@/components/ui/time-picker";

export type DateMode = "date" | "month" | "datetime";
type Level = "days" | "months" | "years";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Splits a value into its date part and, for datetime, its time part. */
function parse(value: string | undefined, mode: DateMode): { date: Date | null; time: string } {
  if (!value) return { date: null, time: "" };
  const [datePart, timePart = ""] = value.split("T");
  const [y, m, d = "1"] = datePart.split("-").map(Number);
  if (!y || !m) return { date: null, time: "" };
  const date = new Date(y, m - 1, Number(d));
  if (Number.isNaN(date.getTime())) return { date: null, time: "" };
  return { date, time: mode === "datetime" ? timePart.slice(0, 5) : "" };
}

function serialise(date: Date | null, time: string, mode: DateMode) {
  if (!date) return "";
  if (mode === "month") return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  if (mode === "datetime") return `${ymd(date)}T${time || "09:00"}`;
  return ymd(date);
}

function label(date: Date | null, time: string, mode: DateMode) {
  if (!date) return "";
  if (mode === "month") return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return mode === "datetime" && time ? `${day}, ${time}` : day;
}

/** The 42 cells of a month view, Monday first, padded with the neighbouring months. */
function cells(view: Date) {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(1 - offset);
  return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}

const navBtn = "grid size-8 place-items-center rounded-full text-fg-muted transition-colors duration-[var(--duration-fast)] hover:bg-wash hover:text-fg";
const cellBtn = "h-10 rounded-[var(--radius-sm)] text-sm tabular-nums transition-colors duration-[var(--duration-fast)]";

export function DatePicker({ name, id, mode = "date", value, defaultValue, onChange, min, max, required, placeholder, className, size = "md", "aria-label": ariaLabel, disabled, submitOnChange = false }: {
  /** Submits the enclosing form as soon as a value is picked, so filter bars need no Show button. */
  submitOnChange?: boolean;
  name?: string; id?: string; mode?: DateMode; value?: string; defaultValue?: string; onChange?: (value: string) => void; min?: string; max?: string;
  required?: boolean; placeholder?: string; className?: string; size?: "sm" | "md"; "aria-label"?: string; disabled?: boolean;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = controlled ? value : inner;
  const { date, time } = parse(current, mode);
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<Level>(mode === "month" ? "months" : "days");
  const [view, setView] = useState<Date>(() => date ?? new Date());
  const [focusDay, setFocusDay] = useState<Date | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const uid = useId();
  const popId = `${uid}-pop`;

  const commit = (next: string) => {
    if (!controlled) setInner(next);
    onChange?.(next);
    if (submitOnChange && next) window.setTimeout(() => root.current?.closest("form")?.requestSubmit(), 0);
  };
  const minD = parse(min, mode === "month" ? "month" : "date").date;
  const maxD = parse(max, mode === "month" ? "month" : "date").date;
  const outside = (d: Date) => (minD ? d < new Date(minD.getFullYear(), minD.getMonth(), mode === "month" ? 1 : minD.getDate()) : false) || (maxD ? d > new Date(maxD.getFullYear(), maxD.getMonth(), mode === "month" ? 31 : maxD.getDate(), 23, 59) : false);
  const yearOutside = (y: number) => (minD ? y < minD.getFullYear() : false) || (maxD ? y > maxD.getFullYear() : false);

  const place = () => {
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    const height = mode === "datetime" ? 392 : 340;
    const up = r.bottom + height + 12 > window.innerHeight && r.top > height + 12;
    setPos({ top: up ? r.top - 8 : r.bottom + 8, left: Math.max(8, Math.min(r.left, window.innerWidth - 296)), up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    const onMove = () => place();
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove); window.addEventListener("scroll", onMove, true);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onMove); window.removeEventListener("scroll", onMove, true); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => { setOpen(false); trigger.current?.focus(); };
  const show = () => { if (disabled) return; setView(date ?? new Date()); setFocusDay(date ?? new Date()); setLevel(mode === "month" ? "months" : "days"); setOpen((o) => !o); };
  const pick = (d: Date) => {
    if (outside(d)) return;
    commit(serialise(d, time, mode));
    if (mode !== "datetime") close();
  };
  const pickMonth = (m: number) => {
    const d = new Date(view.getFullYear(), m, 1);
    if (mode === "month") { pick(d); return; }
    setView(d); setFocusDay(new Date(d.getFullYear(), m, Math.min(date?.getDate() ?? 1, 28))); setLevel("days");
  };
  const pickYear = (y: number) => { setView(new Date(y, view.getMonth(), 1)); setLevel("months"); };
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!focusDay) return;
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) { e.preventDefault(); const d = new Date(focusDay); d.setDate(d.getDate() + step[e.key]); setFocusDay(d); if (d.getMonth() !== view.getMonth()) setView(new Date(d.getFullYear(), d.getMonth(), 1)); requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${ymd(d)}"]`)?.focus()); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(focusDay); }
  };
  const today = new Date();
  const text = label(date, time, mode);
  const field = cn("field flex items-center justify-between gap-2 text-left", size === "sm" && "field-sm", !text && "text-fg-subtle", className);
  const decadeStart = Math.floor(view.getFullYear() / 12) * 12;
  const years = Array.from({ length: 12 }, (_, i) => decadeStart + i);

  // The heading: a button that climbs one level (days → months → years), flanked by arrows that move at that level.
  const heading = level === "days"
    ? { prev: () => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1)), next: () => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1)), up: () => setLevel("months"), text: <><span>{MONTHS[view.getMonth()]}</span> <span className="tabular-nums text-fg-muted">{view.getFullYear()}</span></>, hint: "Choose a month", unit: "month" }
    : level === "months"
      ? { prev: () => setView(new Date(view.getFullYear() - 1, view.getMonth(), 1)), next: () => setView(new Date(view.getFullYear() + 1, view.getMonth(), 1)), up: () => setLevel("years"), text: <span className="tabular-nums">{view.getFullYear()}</span>, hint: "Choose a year", unit: "year" }
      : { prev: () => setView(new Date(view.getFullYear() - 12, view.getMonth(), 1)), next: () => setView(new Date(view.getFullYear() + 12, view.getMonth(), 1)), up: undefined, text: <span className="tabular-nums">{decadeStart}–{decadeStart + 11}</span>, hint: "", unit: "12 years" };

  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" id={id} disabled={disabled} aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? popId : undefined} onClick={show} className={field}>
        <span className="truncate tabular-nums">{text || placeholder || (mode === "month" ? "Pick a month" : mode === "datetime" ? "Pick a date and time" : "Pick a date")}</span>
        <span className="flex shrink-0 items-center gap-1 text-fg-subtle">
          {text && !required ? <span role="button" tabIndex={-1} aria-label="Clear" onClick={(e) => { e.stopPropagation(); commit(""); }} className="grid size-5 place-items-center rounded-full hover:bg-wash-strong hover:text-fg"><X className="size-3" aria-hidden /></span> : null}
          {mode === "datetime" ? <Clock3 className="size-4" aria-hidden /> : <CalendarDays className="size-4" aria-hidden />}
        </span>
      </button>
      {name ? <input type="text" name={name} value={current} required={required} readOnly tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-0" /> : null}
      <AnimatePresence>
        {open ? (
          <motion.div ref={liftToTopLayer} key="pop" id={popId} role="dialog" aria-label={mode === "month" ? "Choose a month" : "Choose a date"} initial={{ opacity: 0, y: pos.up ? 6 : -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: pos.up ? 4 : -4, scale: 0.98 }} transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
            style={{ position: "fixed", top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, zIndex: "var(--z-toast)" as unknown as number }}
            className="top-pop w-72 rounded-[var(--radius)] border border-border-strong bg-popover p-3 text-fg shadow-[var(--card-shadow)]">
            <div className="mb-2 flex items-center justify-between">
              <button type="button" aria-label={`Previous ${heading.unit}`} onClick={heading.prev} className={navBtn}><ChevronLeft className="size-4" aria-hidden /></button>
              {heading.up ? <button type="button" onClick={heading.up} title={heading.hint} className="rounded-full px-3 py-1 font-display text-base transition-colors duration-[var(--duration-fast)] hover:bg-wash">{heading.text}</button> : <span className="px-3 py-1 font-display text-base">{heading.text}</span>}
              <button type="button" aria-label={`Next ${heading.unit}`} onClick={heading.next} className={navBtn}><ChevronRight className="size-4" aria-hidden /></button>
            </div>

            {level === "years" ? (
              <div className="grid grid-cols-3 gap-1" role="listbox" aria-label="Year">
                {years.map((y) => { const sel = view.getFullYear() === y; const now = today.getFullYear() === y; const off = yearOutside(y); return (
                  <button key={y} type="button" role="option" aria-selected={sel} disabled={off} onClick={() => pickYear(y)} className={cn(cellBtn, sel ? "bg-accent font-semibold text-accent-fg" : "hover:bg-wash", now && !sel && "ring-1 ring-inset ring-accent/50", off && "opacity-30")}>{y}</button>
                ); })}
              </div>
            ) : level === "months" ? (
              <div className="grid grid-cols-3 gap-1" role="listbox" aria-label="Month">
                {MONTHS.map((m, i) => { const d = new Date(view.getFullYear(), i, 1); const sel = !!date && date.getFullYear() === d.getFullYear() && date.getMonth() === i; const now = today.getFullYear() === d.getFullYear() && today.getMonth() === i; const off = mode === "month" ? outside(d) : yearOutside(d.getFullYear()); return (
                  <button key={m} type="button" role="option" aria-selected={sel} disabled={off} onClick={() => pickMonth(i)} className={cn(cellBtn, sel ? "bg-accent font-semibold text-accent-fg" : "hover:bg-wash", now && !sel && "ring-1 ring-inset ring-accent/50", off && "opacity-30")}>{m.slice(0, 3)}</button>
                ); })}
              </div>
            ) : (
              <>
                <div className="mb-1 grid grid-cols-7 text-center">{DAYS.map((d) => <span key={d} className="eyebrow py-1">{d}</span>)}</div>
                <div ref={grid} role="grid" aria-label={`${MONTHS[view.getMonth()]} ${view.getFullYear()}`} className="grid grid-cols-7 gap-y-0.5" onKeyDown={move}>
                  {cells(view).map((d) => { const inMonth = d.getMonth() === view.getMonth(); const sel = !!date && sameDay(d, date); const now = sameDay(d, today); const off = outside(d); const focus = focusDay ? sameDay(d, focusDay) : sel; return (
                    <button key={ymd(d)} type="button" role="gridcell" data-day={ymd(d)} tabIndex={focus ? 0 : -1} disabled={off} aria-selected={sel} aria-label={d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} onFocus={() => setFocusDay(d)} onClick={() => pick(d)}
                      className={cn("mx-auto grid size-9 place-items-center rounded-full text-sm tabular-nums transition-colors duration-[var(--duration-fast)]", sel ? "bg-accent font-semibold text-accent-fg shadow-[0_6px_16px_-8px_var(--accent)]" : "hover:bg-wash-strong", !inMonth && !sel && "text-fg-faint", now && !sel && "ring-1 ring-inset ring-accent/60 font-semibold", off && "opacity-30 hover:bg-transparent")}>{d.getDate()}</button>
                  ); })}
                </div>
                {mode === "datetime" ? (
                  <div className="mt-3 flex items-center gap-2 text-xs font-medium text-fg-subtle"><span className="w-10">Time</span><TimePicker size="sm" className="flex-1" aria-label="Time" value={time || "09:00"} onChange={(v) => commit(serialise(date ?? today, v, mode))} /></div>
                ) : null}
              </>
            )}

            <div className="mt-3 flex items-center justify-between border-t border-border-soft pt-2.5 text-xs">
              <button type="button" onClick={() => { commit(""); close(); }} className="rounded-full px-2.5 py-1 text-fg-muted hover:bg-wash hover:text-fg">Clear</button>
              <div className="flex gap-1">
                <button type="button" onClick={() => { const t = new Date(); setView(new Date(t.getFullYear(), t.getMonth(), 1)); setFocusDay(t); setLevel(mode === "month" ? "months" : "days"); pick(mode === "month" ? new Date(t.getFullYear(), t.getMonth(), 1) : t); }} className="rounded-full px-2.5 py-1 text-fg-muted hover:bg-wash hover:text-fg">Today</button>
                {mode === "datetime" ? <button type="button" onClick={close} className="rounded-full bg-accent px-3 py-1 font-semibold text-accent-fg">Done</button> : null}
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
