import { AuthShell } from "@/components/auth/auth-shell";
import { FinishExpired } from "@/components/app/desktop-app/finish";

export const metadata = { title: "This sign-in has expired", referrer: "no-referrer" as const, robots: { index: false } };

/** A Boredroom for Mac sign-in link that was unknown, used or out of time (owner request, 24 October 2026: option A). */
export default function DesktopExpiredPage() {
  return <AuthShell><FinishExpired /></AuthShell>;
}
