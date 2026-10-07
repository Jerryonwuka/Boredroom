import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Page notes (owner request, 7 October 2026: "On all places where these kinds of texts show, let them be in small
 * fonts, faint or grey, and stick at the bottom of the page instead"). The explanatory lines a screen does not need in
 * order to be used: what a status or a term means, how a figure is worked out or where it comes from, which time zone
 * or period figures use, privacy reassurances, policy fine print. Not labels, page descriptions, empty states, errors, warnings, form hints or consent.
 *
 * Usage: the LAST child of the page, directly inside `<AppShell>` (a fragment there is fine), one `PageNote` per note:
 *
 *   <AppShell …>
 *     <PageHeader … />
 *     …
 *     <PageNotes>
 *       <PageNote>Status comes from timers only.</PageNote>
 *       <PageNote section="Working now">Paused means no heartbeat for 90s.</PageNote>
 *     </PageNotes>
 *   </AppShell>
 *
 * The shell lifts it out of the page's content and makes it the main column's last item, where `margin-top: auto`
 * puts it at the bottom of the screen on a short page and after the content on a long one. Nested deeper (inside a
 * wrapper element or a client component) it still renders, right after its siblings, but cannot reach the bottom.
 *
 * Look (owner request, 7 October 2026: "very small and almost not noticeable"): 11/16 regular in the subtle grey
 * (still 5.8:1 dark, 4.7:1 light), running the full width of the page so a note takes as few lines as possible, tight
 * spacing under a full-width hairline, at least 32px below the content. No icons. A note that only makes sense beside one section
 * names it first (`section`). Server-safe (no hooks), so client components may import it too. Notes that are all
 * conditional and all off render nothing.
 */
export function PageNotes({ children, label = "Notes", className }: { children: ReactNode; label?: string; className?: string }) {
  if (Children.toArray(children).length === 0) return null;
  return (
    <aside aria-label={label} data-page-notes className={cn("mt-auto w-full min-w-0 pt-8", className)}>
      <div className="space-y-0.5 border-t border-border pt-2 text-[11px] font-normal leading-4 text-subtle">{children}</div>
    </aside>
  );
}

/** One note: a short plain sentence or two. `section` names the part of the page it belongs to ("Working now: …"). */
export function PageNote({ children, section, className }: { children: ReactNode; section?: string; className?: string }) {
  return (
    <p className={cn("text-pretty break-words", className)}>
      {section ? <><span className="font-medium text-secondary">{section}:</span>{" "}</> : null}
      {children}
    </p>
  );
}
