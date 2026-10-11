"use client";

/**
 * The first-run welcome (owner request, 11 October 2026: "when new users login and create an account i need there to be a
 * sort of set up, walkthrough guide, elevator pitch kind of thing, where they can set their names, images, choose
 * settings, select brands, then maybe after, a 'you're all set up' message"; built as "the stage", contract 4 to 6).
 *
 * One page, client-side steps: the pitch (Welcome), You, Meet your assistant, How it helps (only with the assistant in the
 * plan), What's seen, Bring your team (owners and HR; owner_flow's TeamStep), then "You're all set" with one first action.
 * About two minutes; every step opens already filled in, so Continue keeps the defaults, and "Skip setup" (asked once)
 * ends it whenever the person likes.
 *
 * - The frame: a 56px top bar (logo, workspace, the labelled rail of steps, Skip setup), then the card on the right and
 *   the stage on the left (their assistant, live, changing with each choice; a band above the card below 860px). The card
 *   comes first in the page's order; the stage only looks first.
 * - Moving: the step is in the address (`?step=you`, pushState), so the browser's Back and Forward move between steps; a
 *   person's move puts focus on the new title and the page's title follows ("Step 2 of 4: Meet your assistant · Boredroom").
 *   Done segments of the rail jump back. Back keeps everything entered (state lives here, not in the steps).
 * - Saving: each step saves to its real home first (profile, photo, assistant, act mode, voice, invitations), then the
 *   progress (PATCH /welcome, best effort; before migration 0056 this browser's session keeps it). Finishing records the
 *   welcome (POST /welcome/done) and "You're all set" shows only once that answered, once (a second press while it saves
 *   does nothing). An automatic opening arrives marked (`?auto=1`: the gate, or straight after creating or joining) and
 *   is counted once it is on screen (PATCH {seen}), each time, whatever the tab; the marker then leaves the address, so a
 *   reload or Back does not count again (review, 11 October 2026: the count was once per tab, and every bare /home in a
 *   counted tab reopened it uncounted). A replay from Settings saves nothing about progress.
 * - While something saves, the browser's Back is held (the address is put back), and a save that answers after the
 *   person moved never pulls them on (review, 11 October 2026).
 * - The page's props are initial values only: shared code may refresh the page, and nothing here resets a step, a draft or
 *   a choice from new props. The act-mode store refreshes after a save elsewhere; here it is asked not to (integration,
 *   11 October 2026), since the page sends a finished welcome home and "You're all set" must stay on screen.
 * - Nothing here is ever shown to anyone else: progress lives in the person's own row (assistant_private).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "motion/react";
import { Check } from "lucide-react";
import { LogoArt } from "@/components/logo";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm";
import { ProgressBar } from "@/components/ui/progress-arc";
import { EASE } from "@/components/ui/motion";
import { useTheme } from "@/components/ui/theme-toggle";
import { AssistantProvider } from "@/components/app/assistant-context";
import { useActMode } from "@/components/app/act-mode-pill";
import { useNaturalVoiceChoice } from "@/components/app/assistant-natural-voice";
import { assistantBody, assistantFieldErrors, keepErrors, profileKey, type AssistantFieldErrors } from "@/components/app/assistant-editor";
import { useShownName } from "@/components/app/welcome/shown-name";
import type { BrendaCharacterHandle } from "@/components/app/brenda-character";
import { WelcomeStage } from "@/components/app/welcome/welcome-stage";
import { WelcomeIntro } from "@/components/app/welcome/welcome-intro";
import { StepYou, YOU_NAME_ID } from "@/components/app/welcome/step-you";
import { StepAssistant, ASSISTANT_NAME_ID } from "@/components/app/welcome/step-assistant";
import { StepHow } from "@/components/app/welcome/step-how";
import { StepSeen } from "@/components/app/welcome/step-seen";
import { StepDone, DoneSummary } from "@/components/app/welcome/step-done";
import { TeamStep, teamDraftFrom, type TeamDraft, type TeamStepResult } from "@/components/app/welcome/team-step";
import { api, isApiFailure } from "@/lib/api-client";
import { actStateOf } from "@/lib/act-mode";
import { naturalVoice } from "@/lib/natural-voices";
import { EYES, PALETTE, VISORS, assistantNameProblem, lookOf, normaliseAssistantName, type AssistantProfile, type AssistantSpeak } from "@/lib/assistant-look";
import {
  WELCOME_WORDS, bringsTeam, fairnessFor, firstActionFor, firstNameOf, isCountedStep, isWelcomeStep, nextStep, pitchFor, previousStep,
  railFor, stepLabel, stepsFor, type CountedStep, type WelcomeStep, type WelcomeView,
} from "@/lib/welcome";
import { cn } from "@/lib/utils";

const W = WELCOME_WORDS;
const REDUCE = "(prefers-reduced-motion: reduce)";
const reduced = () => typeof window !== "undefined" && window.matchMedia(REDUCE).matches;

/** This browser's session copy of the progress before migration 0056 (contract 4.4). */
const progressKey = (membershipId: string) => `boredroom-welcome:${membershipId}`;
const store = {
  get(k: string): string | null { try { return window.sessionStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { window.sessionStorage.setItem(k, v); } catch { /* private mode: progress lasts for the page */ } },
  drop(k: string) { try { window.sessionStorage.removeItem(k); } catch { /* nothing kept */ } },
};

/** Her bubble: a new line shows three typing dots for 300ms first; a line about a choice waits for an 800ms pause. */
function useBubble(initial: string) {
  const [bubble, setBubble] = useState({ line: initial, typing: false });
  const timers = useRef<{ pause?: ReturnType<typeof setTimeout>; dots?: ReturnType<typeof setTimeout> }>({});
  useEffect(() => () => { clearTimeout(timers.current.pause); clearTimeout(timers.current.dots); }, []);
  const say = useCallback((line: string, opts: { choice?: boolean } = {}) => {
    clearTimeout(timers.current.pause); clearTimeout(timers.current.dots);
    const show = () => {
      if (reduced()) { setBubble({ line, typing: false }); return; }
      setBubble((b) => (b.line === line && !b.typing ? b : { line, typing: true }));
      timers.current.dots = setTimeout(() => setBubble({ line, typing: false }), 300);
    };
    if (opts.choice) timers.current.pause = setTimeout(show, 800); else show();
  }, []);
  return { ...bubble, say };
}

export function WelcomeFlow({ view, initialStep, resumed, membershipId, auto = false }: {
  view: WelcomeView; initialStep: WelcomeStep; resumed: boolean; membershipId: string;
  /** This arrival is an automatic opening (`?auto=1`), counted once the page is on screen. */
  auto?: boolean;
}) {
  const router = useRouter();
  // The props are initial values (a refresh brings new ones; nothing below resets from them).
  const [v] = useState(view);
  const { org, role, replay, aiPlan, person, state } = v;
  const slug = org.slug;
  const supervisor = bringsTeam(role);
  const steps = useMemo(() => stepsFor({ role, youDone: state.youDone, aiPlan, replay }), [role, state.youDone, aiPlan, replay]);
  const rail = useMemo(() => railFor({ role, youDone: state.youDone, aiPlan, founder: v.founder, replay }), [role, state.youDone, aiPlan, v.founder, replay]);

  // ---- Where we are ---------------------------------------------------------------------------------------------------
  const [step, setStep] = useState<WelcomeStep>(initialStep);
  const [moved, setMoved] = useState(false);
  const [noteOn, setNoteOn] = useState(resumed || replay);
  const [resumeNote, setResumeNote] = useState(resumed);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipped, setSkipped] = useState<CountedStep[]>(() => (replay ? [] : state.skipped));
  const stepRef = useRef(step);
  useEffect(() => { stepRef.current = step; }, [step]);
  // Something is saving (the flow's own saves, or the Team step sending): the browser's Back waits for it.
  const busyRef = useRef(false);

  // ---- What the person has chosen ------------------------------------------------------------------------------------
  const [displayName, setDisplayName] = useState(person.displayName);
  const [nameDraft, setNameDraft] = useState(person.displayName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [avatarKey, setAvatarKey] = useState(person.avatarKey);
  const [youTouched, setYouTouched] = useState({ photo: false, theme: false });
  const [saved, setSaved] = useState<AssistantProfile>(v.assistants.personal);
  const [draft, setDraft] = useState<AssistantProfile>(v.assistants.personal);
  const [fieldErrors, setFieldErrors] = useState<AssistantFieldErrors>({});
  const [nameFocus, setNameFocus] = useState(false);
  const [speak, setSpeak] = useState<AssistantSpeak>(v.assistants.speak);
  const [howTouched, setHowTouched] = useState(false);
  // The Team step's draft and outcomes live here, so Back keeps them and the end screen reports them truly.
  const [teamDraft, setTeamDraft] = useState<TeamDraft | null>(() => (v.team ? teamDraftFrom(v.team) : null));
  const onTeamDraft = useCallback((next: React.SetStateAction<TeamDraft>) => setTeamDraft((d) => (d ? (typeof next === "function" ? next(d) : next) : d)), []);
  const act = useActMode(slug, actStateOf(v.assistants));
  const natural = useNaturalVoiceChoice(slug, v.natural, false);
  const theme = useTheme();

  const first = firstNameOf(displayName) || person.firstName;
  const name = saved.name;
  const shownName = useShownName(draft.name, saved.name);
  // "Acme is ready, Olu" greets the founder the day the workspace is made; a replay months later says "Welcome to Acme"
  // (integration, 11 October 2026), as the rail leaves out the founder's Workspace segment then.
  const pitch = useMemo(() => pitchFor({ role, org: org.name, first, founder: v.founder && !replay, assistantName: name, leadFirstName: v.leadFirstName, aiPlan }), [role, org.name, first, v.founder, replay, name, v.leadFirstName, aiPlan]);
  const fairness = useMemo(() => fairnessFor({ role, org: org.name, assistantName: name, hasLead: !!v.leadFirstName }), [role, org.name, name, v.leadFirstName]);

  // ---- Her ----------------------------------------------------------------------------------------------------------
  const character = useRef<BrendaCharacterHandle | null>(null);
  const emote = useCallback((e: "happy" | "pleased", burst = true) => { if (!reduced()) character.current?.emote(e, burst); }, []);
  const lookAt = useCallback((x: number | null, y?: number) => { if (!reduced()) character.current?.lookAt(x, y); }, []);

  const lineFor = useCallback((s: WelcomeStep): string => {
    switch (s) {
      case "welcome": return aiPlan ? W.welcome.bubble(first, name) : W.welcome.bubbleNoPlan(first, name);
      case "you": return person.photoFromGoogle && avatarKey === person.avatarKey && avatarKey ? W.you.bubbleGoogle : W.you.bubble(firstNameOf(nameDraft));
      case "assistant": return W.assistant.bubbleStart;
      case "how": return W.how.bubble;
      case "seen": return v.notice.text && !v.notice.standard ? W.seen.bubbleCustom(org.name) : supervisor ? W.seen.bubbleSupervisor : W.seen.bubbleMember(first);
      case "team": return W.team.bubble;
      case "done": return aiPlan ? W.done.bubble : W.done.bubbleNoPlan;
    }
  }, [aiPlan, first, name, person.photoFromGoogle, person.avatarKey, avatarKey, nameDraft, v.notice, org.name, supervisor]);
  const bubble = useBubble(lineFor(initialStep));

  // ---- Moving ---------------------------------------------------------------------------------------------------------
  const allowed = useCallback((s: unknown): s is WelcomeStep =>
    s === "welcome" || (isCountedStep(s) && steps.includes(s)) || (s === "done" && (replay || finished)), [steps, replay, finished]);
  const urlFor = (s: WelcomeStep) => `${window.location.pathname}?step=${s}${replay ? "&replay=1" : ""}`;

  const say = bubble.say;
  const lineForRef = useRef(lineFor);
  useEffect(() => { lineForRef.current = lineFor; }, [lineFor]);
  const go = useCallback((next: WelcomeStep, opts: { push?: boolean } = {}) => {
    setStep(next); setMoved(true); setNoteOn(false); setError(null);
    if (opts.push !== false) window.history.pushState(null, "", urlFor(next));
    window.scrollTo({ top: 0 });
    say(lineForRef.current(next));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlFor reads only `replay`
  }, [say, replay]);

  // The address names the screen from the start, so the browser's Back returns to it.
  useEffect(() => {
    window.history.replaceState(window.history.state, "", urlFor(initialStep));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the first screen
  }, []);
  useEffect(() => {
    const onPop = () => {
      // A save is running: put the address back rather than show another step under it (it would then pull the
      // person forward, or put its error on the wrong step).
      if (busyRef.current) { window.history.pushState(null, "", urlFor(stepRef.current)); return; }
      const s = new URLSearchParams(window.location.search).get("step");
      const target: WelcomeStep = allowed(s) ? s : "welcome";
      if (target !== stepRef.current) go(target, { push: false });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- urlFor reads only `replay`
  }, [allowed, go]);

  // ---- Counting and resuming (contract 3.2, 4.4) -----------------------------------------------------------------------
  const counted = useRef(false);
  useEffect(() => {
    if (replay) return;
    if (state.ready) {
      // Once per arrival (a development double run included); the address then loses the marker (urlFor).
      if (counted.current || state.done || !auto) return;
      counted.current = true;
      void api(`/api/orgs/${slug}/welcome`, { method: "PATCH", body: { seen: true }, retries: 0 }).catch(() => undefined);
      return;
    }
    // Before 0056: this tab's own copy of the step, unless the address asked for one. `done` is not looked at here: before
    // 0056 it is the assistant's setup, which this welcome's own Meet your assistant step marks (integration, 11 October 2026).
    if (new URLSearchParams(window.location.search).get("step") && initialStep !== "welcome") return;
    let kept: { step?: unknown; skipped?: unknown } | null = null;
    try { kept = JSON.parse(store.get(progressKey(membershipId)) ?? "null"); } catch { /* nothing kept */ }
    if (!kept || !isWelcomeStep(kept.step) || kept.step === "welcome" || !allowed(kept.step)) return;
    const s = kept.step;
    const sk = Array.isArray(kept.skipped) ? kept.skipped.filter(isCountedStep) : [];
    // After this first render (the server's page could not know this tab's copy).
    const t = setTimeout(() => {
      setSkipped(sk);
      setStep(s); setNoteOn(true); setResumeNote(true);
      window.history.replaceState(window.history.state, "", urlFor(s));
      say(lineFor(s));
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const progress = (next: WelcomeStep, sk: CountedStep[]) => {
    if (replay || next === "done") return;
    if (!state.ready) { store.set(progressKey(membershipId), JSON.stringify({ step: next, skipped: sk })); return; }
    void api(`/api/orgs/${slug}/welcome`, { method: "PATCH", body: { step: next, skipped: sk }, retries: 0 }).catch(() => undefined);
  };

  // Finishing runs once at a time: a second press while it saves does nothing (no second POST, no second history entry).
  const finishing = useRef(false);
  const finish = async (sk: CountedStep[]): Promise<boolean> => {
    if (finishing.current) return false;
    finishing.current = true;
    if (!replay) {
      setBusy(true);
      try {
        await api(`/api/orgs/${slug}/welcome/done`, { method: "POST", body: { outcome: "done", skipped: sk }, retries: 1 });
      } catch (err) {
        setBusy(false);
        finishing.current = false;
        setError(isApiFailure(err) ? err.error.message : W.errors.offline);
        return false;
      }
      store.drop(progressKey(membershipId));
      setBusy(false);
    }
    setFinished(true);
    go("done");
    return true;
  };

  /** A step is finished: record whether it was skipped, save the progress and move on (or finish). */
  const advance = async (from: WelcomeStep, wasSkipped: boolean) => {
    // A save that answers after the person moved elsewhere never pulls them on (they come back and continue).
    if (stepRef.current !== from) return false;
    let sk = skipped;
    if (isCountedStep(from)) sk = wasSkipped ? (skipped.includes(from) ? skipped : [...skipped, from]) : skipped.filter((s) => s !== from);
    setSkipped(sk);
    const next = nextStep(from, steps);
    if (next === "done") return finish(sk);
    progress(next, sk);
    go(next);
    return true;
  };
  const back = () => go(previousStep(step, steps));
  const [howSaving, setHowSaving] = useState(false);
  const busyNow = busy || howSaving || !!teamDraft?.sending;
  useEffect(() => { busyRef.current = busyNow; }, [busyNow]);

  // ---- Her reactions (contract 4.5) ---------------------------------------------------------------------------------
  const greeted = useRef(false);
  const onReady = useCallback(() => {
    if (greeted.current || stepRef.current !== "welcome") return;
    greeted.current = true;
    emote("happy", false);
  }, [emote]);
  const lookKey = `${draft.colour}|${draft.visor}|${draft.eyes}`;
  const lastLook = useRef(lookKey);
  useEffect(() => {
    if (lastLook.current === lookKey) return;
    lastLook.current = lookKey;
    if (stepRef.current === "assistant") emote("pleased");
  }, [lookKey, emote]);
  const column = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (step !== "seen" || !moved) return;
    let back: ReturnType<typeof setTimeout> | undefined;
    const t = setTimeout(() => {
      const r = column.current?.getBoundingClientRect();
      if (!r) return;
      lookAt(r.left + r.width / 2, r.top + Math.min(r.height, window.innerHeight) / 2);
      back = setTimeout(() => lookAt(null), 1200);
    }, 200);
    return () => { clearTimeout(t); clearTimeout(back); };
  }, [step, moved, lookAt]);
  useEffect(() => {
    if (step !== "done" || !finished || replay) return;
    const t = setTimeout(() => emote("happy", false), 250);
    return () => clearTimeout(t);
  }, [step, finished, replay, emote]);

  // ---- The page's title ------------------------------------------------------------------------------------------------
  const titleFor = (s: WelcomeStep): string => {
    switch (s) {
      case "welcome": return pitch.title;
      case "you": return W.you.title;
      case "assistant": return W.assistant.title;
      case "how": return W.how.title(name);
      case "seen": return fairness.title;
      case "team": return W.team.title;
      case "done": return replay ? W.done.replayTitle : W.done.title(first);
    }
  };
  const label = stepLabel(step, steps);
  const title = titleFor(step);
  useEffect(() => {
    document.title = label ? `${label}: ${title}${W.titleSuffix}` : `${title}${W.titleSuffix}`;
  }, [label, title]);

  // ---- Each step's Continue -----------------------------------------------------------------------------------------
  const continueYou = async () => {
    const trimmed = nameDraft.trim().replace(/\s+/g, " ");
    if (!trimmed) { setNameError(W.you.errors.name); document.getElementById(YOU_NAME_ID)?.focus(); return; }
    const changed = trimmed !== displayName;
    if (changed) {
      setBusy(true); setError(null);
      try {
        await api("/api/me/profile", { method: "PATCH", body: { displayName: trimmed, title: person.title ?? "", statusText: person.statusText ?? "" }, retries: 1 });
        setDisplayName(trimmed); setNameDraft(trimmed);
      } catch (err) {
        setBusy(false);
        const field = isApiFailure(err) ? err.error.fieldErrors?.displayName?.[0] : undefined;
        if (field) { setNameError(field); document.getElementById(YOU_NAME_ID)?.focus(); }
        else setError(isApiFailure(err) ? err.error.message : W.errors.offline);
        return;
      }
      setBusy(false);
    }
    await advance("you", !changed && !youTouched.photo && !youTouched.theme);
  };

  const continueAssistant = async (keep = false) => {
    const d = keep ? saved : draft;
    if (keep) { setDraft(saved); setFieldErrors({}); }
    const problem = assistantNameProblem(d.name);
    if (problem) { setFieldErrors({ name: problem }); document.getElementById(ASSISTANT_NAME_ID)?.focus(); return; }
    const changed = profileKey(d) !== profileKey(saved);
    if (!changed && replay) { await advance("assistant", true); return; }
    setBusy(true); setError(null);
    try {
      if (changed) {
        const r = await api<{ personal: AssistantProfile }>(`/api/orgs/${slug}/brenda/assistant`, { method: "PUT", body: assistantBody(d) });
        setSaved(r.personal); setDraft(r.personal);
      } else {
        // Brenda kept as she is: the assistant's setup is done, the look stays.
        await api(`/api/orgs/${slug}/brenda/assistant/skip`, { method: "POST", retries: 1 });
      }
    } catch (err) {
      setBusy(false);
      const fields = assistantFieldErrors(err);
      // A field the server refused takes focus, as the page's own name check does (review, 11 October 2026).
      if (fields) { setFieldErrors(fields); if (fields.name) document.getElementById(ASSISTANT_NAME_ID)?.focus(); }
      else setError(isApiFailure(err) ? err.error.message : W.errors.offline);
      return;
    }
    setBusy(false);
    await advance("assistant", !changed);
  };

  const changeDraft = (next: AssistantProfile) => {
    setFieldErrors((e) => keepErrors(e, draft, next));
    if (next.colour !== draft.colour) bubble.say(W.assistant.bubbleColour(PALETTE[next.colour].label), { choice: true });
    else if (next.visor !== draft.visor) bubble.say(W.assistant.bubbleVisor(VISORS[next.visor].label), { choice: true });
    else if (next.eyes !== draft.eyes) bubble.say(W.assistant.bubbleEyes(EYES[next.eyes].label), { choice: true });
    else if (next.name !== draft.name) {
      const n = normaliseAssistantName(next.name);
      if (n && !assistantNameProblem(n) && n !== saved.name) bubble.say(W.assistant.bubbleName(n), { choice: true });
    }
    setDraft(next);
  };

  const onTeamDone = (r: TeamStepResult) => {
    if (finishing.current) return;
    if (r.invited > 0) emote("happy", false);
    void advance("team", r.skipped);
  };

  const skipSetup = async () => {
    await api(`/api/orgs/${slug}/welcome/done`, { method: "POST", body: { outcome: "skipped", skipped }, retries: 1 });
    store.drop(progressKey(membershipId));
    router.push(`/app/${slug}/home`);
  };

  // ---- The end ----------------------------------------------------------------------------------------------------------
  // From the Team step's draft as it is now (the join link as it was left, the teams including any made, the invitations
  // sent), never from the page's first props (review, 11 October 2026).
  const td = teamDraft;
  const action = firstActionFor({
    slug, role, assistantName: name, leadsTeam: v.leadsTeam, aiReady: aiPlan && v.aiConnected,
    invited: !!v.team && !!td && (v.team.invitations > 0 || v.team.members > 0 || td.invitedSoFar > 0 || (td.code.enabled && !!td.code.code)),
    teams: td?.teams.length ?? 0,
    ownerFirstName: v.ownerFirstName,
  });
  // Without the assistant in the plan, no Voice row (review, 11 October 2026: only say what is true without it).
  const summary = {
    profileId: person.profileId, displayName, avatarKey, role, org: org.name, assistant: saved,
    voice: !aiPlan || v.assistants.voice === false ? undefined : natural.chosen ? naturalVoice(natural.chosen)?.name ?? null : null,
    acting: aiPlan ? act.state.effective : null,
    theme, invites: supervisor && td && td.invitedSoFar > 0 ? td.invitedSoFar : null,
  };

  // ---- The screen ---------------------------------------------------------------------------------------------------
  const note = noteOn ? (replay ? W.replayNote : resumeNote ? W.resume : null) : null;
  const focusTitle = moved;
  const stepNo = step === "welcome" ? 0 : step === "done" ? steps.length : steps.indexOf(step as CountedStep) + 1;

  let body: React.ReactNode;
  switch (step) {
    case "welcome":
      body = <WelcomeIntro pitch={pitch} stepCount={steps.length} note={note} focusTitle={focusTitle} error={error} onStart={() => void advance("welcome", false)} />;
      break;
    case "you":
      body = (
        <StepYou profileId={person.profileId} org={org.name} stepLabel={label} note={note} focusTitle={focusTitle}
          name={nameDraft} onName={(n) => { setNameDraft(n); setNameError(null); bubble.say(W.you.bubble(firstNameOf(n)), { choice: true }); }}
          nameError={nameError} avatarKey={avatarKey} fromGoogle={person.photoFromGoogle && avatarKey === person.avatarKey}
          onAvatar={(k) => { setAvatarKey(k); setYouTouched((t) => ({ ...t, photo: true })); if (k) { emote("pleased"); bubble.say(W.you.bubblePhoto(first)); } }}
          onTheme={() => { setYouTouched((t) => ({ ...t, theme: true })); emote("pleased"); }}
          error={error} onError={setError} busy={busy} onBack={back} onContinue={() => void continueYou()} onLook={lookAt} />
      );
      break;
    case "assistant":
      body = (
        <StepAssistant stepLabel={label} note={note} focusTitle={focusTitle} savedName={saved.name} draft={draft} onDraft={changeDraft}
          fieldErrors={fieldErrors} error={error} busy={busy} onBack={back} onKeep={() => void continueAssistant(true)}
          onContinue={() => void continueAssistant()} onNameFocus={setNameFocus} />
      );
      break;
    case "how":
      body = (
        <StepHow orgSlug={slug} org={org.name} name={name} first={first} stepLabel={label} note={note} focusTitle={focusTitle}
          act={act} aiConnected={v.aiConnected} voiceOn={v.assistants.voice !== false} speak={speak} onSpeak={setSpeak}
          natural={natural} naturalReady={!!v.natural?.ready} error={error ?? natural.failure} onError={setError}
          onBack={back} onContinue={() => void advance("how", !howTouched && !natural.status)} onSaving={setHowSaving}
          onSaved={(w) => {
            setHowTouched(true); emote("pleased");
            if (w.mode) bubble.say(w.mode === "auto" ? W.how.bubbleAuto : W.how.bubbleAsk);
          }} />
      );
      break;
    case "seen":
      body = (
        <StepSeen orgSlug={slug} org={org.name} isOwner={role === "owner"} fairness={fairness} notice={v.notice} stepLabel={label} note={note}
          focusTitle={focusTitle} error={error} busy={busy} onBack={back} onContinue={() => void advance("seen", false)} />
      );
      break;
    case "team":
      body = v.team ? (
        <>
          {/* Finishing failed after the Team step (its own frame holds its own errors). */}
          {error ? <p role="alert" className="mb-4 rounded-xl border border-danger/30 bg-danger/[0.07] px-3.5 py-2.5 text-sm font-normal text-foreground">{error}</p> : null}
          <TeamStep orgSlug={slug} orgName={org.name} assistantName={name} data={v.team} draft={teamDraft ?? teamDraftFrom(v.team)} onDraft={onTeamDraft}
            busy={busy} stepLabel={label ?? ""} focusTitle={focusTitle} onBack={back} onDone={onTeamDone} onSay={(line) => bubble.say(line)} />
        </>
      ) : null;
      break;
    case "done":
      body = (
        <StepDone slug={slug} org={org.name} first={first} name={name} replay={replay} aiPlan={aiPlan} action={action} focusTitle={focusTitle}
          summary={summary} mac={replay || !aiPlan ? null : { look: saved, downloadUrl: v.desktopDownloadUrl }} />
      );
      break;
  }

  const currentIndex = rail.findIndex((s) => !s.pre && s.key === step);
  const progressText = label ?? title;
  const showSkip = !replay && step !== "done";

  return (
    <AssistantProvider value={{ ...v.assistants, personal: saved, speak }}>
      <div className="min-h-dvh bg-background">
        <header className="sticky top-0 z-[var(--z-sticky)] grid h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-border bg-background px-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3 min-[860px]:min-w-[7.5rem]">
            <span className="inline-flex"><LogoArt height={16} /><span className="sr-only">Boredroom</span></span>
            <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />
            <span className="hidden max-w-[12rem] truncate text-sm font-medium text-secondary sm:block">{org.name}</span>
          </div>
          <div className="min-w-0">
            <nav aria-label={W.rail.label} className="mx-auto hidden w-full max-w-[880px] min-[860px]:block">
              <ol className="flex gap-2">
                {rail.map((seg, i) => {
                  const current = currentIndex === i;
                  const done = seg.pre || (currentIndex >= 0 && i < currentIndex);
                  const canJump = done && !seg.pre && !busyNow && !(finished && !replay);
                  const bar = <span aria-hidden className={cn("block h-0.5 rounded-full", done || current ? "bg-accent" : "bg-fill-150")} />;
                  const words = (
                    <span className={cn("mt-2 flex items-center gap-1 text-xs", current ? "text-foreground" : done ? "text-secondary" : "text-subtle")}>
                      {done ? <Check aria-hidden className="size-3 shrink-0" /> : null}
                      <span className="truncate">{seg.label}</span>
                    </span>
                  );
                  const sr = seg.pre ? (seg.key === "you" ? W.rail.fromProfile : W.rail.doneSr) : current ? W.rail.currentSr : done ? W.rail.doneSr : "";
                  return (
                    <li key={seg.key} className="min-w-0 flex-1" aria-current={current ? "step" : undefined}>
                      {canJump ? (
                        <button type="button" onClick={() => go(seg.key as WelcomeStep)} aria-label={W.rail.goBack(seg.label)}
                          className="block w-full rounded-sm text-left transition-colors duration-75 hover:[&>span:last-child]:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]">
                          {bar}{words}
                        </button>
                      ) : (
                        <div>{bar}{words}<span className="sr-only">{sr}</span></div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
            <div className="mx-auto max-w-[240px] min-[860px]:hidden">
              <ProgressBar size="sm" doneTone="accent" label={W.topBar.progress} value={stepNo} max={steps.length} valueText={progressText} />
            </div>
          </div>
          {/* Keeps its width when empty ("You're all set"), so the rail does not move. */}
          <div className="flex items-center justify-end min-[860px]:min-w-[7.5rem]">
            {showSkip ? <Button variant="ghost" size="sm" onClick={() => setSkipOpen(true)}>{W.topBar.skip}</Button> : null}
            {replay && step !== "done" ? <Link href={`/app/${slug}/settings?section=assistant`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{W.topBar.close}</Link> : null}
          </div>
        </header>

        <main id="main" className="flex flex-col px-4 pb-5 pt-4 sm:px-5 min-[860px]:grid min-[860px]:grid-cols-[minmax(0,45fr)_minmax(0,55fr)] min-[860px]:gap-6">
          {/* The card first in the page's order (a screen reader meets the step first); the stage only looks first. */}
          <div ref={column} className="flex min-w-0 flex-col pt-6 min-[860px]:min-h-[calc(100dvh-92px)] min-[860px]:justify-center min-[860px]:py-8 min-[860px]:pl-[8%]">
            <motion.div key={step} initial={moved ? { opacity: 0, y: 4 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: EASE }}>
              {body}
            </motion.div>
          </div>
          <WelcomeStage
            look={lookOf(step === "assistant" ? draft : saved)}
            name={step === "assistant" ? shownName : name}
            editingName={step === "assistant" && nameFocus}
            caption={step === "assistant" ? W.assistant.caption(PALETTE[draft.colour].label, VISORS[draft.visor].label, EYES[draft.eyes].label) : null}
            facesCaption={step === "assistant" ? W.assistant.facesCaption(shownName) : null}
            stageNote={step === "assistant" ? W.assistant.stageNote : null}
            line={bubble.line} typing={bubble.typing}
            done={step === "done" ? <DoneSummary {...summary} perch /> : undefined}
            handle={character} onReady={onReady} />
        </main>
      </div>

      <ConfirmDialog open={skipOpen} onClose={() => setSkipOpen(false)} tone="primary"
        title={W.skipDialog.title} description={W.skipDialog.description(name)}
        confirmLabel={W.skipDialog.confirm} cancelLabel={W.skipDialog.cancel} pendingLabel={W.skipDialog.confirm}
        onConfirm={skipSetup} />
    </AssistantProvider>
  );
}
