import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, createReadStream } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { AwsClient } from "aws4fetch";

/**
 * Private object storage. Keys are server generated (tenant-prefixed) and never
 * taken from clients. The local adapter keeps bytes on disk outside the web root.
 */
export interface StorageProvider {
  put(key: string, bytes: Buffer, contentType: string): Promise<{ size: number; sha256: string }>;
  get(key: string): Promise<Buffer | null>;
  stream(key: string): Promise<Readable | null>;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const SAFE_KEY = /^[a-z0-9]+(?:\/[A-Za-z0-9._-]+)+$/;
export function assertSafeKey(key: string) {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error("unsafe storage key");
}

export class LocalStorageProvider implements StorageProvider {
  private root: string;
  constructor(root: string) { this.root = resolve(root); }
  private path(key: string) {
    assertSafeKey(key);
    const p = resolve(this.root, normalize(key));
    if (!p.startsWith(this.root + "/")) throw new Error("unsafe storage key");
    return p;
  }
  async put(key: string, bytes: Buffer) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
    return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  async get(key: string) { const p = this.path(key); return existsSync(p) ? readFileSync(p) : null; }
  async stream(key: string) { const p = this.path(key); return existsSync(p) ? createReadStream(p) : null; }
  async size(key: string) { const p = this.path(key); return existsSync(p) ? statSync(p).size : null; }
  async delete(key: string) { const p = this.path(key); rmSync(p, { force: true }); }
  async exists(key: string) { return existsSync(this.path(key)); }
}

export type R2Settings = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; endpoint?: string };

/**
 * Cloudflare R2 (owner decision, 10 November 2026): a private bucket over R2's S3 API, for hosts whose own disk does not
 * last (Vercel's /tmp is wiped and not shared between its servers). Nothing is public: the bucket has no public
 * access, the keys stay on the server, and downloads still go through the app's own routes and 60-second links.
 * An error names the step and the status only, never the key, the bucket's credentials or R2's own words.
 */
export class R2StorageProvider implements StorageProvider {
  private client: AwsClient;
  private base: string;
  constructor(o: R2Settings) {
    this.client = new AwsClient({ accessKeyId: o.accessKeyId, secretAccessKey: o.secretAccessKey, service: "s3", region: "auto", retries: 2 });
    this.base = `${(o.endpoint ?? `https://${o.accountId}.r2.cloudflarestorage.com`).replace(/\/+$/, "")}/${o.bucket}`;
  }
  private url(key: string) { assertSafeKey(key); return `${this.base}/${key}`; }
  private async send(step: string, key: string, init: RequestInit, missingOk = false): Promise<Response | null> {
    const res = await this.client.fetch(this.url(key), init);
    if (res.status === 404 && missingOk) { await res.body?.cancel().catch(() => undefined); return null; }
    if (!res.ok) { await res.body?.cancel().catch(() => undefined); throw new Error(`File storage (R2) refused to ${step}: status ${res.status}`); }
    return res;
  }
  async put(key: string, bytes: Buffer, contentType: string) {
    // The body's own hash is signed with the request (the library's default for S3 leaves the body unsigned).
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const res = await this.send("save a file", key, { method: "PUT", body: new Uint8Array(bytes), headers: { "content-type": contentType || "application/octet-stream", "x-amz-content-sha256": sha256 } });
    await res!.body?.cancel().catch(() => undefined);
    return { size: bytes.length, sha256 };
  }
  async get(key: string) {
    const res = await this.send("read a file", key, { method: "GET" }, true);
    return res ? Buffer.from(await res.arrayBuffer()) : null;
  }
  async stream(key: string) {
    const res = await this.send("read a file", key, { method: "GET" }, true);
    return res?.body ? Readable.fromWeb(res.body as unknown as WebReadableStream) : null;
  }
  async size(key: string) {
    const res = await this.send("look up a file", key, { method: "HEAD" }, true);
    if (!res) return null;
    const n = Number(res.headers.get("content-length"));
    return Number.isFinite(n) ? n : null;
  }
  async delete(key: string) { const res = await this.send("delete a file", key, { method: "DELETE" }, true); await res?.body?.cancel().catch(() => undefined); }
  async exists(key: string) { return (await this.send("look up a file", key, { method: "HEAD" }, true)) !== null; }
  /** One signed request to the bucket itself: the keys work and the bucket is there. Never throws. */
  async check(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.client.fetch(this.base, { method: "HEAD" });
      await res.body?.cancel().catch(() => undefined);
      if (res.ok) return { ok: true, detail: "reachable" };
      return { ok: false, detail: res.status === 404 ? "the bucket was not found" : res.status === 401 || res.status === 403 ? "the keys were refused" : `status ${res.status}` };
    } catch { return { ok: false, detail: "could not be reached" }; }
  }
}

const R2_NAMES = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "STORAGE_BUCKET"] as const;
/** The provider named by STORAGE_PROVIDER ("local" when unset). */
export const storageKind = () => (process.env.STORAGE_PROVIDER ?? "local").trim().toLowerCase();
/** What is wrong with the storage settings, in words for the health check (names only, never values); null when fine. */
export function storageConfigProblem(): string | null {
  const kind = storageKind();
  if (kind === "local") return null;
  if (kind !== "r2") return `STORAGE_PROVIDER=${kind} is not one this app has. Use local or r2 (docs/providers.md).`;
  const missing = R2_NAMES.filter((n) => !process.env[n]?.trim() && !(n === "R2_ACCOUNT_ID" && process.env.R2_ENDPOINT?.trim()));
  return missing.length ? `Set ${missing.join(", ")} (docs/providers.md).` : null;
}

let provider: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (provider) return provider;
  const problem = storageConfigProblem();
  if (problem) throw new Error(`File storage is not set up: ${problem}`);
  if (storageKind() === "r2") {
    provider = new R2StorageProvider({
      accountId: process.env.R2_ACCOUNT_ID?.trim() ?? "", accessKeyId: process.env.R2_ACCESS_KEY_ID!.trim(), secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!.trim(),
      bucket: process.env.STORAGE_BUCKET!.trim(), endpoint: process.env.R2_ENDPOINT?.trim() || undefined,
    });
  } else provider = new LocalStorageProvider(process.env.STORAGE_LOCAL_DIR ?? "./var/storage");
  return provider;
}
export function setStorageProvider(p: StorageProvider | null) { provider = p; }

export function tenantKey(orgId: string, ...parts: string[]) {
  const key = ["org", orgId.replace(/-/g, ""), ...parts].join("/");
  assertSafeKey(key);
  return key;
}
export { join as joinPath };
