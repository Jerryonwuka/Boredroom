"use client";

import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Toasts, v4 (spec §7 Toasts): the toast surface (grey at 85% in dark, white in light) with the toast shadow, r12,
 * the title 14/20 medium, the description in white at 71%, and a coloured status dot with a 15% halo. They float at the
 * bottom left (the Toaster lives in components/app/message-toasts.tsx) and leave after five seconds.
 * Its own module, so a form that only confirms does not pull a whole page into its bundle.
 */
export type ToastTone = "success" | "warning" | "danger" | "neutral";
const DOT: Record<ToastTone, string> = { success: "bg-success shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_15%,transparent)]", warning: "bg-warning shadow-[0_0_0_3px_color-mix(in_srgb,var(--warning)_15%,transparent)]", danger: "bg-danger shadow-[0_0_0_3px_color-mix(in_srgb,var(--danger)_15%,transparent)]", neutral: "bg-secondary shadow-[0_0_0_3px_var(--fill-1)]" };

/** The toast's body, for custom toasts and for showing one in place (the design gallery). */
export function ToastCard({ title, description, tone = "success", action, className }: { title: React.ReactNode; description?: React.ReactNode; tone?: ToastTone; action?: React.ReactNode; className?: string }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("toast-surface flex w-[340px] max-w-[calc(100vw-2rem)] items-start gap-3 px-4 py-3", className)}>
      <span className={cn("mt-[7px] size-1.5 shrink-0 rounded-full", DOT[tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="mt-0.5 text-sm font-normal text-[var(--toast-description)]">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** Shows a toast. `tone` colours the dot; danger toasts stay twice as long. */
export function notify(title: string, opts: { description?: string; tone?: ToastTone; duration?: number } = {}) {
  const tone = opts.tone ?? "neutral";
  toast.custom(() => <ToastCard title={title} description={opts.description} tone={tone} />, { duration: opts.duration ?? (tone === "danger" ? 10000 : 5000) });
}

/** The line that confirms something went through (owner decision, 26 September 2026): a green-dot toast. */
export function successToast(title: string, body?: string) {
  notify(title, { description: body, tone: "success" });
}
