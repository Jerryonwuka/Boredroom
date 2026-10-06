import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { cn } from "@/lib/utils";

/**
 * A text link on the way in (footers, notices, alerts): the foreground colour, medium weight, with a quiet underline
 * that turns orange on hover (accent rules, 6 October 2026: links in running text), so it reads as a link in a
 * sentence without colour alone.
 */
export const AUTH_LINK = "rounded-[4px] font-medium text-foreground underline decoration-border-input-hover underline-offset-4 transition-colors duration-75 hover:decoration-accent";

/**
 * The heading of an entry screen (v4, spec §3): an optional step count in the secondary grey ("Step 1 of 2", never a
 * numbered badge), the display title 24/30, and a description 14/20 regular in the secondary grey, all centred.
 * `ref` makes the title focusable from script, so a stepped form can move focus to the new step's title.
 */
export function AuthHeading({ step, title, subtitle, ref, className }: { step?: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; ref?: React.Ref<HTMLHeadingElement>; className?: string }) {
  return (
    <div className={cn("mb-8 text-center", className)}>
      {step ? <p className="mb-2 text-meta font-normal text-secondary">{step}</p> : null}
      <h1 ref={ref} tabIndex={ref ? -1 : undefined} className="type-page-title break-words outline-none">{title}</h1>
      {subtitle ? <p className="mx-auto mt-2 max-w-[360px] text-balance break-words text-sm font-normal text-secondary">{subtitle}</p> : null}
    </div>
  );
}

/**
 * The frame for every screen on the way in (sign in, sign up, verify, recover, invite, join, onboarding, the workspace
 * list) and the few pages outside a workspace. v4, ElevenLabs-style: the canvas and nothing else (no card, no glow);
 * the logo (18px) top left and the theme switch top right, 20px from the edges; then one centred column, 400px wide
 * (`wide`: 480px, for lists), with the heading, the form, and small secondary links beneath. Below 640px the column
 * starts near the top instead of the middle, so the keyboard does not push the form away.
 *
 * Without a `title` the children bring their own heading (`AuthHeading`), as the stepped onboarding form does.
 * `actions` sit in the top bar beside the theme switch (Sign out on the workspace list).
 */
export function AuthShell({ title, subtitle, step, children, footer, actions, width = "form" }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; step?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; actions?: React.ReactNode; width?: "form" | "wide";
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 px-5">
        <Logo height={18} />
        <div className="flex items-center gap-1.5">
          <ThemeToggle />
          {actions}
        </div>
      </header>
      <main id="main" className="flex flex-1 flex-col px-5 pb-16 pt-6 sm:pt-0">
        <div className={cn("mx-auto w-full sm:my-auto", width === "wide" ? "max-w-[480px]" : "max-w-[400px]")}>
          {title ? <AuthHeading step={step} title={title} subtitle={subtitle} /> : null}
          <div className="flex flex-col gap-6">{children}</div>
          {/* Footer links stand alone, so each gets a 32px tall target; links inside sentences elsewhere stay inline. */}
          {footer ? <div className="mt-8 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-center text-meta font-normal text-secondary [&>a]:inline-flex [&>a]:min-h-8 [&>a]:items-center pointer-coarse:[&>a]:min-h-10">{footer}</div> : null}
        </div>
      </main>
    </div>
  );
}
