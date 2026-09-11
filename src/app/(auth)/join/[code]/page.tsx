import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/auth/forms";
import { JoinAccept } from "@/components/auth/join-forms";
import { getCurrentUser } from "@/server/auth";
import { previewJoinCode } from "@/server/services/orgs";

export const metadata = { title: "Join organisation" };

export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [user, preview] = await Promise.all([getCurrentUser(), previewJoinCode(decodeURIComponent(code))]);
  const here = `/join/${encodeURIComponent(code.toUpperCase())}`;
  if (!preview) return <AuthShell title="Code not recognised"><Alert tone="danger">That organisation code is not valid. Check it with your administrator.</Alert><div className="mt-4"><Link href="/join"><Button variant="outline" className="w-full">Try another code</Button></Link></div></AuthShell>;
  if (!preview.enabled) return <AuthShell title="Joining is paused"><Alert tone="warning">{preview.name} is not accepting new members with this code right now. Ask your administrator for a current code.</Alert></AuthShell>;
  if (!user) {
    return (
      <AuthShell title={`Join ${preview.name}`} subtitle={`You will join as ${preview.role === "manager" ? "team lead" : "staff"}. Create your staff account or sign in to continue.`}>
        <div className="grid gap-3">
          <Link href={`/signup?next=${encodeURIComponent(here)}`}><Button size="lg" className="w-full">Create my account</Button></Link>
          <Link href={`/login?next=${encodeURIComponent(here)}`}><Button size="lg" variant="outline" className="w-full">I already have an account</Button></Link>
        </div>
      </AuthShell>
    );
  }
  if (!user.emailVerified) return <AuthShell title="Verify your email first" footer={<SignOutButton />}><Alert tone="info">Confirm {user.email} from the verification message, then open this link again.</Alert><div className="mt-4"><Link href={`/verify/pending?next=${encodeURIComponent(here)}`}><Button className="w-full">Go to verification</Button></Link></div></AuthShell>;
  return (
    <AuthShell title={`Join ${preview.name}`} subtitle={`Signed in as ${user.email}. You will join as ${preview.role === "manager" ? "team lead" : "staff"}.`} footer={<SignOutButton />}>
      <JoinAccept code={code.toUpperCase()} orgName={preview.name} />
    </AuthShell>
  );
}
