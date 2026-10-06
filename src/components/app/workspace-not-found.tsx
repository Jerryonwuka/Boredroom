"use client";

/**
 * The not-found page inside /app/[workspace], v4. A workspace page answers "not found" for two different things: a
 * workspace the person cannot open, and a task, project or team inside one they can. The address says which workspace
 * was asked for; the person's own workspaces say which case this is, so the page offers the right way back.
 *
 * A quiet frame of its own (the workspace's shell needs a workspace): the 50px bar with the logo and the theme switch,
 * then the v4 empty state in the middle of the screen: a line icon, the title in the display face at 24/30, one line
 * in the secondary grey, a primary button and an outline one.
 */
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { FileQuestion, Building2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";

export function WorkspaceNotFoundView({ workspaces }: { workspaces: { slug: string; name: string }[] }) {
  const params = useParams<{ workspace?: string }>();
  const pathname = usePathname();
  // The address is /app/<workspace>/…; the route's own param is the first choice, the path the fallback.
  const slug = params?.workspace ?? pathname?.split("/")[2];
  const current = workspaces.find((w) => w.slug === slug);
  const Icon = current ? FileQuestion : Building2;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-[50px] shrink-0 items-center justify-between border-b border-border pl-5 pr-3">
        <Logo href={current ? `/app/${current.slug}` : "/app"} height={16} />
        <ThemeToggle />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-5 pb-24 pt-12">
        <div className="rise-in flex max-w-md flex-col items-center text-center">
          <Icon className="mb-4 size-12 text-secondary" strokeWidth={1.25} aria-hidden />
          <h1 className="type-page-title">{current ? "Page not found" : "Workspace not found"}</h1>
          <p className="mt-2 text-balance text-sm font-normal text-secondary">
            {current ? "It may have been moved or deleted, or it is not shared with you." : "Either this workspace does not exist or you are not a member of it."}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {current ? (
              <>
                <Link href={`/app/${current.slug}`} className={buttonVariants()}>Back to {current.name}</Link>
                <Link href="/app?switch=1" className={buttonVariants({ variant: "secondary" })}>Your workspaces</Link>
              </>
            ) : (
              <>
                <Link href="/app" className={buttonVariants()}>Back to your workspaces</Link>
                <Link href="/join" className={buttonVariants({ variant: "secondary" })}>Join with a code</Link>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
