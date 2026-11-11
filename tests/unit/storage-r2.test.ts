/**
 * Cloudflare R2 storage (owner decision, 10 November 2026) against a small S3 stand-in on this computer: every request
 * is signed, the bytes go and come back whole, a missing file is "not there" rather than an error, a refused request
 * says the step and the status only, and the settings check names what is missing without any value.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { R2StorageProvider, setStorageProvider, storage, storageConfigProblem } from "@/server/lib/storage";

const objects = new Map<string, { bytes: Buffer; type: string }>();
const seen: { method: string; path: string; auth: string; sha: string }[] = [];
let server: Server;
let endpoint = "";
let refuse = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      seen.push({ method: req.method ?? "", path, auth: String(req.headers.authorization ?? ""), sha: String(req.headers["x-amz-content-sha256"] ?? "") });
      if (refuse) { res.writeHead(refuse, { "content-type": "application/xml" }).end("<Error><Code>AccessDenied</Code><Message>secret words from the provider</Message></Error>"); return; }
      if (path === "/bucket") { res.writeHead(200).end(); return; }
      if (!path.startsWith("/bucket/")) { res.writeHead(404).end(); return; }
      const key = path.slice("/bucket/".length);
      const found = objects.get(key);
      if (req.method === "PUT") { objects.set(key, { bytes: Buffer.concat(chunks), type: String(req.headers["content-type"] ?? "") }); res.writeHead(200).end(); return; }
      if (req.method === "DELETE") { objects.delete(key); res.writeHead(204).end(); return; }
      if (!found) { res.writeHead(404).end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code></Error>"); return; }
      res.writeHead(200, { "content-type": found.type, "content-length": String(found.bytes.length) });
      res.end(req.method === "HEAD" ? undefined : found.bytes);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });
afterEach(() => { refuse = 0; seen.length = 0; });

const r2 = () => new R2StorageProvider({ accountId: "acct", accessKeyId: "test-access-key", secretAccessKey: "test-secret-key", bucket: "bucket", endpoint });
const KEY = "org/0123456789abcdef0123456789abcdef/voice/note-1.webm";

describe("R2 storage", () => {
  it("saves, reads, streams, sizes and deletes a file, every request signed", async () => {
    const store = r2();
    const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
    const saved = await store.put(KEY, bytes, "audio/webm");
    expect(saved.size).toBe(5000);
    expect(saved.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(objects.get(KEY)).toMatchObject({ type: "audio/webm" });
    expect(objects.get(KEY)!.bytes.equals(bytes)).toBe(true);

    expect(await store.exists(KEY)).toBe(true);
    expect(await store.size(KEY)).toBe(5000);
    expect((await store.get(KEY))!.equals(bytes)).toBe(true);
    const stream = await store.stream(KEY);
    const parts: Buffer[] = [];
    for await (const c of stream!) parts.push(Buffer.from(c as Uint8Array));
    expect(Buffer.concat(parts).equals(bytes)).toBe(true);

    await store.delete(KEY);
    expect(objects.has(KEY)).toBe(false);
    expect(seen.length).toBeGreaterThanOrEqual(6);
    for (const s of seen) {
      expect(s.path).toBe(`/bucket/${KEY}`);
      expect(s.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
      expect(s.auth).not.toContain("test-secret-key");
    }
    expect(seen.find((s) => s.method === "PUT")!.sha).toBe(saved.sha256);
  });

  it("a file that is not there is null or false, and deleting it is not an error", async () => {
    const store = r2();
    const missing = "org/0123456789abcdef0123456789abcdef/voice/never.webm";
    expect(await store.get(missing)).toBeNull();
    expect(await store.stream(missing)).toBeNull();
    expect(await store.size(missing)).toBeNull();
    expect(await store.exists(missing)).toBe(false);
    await expect(store.delete(missing)).resolves.toBeUndefined();
  });

  it("a refused request says the step and the status, never the provider's words or a key", async () => {
    const store = r2();
    refuse = 403;
    const err = await store.put(KEY, Buffer.from("x"), "text/plain").then(() => null, (e: Error) => e);
    expect(err?.message).toBe("File storage (R2) refused to save a file: status 403");
    await expect(store.get(KEY)).rejects.toThrow("File storage (R2) refused to read a file: status 403");
    expect(await store.check()).toEqual({ ok: false, detail: "the keys were refused" });
    refuse = 0;
    expect(await store.check()).toEqual({ ok: true, detail: "reachable" });
  });

  it("an unsafe key never leaves this computer", async () => {
    const store = r2();
    await expect(store.get("../secrets")).rejects.toThrow("unsafe storage key");
    await expect(store.put("org/a/../../b", Buffer.from("x"), "text/plain")).rejects.toThrow("unsafe storage key");
    expect(seen).toHaveLength(0);
  });
});

describe("the storage settings", () => {
  const NAMES = ["STORAGE_PROVIDER", "STORAGE_BUCKET", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"] as const;
  const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  afterEach(() => { for (const n of NAMES) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; } setStorageProvider(null); });

  it("local needs nothing; r2 names what is missing; an unknown provider is refused", () => {
    for (const n of NAMES) delete process.env[n];
    expect(storageConfigProblem()).toBeNull();
    process.env.STORAGE_PROVIDER = "r2";
    expect(storageConfigProblem()).toBe("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, STORAGE_BUCKET (docs/providers.md).");
    setStorageProvider(null);
    expect(() => storage()).toThrow("File storage is not set up: Set R2_ACCOUNT_ID");
    process.env.STORAGE_PROVIDER = "supabase";
    expect(storageConfigProblem()).toContain("is not one this app has");
  });

  it("with every r2 setting, storage() is the R2 provider and reaches the bucket", async () => {
    Object.assign(process.env, { STORAGE_PROVIDER: "r2", STORAGE_BUCKET: "bucket", R2_ACCESS_KEY_ID: "test-access-key", R2_SECRET_ACCESS_KEY: "test-secret-key", R2_ENDPOINT: endpoint });
    delete process.env.R2_ACCOUNT_ID;
    expect(storageConfigProblem()).toBeNull();
    setStorageProvider(null);
    const store = storage();
    expect(store).toBeInstanceOf(R2StorageProvider);
    await store.put(KEY, Buffer.from("hello"), "text/plain");
    expect((await store.get(KEY))!.toString()).toBe("hello");
    await store.delete(KEY);
  });
});
