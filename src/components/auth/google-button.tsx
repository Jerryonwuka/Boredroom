import { googleConfigured } from "@/server/auth/google";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { safeNextPath } from "@/components/auth/next-path";
import { GoogleMark } from "@/components/auth/google-mark";

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
