import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResetForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui/states";

export const metadata = { title: "Set a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell title="Choose a new password" footer={<Link className="text-fg underline" href="/login">Back to sign in</Link>}>
      {token ? <ResetForm token={token} /> : <Alert tone="danger">This link is missing its token. Request a new one from the recovery page.</Alert>}
    </AuthShell>
  );
}
