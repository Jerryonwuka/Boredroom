import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { DocsHeader, DocsLibrary, NewDocButton } from "@/components/app/docs-library";
import { listDocs } from "@/server/services/docs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Docs" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
/** The server's clock for relative times, read once per request so the server and the browser render the same words. */
const serverNow = () => Date.now();

/**
 * Docs (owner decision, 5 October 2026): notes, handbooks and documents written in Boredroom, by people or by Brenda
 * for them. Everyone has the same library; what is in it follows who each document is shared with. ?q= searches titles
 * and text, ?folder= narrows to one folder.
 */
export default async function DocsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ q?: string | string[]; folder?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/docs`);
  const q = one(sp.q).trim().slice(0, 200);
  const folder = one(sp.folder).replace(/\s+/g, " ").trim().slice(0, 80) || null;
  const data = await listDocs(ctx, { q: q || undefined, folder: folder ?? undefined });
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      {/* The header is on screen from the first paint, whatever the library below shows (see DocsHeader). */}
      <DocsHeader title="Docs"
        description="Notes, handbooks and documents your team writes, or that Brenda writes for you."
        actions={<NewDocButton orgSlug={ctx.org.slug} folder={folder} />} />
      <DocsLibrary orgSlug={ctx.org.slug} docs={data.docs} folders={data.folders} q={q} folder={folder} now={serverNow()} viewerMembershipId={ctx.membership.id} />
    </AppShell>
  );
}
