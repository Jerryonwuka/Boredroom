import { redirect } from "next/navigation";

/**
 * The Reports page is gone (owner decision, 5 October 2026): Brenda sends supervisors an end-of-day report of what
 * their team did, and answers for any other period when asked. Old links land on Brenda with that question in her box.
 * Staff write no daily report of their own either (owner decision, 6 October 2026).
 */
export default async function ReportsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  redirect(`/app/${encodeURIComponent(workspace)}/home?ask=${encodeURIComponent("Summarise what my team got done this week.")}`);
}
