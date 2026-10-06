import Link from "next/link";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/auth/forms";
import { JoinAccept } from "@/components/auth/join-forms";
import { decodeSegment } from "@/components/auth/next-path";
import { getCurrentUser } from "@/server/auth";
import { previewJoinCode } from "@/server/services/orgs";

export const metadata = { title: "Join organisation" };

const full = (variant: "primary" | "outline" = "primary") => cn(buttonVariants({ variant, size: "lg" }), "w-full");

export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const raw = decodeSegment((await params).code).trim().toUpperCase();
  const [user, preview] = await Promise.all([getCurrentUser(), previewJoinCode(raw)]);
  const here = `/join/${encodeURIComponent(raw)}`;
  const another = <Link className={AUTH_LINK} href="/join">Try another code</Link>;
  if (!preview) return <AuthShell title="Code not recognised" footer={another}><Alert tone="danger">That organisation code is not valid. Check it with your administrator, or paste the whole join link.</Alert></AuthShell>;
  if (!preview.enabled) return <AuthShell title="Joining is paused" footer={another}><Alert tone="warning">{preview.name} is not accepting new members with this code right now. Ask your administrator for a current code.</Alert></AuthShell>;
  const as = preview.role === "manager" ? "a team lead" : "staff";
  if (!user) {
    return (
      <AuthShell title={`Join ${preview.name}`} subtitle={`You will join as ${as}. Create your staff account or sign in to continue.`}>
        <div className="grid gap-3">
          <Link href={`/signup?next=${encodeURIComponent(here)}`} className={full()}>Create my account</Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`} className={full("outline")}>I already have an account</Link>
        </div>
      </AuthShell>
    );
  }
  const switchAccount = <SignOutButton to={`/login?next=${encodeURIComponent(here)}`} />;
  if (!user.emailVerified) {
    return (
      <AuthShell title="Confirm your email first" subtitle={`Confirm ${user.email} from the verification message, then come back to this link.`} footer={switchAccount}>
        <Link href={`/verify/pending?next=${encodeURIComponent(here)}`} className={full()}>Go to verification</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell title={`Join ${preview.name}`} subtitle={`Signed in as ${user.email}. You will join as ${as}.`} footer={switchAccount}>
      <JoinAccept code={raw} orgName={preview.name} orgSlug={preview.slug} />
    </AuthShell>
  );
}
