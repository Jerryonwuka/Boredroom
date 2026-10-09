/**
 * Act without asking (owner decision, 8 October 2026: "for where we give it task and it always has to ask us to confirm
 * before it proceeds, there should be a setting where we can bypass the permission, you can toggle it on and off, just
 * like the way it is on Claude Code"). Each person chooses, per workspace, whether their own assistant asks before acting
 * ('ask', the default: a Confirm card before anything that reaches someone else) or acts at once on what they ask for in
 * their own private chat ('auto', with Undo for 10 minutes). Owners and HR can turn the choice off for everyone.
 *
 * The server decides, never the prompt (services/act-decision, services/copilot's askFirst): this file only carries what
 * the server, the pages, the chat, the pill and the notch share: the modes, the state the server read, the reasons a
 * Confirm card still asks (the safety floors the owner accepted, 8 October 2026), the undo window and every fixed string
 * the UI shows. It imports nothing, so client components can use it. Before migration 0045 everyone reads `ASK_STATE`.
 */

export const ACT_MODES = ["ask", "auto"] as const;
export type ActMode = (typeof ACT_MODES)[number];
export const isActMode = (v: unknown): v is ActMode => (ACT_MODES as readonly unknown[]).includes(v);

/** Why the person's choice is not in force: before 0045, the workspace switched it off, someone else is signed in as them. */
export type ActLock = "not_ready" | "workspace" | "impersonated" | null;
/** `mode`: what the person chose (kept while locked, so it comes back); `effective`: what the server does now. */
export type ActState = { ready: boolean; mode: ActMode; allowed: boolean; effective: ActMode; locked: ActLock };
/** Before migration 0045, and wherever nothing was read: everyone's assistant asks, exactly as before. */
export const ASK_STATE: ActState = { ready: false, mode: "ask", allowed: true, effective: "ask", locked: "not_ready" };

/**
 * The state from what was stored. locked: not_ready (ready false) > impersonated > workspace (allowed false) > null;
 * effective 'auto' only when unlocked and mode 'auto'. A missing or unknown mode is 'ask'; a missing switch is on (the
 * workspace default).
 */
export function actStateFrom(p: { ready: boolean; mode: string | null | undefined; allowed: boolean | null | undefined; impersonated: boolean }): ActState {
  if (!p.ready) return { ...ASK_STATE };
  const mode: ActMode = p.mode === "auto" ? "auto" : "ask";
  const allowed = p.allowed !== false;
  const locked: ActLock = p.impersonated ? "impersonated" : !allowed ? "workspace" : null;
  return { ready: true, mode, allowed, effective: !locked && mode === "auto" ? "auto" : "ask", locked };
}

/** The state carried by a profiles read (`AssistantProfiles.act`), or `ASK_STATE` when there is none (an older shape). */
export const actStateOf = (p: { act?: ActState } | null | undefined): ActState => p?.act ?? ASK_STATE;

/** How long a done line offers Undo, and how long an Undo token lasts. */
export const UNDO_WINDOW_MINUTES = 10;
/** A named channel with at most this many readers (the person included) is a small group: a message to it acts. */
export const SMALL_GROUP_MAX = 8;
/** A follow-up to at most this many named people (no team) acts; more is a fan-out and asks. */
export const FOLLOW_UP_AUTO_MAX = 3;
/** What a done line carries when it can be undone. `until`: ISO time the offer ends (the token's expiry). */
export type UndoOffer = { token: string; until: string };
/** Whether an offer still stands at `now` (ms): the chat and the notch hide Undo once it has passed. */
export const undoOpen = (u: UndoOffer | null | undefined, now = Date.now()): u is UndoOffer => !!u && typeof u.token === "string" && Date.parse(u.until) > now;

// ---- Why a Confirm card still asks ---------------------------------------------------------------------------------

export const ASK_REASONS = ["tainted", "tainted_earlier", "broadcast_everyone", "broadcast_team", "broadcast_group", "fan_out",
  "irreversible_email", "irreversible_review", "irreversible_team", "answers_others", "cant_undo", "someone_elses_doc",
  "builtin", "workspace_off", "impersonated", "always_asks", "routine_consent",
  // Phase 7b (owner decisions, 8 October 2026): a to-do from someone else's words always asks, whatever the mode.
  "others_words_todo"] as const;
export type AskReason = (typeof ASK_REASONS)[number];
export const isAskReason = (v: unknown): v is AskReason => (ASK_REASONS as readonly unknown[]).includes(v);

/**
 * The Confirm card's line in auto mode: "Still asking: …" (only when the person chose 'auto'; ask mode's cards read as
 * before). `name`: the person's assistant ("Max"); `people`: a channel's readers, when known.
 */
export function whyStillAsking(reason: AskReason, o: { name: string; people?: number }): string {
  switch (reason) {
    case "tainted": return `Still asking: ${o.name} read other people's words in this reply.`;
    case "tainted_earlier": return `Still asking: other people's messages are earlier in this chat. Start a new chat for ${o.name} to act without asking.`;
    case "broadcast_everyone": return "Still asking: this goes to everyone in the workspace.";
    case "broadcast_team": return "Still asking: this goes to a whole team.";
    case "broadcast_group": return typeof o.people === "number" && Number.isFinite(o.people) && o.people > 0
      ? `Still asking: this goes to a channel of ${Math.round(o.people)} people.`
      : "Still asking: this goes to a large channel.";
    case "fan_out": return `Still asking: this reaches more than ${FOLLOW_UP_AUTO_MAX} people at once.`;
    case "irreversible_email": return "Still asking: this sends an email, which can't be taken back.";
    case "irreversible_review": return "Still asking: a submission for review can't be undone.";
    case "irreversible_team": return "Still asking: a new team can't be removed from the chat.";
    case "answers_others": return "Still asking: this answers something another person sent you.";
    case "cant_undo": return "Still asking: this can't be undone.";
    case "someone_elses_doc": return "Still asking: it's someone else's document.";
    // Review, 8 October 2026: said as what it needs, not as a failure to understand (a workspace without AI saw it on every card).
    case "builtin": return "Still asking: acting without asking needs the AI connected.";
    case "workspace_off": return "Still asking: your workspace has turned off acting without asking.";
    case "impersonated": return "Still asking: someone else is signed in as this person.";
    case "always_asks": return `Still asking: ${o.name} always asks before this.`;
    // Owner decision, 8 October 2026 (phase 7a, routines): turning a routine on is the person's standing consent for what
    // it does at every run, so it is always their own press, whatever the mode.
    case "routine_consent": return "Still asking: turning on a routine is your standing yes for what it does each time.";
    // Owner decision, 8 October 2026 (phase 7b): a to-do made from someone else's words (a loose end, a noted commitment,
    // an open ask) is always the person's own yes, even when they chose Act without asking.
    case "others_words_todo": return "Still asking: this to-do comes from words in a conversation, so you confirm it first.";
  }
}

// ---- Every fixed string the UI shows (contract F) ------------------------------------------------------------------

export const ACT_WORDS = {
  /** Settings → Your assistant → Permissions (F.1). `name`: the person's assistant. */
  settings: {
    section: "Permissions",
    description: (name: string) => `Whether ${name} asks you before doing things for you.`,
    group: (name: string) => `When you ask ${name} to do something`,
    ask: {
      label: "Ask me before acting",
      hint: (name: string) => `${name} shows a Confirm card before anything that reaches someone else: messages, follow-ups, requests, notes for the team report, tasks for other people.`,
    },
    // Review, 8 October 2026: a short lead, then the floors as a list (owner rule, 7 October 2026: a list is never a
    // paragraph), every floor the server enforces, with the real limits; others' approval is never skipped.
    auto: {
      label: "Act without asking",
      hint: (name: string) => `${name} does it straight away when you ask in your own chat, with Undo for ${UNDO_WINDOW_MINUTES} minutes. Requests still wait for the other person to accept, and follow-ups are answered by their assistant.`,
      stillAsksLead: "It still asks first:",
      stillAsks: [
        "after reading other people's words",
        `before messages to everyone, a whole team or a channel of more than ${SMALL_GROUP_MAX} people`,
        `before asking or giving to-dos to more than ${FOLLOW_UP_AUTO_MAX} people at once`,
        "before invitations, review submissions and new teams",
        "before answering something another person sent you",
        "before changing someone else's document",
        "always in Messages threads",
      ],
    },
    /** Shown when the workspace has no AI connected: the built-in helper always asks (review, 8 October 2026). */
    needsAi: (name: string) => `Acting without asking needs the AI connected. Until then ${name} asks first.`,
    /** For owners and HR, under the workspace lock: where to turn it back on. */
    openWorkspaceSetting: "Open Brenda settings",
    saving: "Saving…",
    saved: "Saved",
    tip: (name: string) => `Tip: while typing in ${name}'s box, press Shift+Tab to switch.`,
    lockedWorkspace: (name: string) => `Your workspace has turned off acting without asking, so ${name} asks before acting.`,
    lockedImpersonated: "Only the person can change this. It stays as it is while you are signed in as them.",
    notReady: "This needs a database update first.",
    pageNote: (name: string) => `With Act without asking on, everything ${name} does is still logged, marked “without asking”, and most of it can be undone for ${UNDO_WINDOW_MINUTES} minutes.`,
  },
  /** The composer pill (F.2). */
  pill: {
    ask: "Ask first",
    auto: "Acting without asking",
    autoShort: "Auto",
    lockedWorkspace: "Turned off by your workspace",
    lockedImpersonated: "Only the person can change this",
    /** Under 'auto' when no AI is connected: nothing acts on its own yet (the built-in helper always asks). */
    needsAi: "Needs the AI connected; until then it asks first",
    labelAsk: "Ask first. Switch to act without asking",
    labelAuto: "Acting without asking. Switch to ask first",
    announceAuto: "Act without asking is on",
    announceAsk: "Ask before acting is on",
    shortcut: "Shift+Tab",
  },
  /** Her chat (F.3). `time`: when the offer ends, in the workspace's time zone ("14:32"). */
  chat: {
    undo: "Undo",
    undoLabel: (summary: string) => `Undo: ${summary}`,
    undone: "Undone",
    undoneStatus: (summary: string) => `Undone: ${summary}`,
    doneWithoutAsking: "Done without asking.",
    doneUntil: (time: string) => `Done without asking. You can undo it until ${time}.`,
    /**
     * The line under the box on Brenda's page, by the mode in force (review, 8 October 2026: it said "asks before" under
     * the "Acting without asking" pill). `ai` false: chosen, but the built-in helper still asks.
     */
    footer: (name: string, auto: boolean, ai?: boolean) => !auto ? `${name} asks before anything that lands on someone else.`
      : ai === false ? `Acting without asking needs the AI connected. Until then ${name} asks first.`
      : `${name} acts without asking in your own chat. Most of it can be undone for ${UNDO_WINDOW_MINUTES} minutes.`,
    /** The drawer's introduction, in her voice, by the mode in force. */
    intro: (auto: boolean, ai?: boolean) => !auto ? "I act as you, with your permissions, and I ask before anything that lands on someone else."
      : ai === false ? "I act as you, with your permissions. You chose to let me act without asking, but that needs the AI connected, so until then I ask before anything that lands on someone else."
      : `I act as you, with your permissions. You chose to let me act without asking, so I do what you ask straight away, and you can undo most of it for ${UNDO_WINDOW_MINUTES} minutes.`,
    /** The sender's line on a message to an assistant they withdrew (assistant-item-card's outcome). */
    youWithdrewIt: "You withdrew it.",
  },
  /** Settings → Brenda → Acting without asking (F.4). */
  workspace: {
    section: "Acting without asking",
    description: "Whether people may let their assistant act without asking first.",
    on: "On",
    off: "Off",
    switch: "Allow people to let their assistant act without asking",
    hint: "When off, everyone's assistant asks before anything that reaches someone else, whatever they chose. Messages to everyone or a whole team, invitations, and anything after reading other people's words always ask.",
    notReady: "This needs a database update first.",
    pageNote: `Actions taken without asking are logged like confirmed ones, marked “without asking”, and most can be undone for ${UNDO_WINDOW_MINUTES} minutes.`,
  },
  /** Brenda's log and the Activity list: an `auto` row (F.4). */
  // An Undo's own row keeps the auto marker (D.1) but reads as what it is: the person undid something (review, 8 October 2026).
  log: { label: "done without asking", marker: "without asking", undoneByThem: "undone by them", undoneByYou: "undone by you" },
  /** The notch (F.6). */
  notch: {
    pill: "Acting without asking", undo: "Undo", undone: "Undone", suffix: "(without asking)",
    /** The pill's title. The notch's reply card folds away soon after, so Undo there lasts only while it shows. */
    title: (name: string) => `${name} does what you ask in your own chat straight away. Undo shows on the reply while it is open; in Boredroom's chat it lasts ${UNDO_WINDOW_MINUTES} minutes. Change it in Boredroom: Settings, Your assistant.`,
    titleNeedsAi: (name: string) => `Acting without asking needs the AI connected. Until then ${name} asks first. Change it in Boredroom: Settings, Your assistant.`,
  },
  /** What the routes answer (E). */
  errors: {
    impersonated: "Only the person can change this. It stays as it is while someone else is signed in as them.",
    workspaceOff: "Your workspace has turned off acting without asking.",
    notReady: "Acting without asking needs a database update first.",
    sayMode: "Say whether your assistant asks first or acts without asking.",
    sayAllowed: "Say whether people may let their assistant act without asking.",
    settingsForbidden: "Only the organisation owner or HR can change this.",
  },
} as const;
