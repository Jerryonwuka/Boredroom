/**
 * Every fixed string connected apps show (owner decisions, 22 October 2026: connectors; spec §5.2, §9.5, §11). British
 * English, sentence case. People see these words, never a provider's own text: errors from an app are mapped to a fixed
 * code first.
 */
import type { ConnectionKind, ProviderId } from "./types";
import { PROVIDER_LABELS } from "./types";

export const CONNECTORS_NOT_READY = "Connected apps need a database update first.";
export const CONNECTORS_PLAN = "Connected apps aren't part of this workspace's plan.";
export const CONNECTORS_PAUSED = "Connected apps are paused while this workspace's plan doesn't include them.";

/** The callback's failure codes (§5.2): fixed, never the provider's text. */
export const CONNECT_FAILURE_CODES = ["cancelled", "expired", "mismatch", "not_allowed", "admin_approval", "different_account", "enterprise_install", "no_site", "install_unverified", "install_not_admin", "failed"] as const;
export type ConnectFailure = (typeof CONNECT_FAILURE_CODES)[number];
export const isConnectFailure = (v: unknown): v is ConnectFailure => typeof v === "string" && (CONNECT_FAILURE_CODES as readonly string[]).includes(v);

export const CONNECT_FAILURE: Record<ConnectFailure, (app: string) => string> = {
  cancelled: (app) => `You cancelled connecting ${app}.`,
  expired: () => "That took too long. Try connecting again.",
  mismatch: () => "That didn't match the connection you started. Try again.",
  not_allowed: (app) => `You can't connect ${app} here any more.`,
  admin_approval: () => "Your Microsoft 365 admin needs to approve Boredroom first.",
  different_account: () => "That's a different account. Disconnect this one first.",
  enterprise_install: () => "Boredroom can be added to one Slack workspace at a time, not a whole Enterprise Grid organisation.",
  no_site: () => "Your Atlassian account has no Jira site Boredroom can use.",
  install_unverified: () => "GitHub didn't confirm that you can manage that installation.",
  // Security fix, 22 October 2026: an installation's token reaches every repository in it, so only its account's admin connects it.
  install_not_admin: () => "Only an owner of that GitHub organisation (or the account itself) can connect it for the workspace.",
  failed: (app) => `${app} didn't connect. Try again.`,
};

export const ADMIN_CONSENT_DONE = "Approved. People in your organisation can connect now.";

/** §11.7: the error sentence per fixed code. `{App}` filled by the caller. */
export const CONNECTOR_ERRORS: Record<string, (app: string, o?: { time?: string; name?: string }) => string> = {
  REAUTH_REQUIRED: (app) => `${app} stopped letting Boredroom in. Reconnect to carry on.`,
  REVOKED: (app) => `Boredroom was removed in ${app}. Connect again to carry on.`,
  RATE_LIMITED: (app, o) => `${app} asked Boredroom to slow down. It tries again ${o?.time ? `at ${o.time}` : "shortly"}.`,
  FORBIDDEN: (app) => `${app} didn't allow that. Check that your account can open it.`,
  NOT_FOUND: (app) => `That's no longer in ${app}.`,
  PROVIDER_DOWN: (app) => `${app} isn't answering. Boredroom tries again in a few minutes.`,
  BAD_RESPONSE: (app) => `${app} isn't answering. Boredroom tries again in a few minutes.`,
  ADMIN_APPROVAL: () => "Your Microsoft 365 admin needs to approve Boredroom first.",
  NOT_ALLOWED: (app) => `Boredroom can't do that in ${app}.`,
  TOO_LARGE: (app) => `That's more than Boredroom can take from ${app} at once.`,
  CONFLICT: (app) => `That changed in ${app} just now. Try again.`,
  NOT_CONFIGURED: (app) => `Boredroom's ${app} app isn't set up on this server yet.`,
  CONNECTORS_NOT_READY: () => CONNECTORS_NOT_READY,
  OWNER_LEFT: (app, o) => `${app} needs reconnecting: ${o?.name ?? "the person"}, who connected it, has left.`,
  PAUSED: () => CONNECTORS_PAUSED,
};

export function errorWords(code: string | null | undefined, provider: ProviderId, o: { time?: string; name?: string } = {}): string | null {
  if (!code) return null;
  const f = CONNECTOR_ERRORS[code];
  return f ? f(PROVIDER_LABELS[provider], o) : `${PROVIDER_LABELS[provider]} had a problem. Try again later.`;
}

const RISK_ASK = {
  app_shared: (app?: string) => `Still asking: other people will see this in ${app ?? "that app"}.`,
  app_post: (place?: string, app?: string) => `Still asking: this posts in ${place ?? "a channel"}${app ? ` on ${app}` : ""}.`,
};
export { RISK_ASK };

/** §9.5: the Confirm cards' exact words. */
export const APP_READBACK = {
  post: {
    summary: (place: string, app: string) => `Post in ${place} on ${app}`,
    to: (place: string, app: string, members: string) => `${place} in ${app}, ${members}`,
    what: (as: string) => `Your words, posted ${as}`,
  },
  create_issue: {
    summary: (app: string, place: string, task = false) => `Create ${/^[aeiou]/i.test(app) ? "an" : "a"} ${app} ${task ? "task" : "issue"} in ${place}`,
    to: (place: string, app: string) => `Everyone who can see ${place} in ${app}`,
    what: (title: string, as: string, task = false) => `A new ${task ? "task" : "issue"} “${title}”, created ${as}`,
  },
  comment: {
    summary: (key: string) => `Comment on ${key}`,
    to: (key: string, app: string) => `Everyone who can see ${key} in ${app}, including the people following it`,
    what: (as: string) => `Your comment, posted ${as}`,
  },
  set_state: {
    summary: (key: string, to: string) => `Move ${key} to ${to}`,
    to: (key: string, app: string) => `Everyone who can see ${key} in ${app}`,
    what: (key: string, from: string | null, to: string) => (from ? `${key} moves from ${from} to ${to}` : `${key} moves to ${to}`),
  },
  assign: {
    summary: (key: string, who: string) => `Assign ${key} to ${who}`,
    toPerson: (who: string, app: string) => `${who}, whom ${app} tells`,
    to: (key: string, app: string) => `Everyone who can see ${key} in ${app}`,
    what: (key: string, who: string) => `${key} is assigned to ${who}`,
  },
  set_due: {
    summary: (key: string) => `Set ${key}'s due date`,
    to: (key: string, app: string) => `Everyone who can see ${key} in ${app}`,
    what: (key: string, due: string | null) => (due ? `${key} is due ${due}` : `${key} has no due date`),
  },
  block: {
    summary: (range: string, title: string) => `Block ${range} for “${title}”`,
    to: () => "Only you",
    what: (app: string, when: string) => `A private block on your ${app}, ${when}`,
  },
  invite: {
    summary: (n: number, title: string) => `Invite ${n} ${n === 1 ? "person" : "people"} to “${title}”`,
    to: (email: string, app: string) => `${email}, by email invitation from your ${app}`,
    what: (title: string, when: string) => `“${title}”, ${when}`,
  },
  rsvp: {
    summary: (verb: string, title: string) => `${verb} “${title}”`,
    to: (organiser: string | null) => `The organiser, ${organiser ?? "the organiser"}`,
    what: (verbLower: string, title: string, when: string, note: boolean) => `You ${verbLower} “${title}” on ${when}${note ? ", with your note" : ""}`,
  },
  move: {
    summary: (title: string) => `Move “${title}”`,
    to: (n: number) => `The ${n} ${n === 1 ? "guest" : "guests"}, who get the new time`,
    what: (title: string, when: string) => `“${title}” moves to ${when}`,
  },
  cancel: {
    summary: (title: string) => `Cancel “${title}”`,
    toCalendar: "Your calendar",
    toGuests: (n: number) => `The ${n} ${n === 1 ? "guest" : "guests"}, who ${n === 1 ? "is" : "are"} told`,
    what: (title: string, day: string) => `“${title}” on ${day} is cancelled`,
  },
  track: {
    summary: (key: string) => `Track ${key} as a to-do`,
    toYou: "You",
    toLead: (lead: string | null) => (lead ? `${lead}, your team lead, who checks your to-dos` : "Your team lead"),
    what: (title: string, key: string, app: string) => `A to-do “${title}”, linked to ${key} in ${app}`,
    privateLink: (app: string) => `The link to ${app} stays private to you.`,
  },
  create_page: {
    summary: (parent: string) => `Add a Notion page under “${parent}”`,
    to: (parent: string) => `Everyone who can see “${parent}” in Notion`,
    what: (title: string, as: string) => `A new page “${title}”, added ${as}`,
  },
  append: {
    summary: (page: string) => `Add to “${page}” in Notion`,
    to: (page: string) => `Everyone who can see “${page}” in Notion`,
    what: (as: string) => `These lines at the end of the page, added ${as}`,
  },
  page_comment: {
    summary: (page: string) => `Comment on “${page}” in Notion`,
    to: (page: string) => `Everyone who can see “${page}” in Notion`,
    what: (as: string) => `Your comment, added ${as}`,
  },
  as: {
    workspaceApp: (first: string, assistant: string) => `by the Boredroom app, signed “${first} via ${assistant}”`,
    yourAccount: (label: string | null) => (label ? `as you (${label})` : "as you"),
    notionPersonal: "by the Boredroom integration in your Notion",
    teams: (name: string, first: string) => `from ${name}'s Microsoft account, signed “Posted by Boredroom for ${first}”`,
  },
} as const;

/** Brenda's refusals and answers from the connector tools (§9). */
export const BRENDA_CONNECTOR_WORDS = {
  notReady: CONNECTORS_NOT_READY,
  plan: CONNECTORS_PLAN,
  impersonated: "Only the person can use their connected apps.",
  notConnected: (what: string) => `Nothing is connected for ${what} yet. Connect it in Settings › Your assistant › Your connections.`,
  readsOff: (app: string) => `Reading ${app} is turned off for this workspace.`,
  actsOff: (app: string) => `Making changes in ${app} is turned off for this workspace.`,
  canReadOff: (app: string, name: string) => `${name} can't read your ${app}: that's switched off in Settings › Your assistant › Your connections.`,
  canActOff: (app: string, name: string) => `${name} can't make changes in your ${app} yet. Turn on “${name} can make changes when you ask” in Settings › Your assistant › Your connections.`,
  needOwnConnection: (app: string) => `To make changes in ${app}, connect your own ${app} account in Settings › Your assistant › Your connections.`,
  whichCalendar: "Which calendar: Google Calendar or Outlook Calendar?",
  noItem: "I couldn't find that item. Use an id from my_calendar, my_work_items or find_in_apps.",
  notYours: "That isn't one of your own items.",
  never: "That's something I never do in connected apps: do it in the app itself.",
  limit: (name: string) => `You've asked ${name} to make a lot of changes in your apps today. Do the rest in the app itself, or try again tomorrow.`,
  reconnectPersonal: (app: string) => `Your ${app} needs reconnecting: Settings › Your assistant › Your connections.`,
  reconnectWorkspace: (app: string) => `${app} needs reconnecting: Settings › Connectors.`,
  staffOnly: "Tracking items as to-dos is for staff and team leads.",
  noSuchTask: "That to-do isn't one of your open to-dos.",
  noPlace: (names: string[]) => names.length ? `I couldn't tell which one you meant. The ones I can use: ${names.join(", ")}.` : "I couldn't find a place I can use for that.",
  noChannel: (names: string[]) => names.length ? `I can only post in the channels the workspace chose: ${names.join(", ")}.` : "The workspace hasn't chosen any channels Boredroom can post in yet.",
  noSetDue: (app: string) => `${app} has no due dates.`,
  helperPointer: "Your calendar and issues from connected apps are on My Day.",
  undoMovedOn: "It changed since, so it stays.",
  // Security fix, 22 October 2026: a Confirm press runs only what its card showed.
  changedSinceCard: "That changed since I showed it to you, so nothing was done. Ask again and I'll show you the new details.",
  undoDone: {
    hide: "Shown on My Day again",
    link: "Unlinked it from your to-do",
    block: "Removed the block",
    move: "Put it back where it was",
  },
  logged: {
    post: "Posted in a connected channel",
    change: "Made a change in a connected app",
    knowledge: "Added to a connected knowledge base",
    read: (what: string) => `Read ${what}`,
  },
} as const;

/** Every fixed string the screens show (§11). `{name}`: the person's assistant. */
export const CONNECTOR_WORDS = {
  nav: "Connectors",
  workspace: {
    title: "Connected apps",
    description: "Bring your team's other apps into Boredroom. People connect their own calendars and accounts in Your assistant.",
    groups: { calendar: "Calendars", chat: "Chat", knowledge: "Knowledge", work: "Work" } as Record<string, string>,
    letPeople: (app: string) => `Let people connect ${app}`,
    calendarHint: "Each person's calendar stays private to them. Nobody else, owners and HR included, can see it or whether it's connected.",
    connectedTo: (label: string) => `Connected to ${label}`,
    lastChecked: (when: string) => `Last checked ${when}`,
    firstCheck: "Checking for the first time…",
    sees: (name: string) => `What ${name} can see`,
    does: (name: string) => `What ${name} can do`,
    connect: (app: string) => `Connect ${app}`,
    // The workspace's own assistant name (fix, 22 October 2026), never a hard-coded "Brenda".
    brendaReads: (app: string, name: string) => `Let ${name} read ${app}`,
    brendaActs: (app: string, name: string) => `Let ${name} make changes in ${app} when someone confirms`,
    // Chat apps are only places to post, and Jira and Asana change things from each person's own account (fix, 22 October 2026).
    chatActs: (name: string) => `Let people ask ${name} to post in these channels (they confirm the exact words)`,
    ownAccountActsLabel: (app: string, name: string) => `Let people ask ${name} to make changes in ${app} from their own ${app} account`,
    ownAccountActs: "Changes are made from each person's own account, after they confirm.",
    nothingConfigured: "No apps are set up on this server yet.",
    setupIn: (where: string) => `In ${where}:`,
    restart: "Restart Boredroom after setting the variables.",
    personalAllowed: (app: string) => `Let people connect their own ${app} account`,
    checkNow: "Check now",
    reconnect: "Reconnect",
    disconnect: "Disconnect",
    disconnectConfirm: (app: string) => `Disconnect ${app}? Boredroom deletes what it copied from ${app}. Anything posted or changed in ${app} stays there.`,
    notSetUp: (app: string) => `Boredroom's ${app} app isn't set up on this server yet.`,
    howToSetUp: "How to set it up",
    variables: "Environment variables",
    redirectUrl: "Redirect URL",
    webhookUrl: "Webhook URL",
    notReady: CONNECTORS_NOT_READY,
    upgrade: "Connected apps",
    notes: [
      { title: "Connected apps", body: "Boredroom stores what it needs from connected apps, encrypted where it's a key or a token. Disconnecting deletes what it copied." },
      { title: "Connected apps", body: "Nothing from a connected app counts towards reports, scores or attendance." },
    ],
    githubWaiting: "Waiting for a GitHub organisation owner to approve Boredroom.",
    githubRemove: "To remove Boredroom from GitHub as well: your organisation's Settings › GitHub Apps.",
    removeAt: (app: string, where: string) => `To remove Boredroom from ${app} too: ${where}.`,
  },
  status: {
    connected: "Connected",
    attention: "Needs attention",
    notConnected: "Not connected",
    paused: "Paused",
    notSetUp: "Not set up yet",
  },
  sources: {
    title: "Choose what Boredroom reads",
    everyone: "Everyone",
    audience: "Who sees it",
    hint: (app: string, name: string) => `Everyone you pick can see these in Boredroom and ask ${name} about them, even if they can't open them in ${app}.`,
    // Channels are only places to post (integration fix, 22 October 2026): Boredroom never reads their messages.
    channelHint: (app: string) => `The ${app} channels Boredroom was invited to. Tick the ones it may post in; it never reads their messages.`,
    notionPages: (n: number) => `${n} ${n === 1 ? "page" : "pages"} shared`,
    changePages: "Change pages",
    refresh: "Refresh the list",
    save: "Save",
    none: "Nothing to choose yet. Check now, then come back.",
  },
  routes: {
    title: "Where Boredroom posts",
    purposes: { daily_digest: "End-of-day digest", standup: "Standups", reminders: "Reminders" } as Record<string, string>,
    wholeWorkspace: "The whole workspace",
    channel: "Channel",
    noChannel: "No channel",
    preview: "Preview and turn on",
    previewOnly: "Preview",
    nothingToPost: "Nothing to post yet today.",
    addTeam: "Add a team",
    addTeamPlaceholder: "Choose a team…",
    teamRoutes: (team: string) => `${team}'s standups and reminders`,
    turnOn: "Turn on",
    turnOff: "Turn off",
    on: "On",
    off: "Off",
    slackHint: "Channels show here once Boredroom is in them: in Slack, type /invite @Boredroom in the channel, then Check now.",
    teamsHint: (name: string) => `Posts appear from ${name}'s Microsoft account, signed “Posted by Boredroom”.`,
    digestWhat: (team: string | null, time: string) => `${team ? `${team}'s` : "The workspace's"} digest each working day at ${time}, the report time.`,
    standupWhat: (team: string) => `${team}'s standup rollup at its cutoff (how many shared and how many are blocked, no names or words), and each person's standup when they tick “Also post” as they share it.`,
    remindersWhat: (team: string) => `A reminder when ${team}'s standup opens.`,
    cantPost: (place: string) => `Boredroom can't post in ${place} any more. Choose another channel in Settings › Connectors.`,
  },
  personal: {
    title: "Your connections",
    description: (name: string) => `Connect your own calendar and work apps so ${name} can plan your day and answer from them. Only you can see these: your workspace's owners and HR can't see them, or whether you've connected anything.`,
    connect: "Connect",
    connectedAs: (label: string) => `Connected as ${label}`,
    canRead: (name: string) => `${name} can read it`,
    canAct: (name: string) => `${name} can make changes when you ask`,
    willConfirm: (app: string) => `You'll confirm this with ${app}.`,
    disconnectConfirm: (app: string, removeAt?: string) => `Disconnect ${app}? Boredroom deletes what it copied.${removeAt ? ` To remove Boredroom from ${app} too: ${removeAt}.` : ""}`,
    googleTesting: "Google asks you to reconnect every 7 days until Boredroom's Google app is verified.",
    githubPersonal: "You'll see issues from repositories where your organisation installed Boredroom.",
    fromWorkspace: "From your workspace",
    impersonated: "Only the person can see and change their connections.",
    notes: [
      { title: "Your connections", body: "Only you can see your connections and what comes from them. Nothing from them counts towards reports, scores or attendance." },
      { title: "Your connections", body: "Tokens are stored encrypted. Disconnecting deletes what Boredroom copied." },
    ],
    // Fix, 22 October 2026: neutral words for staff (often it's the server, not the workspace, that has nothing set up).
    nothingOffered: "No apps are available to connect yet.",
  },
  sheet: {
    title: (app: string) => `Connect ${app}`,
    letAct: (name: string) => `Let ${name} make changes when you ask`,
    letActHint: (app: string, name: string) => `This asks ${app} for permission to make changes. ${name} still asks before anything other people will see. You can turn it on later.`,
    continue: (app: string) => `Continue to ${app}`,
    connected: (app: string) => `${app} connected.`,
  },
  day: {
    heading: "From your apps",
    calendar: "Today's calendar",
    assigned: "Assigned to you",
    now: "Now",
    online: "Online",
    allDay: "All day",
    track: "Track",
    tracking: (title: string) => `Tracking: ${title}`,
    start: "Start",
    open: (app: string) => `Open in ${app}`,
    hide: "Hide from My Day",
    show: "Show on My Day",
    hidden: (n: number) => `Hidden (${n})`,
    emptyTitle: "Bring your calendar and issues here",
    emptyBody: "Connect your calendar and work apps in Settings.",
    connectApps: "Connect apps",
    connectCalendar: "Connect your calendar",
    noCalendar: "Connect your calendar to see today's meetings here.",
    needsReconnect: (app: string) => `${app} needs reconnecting.`,
    reconnect: "Reconnect",
    noEvents: "Nothing on your calendar today.",
    noItems: "Nothing assigned to you.",
    note: "Items from connected apps are yours to see. They never count towards reports, scores or attendance.",
  },
  trackSheet: {
    title: (key: string) => `Track ${key} as a to-do`,
    newTodo: "A new to-do",
    existing: "One of your to-dos",
    startTimer: "Start the timer now",
    readback: (lead: string | null) => `Your to-do. ${lead ?? "Your team lead"}, your team lead, sees it and checks it when you mark it done, like any to-do.`,
    privateLink: (app: string) => `The link to ${app} stays private to you.`,
    button: "Track",
    noTodos: "You have no open to-dos to link it to.",
  },
  limits: {
    syncSoon: "Boredroom checked a moment ago. Try again in a couple of minutes.",
    sourcesSoon: "Boredroom read the list a moment ago. Try again in a minute.",
    startSoon: "One moment: try connecting again in a few seconds.",
  },
  impersonatedConnect: "Only the person can connect apps.",
  // Security fix, 22 October 2026: someone signed in as an owner from the Control Center can look, not change.
  impersonatedManage: "While you're signed in as someone else, connected apps can be looked at but not changed.",
  workspaceOnly: "Only owners and HR can connect apps for the workspace.",
  personalOff: (app: string) => `Your workspace doesn't let people connect their own ${app}.`,
  kindNotOffered: (app: string, kind: ConnectionKind) => `${app} can't be connected ${kind === "personal" ? "for yourself" : "for the workspace"}.`,
} as const;
