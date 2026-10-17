import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The web card "{name} on your Mac" (Brenda for Mac, phase 3; owner report and request, 12 October 2026: "when I turned
// this setting on, I stopped seeing my Brenda"; contract companion2-spec A.5, L.2, L.3, M.9): each Mac's rows and badges
// for every state and permission mix, under both names; where the setup has got to after "Set up on my Mac"; "Checked …";
// and the card's own wiring (Set up is the white primary, Turn off is the confirmed danger outline, no orange).
import { MAC_HELP_WORDS, checkedWords, companionWords, macRows, newestBinary, nothingToTurnOff, setupPolling, setupStatus, setupWords, SETUP_POLL_FOR_MS, SETUP_WAIT_MS } from "@/lib/mac-help";
import type { MacReport, MacState, ScreenHelpMine } from "@/lib/screen-help";

const allOn: MacState = {
  v: 1, binary: 3, supported: true,
  look: { on: true, permission: "granted" },
  mac: { on: true, accessibility: "granted" },
  files: { on: true, finder: "granted", folders: { documents: "granted", desktop: "granted", downloads: "granted" } },
  companion: { on: true, shown: true, why: "idle" },
  preview: false,
};
const with_ = (patch: Partial<MacState>): MacState => ({ ...allOn, ...patch });
const values = (s: MacState, name = "Brenda") => Object.fromEntries(macRows(s, name).map((r) => [r.key, [r.value, r.tone]]));

describe("macRows (contract A.5, M.9)", () => {
  it("everything on and allowed: three green On badges and the companion shown", () => {
    expect(values(allOn)).toEqual({ look: ["On", "success"], mac: ["On", "success"], files: ["On", "success"], companion: ["Shown", null] });
    expect(macRows(allOn, "Brenda").map((r) => r.label)).toEqual(["Sees your screen when you ask", "Does things when you ask", "Works on your files", "Brenda by your pointer"]);
  });
  it("everything off (the owner's Mac after Turn off on my Macs): Off in neutral, the companion hidden with its reason", () => {
    const off = with_({ look: { on: false, permission: "granted" }, mac: { on: false, accessibility: "unknown" }, files: { on: false, finder: "unknown", folders: null }, companion: { on: true, shown: false, why: "screen_help_off" } });
    expect(values(off)).toEqual({ look: ["Off", "neutral"], mac: ["Off", "neutral"], files: ["Off", "neutral"], companion: ["Hidden: seeing your screen is off", null] });
  });
  it("names the missing permission in amber, never just On", () => {
    expect(values(with_({ look: { on: true, permission: "denied" } })).look).toEqual(["On, but Screen Recording isn't allowed", "warning"]);
    expect(values(with_({ look: { on: true, permission: "unknown" } })).look).toEqual(["On, but Screen Recording isn't allowed", "warning"]);
    expect(values(with_({ mac: { on: true, accessibility: "denied" } })).mac).toEqual(["On; clicking and typing need Accessibility", "warning"]);
    expect(values(with_({ mac: { on: true, accessibility: "unknown" } })).mac).toEqual(["On; clicking and typing need Accessibility", "warning"]);
    expect(values(with_({ files: { on: true, finder: "denied", folders: null } })).files).toEqual(["On; Finder said no", "warning"]);
  });
  it("names the first folder macOS refused (Documents, Desktop, Downloads), Finder first", () => {
    const f = (documents: "granted" | "denied" | "unknown", desktop: "granted" | "denied" | "unknown", downloads: "granted" | "denied" | "unknown") =>
      values(with_({ files: { on: true, finder: "granted", folders: { documents, desktop, downloads } } })).files;
    expect(f("denied", "denied", "granted")).toEqual(["On; Documents isn't allowed", "warning"]);
    expect(f("granted", "denied", "denied")).toEqual(["On; Desktop isn't allowed", "warning"]);
    expect(f("granted", "unknown", "denied")).toEqual(["On; Downloads isn't allowed", "warning"]);
    // Not asked yet is not a refusal: macOS asks at the first file job.
    expect(f("unknown", "unknown", "unknown")).toEqual(["On", "success"]);
    expect(values(with_({ files: { on: true, finder: "denied", folders: { documents: "denied", desktop: "granted", downloads: "granted" } } })).files).toEqual(["On; Finder said no", "warning"]);
    // Today's binary reports no folders.
    expect(values(with_({ files: { on: true, finder: "unknown", folders: null } })).files).toEqual(["On", "success"]);
  });
  it("the partly-on mix (Accessibility missing, Finder denied, Documents denied)", () => {
    const s = with_({ mac: { on: true, accessibility: "unknown" }, files: { on: true, finder: "denied", folders: { documents: "denied", desktop: "unknown", downloads: "granted" } } });
    expect(values(s)).toEqual({ look: ["On", "success"], mac: ["On; clicking and typing need Accessibility", "warning"], files: ["On; Finder said no", "warning"], companion: ["Shown", null] });
  });
  it("doing and files need seeing (0b.5): reported on with seeing off reads Off", () => {
    expect(values(with_({ look: { on: false, permission: "granted" } }))).toMatchObject({ look: ["Off", "neutral"], mac: ["Off", "neutral"], files: ["Off", "neutral"] });
  });
  it("a Mac too old for any of it reads Off throughout", () => {
    expect(values(with_({ supported: false }))).toMatchObject({ look: ["Off", "neutral"], mac: ["Off", "neutral"], files: ["Off", "neutral"] });
    expect(MAC_HELP_WORDS.unsupported).toBe("This Mac can't use these: it needs a newer version of macOS.");
  });
  it("the companion: Shown for passing reasons, the tray's words for hiding ones (M.5), Not reported yet without a reason", () => {
    for (const why of ["idle", "exchange", "act", "typing", "still", "pressing"] as const) expect(companionWords(with_({ companion: { on: true, shown: true, why } }))).toBe("Shown");
    const hidden = {
      setting_off: "Hidden: switched off", screen_help_off: "Hidden: seeing your screen is off", signed_out: "Hidden: signed out",
      locked: "Hidden: Mac locked", call: "Hidden during a call", sharing: "Hidden: screen may be shared",
      screenshot_tool: "Hidden: taking a screenshot", mirrored: "Hidden: screen mirrored", full_screen: "Hidden: an app is full screen",
    } as const;
    for (const [why, words] of Object.entries(hidden)) expect(companionWords(with_({ companion: { on: true, shown: false, why: why as keyof typeof hidden } }))).toBe(words);
    // Today's binary: no reason, so the switches the card knows give one, else "Not reported yet".
    expect(companionWords(with_({ companion: { on: true, shown: null, why: null } }))).toBe("Not reported yet");
    expect(companionWords(with_({ companion: { on: false, shown: null, why: null } }))).toBe("Hidden: switched off");
    expect(companionWords(with_({ look: { on: false, permission: "granted" }, companion: { on: true, shown: null, why: null } }))).toBe("Hidden: seeing your screen is off");
  });
  it("names the person's own assistant, never Brenda or she beside it (the naming rule)", () => {
    const rows = macRows(allOn, "Max");
    expect(rows[3].label).toBe("Max by your pointer");
    const words = [MAC_HELP_WORDS.title("Max"), MAC_HELP_WORDS.description("Max"), MAC_HELP_WORDS.off.description("Max"), MAC_HELP_WORDS.setup.timeout("Max"), ...rows.map((r) => `${r.label} ${r.value}`)].join(" ");
    expect(words).not.toMatch(/\bshe\b|\bher\b/i);
    // "Brenda" only as the app's name.
    expect(words.replace(/Brenda for Mac/g, "")).not.toMatch(/Brenda/);
    expect(MAC_HELP_WORDS.title("Brenda")).toBe("Brenda on your Mac");
  });
});

describe("the card's words (M.9, exact)", () => {
  it("are the contract's", () => {
    const W = MAC_HELP_WORDS;
    expect(W.title("Max")).toBe("Max on your Mac");
    expect(W.description("Max")).toBe("Max can see your screen when you ask, do things on your Mac when you ask and say yes, and work on your files. You choose which in Brenda for Mac, on each Mac.");
    expect(W.macsLabel).toBe("Your Macs");
    expect(W.linkedNoReport).toBe("Hasn't checked in since this update. Open Brenda for Mac there to see what's on.");
    expect(W.none).toBe("Brenda for Mac isn't on any of your Macs yet. Install it and sign in, then set it up here.");
    expect(W.setup.hint).toBe("Opens the setup on your Mac. It asks you there before turning anything on.");
    expect(W.setup.button).toBe("Set up on my Mac");
    expect(W.off.hint).toBe("Turns off seeing your screen, doing things and working on files on every Mac you use.");
    expect(W.off.button).toBe("Turn off on all my Macs…");
    expect(W.off.title).toBe("Turn off screen help, actions and file work on all your Macs?");
    expect(W.off.description("Max")).toBe("Max stops seeing your screen, doing things and working on files on every Mac you use, within a minute. You can set it up again any time.");
    expect(W.off.confirm).toBe("Turn off");
    expect(W.off.pending).toBe("Turning off…");
    expect(W.privacy).toBe("Only you can see this. Your workspace can't see whether you use any of it, or what's on.");
    expect(W.notReady).toBe("What's on on your Macs shows here after a database update.");
  });
  // Review, 12 October 2026 (experience-4): before 0059 the card named a "Set up" tray item today's app doesn't have, and
  // showed a bare list under "Your Macs" above a lone Turn off.
  it("tells the person how to set it up in the words of the Brenda for Mac they have", () => {
    const W = MAC_HELP_WORDS;
    expect(W.abilitiesLabel).toBe("What it can do");
    expect(W.howTo("Max", null)).toBe("On your Mac, hold ⌃ ⌘ and ask, or click the Brenda for Mac icon in the menu bar and choose Screen help › Turn on screen help…");
    expect(W.howTo("Max", 2)).toBe(W.howTo("Max", null));
    expect(W.howTo("Max", 3)).toBe("On your Mac, hold ⌃ ⌘ and ask, or click the Brenda for Mac icon in the menu bar and choose Set up Max on this Mac…");
    expect(W.setup.timeout("Max", 2)).toBe("Brenda for Mac hasn't opened it yet. Check it's running and signed in, or choose Screen help › Turn on screen help… from its icon in the menu bar.");
    expect(W.setup.timeout("Max", 3)).toBe("Brenda for Mac hasn't opened it yet. Check it's running and signed in, or choose Set up Max on this Mac… from its icon in the menu bar.");
    expect(setupWords({ kind: "timeout" }, "Max", 3)).toBe(W.setup.timeout("Max", 3));
  });
  it("offers Turn off only when something may be on", () => {
    const off: MacState = with_({ look: { on: false, permission: "granted" }, mac: { on: false, accessibility: "unknown" }, files: { on: false, finder: "unknown", folders: null } });
    const rep = (state: MacState, at = "2026-10-12T10:00:00Z"): MacReport => ({ device: "Jerry's MacBook Pro", lastSeenAt: at, reportedAt: at, setupSeenAt: null, state });
    expect(nothingToTurnOff({ macReady: true, macs: [rep(off)], linked: [] })).toBe(true);
    expect(nothingToTurnOff({ macReady: true, macs: [rep(off), rep(allOn)], linked: [] })).toBe(false);
    expect(nothingToTurnOff({ macReady: true, macs: [rep(off)], linked: [{ device: "Old Mac", lastSeenAt: null }] })).toBe(false);
    expect(nothingToTurnOff({ macReady: true, macs: [], linked: [] })).toBe(false);
    expect(nothingToTurnOff({ macReady: false, macs: [], linked: [] })).toBe(false);
    expect(newestBinary({ macs: [rep({ ...off, binary: 2 }, "2026-10-12T09:00:00Z"), rep({ ...allOn, binary: 3 }, "2026-10-12T10:00:00Z")] })).toBe(3);
    expect(newestBinary({ macs: [] })).toBeNull();
  });
});

describe("checkedWords", () => {
  const now = Date.parse("2026-10-12T10:30:00Z");
  it("just now, minutes, today at, on a day, another year", () => {
    expect(checkedWords("2026-10-12T10:29:30Z", now, "UTC")).toBe("just now");
    expect(checkedWords("2026-10-12T10:31:00Z", now, "UTC")).toBe("just now"); // a clock a little ahead
    expect(checkedWords("2026-10-12T10:29:00Z", now, "UTC")).toBe("1 minute ago");
    expect(checkedWords("2026-10-12T10:28:00Z", now, "UTC")).toBe("2 minutes ago");
    expect(checkedWords("2026-10-12T09:14:00Z", now, "UTC")).toBe("today at 09:14");
    expect(checkedWords("2026-10-10T16:00:00Z", now, "UTC")).toBe("on 10 October");
    expect(checkedWords("2025-10-10T16:00:00Z", now, "UTC")).toBe("on 10 October 2025");
    expect(checkedWords("not a date", now, "UTC")).toBe("just now");
  });
  it("reads the day in the workspace's time zone", () => {
    // 23:30 UTC on 11 October is 00:30 on 12 October in Lagos.
    expect(checkedWords("2026-10-11T23:30:00Z", now, "Africa/Lagos")).toBe("today at 00:30");
    expect(checkedWords("2026-10-11T23:30:00Z", now, "UTC")).toBe("on 11 October");
  });
});

describe("setupStatus (contract L.2)", () => {
  const pressed = Date.parse("2026-10-12T10:00:00Z");
  const setupAt = "2026-10-12T10:00:00.123Z";
  const report = (o: Partial<MacReport> = {}): MacReport => ({ device: "Jerry's MacBook Pro", lastSeenAt: null, reportedAt: "2026-10-12T09:00:00Z", state: allOn, setupSeenAt: null, ...o });
  const mine = (macs: MacReport[], at: string | null = setupAt): Pick<ScreenHelpMine, "setupAt" | "macs"> => ({ setupAt: at, macs });

  it("idle until pressed, or without a setup time", () => {
    expect(setupStatus(mine([report()]), null, pressed)).toEqual({ kind: "idle" });
    expect(setupStatus(mine([report()], null), pressed, pressed)).toEqual({ kind: "idle" });
    expect(setupWords({ kind: "idle" }, "Max")).toBe("");
  });
  it("waiting, then timeout after two minutes; polling stops after five", () => {
    const w = setupStatus(mine([report()]), pressed, pressed + 5_000);
    expect(w).toEqual({ kind: "waiting" });
    expect(setupWords(w, "Max")).toBe("Open Brenda for Mac on your Mac. The setup opens there within a minute.");
    const t = setupStatus(mine([report()]), pressed, pressed + SETUP_WAIT_MS);
    expect(t).toEqual({ kind: "timeout" });
    expect(setupWords(t, "Max", 3)).toBe("Brenda for Mac hasn't opened it yet. Check it's running and signed in, or choose Set up Max on this Mac… from its icon in the menu bar.");
    expect(setupPolling(w, pressed, pressed + 5_000)).toBe(true);
    expect(setupPolling(t, pressed, pressed + SETUP_WAIT_MS)).toBe(true); // a late open still shows
    expect(setupPolling(t, pressed, pressed + SETUP_POLL_FOR_MS)).toBe(false);
  });
  it("a setupSeenAt from an older press is not this one", () => {
    expect(setupStatus(mine([report({ setupSeenAt: "2026-10-12T09:50:00Z", reportedAt: "2026-10-12T10:00:30Z" })]), pressed, pressed + 30_000)).toEqual({ kind: "waiting" });
  });
  it("open once a Mac reports the press (the same instant, whatever the ISO spelling)", () => {
    const seen = report({ setupSeenAt: "2026-10-12T10:00:00.123+00:00", reportedAt: "2026-10-12T10:00:40Z" });
    const s = setupStatus(mine([report({ device: "Studio" }), seen]), pressed, pressed + 45_000);
    expect(s).toEqual({ kind: "open", device: "Jerry's MacBook Pro", reportedAt: "2026-10-12T10:00:40Z" });
    expect(setupWords(s, "Max")).toBe("The setup is open on Jerry's MacBook Pro. Finish it there.");
    // Even after two minutes: it opened.
    expect(setupStatus(mine([seen]), pressed, pressed + 3 * 60_000).kind).toBe("open");
  });
  it("the report that says it opened is not done, even with seeing already on", () => {
    const seen = report({ setupSeenAt: setupAt, reportedAt: "2026-10-12T10:00:40Z" });
    expect(setupStatus(mine([seen]), pressed, pressed + 45_000, null).kind).toBe("open");
    expect(setupStatus(mine([seen]), pressed, pressed + 45_000, { device: seen.device, reportedAt: seen.reportedAt }).kind).toBe("open");
  });
  it("done once that Mac reports again with seeing on", () => {
    const opened = { device: "Jerry's MacBook Pro", reportedAt: "2026-10-12T10:00:40Z" };
    const later = report({ setupSeenAt: setupAt, reportedAt: "2026-10-12T10:01:30Z" });
    const s = setupStatus(mine([later]), pressed, pressed + 95_000, opened);
    expect(s).toEqual({ kind: "done", device: "Jerry's MacBook Pro" });
    expect(setupWords(s, "Max")).toBe("Done on Jerry's MacBook Pro.");
    expect(setupPolling(s, pressed, pressed + 95_000)).toBe(false);
    // Not on yet (they pressed Not now, or untucked without turning seeing on): still open.
    const notOn = report({ setupSeenAt: setupAt, reportedAt: "2026-10-12T10:01:30Z", state: with_({ look: { on: false, permission: "unknown" } }) });
    expect(setupStatus(mine([notOn]), pressed, pressed + 95_000, opened).kind).toBe("open");
  });
});

describe("the card (screen-help-settings.tsx)", () => {
  const src = readFileSync(join(__dirname, "../../src/components/app/screen-help-settings.tsx"), "utf8");
  const card = src.slice(src.indexOf("export function ScreenHelpMySettings"));
  it("Set up is the white primary; Turn off is the quiet danger outline behind a confirm; no orange", () => {
    expect(card).toMatch(/<Button size="sm" variant="primary"[^>]*onClick=\{\(\) => void setUp\(\)\}/);
    expect(card).toContain('<ConfirmButton variant="danger" size="sm" tone="danger"');
    expect(card).toContain("title={MAC_HELP_WORDS.off.title}");
    expect(card).not.toMatch(/variant="accent"|bg-accent|text-accent/);
    // The old one-press "Turn off on my Macs" button is gone.
    expect(card).not.toContain("W.personal.turnOff");
  });
  it("Set up only records the press; Turn off sends off; the status line is polite", () => {
    expect(card).toContain("body: { setup: true }");
    expect(card).toContain("body: { off: true }");
    expect(card).toContain('aria-live="polite"');
    expect(card).toContain('target="settings-screen-help-mine"');
  });
});
