/**
 * Wake tags (owner request, 23 October 2026: realtime plan, phase 0, item 6): one word per request that reaches the
 * database, never anything the request carried.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { wakeTag, wakeTagOnce, type WakeTagName } from "@/server/lib/wake-tag";

afterEach(() => vi.restoreAllMocks());

describe("wake tags", () => {
  it("logs the fixed words", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const t of ["auth", "waitlist", "invite", "join", "link", "webhook:slack", "webhook:google_calendar"] as WakeTagName[]) wakeTag(t);
    expect(log.mock.calls.map((c) => c[0])).toEqual(["[wake] auth", "[wake] waitlist", "[wake] invite", "[wake] join", "[wake] link", "[wake] webhook:slack", "[wake] webhook:google_calendar"]);
  });

  it("anything else (an address, an email, a long or odd provider) is logged as 'other'", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    wakeTag("webhook:203.0.113.7 ada@example.com" as WakeTagName);
    wakeTag(`webhook:${"x".repeat(60)}` as WakeTagName);
    wakeTag("auth ada@example.com" as WakeTagName);
    expect(log.mock.calls.map((c) => c[0])).toEqual(["[wake] other", "[wake] other", "[wake] other"]);
  });

  it("wakeTagOnce logs once per request however often it is called", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const touch = wakeTagOnce("webhook:asana");
    touch(); touch(); touch();
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("public routes", () => {
  it("a sign-in with a malformed body is refused before the database, untagged", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { POST } = await import("@/app/api/auth/login/route");
    const bad = await POST(new Request("http://localhost:3000/api/auth/login", { method: "POST", body: JSON.stringify({ email: "nope" }), headers: { "content-type": "application/json" } }), { params: Promise.resolve({}) });
    expect(bad.status).toBe(422);
    expect(log.mock.calls.filter((c) => String(c[0]).startsWith("[wake]"))).toEqual([]);
  });
});
