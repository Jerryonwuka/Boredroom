import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { RecoverForm } from "@/components/auth/forms";

export const metadata = { title: "Recover password" };

export default function RecoverPage() {
  return (
    <AuthShell title="Recover your password" subtitle="We will email you a single-use reset link." footer={<Link className="text-fg underline" href="/login">Back to sign in</Link>}>
      <RecoverForm />
    </AuthShell>
  );
}
