/**
 * Connected apps: sealing tokens and PKCE (owner decisions, 22 October 2026: connectors; spec §15, §16.2).
 */
import { afterEach, describe, expect, it } from "vitest";
import { openToken, pkceChallenge, pkcePair, sealToken, tokenAad, stateAad, safeEqual } from "@/server/connectors/crypto";

const KEY = process.env.CONNECTORS_TOKEN_KEY;
afterEach(() => { if (KEY === undefined) delete process.env.CONNECTORS_TOKEN_KEY; else process.env.CONNECTORS_TOKEN_KEY = KEY; });

describe("sealed tokens", () => {
  it("round trip, and the ciphertext never contains the token", () => {
    const aad = tokenAad("11111111-1111-1111-1111-111111111111", "access");
    const sealed = sealToken("xoxb-secret-token", aad);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("xoxb-secret-token");
    expect(openToken(sealed, aad)).toBe("xoxb-secret-token");
    expect(sealToken("xoxb-secret-token", aad)).not.toBe(sealed); // a fresh IV every time
  });

  it("another row or another field does not open it (AAD bound)", () => {
    const sealed = sealToken("t", tokenAad("11111111-1111-1111-1111-111111111111", "access"));
    expect(openToken(sealed, tokenAad("22222222-2222-2222-2222-222222222222", "access"))).toBeNull();
    expect(openToken(sealed, tokenAad("11111111-1111-1111-1111-111111111111", "refresh"))).toBeNull();
    expect(openToken(sealed, stateAad("11111111-1111-1111-1111-111111111111"))).toBeNull();
  });

  it("a tampered tag or ciphertext fails; garbage fails", () => {
    const aad = tokenAad("11111111-1111-1111-1111-111111111111", "access");
    const parts = sealToken("token", aad).split(".");
    const flip = (s: string) => (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(openToken([parts[0], parts[1], parts[2], flip(parts[3])].join("."), aad)).toBeNull();
    expect(openToken([parts[0], parts[1], flip(parts[2]), parts[3]].join("."), aad)).toBeNull();
    expect(openToken("v2.a.b.c", aad)).toBeNull();
    expect(openToken(null, aad)).toBeNull();
  });

  it("CONNECTORS_TOKEN_KEY, when set, is the key; the derived key does not open its ciphertexts", () => {
    delete process.env.CONNECTORS_TOKEN_KEY;
    const aad = tokenAad("11111111-1111-1111-1111-111111111111", "access");
    const derived = sealToken("token", aad);
    process.env.CONNECTORS_TOKEN_KEY = Buffer.alloc(32, 7).toString("base64");
    const keyed = sealToken("token", aad);
    expect(openToken(keyed, aad)).toBe("token");
    expect(openToken(derived, aad)).toBeNull();
    process.env.CONNECTORS_TOKEN_KEY = Buffer.alloc(16, 7).toString("base64");
    expect(() => sealToken("token", aad)).toThrow(/32 bytes/);
  });
});

describe("PKCE (RFC 7636)", () => {
  it("the appendix B vector", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });
  it("a 64-character base64url verifier and its S256 challenge", () => {
    const p = pkcePair();
    expect(p.verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(p.challenge).toBe(pkceChallenge(p.verifier));
  });
  it("constant-time equality", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
