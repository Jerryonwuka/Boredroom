/**
 * "How I like things done" (owner decisions, 8–9 October 2026: phase 7c). Each person keeps a short list of preferences
 * in their own words (tone, sign-off, length, how reports read, when to keep quiet): at most 16, each at most 150
 * characters, visible, editable and deletable in Settings → Your assistant, and private to the person (owners and HR
 * never see them; migration 0050's `assistant_preferences` lets only the person read and write their own, and the worker
 * read them for the person's own standup draft).
 *
 * They reach the model in the person's own uncached situation as quoted data: they shape tone, length, format and
 * sign-off, and never change the rules, the person's permissions or what the assistant may do. The assistant never
 * learns silently: it offers to remember one when the person says "remember that …" or corrects it the same way twice,
 * and that always asks (remember_preference, even when they act without asking; never in a turn holding other people's
 * words).
 *
 * Client-safe: imports nothing.
 */

export const PREFERENCE_LIMITS = { max: 16, chars: 150 } as const;

export type PreferenceSource = "settings" | "chat";
export type Preference = { id: string; body: string; source: PreferenceSource; createdAt: string; updatedAt: string };
/** `hidden`: someone else is signed in as the person, so the list is not shown (and nothing can change). */
export type PreferenceList = { ready: boolean; hidden: boolean; items: Preference[]; max: 16 };

/** One line: control characters and runs of whitespace become one space, trimmed; quotes and punctuation kept. */
export function cleanPreference(s: string): string {
  return String(s ?? "").replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
}

/** A link, a bare domain ("example.com/notes") or an e-mail address (fix review, 9 October 2026: bare domains passed). */
const LINK = /(?:https?:\/\/|\bwww\.|\bmailto:|\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|ai|app|dev|me|info|biz|xyz|uk|ng|us|eu|de|fr|link|site|page|ly|gl|to|so)\b|[^\s@]+@[^\s@]+\.[a-z]{2,})/i;
/**
 * Words that ask for a permission, not a style (contract D.1), widened (fix review, 9 October 2026): never/don't/stop
 * asking or checking first, acting at once or on its own, skipping or doing without Confirm, disregarding or overriding
 * the rules, "just do it".
 */
const PERMISSION = new RegExp([
  String.raw`without (?:asking|checking|confirm\w*|my (?:ok|okay|approval|permission|say-?so))`,
  String.raw`(?:never|don['’]?t|do not|no need to|stop|quit) (?:ask|asking|check|checking)\w* (?:me |with me )?(?:first|before|whether|for (?:permission|approval|confirmation)|to confirm)`,
  String.raw`(?:skip|no|without|never|drop|bypass) (?:the |a |any |my )?confirm\w*`,
  String.raw`(?:never|don['’]?t|do not) (?:wait|need) (?:for )?(?:my |a |the )?(?:confirm\w*|approval|ok|okay|press)`,
  String.raw`act (?:straight away|right away|at once|immediately|on (?:your|its) own|for me|without)`,
  String.raw`don['’]?t ask`, String.raw`act for me`, String.raw`just do it`,
  String.raw`permission`,
  String.raw`(?:ignore|disregard|override|bypass|forget) (?:the |your |any |all |previous |these |those |my |other )*(?:rules|instructions|limits|restrictions|guidelines|policies|system prompt)`,
  String.raw`password`, String.raw`api key`, String.raw`token`,
].map((x) => `(?:${x})`).join("|").replace(/^/, String.raw`\b(?:`) + String.raw`)\b`, "i");

/**
 * What is wrong with a preference as it would be saved (cleaned first), in plain words; null when it is fine. `name`: the
 * person's own assistant ("Max").
 */
export function preferenceProblem(s: string, name: string): string | null {
  const body = cleanPreference(s);
  if (!body) return PREFERENCE_WORDS.errors.empty;
  if (body.length > PREFERENCE_LIMITS.chars) return PREFERENCE_WORDS.errors.tooLong;
  if (LINK.test(body)) return PREFERENCE_WORDS.errors.link;
  if (PERMISSION.test(body)) return PREFERENCE_WORDS.errors.permission(name || "your assistant");
  return null;
}

/** Every fixed string the editor, the chat and the routes use (contract D.1, D.5). `name`: the person's own assistant. */
export const PREFERENCE_WORDS = {
  section: "How I like things done",
  description: (name: string) => `Tell ${name} how you like things done: tone, sign-off, length, how reports read, when to keep quiet. Only you see this list.`,
  pageNote: (name: string) => `Owners and HR never see your preferences. ${name} follows them for style; they never change what ${name} may do.`,
  hidden: "Hidden while someone else is signed in as this person.",
  add: "Add",
  addLabel: "New preference",
  placeholder: "Keep replies to three lines.",
  edit: "Edit",
  editLabel: (n: number) => `Edit preference ${n}`,
  delete: "Delete",
  deleteLabel: (n: number) => `Delete preference ${n}`,
  deleteConfirm: "Delete",
  save: "Save",
  cancel: "Cancel",
  count: (n: number) => `${n} of ${PREFERENCE_LIMITS.max}`,
  counter: (n: number) => `${n} / ${PREFERENCE_LIMITS.chars}`,
  empty: "Nothing yet. Add how you like things done, in your own words.",
  fromChat: "Remembered in chat",
  saved: "Saved.",
  deleted: "Deleted.",
  notReady: "This needs a database update first.",
  errors: {
    empty: "Write the preference first.",
    tooLong: `Keep it under ${PREFERENCE_LIMITS.chars} characters.`,
    link: "Leave links out of a preference.",
    permission: (name: string) => `That sounds like a permission, not a preference. Change what ${name} may do in Settings → Your assistant → Permissions.`,
    full: `You can keep ${PREFERENCE_LIMITS.max}. Delete one to add another.`,
    exists: "That's already on your list.",
    notFound: "That preference isn't on your list.",
    impersonated: "Preferences are only changed by the person themselves.",
  },
} as const;

/** Before migration 0050 (the chat's tools and the routes say this). */
export const PREFERENCES_NOT_READY = "Remembering how you like things done needs a database update first. Ask an owner to apply it.";
export const PREFERENCES_NOT_READY_SHORT = "This needs a database update first.";
