import { redirect } from "next/navigation";

/**
 * Screen recording is gone (owner decision, 8 October 2026: phase 8); old links land on Calls.
 */
export default async function RecordingsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  redirect(`/app/${encodeURIComponent(workspace)}/calls`);
}
