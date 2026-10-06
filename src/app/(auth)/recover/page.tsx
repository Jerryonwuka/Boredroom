import Link from "next/link";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { RecoverForm } from "@/components/auth/forms";

export const metadata = { title: "Recover password" };

export default function RecoverPage() {
  return (
    <AuthShell title="Recover your password" subtitle="We will email you a single-use reset link." footer={<Link className={AUTH_LINK} href="/login">Back to sign in</Link>}>
      <RecoverForm />
    </AuthShell>
  );
}
