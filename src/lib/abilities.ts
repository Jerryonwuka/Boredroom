/**
 * Brenda's abilities (owner decisions, 8–9 October 2026: phase 7c, the abilities catalogue). Settings shows what the
 * assistants can do as curated cards (never user-authored): what each does, "Use when…", "Never…" (its anti-jobs) and
 * its state. Owners and HR choose which abilities the workspace offers (Settings → Brenda → Abilities); each person
 * switches personal abilities on or off for their own assistant (Settings → Your assistant → Abilities).
 *
 * Where a switch already existed it stays the source of truth and is only surfaced here, with a link to its own card
 * (mention_replies, track_commitments and commitment_thread_followups, allow_auto_act, routines_chase_leads_only,
 * report_notes, assistant_profiles.act_mode, speak, allow_thread_replies). The abilities that had no switch are kept in
 * two lists (migration 0050): `brenda_settings.abilities_off` (what the workspace does not offer) and
 * `assistant_private.abilities_off` (what the person switched off for their own assistant). Both start empty: every
 * ability built so far stays ON, and the existing defaults that are off stay off (commitments tracking, act mode 'ask',
 * standup per team).
 *
 * Server-enforced (services/abilities `requireAbility`): a switched-off ability's tools refuse with `ABILITY_WORDS.refusal`
 * (one sentence and where to switch it on), its routine templates are unavailable, its cards and prompts do not show.
 *
 * Client-safe: imports only lib/routines (itself client-safe) for the template names.
 */
import { ROUTINE_WORDS, type RoutineTemplate } from "@/lib/routines";

// ---- Keys --------------------------------------------------------------------------------------------------------------

/** Every ability on the catalogue, in the order the cards show (contract C.1). */
export const ABILITY_KEYS = ["catch_up", "loose_ends", "follow_ups", "assistant_talk", "mentions", "routines", "commitments", "standup", "voice", "act", "morning_opener"] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];
export const isAbilityKey = (v: unknown): v is AbilityKey => (ABILITY_KEYS as readonly unknown[]).includes(v);

/** The workspace's own switches (`brenda_settings.abilities_off`, migration 0050's CHECK lists exactly these). */
export const WORKSPACE_SWITCH_KEYS: readonly AbilityKey[] = ["catch_up", "loose_ends", "follow_ups", "assistant_talk", "routines", "standup", "voice", "morning_opener"];
/** The person's own switches (`assistant_private.abilities_off`, migration 0050's CHECK lists exactly these). */
export const PERSONAL_SWITCH_KEYS: readonly AbilityKey[] = ["catch_up", "loose_ends", "follow_ups", "assistant_talk", "mentions", "routines", "standup", "morning_opener"];
export const isWorkspaceSwitchKey = (v: unknown): v is AbilityKey => (WORKSPACE_SWITCH_KEYS as readonly unknown[]).includes(v);
export const isPersonalSwitchKey = (v: unknown): v is AbilityKey => (PERSONAL_SWITCH_KEYS as readonly unknown[]).includes(v);

/** Who switched it off: the workspace (wins), the person, or nobody (null). */
export type AbilityOff = "workspace" | "personal" | null;
/**
 * The two lists as the server read them for one person. `ready: false` before migration 0050: both empty, so every
 * ability reads ON (today's behaviour).
 */
export type Abilities = { ready: boolean; workspaceOff: AbilityKey[]; personalOff: AbilityKey[] };
/** Before migration 0050, and wherever nothing could be read: everything on. */
export const ALL_ON: Abilities = { ready: false, workspaceOff: [], personalOff: [] };

/**
 * Whether one ability is switched off for this person, and by whom: the workspace wins over the person; null when it is
 * on, when the lists were not read, or when the key has no switch of that kind (an existing switch governs it).
 */
export function abilityOff(a: Abilities | null | undefined, key: AbilityKey): AbilityOff {
  if (!a) return null;
  if (isWorkspaceSwitchKey(key) && a.workspaceOff.includes(key)) return "workspace";
  if (isPersonalSwitchKey(key) && a.personalOff.includes(key)) return "personal";
  return null;
}

/** Every key switched off for this person (either list), in catalogue order. */
export function abilitiesOff(a: Abilities | null | undefined): AbilityKey[] {
  return ABILITY_KEYS.filter((k) => abilityOff(a, k) !== null);
}

/**
 * The chat's tools each ability governs (copilot `runToolInner` refuses them first). `update_routine` with pause or
 * delete and `list_routines` stay allowed in the chat (cleaning up), which copilot decides; this map only names them.
 */
export const TOOL_ABILITY: Readonly<Record<string, AbilityKey>> = {
  list_conversations: "catch_up", read_conversation: "catch_up", search_messages: "catch_up", mark_read: "catch_up",
  loose_ends: "loose_ends", loose_end_action: "loose_ends",
  follow_up: "follow_ups", follow_up_status: "follow_ups",
  pass_message: "assistant_talk", hand_over_request: "assistant_talk",
  list_routines: "routines", create_routine: "routines", update_routine: "routines",
  standup: "standup", standup_action: "standup",
};

/** The ability each routine template needs besides `routines` itself (null: none). */
export const TEMPLATE_ABILITY: Readonly<Record<RoutineTemplate, AbilityKey | null>> = {
  morning_brief: "morning_opener", still_owed: null, afternoon_check: null, chase_stalled: "follow_ups", loose_ends: "loose_ends",
};

// ---- The catalogue (contract C.1, exact copy) --------------------------------------------------------------------------

/** `name`: the person's own assistant ("Max"); `ws`: the workspace's assistant ("Brenda"). */
export type AbilityNames = { name: string; ws: string };
/**
 * `whatAll` (fix review, 9 October 2026): the same sentence for Settings → Brenda, about everyone's assistant (the owner's
 * own assistant's name and "you" read wrong there).
 */
export type AbilityEntry = { key: AbilityKey; title: string; what: (n: AbilityNames) => string; whatAll: (n: AbilityNames) => string; useWhen: string; never: string; icon: string };

export const ABILITY_CATALOGUE: readonly AbilityEntry[] = [
  {
    key: "catch_up", title: "Catch-up", icon: "Inbox",
    what: ({ name }) => `${name} reads the conversations you're in and tells you what you missed: decisions, questions for you and who said what.`,
    whatAll: () => "Each person's assistant reads the conversations they're in and tells them what they missed: decisions, questions for them and who said what.",
    useWhen: "Use when you've been away from Messages and want the short version.",
    never: "Never marks anything as read unless you ask, and never reads a conversation you're not in.",
  },
  {
    key: "loose_ends", title: "Loose ends", icon: "ListChecks",
    what: ({ name }) => `${name} finds promises you made, and things asked of you or by you, that never became a to-do, reminder or follow-up.`,
    whatAll: () => "Each person's assistant finds promises they made, and things asked of them or by them, that never became a to-do, reminder or follow-up.",
    useWhen: "Use when you want to be sure nothing you said you'd do is slipping.",
    never: "Never shows your loose ends to anyone else, and never adds a to-do without your Confirm.",
  },
  {
    key: "follow_ups", title: "Follow-ups", icon: "MessageCircleQuestion",
    what: ({ name }) => `${name} asks other people's assistants where things stand, instead of you asking the people.`,
    whatAll: () => "Each person's assistant asks other people's assistants where things stand, instead of them asking the people.",
    useWhen: "Use when you need a status and don't want to interrupt anyone.",
    never: "Never changes anyone's task, and never asks a whole team without your Confirm.",
  },
  {
    key: "assistant_talk", title: "Messages and requests between assistants", icon: "ArrowLeftRight",
    what: ({ name }) => `${name} passes your words to someone's assistant, or asks them to accept a to-do, a reminder or a change to their task.`,
    whatAll: () => "Each person's assistant passes their words to someone's assistant, or asks them to accept a to-do, a reminder or a change to their task.",
    useWhen: "Use when something should reach a colleague without a meeting.",
    never: "Never changes anyone's account until they accept, and never sends anything without your Confirm unless you chose Act without asking.",
  },
  {
    key: "mentions", title: "@mentions in Messages", icon: "AtSign",
    what: ({ name }) => `Write @${name} in a conversation and ${name} answers there, under its own name.`,
    whatAll: ({ ws }) => `Write @${ws}, or @ and a person's assistant, in a conversation and it answers there, under its own name.`,
    useWhen: "Use when a quick answer helps everyone in the thread.",
    never: "Never posts what only you can see, and never acts in a thread without your Confirm.",
  },
  {
    key: "routines", title: "Routines", icon: "Repeat",
    what: ({ name }) => `${name} runs on a schedule: a morning brief, what's still owed, an afternoon check, chasing stalled tasks, loose ends.`,
    whatAll: () => "Each person's assistant runs on a schedule: a morning brief, what's still owed, an afternoon check, chasing stalled tasks, loose ends.",
    useWhen: "Use when you want the same check every day or week without asking.",
    never: "Never does more than its preview showed when you turned it on, and never interrupts your quiet hours.",
  },
  {
    key: "commitments", title: "Commitments", icon: "NotebookPen",
    what: ({ ws }) => `${ws} notes promises and agreed asks in group chats and hands each to the person's own assistant to accept.`,
    whatAll: ({ ws }) => `${ws} notes promises and agreed asks in group chats and hands each to the person's own assistant to accept.`,
    useWhen: "Use when your teams agree things in channels and they need to land on someone's list.",
    never: "Never reads direct messages, never adds a to-do until the person accepts, and never shows a decline to anyone but the two people involved.",
  },
  {
    key: "standup", title: "Standup", icon: "Sunrise",
    what: ({ name }) => `Each morning ${name} drafts your standup from your real work; you edit it, post it or skip the day. Your team lead gets one rollup.`,
    whatAll: () => "Each morning each person's assistant drafts their standup from their real work; they edit it, post it or skip the day. The team's lead gets one rollup.",
    useWhen: "Use when your team wants a daily update without a meeting.",
    never: "Never posts without your press, and never chases or shames anyone who didn't post.",
  },
  {
    key: "voice", title: "Voice", icon: "Mic",
    what: ({ name }) => `Talk to ${name} and hear replies read aloud.`,
    whatAll: () => "People talk to their assistant and hear replies read aloud.",
    useWhen: "Use when your hands are busy or you think out loud.",
    never: "Never listens unless you press talk, and never reads aloud on its own during your quiet hours.",
  },
  {
    key: "act", title: "Act without asking", icon: "Zap",
    what: ({ name }) => `In your own chat, ${name} does what you ask at once, with Undo for 10 minutes.`,
    whatAll: () => "In their own chat, each person's assistant can do what they ask at once, with Undo for 10 minutes, when they choose it.",
    useWhen: "Use when you want fewer Confirm cards for your own routine work.",
    never: "Never skips Confirm for anything to a whole team or everyone, anything after reading other people's words, or anything that can't be undone.",
  },
  {
    key: "morning_opener", title: "Morning opener", icon: "Sun",
    what: () => "Your first visit of the day opens with what's waiting and a few one-tap actions.",
    whatAll: () => "Each person's first visit of the day opens with what's waiting and a few one-tap actions.",
    useWhen: "Use when you want to start the day knowing what needs you.",
    never: "Never sends anything: its buttons open a page or fill the box.",
  },
];

/** One ability's catalogue entry. */
export function abilityEntry(key: AbilityKey): AbilityEntry {
  return ABILITY_CATALOGUE.find((e) => e.key === key) ?? ABILITY_CATALOGUE[0];
}
export const abilityTitle = (key: AbilityKey): string => abilityEntry(key).title;

// ---- Every fixed string (contract C.1, C.2) -----------------------------------------------------------------------------

/** Before migration 0050: the new switches cannot be changed yet (the routes answer 503 with the short line). */
export const ABILITIES_NOT_READY = "Switching abilities on and off needs a database update first. Ask an owner to apply it.";
export const ABILITIES_NOT_READY_SHORT = "Switching abilities needs a database update first.";

export const ABILITY_WORDS = {
  /** What a switched-off ability's tool, route or service answers: one sentence and where it is switched on. */
  // `canSwitch` (fix review, 9 October 2026): the reader is an owner or HR, who switches it on themself.
  refusal: (title: string, off: "workspace" | "personal", name: string, canSwitch = false) => off === "personal"
    ? `${title} is switched off for ${name}. You can switch it on in Settings → Your assistant → Abilities.`
    : `${title} is switched off in this workspace. ${canSwitch ? "You can" : "An owner or HR can"} switch it on in Settings → Brenda → Abilities.`,
  /** A card's state badge (neutral, or success for On; never orange). */
  state: {
    on: "On",
    off: "Off",
    offWorkspace: "Off for this workspace",
    offUntilOwner: "Off until an owner or HR turns it on",
    asksFirst: "Asks first",
    standupOn: (n: number) => `On in ${n} ${n === 1 ? "team" : "teams"}`,
    standupNone: "No team runs one yet",
    notReady: "Needs a database update",
  },
  /** The switches' labels. */
  switches: {
    workspace: (title: string) => `Offer ${title} in this workspace`,
    personal: (title: string) => `Use ${title}`,
  },
  /** The existing switches surfaced on a card ("{state} · Change in {card}") and their labels. */
  existing: {
    changeIn: (state: string, card: string) => `${state} · Change in ${card}`,
    setByWorkspace: "Set by your workspace",
    mentionReplies: "Assistant replies in Messages",
    letPeopleTag: (name: string) => `Let people tag ${name}`,
    trackCommitments: "Track commitments in group chats",
    allowAutoAct: "Allow acting without asking",
    actMode: (name: string) => `When ${name} acts`,
    chaseLeadsOnly: "Only leads can schedule routines that chase other people",
    speak: (name: string) => `When ${name} speaks`,
    cards: { mentions: "Messages", commitments: "Commitments", actMode: "Acting without asking", routines: "Routines", voice: "Voice", permissions: "Permissions", assistantTalk: "Other people's assistants" },
  },
  /** The two sections (Settings → Brenda; Settings → Your assistant). */
  sections: {
    workspaceTitle: "Abilities",
    workspaceDescription: "What everyone's assistant can do in this workspace. Switch off what your workspace doesn't use.",
    personalTitle: "Abilities",
    personalDescription: (name: string) => `Switch off what you don't want ${name} to do for you.`,
  },
  card: {
    useWhen: "Use when",
    never: "Never",
    templates: "Templates",
    needs: (title: string) => `needs ${title}`,
    switchedOff: (title: string) => `Switched off: ${title}`,
    teamsOn: (n: number) => (n === 0 ? "No team runs one yet" : `On in ${n} ${n === 1 ? "team" : "teams"}`),
    teamPage: "Each team lead switches standup on for their team on the team's page.",
    followUpsAnswering: (name: string) => `Asking only. How ${name} answers about your work stays in Follow-ups.`,
    assistantTalkSending: "Sending only. Receiving is never blocked.",
    assistantTalkNotes: "Notes from the team keep their own switch.",
  },
  notes: {
    workspacePage: "Switching an ability off here turns it off for everyone's assistant. The switches that already had their own card stay there.",
    personalPage: (name: string) => `What you switch off here only changes ${name}. Other people's assistants can still reach you.`,
    offForWorkspace: (title: string) => `${title} is switched off for this workspace.`,
    impersonated: "Only the person can change their assistant's abilities. They stay as they are while someone else is signed in as them.",
  },
  saved: (title: string, on: boolean) => `${title} ${on ? "on" : "off"}.`,
  errors: {
    notReady: ABILITIES_NOT_READY_SHORT,
    notWorkspaceKey: "Change this one in its own card below.",
    notPersonalKey: "This one isn't switched here. Change it in its own card.",
    unknown: "That isn't one of the abilities.",
    forbidden: "Only the organisation owner or HR can change this.",
    impersonated: "Only the person can change their assistant's abilities. They stay as they are while someone else is signed in as them.",
    sayOn: "Say whether it is on.",
  },
} as const;

/** "Morning brief", "What's still owed"… as the routines card lists the templates. */
export const templateTitle = (t: RoutineTemplate): string => ROUTINE_WORDS.templates[t].name;

// ---- What the Settings cards read (contract C.2) -----------------------------------------------------------------------

/**
 * One card as the viewer reads it. `workspace`: the workspace's own switch for a new key, or the existing switch that
 * governs it (with a link to its card). `personal`: the person's own switch, an existing one, or none ("Set by your
 * workspace"). `also` (phase 7c addition): further existing switches the card surfaces (mentions: "Let people tag
 * {name}"; routines: "Only leads can schedule routines that chase other people"). `effective`: whether it works for the
 * viewer now. `templates` for routines, `teamsOn` for standup.
 */
export type AbilityCard = {
  key: AbilityKey; title: string; what: string; useWhen: string; never: string; icon: string;
  workspace: { kind: "switch"; offered: boolean } | { kind: "existing"; on: boolean; label: string; href: string };
  personal: { kind: "switch"; on: boolean } | { kind: "existing"; on: boolean; label: string; href: string } | { kind: "none"; label: string };
  effective: boolean; state: string;
  /** Fix review, 9 October 2026: Settings → Brenda's sentence and badge, about everyone's assistant and the workspace's own switch. */
  whatWorkspace?: string; workspaceState?: string;
  also?: { scope: "workspace" | "personal"; on: boolean; label: string; href: string }[];
  templates?: { template: RoutineTemplate; label: string; available: boolean; needs: string | null }[];
  teamsOn?: number;
};
/** `impersonated`: someone else is signed in as the person (their personal switches are read-only then). */
export type AbilitiesView = { ready: boolean; cards: AbilityCard[]; canEditWorkspace: boolean; impersonated: boolean };
