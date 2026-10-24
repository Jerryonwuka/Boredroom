import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { myProfile } from "@/server/services/profile";
import { listDevices } from "@/server/services/desktop";
import { AuthShell } from "@/components/auth/auth-shell";
import { DesktopLinkForm } from "@/components/app/desktop-link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Link Boredroom for Mac" };

/** Where the desktop app sends people to approve its code (owner decision, 3 October 2026; Boredroom for Mac's words, 24 October 2026). */
export default async function DesktopLinkPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/desktop/link${sp.code ? `?code=${sp.code}` : ""}`)}`);
  const [me, devices] = await Promise.all([myProfile(user), listDevices(user)]);
  return (
    <AuthShell title="Link Boredroom for Mac with a code" subtitle="Check the code matches the one on your screen, pick the workspace, and approve. Boredroom for Mac and Brenda in its notch then act as you, with your permissions, in that workspace.">
      <DesktopLinkForm initialCode={sp.code ?? ""} workspaces={me.workspaces.map((w) => ({ slug: w.slug, name: w.name }))} devices={devices} />
    </AuthShell>
  );
}
