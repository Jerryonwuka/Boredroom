import Link from "next/link";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { ResetForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui/states";

export const metadata = { title: "Set a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const token = [(await searchParams).token].flat()[0];
  return (
    <AuthShell title="Choose a new password" subtitle={token ? "Saving it signs you out on every device, so you sign in again with the new one." : undefined} footer={<Link className={AUTH_LINK} href="/login">Back to sign in</Link>}>
      {token ? <ResetForm token={token} /> : <Alert tone="danger">This link is missing its token. <Link className={AUTH_LINK} href="/recover">Request a new one</Link> and open the link in that email.</Alert>}
    </AuthShell>
  );
}
