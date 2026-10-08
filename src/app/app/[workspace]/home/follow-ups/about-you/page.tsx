import { redirect } from "next/navigation";

/**
 * Follow-ups, "Asked about you" (owner decision, 8 October 2026: personal assistants, phase 4) moved into "Between
 * assistants" with phase 6 (owner decision, 8 October 2026: the assistants' inbox): it is now Received → Follow-ups
 * about you. This address stays for old links (every ask's notification, `?f=<id>`, which still marks that follow-up
 * and scrolls to it) and sends them there. The workspace page checks who is signed in.
 */
export default async function AskedAboutYouPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ f?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams({ type: "followups" });
  const f = [sp.f].flat()[0]?.trim();
  if (f) q.set("f", f);
  redirect(`/app/${encodeURIComponent(workspace)}/home/assistants/received?${q}`);
}
