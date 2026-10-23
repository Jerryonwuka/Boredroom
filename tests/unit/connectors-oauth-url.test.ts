/**
 * Connected apps: the authorise URL and token parsing (owner decisions, 22 October 2026: connectors; spec §5.1, §16.2).
 * The framework's builder with the fake, a PKCE and a non-PKCE adapter, and every registered adapter that is built (not a
 * stub): with its declared variables set to test values, each kind and `act` gives a URL with the standard parameters,
 * its own scopes joined by its separator, and a challenge exactly when it uses PKCE.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADAPTERS, adapterFor, stubAdapter } from "@/server/connectors/registry";
import { authorizeUrl, checkIdToken, failureOf, jwtClaims, safeReturnTo } from "@/server/connectors/oauth";
import { pkcePair } from "@/server/connectors/crypto";
import { fixture } from "@/server/connectors/testing";
import { ConnectorError, PROVIDER_IDS, type ProviderAdapter } from "@/server/connectors/types";

const saved = { ...process.env };
beforeAll(() => { process.env.CONNECTORS_FAKE = "1"; process.env.APP_ORIGIN = "https://boredroom.test"; });
afterAll(() => { process.env = saved; });

const params = (u: string) => new URL(u).searchParams;

describe("the authorise URL", () => {
  it("the fake: Boredroom's own callback, the standard parameters and PKCE", async () => {
    const a = await adapterFor("fake");
    const p = pkcePair();
    const url = authorizeUrl(a, { kind: "personal", act: true, upgrade: false, state: "STATE", nonce: "NONCE", codeChallenge: p.challenge, scopes: a.oauth.scopes({ kind: "personal", act: true }) });
    expect(url.startsWith("https://boredroom.test/api/connectors/fake/callback?")).toBe(true);
    const q = params(url);
    expect(q.get("code")).toBe("fake-personal-1");
    expect(q.get("client_id")).toBe("fake-client");
    expect(q.get("redirect_uri")).toBe("https://boredroom.test/api/connectors/fake/callback");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("scope")).toBe("read write");
    expect(q.get("state")).toBe("STATE");
    expect(q.get("code_challenge")).toBe(p.challenge);
    expect(q.get("code_challenge_method")).toBe("S256");
  });

  it("no PKCE without S256; the adapter's separator and extras", () => {
    const a: ProviderAdapter = { ...stubAdapter("linear"), oauth: { ...stubAdapter("linear").oauth, authorizeUrl: "https://auth.example.com/authorize", clientId: () => "cid", pkce: "none", scopeSeparator: ",", scopes: ({ act }) => (act ? ["read", "write"] : ["read"]), authorizeParams: (c) => ({ prompt: "consent", ...(c.kind === "workspace" ? { actor: "app" } : {}) }) } };
    const q = params(authorizeUrl(a, { kind: "workspace", act: true, upgrade: false, state: "S", nonce: "N", codeChallenge: "ignored", scopes: ["read", "write"] }));
    expect(q.get("scope")).toBe("read,write");
    expect(q.get("code_challenge")).toBeNull();
    expect(q.get("actor")).toBe("app");
    expect(q.get("prompt")).toBe("consent");
  });

  it("every built adapter, per kind and act", async () => {
    for (const id of PROVIDER_IDS) {
      const a = await ADAPTERS[id]();
      if (!a.env.length || id === "fake") continue; // a stub, or the fake (above)
      for (const v of a.env) process.env[v] = process.env[v] || `test-${v.toLowerCase()}`;
      if (!a.configured(process.env)) continue;
      for (const kind of a.kinds) {
        for (const act of [false, true]) {
          const scopes = a.oauth.scopes({ kind, act });
          const p = pkcePair();
          const first = a.begin?.({ kind, state: "STATE" });
          if (first) { expect(first.url.startsWith("https://"), id).toBe(true); continue; }
          const q = params(authorizeUrl(a, { kind, act, upgrade: false, state: "STATE", nonce: "NONCE", codeChallenge: p.challenge, scopes }));
          expect(q.get("client_id"), id).toBeTruthy();
          expect(q.get("redirect_uri"), id).toMatch(/^https:\/\/boredroom\.test\/api\/connectors\/[a-z-]+\/callback$/);
          expect(q.get("response_type"), id).toBe("code");
          expect(q.get("state"), id).toBe("STATE");
          if (scopes.length) expect(q.get("scope"), id).toBe(scopes.join(a.oauth.scopeSeparator));
          expect(q.get("code_challenge") !== null, id).toBe(a.oauth.pkce === "S256");
        }
      }
    }
  });
});

describe("token answers", () => {
  it("the fake parses its success and refuses its error", async () => {
    const a = await adapterFor("fake");
    const now = new Date("2026-10-22T09:00:00Z");
    const t = a.oauth.parseToken(fixture("fake/token.ok.json"), now);
    expect(t.accessToken).toBe("fake-access-token-fixture-0001");
    expect(t.expiresAt?.toISOString()).toBe("2026-10-22T10:00:00.000Z");
    expect(t.scopes).toEqual(["read", "write"]);
    expect(() => a.oauth.parseToken(fixture("fake/token.error.json"), now)).toThrow(ConnectorError);
  });
});

describe("callback helpers", () => {
  it("errors become fixed codes, never the provider's words", () => {
    expect(failureOf("access_denied", "The user said no")).toBe("cancelled");
    expect(failureOf("access_denied", "AADSTS65001: consent")).toBe("admin_approval");
    expect(failureOf("consent_required", null)).toBe("admin_approval");
    expect(failureOf("server_error", "<script>")).toBe("failed");
  });

  it("return_to only to the workspace's settings or My Day", () => {
    expect(safeReturnTo("acme", "personal", "/app/acme/my-day")).toBe("/app/acme/my-day");
    expect(safeReturnTo("acme", "workspace", "/app/acme/settings?section=connectors")).toBe("/app/acme/settings?section=connectors");
    expect(safeReturnTo("acme", "personal", "https://evil.example.com")).toBe("/app/acme/settings?section=assistant");
    expect(safeReturnTo("acme", "personal", "/app/other/my-day")).toBe("/app/acme/settings?section=assistant");
    expect(safeReturnTo("acme", "workspace", "//evil.example.com/app/acme/my-day")).toBe("/app/acme/settings?section=connectors");
  });

  it("an id_token's aud, iss, exp and nonce are checked", () => {
    const jwt = (c: Record<string, unknown>) => `e30.${Buffer.from(JSON.stringify(c)).toString("base64url")}.sig`;
    const now = new Date("2026-10-22T09:00:00Z");
    const exp = Math.floor(now.getTime() / 1000) + 3600;
    const good = { aud: "cid", iss: "https://accounts.google.com", exp, nonce: "N", sub: "1" };
    expect(jwtClaims(jwt(good))?.sub).toBe("1");
    expect(checkIdToken("google_calendar", jwt(good), { clientId: "cid", nonce: "N", now })).not.toBeNull();
    expect(checkIdToken("google_calendar", jwt({ ...good, aud: "other" }), { clientId: "cid", nonce: "N", now })).toBeNull();
    expect(checkIdToken("google_calendar", jwt({ ...good, iss: "https://evil.example.com" }), { clientId: "cid", nonce: "N", now })).toBeNull();
    expect(checkIdToken("google_calendar", jwt({ ...good, exp: exp - 7200 }), { clientId: "cid", nonce: "N", now })).toBeNull();
    expect(checkIdToken("google_calendar", jwt({ ...good, nonce: "other" }), { clientId: "cid", nonce: "N", now })).toBeNull();
    const ms = { aud: "cid", iss: "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0", exp, nonce: "N" };
    expect(checkIdToken("outlook_calendar", jwt(ms), { clientId: "cid", nonce: "N", now })).not.toBeNull();
  });
});
