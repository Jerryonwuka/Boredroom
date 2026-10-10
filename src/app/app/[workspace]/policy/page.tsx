import { redirect } from "next/navigation";

/**
 * The Policy page and the general sign-off are gone (owner decision, 5 October 2026). Working hours and the monitoring
 * notice are set under Settings, everyone reads the notice in their profile, and Brenda answers questions about them.
 * Nobody is asked to agree to anything any more (screen recording, the only thing that asked, is gone: owner decision,
 * 8 October 2026, phase 8). Old links, and old policy notifications, land on Brenda.
 */
export default async function PolicyPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  redirect(`/app/${encodeURIComponent(workspace)}/home`);
}
