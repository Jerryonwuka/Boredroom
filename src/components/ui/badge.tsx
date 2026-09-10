import { cn } from "@/lib/utils";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-white/6 text-fg-muted border-border",
  accent: "bg-accent-soft text-accent border-accent/30",
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning border-warning/30",
  danger: "bg-danger/10 text-danger border-danger/30",
  info: "bg-info/10 text-info border-info/30",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

export const TASK_STATUS_TONE: Record<string, Tone> = { todo: "neutral", in_progress: "accent", blocked: "danger", in_review: "info", completed: "success" };
export const SESSION_STATE_TONE: Record<string, Tone> = { running: "success", paused: "warning", interrupted: "danger", stopped: "neutral" };
export const REPORT_STATUS_TONE: Record<string, Tone> = { draft: "neutral", submitted: "info", changes_requested: "warning", approved: "success", superseded: "neutral", withdrawn: "neutral" };

export function label(s: string) {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
