/**
 * The shared risk classifier (Brenda and her helpers, build 1; permission rule v2, owner, 12 October 2026: "when you hold
 * the keys and clearly ask for a routine task, the request is the permission … She still asks before anything
 * destructive, anything sent, anything that costs money, or anything sensitive"; contract D). risk.vectors: the same
 * table as the Mac's risk.rs (D.6), and the rules around it.
 */
import { describe, expect, it } from "vitest";
import { RISK_KINDS, RISK_VECTORS, classify, classifyRequest, riskKindOfAction, runVector } from "@/lib/mac-risk";
import { MAC_ACTION_KINDS } from "@/lib/front";

describe("risk.vectors (D.6)", () => {
  it.each(RISK_VECTORS.map((v, i) => [i, v] as const))("vector %i", (_i, v) => {
    const c = runVector(v);
    expect(c.class).toBe(v.want);
    expect(c.reason).toBe(v.reason);
    if ("askKind" in v && v.askKind) expect(c.askKind).toBe(v.askKind);
  });
  it("covers the contract's table (35 rows, and 3 for browsers: owner report, 28 October 2026)", () => { expect(RISK_VECTORS).toHaveLength(38); });
});

describe("the rules around the table", () => {
  it("every direct action has a kind (Wi-Fi by its on/off)", () => {
    for (const k of MAC_ACTION_KINDS) expect(riskKindOfAction(k, true), k).not.toBeNull();
    expect(riskKindOfAction("wifi", false)).toBe("wifi_off");
    expect(riskKindOfAction("wifi", true)).toBe("wifi_on");
    expect(riskKindOfAction("format_disk")).toBeNull();
  });
  it("a fact that doesn't apply to a kind never raises it", () => {
    expect(classify("screenshot", ["secret", "installer", "bad_url"]).class).toBe("routine");
    expect(classify("open_url", ["secret"]).class).toBe("routine");
  });
  it("never is never lowered by another item, and ask is never lowered to routine", () => {
    expect(classifyRequest([{ kind: "open_app", facts: ["installer"] }, { kind: "empty_trash" }], false).class).toBe("never");
    expect(classifyRequest([{ kind: "empty_trash" }, { kind: "open_app" }], true)).toMatchObject({ class: "ask", reason: "base", askKind: "delete" });
  });
  it("Check with me makes any routine request ask, except one that only finds files; an empty request asks nothing", () => {
    expect(classifyRequest([{ kind: "find_files" }, { kind: "open_app" }], true).reason).toBe("check_every");
    expect(classifyRequest([], true).class).toBe("routine");
  });
  it("every kind classifies without throwing; only the four ask kinds ask with no facts", () => {
    const asks = RISK_KINDS.filter((k) => classify(k).class === "ask");
    expect(asks.sort()).toEqual(["bd.sends", "empty_trash", "files.trash", "wifi_off"]);
  });
});
