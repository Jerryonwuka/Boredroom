/**
 * Connected apps: sealing tokens (owner decisions, 22 October 2026: connectors; spec §4.2, §15). AES-256-GCM with the
 * row and the field as additional data, so a ciphertext copied to another row or field does not open. The key is
 * CONNECTORS_TOKEN_KEY (32 bytes, base64) or, unset, derived from APP_SECRET. Changing either disconnects every app
 * (`key_version` is there for a future re-encryption job). Never logs a value. Server-only.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.startsWith("change-me")) {
    if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET must be set in production");
    return "development-only-secret";
  }
  return s;
}

/** The 32-byte key: CONNECTORS_TOKEN_KEY when set (base64 of exactly 32 bytes), else sha256("boredroom-connectors:" + APP_SECRET). */
export function tokenKey(): Buffer {
  const raw = (process.env.CONNECTORS_TOKEN_KEY ?? "").trim();
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("CONNECTORS_TOKEN_KEY must be 32 bytes, base64 (openssl rand -base64 32)");
    return k;
  }
  return createHash("sha256").update(`boredroom-connectors:${appSecret()}`).digest();
}

export type TokenField = "access" | "refresh" | "extra";
export const tokenAad = (connectionId: string, field: TokenField) => `connector:${connectionId}:${field}`;
export const stateAad = (stateId: string) => `connector-state:${stateId}`;
export const webhookAad = (webhookId: string) => `connector-webhook:${webhookId}`;

/** `v1.<iv>.<ciphertext>.<tag>`, each base64url. */
export function sealToken(plain: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", tokenKey(), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}.${iv.toString("base64url")}.${ct.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

/** The plain text, or null when the value is not ours, was tampered with, or belongs to another row or field. */
export function openToken(stored: string | null | undefined, aad: string): string | null {
  if (typeof stored !== "string") return null;
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", tokenKey(), Buffer.from(parts[1], "base64url"));
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** RFC 7636 S256: a 64-character base64url verifier and its challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url"); // 48 bytes → 64 characters
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** Constant-time string equality (unequal lengths are simply unequal). */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function randomUrlToken(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}
