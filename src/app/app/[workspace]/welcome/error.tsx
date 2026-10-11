"use client";

/**
 * When the welcome cannot open (owner request, 11 October 2026: the first-run welcome; contract 4.1): the same top bar,
 * then "The welcome couldn't open" with "Try again" and a way into the workspace. The way in carries `?from=welcome`: the
 * welcome only takes over a bare `/home`, so a broken welcome can never trap anyone.
 */
import { useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { LogoArt } from "@/components/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/states";

export default function WelcomeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const params = useParams<{ workspace: string }>();
  const slug = params?.workspace ?? "";
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="min-h-dvh bg-background">
      <div className="flex h-14 items-center border-b border-border px-4 sm:px-5"><LogoArt height={16} /><span className="sr-only">Boredroom</span></div>
      <main id="main" className="mx-auto max-w-md px-4 py-24 sm:px-5">
        <ErrorState title="The welcome couldn't open" description="Something went wrong while it loaded. Try again, or go straight to your workspace."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => retry()}>Try again</Button>
              <Link href={`/app/${slug}/home?from=welcome`} className={buttonVariants({ variant: "outline" })}>Go to your workspace</Link>
            </div>
          } />
      </main>
    </div>
  );
}
