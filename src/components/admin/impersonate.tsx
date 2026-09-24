"use client";

import { useRouter } from "next/navigation";
import { AdminAction } from "@/components/admin/actions";

/** Starts viewing Boredroom as a person. The reason is recorded; the app shows a banner until "Return to admin". */
export function ImpersonateButton({ userId, name }: { userId: string; name: string }) {
  const router = useRouter();
  return (
    <AdminAction path="/api/admin/impersonate/start" body={{ userId }} reason confirm={{ title: `View Boredroom as ${name}?`, description: "You get a temporary two-hour session as this person. Everything you do is recorded against the impersonation, and they cannot see it happening. Their password is never shown.", label: "Start" }} onDone={() => { router.push("/app"); router.refresh(); }}>
      View as {name.split(" ")[0]}
    </AdminAction>
  );
}
