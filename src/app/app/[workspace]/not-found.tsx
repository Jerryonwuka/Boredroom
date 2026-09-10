import Link from "next/link";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";

export default function WorkspaceNotFound() {
  return (
    <AuthShell title="Workspace not found" subtitle="Either this workspace does not exist or you are not a member of it.">
      <Link href="/app"><Button className="w-full">Back to your workspaces</Button></Link>
    </AuthShell>
  );
}
