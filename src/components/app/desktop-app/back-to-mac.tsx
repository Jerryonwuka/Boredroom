"use client";

import { useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";

/**
 * "{App} is connected. You can go back to Boredroom." with Back to Boredroom (owner request, 24 October 2026: Boredroom
 * for Mac, option A; spec §7.1), in the browser that finished a consent Boredroom for Mac sent it. The offer is kept from
 * the first render: the page cleans `?connected=` from its address straight away, which renders it again without one.
 */
export function BackToMac({ offer }: { offer: { app: string; href: string } | null }) {
  const [kept] = useState(offer);
  if (!kept) return null;
  return (
    <Alert tone="success" title={`${kept.app} is connected`}
      action={<a className={buttonVariants({ variant: "secondary", size: "sm" })} href={kept.href}>Back to Boredroom</a>}>
      You can go back to Boredroom.
    </Alert>
  );
}
