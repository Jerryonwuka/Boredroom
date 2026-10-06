import Link from "next/link";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Any address nothing answers, outside a workspace: the v3 frame and a way back, instead of Next's unstyled page. */
export default function NotFound() {
  return (
    <AuthShell title="Page not found" subtitle="The address may be mistyped, or the page has moved." footer={<Link className={AUTH_LINK} href="/">Boredroom home</Link>}>
      <Link href="/app" className={cn(buttonVariants({ size: "lg" }), "w-full")}>Go to your workspaces</Link>
    </AuthShell>
  );
}
