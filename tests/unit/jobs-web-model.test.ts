/**
 * The Browser helper's model side (owner decisions, 4 November 2026: phase 2): every call checked before the Mac sees it,
 * and a click, select or Return that sends, pays, deletes, submits, signs in, agrees or downloads asked about alone.
 */
import { describe, expect, it } from "vitest";
import { WEB_TOOLS, WEB_WORDS, checkWebCall, readWebTurn, webFirstMessage, webUrlOk } from "@/server/services/jobs-web-model";
import { webCallSha } from "@/server/services/jobs";
import { WEB_TOOL_NAMES } from "@/lib/front";

const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const errors = (t: ReturnType<typeof readWebTurn>) => (t.kind === "refused" ? t.results.map((r) => String(r.content)) : []);

describe("the tools", () => {
  it("are the protocol's names, strict, in order", () => {
    expect(WEB_TOOLS.map((t) => t.name)).toEqual([...WEB_TOOL_NAMES]);
    expect(WEB_TOOLS.every((t) => t.strict)).toBe(true);
  });
  it("the first message names the request, the job and the Chrome profile, quoted", () => {
    const m = webFirstMessage({ via: "typed", request: "find my invoice", goal: "Find last month's invoice.", profile: "ada@example.com", now: new Date("2026-11-04T10:00:00Z"), timeZone: "Europe/London" });
    const text = JSON.stringify(m.content);
    expect(text).toContain("find my invoice");
    expect(text).toContain("ada@example.com");
    expect(text).toContain("Wednesday 4 November 2026");
  });
});

describe("checking a call", () => {
  it("only http(s) addresses without a user or password", () => {
    expect(webUrlOk("https://dashboard.stripe.com/invoices")).toBe(true);
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", "https://user:pw@example.com", "data:text/html,hi", "https://exa mple.com", 42]) {
      expect(webUrlOk(bad)).toBe(false);
    }
    expect(checkWebCall("open_tab", { url: "file:///x" })).toEqual({ error: WEB_WORDS.badUrl });
  });
  it("tabs and refs by their shape; effects from the list; keys without Return", () => {
    expect(checkWebCall("click", { tab: "t1", ref: "e12", effect: "none" })).toEqual({ ok: { tab: "t1", ref: "e12", effect: "none" } });
    expect(checkWebCall("click", { tab: "1", ref: "e12", effect: "none" })).toEqual({ error: WEB_WORDS.invalid });
    expect(checkWebCall("click", { tab: "t1", ref: "#buy", effect: "none" })).toEqual({ error: WEB_WORDS.invalid });
    expect(checkWebCall("click", { tab: "t1", ref: "e1", effect: "launch" })).toEqual({ error: WEB_WORDS.invalid });
    expect(checkWebCall("press", { tab: "t1", key: "Enter" })).toEqual({ error: WEB_WORDS.invalid });
    expect(checkWebCall("press", { tab: "t1", key: "Escape" })).toEqual({ ok: { tab: "t1", key: "Escape" } });
    expect(checkWebCall("wait_for", { tab: "t1", text: "Paid", seconds: 99 })).toEqual({ ok: { tab: "t1", text: "Paid", seconds: 20 } });
  });
  it("typing without Return can't submit, so its effect is none", () => {
    expect(checkWebCall("type", { tab: "t1", ref: "e3", text: "hello", enter: false, effect: "send" })).toEqual({ ok: { tab: "t1", ref: "e3", text: "hello", enter: false, effect: "none" } });
    expect(checkWebCall("type", { tab: "t1", ref: "e3", text: "", enter: false, effect: "none" })).toHaveProperty("error");
  });
});

describe("a turn", () => {
  it("routine calls run together", () => {
    const t = readWebTurn([use("a", "open_tab", { url: "https://example.com" }), use("b", "read_page", { tab: "t1", find: "" })]);
    expect(t).toMatchObject({ kind: "act", calls: [{ id: "a", name: "open_tab" }, { id: "b", name: "read_page" }] });
  });
  it("a call with an effect is asked about alone, and refused with others", () => {
    expect(readWebTurn([use("a", "click", { tab: "t1", ref: "e9", effect: "pay" })])).toMatchObject({ kind: "ask", effect: "pay", call: { id: "a", name: "click" } });
    const both = readWebTurn([use("a", "read_page", { tab: "t1", find: "" }), use("b", "click", { tab: "t1", ref: "e9", effect: "send" })]);
    expect(both.kind).toBe("refused");
    expect(errors(both)[1]).toContain(WEB_WORDS.askAlone);
  });
  it("finished and cannot_continue come alone", () => {
    expect(readWebTurn([use("a", "finished", { summary: "Found it." })])).toEqual({ kind: "finished", summary: "Found it." });
    expect(readWebTurn([use("a", "finished", { summary: "x" }), use("b", "close_tab", { tab: "t1" })]).kind).toBe("refused");
    expect(readWebTurn([])).toEqual({ kind: "none" });
  });
  it("a yes covers exactly one call: any change to it hashes differently", () => {
    const a = { name: "click", input: { tab: "t1", ref: "e9", effect: "pay" } };
    expect(webCallSha(a)).toBe(webCallSha({ name: "click", input: { effect: "pay", ref: "e9", tab: "t1" } }));
    expect(webCallSha(a)).not.toBe(webCallSha({ name: "click", input: { tab: "t1", ref: "e10", effect: "pay" } }));
  });
});
