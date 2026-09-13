import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1 };
function scrypt(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => scryptCb(password, salt, keylen, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !keyB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(password.normalize("NFKC"), salt, expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function secret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.startsWith("change-me")) {
    if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET must be set in production");
    return "development-only-secret";
  }
  return s;
}

/** Signs an arbitrary payload with an expiry; used for short-lived media URLs. */
export function signPayload(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyPayload<T = Record<string, unknown>>(token: string): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof parsed.exp !== "number" || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed as T;
  } catch {
    return null;
  }
}

// ---- Secrets at rest (AES-256-GCM keyed from APP_SECRET) -------------------
function aesKey(): Buffer { return createHash("sha256").update(`boredroom-secrets:${secret()}`).digest(); }

/** Encrypts a short secret (an API key) for storage. Output: base64url(iv).base64url(ciphertext).base64url(tag). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", aesKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${enc.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}`;
}

export function decryptSecret(stored: string): string | null {
  const [ivB, encB, tagB] = stored.split(".");
  if (!ivB || !encB || !tagB) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", aesKey(), Buffer.from(ivB, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encB, "base64url")), decipher.final()]).toString("utf8");
  } catch { return null; }
}
