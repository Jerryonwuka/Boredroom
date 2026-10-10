import { CallHost } from "@/components/app/call-host";

/**
 * The workspace layout. Calls live here (owner decisions, 8 October 2026: phase 8, the "On a call" dock): layouts persist
 * across client navigation, so a call keeps going while the person opens other pages. The layout reads no server data
 * (an unauthenticated visitor still gets the page's own redirect); CallHost learns everything from `GET /calls/now`, and
 * on a 401 or 404 it stays idle and renders only the page.
 */
export default async function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  return <CallHost orgSlug={workspace}>{children}</CallHost>;
}
