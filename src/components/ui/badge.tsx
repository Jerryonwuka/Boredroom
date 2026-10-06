import { cn } from "@/lib/utils";

/**
 * Badges and small labels, v4 with the accent rules (owner decision, 6 October 2026).
 * - `Badge`: a pill, h20 px8, 12/16 medium. `neutral` = fill-1 with foreground text; `accent` (alias `attention`) = the
 *   orange tinted fill (accent-soft, accent-text) for "New" and things that want the person's attention; status tones
 *   (`success`, `warning`, `danger`) = a 12% wash with the status colour; `info` is a neutral grey in v4. `dot` adds a
 *   small dot in the tone's colour before the label (status lists read "● Running").
 * - `NewBadge`: the tiny h16 orange "New" tag (10/16).
 * - `CountPill`: the tiny h20 count (10/16 semibold, tabular). `tone="neutral"` (default) = fill-075, secondary, for plain
 *   counts (a tab's items, a list's size). `tone="attention"` = orange (accent-soft fill, accent-text): unread messages,
 *   reviews waiting, anything that asks the person to act; the sidebar's counts are all attention.
 * - `MonoChip`: r6 mono count/ID chip (12/16 Geist Mono, grey-75, secondary).
 * - `Kbd`: a key in a 20px rounded-6 chip, 11px.
 */
type Tone = "neutral" | "accent" | "attention" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-fill-1 text-foreground",
  accent: "bg-accent-soft text-accent-text",
  attention: "bg-accent-soft text-accent-text",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  info: "bg-fill-1 text-secondary",
};
const dots: Record<Tone, string> = { neutral: "bg-secondary", accent: "bg-accent", attention: "bg-accent", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-subtle" };

export function Badge({ tone = "neutral", children, className, dot, size = "md" }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean; /** `sm` is the 16px tag (10/16), `md` the 20px pill, `lg` 24px. */ size?: "sm" | "md" | "lg" }) {
  return (
    <span className={cn("badge inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-medium tabular-nums",
      size === "sm" ? "h-4 px-1.5 text-2xs" : size === "lg" ? "h-6 px-2.5 text-xs" : "h-5 px-2 text-xs", tones[tone], className)}>
      {dot ? <span className={cn("size-1.5 shrink-0 rounded-full", dots[tone])} aria-hidden /> : null}
      {children}
    </span>
  );
}

/** The tiny "New" tag beside a nav item or a title. */
export function NewBadge({ children = "New", className }: { children?: React.ReactNode; className?: string }) {
  return <Badge tone="accent" size="sm" className={className}>{children}</Badge>;
}

/**
 * A count beside a label (tabs, nav, list meta). Renders nothing for 0 unless `showZero`. `tone="attention"` draws it
 * orange: unread, waiting for the person, needs them (never for a plain total).
 */
export function CountPill({ count, className, showZero = false, max = 99, tone = "neutral" }: { count: number; className?: string; showZero?: boolean; max?: number; tone?: "neutral" | "attention" }) {
  if (!count && !showZero) return null;
  return <span className={cn("inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-2xs font-semibold tabular-nums", tone === "attention" ? "bg-accent-soft text-accent-text" : "bg-fill-075 text-secondary", className)}>{count > max ? `${max}+` : count}</span>;
}

/** A mono chip for counts, IDs and codes. */
export function MonoChip({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-md bg-grey-75 px-1.5 py-0.5 font-mono text-xs tabular-nums text-secondary", className)}>{children}</span>;
}

/** A keyboard key: ⌘, K, Esc. Put several side by side with a 4px gap. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}

/** v4: monochrome first. To do is the quiet grey, in progress the foreground, waiting for a check amber; orange stays rare. */
export const TASK_STATUS_TONE: Record<string, Tone> = { todo: "info", in_progress: "neutral", blocked: "danger", in_review: "warning", completed: "success" };
/** A task status in the words the Tasks tabs use, everywhere a status is shown. */
export const TASK_STATUS_LABEL: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", in_review: "Sent for check", completed: "Completed" };
export const taskStatusLabel = (s: string) => TASK_STATUS_LABEL[s] ?? label(s);
export const SESSION_STATE_TONE: Record<string, Tone> = { running: "success", paused: "warning", interrupted: "danger", stopped: "neutral" };

export function label(s: string) {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
