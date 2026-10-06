import { googleConfigured } from "@/server/auth/google";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeNextPath } from "@/components/auth/next-path";

/**
 * "Continue with Google": a full-width 40px outline button with Google's mark (v4: secondary actions are outline), then
 * a hairline rule with "or" between it and the email form. Renders nothing until the server has Google credentials.
 * A fragment, so the entry column's 24px gap spaces the button, the rule and the form evenly.
 */
export function GoogleSignIn({ next, label = "Continue with Google" }: { next?: string | null; label?: string }) {
  if (!googleConfigured()) return null;
  const href = `/api/auth/google/start${next ? `?next=${encodeURIComponent(safeNextPath(next))}` : ""}`;
  return (
    <>
      {/* A plain anchor: the start route answers with a redirect to Google, which a client-side navigation cannot follow. */}
      <a href={href} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "w-full gap-2")}>
        <GoogleMark />
        {label}
      </a>
      <p className="flex items-center gap-3 text-xs font-medium text-subtle before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">or</p>
    </>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="shrink-0" aria-hidden>
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.53 5.53 0 0 1-2.4 3.63v3.01h3.88c2.27-2.09 3.54-5.17 3.54-8.88z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.94-2.91l-3.88-3.01c-1.08.72-2.45 1.16-4.06 1.16-3.12 0-5.77-2.11-6.71-4.95H1.28v3.09A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.29 14.29A7.2 7.2 0 0 1 4.91 12c0-.8.14-1.57.38-2.29V6.62H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.38l4.01-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.62l4.01 3.09C6.23 6.86 8.88 4.75 12 4.75z" />
    </svg>
  );
}
