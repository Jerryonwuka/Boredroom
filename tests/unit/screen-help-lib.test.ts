import { describe, it, expect, vi, afterEach } from "vitest";

// Screen help on Brenda for Mac (owner decisions, 11 October 2026; contract B.4, D.4, D.5, F.4): the shared library and
// the server's pure helpers. The fixed never-look list is pinned to the contract's table (the Mac's own copy in look.rs
// has its own test against the same table).

vi.mock("@/server/db", () => {
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withUser: refuse, withSystem: refuse, withWorker: refuse };
});

import {
  APP_RULE_LIMITS, COMMON_APPS, FIXED_NEVER_LOOK, LOOK_LIMITS, SCREEN_HELP_WORDS, appRuleListSchema, appRuleSchema, appRulesOf, cleanAppRule,
  dedupeAppRules, longDate, lookImageTokens, neverLookMatch,
} from "@/lib/screen-help";
import { DEFAULT_LOOK_MODEL, lookConnection, lookEligible, lookModel } from "@/server/services/screen-help";

/** The contract's table (B.4), row by row: name, category, exact ids, prefixes, names. */
const TABLE: [string, string, string[], string[], string[]][] = [
  ["1Password", "password", ["com.1password.1password", "com.agilebits.onepassword7", "com.agilebits.onepassword-osx", "com.agilebits.onepassword4"], ["com.1password.", "com.agilebits.onepassword"], ["1Password", "1Password 7"]],
  ["Bitwarden", "password", ["com.bitwarden.desktop"], ["com.bitwarden."], ["Bitwarden"]],
  ["Keychain Access", "password", ["com.apple.keychainaccess"], [], ["Keychain Access"]],
  ["Passwords", "password", ["com.apple.Passwords"], [], ["Passwords"]],
  ["LastPass", "password", ["com.lastpass.LastPass"], ["com.lastpass."], ["LastPass"]],
  ["Dashlane", "password", [], ["com.dashlane."], ["Dashlane"]],
  ["KeePassXC", "password", ["org.keepassxc.keepassxc"], [], ["KeePassXC"]],
  ["Enpass", "password", ["in.sinew.Enpass-Desktop"], ["in.sinew.enpass"], ["Enpass"]],
  ["Proton Pass", "password", [], ["me.proton.pass"], ["Proton Pass"]],
  ["NordPass", "password", [], ["com.nordsec.nordpass", "com.nordpass."], ["NordPass"]],
  ["Keeper", "password", [], ["com.callpod.keepermac", "com.keepersecurity."], ["Keeper", "Keeper Password Manager"]],
  ["Sign-in and password prompts", "password", ["com.apple.SecurityAgent", "com.apple.loginwindow", "com.apple.ScreenSaver.Engine"], ["com.apple.LocalAuthentication"], []],
  ["Messages", "messaging", ["com.apple.MobileSMS"], [], ["Messages"]],
  ["WhatsApp", "messaging", ["net.whatsapp.WhatsApp", "desktop.WhatsApp"], [], ["WhatsApp"]],
  ["Signal", "messaging", ["org.whispersystems.signal-desktop"], [], ["Signal"]],
  ["Telegram", "messaging", ["ru.keepcoder.Telegram", "org.telegram.desktop"], [], ["Telegram"]],
  ["Slack", "messaging", ["com.tinyspeck.slackmacgap"], [], ["Slack"]],
  ["Microsoft Teams", "calls", ["com.microsoft.teams2", "com.microsoft.teams"], [], ["Microsoft Teams"]],
  ["Discord", "messaging", ["com.hnc.Discord"], [], ["Discord"]],
  ["Messenger", "messaging", [], ["com.facebook.archon"], ["Messenger"]],
  ["WeChat", "messaging", ["com.tencent.xinWeChat"], [], ["WeChat"]],
  ["Element", "messaging", ["im.riot.app"], [], ["Element"]],
  ["Viber", "messaging", ["com.viber.osx"], [], ["Viber"]],
  ["LINE", "messaging", ["jp.naver.line.mac"], [], ["LINE"]],
  ["Skype", "calls", ["com.skype.skype"], [], ["Skype"]],
  ["Wire", "messaging", ["com.wearezeta.zclient.mac"], [], ["Wire"]],
  ["Zoom", "calls", ["us.zoom.xos"], [], ["Zoom", "zoom.us"]],
  ["FaceTime", "calls", ["com.apple.FaceTime"], [], ["FaceTime"]],
  ["Webex", "calls", ["Cisco-Systems.Spark", "com.webex.meetingmanager"], [], ["Webex"]],
  ["GoTo Meeting", "calls", ["com.logmein.GoToMeeting"], [], ["GoTo Meeting"]],
  ["System Settings", "system", ["com.apple.systempreferences"], [], ["System Settings", "System Preferences"]],
  ["Brenda", "system", ["cc.boredroom.brenda"], [], []],
];

describe("the fixed never-look list (contract B.4)", () => {
  it("is exactly the contract's table, in its order", () => {
    expect(FIXED_NEVER_LOOK.map((f) => [f.name, f.category, [...f.bundleIds], [...f.prefixes], [...f.names]])).toEqual(TABLE);
    expect(FIXED_NEVER_LOOK).toHaveLength(32);
  });

  it("matches by exact bundle id, by prefix and by exact name, ignoring case", () => {
    expect(neverLookMatch({ name: "Anything", bundleId: "com.1password.1password" })).toEqual({ source: "fixed", name: "1Password" });
    expect(neverLookMatch({ name: "Anything", bundleId: "COM.TINYSPECK.SLACKMACGAP" })).toEqual({ source: "fixed", name: "Slack" });
    expect(neverLookMatch({ name: "Dash", bundleId: "com.dashlane.dashlanephonefinal" })).toEqual({ source: "fixed", name: "Dashlane" });
    expect(neverLookMatch({ name: "zoom.us", bundleId: null })).toEqual({ source: "fixed", name: "Zoom" });
    expect(neverLookMatch({ name: "system preferences", bundleId: null })).toEqual({ source: "fixed", name: "System Settings" });
    expect(neverLookMatch({ name: "x", bundleId: "com.apple.LocalAuthentication.UIAgent" })).toEqual({ source: "fixed", name: "Sign-in and password prompts" });
    expect(neverLookMatch({ name: "Brenda", bundleId: "cc.boredroom.brenda" })).toEqual({ source: "fixed", name: "Brenda" });
  });

  it("does not match what merely looks alike", () => {
    expect(neverLookMatch({ name: "Figma", bundleId: "com.figma.Desktop" })).toBeNull();
    expect(neverLookMatch({ name: "Slackware notes", bundleId: "com.example.slack" })).toBeNull();
    expect(neverLookMatch({ name: "Message Board", bundleId: null })).toBeNull();
  });

  it("then the workspace's list, then the person's own, by bundle id when the rule has one, else by name", () => {
    const rules = { workspace: [{ name: "Excel", bundleId: "com.microsoft.Excel" }], you: [{ name: "Notion", bundleId: null }, { name: "Excel", bundleId: null }] };
    expect(neverLookMatch({ name: "Microsoft Excel", bundleId: "com.microsoft.excel" }, rules)).toEqual({ source: "workspace", name: "Excel" });
    expect(neverLookMatch({ name: "NOTION", bundleId: "notion.id" }, rules)).toEqual({ source: "you", name: "Notion" });
    // A rule's name matches too when the app's bundle id differs (a name match only ever makes her refuse): the
    // workspace's rule comes first.
    expect(neverLookMatch({ name: "Excel", bundleId: "com.other.excel" }, rules)).toEqual({ source: "workspace", name: "Excel" });
    expect(neverLookMatch({ name: "Notion", bundleId: "com.other.notion" }, rules)).toEqual({ source: "you", name: "Notion" });
    // The fixed list comes first, whatever the lists say.
    expect(neverLookMatch({ name: "Slack", bundleId: null }, { workspace: [{ name: "Slack", bundleId: null }] })?.source).toBe("fixed");
    expect(neverLookMatch({ name: "Figma", bundleId: "com.figma.Desktop" }, rules)).toBeNull();
  });
});

describe("app rules (contract D.5)", () => {
  it("cleans a rule: spaces folded, an empty bundle id is none", () => {
    expect(cleanAppRule({ name: "  Visual   Studio Code ", bundleId: " com.microsoft.VSCode " })).toEqual({ name: "Visual Studio Code", bundleId: "com.microsoft.VSCode" });
    expect(cleanAppRule({ name: "Figma", bundleId: "" })).toEqual({ name: "Figma", bundleId: null });
    expect(cleanAppRule({ name: "Figma" })).toEqual({ name: "Figma", bundleId: null });
  });

  it("refuses what is not one", () => {
    for (const bad of [null, "Figma", [], { name: "" }, { name: "   " }, { name: "x".repeat(81) }, { name: "Bell\u0007" }, { name: "Line break" },
      { name: "Figma", bundleId: "com figma" }, { name: "Figma", bundleId: "com/figma" }, { name: "Figma", bundleId: "a".repeat(256) }, { name: "Figma", bundleId: 7 }, { name: 7 }]) {
      expect(cleanAppRule(bad), JSON.stringify(bad)).toBeNull();
      expect(appRuleSchema.safeParse(bad).success).toBe(false);
    }
    expect(cleanAppRule({ name: "x".repeat(80), bundleId: "a".repeat(255) })).not.toBeNull();
  });

  it("a list: at most 50, repeats by bundle id or name dropped, first kept", () => {
    expect(dedupeAppRules([{ name: "Excel", bundleId: "com.microsoft.Excel" }, { name: "Excel 2", bundleId: "COM.MICROSOFT.EXCEL" }, { name: "notion", bundleId: null }, { name: "Notion", bundleId: null }]))
      .toEqual([{ name: "Excel", bundleId: "com.microsoft.Excel" }, { name: "notion", bundleId: null }]);
    expect(appRuleListSchema.safeParse(Array.from({ length: 51 }, (_, i) => ({ name: `App ${i}`, bundleId: null }))).success).toBe(false);
    expect(appRuleListSchema.parse([{ name: "A" }, { name: "a" }])).toEqual([{ name: "A", bundleId: null }]);
    expect(appRulesOf("nope")).toEqual([]);
    expect(appRulesOf([{ name: "A" }, 5, { name: "" }, { name: "B", bundleId: "b.b" }])).toEqual([{ name: "A", bundleId: null }, { name: "B", bundleId: "b.b" }]);
    expect(APP_RULE_LIMITS).toEqual({ name: 80, bundleId: 255, list: 50 });
  });

  it("the common apps the add dialog offers are good rules, none of them on the fixed list", () => {
    expect(COMMON_APPS.map((a) => a.name)).toEqual(["Mail", "Outlook", "Excel", "Word", "Numbers", "Terminal", "iTerm", "Visual Studio Code", "Notion", "Figma", "Safari", "Chrome", "Firefox", "Arc", "Microsoft Edge", "Preview", "Finder"]);
    for (const a of COMMON_APPS) {
      expect(cleanAppRule(a)).toEqual(a);
      expect(neverLookMatch(a)).toBeNull();
    }
  });
});

describe("the picture's limits and tokens (contract A.3, D.4)", () => {
  it("28-pixel patches, capped at 4,784", () => {
    expect(lookImageTokens(1512, 982)).toBe(Math.ceil(1512 / 28) * Math.ceil(982 / 28));
    expect(lookImageTokens(28, 28)).toBe(1);
    expect(lookImageTokens(29, 28)).toBe(2);
    expect(lookImageTokens(2576, 2576)).toBe(4784);
    expect(lookImageTokens(0, 100)).toBe(0);
    expect(lookImageTokens(Number.NaN, 100)).toBe(0);
  });

  it("every picture the Mac may send fits the high-resolution tier", () => {
    for (let w = LOOK_LIMITS.minEdge; w <= LOOK_LIMITS.maxEdge; w += 40) {
      for (let h = LOOK_LIMITS.minEdge; h <= LOOK_LIMITS.maxEdge; h += 40) {
        if (w * h > LOOK_LIMITS.maxPixels) continue;
        expect(Math.ceil(w / 28) * Math.ceil(h / 28)).toBeLessThanOrEqual(4784);
      }
    }
  });

  it("dates read in the workspace's zone", () => {
    expect(longDate("2026-10-25T09:00:00Z", "Africa/Lagos")).toBe("25 October 2026");
    expect(longDate("2026-10-24T23:30:00Z", "Asia/Tokyo")).toBe("25 October 2026");
  });
});

describe("the pilot gate, the model and the key (contract D.4)", () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, model: process.env.BRENDA_LOOK_MODEL };
  afterEach(() => {
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.model === undefined) delete process.env.BRENDA_LOOK_MODEL; else process.env.BRENDA_LOOK_MODEL = saved.model;
  });

  it("BRENDA_LOOK_WORKSPACES: unset, empty or '*' is everyone; 'off' is nobody; otherwise only the slugs named (commas and spaces, any case)", () => {
    expect(lookEligible("jeremiah-onwuka", "jeremiah-onwuka")).toBe(true);
    expect(lookEligible("company-a", " Jeremiah-Onwuka , company-a  other ")).toBe(true);
    expect(lookEligible("other", "company-a other")).toBe(true);
    expect(lookEligible("company-b", "company-a")).toBe(false);
    expect(lookEligible("anyone", "*")).toBe(true);
    expect(lookEligible("anyone", "")).toBe(true);
    expect(lookEligible("anyone", "  ,  ")).toBe(true);
    // undefined falls back to the real setting (a test's .env may name a workspace): unset there is everyone too.
    const env = process.env.BRENDA_LOOK_WORKSPACES;
    delete process.env.BRENDA_LOOK_WORKSPACES;
    try {
      expect(lookEligible("anyone", undefined)).toBe(true);
    } finally {
      if (env !== undefined) process.env.BRENDA_LOOK_WORKSPACES = env;
    }
    expect(lookEligible("company", "company-a")).toBe(false);
    expect(lookEligible("anyone", "off")).toBe(false);
    expect(lookEligible("anyone", " OFF ")).toBe(false);
    expect(lookEligible("company-a", "off")).toBe(false);
  });

  it("BRENDA_LOOK_MODEL: a Claude model id, never Fable or Mythos; claude-opus-5-5 otherwise", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(DEFAULT_LOOK_MODEL).toBe("claude-opus-5-5");
    expect(lookModel(undefined)).toBe("claude-opus-5-5");
    expect(lookModel("  ")).toBe("claude-opus-5-5");
    expect(lookModel(" claude-sonnet-5-5 ")).toBe("claude-sonnet-5-5");
    expect(lookModel("claude-fable-5")).toBe("claude-opus-5-5");
    expect(lookModel("claude-mythos-1")).toBe("claude-opus-5-5");
    expect(lookModel("gpt-5")).toBe("claude-opus-5-5");
    expect(lookModel("claude-Opus")).toBe("claude-opus-5-5");
    // Warned once, without the value.
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    for (const c of warn.mock.calls) expect(String(c[0])).not.toMatch(/fable-5|mythos-1|gpt-5/);
    warn.mockRestore();
  });

  it("Boredroom's own key, never a workspace's: the connection is the environment's or nothing", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-not-real";
    delete process.env.BRENDA_LOOK_MODEL;
    expect(lookConnection()).toEqual({ apiKey: "test-key-not-real", model: "claude-opus-5-5", source: "environment" });
    delete process.env.ANTHROPIC_API_KEY;
    expect(lookConnection()).toBeNull();
  });
});

describe("the settings words (contract F.4, A.8)", () => {
  it("the owner card's description, word for word", () => {
    // Review, 11 October 2026: her Look button too; Boredroom's servers keep Past chats, so "nothing in Boredroom shows it".
    expect(SCREEN_HELP_WORDS.owner.description).toBe("Each person can let Brenda look at their screen when they ask her to, with her keys or her Look button. The picture is never kept, and it goes through Boredroom's own AI account, never your organisation's key. You can switch this off for everyone and list apps Brenda must never look at. You can't see who uses it, when, or what Brenda saw: nothing in Boredroom shows it, and Boredroom's staff never look.");
    expect(SCREEN_HELP_WORDS.owner.fixed).toBe("Always, and can't be removed: password manager, messaging and call apps, and System Settings. A web chat or call in a browser can't be told apart, so add the browser to keep those out.");
    // Phase 2 (owner request, 12 October 2026; contract E.5).
    expect(SCREEN_HELP_WORDS.pageNote).toBe("Pictures go through Boredroom's own AI account and are never kept. Nothing in Boredroom shows anyone, owners included, who uses screen help or on-screen actions, when, or what Brenda saw or did, and Boredroom's staff never look. A look counts as one ordinary request in each person's daily limit, and a task counts like a few.");
    // Phase 3 (owner request, 12 October 2026; contract M.10): the person sees which are on; the workspace can't.
    expect(SCREEN_HELP_WORDS.personal.description("Max")).toBe("Max can see the screen your pointer is on when you hold Control+Command and ask, do things on your Mac when you ask and say yes, and work on your files. Brenda for Mac shows you here which of these are on; your workspace can't see it.");
    expect(SCREEN_HELP_WORDS.personal.description("Brenda")).toBe("Brenda can see the screen your pointer is on when you hold Control+Command and ask, do things on your Mac when you ask and say yes, and work on your files. Brenda for Mac shows you here which of these are on; your workspace can't see it.");
    expect(SCREEN_HELP_WORDS.personal.turnedOff).toBe("Done. Your Macs turn off screen help, actions and file work within a minute.");
    expect(SCREEN_HELP_WORDS.personal.listTitle("Max")).toBe("Apps Max must never look at or work in");
    expect(SCREEN_HELP_WORDS.personal.actionsSwitchedOff).toBe("Your workspace has switched off on-screen actions and file work.");
    expect(SCREEN_HELP_WORDS.owner.actions.title).toBe("On-screen actions and file work");
    expect(SCREEN_HELP_WORDS.owner.actions.description).toBe("When a person turns it on in Brenda for Mac, Brenda can click and type in their apps, or make a new file from one they give her, only when they ask and say yes to exactly what she'll do. It works only where screen help is allowed. You can switch it off for everyone. You can't see who uses it, when, or what Brenda did, and nobody at Boredroom can either.");
    expect(SCREEN_HELP_WORDS.owner.actions.notReady).toBe("This needs a database update first.");
  });

  it("the errors the notch shows", () => {
    const E = SCREEN_HELP_WORDS.errors;
    expect(E.limit(150, "Max")).toBe("You've used today's 150 requests to Max, so Max can't look now. Try again tomorrow.");
    // The notch's title already says "Max couldn't look" (review, 11 October 2026).
    expect(E.failed("Max")).toBe("Claude couldn't be reached just now, so Max has no answer for that.");
    expect(E.serverFailed).toBe("Boredroom couldn't answer just now. Try again in a moment.");
    expect(E.onCall).toBe("I don't look at the screen during a Boredroom call.");
    expect(E.notYet("25 October 2026")).toBe("Screen help starts in this workspace on 25 October 2026.");
    expect(E.neverLook("Slack")).toBe("I never look at Slack.");
    expect(E.invalid).toBe("That picture couldn't be read. Look again.");
    expect(E.tooLarge).toBe("That picture is too large. Try a smaller window.");
  });
});
