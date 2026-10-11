/**
 * The first-run welcome's shared rules and words (owner request, 11 October 2026): each role's steps and rail, the step
 * labels and moves, where the page opens (resume, replay, a foreign step), each role's first action and its address,
 * the pitch and the fairness lists for each role, and the house rules on the words (no middle-dot meta lines, no arrows,
 * never "she" or "her" for an assistant's name).
 */
import { describe, expect, it } from "vitest";
import {
  COUNTED_STEPS, WELCOME_AUTO_SHOWS, WELCOME_NOT_READY, WELCOME_WORDS, bringsTeam, fairnessFor, firstActionFor, firstNameOf, initialStepFor,
  isCountedStep, isWelcomeStep, nextStep, passedSeen, pitchFor, previousStep, railFor, stepLabel, stepsFor,
  type CountedStep, type FirstActionInput, type WelcomeRole, type WelcomeState,
} from "@/lib/welcome";

const ROLES: WelcomeRole[] = ["owner", "hr", "manager", "employee"];

describe("stepsFor", () => {
  it("gives owners and HR the Team step, and staff and leads none", () => {
    expect(stepsFor({ role: "owner", youDone: false, aiPlan: true, replay: false })).toEqual(["you", "assistant", "how", "seen", "team"]);
    expect(stepsFor({ role: "hr", youDone: false, aiPlan: true, replay: false })).toEqual(["you", "assistant", "how", "seen", "team"]);
    expect(stepsFor({ role: "manager", youDone: false, aiPlan: true, replay: false })).toEqual(["you", "assistant", "how", "seen"]);
    expect(stepsFor({ role: "employee", youDone: false, aiPlan: true, replay: false })).toEqual(["you", "assistant", "how", "seen"]);
  });

  it("leaves out You once it was done in another workspace, and How it helps without the assistant in the plan", () => {
    expect(stepsFor({ role: "employee", youDone: true, aiPlan: true, replay: false })).toEqual(["assistant", "how", "seen"]);
    expect(stepsFor({ role: "employee", youDone: false, aiPlan: false, replay: false })).toEqual(["you", "assistant", "seen"]);
    expect(stepsFor({ role: "hr", youDone: true, aiPlan: false, replay: false })).toEqual(["assistant", "seen", "team"]);
  });

  it("in a replay has You again and never Team", () => {
    expect(stepsFor({ role: "owner", youDone: true, aiPlan: true, replay: true })).toEqual(["you", "assistant", "how", "seen"]);
    expect(stepsFor({ role: "employee", youDone: true, aiPlan: false, replay: true })).toEqual(["you", "assistant", "seen"]);
  });

  it("only ever holds counted steps, each once", () => {
    for (const role of ROLES) for (const youDone of [true, false]) for (const aiPlan of [true, false]) for (const replay of [true, false]) {
      const s = stepsFor({ role, youDone, aiPlan, replay });
      expect(s.every(isCountedStep)).toBe(true);
      expect(new Set(s).size).toBe(s.length);
      expect(s).toEqual([...s].sort((a, b) => COUNTED_STEPS.indexOf(a) - COUNTED_STEPS.indexOf(b)));
    }
  });

  it("knows who brings their team", () => {
    expect(ROLES.filter(bringsTeam)).toEqual(["owner", "hr"]);
  });
});

describe("railFor", () => {
  it("gives a founder a head start of Account and Workspace", () => {
    expect(railFor({ role: "owner", youDone: false, aiPlan: true, founder: true, replay: false })).toEqual([
      { key: "account", label: "Account", pre: true },
      { key: "workspace", label: "Workspace", pre: true },
      { key: "you", label: "You", pre: false },
      { key: "assistant", label: "Assistant", pre: false },
      { key: "how", label: "How it helps", pre: false },
      { key: "seen", label: "What's seen", pre: false },
      { key: "team", label: "Team", pre: false },
      { key: "done", label: "All set", pre: false },
    ]);
  });

  it("shows You as already done from the profile in a second workspace", () => {
    expect(railFor({ role: "employee", youDone: true, aiPlan: true, founder: false, replay: false }).map((r) => [r.key, r.pre])).toEqual([
      ["account", true], ["you", true], ["assistant", false], ["how", false], ["seen", false], ["done", false],
    ]);
  });

  it("has no Workspace segment for someone invited, and none in a replay", () => {
    expect(railFor({ role: "hr", youDone: false, aiPlan: true, founder: false, replay: false }).map((r) => r.key)).toEqual(["account", "you", "assistant", "how", "seen", "team", "done"]);
    expect(railFor({ role: "owner", youDone: true, aiPlan: true, founder: true, replay: true }).map((r) => r.key)).toEqual(["account", "you", "assistant", "how", "seen", "done"]);
  });
});

describe("step labels and moves", () => {
  const steps: CountedStep[] = ["you", "assistant", "how", "seen"];

  it("labels counted steps only", () => {
    expect(stepLabel("you", steps)).toBe("Step 1 of 4");
    expect(stepLabel("seen", steps)).toBe("Step 4 of 4");
    expect(stepLabel("welcome", steps)).toBeNull();
    expect(stepLabel("done", steps)).toBeNull();
    expect(stepLabel("team", steps)).toBeNull();
  });

  it("moves forward from the welcome through each step to done", () => {
    expect(nextStep("welcome", steps)).toBe("you");
    expect(nextStep("you", steps)).toBe("assistant");
    expect(nextStep("seen", steps)).toBe("done");
    expect(nextStep("done", steps)).toBe("done");
    expect(nextStep("team", steps)).toBe("done");
    expect(nextStep("welcome", [])).toBe("done");
  });

  it("moves back to the welcome before the first step", () => {
    expect(previousStep("done", steps)).toBe("seen");
    expect(previousStep("assistant", steps)).toBe("you");
    expect(previousStep("you", steps)).toBe("welcome");
    expect(previousStep("welcome", steps)).toBe("welcome");
    expect(previousStep("team", steps)).toBe("welcome");
    expect(previousStep("done", [])).toBe("welcome");
  });
});

describe("initialStepFor", () => {
  const steps: CountedStep[] = ["you", "assistant", "how", "seen"];

  it("opens the step the address names when it is one of this person's", () => {
    expect(initialStepFor({ requested: "how", saved: "assistant", steps, replay: false })).toBe("how");
    expect(initialStepFor({ requested: "welcome", saved: "assistant", steps, replay: false })).toBe("welcome");
  });

  it("ignores a foreign or unknown step in the address, and done outside a replay", () => {
    expect(initialStepFor({ requested: "team", saved: null, steps, replay: false })).toBe("welcome");
    expect(initialStepFor({ requested: "nope", saved: "seen", steps, replay: false })).toBe("seen");
    expect(initialStepFor({ requested: ["how"], saved: null, steps, replay: false })).toBe("welcome");
    expect(initialStepFor({ requested: "done", saved: "how", steps, replay: false })).toBe("how");
  });

  it("resumes the saved step outside a replay", () => {
    expect(initialStepFor({ requested: undefined, saved: "assistant", steps, replay: false })).toBe("assistant");
    expect(initialStepFor({ requested: undefined, saved: null, steps, replay: false })).toBe("welcome");
    expect(initialStepFor({ requested: undefined, saved: "done", steps, replay: false })).toBe("welcome");
  });

  it("opens the next step they have when the saved one is no longer theirs, or their last", () => {
    expect(initialStepFor({ requested: undefined, saved: "you", steps: ["assistant", "how", "seen"], replay: false })).toBe("assistant");
    expect(initialStepFor({ requested: undefined, saved: "how", steps: ["you", "assistant", "seen"], replay: false })).toBe("seen");
    expect(initialStepFor({ requested: undefined, saved: "team", steps, replay: false })).toBe("seen");
  });

  it("starts a replay at the welcome, and allows done in one", () => {
    expect(initialStepFor({ requested: undefined, saved: "seen", steps, replay: true })).toBe("welcome");
    expect(initialStepFor({ requested: "done", saved: null, steps, replay: true })).toBe("done");
    expect(initialStepFor({ requested: "how", saved: null, steps, replay: true })).toBe("how");
  });
});

describe("firstActionFor", () => {
  const base: FirstActionInput = { slug: "acme", role: "employee", assistantName: "Max", leadsTeam: null, aiReady: true, invited: false, teams: 0, ownerFirstName: "Olu" };
  const design = { id: "11111111-1111-4111-8111-111111111111", name: "Design" };

  it("asks owners and HR to invite their team first, then to create a team, then opens the dashboard", () => {
    expect(firstActionFor({ ...base, role: "owner" })).toMatchObject({ key: "invite_team", label: "Invite your team", href: "/app/acme/people?tab=people&invite=1", note: null });
    expect(firstActionFor({ ...base, role: "hr", invited: true, teams: 0 })).toMatchObject({ key: "create_team", label: "Create your first team", href: "/app/acme/people?tab=teams&new=team" });
    expect(firstActionFor({ ...base, role: "owner", invited: true, teams: 2 })).toMatchObject({ key: "open_dashboard", label: "Open the dashboard", href: "/app/acme/dashboard" });
  });

  it("has a team's lead assign a first task, in the assistant's box when the AI is ready, else on the board", () => {
    const ai = firstActionFor({ ...base, role: "manager", leadsTeam: design });
    expect(ai).toMatchObject({ key: "assign_task", label: "Assign a first task", href: "/app/acme/home?ask=Assign%20a%20task%20to%20", note: null });
    expect(ai.hint).toBe(WELCOME_WORDS.firstAction.assignTask.hintAi("Max"));
    const board = firstActionFor({ ...base, role: "manager", leadsTeam: design, aiReady: false });
    expect(board).toMatchObject({ key: "assign_task", href: `/app/acme/teams/${design.id}` });
    expect(board.hint).toBe("On Design's board, press New task and choose who does it.");
  });

  it("has staff, and a lead with no team yet, plan today on To-dos with the new row open", () => {
    expect(firstActionFor(base)).toMatchObject({ key: "plan_today", label: "Write today's to-dos", href: "/app/acme/todos?add=1", note: null });
    expect(firstActionFor({ ...base, role: "manager" }).note).toBe("When Olu makes you a team's lead, your team's board appears in the menu.");
    expect(firstActionFor({ ...base, role: "manager", ownerFirstName: null }).note).toBe("When an owner makes you a team's lead, your team's board appears in the menu.");
    expect(firstActionFor({ ...base, role: "employee", leadsTeam: design }).key).toBe("plan_today");
  });

  it("never says My Day on the button", () => {
    for (const role of ROLES) expect(firstActionFor({ ...base, role }).label).not.toMatch(/my day/i);
  });
});

describe("pitchFor", () => {
  const o = { org: "Acme", first: "Ada", founder: false, assistantName: "Max", leadFirstName: "Tolu", aiPlan: true };

  it("welcomes a founder to the workspace they made, and everyone else to theirs", () => {
    expect(pitchFor({ ...o, role: "owner", first: "Olu", founder: true }).title).toBe("Acme is ready, Olu");
    expect(pitchFor({ ...o, role: "hr", first: "Mary" }).title).toBe("Welcome to Acme, Mary");
  });

  it("gives owners and HR three beats, and staff and leads a fourth: the fairness promise", () => {
    for (const aiPlan of [true, false]) {
      for (const role of ["owner", "hr"] as const) expect(pitchFor({ ...o, role, aiPlan }).beats).toHaveLength(3);
      for (const role of ["employee", "manager"] as const) expect(pitchFor({ ...o, role, aiPlan }).beats).toHaveLength(4);
    }
  });

  it("tells everyone it is fair by design: no score, no ranking, no screen or call recording", () => {
    for (const role of ROLES) {
      const fair = pitchFor({ ...o, role }).beats.find((b) => b.icon === "fair");
      expect(fair?.title).toBe("Fair by design");
      expect(fair?.line).toMatch(/productivity score/);
      expect(fair?.line).toMatch(/screen or call recording/);
    }
  });

  it("names the staff member's lead, and never promises one they don't have", () => {
    expect(pitchFor({ ...o, role: "employee" }).beats[2].line).toBe("When something's stuck, Tolu, your team lead, sees it and can step in.");
    expect(pitchFor({ ...o, role: "employee", leadFirstName: null }).beats[2].line)
      .toBe("When something's stuck, HR and the owner can see it and step in. So will your team lead, once you're in a team.");
  });

  it("swaps the assistant's beats for true ones when the plan has no assistant", () => {
    expect(pitchFor({ ...o, role: "employee" }).beats.map((b) => b.icon)).toEqual(["day", "chase", "help", "fair"]);
    expect(pitchFor({ ...o, role: "employee", aiPlan: false }).beats.map((b) => b.icon)).toEqual(["day", "talk", "help", "fair"]);
    expect(pitchFor({ ...o, role: "manager" }).beats[1].line).toContain("Tell Max what needs doing");
    expect(pitchFor({ ...o, role: "manager", aiPlan: false }).beats.map((b) => b.line).join(" ")).not.toContain("Max");
    expect(pitchFor({ ...o, role: "owner" }).beats.map((b) => b.icon)).toEqual(["glance", "assistants", "fair"]);
    expect(pitchFor({ ...o, role: "owner", aiPlan: false }).beats.map((b) => b.icon)).toEqual(["glance", "messages", "fair"]);
    expect(pitchFor({ ...o, role: "hr" }).beats.map((b) => b.icon)).toEqual(["people", "assistants", "fair"]);
  });

  it("speaks to supervisors about their team too", () => {
    expect(pitchFor({ ...o, role: "owner" }).lede).toMatch(/for you and your team\.$/);
    expect(pitchFor({ ...o, role: "employee" }).lede).toMatch(/what it does for you\.$/);
  });
});

describe("fairnessFor", () => {
  it("tells owners and HR what they will and won't see, five and five", () => {
    for (const role of ["owner", "hr"] as const) {
      const f = fairnessFor({ role, org: "Acme", assistantName: "Max", hasLead: true });
      expect(f.title).toBe("What you'll see about your team, and what you won't");
      expect(f.lede).toBe(WELCOME_WORDS.seen.ledeSupervisor);
      expect(f.seenHeading).toBe("You can see");
      expect(f.neverHeading).toBe("Nobody sees, you included");
      expect(f.seen).toHaveLength(5);
      expect(f.never).toHaveLength(5);
    }
  });

  it("tells staff and leads what the workspace sees about them, five and five", () => {
    const staff = fairnessFor({ role: "employee", org: "Acme", assistantName: "Max", hasLead: true });
    expect(staff.title).toBe("What Acme sees, and what it doesn't");
    expect(staff.lede).toBe(WELCOME_WORDS.seen.ledeStaff);
    expect(staff.seen).toHaveLength(5);
    expect(staff.never).toHaveLength(5);
    expect(staff.never.map((n) => n.strong)).toContain("What you say to Max");
    expect(staff.seen.join(" ")).toContain("what Max did for you");
    expect(fairnessFor({ role: "employee", org: "Acme", assistantName: "Max", hasLead: false }).lede).toBe(WELCOME_WORDS.seen.ledeStaffNoLead);
    // Direct messages and calls are seen by the people in them: "nobody else", and said so.
    expect(staff.neverHeading).toBe("Nobody else sees");
    expect(staff.never.find((n) => n.strong === "Your direct messages.")?.rest).toBe("Only the people in them.");
    expect(staff.never.find((n) => n.strong === "Your calls.")?.rest).toMatch(/^Only the people on them hear them\./);
    // Presence is every colleague's: its own line, not in the lead, HR and owner's list.
    expect(staff.seen.join(" ")).not.toMatch(/on a call/);
    expect(staff.colleagues).toBe("Colleagues see whether you're online or on a call, never which call.");
    expect(fairnessFor({ role: "owner", org: "Acme", assistantName: "Max", hasLead: true }).colleagues).toBeNull();
    expect(fairnessFor({ role: "manager", org: "Acme", assistantName: "Max", hasLead: false }).lede).toBe(WELCOME_WORDS.seen.ledeLead);
  });

  it("promises no score, no ranking and no screen or call recording, for everyone", () => {
    for (const role of ROLES) {
      const never = fairnessFor({ role, org: "Acme", assistantName: "Max", hasLead: true }).never.map((n) => `${n.strong} ${n.rest ?? ""}`).join(" ");
      expect(never).toMatch(/screen/i);
      expect(never).toMatch(/never recorded/);
      expect(never).toMatch(/productivity score/);
    }
  });
});

describe("state helpers", () => {
  const s = (o: Partial<WelcomeState>): WelcomeState => ({ ...WELCOME_NOT_READY, ready: true, ...o });

  it("counts the notice as reviewed once someone went through What's seen", () => {
    expect(passedSeen(s({ outcome: "done", done: true }))).toBe(true);
    expect(passedSeen(s({ step: "team" }))).toBe(true);
    expect(passedSeen(s({ step: "seen" }))).toBe(false);
    expect(passedSeen(s({ outcome: "skipped", done: true, step: "done" }))).toBe(false);
    expect(passedSeen(s({ outcome: "existing", done: true }))).toBe(false);
    expect(passedSeen({ ...WELCOME_NOT_READY, outcome: "done" })).toBe(false);
  });

  it("takes the first word of a name", () => {
    expect(firstNameOf("Ada Obi")).toBe("Ada");
    expect(firstNameOf("  Olu   Adeyemi ")).toBe("Olu");
    expect(firstNameOf("Tolu")).toBe("Tolu");
    expect(firstNameOf("")).toBe("");
  });

  it("knows its screens and steps", () => {
    expect(isWelcomeStep("done")).toBe(true);
    expect(isWelcomeStep("brenda")).toBe(false);
    expect(isCountedStep("welcome")).toBe(false);
    expect(isCountedStep("team")).toBe(true);
    expect(WELCOME_AUTO_SHOWS).toBe(2);
  });
});

/** Every fixed word: the strings, and what each function returns with placeholders. */
function allWords(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const arg = new Proxy({}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => "NAME" : "NAME") });
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") out.push({ path, text: v });
    else if (typeof v === "function") {
      const fn = v as (...a: unknown[]) => unknown;
      let r: unknown;
      try { r = fn(...Array.from({ length: Math.max(fn.length, 1) }, () => "NAME")); } catch { r = fn(...Array.from({ length: Math.max(fn.length, 1) }, () => arg)); }
      walk(r, `${path}()`);
    } else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(WELCOME_WORDS, "WELCOME_WORDS");
  for (const role of ROLES) for (const aiPlan of [true, false]) {
    const p = pitchFor({ role, org: "NAME", first: "NAME", founder: role === "owner", assistantName: "NAME", leadFirstName: "NAME", aiPlan });
    walk(p, `pitchFor(${role},${aiPlan})`);
    walk(fairnessFor({ role, org: "NAME", assistantName: "NAME", hasLead: aiPlan }), `fairnessFor(${role})`);
  }
  return out;
}

describe("the words", () => {
  const words = allWords();

  it("are all there", () => {
    expect(words.length).toBeGreaterThan(150);
  });

  it("have no middle-dot meta line except the title suffix", () => {
    expect(words.filter((w) => w.text.includes(" · ") && w.path !== "WELCOME_WORDS.titleSuffix").map((w) => w.path)).toEqual([]);
    expect(WELCOME_WORDS.titleSuffix).toBe(" · Boredroom");
  });

  it("have no arrows", () => {
    expect(words.filter((w) => w.text.includes("→")).map((w) => w.path)).toEqual([]);
  });

  it("never call an assistant she or her", () => {
    expect(words.filter((w) => w.text.includes("NAME") && /\b(she|her|hers|herself)\b/i.test(w.text)).map((w) => `${w.path}: ${w.text}`)).toEqual([]);
  });
});
