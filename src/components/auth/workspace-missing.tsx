"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The not-found page inside /app/[workspace]. A workspace page answers "not found" for two different things: a
 * workspace the person cannot open, and a task, project or team inside one they can. The address says which
 * workspace was asked for; the person's own workspaces say which case this is, so the page offers the right way back.
 */
export function WorkspaceMissing({ workspaces }: { workspaces: { slug: string; name: string }[] }) {
  const params = useParams<{ workspace?: string }>();
  const pathname = usePathname();
  // The address is /app/<workspace>/…; the route's own param is the first choice, the path the fallback.
  const slug = params?.workspace ?? pathname?.split("/")[2];
  const current = workspaces.find((w) => w.slug === slug);
  const primary = cn(buttonVariants({ size: "lg" }), "w-full");
  if (current) {
    return (
      <AuthShell title="Page not found" subtitle="It may have been moved or deleted, or it is not shared with you." footer={<Link className={AUTH_LINK} href="/app?switch=1">Your workspaces</Link>}>
        <Link href={`/app/${current.slug}`} className={primary}>Back to {current.name}</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Workspace not found" subtitle="Either this workspace does not exist or you are not a member of it." footer={<>Expected to be a member? <Link className={AUTH_LINK} href="/join">Join with a code</Link></>}>
      <Link href="/app" className={primary}>Back to your workspaces</Link>
    </AuthShell>
  );
}
