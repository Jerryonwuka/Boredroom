import Link from "next/link";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { JoinCodeForm } from "@/components/auth/join-forms";

export const metadata = { title: "Join your organisation" };

export default function JoinPage() {
  return (
    <AuthShell title="Join your organisation" subtitle="Enter the code or open the link your organisation gave you. Staff accounts can only be created this way." footer={<>Setting up a new organisation? <Link className={AUTH_LINK} href="/signup?intent=org">Create an organisation account</Link></>}>
      <JoinCodeForm />
    </AuthShell>
  );
}
