"use client";

/**
 * Next steps on the assistant's page (owner request, 11 October 2026: the first-run welcome; contract 6.4). After the
 * welcome (finished or skipped), or once an unfinished one has stopped opening by itself, the last thing in her column
 * lists what is left of the person's first things to do: finishing the welcome, inviting the team, a first task, planning
 * today, the Mac app. Only what is left, read from data on the server (nextStepsFor), at most three, with a count, never a
 * fraction or a bar (no "60% complete" nagging). ✕ hides it for good (Settings, Your assistant, brings it back); if that
 * cannot be saved it comes back and says so. Her panel's own fill, no orange.
 *
 * Focus (review, 11 October 2026): ✕ takes the focused button away, so focus moves to a short status in its place
 * ("Next steps hidden.", announced); if the hide cannot be saved, the card comes back with focus on its heading.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { api } from "@/lib/api-client";
import { WELCOME_WORDS, type NextSteps } from "@/lib/welcome";

const N = WELCOME_WORDS.nextSteps;

export function NextStepsCard({ orgSlug, steps }: { orgSlug: string; steps: NextSteps }) {
  const id = useId();
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Where focus goes once the card changes: the status in its place, or back to the card when hiding failed.
  const [focusTo, setFocusTo] = useState<"status" | "card" | null>(null);
  useEffect(() => {
    if (focusTo === "status") status.current?.focus();
    else if (focusTo === "card") heading.current?.focus();
  }, [focusTo, hidden]);

  if (!steps.items.length) return null;
  if (hidden) {
    return <p ref={status} tabIndex={-1} role="status" className="sr-only">{N.hidden}</p>;
  }

  const hide = async () => {
    setHidden(true); setFailed(false); setFocusTo("status");
    try {
      await api(`/api/orgs/${orgSlug}/welcome`, { method: "PATCH", body: { nextStepsHidden: true }, retries: 1 });
    } catch {
      setHidden(false); setFailed(true); setFocusTo("card");
    }
  };

  return (
    <section aria-labelledby={`${id}-title`} className="mt-5 rounded-2xl border border-border bg-[color:var(--brenda-fill)] p-3 shadow-none">
      <div className="flex items-center gap-2 pl-2">
        <h2 id={`${id}-title`} ref={heading} tabIndex={-1} className="text-sm font-medium text-foreground outline-none">{N.title}</h2>
        <span className="text-meta font-normal tabular-nums text-secondary">{N.left(steps.left)}</span>
        <IconButton aria-label={N.hide} onClick={() => void hide()} className="ml-auto"><X aria-hidden /></IconButton>
      </div>
      <ul className="mt-1">
        {steps.items.slice(0, 3).map((item) => {
          const inner = (
            <>
              <span aria-hidden className="size-4 shrink-0 rounded-full border-[1.5px] border-border-input-hover" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{item.label}</span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-secondary" />
            </>
          );
          const cls = "flex h-10 items-center gap-3 rounded-lg px-2 transition-colors duration-75 hover:bg-fill-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";
          return (
            <li key={item.key}>
              {item.external
                ? <a href={item.href} target="_blank" rel="noreferrer" className={cls}>{inner}</a>
                : <Link href={item.href} className={cls}>{inner}</Link>}
            </li>
          );
        })}
      </ul>
      {failed ? <p role="alert" className="mt-1 px-2 text-meta text-danger">{N.hideFailed}</p> : null}
    </section>
  );
}
