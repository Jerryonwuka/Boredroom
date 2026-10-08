import { redirect } from "next/navigation";

/**
 * Follow-ups, "You asked" (owner decision, 8 October 2026: personal assistants, phase 4) moved into "Between
 * assistants" with phase 6 (owner decision, 8 October 2026: the assistants' inbox): it is now Sent → Follow-ups. This
 * address stays for old links (notifications, saved chats, the assistant's own links) and sends them there, keeping
 * `?status=` and `?batch=`. The workspace page checks who is signed in.
 */
export default async function FollowUpsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ status?: string | string[]; batch?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams({ type: "followups" });
  const status = [sp.status].flat()[0]?.trim();
  const batch = [sp.batch].flat()[0]?.trim();
  if (status) q.set("status", status);
  if (batch) q.set("batch", batch);
  redirect(`/app/${encodeURIComponent(workspace)}/home/assistants/sent?${q}`);
}
