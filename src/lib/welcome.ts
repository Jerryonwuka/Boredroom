/**
 * The first-run welcome (owner request, 11 October 2026: "when new users login and create an account i need there to be a
 * sort of set up, walkthrough guide, elevator pitch kind of thing, where they can set their names, images, choose
 * settings, select brands, them maybe after, a 'you're all set up' message"; built as "the stage" design with the
 * judge's grafts). One full-screen page per workspace, `/app/[workspace]/welcome`, takes a new member through a short
 * pitch for their role, their name and photo, their own assistant's name and look, how it works with them, what is and
 * isn't seen about them, their team (owners and HR), then "You're all set" with one first action.
 *
 * Shared by the server (services/welcome, the home page's Next steps) and the client (the welcome page, the Next steps
 * card, Settings): the screens and steps, the state's shape, each role's first action and every fixed word. Type imports
 * only, so it runs on both sides.
 */
import type { AssistantProfiles } from "@/lib/assistant-look";
import type { NaturalVoiceView } from "@/lib/natural-voices";

// ---- Screens and steps ---------------------------------------------------------------------------------------------------

/** Every screen, in order. "welcome" (the pitch) and "done" ("You're all set") are screens, not counted steps. */
export const WELCOME_STEPS = ["welcome", "you", "assistant", "how", "seen", "team", "done"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];
export const isWelcomeStep = (v: unknown): v is WelcomeStep => (WELCOME_STEPS as readonly unknown[]).includes(v);

/** The counted steps ("Step 2 of 4"). Each opens already filled in, so Continue always works and keeps the defaults. */
export const COUNTED_STEPS = ["you", "assistant", "how", "seen", "team"] as const;
export type CountedStep = (typeof COUNTED_STEPS)[number];
export const isCountedStep = (v: unknown): v is CountedStep => (COUNTED_STEPS as readonly unknown[]).includes(v);

export type WelcomeRole = "owner" | "hr" | "manager" | "employee";
/** How it ended: finished, skipped, or a member from before the welcome existed (migration 0056 marks them). */
export type WelcomeOutcome = "done" | "skipped" | "existing";

/** It opens on its own at most this many times; after that, Next steps on the assistant's page offers it instead. */
export const WELCOME_AUTO_SHOWS = 2;
/** The most a progress request's body may hold (a few short fields). */
export const WELCOME_BODY_MAX = 1024;
/** The most addresses the Team step sends in one go. */
export const INVITE_BATCH_MAX = 20;

/**
 * Where the welcome opens on its own: the gate, and straight after creating or joining a workspace. `?auto=1` lets the
 * page count the opening on the server, once per arrival, so it opens on its own at most WELCOME_AUTO_SHOWS times
 * whatever the tab (review, 11 October 2026: a per-tab count let every bare /home in the same tab reopen it uncounted).
 */
export const welcomeAutoPath = (slug: string): string => `/app/${slug}/welcome?auto=1`;

/** Owners and HR bring their team (the Team step) and get the supervisor's version of "What's seen". */
export const bringsTeam = (role: WelcomeRole): boolean => role === "owner" || role === "hr";

/**
 * This person's counted steps, in order. "You" is left out once they finished it in another workspace (their name and
 * photo belong to their account, and asking again breaks WCAG 3.3.7) except in a replay; "How it helps" when the
 * workspace's plan has no assistant; "Team" in a replay.
 */
export function stepsFor(o: { role: WelcomeRole; youDone: boolean; aiPlan: boolean; replay: boolean }): CountedStep[] {
  const steps: CountedStep[] = [];
  if (!o.youDone || o.replay) steps.push("you");
  steps.push("assistant");
  if (o.aiPlan) steps.push("how");
  steps.push("seen");
  if (bringsTeam(o.role) && !o.replay) steps.push("team");
  return steps;
}

/** "Step 2 of 4", or null on the welcome and on "You're all set". */
export function stepLabel(step: WelcomeStep, steps: readonly CountedStep[]): string | null {
  const i = isCountedStep(step) ? steps.indexOf(step) : -1;
  return i < 0 ? null : WELCOME_WORDS.stepOf(i + 1, steps.length);
}

/** The screen after `step`: the first step after the welcome, then each step, then "done". */
export function nextStep(step: WelcomeStep, steps: readonly CountedStep[]): WelcomeStep {
  if (step === "welcome") return steps[0] ?? "done";
  if (!isCountedStep(step)) return "done";
  const i = steps.indexOf(step);
  return i < 0 || i === steps.length - 1 ? "done" : steps[i + 1];
}

/** The screen before `step` (Back): the welcome comes before the first step. */
export function previousStep(step: WelcomeStep, steps: readonly CountedStep[]): WelcomeStep {
  if (step === "done") return steps[steps.length - 1] ?? "welcome";
  if (!isCountedStep(step)) return "welcome";
  const i = steps.indexOf(step);
  return i <= 0 ? "welcome" : steps[i - 1];
}

/**
 * Where the page opens: a screen the address names (`?step=`) when it is one of this person's ("done" only in a replay),
 * else, outside a replay, the screen saved on the server (resuming), else the welcome. A saved step this person no longer
 * has (You, once finished in another workspace; How it helps, once the plan dropped the assistant; Team, after a change of
 * role) opens the next step they do have, or their last.
 */
export function initialStepFor(o: { requested: unknown; saved: WelcomeStep | null; steps: readonly CountedStep[]; replay: boolean }): WelcomeStep {
  const allowed = (s: unknown): s is WelcomeStep => s === "welcome" || (isCountedStep(s) && o.steps.includes(s)) || (o.replay && s === "done");
  if (allowed(o.requested)) return o.requested;
  if (o.replay) return "welcome";
  if (allowed(o.saved)) return o.saved;
  const saved = o.saved;
  if (isCountedStep(saved)) return o.steps.find((s) => COUNTED_STEPS.indexOf(s) >= COUNTED_STEPS.indexOf(saved)) ?? o.steps[o.steps.length - 1] ?? "welcome";
  return "welcome";
}

/** One segment of the rail across the top. `pre`: done before this page (the account, the founder's workspace, "You" from another workspace). */
export type RailKey = "account" | "workspace" | CountedStep | "done";
export type RailSegment = { key: RailKey; label: string; pre: boolean };

/** The rail: the head start first (always done), then this person's steps, then "All set". */
export function railFor(o: { role: WelcomeRole; youDone: boolean; aiPlan: boolean; founder: boolean; replay: boolean }): RailSegment[] {
  const R = WELCOME_WORDS.rail;
  const rail: RailSegment[] = [{ key: "account", label: R.account, pre: true }];
  if (o.founder && !o.replay) rail.push({ key: "workspace", label: R.workspace, pre: true });
  if (o.youDone && !o.replay) rail.push({ key: "you", label: R.you, pre: true });
  for (const s of stepsFor(o)) rail.push({ key: s, label: R[s], pre: false });
  rail.push({ key: "done", label: R.done, pre: false });
  return rail;
}

// ---- State (migration 0056, assistant_private: the person's own row, never a colleague's) ----------------------------------

export type WelcomeState = {
  /** Migration 0056 is applied: progress is kept on the server. Before it, in this browser's session only. */
  ready: boolean;
  done: boolean;
  outcome: WelcomeOutcome | null;
  /** The screen reached, saved on every Continue; null before the first. */
  step: WelcomeStep | null;
  skipped: CountedStep[];
  /** How many times it has opened on its own (the gate stops at WELCOME_AUTO_SHOWS). */
  shown: number;
  nextStepsHidden: boolean;
  /** "You" was finished in another of the person's workspaces (read from their own rows only). */
  youDone: boolean;
};

/** Before 0056 nothing is kept on the server; services/welcome sets `done` from the assistant's setup (setup_done_at). */
export const WELCOME_NOT_READY: WelcomeState = { ready: false, done: false, outcome: null, step: null, skipped: [], shown: 0, nextStepsHidden: false, youDone: false };

/** PATCH /api/orgs/{org}/welcome. At least one field. Once done, only `nextStepsHidden` changes anything. */
export type WelcomePatch = { step?: Exclude<WelcomeStep, "done">; skipped?: CountedStep[]; seen?: true; nextStepsHidden?: boolean };
/** POST /api/orgs/{org}/welcome/done. */
export type WelcomeDoneInput = { outcome: "done" | "skipped"; skipped?: CountedStep[] };

/** The person went through "What's seen" (Settings' setup list counts the monitoring notice as reviewed). */
export const passedSeen = (s: WelcomeState): boolean => s.ready && (s.outcome === "done" || s.step === "team");

/** A person's first name as the app says it elsewhere ("Good morning, Ada"). */
export const firstNameOf = (displayName: string): string => displayName.trim().split(/\s+/)[0] || displayName.trim();

// ---- What the page gets from the server (services/welcome welcomeView) ------------------------------------------------------

export type WelcomeTeamData = {
  /** Owners may invite HR; HR may invite staff and team leads only. */
  isOwner: boolean;
  teams: { id: string; name: string }[];
  joinCode: { code: string | null; enabled: boolean; role: "manager" | "employee"; teamId: string | null };
  /** Invitations the workspace has made to anyone but this person, whatever became of them. */
  invitations: number;
  /** Active members other than this person and the workspace's owners. */
  members: number;
};

export type WelcomeNotice = {
  text: string | null;
  version: number | null;
  /** The text is today's standard notice (DEFAULT_NOTICE), word for word. */
  standard: boolean;
  /** The text still describes screen recording (noticeMentionsScreenRecording). */
  outdated: boolean;
};

export type WelcomeView = {
  state: WelcomeState;
  /** Opened from Settings to go through again (only once the welcome is done). Nothing about progress is saved. */
  replay: boolean;
  /** The owner who created this workspace (the rail's "Workspace" segment and the welcome's title). */
  founder: boolean;
  role: WelcomeRole;
  org: { slug: string; name: string };
  person: { profileId: string; displayName: string; firstName: string; avatarKey: string | null; title: string | null; statusText: string | null; photoFromGoogle: boolean };
  assistants: AssistantProfiles;
  /** The workspace's plan includes the assistant (AI_ASSISTANT). */
  aiPlan: boolean;
  /** An AI connection exists (the workspace's key or the server's). */
  aiConnected: boolean;
  /** The person's natural voice; null when it could not be read. */
  natural: NaturalVoiceView | null;
  notice: WelcomeNotice;
  /** Staff and team leads: the first name of a lead of their first team, if any. */
  leadFirstName: string | null;
  /** Team leads: the first team they lead (by name). */
  leadsTeam: { id: string; name: string } | null;
  /** The first name of the workspace's earliest owner (the "lead with no team" line). */
  ownerFirstName: string | null;
  /** Owners and HR only. */
  team: WelcomeTeamData | null;
  /** DESKTOP_DOWNLOAD_URL when it is set to an https address; null otherwise. */
  desktopDownloadUrl: string | null;
};

// ---- The first action ("You're all set") and Next steps ----------------------------------------------------------------------

export type FirstActionKey = "plan_today" | "assign_task" | "invite_team" | "create_team" | "open_dashboard";
export type FirstAction = { key: FirstActionKey; label: string; hint: string; href: string; note: string | null };
export type FirstActionInput = {
  slug: string;
  role: WelcomeRole;
  assistantName: string;
  leadsTeam: { id: string; name: string } | null;
  /** The plan includes the assistant and the AI is connected: "Assign a first task" fills the assistant's box. */
  aiReady: boolean;
  /** Owners and HR: someone besides themselves and the owners was invited or has joined, or the join link is on. */
  invited: boolean;
  /** Owners and HR: teams in the workspace. */
  teams: number;
  ownerFirstName: string | null;
};

/** The one thing to do next, by role (the end screen's one orange button, and the first item of Next steps). */
export function firstActionFor(i: FirstActionInput): FirstAction {
  const base = `/app/${i.slug}`;
  const W = WELCOME_WORDS.firstAction;
  if (bringsTeam(i.role)) {
    if (!i.invited) return { key: "invite_team", label: W.inviteTeam.label, hint: W.inviteTeam.hint, href: `${base}/people?tab=people&invite=1`, note: null };
    if (i.teams === 0) return { key: "create_team", label: W.createTeam.label, hint: W.createTeam.hint, href: `${base}/people?tab=teams&new=team`, note: null };
    return { key: "open_dashboard", label: W.openDashboard.label, hint: W.openDashboard.hint, href: `${base}/dashboard`, note: null };
  }
  if (i.role === "manager" && i.leadsTeam) {
    return i.aiReady
      ? { key: "assign_task", label: W.assignTask.label, hint: W.assignTask.hintAi(i.assistantName), href: `${base}/home?ask=${encodeURIComponent(W.assignTask.ask)}`, note: null }
      : { key: "assign_task", label: W.assignTask.label, hint: W.assignTask.hintBoard(i.leadsTeam.name), href: `${base}/teams/${i.leadsTeam.id}`, note: null };
  }
  return { key: "plan_today", label: W.planToday.label, hint: W.planToday.hint, href: `${base}/todos?add=1`, note: i.role === "manager" ? W.planToday.noTeam(i.ownerFirstName) : null };
}

export type NextStepKey = "finish_welcome" | FirstActionKey | "mac_app";
export type NextStepItem = { key: NextStepKey; label: string; href: string; external: boolean };
/** Only what is left to do, derived from data (never padded); `left` is items.length. */
export type NextSteps = { items: NextStepItem[]; left: number };

// ---- Words ------------------------------------------------------------------------------------------------------------------------

export type BeatIcon = "day" | "chase" | "help" | "talk" | "board" | "hand" | "check" | "glance" | "assistants" | "messages" | "fair" | "people";
export type Beat = { icon: BeatIcon; title: string; line: string };
export type Pitch = { title: string; lede: string; beats: Beat[] };
export type NeverItem = { strong: string; rest: string | null };
export type Fairness = {
  title: string; lede: string; seenHeading: string; seen: string[]; neverHeading: string; never: NeverItem[]; footer: string;
  /** What every colleague sees (presence), apart from the supervisors' list; null for the supervisor's version. */
  colleagues: string | null;
};

const ROLE_NAME: Record<WelcomeRole, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };
const JOIN_AS: Record<WelcomeRole, string> = { owner: "an organisation owner", hr: "an HR administrator", manager: "a team lead", employee: "staff" };

export const WELCOME_WORDS = {
  pageTitle: "Welcome",
  /** The app's own title template ("%s · Boredroom", app/layout.tsx), for document.title as the steps change. */
  titleSuffix: " · Boredroom",
  stepOf: (n: number, total: number) => `Step ${n} of ${total}`,
  roleName: ROLE_NAME,
  joinAs: JOIN_AS,
  topBar: { skip: "Skip setup", close: "Close", progress: "Setup progress" },
  rail: {
    label: "Setup steps", account: "Account", workspace: "Workspace", you: "You", assistant: "Assistant", how: "How it helps",
    seen: "What's seen", team: "Team", done: "All set",
    doneSr: ", done", currentSr: ", current step", fromProfile: ", done, from your profile",
    goBack: (label: string) => `${label}, done. Go back to this step.`,
  },
  resume: "Welcome back. Picking up where you left off.",
  replayNote: "You're going through the welcome again. Nothing changes unless you change it.",
  buttons: { start: "Set up in 2 minutes", continue: "Continue", back: "Back", gotIt: "Got it", later: "Later", send: "Send invites", backToSettings: "Back to Settings", skipThis: "Skip this for now", enterKey: "Enter" },
  skipDialog: {
    title: "Skip the rest of setup?",
    description: (name: string) => `${name} keeps the name and look it has now, and everything else keeps its default. You can go through the welcome again from Settings at any time.`,
    confirm: "Skip setup", cancel: "Keep going",
  },
  errors: {
    offline: "Cannot reach the server. Check your connection and try again.",
    impersonated: "Only the person can go through their own setup. It stays as it is while someone else is signed in as them.",
    notReady: "Setup progress needs a database update first. What you choose here is still saved.",
  },
  welcome: {
    title: (o: { org: string; first: string; founder: boolean }) => (o.founder ? `${o.org} is ready, ${o.first}` : `Welcome to ${o.org}, ${o.first}`),
    hint: (steps: number) => `${steps} short steps, all with good defaults.`,
    bubble: (first: string, name: string) => `Hi ${first}. I'm ${name}, an AI assistant, not a person. I can remind, draft and summarise, and I can get things wrong. I only ever act with your permissions.`,
    bubbleNoPlan: (first: string, name: string) => `Hi ${first}. I'm ${name}, an AI assistant, not a person. Once your workspace's plan includes me, I can remind, draft and summarise for you.`,
  },
  you: {
    title: "This is you",
    lede: (org: string) => `Colleagues at ${org} see your name and photo.`,
    name: "Your name",
    photo: "Photo",
    photoHint: "PNG, JPEG or WebP. Only people in your workspaces can see it.",
    fromGoogle: "From your Google account.",
    add: "Add a photo", change: "Change photo", remove: "Remove", uploading: "Uploading…", removing: "Removing…",
    theme: "Theme", themeHint: "On this device.", dark: "Dark", light: "Light",
    bubble: (typedFirst: string) => (typedFirst ? `Nice to meet you, ${typedFirst}.` : "Nice to meet you."),
    bubblePhoto: (first: string) => `Good photo, ${first}.`,
    bubbleGoogle: "I found your photo on your Google account. Keep it, or change it.",
    errors: {
      type: "That file isn't a PNG, JPEG or WebP image. Choose one of those.",
      tooBig: (mb: string) => `That image is ${mb} MB. Choose one under 20 MB.`,
      unreadable: "This browser couldn't read that image. Choose another one, or one under 2 MB.",
      offline: "Cannot reach the server. Your photo was not changed.",
      name: "Enter your name.",
    },
  },
  assistant: {
    title: "Meet your assistant",
    lede: (saved: string) => `Give them a name and a look, or keep ${saved}. You can change this any time in Settings.`,
    keep: (saved: string) => `Keep ${saved}`,
    counter: (n: number, max: number) => `${n} of ${max}`,
    bubbleStart: "Pick a colour and I'll try it on.",
    bubbleColour: (colour: string) => `${colour}. I could get used to this.`,
    bubbleVisor: (visor: string) => `${visor}. Very me.`,
    bubbleEyes: (eyes: string) => `${eyes}. Now I can see you properly.`,
    bubbleName: (name: string) => `${name} it is.`,
    caption: (colour: string, visor: string, eyes: string) => `${colour}, ${visor.toLowerCase()}, ${eyes.toLowerCase()}`,
    facesCaption: (name: string) => `How ${name} looks in chat, lists and the notch`,
    stageNote: "Colleagues see this name and look. Nothing else about your assistant.",
  },
  how: {
    title: (name: string) => `How ${name} works with you`,
    lede: "Two choices. Both can be changed in Settings.",
    // The AI disclosure is said once, on the welcome; here she asks about the choice (review, 11 October 2026).
    bubble: "Should I check with you before anything reaches someone else?",
    bubbleAsk: "Then I'll show you first and wait for your yes.",
    bubbleAuto: "Then I'll act straight away when you ask me in our chat, and you can undo it for 10 minutes.",
    act: {
      legend: "Before acting",
      ask: "Ask me before acting",
      askHint: (name: string) => `${name} shows you what it will do before anything reaches someone else.`,
      recommended: "Recommended",
      auto: "Act without asking",
      autoHint: (name: string) => `${name} does it straight away when you ask in your own chat, with Undo for 10 minutes.`,
      either: (name: string) => `Either way, ${name} never does anything you couldn't do yourself.`,
      locked: (org: string) => `${org} has set every assistant to ask first.`,
      needsAi: (name: string) => `Acting without asking needs the AI connected. Until then ${name} asks first.`,
      notReady: (name: string) => `${name} asks before anything that reaches someone else.`,
    },
    voice: {
      legend: (name: string) => `When ${name} speaks`,
      voice: (name: string) => `When I talk to ${name}`,
      always: "Always",
      never: "Never",
      hint: "Saved to your account, so the desktop app follows it too.",
      sample: "Play a sample",
      stop: "Stop",
      sampleLabel: "Play a sample of the computer voice",
      sampleText: (first: string, name: string) => `Hi ${first}, I'm ${name}.`,
      choose: "Choose a voice",
      noVoice: "This browser has no voice of its own, so the computer voice can't play here.",
    },
    saving: "Saving…",
    saved: "Saved",
  },
  seen: {
    titleMember: (org: string) => `What ${org} sees, and what it doesn't`,
    titleSupervisor: "What you'll see about your team, and what you won't",
    ledeStaff: "Your team lead, HR and the owner see your work, not your screen.",
    ledeStaffNoLead: "HR and the owner see your work, not your screen. So will your team lead, once you're in a team.",
    ledeLead: "HR and the owner see your work, not your screen. You see the same about your team, and nothing more.",
    ledeSupervisor: "This is exactly what your team is told, on their first day.",
    headingSeenMember: "They can see",
    headingSeenSupervisor: "You can see",
    // "Nobody else": the people in a direct message or a call see and hear it (review, 11 October 2026).
    headingNeverMember: "Nobody else sees",
    headingNeverSupervisor: "Nobody sees, you included",
    footerMember: "If your time looks uncertain, you get a question, not a penalty.",
    /** Presence is every colleague's, not only the supervisors' (review, 11 October 2026), so it has its own line. */
    colleaguesMember: "Colleagues see whether you're online or on a call, never which call.",
    footerSupervisor: "If someone's time looks uncertain, they get a question, not a penalty.",
    noticeLink: (org: string) => `Read ${org}'s notice`,
    noticeTitle: (org: string) => `${org}'s monitoring notice`,
    noticeVersion: (v: number) => `Version ${v}`,
    noNotice: (org: string) => `${org} hasn't published a monitoring notice yet.`,
    bubbleMember: (first: string) => `I work for you, ${first}. Owners and HR see a plain log of what I did, never what you said to me.`,
    bubbleSupervisor: "Your team gets this same list on their first day.",
    bubbleCustom: (org: string) => `${org} has written its own notice. Please read it.`,
    outdatedOwner: "Your notice still describes screen recording, which Boredroom no longer does. You can publish the new standard notice in Settings.",
  },
  team: {
    title: "Bring your team",
    lede: "Invite people now, or share a link. Most people start with one or two.",
    emails: "Email addresses",
    emailsHint: "Separate them with commas or new lines.",
    role: "They join as",
    roles: { employee: "Staff", manager: "Team lead", hr: "HR administrator" },
    teamLabel: "Team",
    noTeam: "No team yet",
    newTeam: "New team…",
    newTeamName: "Team name",
    newTeamHint: "Such as Design, Tech or Branding.",
    linkHeading: "Or share a link",
    linkSwitch: "Let people join with a link",
    linkOn: (role: "manager" | "employee", team: string | null = null) => (role === "manager"
      ? (team ? `Anyone with the link or code joins as a lead of ${team}.` : "Anyone with the link or code joins as a team lead.")
      : "Anyone with the link or code joins as staff."),
    linkOff: "Off until you turn it on.",
    copyLink: "Copy the join link",
    copyCode: "Copy the code",
    // The link's field, the code's label and the list of what was sent (integration, 11 October 2026: these were typed
    // in team-step.tsx).
    linkField: "Join link",
    code: "Code",
    results: "Invitations",
    copied: "Copied",
    copyFailed: "This browser blocked copying. Select the link and copy it by hand.",
    sent: "Invitation sent",
    partial: (sent: number, total: number) => `${sent} of ${total} invitations were sent. The others are marked below.`,
    bubble: "Who should I invite? I'll let you know when they join.",
    bubbleSent: (n: number) => (n === 1 ? "Sent 1 invitation. I'll let you know when they join." : `Sent ${n} invitations. I'll let you know when they join.`),
    errors: {
      none: "Add at least one email address, or press Later.",
      invalid: (address: string) => `${address} doesn't look like an email address.`,
      tooMany: (max: number) => `Invite up to ${max} people at a time.`,
      teamName: "Name the new team, or choose another.",
    },
  },
  done: {
    badge: "Setup done",
    title: (first: string) => `You're all set, ${first}`,
    // Settings is named once, in `again` at the foot (review, 11 October 2026).
    lede: (name: string) => `${name} is ready when you are.`,
    /** The plan has no assistant: only what is true without it (review, 11 October 2026). */
    ledeNoPlan: (name: string, org: string) => `Your profile is ready. ${name} joins in once ${org}'s plan includes an assistant.`,
    live: "You're all set.",
    replayTitle: "That's the welcome",
    replayLede: "Everything you changed is saved.",
    again: "To see this again: Settings, Your assistant, Replay the welcome.",
    bubble: "All set. I'm here when you need me.",
    bubbleNoPlan: "Your workspace's plan doesn't include me yet. My look is saved for when it does.",
    card: {
      at: (role: WelcomeRole, org: string) => `${ROLE_NAME[role]} at ${org}`,
      assistant: "Assistant", voice: "Voice", acting: "Before acting", theme: "Theme", invites: "Invitations",
      look: (name: string, colour: string) => `${name}, ${colour.toLowerCase()}`,
      asks: "Asks you first", acts: "Acts without asking", computer: "Computer voice",
      sent: (n: number) => `${n} sent`,
    },
  },
  firstAction: {
    planToday: {
      // Names where it goes, so it is not mistaken for the assistant's "Plan my day" (review, 11 October 2026).
      label: "Write today's to-dos",
      hint: "On To-dos, write down what you're doing today, then press Start when you begin.",
      noTeam: (owner: string | null) => (owner ? `When ${owner} makes you a team's lead, your team's board appears in the menu.` : "When an owner makes you a team's lead, your team's board appears in the menu."),
    },
    assignTask: {
      label: "Assign a first task",
      /** What "Assign a first task" puts in the assistant's box (it never sends; the trailing space leaves the cursor after it). */
      ask: "Assign a task to ",
      hintAi: (name: string) => `Tell ${name} what needs doing and who should do it. By default you confirm before it goes.`,
      hintBoard: (team: string) => `On ${team}'s board, press New task and choose who does it.`,
    },
    inviteTeam: { label: "Invite your team", hint: "People join as staff unless you choose otherwise." },
    createTeam: { label: "Create your first team", hint: "A team gives its lead a board and a place to talk." },
    openDashboard: { label: "Open the dashboard", hint: "Who's on what, what's late and what needs a decision." },
  },
  mac: {
    title: "Brenda for Mac",
    line: (name: string) => `${name} sits in your Mac's notch, so you can ask and get reminders without opening a tab.`,
    get: "Get the Mac app",
    have: "Already have Brenda for Mac?",
    link: "Link it",
  },
  nextSteps: {
    title: "Next steps",
    left: (n: number) => `${n} left`,
    hide: "Hide next steps",
    finishWelcome: "Finish your welcome",
    mac: "Get Brenda for Mac",
    hideFailed: "Couldn't hide it. Try again.",
    /** Said in its place once hidden (review, 11 October 2026). */
    hidden: "Next steps hidden. You can show them again in Settings.",
  },
  settings: {
    section: "Welcome and setup",
    description: "Go through the two-minute welcome again. Nothing changes unless you change it.",
    /** The card's row (integration, 11 October 2026: it was typed in welcome-settings.tsx). */
    row: "The welcome",
    replay: "Replay the welcome",
    finish: "Finish setting up",
    showNext: "Show next steps",
    nextHidden: (name: string) => `Next steps are hidden on ${name}'s page.`,
    impersonated: "Only the person can do this. It stays as it is while you are signed in as them.",
  },
  notifications: {
    kind: "New member",
    title: (name: string, role: WelcomeRole) => `${name} joined as ${JOIN_AS[role]}`,
    body: (team: string) => `In ${team}.`,
  },
} as const;

/**
 * The pitch for this person: a title, one plain sentence, then short beats about what Boredroom does for them. Everyone
 * hears the fairness promise here, not only owners and HR: staff and leads, the people supervised, get it as a fourth
 * beat rather than first on What's seen (review, 11 October 2026).
 */
export function pitchFor(o: { role: WelcomeRole; org: string; first: string; founder: boolean; assistantName: string; leadFirstName: string | null; aiPlan: boolean }): Pitch {
  const title = WELCOME_WORDS.welcome.title({ org: o.org, first: o.first, founder: o.founder });
  const lede = bringsTeam(o.role)
    ? `Boredroom is where ${o.org} plans the work, hands it over and talks it through. Here's what it does for you and your team.`
    : `Boredroom is where ${o.org} plans the work, hands it over and talks it through. Here's what it does for you.`;
  const name = o.assistantName;
  const fairMember: Beat = { icon: "fair", title: "Fair by design", line: "No productivity score, no ranking, no screen or call recording. Before you start, you'll see exactly what's seen." };
  if (o.role === "employee") {
    return { title, lede, beats: [
      { icon: "day", title: "Your day in one place", line: "What's yours, what's due and what's waiting on you. Write your to-dos, press Start, press Done." },
      o.aiPlan
        ? { icon: "chase", title: "Less chasing", line: `${name} reminds you what's due, drafts for you and follows up when you're waiting on someone.` }
        : { icon: "talk", title: "Talk where the work is", line: "Messages and calls sit next to the tasks they're about." },
      // Without a lead yet, never promise one (it would contradict What's seen; review, 11 October 2026).
      { icon: "help", title: "Help finds you", line: o.leadFirstName ? `When something's stuck, ${o.leadFirstName}, your team lead, sees it and can step in.` : "When something's stuck, HR and the owner can see it and step in. So will your team lead, once you're in a team." },
      fairMember,
    ] };
  }
  if (o.role === "manager") {
    return { title, lede, beats: [
      { icon: "board", title: "See where the work is", line: "What your team has on, what's stuck and what's done, without asking round." },
      o.aiPlan
        ? { icon: "hand", title: "Hand work over in a sentence", line: `Tell ${name} what needs doing and who should do it. By default you confirm before it goes.` }
        : { icon: "hand", title: "Hand work over", line: "Create a task, choose who does it, and see when it's picked up." },
      { icon: "check", title: "Check, don't chase", line: o.aiPlan ? `Finished work comes to you for a check, and ${name} tells you when something hasn't been picked up.` : "Finished work comes to you for a check, so nothing slips past." },
      fairMember,
    ] };
  }
  const second: Beat = o.aiPlan
    ? { icon: "assistants", title: "An assistant for everyone", line: "Each person's assistant plans, reminds and follows up, within that person's own permissions." }
    : { icon: "messages", title: "Messages and calls in one place", line: "Talk to anyone, or a whole team, next to the work." };
  const fair: Beat = { icon: "fair", title: "Fair by design", line: "No productivity score, no rankings, no screen or call recording. Your team is told exactly what you see." };
  if (o.role === "hr") {
    return { title, lede, beats: [{ icon: "people", title: "Attendance, timesheets and people in one place", line: "Who's in, who's late and whose hours need a look, without a spreadsheet." }, second, fair] };
  }
  return { title, lede, beats: [{ icon: "glance", title: "Your company's work at a glance", line: "Who's on what, what's late and what needs a decision, on one dashboard." }, second, fair] };
}

/**
 * What is and isn't seen about the person (the fairness beat), checked against the code on 11 October 2026: tasks, clock-ins,
 * work sessions and submissions are visible to the person's team lead, HR and the owner; presence and "on a call" (never
 * which call) to colleagues; the assistant's action log and monthly request counts to owners and HR (brenda_actions,
 * Usage this month), never what was said or read; direct messages and assistant chats to their own people only (RLS);
 * screens and calls are never recorded (phase 8), and call notes are taken only for people who agree.
 */
export function fairnessFor(o: { role: WelcomeRole; org: string; assistantName: string; hasLead: boolean }): Fairness {
  const S = WELCOME_WORDS.seen;
  if (bringsTeam(o.role)) {
    return {
      title: S.titleSupervisor, lede: S.ledeSupervisor, seenHeading: S.headingSeenSupervisor, neverHeading: S.headingNeverSupervisor, footer: S.footerSupervisor, colleagues: null,
      seen: [
        "The tasks and to-dos people plan, and how they're going",
        "When people clock in, and when they start and stop work",
        "Notes and work sent for a check",
        "Whether someone is connected while a timer runs, or on a call right now, never as a measure of effort",
        "A plain log of what each assistant did, and how many requests each person made",
      ],
      never: [
        { strong: "Anyone's screen.", rest: "Boredroom never records it." },
        { strong: "Calls.", rest: "They're never recorded, and notes are only taken for people who agree." },
        { strong: "What people say to their assistants", rest: null },
        { strong: "Direct messages you're not part of", rest: null },
        { strong: "A productivity score.", rest: "There isn't one, and nobody is ranked." },
      ],
    };
  }
  return {
    title: S.titleMember(o.org),
    lede: o.role === "manager" ? S.ledeLead : o.hasLead ? S.ledeStaff : S.ledeStaffNoLead,
    seenHeading: S.headingSeenMember, neverHeading: S.headingNeverMember, footer: S.footerMember, colleagues: S.colleaguesMember,
    // Presence and "on a call" are every colleague's, so they are on their own line (`colleagues`), not credited only to
    // the lead, HR and the owner (review, 11 October 2026).
    seen: [
      "The tasks and to-dos you plan, and how they're going",
      "When you clock in, and when you start and stop work",
      "Notes and work you send for a check",
      "Whether you're connected while a timer runs, never as a measure of effort",
      `A plain log of what ${o.assistantName} did for you, and how many requests you made (owners and HR)`,
    ],
    never: [
      { strong: "Your screen.", rest: "Boredroom never records it." },
      { strong: "Your calls.", rest: "Only the people on them hear them. Calls are never recorded, and notes are only taken for people who agree." },
      { strong: `What you say to ${o.assistantName}`, rest: null },
      { strong: "Your direct messages.", rest: "Only the people in them." },
      { strong: "A productivity score.", rest: "There isn't one, and nobody is ranked." },
    ],
  };
}
