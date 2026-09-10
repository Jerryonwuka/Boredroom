import { Logo } from "@/components/logo";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main id="main" className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute -top-[420px] left-1/2 h-[760px] w-[1100px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,108,2,0.45),rgba(255,108,2,0.12)_55%,transparent_75%)] blur-2xl" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <Logo className="text-2xl" />
          <h1 className="mt-6 text-3xl font-display">{title}</h1>
          {subtitle ? <p className="mt-2 text-fg-muted">{subtitle}</p> : null}
        </div>
        <div className="tile p-6 md:p-8">{children}</div>
        {footer ? <div className="mt-6 text-center text-sm text-fg-muted">{footer}</div> : null}
      </div>
    </main>
  );
}
