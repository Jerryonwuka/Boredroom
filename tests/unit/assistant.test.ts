import { describe, it, expect } from "vitest";
import { planBuiltin, matchPerson, cleanTitle } from "@/server/services/assistant";
import { encryptSecret, decryptSecret } from "@/server/lib/crypto";

const people = [{ id: "p-ada", display_name: "Ada Okafor" }, { id: "p-ben", display_name: "Ben Musa" }];
const opts = { people, today: "2026-09-09", timezone: "Europe/London" }; // a Wednesday

describe("built-in to-do assistant", () => {
  it("splits a spoken note into to-dos and cleans lead-ins", () => {
    const items = planBuiltin("Okay so I need to finish the logo export, then update the brand deck. Also reply to the client email.", { ...opts, people: [] });
    expect(items.map((i) => i.title)).toEqual(["Finish the logo export", "Update the brand deck", "Reply to the client email"]);
    expect(items.every((i) => i.assigneeMembershipId === null)).toBe(true);
  });
  it("reads deadlines, times and estimates", () => {
    const items = planBuiltin("Send the invoice by Friday at 3pm (about 2 hours)\nWrite the release notes tomorrow", { ...opts, people: [] });
    expect(items[0].title).toBe("Send the invoice");
    expect(items[0].estimateMinutes).toBe(120);
    expect(items[0].dueAt).toBe(new Date("2026-09-11T15:00:00+01:00").toISOString());
    expect(items[1].title).toBe("Write the release notes");
    expect(items[1].dueAt).toBe(new Date("2026-09-10T17:00:00+01:00").toISOString());
  });
  it("hands items to named team members for leads and flags unknown names", () => {
    const items = planBuiltin("Ask Ada to redo the homepage banner by Monday. Ben should fix the checkout bug. Get Chidi to test the app. Prepare the sprint review.", opts);
    expect(items[0]).toMatchObject({ title: "Redo the homepage banner", assigneeMembershipId: "p-ada", assigneeName: "Ada Okafor" });
    expect(items[0].dueAt).toBe(new Date("2026-09-14T17:00:00+01:00").toISOString());
    expect(items[1]).toMatchObject({ title: "Fix the checkout bug", assigneeMembershipId: "p-ben" });
    expect(items[2]).toMatchObject({ title: "Test the app", assigneeMembershipId: null, unmatchedAssignee: "Chidi" });
    expect(items[3]).toMatchObject({ title: "Prepare the sprint review", assigneeMembershipId: null });
  });
  it("matches first names uniquely", () => {
    expect(matchPerson("ada", people)?.id).toBe("p-ada");
    expect(matchPerson("Ben Musa", people)?.id).toBe("p-ben");
    expect(matchPerson("Zed", people)).toBeNull();
    expect(cleanTitle("i'm going to  call the printer.")).toBe("Call the printer");
  });
});

describe("secrets at rest", () => {
  it("round-trips and rejects tampering", () => {
    const enc = encryptSecret("sk-ant-example-key");
    expect(enc).not.toContain("sk-ant");
    expect(decryptSecret(enc)).toBe("sk-ant-example-key");
    expect(decryptSecret(enc.slice(0, -2) + "zz")).toBeNull();
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
});
