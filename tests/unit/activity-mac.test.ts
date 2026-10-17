import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAC_WORDS, canForget, isMacItem, macMeta, macState, macVia, taskIdOf } from "@/components/app/assistant-activity";
import { ACTIONS_WORDS } from "@/components/app/screen-help-settings";
import { ACT_WORDS } from "@/lib/act";

// "What Max did" on your Mac (owner request and permission rule, 12 October 2026: "Brenda cannot take any action except I
// explicitly give an instruction … do you want me to do this? And then I'll say, yes"; contract D.11, E.5, E.6, E.7). The
// web's pure helpers for the rows of tasks and file jobs Brenda for Mac did after the person's yes, and the exact words.

const ID = "3f2a0c4e-8b1d-4c6e-9a7f-0123456789ab";
const row = (over: Record<string, unknown> = {}) => ({
  id: `task:${ID}`, tool: "mac_screen", source: "mac", outcome: "done", summary: "Renamed 6 files in Finder.", href: null, createdAt: "2026-10-12T13:02:00.000Z",
  ...over,
});

describe("which rows are the Mac's", () => {
  it("is a Mac row only with source mac", () => {
    expect(isMacItem(row())).toBe(true);
    expect(isMacItem(row({ source: "chat" }))).toBe(false);
    expect(isMacItem(row({ source: "read" }))).toBe(false);
  });
  it("takes the task's id from task:<uuid> only", () => {
    expect(taskIdOf(`task:${ID}`)).toBe(ID);
    expect(taskIdOf(ID)).toBeNull();
    expect(taskIdOf("task:")).toBeNull();
    expect(taskIdOf(`task:${ID}/../x`)).toBeNull();
    expect(taskIdOf(`task:${ID}?x=1`)).toBeNull();
    expect(taskIdOf(`read:${ID}`)).toBeNull();
  });
});

describe("how the yes was given", () => {
  it("reads via at the top level or in detail", () => {
    expect(macVia(row({ via: "button" }))).toBe("button");
    expect(macVia(row({ detail: { via: "voice" } }))).toBe("voice");
    expect(macVia(row({ via: null, detail: { via: "typed" } }))).toBe("typed");
  });
  it("is nothing for anything else", () => {
    expect(macVia(row())).toBeNull();
    expect(macVia(row({ via: "timeout" }))).toBeNull();
    expect(macVia(row({ detail: { via: "esc" } }))).toBeNull();
    expect(macVia(row({ detail: "voice" }))).toBeNull();
  });
});

describe("where a task stands", () => {
  it("is live while it runs", () => {
    expect(macState(row({ summary: "In progress: I'll rename these 6 files.", outcome: "done" }))).toBe("live");
    expect(macState(row({ live: true }))).toBe("live");
    expect(macState(row({ detail: { live: true } }))).toBe("live");
  });
  it("is done, ended (no, no answer, stopped) or failed", () => {
    expect(macState(row())).toBe("done");
    expect(macState(row({ outcome: "refused", summary: "You said no: I'll rename these 6 files." }))).toBe("ended");
    expect(macState(row({ outcome: "refused", summary: "Stopped: I'll rename these 6 files." }))).toBe("ended");
    expect(macState(row({ outcome: "failed", summary: "Couldn't finish: I'll rename these 6 files." }))).toBe("failed");
  });
});

describe("the meta line (contract E.6)", () => {
  it("says how the yes was given", () => {
    expect(macMeta(row({ via: "button" }))).toBe("on your Mac, you pressed Yes");
    expect(macMeta(row({ detail: { via: "voice" } }))).toBe("on your Mac, you said yes");
    expect(macMeta(row({ via: "typed" }))).toBe("on your Mac, you typed yes");
  });
  it("says no answer for a proposal nobody answered", () => {
    expect(macMeta(row({ outcome: "refused", summary: "No answer: I'll rename these 6 files." }))).toBe("on your Mac, no answer");
  });
  it("says in progress while it runs, whatever the yes", () => {
    expect(macMeta(row({ via: "button", summary: "In progress: I'll rename these 6 files." }))).toBe("on your Mac, in progress");
  });
  it("says only where for a no", () => {
    expect(macMeta(row({ outcome: "refused", summary: "You said no: I'll rename these 6 files." }))).toBe("on your Mac");
  });
});

describe("Forget", () => {
  it("is offered on the person's own ended Mac rows", () => {
    expect(canForget(row(), false)).toBe(true);
    expect(canForget(row({ outcome: "refused", summary: "You said no: I'll do it." }), false)).toBe(true);
    expect(canForget(row({ outcome: "failed" }), false)).toBe(true);
  });
  it("is not offered while it runs, while someone is signed in as them, or on other rows", () => {
    expect(canForget(row({ summary: "In progress: I'll do it." }), false)).toBe(false);
    expect(canForget(row(), true)).toBe(false);
    expect(canForget(row({ source: "chat" }), false)).toBe(false);
    expect(canForget(row({ id: ID }), false)).toBe(false);
  });
});

describe("the words", () => {
  it("are the contract's (E.6)", () => {
    expect(MAC_WORDS.tab).toBe("On your Mac");
    expect(MAC_WORDS.forget).toBe("Forget");
    expect(MAC_WORDS.forgotten).toBe("Forgotten.");
    expect(MAC_WORDS.pageNote("Max")).toBe("What you asked Max to do on your Mac, and what Max did, shows only here, only to you, for 30 days. Pictures, file contents and where your files are are never kept.");
  });
  it("are the contract's for the workspace switch (E.5)", () => {
    expect(ACTIONS_WORDS.title).toBe("On-screen actions and file work");
    expect(ACTIONS_WORDS.description).toBe("When a person turns it on in Brenda for Mac, Brenda can click and type in their apps, or make a new file from one they give her, only when they ask and say yes to exactly what she'll do. It works only where screen help is allowed. You can switch it off for everyone. You can't see who uses it, when, or what Brenda did, and nobody at Boredroom can either.");
    expect(ACTIONS_WORDS.switchedOff).toBe("Your workspace has switched off on-screen actions and file work.");
    expect(ACTIONS_WORDS.notReady).toBe("This needs a database update first.");
  });
  it("name the person's assistant on the Mac's switches (A.11), never Brenda beside another name", () => {
    const max = ACTIONS_WORDS.onMac.switches("Max").map((s) => `${s.title} ${s.hint}`).join(" ");
    expect(max).toContain("Show Max by my pointer");
    expect(max).toContain("Let Max use my Mac");
    expect(max).toContain("Let Max work on files");
    expect(max).not.toMatch(/Brenda|\bshe\b|\bher\b/);
    expect(ACTIONS_WORDS.onMac.switches("Brenda")[3].hint).toBe("Makes a new file from one you give her, when you ask and say yes.");
  });
  it("are the shared words, which the activity page reads from lib/act (never from the client component)", () => {
    expect(MAC_WORDS.tab).toBe(ACT_WORDS.activity.filter);
    expect(MAC_WORDS.pageNote("Max")).toBe(ACT_WORDS.activity.note("Max"));
    expect(MAC_WORDS.forgetLabel("Renamed 6 files.")).toBe("Forget: Renamed 6 files.");
    const page = readFileSync(join(__dirname, "../../src/app/app/[workspace]/home/activity/page.tsx"), "utf8");
    expect(page).toContain("mac: MAC_ACT_WORDS.activity.filter");
    expect(page).toContain("MAC_ACT_WORDS.activity.note(name)");
    expect(page).not.toMatch(/import \{[^}]*MAC_WORDS[^}]*\} from "@\/components\/app\/assistant-activity"/);
  });
});

describe("the copy says only when you ask, and only after you say yes (contract E.7)", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
  it("on the profile", () => {
    expect(read("src/app/app/[workspace]/profile/page.tsx")).toContain("never uses your mouse, keyboard or files unless you ask Brenda and say yes");
  });
  it("on the landing page", () => {
    const landing = read("src/app/page.tsx");
    expect(landing).toContain("Brenda for Mac sees your screen only when you press her keys, does things on it only when you ask and say yes");
    expect(landing).not.toContain("looks at a window only when you ask");
  });
  it("in her chat", () => {
    const chat = read("src/components/app/brenda-chat.tsx");
    expect(chat).toContain("looked at your screen ({m.look.app})");
    expect(chat).not.toContain("looked at a window ({m.look.app})");
  });
});
