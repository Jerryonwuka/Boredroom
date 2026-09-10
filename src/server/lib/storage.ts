import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, createReadStream, openSync, writeSync, closeSync } from "node:fs";
import { dirname, join, normalize, resolve } from "node:path";
import type { Readable } from "node:stream";

/**
 * Private object storage. Keys are server generated (tenant-prefixed) and never
 * taken from clients. The local adapter keeps bytes on disk outside the web root.
 */
export interface StorageProvider {
  put(key: string, bytes: Buffer, contentType: string): Promise<{ size: number; sha256: string }>;
  get(key: string): Promise<Buffer | null>;
  stream(key: string): Readable | null;
  size(key: string): Promise<number | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** Concatenates parts in order into a new object (same container/recorder instance). */
  concat(destKey: string, partKeys: string[]): Promise<{ size: number }>;
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
  stream(key: string) { const p = this.path(key); return existsSync(p) ? createReadStream(p) : null; }
  async size(key: string) { const p = this.path(key); return existsSync(p) ? statSync(p).size : null; }
  async delete(key: string) { const p = this.path(key); rmSync(p, { force: true }); }
  async exists(key: string) { return existsSync(this.path(key)); }
  async concat(destKey: string, partKeys: string[]) {
    const dest = this.path(destKey);
    mkdirSync(dirname(dest), { recursive: true });
    const fd = openSync(dest, "w");
    let size = 0;
    try {
      for (const k of partKeys) {
        const buf = readFileSync(this.path(k));
        writeSync(fd, buf);
        size += buf.length;
      }
    } finally { closeSync(fd); }
    return { size };
  }
}

let provider: StorageProvider | null = null;
export function storage(): StorageProvider {
  if (provider) return provider;
  const kind = process.env.STORAGE_PROVIDER ?? "local";
  if (kind === "local") provider = new LocalStorageProvider(process.env.STORAGE_LOCAL_DIR ?? "./var/storage");
  else throw new Error(`STORAGE_PROVIDER=${kind} is not implemented locally. See docs/providers.md.`);
  return provider;
}
export function setStorageProvider(p: StorageProvider | null) { provider = p; }

export function tenantKey(orgId: string, ...parts: string[]) {
  const key = ["org", orgId.replace(/-/g, ""), ...parts].join("/");
  assertSafeKey(key);
  return key;
}
export { join as joinPath };
