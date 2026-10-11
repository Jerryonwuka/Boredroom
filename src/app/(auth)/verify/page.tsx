import Link from "next/link";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { VerifyButton, type VerifyJoin } from "@/components/auth/forms";
import { joiningTarget, safeNextPath } from "@/components/auth/next-path";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { WELCOME_WORDS, type WelcomeRole } from "@/lib/welcome";
import { getCurrentUser, peekVerifyToken } from "@/server/auth";
import { listMyWorkspaces, previewInvitation, previewJoinCode } from "@/server/services/orgs";

export const metadata = { title: "Verify email" };

type Offer = { join: VerifyJoin; role: WelcomeRole } | { memberOf: string };

/**
 * The organisation a confirmed email can join in the same press: only for the account the link belongs to, signed in
 * here, coming from an enabled join code or a pending invitation sent to that address. Anything else gets the plain
 * confirm button and goes on to `next` afterwards. Someone already in that organisation (a used link opened again) is
 * sent to it instead (`memberOf`, its slug).
 */
async function joinOffer(next: string, user: { authUserId: string; profileId: string; email: string } | null, tokenUser: string): Promise<Offer | null> {
  if (!user || user.authUserId !== tokenUser) return null;
  const target = joiningTarget(next);
  if (target?.kind === "join") {
    const [code, mine] = await Promise.all([previewJoinCode(target.code), listMyWorkspaces(user.profileId)]);
    if (code && mine.some((w) => w.slug === code.slug)) return { memberOf: code.slug };
    return code?.enabled ? { join: { kind: "join", code: target.code, orgName: code.name }, role: code.role } : null;
  }
  if (target?.kind === "invite") {
    const inv = await previewInvitation(target.token);
    return inv?.state === "pending" && inv.email.toLowerCase() === user.email.toLowerCase()
      ? { join: { kind: "invite", token: target.token, orgName: inv.orgName }, role: inv.role }
      : null;
  }
  return null;
}

/**
 * Confirming an email (the first-run welcome, owner request, 11 October 2026). The link carries `next` (where the person
 * was going: their join link, their invitation, or /onboarding for a founder), so it works on any device. Nothing is
 * confirmed by opening the page: the press does it (mail scanners open links). For the same person, signed in here,
 * coming from a join code or an invitation, the press also joins and opens the organisation's welcome, and the line
 * above it says as what. A link already used for a confirmed address says so and offers the way on.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string | string[]; next?: string | string[] }> }) {
  const sp = await searchParams;
  const token = [sp.token].flat()[0];
  const next = safeNextPath(sp.next, "") || null;
  const footer = <Link className={AUTH_LINK} href="/login">Back to sign in</Link>;
  if (!token) {
    return (
      <AuthShell title="Confirm your email" subtitle="This proves the address belongs to you." footer={footer}>
        <Alert tone="danger">This link is missing its token. Open the link from your email again, or sign in and send a new one from the <Link className={AUTH_LINK} href="/verify/pending">verification page</Link>.</Alert>
      </AuthShell>
    );
  }
  const [peek, user] = await Promise.all([peekVerifyToken(token), getCurrentUser()]);
  const already = !!peek && peek.verified && !peek.usable;
  if (!peek || (!peek.usable && !already)) {
    return (
      <AuthShell title="Confirm your email" subtitle="This proves the address belongs to you." footer={footer}>
        <Alert tone="danger">This link is invalid or has expired. <span className="mt-2 block">Sign in and send a new link from the <Link className={AUTH_LINK} href={next ? `/verify/pending?next=${encodeURIComponent(next)}` : "/verify/pending"}>verification page</Link>.</span></Alert>
      </AuthShell>
    );
  }
  const found = next ? await joinOffer(next, user, peek.authUserId) : null;
  const offer = found && "join" in found ? found : null;
  const onward = found && "memberOf" in found ? `/app/${found.memberOf}` : (next ?? "/app");
  // Signed in already: "Back to sign in" would only confuse.
  const after = user ? undefined : footer;
  const joinLine = offer ? `You'll join ${offer.join.orgName} as ${WELCOME_WORDS.joinAs[offer.role]}.` : null;
  if (already) {
    return (
      <AuthShell title="Your email is already confirmed" subtitle={joinLine ?? "You can carry on where you were going."} footer={after}>
        {offer
          ? <VerifyButton token={token} next={next} join={offer.join} already />
          : <Link href={onward} className={cn(buttonVariants({ size: "lg" }), "w-full")}>Continue</Link>}
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Confirm your email" subtitle={joinLine ?? "This proves the address belongs to you."} footer={after}>
      <VerifyButton token={token} next={next} join={offer?.join ?? null} />
    </AuthShell>
  );
}
