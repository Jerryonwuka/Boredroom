import { redirect } from "next/navigation";

/** The Activity page became the Workroom. */
export default async function TeamPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ team?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  redirect(`/app/${workspace}/workroom${sp.team ? `?team=${sp.team}` : ""}`);
}
