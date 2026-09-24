import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main id="main" className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-12">
      <ThemeToggle className="absolute right-4 top-4 z-[var(--z-raised)]" />
      <div aria-hidden className="pointer-events-none absolute -top-[420px] left-1/2 h-[760px] w-[1100px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,108,2,0.45),rgba(255,108,2,0.12)_55%,transparent_75%)] blur-2xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
          <h1 className="mt-6 font-display text-[30px] leading-[1.1] tracking-[-0.02em] md:text-[36px]">{title}</h1>
          {subtitle ? <p className="mt-2 text-fg-muted">{subtitle}</p> : null}
        </div>
        <div className="tile p-6 md:p-8">{children}</div>
        {footer ? <div className="mt-6 text-center text-sm text-fg-muted">{footer}</div> : null}
      </div>
    </main>
  );
}
