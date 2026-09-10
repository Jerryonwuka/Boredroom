import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { VerifyButton } from "@/components/auth/forms";
import { Alert } from "@/components/ui/states";

export const metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Confirm your email" subtitle="This proves the address belongs to you." footer={<Link className="text-fg underline" href="/login">Back to sign in</Link>}>
      {token ? <VerifyButton token={token} /> : <Alert tone="danger">This link is missing its token. Open the link from your email again.</Alert>}
    </AuthShell>
  );
}
