import { notFound } from "next/navigation";
import { PhoneOff } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { EmptyState } from "@/components/ui/states";
import { CallStageLoader } from "@/components/app/call-stage-loader";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { callsAvailability, getCallView } from "@/server/services/calls";
import { callNotesAvailability } from "@/server/services/call-notes";
import { AppError } from "@/server/lib/errors";
import { CALL_WORDS } from "@/lib/calls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Call" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One call's page (owner decisions, 8 October 2026: phase 8, calls; contract D.6): the call as the person may see it
 * (`getCallView`, null for anyone who neither was on it nor reads its thread), the workspace assistant (the note-taker's
 * name and face) and whether Brenda's notes can be offered here. The stage itself runs in the browser
 * (`CallStageLoader`). `?from=notch` means the person accepted in the notch: the pre-join panel offers Join as the main
 * action (that click also turns the sound on). Before migration 0054 the page says calls need a database update.
 */
export default async function CallPage({ params, searchParams }: { params: Promise<{ workspace: string; id: string }>; searchParams: Promise<{ from?: string }> }) {
  const { workspace, id } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/calls/${id}`);
  if (!UUID.test(id)) notFound();
  const calls = await callsAvailability();
  if (!calls.ready) {
    return (
      <AppShell ctx={ctx} counts={counts} teams={teams}>
        <h1 className="sr-only">Call</h1>
        <EmptyState icon={PhoneOff} tone="neutral" title={CALL_WORDS.notReady} className="py-24" />
      </AppShell>
    );
  }
  let view;
  try { view = await getCallView(ctx, id); }
  catch (err) { if (err instanceof AppError && err.status === 503) view = undefined; else throw err; }
  if (view === null) notFound();
  if (!view) {
    return (
      <AppShell ctx={ctx} counts={counts} teams={teams}>
        <h1 className="sr-only">Call</h1>
        <EmptyState icon={PhoneOff} tone="neutral" title={CALL_WORDS.notReady} className="py-24" />
      </AppShell>
    );
  }
  const [assistants, availability] = await Promise.all([assistantProfiles(ctx), callNotesAvailability(ctx)]);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams} bleed>
      <CallStageLoader orgSlug={ctx.org.slug} initial={view} availability={availability} workspaceAssistant={assistants.workspace}
        from={sp.from === "notch" ? "notch" : null} impersonated={!!ctx.user.impersonation} timeZone={ctx.org.timezone} />
    </AppShell>
  );
}
