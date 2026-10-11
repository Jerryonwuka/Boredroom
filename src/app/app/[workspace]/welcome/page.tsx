import { redirect } from "next/navigation";
import { workspacePage, homeFor } from "@/server/lib/workspace-page";
import { welcomeView } from "@/server/services/welcome";
import { launchSettings } from "@/server/admin/settings";
import { getAdmin } from "@/server/admin/auth";
import { MotionRoot } from "@/components/ui/motion";
import { AssistantProvider } from "@/components/app/assistant-context";
import { WelcomeFlow } from "@/components/app/welcome/welcome-flow";
import { WELCOME_WORDS, initialStepFor, stepsFor } from "@/lib/welcome";

export const dynamic = "force-dynamic";
export const metadata = { title: WELCOME_WORDS.pageTitle };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The first-run welcome (owner request, 11 October 2026: "when new users login and create an account i need there to be a
 * sort of set up, walkthrough guide, elevator pitch kind of thing … then maybe after, a 'you're all set up' message";
 * contract 4.1). A full-screen page of its own, outside the app's frame (no sidebar, top bar, drawer or realtime; calls
 * still reach it through the workspace layout): the pitch for the person's role, their name and photo, their own
 * assistant, how it works with them, what is and isn't seen about them, their team (owners and HR), then "You're all set"
 * with one first action.
 *
 * Never shown to someone signed in as the person (support), nor during maintenance without app access (her page says
 * so), nor once finished unless replayed from Settings (`?replay=1`); `?step=` opens a screen the person has. The page
 * reads everything fresh, so a resumed step shows what the server has. `?auto=1` (welcomeAutoPath: the gate, or straight
 * after creating or joining) marks an automatic opening: the welcome counts it once it is on screen (WelcomeFlow), never
 * here, since a render can also be a prefetch or a followed redirect (review, 11 October 2026).
 */
export default async function WelcomePage({ params, searchParams }: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ step?: string | string[]; replay?: string | string[]; auto?: string | string[] }>;
}) {
  const [{ workspace }, sp] = await Promise.all([params, searchParams]);
  const { ctx, teams } = await workspacePage(workspace, `/app/${workspace}/welcome`);
  const home = homeFor(ctx);
  if (ctx.user.impersonation) redirect(home);
  const [launch, admin] = await Promise.all([launchSettings(), getAdmin()]);
  if (launch.mode === "maintenance" && !launch.app_access && !admin) redirect(home);

  const view = await welcomeView(ctx, { replay: first(sp.replay) === "1", teams });
  // Finished: her page instead, unless replayed. Only once the server keeps the progress (migration 0056): before it,
  // "done" is the assistant's setup, which the welcome's own Meet your assistant step marks half way through, and a
  // reload or the refresh after an act-mode save would otherwise end the welcome there (integration, 11 October 2026).
  if (view.state.ready && view.state.done && !view.replay) redirect(home);

  const steps = stepsFor({ role: view.role, youDone: view.state.youDone, aiPlan: view.aiPlan, replay: view.replay });
  const requested = first(sp.step);
  const initialStep = initialStepFor({ requested, saved: view.state.step, steps, replay: view.replay });
  const resumed = !view.replay && !requested && !!view.state.step && view.state.step !== "welcome";

  return (
    <MotionRoot>
      <AssistantProvider value={view.assistants}>
        <WelcomeFlow view={view} initialStep={initialStep} resumed={resumed} membershipId={ctx.membership.id} auto={first(sp.auto) === "1" && !view.replay} />
      </AssistantProvider>
    </MotionRoot>
  );
}
