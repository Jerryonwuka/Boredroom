/**
 * Boredroom for Mac's one sign-in, the pure parts (owner request, 24 October 2026: option A; spec §12.3): the user-agent
 * token, the window's way in, the hand-back link, the unauthenticated redirect, the PKCE challenge (RFC 7636 appendix
 * B), the request cookie's purpose, and the strict origin check.
 */
import { describe, expect, it } from "vitest";
import { backToAppUrl, desktopEntryPath, desktopNext, isDesktopAppUserAgent } from "@/lib/desktop-app";
import { signInPathFor } from "@/server/lib/desktop-app";
import { pkceChallengeOf, readRequestCookie, requestCookieValue, userDigest } from "@/server/services/desktop-app";
import { signPayload } from "@/server/lib/crypto";
import { assertStrictSameOrigin } from "@/server/lib/api";

const APP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 BoredroomDesktop/0.2.0";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("the user agent", () => {
  it("only the BoredroomDesktop/ token counts", () => {
    expect(isDesktopAppUserAgent(APP_UA)).toBe(true);
    expect(isDesktopAppUserAgent(SAFARI)).toBe(false);
    expect(isDesktopAppUserAgent("Boredroom for Mac/0.2.0 (macOS)")).toBe(false); // Rust's own HTTP calls
    expect(isDesktopAppUserAgent(null)).toBe(false);
  });
});

describe("paths", () => {
  it("desktopEntryPath and desktopNext go through /desktop/app, with a safe next", () => {
    expect(desktopEntryPath("/app/acme/home")).toBe("/desktop/app?next=%2Fapp%2Facme%2Fhome");
    expect(desktopEntryPath("//evil.com")).toBe("/desktop/app?next=%2Fapp");
    expect(desktopEntryPath(undefined)).toBe("/desktop/app?next=%2Fapp");
    expect(desktopNext("/app/acme/home?x=1")).toBe("/desktop/app?next=%2Fapp%2Facme%2Fhome%3Fx%3D1");
    expect(desktopNext("/desktop/app/finish")).toBe("/desktop/app/finish");
    expect(desktopNext("https://evil.com/")).toBe("/desktop/app?next=%2Fapp");
  });

  it("backToAppUrl is boredroom://open with the path encoded", () => {
    expect(backToAppUrl("/app/acme/settings?section=connectors&connected=notion"))
      .toBe("boredroom://open?path=%2Fapp%2Facme%2Fsettings%3Fsection%3Dconnectors%26connected%3Dnotion");
    expect(backToAppUrl("/\\evil.com")).toBe("boredroom://open?path=%2Fapp");
  });

  it("signInPathFor: the app's window to /desktop/app, everyone else to /login", () => {
    expect(signInPathFor(APP_UA, "/app/acme/home")).toBe("/desktop/app?next=%2Fapp%2Facme%2Fhome");
    expect(signInPathFor(SAFARI, "/app/acme/home")).toBe("/login?next=%2Fapp%2Facme%2Fhome");
    expect(signInPathFor(SAFARI, "//evil.com")).toBe("/login?next=%2Fapp");
  });
});

describe("PKCE and the request cookie", () => {
  it("S256 matches RFC 7636 appendix B", () => {
    expect(pkceChallengeOf("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("the request cookie reads back only with its own purpose", () => {
    const id = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
    expect(readRequestCookie(requestCookieValue(id))).toBe(id);
    expect(readRequestCookie(signPayload({ p: "other", r: id }, 60))).toBeNull();
    expect(readRequestCookie(signPayload({ r: id }, 60))).toBeNull();
    expect(readRequestCookie(signPayload({ p: "desktop-auth", r: "not-a-uuid" }, 60))).toBeNull();
    expect(readRequestCookie(`${requestCookieValue(id).split(".")[0]}.forged`)).toBeNull();
    expect(readRequestCookie(undefined)).toBeNull();
  });

  it("the person's digest is 16 hex characters, stable, and differs per person", () => {
    const a = userDigest("6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b");
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(userDigest("6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b")).toBe(a);
    expect(userDigest("00000000-0000-4000-8000-000000000000")).not.toBe(a);
  });
});

describe("assertStrictSameOrigin", () => {
  const req = (h: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers: h });
  it("lets only our own origin through, same-origin fetches included", () => {
    expect(() => assertStrictSameOrigin(req({ origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }))).not.toThrow();
    expect(() => assertStrictSameOrigin(req({ origin: "http://localhost:3000" }))).not.toThrow();
  });
  it("refuses another origin, same-site, none and a missing Origin", () => {
    for (const h of <Record<string, string>[]>[
      { origin: "https://evil.com", "sec-fetch-site": "cross-site" },
      { origin: "http://localhost:3000", "sec-fetch-site": "same-site" },
      { origin: "http://localhost:3000", "sec-fetch-site": "none" },
      { "sec-fetch-site": "same-origin" },
      {},
    ]) expect(() => assertStrictSameOrigin(req(h))).toThrow(expect.objectContaining({ status: 403, code: "BAD_ORIGIN" }));
  });
});
