/**
 * Where sign-in, sign-up and the verify link go next (owner request, 11 October 2026: the first-run welcome carries `next`
 * in the verify link and lets joiners in while registration is closed, so both rules are load-bearing): `safeNextPath`
 * keeps only a path on this site, read the way a browser reads it, and `joiningTarget` finds the invitation or join code
 * a path leads to.
 */
import { describe, expect, it } from "vitest";
import { decodeSegment, joiningTarget, safeNextPath } from "@/components/auth/next-path";

describe("safeNextPath", () => {
  it("keeps a path on this site, with its query and fragment", () => {
    expect(safeNextPath("/app/acme/home")).toBe("/app/acme/home");
    expect(safeNextPath("/join/ABCD-EFGH?x=1#top")).toBe("/join/ABCD-EFGH?x=1#top");
    expect(safeNextPath("/app/../join/ABCD-EFGH")).toBe("/join/ABCD-EFGH");
  });

  it("refuses anything a browser would take to another site", () => {
    expect(safeNextPath("//evil.example/app")).toBe("/app");
    expect(safeNextPath("/\\evil.example")).toBe("/app");
    expect(safeNextPath("/\t/evil.example")).toBe("/app");
    expect(safeNextPath("/\n/evil.example")).toBe("/app");
    expect(safeNextPath("https://evil.example/app")).toBe("/app");
    expect(safeNextPath("javascript:alert(1)")).toBe("/app");
    expect(safeNextPath("app/acme")).toBe("/app");
  });

  it("refuses dot segments that resolve to another site (security audit, 23 October 2026, issue 6)", () => {
    for (const evil of ["/.//evil.com", "/..//evil.com", "/%2e//evil.com", "/./\\evil.com", "/.//evil.com/login?x=1", "/app/..//evil.com"]) {
      expect(safeNextPath(evil)).toBe("/app");
      expect(safeNextPath(evil, "")).toBe("");
    }
    expect(joiningTarget("/.//evil.com/join/ABCD-EFGH")).toBeNull();
    // Ordinary dot segments on this site still resolve.
    expect(safeNextPath("/./app/acme")).toBe("/app/acme");
  });

  it("takes the first of a repeated parameter, and falls back on nothing", () => {
    expect(safeNextPath(["/invite/abc", "//evil.example"])).toBe("/invite/abc");
    expect(safeNextPath(["//evil.example", "/invite/abc"])).toBe("/app");
    expect(safeNextPath([])).toBe("/app");
    expect(safeNextPath(undefined)).toBe("/app");
    expect(safeNextPath(null)).toBe("/app");
    expect(safeNextPath("")).toBe("/app");
  });

  it("uses the fallback it is given (the verify link leaves an unsafe next out)", () => {
    expect(safeNextPath("//evil.example", "")).toBe("");
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
  });
});

describe("joiningTarget", () => {
  it("finds an invitation and a join code", () => {
    expect(joiningTarget("/invite/tok_123")).toEqual({ kind: "invite", token: "tok_123" });
    expect(joiningTarget("/join/ABCD-EFGH")).toEqual({ kind: "join", code: "ABCD-EFGH" });
  });

  it("decodes an encoded segment, and keeps a malformed one as typed", () => {
    expect(joiningTarget("/join/ABCD%2DEFGH")).toEqual({ kind: "join", code: "ABCD-EFGH" });
    expect(joiningTarget("/invite/a%20b")).toEqual({ kind: "invite", token: "a b" });
    expect(joiningTarget("/join/AB%E0%A4%A")).toEqual({ kind: "join", code: "AB%E0%A4%A" });
    expect(decodeSegment("%")).toBe("%");
  });

  it("finds nothing in other paths, extra segments, queries or other sites", () => {
    expect(joiningTarget("/app")).toBeNull();
    expect(joiningTarget("/onboarding")).toBeNull();
    expect(joiningTarget("/invite/abc/extra")).toBeNull();
    expect(joiningTarget("/join/ABCD-EFGH?ref=mail")).toBeNull();
    expect(joiningTarget("/invite/")).toBeNull();
    expect(joiningTarget("//evil.example/join/ABCD-EFGH")).toBeNull();
    expect(joiningTarget(null)).toBeNull();
    expect(joiningTarget(undefined)).toBeNull();
  });
});
