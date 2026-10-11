"use client";

/**
 * One step's card on the welcome (owner request, 11 October 2026: the first-run welcome; contract 10.2, "the stage"). The
 * frame every step shares, so each one reads the same: "Step 2 of 4" in the small grey line, the title (the step's one
 * h1, display 28/36, 32/40 from 860px, left-aligned, focused after the person moves), the lede, the body 32px below,
 * then the footer: an outline Back on the left; on the right a ghost secondary ("Keep Brenda", "Later") then the primary,
 * white with an "↵" chip, since Enter in any single-line field continues (the card is one form and the primary is its
 * submit). The end screen's primary is a link instead (`href`), the flow's one orange button (`accent`); Enter on the
 * page follows it too.
 *
 * Errors for the whole step sit in one polite live region above the footer (fields keep their own). The footer is sticky
 * to the bottom of the screen at every width but stays in flow, so it never covers the end of the content, and it keeps
 * clear of a phone's home bar (review, 11 October 2026: from 860px it sat in flow, and on a 1440x900 or 1366x768
 * laptop Continue fell below the fold on Meet your assistant, What's seen and Team). The frame draws no top bar, rail or
 * stage: the flow does.
 *
 * Keyboard and focus (review, 11 October 2026):
 * - The card is one form (`method="post"`, so a press before hydration never puts what was typed, invite addresses
 *   among it, in the address bar, the history or the server's logs). Enter continues from single-line text fields
 *   only: Enter on a checkbox or radio never submits the step; on a switch it flips it, as Space does.
 * - The step's position is part of the focused title ("Step 2 of 4: Meet your assistant"), so arriving announces it.
 * - While a save runs, the primary, Back and the ghost action are marked aria-disabled, never `disabled`: a focused
 *   control that is disabled drops focus to the page, and nothing would put it back.
 * - The 600px card (What's seen) keeps its footer at the 500px column, so the primary sits where it does on every other
 *   step; the title and the lists use the wider card.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, CircleAlert, Loader2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Kbd } from "@/components/ui/badge";
import { WELCOME_WORDS } from "@/lib/welcome";
import { cn } from "@/lib/utils";

export type StepFrameProps = {
  /** "Step 2 of 4"; null on the welcome and on "You're all set". */
  stepLabel: string | null;
  title: string;
  lede?: ReactNode;
  /** One line above the title: the resume or replay note. */
  note?: ReactNode;
  children?: ReactNode;
  /** The step's form submit (Enter in a single-line field): runs the primary action. */
  onSubmit: () => void;
  primary: {
    label: string; loading?: boolean; disabled?: boolean;
    /** The end screen's one orange action. */ accent?: boolean;
    /** A link instead of a submit button (the end screen); Enter follows it. */ href?: string;
  };
  /** Shown as an outline Back button on the left. */
  onBack?: () => void;
  /** A ghost action left of the primary ("Keep Brenda", "Later"). */
  secondary?: { label: string; onClick: () => void; disabled?: boolean } | null;
  /** Small text beside the primary ("4 short steps, all with good defaults."). */
  hint?: ReactNode;
  /** An error for the whole step, in the step's polite live region above the footer. */
  error?: string | null;
  /** The 600px card ("What's seen"). */
  wide?: boolean;
  /** Move focus to the title when this step mounts (after the person moved; not on the first load). */
  focusTitle?: boolean;
  // ---- member_flow's optional additions (contract 10.2 allows them) --------------------------------------------------
  /** Under the primary, left-aligned (the end screen: the first action's hint, its note and "Skip this for now"). */
  below?: ReactNode;
  /** After the footer, outside the form's sticky bar (the end screen's summary on phones, the Mac card). */
  after?: ReactNode;
  /** The end screen: its action row is not sticky (there is no long form to scroll past). */
  staticFooter?: boolean;
  /** The primary's label while it is busy ("Saving…"); the label itself otherwise. */
  busyLabel?: string;
};

/** The "↵" chip in the primary, in the button's own ink (the canvas's chip would vanish on the white primary). */
function EnterChip() {
  return <Kbd className="ml-1 bg-[color-mix(in_srgb,currentColor_12%,transparent)] text-current opacity-80">↵</Kbd>;
}

export function StepFrame(props: StepFrameProps): React.JSX.Element {
  const { stepLabel, title, lede, note, children, onSubmit, primary, onBack, secondary, hint, error, wide = false, focusTitle = false, below, after, staticFooter = false, busyLabel } = props;
  const id = useId();
  const titleId = `${id}-title`;
  const heading = useRef<HTMLHeadingElement>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top > 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // After a move the person made, the new step's title takes focus, so a screen reader starts at the step (11.).
  useEffect(() => { if (focusTitle) heading.current?.focus({ preventScroll: true }); }, [focusTitle]);

  // The end screen's link: Enter anywhere on the page that is not a control follows it, as Continue does elsewhere.
  const href = primary.href;
  useEffect(() => {
    if (!href) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest("a, button, input, select, textarea, summary, [contenteditable=''], [contenteditable='true'], [role='button'], dialog[open]")) return;
      e.preventDefault();
      link.current?.click();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [href]);

  const busy = !!primary.loading;
  const label = busy && busyLabel ? busyLabel : primary.label;
  const held = busy || !!primary.disabled;

  // Enter on a checkbox or radio would submit the form (implicit submission) without changing the control: never.
  // A switch flips instead, as Space does; any other box or radio just keeps its value.
  const onKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    if (!(t instanceof HTMLInputElement) || (t.type !== "checkbox" && t.type !== "radio")) return;
    e.preventDefault();
    if (t.getAttribute("role") === "switch" && !t.disabled && t.getAttribute("aria-disabled") !== "true") t.click();
  };
  const primaryEl = href ? (
    <Link ref={link} href={href} aria-keyshortcuts="Enter"
      className={cn(buttonVariants({ variant: primary.accent ? "accent" : "primary", size: "lg" }), primary.disabled && "pointer-events-none opacity-50")}
      aria-disabled={primary.disabled || undefined}>
      {label}<span aria-hidden><EnterChip /></span>
    </Link>
  ) : (
    // aria-disabled, not disabled: the form's submit ignores it while held, and focus stays on it.
    <Button type="submit" size="lg" variant={primary.accent ? "accent" : "primary"} aria-disabled={held || undefined} aria-busy={busy || undefined}
      aria-keyshortcuts="Enter" className={cn(held && "cursor-not-allowed opacity-50")}>
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}{label}<span aria-hidden><EnterChip /></span>
    </Button>
  );

  return (
    <div className={cn("w-full", wide ? "max-w-[600px]" : "max-w-[500px]")}>
      <form method="post" noValidate aria-labelledby={titleId} onKeyDown={onKeyDown} onSubmit={(e) => { e.preventDefault(); if (!held) onSubmit(); }}>
        {note ? <div className="mb-3 text-meta font-normal text-secondary">{note}</div> : null}
        {/* Seen, not read twice: the title carries the step's position for screen readers. */}
        {stepLabel ? <p aria-hidden className="text-meta font-normal text-secondary">{stepLabel}</p> : null}
        <h1 id={titleId} ref={heading} tabIndex={-1} className="type-headline mt-1 text-left outline-none min-[860px]:text-[32px] min-[860px]:leading-10">
          {stepLabel ? <span className="sr-only">{stepLabel}: </span> : null}{title}
        </h1>
        {lede ? <div className="mt-2 max-w-[56ch] text-sm font-normal text-secondary">{lede}</div> : null}
        {children ? <div className="mt-8">{children}</div> : null}

        {/* The step's one announcement for errors that belong to no field (polite; empty until there is one). */}
        <div role="status" aria-live="polite" className={cn(error ? "mt-6" : "sr-only")}>
          {error ? (
            <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/[0.07] px-3.5 py-2.5 text-sm font-normal text-foreground">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>

        <div className={cn("mt-8", !staticFooter && cn(
          "sticky bottom-0 z-[var(--z-raised)] border-t bg-background py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-colors duration-75",
          "max-[859px]:-mx-4 max-[859px]:px-4 sm:max-[859px]:-mx-5 sm:max-[859px]:px-5",
          // The hairline only while the bar sits over content (stuck), so a short step ends cleanly.
          stuck ? "border-border" : "border-transparent"))}>
          <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-3", wide && "max-w-[500px]")}>
            {onBack ? (
              <Button variant="outline" size="lg" aria-disabled={busy || undefined} className={cn(busy && "cursor-not-allowed opacity-50")} onClick={() => { if (!busy) onBack(); }}>
                <ArrowLeft aria-hidden />{WELCOME_WORDS.buttons.back}
              </Button>
            ) : null}
            <div className={cn("flex min-w-0 items-center gap-2", onBack && "ml-auto")}>
              {secondary ? (
                <Button variant="ghost" size="lg" aria-disabled={secondary.disabled || busy || undefined} className={cn((secondary.disabled || busy) && "cursor-not-allowed opacity-50")}
                  onClick={() => { if (!secondary.disabled && !busy) secondary.onClick(); }}>{secondary.label}</Button>
              ) : null}
              {primaryEl}
            </div>
            {hint ? <span className={cn("min-w-0 text-meta font-normal text-secondary", onBack && "basis-full text-right")}>{hint}</span> : null}
          </div>
          {below ? <div className="mt-3">{below}</div> : null}
        </div>
        {/* Out of view exactly while the footer above is stuck to the bottom of the screen. */}
        {staticFooter ? null : <div ref={sentinel} aria-hidden className="h-px" />}
      </form>
      {after}
    </div>
  );
}
