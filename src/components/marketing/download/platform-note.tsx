"use client";

import { Alert } from "@/components/ui/states";
import { useMacOrNull } from "@/lib/use-is-mac";

/**
 * Under the download button (owner request, 24 October 2026): a visitor who isn't on a Mac (Windows, Linux, an iPhone or
 * an iPad) is told Boredroom for Mac needs one and that Windows is coming. Read after hydration, so the server's page never
 * guesses and a Mac sees nothing. The button itself always stays: people send the link to their Mac.
 */
export function PlatformNote({ className }: { className?: string }) {
  const mac = useMacOrNull();
  if (mac !== false) return null;
  return (
    <Alert tone="info" title="You're not on a Mac" className={className}>
      <p className="text-secondary">Boredroom for Mac needs a Mac with macOS 14 or later. Windows is coming; until then, Boredroom works in your browser.</p>
    </Alert>
  );
}
