import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { myProfile } from "@/server/services/profile";
import { listDevices } from "@/server/services/desktop";
import { AuthShell } from "@/components/auth/auth-shell";
import { DesktopLinkForm } from "@/components/app/desktop-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Link Brenda desktop" };

/** Where the desktop app sends people to approve its code (owner decision, 3 October 2026). */
export default async function DesktopLinkPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/desktop/link${sp.code ? `?code=${sp.code}` : ""}`)}`);
  const [me, devices] = await Promise.all([myProfile(user), listDevices(user)]);
  return (
    <AuthShell title="Link Brenda on your computer" subtitle="Check the code matches the one on your screen, pick the workspace, and approve. Brenda on your desktop then acts as you, with your permissions, in that workspace.">
      <DesktopLinkForm initialCode={sp.code ?? ""} workspaces={me.workspaces.map((w) => ({ slug: w.slug, name: w.name }))} devices={devices} />
    </AuthShell>
  );
}
