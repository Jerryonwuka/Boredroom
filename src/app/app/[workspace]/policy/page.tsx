import { redirect } from "next/navigation";

/**
 * The Policy page and the general sign-off are gone (owner decision, 5 October 2026). Working hours and recording
 * rules are set under Settings, Brenda answers questions about them, and consent to screen recording is asked once,
 * at the moment a recorded session starts (see capture.tsx). Old links, and old policy notifications, land on Brenda.
 */
export default async function PolicyPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  redirect(`/app/${encodeURIComponent(workspace)}/home`);
}
