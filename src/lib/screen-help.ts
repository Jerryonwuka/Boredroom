/**
 * Screen help on Brenda for Mac, phase 1 (owner decisions, 11 October 2026: "start building with your recommendations";
 * owner request the same day: "press the two buttons, ask Brenda a question about what I'm pointing at on my screen and
 * she helps me out with it"). The person holds Control+Command (or presses Look on her card), Brenda for Mac takes one
 * picture of the window in front of them with their pointer marked, they check it and press Send, and their own assistant
 * answers in words and Confirm cards. The picture lives in memory only, on the Mac and on the server, and is never kept.
 *
 * This module is what the server, the web pages and the tests share: the shapes the routes answer (`DesktopLook`,
 * `ScreenHelpView`, `ScreenHelpMine`), the app rules and their check, the fixed never-look list (identical to the Mac's
 * own copy in desktop/src-tauri/src/look.rs; a unit test pins both to the contract's table), the common apps the add
 * dialog offers, the picture's limits and token count, and every fixed word the cards and the errors use. It imports only
 * zod, so client components can use it.
 *
 * What the workspace never learns (owner decision 1, 11 October 2026): who turned screen help on, whether anyone used it,
 * when, or what Brenda saw. The server keeps the workspace's switch and never-look list, and each person's own never-look
 * list and "Turn off on my Macs" time (assistant_private, theirs alone).
 *
 * Phase 3 (owner request, 12 October 2026: the person sees what is on; the employer still sees nothing; contract 0b.2,
 * G.3): each of the person's Macs reports which abilities are on and which permissions macOS has given (`MacState`), and
 * it is kept for the person alone (assistant_private.screen_help_macs, migration 0059: the person and the worker; no owner,
 * HR or lead reads it). This reverses phase 1's "stored on their Mac only" for the person's own view only. "Set up on my
 * Mac" (assistant_private.screen_help_setup_at) makes their Macs open the setup card, which asks on the Mac before turning
 * anything on.
 */
import { z } from "zod";

// ---- The shapes the routes answer ---------------------------------------------------------------------------------------

/** An app Brenda must never look at: its name as the menu bar shows it, and its bundle id when known. */
export type AppRule = { name: string; bundleId: string | null };
/** Where a never-look rule came from: Boredroom's fixed list, the workspace's, or the person's own. */
export type NeverLookSource = "fixed" | "workspace" | "you";

/** Why screen help is not available (null: it is). */
export const SCREEN_HELP_REASONS = ["not_ready", "not_offered", "no_plan", "no_key", "switched_off", "notice"] as const;
export type ScreenHelpReason = (typeof SCREEN_HELP_REASONS)[number];

/**
 * What `GET /brenda/desktop` carries as `look` (contract A.10). Never thrown: any problem reads as not ready. An older
 * server sends no `look`, and the notch then shows no look features.
 */
export type DesktopLook = {
  /** Migration 0057 is applied. */
  ready: boolean;
  /** Offered here: every workspace, unless BRENDA_LOOK_WORKSPACES is "off" or a list without it. */
  eligible: boolean;
  /** eligible, allowed, the notice is over, the plan includes Brenda and Boredroom's own key is set. */
  available: boolean;
  reason: ScreenHelpReason | null;
  /** ISO, while the workspace is in a notice set before notices were removed. */
  availableFrom: string | null;
  /** The workspace's list, then the person's own (the fixed list is the Mac's own copy). */
  neverLook: (AppRule & { source: "workspace" | "you" })[];
  /** When the person pressed "Turn off on my Macs" (ISO, server time), or null. */
  offAt: string | null;
  /**
   * Brenda for Mac, phase 2 (owner request, 12 October 2026): this server takes v2 looks (two pictures, streamed answers)
   * and tasks. An older server sends no `v`, and the notch keeps phase 1's flow.
   */
  v: 2;
  /** On-screen actions and file work (contract D.4): what the notch may offer, never whether anyone uses it. */
  act: DesktopAct;
  /**
   * Brenda and her helpers (owner brief, 12 October 2026; contract F.0, 0b.22): the front desk (direct actions, the
   * router, background jobs) is ready on this server (migration 0060), and the person's own "Check with me before every
   * task" (default off). Absent on an older server: the notch keeps phase 3's ask-first flow.
   */
  front?: { ready: boolean; checkEvery: boolean };
  /**
   * Phase 3 (owner request, 12 October 2026; contract A.5, 0b.3): the person's last "Set up on my Mac" (server time), null
   * when older than 15 minutes, before 0059, or while someone else is signed in as them. Their Macs open the setup card
   * once for it; the card turns nothing on without the person's own press there.
   */
  setupAt: string | null;
  /** Phase 3: migration 0059 is applied, so Brenda for Mac may report its state (for the person alone). */
  mac: { ready: boolean };
};

/** Why on-screen actions and file work are not available (null: they are). */
export type DesktopActReason = "not_ready" | "switched_off" | "look_unavailable";
export type DesktopAct = {
  /** Migration 0058 is applied. */
  ready: boolean;
  /** look.available, ready, the workspace's switch (actions_allowed) and Boredroom's own key. */
  available: boolean;
  reason: DesktopActReason | null;
};

/** Settings › Brenda, the owner card (any member may read it; owners and HR change it). */
export type ScreenHelpView = {
  ready: boolean;
  eligible: boolean;
  allowed: boolean;
  noticeAt: string | null;
  availableFrom: string | null;
  available: boolean;
  reason: ScreenHelpReason | null;
  neverLook: AppRule[];
  /** Owners and HR. */
  canEdit: boolean;
  /** On-screen actions and file work (phase 2, owner request 12 October 2026): the workspace's switch; true before 0058. */
  actionsAllowed: boolean;
  /** Migration 0058 is applied (the switch can be changed only then). */
  actReady: boolean;
};

// ---- The person's own Macs (phase 3; owner request, 12 October 2026; contract 0b.2, A.6, G.3) ------------------------------

export const PERMISSIONS = ["granted", "denied", "unknown"] as const;
export type Permission = (typeof PERMISSIONS)[number];
/** Why the companion is shown or hidden (contract F): the first six read as shown, the rest as hidden. */
export const COMPANION_WHYS = ["idle", "exchange", "act", "typing", "still", "pressing", "setting_off", "screen_help_off", "signed_out", "locked", "call", "sharing", "screenshot_tool", "mirrored", "full_screen"] as const;
export type CompanionWhy = (typeof COMPANION_WHYS)[number];
/** The reasons that read as "shown": she steps aside for a moment, she is still there. */
export const COMPANION_SHOWN_WHYS: readonly CompanionWhy[] = ["idle", "exchange", "act", "typing", "still", "pressing"];
export type MacFolders = { documents: Permission; desktop: Permission; downloads: Permission };
/** One Mac as Brenda for Mac reports it (the page sends it; `binary` is its LookStatus.v). */
export type MacState = {
  v: 1; binary: number; supported: boolean;
  look: { on: boolean; permission: Permission };
  mac: { on: boolean; accessibility: Permission };
  files: { on: boolean; finder: Permission; folders: MacFolders | null };
  companion: { on: boolean; shown: boolean | null; why: CompanionWhy | null };
  preview: boolean;
};

const permission = z.enum(PERMISSIONS);
/** MacState, exactly: unknown fields and unknown enum values fail. */
export const macStateSchema = z.object({
  v: z.literal(1),
  binary: z.number().int().min(1).max(99),
  supported: z.boolean(),
  look: z.object({ on: z.boolean(), permission }).strict(),
  mac: z.object({ on: z.boolean(), accessibility: permission }).strict(),
  files: z.object({ on: z.boolean(), finder: permission, folders: z.object({ documents: permission, desktop: permission, downloads: permission }).strict().nullable() }).strict(),
  companion: z.object({ on: z.boolean(), shown: z.boolean().nullable(), why: z.enum(COMPANION_WHYS).nullable() }).strict(),
  preview: z.boolean(),
}).strict();

/** What `PUT /screen-help/mac` takes (contract A.6). `setupSeen`: the `setupAt` this Mac just acted on, or null. */
export const macReportBodySchema = z.object({
  version: z.literal(1),
  state: macStateSchema,
  setupSeen: z.string().datetime({ offset: true }).nullable(),
}).strict();

/** One Mac on the person's card: its name and last poll (from its desktop session), what it last reported and when. */
export type MacReport = { device: string; lastSeenAt: string | null; reportedAt: string; state: MacState; setupSeenAt: string | null };

/**
 * Settings › Your assistant, the personal card: the person's own list, their last "Turn off on my Macs", and (phase 3,
 * migration 0059) what each of their Macs last reported and their last "Set up on my Mac". Theirs alone.
 */
export type ScreenHelpMine = {
  ready: boolean; neverLook: AppRule[]; offAt: string | null;
  /** 0059 applied. */
  macReady: boolean;
  /** Newest report first; only live desktop sessions; [] while impersonated. */
  macs: MacReport[];
  /** Linked Macs with no report yet. */
  linked: { device: string; lastSeenAt: string | null }[];
  /** Null while impersonated. */
  setupAt: string | null;
  impersonated: boolean;
};

/** How long a "Set up on my Mac" press stays fresh for the person's Macs (contract 0b.3). */
export const SETUP_FRESH_MINUTES = 15;
/** At most this many Macs are kept per person. */
export const MAC_REPORTS_MAX = 5;

// ---- App rules --------------------------------------------------------------------------------------------------------------

export const APP_RULE_LIMITS = { name: 80, bundleId: 255, list: 50 } as const;
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const BUNDLE_ID = /^[A-Za-z0-9.\-_]+$/;

/**
 * A rule as it is kept, or null when it is not one: the name trimmed (spaces folded), 1 to 80 characters, no control
 * characters; the bundle id trimmed, empty read as none, at most 255 of [A-Za-z0-9.-_].
 */
export function cleanAppRule(v: unknown): AppRule | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.name !== "string" || CONTROL.test(o.name)) return null;
  const name = o.name.replace(/\s+/g, " ").trim();
  if (!name || name.length > APP_RULE_LIMITS.name) return null;
  let bundleId: string | null = null;
  if (o.bundleId !== undefined && o.bundleId !== null) {
    if (typeof o.bundleId !== "string") return null;
    const b = o.bundleId.trim();
    if (b) {
      if (b.length > APP_RULE_LIMITS.bundleId || !BUNDLE_ID.test(b)) return null;
      bundleId = b;
    }
  }
  return { name, bundleId };
}

/** The key two rules share when they are the same app: its bundle id, else its name, ignoring case. */
const ruleKey = (r: AppRule) => (r.bundleId ? `b:${r.bundleId.toLowerCase()}` : `n:${r.name.toLowerCase()}`);

/** A list without repeats, first kept, in order. */
export function dedupeAppRules(rules: AppRule[]): AppRule[] {
  const seen = new Set<string>();
  const out: AppRule[] = [];
  for (const r of rules) {
    const k = ruleKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/** What a stored list holds, read defensively (anything that is not a rule is left out). */
export function appRulesOf(v: unknown): AppRule[] {
  if (!Array.isArray(v)) return [];
  return dedupeAppRules(v.map(cleanAppRule).filter((r): r is AppRule => !!r)).slice(0, APP_RULE_LIMITS.list);
}

const RULE_WORDS = "Give the app's name (up to 80 characters) and, if you know it, its bundle ID, like com.example.app.";
export const appRuleSchema = z.unknown().transform((v, c): AppRule => {
  const r = cleanAppRule(v);
  if (!r) { c.addIssue({ code: "custom", message: RULE_WORDS }); return z.NEVER; }
  return r;
});
/** At most 50, repeats dropped. */
export const appRuleListSchema = z.array(appRuleSchema).max(APP_RULE_LIMITS.list, "At most 50 apps.").transform(dedupeAppRules);

// ---- The fixed never-look list (contract B.4) -------------------------------------------------------------------------------

export type FixedNeverLook = {
  name: string;
  category: "password" | "messaging" | "calls" | "system";
  /** Exact bundle ids. */
  bundleIds: readonly string[];
  /** Bundle-id prefixes (some ids are not confirmed; a prefix catches the family). */
  prefixes: readonly string[];
  /** Exact app names (the running app's name, or the window list's owner name). */
  names: readonly string[];
};

/**
 * Apps Brenda never looks at, whatever anyone chooses: password managers and sign-in prompts, messaging apps, call apps,
 * System Settings and Brenda herself. It cannot be removed. Identical to `FIXED_NEVER_LOOK` in the Mac app's look.rs.
 * The installed ones were checked on the owner's Mac (WhatsApp, Telegram, Microsoft Teams, 11 October 2026); entries
 * with a prefix only are best known, not confirmed.
 */
export const FIXED_NEVER_LOOK: readonly FixedNeverLook[] = [
  { name: "1Password", category: "password", bundleIds: ["com.1password.1password", "com.agilebits.onepassword7", "com.agilebits.onepassword-osx", "com.agilebits.onepassword4"], prefixes: ["com.1password.", "com.agilebits.onepassword"], names: ["1Password", "1Password 7"] },
  { name: "Bitwarden", category: "password", bundleIds: ["com.bitwarden.desktop"], prefixes: ["com.bitwarden."], names: ["Bitwarden"] },
  { name: "Keychain Access", category: "password", bundleIds: ["com.apple.keychainaccess"], prefixes: [], names: ["Keychain Access"] },
  { name: "Passwords", category: "password", bundleIds: ["com.apple.Passwords"], prefixes: [], names: ["Passwords"] },
  { name: "LastPass", category: "password", bundleIds: ["com.lastpass.LastPass"], prefixes: ["com.lastpass."], names: ["LastPass"] },
  { name: "Dashlane", category: "password", bundleIds: [], prefixes: ["com.dashlane."], names: ["Dashlane"] },
  { name: "KeePassXC", category: "password", bundleIds: ["org.keepassxc.keepassxc"], prefixes: [], names: ["KeePassXC"] },
  { name: "Enpass", category: "password", bundleIds: ["in.sinew.Enpass-Desktop"], prefixes: ["in.sinew.enpass"], names: ["Enpass"] },
  { name: "Proton Pass", category: "password", bundleIds: [], prefixes: ["me.proton.pass"], names: ["Proton Pass"] },
  { name: "NordPass", category: "password", bundleIds: [], prefixes: ["com.nordsec.nordpass", "com.nordpass."], names: ["NordPass"] },
  { name: "Keeper", category: "password", bundleIds: [], prefixes: ["com.callpod.keepermac", "com.keepersecurity."], names: ["Keeper", "Keeper Password Manager"] },
  { name: "Sign-in and password prompts", category: "password", bundleIds: ["com.apple.SecurityAgent", "com.apple.loginwindow", "com.apple.ScreenSaver.Engine"], prefixes: ["com.apple.LocalAuthentication"], names: [] },
  { name: "Messages", category: "messaging", bundleIds: ["com.apple.MobileSMS"], prefixes: [], names: ["Messages"] },
  { name: "WhatsApp", category: "messaging", bundleIds: ["net.whatsapp.WhatsApp", "desktop.WhatsApp"], prefixes: [], names: ["WhatsApp"] },
  { name: "Signal", category: "messaging", bundleIds: ["org.whispersystems.signal-desktop"], prefixes: [], names: ["Signal"] },
  { name: "Telegram", category: "messaging", bundleIds: ["ru.keepcoder.Telegram", "org.telegram.desktop"], prefixes: [], names: ["Telegram"] },
  { name: "Slack", category: "messaging", bundleIds: ["com.tinyspeck.slackmacgap"], prefixes: [], names: ["Slack"] },
  { name: "Microsoft Teams", category: "calls", bundleIds: ["com.microsoft.teams2", "com.microsoft.teams"], prefixes: [], names: ["Microsoft Teams"] },
  { name: "Discord", category: "messaging", bundleIds: ["com.hnc.Discord"], prefixes: [], names: ["Discord"] },
  { name: "Messenger", category: "messaging", bundleIds: [], prefixes: ["com.facebook.archon"], names: ["Messenger"] },
  { name: "WeChat", category: "messaging", bundleIds: ["com.tencent.xinWeChat"], prefixes: [], names: ["WeChat"] },
  { name: "Element", category: "messaging", bundleIds: ["im.riot.app"], prefixes: [], names: ["Element"] },
  { name: "Viber", category: "messaging", bundleIds: ["com.viber.osx"], prefixes: [], names: ["Viber"] },
  { name: "LINE", category: "messaging", bundleIds: ["jp.naver.line.mac"], prefixes: [], names: ["LINE"] },
  { name: "Skype", category: "calls", bundleIds: ["com.skype.skype"], prefixes: [], names: ["Skype"] },
  { name: "Wire", category: "messaging", bundleIds: ["com.wearezeta.zclient.mac"], prefixes: [], names: ["Wire"] },
  { name: "Zoom", category: "calls", bundleIds: ["us.zoom.xos"], prefixes: [], names: ["Zoom", "zoom.us"] },
  { name: "FaceTime", category: "calls", bundleIds: ["com.apple.FaceTime"], prefixes: [], names: ["FaceTime"] },
  { name: "Webex", category: "calls", bundleIds: ["Cisco-Systems.Spark", "com.webex.meetingmanager"], prefixes: [], names: ["Webex"] },
  { name: "GoTo Meeting", category: "calls", bundleIds: ["com.logmein.GoToMeeting"], prefixes: [], names: ["GoTo Meeting"] },
  { name: "System Settings", category: "system", bundleIds: ["com.apple.systempreferences"], prefixes: [], names: ["System Settings", "System Preferences"] },
  { name: "Brenda", category: "system", bundleIds: ["cc.boredroom.brenda"], prefixes: [], names: [] },
];

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Whether an app is one Brenda never looks at, and why (contract B.4): the fixed list first (by exact bundle id, bundle
 * id prefix or exact name), then the workspace's, then the person's own (by the rule's bundle id when it has one, or its
 * name; a name match only ever makes her refuse). Comparisons ignore case. `name` is the matched rule's name.
 */
export function neverLookMatch(app: { name: string; bundleId: string | null }, rules: { workspace?: AppRule[]; you?: AppRule[] } = {}): { source: NeverLookSource; name: string } | null {
  const id = lower(app.bundleId);
  const name = lower(app.name);
  for (const f of FIXED_NEVER_LOOK) {
    if (id && (f.bundleIds.some((b) => lower(b) === id) || f.prefixes.some((p) => id.startsWith(lower(p))))) return { source: "fixed", name: f.name };
    if (name && f.names.some((n) => lower(n) === name)) return { source: "fixed", name: f.name };
  }
  const hit = (r: AppRule) => (!!id && !!r.bundleId && lower(r.bundleId) === id) || (!!name && lower(r.name) === name);
  for (const [source, list] of [["workspace", rules.workspace ?? []], ["you", rules.you ?? []]] as const) {
    const r = list.find(hit);
    if (r) return { source, name: r.name };
  }
  return null;
}

/** Apps the add dialog offers, each with its bundle id (Settings › Brenda and Settings › Your assistant). */
export const COMMON_APPS: readonly AppRule[] = [
  { name: "Mail", bundleId: "com.apple.mail" },
  { name: "Outlook", bundleId: "com.microsoft.Outlook" },
  { name: "Excel", bundleId: "com.microsoft.Excel" },
  { name: "Word", bundleId: "com.microsoft.Word" },
  { name: "Numbers", bundleId: "com.apple.iWork.Numbers" },
  { name: "Terminal", bundleId: "com.apple.Terminal" },
  { name: "iTerm", bundleId: "com.googlecode.iterm2" },
  { name: "Visual Studio Code", bundleId: "com.microsoft.VSCode" },
  { name: "Notion", bundleId: "notion.id" },
  { name: "Figma", bundleId: "com.figma.Desktop" },
  { name: "Safari", bundleId: "com.apple.Safari" },
  { name: "Chrome", bundleId: "com.google.Chrome" },
  { name: "Firefox", bundleId: "org.mozilla.firefox" },
  { name: "Arc", bundleId: "company.thebrowser.Browser" },
  { name: "Microsoft Edge", bundleId: "com.microsoft.edgemac" },
  { name: "Preview", bundleId: "com.apple.Preview" },
  { name: "Finder", bundleId: "com.apple.finder" },
];

// ---- The picture (contract A.3, A.6) ----------------------------------------------------------------------------------------

export const LOOK_LIMITS = {
  /** Decoded picture bytes. */
  imageBytes: 2_621_440,
  /** The whole request body (under the 4.5 MB serverless body limit). */
  bodyBytes: 4_000_000,
  /** Each edge, in pixels. */
  minEdge: 16,
  maxEdge: 2_576,
  maxPixels: 3_600_000,
  /** The most image tokens one picture costs at the high-resolution tier. */
  maxImageTokens: 4_784,
  appName: 80,
} as const;

/** What one picture costs in input tokens (28-pixel patches, capped): the share taken out of the person's ledger row. */
export function lookImageTokens(width: number, height: number): number {
  const w = Math.max(0, Math.round(Number(width) || 0));
  const h = Math.max(0, Math.round(Number(height) || 0));
  return Math.min(LOOK_LIMITS.maxImageTokens, Math.ceil(w / 28) * Math.ceil(h / 28));
}

/** "25 October 2026", in the workspace's time zone. */
export function longDate(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try { return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", ...(timeZone ? { timeZone } : {}) }); }
  catch { return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }); }
}

/** "25 October", in the workspace's time zone (the owners' notification). */
export function dayMonth(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try { return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(timeZone ? { timeZone } : {}) }); }
  catch { return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" }); }
}

/**
 * How long existing workspaces are told before screen help becomes available: none (owner request, 24 October 2026,
 * replacing decision 2's 14 days). Owners and HR are still told it is on; a notice set before stays as it was.
 */
export const NOTICE_DAYS = 0;

// ---- Every fixed word (contract A.8, F.4) -----------------------------------------------------------------------------------

export const SCREEN_HELP_WORDS = {
  /** Settings › Brenda, the owner card (owners and HR; shown only while the workspace is in the pilot). */
  owner: {
    title: "Screen help on Brenda for Mac",
    // Review, 11 October 2026: her Look button starts a look too, and Boredroom's servers keep each person's Past chats,
    // so the words promise what is true: nothing in Boredroom shows it, and Boredroom's staff never look.
    description: "Each person can let Brenda look at their screen when they ask her to, with her keys or her Look button. The picture is never kept, and it goes through Boredroom's own AI account, never your organisation's key. You can switch this off for everyone and list apps Brenda must never look at. You can't see who uses it, when, or what Brenda saw: nothing in Boredroom shows it, and Boredroom's staff never look.",
    allowed: "Allowed",
    notAllowed: "Not allowed",
    listTitle: "Apps Brenda must never look at",
    add: "Add app",
    none: "None yet.",
    // By app (review, 11 October 2026): a browser is one app to the Mac, so a web chat or call in it is kept out only by
    // listing the browser.
    fixed: "Always, and can't be removed: password manager, messaging and call apps, and System Settings. A web chat or call in a browser can't be told apart, so add the browser to keep those out.",
    notice: (date: string) => `Screen help starts in this workspace on ${date}. Until then nobody can turn it on.`,
    startNow: "Start it now",
    switchedOff: "Nobody in this workspace can use screen help.",
    notReady: "Screen help needs a database update first.",
    noKey: "Screen help needs Boredroom's own AI key on this server.",
    /** The second setting under the never-look list, only once 0058 is applied (phase 2; contract E.5). */
    actions: {
      title: "On-screen actions and file work",
      description: "When a person turns it on in Brenda for Mac, Brenda can click and type in their apps, or make a new file from one they give her, only when they ask and say yes to exactly what she'll do. It works only where screen help is allowed. You can switch it off for everyone. You can't see who uses it, when, or what Brenda did, and nobody at Boredroom can either.",
      allowed: "Allowed",
      notAllowed: "Not allowed",
      notReady: "This needs a database update first.",
    },
  },
  /** The add dialog, on both cards. */
  addDialog: {
    title: "Add an app",
    description: "Pick an app, or type its name as it appears in the menu bar.",
    name: "App name",
    bundleId: "Bundle ID (optional)",
    bundleIdHint: "Like com.example.app. Leave it empty to match by name.",
  },
  /** Settings › Brenda, the page note under "Screen help". */
  // Phase 2 (owner request, 12 October 2026; contract E.5): tasks too.
  pageNote: "Pictures go through Boredroom's own AI account and are never kept. Nothing in Boredroom shows anyone, owners included, who uses screen help or on-screen actions, when, or what Brenda saw or did, and Boredroom's staff never look. A look counts as one ordinary request in each person's daily limit, and a task counts like a few.",
  /** Settings › Your assistant, the personal card. `name`: the person's assistant. */
  personal: {
    title: "Screen help on your Mac",
    // Phase 2 (owner request, 12 October 2026; contract E.5): the screen the pointer is on, and tasks only after a yes.
    // Phase 3 (owner request, 12 October 2026; contract M.10): the person now sees here which of these are on; the
    // workspace still can't.
    description: (name: string) => `${name} can see the screen your pointer is on when you hold Control+Command and ask, do things on your Mac when you ask and say yes, and work on your files. Brenda for Mac shows you here which of these are on; your workspace can't see it.`,
    turnOff: "Turn off on my Macs",
    turnedOff: "Done. Your Macs turn off screen help, actions and file work within a minute.",
    listTitle: (name: string) => `Apps ${name} must never look at or work in`,
    switchedOff: "Your workspace has switched off screen help.",
    actionsSwitchedOff: "Your workspace has switched off on-screen actions and file work.",
    notice: (date: string) => `Screen help starts in this workspace on ${date}.`,
  },
  /** The owners' and HR's notification when the notice starts (contract D.5). */
  noticeNotification: {
    title: () => "Screen help on Brenda for Mac is on in this workspace",
    body: "Each person can let Brenda look at a window on their Mac when they ask her to, with her keys or her Look button. Each person turns it on for themselves. You can switch it off for everyone in Settings › Brenda.",
  },
  /** The workspace log's words (Settings › Brenda's log; contract D.5). */
  log: {
    allowed: "Screen help on Brenda for Mac: allowed",
    notAllowed: "Screen help on Brenda for Mac: not allowed",
    startedNow: "Screen help on Brenda for Mac: started now",
    listChanged: "Screen help on Brenda for Mac: never-look list changed",
    actionsAllowed: "On-screen actions and file work: allowed",
    actionsNotAllowed: "On-screen actions and file work: not allowed",
  },
  /** What the routes answer (contract A.8). `name`: the person's assistant. */
  errors: {
    desktopOnly: "Screen help works only from Brenda for Mac.",
    notAvailable: "Screen help isn't offered in this workspace.",
    switchedOff: "Your workspace has switched off screen help.",
    notYet: (date: string) => `Screen help starts in this workspace on ${date}.`,
    impersonated: "Screen help is off while someone else is signed in as you.",
    neverLook: (app: string) => `I never look at ${app}.`,
    onCall: "I don't look at the screen during a Boredroom call.",
    tooLarge: "That picture is too large. Try a smaller window.",
    invalid: "That picture couldn't be read. Look again.",
    limit: (limit: number, name: string) => `You've used today's ${limit} requests to ${name}, so ${name} can't look now. Try again tomorrow.`,
    // The notch's title already says "Brenda couldn't look" (review, 11 October 2026), so these say only why.
    failed: (name: string) => `Claude couldn't be reached just now, so ${name} has no answer for that.`,
    /** Anything else that went wrong in the look route (a database fault, say): not Claude's doing. */
    serverFailed: "Boredroom couldn't answer just now. Try again in a moment.",
    notReady: "Screen help needs a database update first.",
    unavailable: "Screen help isn't set up on this Boredroom yet.",
    settingsForbidden: "Only the organisation owner or HR can change screen help.",
    /** Phase 2: the actions switch before 0058. */
    actionsNotReady: "On-screen actions and file work need a database update first.",
    personalImpersonated: "Only the person can change this. It stays as it is while someone else is signed in as them.",
    /** Phase 3: "Set up on my Mac" before 0059. */
    setupNotReady: "Setting up from here needs a database update first. Set it up in Brenda for Mac: click its icon in the menu bar, then Set up.",
  },
} as const;
