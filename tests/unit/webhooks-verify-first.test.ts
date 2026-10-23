/**
 * Webhooks verify first (owner request, 23 October 2026: realtime plan, phase 0, items 5 and 6; go/no-go "an unsigned
 * webhook gets 401 with no database query"). Every webhook route is called with an unsigned or malformed delivery while
 * every way to the database (pg's Pool and Client) is counted: each answers 401 with zero connections and zero queries,
 * and logs no wake tag. Made-up secrets only; nothing is sent anywhere.
 */
import { createHmac } from "node:crypto";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const SECRETS: Record<string, string> = {
  SLACK_CLIENT_ID: "test-slack-id", SLACK_CLIENT_SECRET: "test-slack-secret", SLACK_SIGNING_SECRET: "test-slack-signing",
  GITHUB_APP_ID: "1", GITHUB_APP_SLUG: "test-app", GITHUB_APP_CLIENT_ID: "test-gh-id", GITHUB_APP_CLIENT_SECRET: "test-gh-secret",
  GITHUB_APP_PRIVATE_KEY: "test-key", GITHUB_APP_WEBHOOK_SECRET: "test-gh-webhook",
  LINEAR_CLIENT_ID: "test-linear-id", LINEAR_CLIENT_SECRET: "test-linear-secret", LINEAR_WEBHOOK_SECRET: "test-linear-webhook",
  ATLASSIAN_CLIENT_ID: "test-jira-id", ATLASSIAN_CLIENT_SECRET: "test-jira-secret",
  ASANA_CLIENT_ID: "test-asana-id", ASANA_CLIENT_SECRET: "test-asana-secret",
  PAYSTACK_SECRET_KEY: "sk_test_made_up_for_tests",
  RESEND_INBOUND_SECRET: `whsec_${Buffer.from("test-resend-secret").toString("base64")}`,
  LIVEKIT_URL: "wss://made-up.livekit.invalid", LIVEKIT_API_KEY: "test-lk-key", LIVEKIT_API_SECRET: "test-lk-secret-test-lk-secret-0000",
};
const saved: Record<string, string | undefined> = {};
const counts = { poolConnect: 0, poolQuery: 0, clientConnect: 0, clientQuery: 0 };
let wakes: string[] = [];

beforeAll(() => {
  for (const [k, v] of Object.entries(SECRETS)) { saved[k] = process.env[k]; process.env[k] = v; }
  vi.spyOn(Pool.prototype, "connect").mockImplementation((() => { counts.poolConnect++; return Promise.reject(new Error("no database in this test")); }) as never);
  vi.spyOn(Pool.prototype, "query").mockImplementation((() => { counts.poolQuery++; return Promise.reject(new Error("no database in this test")); }) as never);
  vi.spyOn(Client.prototype, "connect").mockImplementation((() => { counts.clientConnect++; return Promise.reject(new Error("no database in this test")); }) as never);
  vi.spyOn(Client.prototype, "query").mockImplementation((() => { counts.clientQuery++; return Promise.reject(new Error("no database in this test")); }) as never);
  const log = console.log.bind(console);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { if (typeof a[0] === "string" && a[0].startsWith("[wake]")) wakes.push(a[0]); else log(...a); });
});
afterAll(() => {
  vi.restoreAllMocks();
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});
afterEach(() => { wakes = []; });

const total = () => counts.poolConnect + counts.poolQuery + counts.clientConnect + counts.clientQuery;
const body = JSON.stringify({ event: "charge.success", type: "event_callback", data: { id: 1 } });
const post = (url: string, headers: Record<string, string> = {}, b = body) =>
  new Request(url, { method: "POST", body: b, headers: { "content-type": "application/json", ...headers } });
const params = <T>(p: T) => ({ params: Promise.resolve(p) });

async function expectNoDatabase(fn: () => Promise<Response>, status = 401) {
  const before = total();
  const res = await fn();
  expect(res.status).toBe(status);
  expect(total() - before).toBe(0);
  expect(wakes).toEqual([]);
}

describe("connector webhooks with the secret in the environment", () => {
  const route = () => import("@/app/api/connectors/webhooks/[provider]/route");
  it.each(["slack", "github", "linear", "jira"])("%s: unsigned → 401, no query, no wake tag", async (slug) => {
    const { POST } = await route();
    await expectNoDatabase(() => POST(post(`http://localhost:3000/api/connectors/webhooks/${slug}`), params({ provider: slug })));
  });

  it("slack: a wrong signature with a fresh timestamp → 401, no query", async () => {
    const { POST } = await route();
    const ts = String(Math.floor(Date.now() / 1000));
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/connectors/webhooks/slack", { "x-slack-request-timestamp": ts, "x-slack-signature": `v0=${"0".repeat(64)}` }), params({ provider: "slack" })));
  });

  it("github: a wrong sha256 signature → 401, no query", async () => {
    const { POST } = await route();
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/connectors/webhooks/github", { "x-hub-signature-256": `sha256=${"0".repeat(64)}`, "x-github-delivery": "d-1", "x-github-event": "issues" }), params({ provider: "github" })));
  });

  it("linear: a wrong signature → 401, no query", async () => {
    const { POST } = await route();
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/connectors/webhooks/linear", { "linear-signature": "0".repeat(64), "linear-delivery": "d-1" }), params({ provider: "linear" })));
  });
});

describe("Asana (a secret per hook, stored): the delivery's shape before the secret's lookup", () => {
  const hook = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  const url = `http://localhost:3000/api/connectors/webhooks/asana/${hook}`;
  it("no signature → 401, no query", async () => {
    const { POST } = await import("@/app/api/connectors/webhooks/asana/[hook]/route");
    await expectNoDatabase(() => POST(post(url), params({ hook })));
  });
  it("a malformed signature, or an empty body → 401, no query", async () => {
    const { POST } = await import("@/app/api/connectors/webhooks/asana/[hook]/route");
    await expectNoDatabase(() => POST(post(url, { "x-hook-signature": "not-hex" }), params({ hook })));
    await expectNoDatabase(() => POST(post(url, { "x-hook-signature": "a".repeat(64) }, ""), params({ hook })));
  });
  it("a malformed handshake secret → 401, no query", async () => {
    const { POST } = await import("@/app/api/connectors/webhooks/asana/[hook]/route");
    await expectNoDatabase(() => POST(post(url, { "x-hook-secret": "!" }), params({ hook })));
  });
  it("a well-formed signature does look the hook's secret up (that is the one database touch, tagged)", async () => {
    const { POST } = await import("@/app/api/connectors/webhooks/asana/[hook]/route");
    const before = total();
    const res = await POST(post(url, { "x-hook-signature": "a".repeat(64) }), params({ hook }));
    expect([401, 500]).toContain(res.status); // no database here: the lookup fails
    expect(total() - before).toBeGreaterThan(0);
    expect(wakes).toEqual(["[wake] webhook:asana"]);
  });
});

describe("Paystack, Resend and LiveKit", () => {
  it("Paystack: unsigned, a malformed signature, or a body that isn't an event → 401, no query", async () => {
    const { POST } = await import("@/app/api/billing/paystack/webhook/route");
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/billing/paystack/webhook")));
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/billing/paystack/webhook", { "x-paystack-signature": "zz" })));
    const notJson = "not json";
    const sig = createHmac("sha512", "whatever").update(notJson).digest("hex");
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/billing/paystack/webhook", { "x-paystack-signature": sig }, notJson)));
  });

  // Only the current mode's key verifies (security audit, 23 October 2026, issue 9), and whether PAYSTACK_SECRET_KEY is
  // that key depends on what the Control Center stores, so a well-formed signature now costs the one settings lookup,
  // tagged. Unsigned and malformed deliveries still never reach the database (above).
  it("Paystack: a well-formed signature looks the current mode's key up (the one database touch, tagged)", async () => {
    const { POST } = await import("@/app/api/billing/paystack/webhook/route");
    const before = total();
    const sig = createHmac("sha512", SECRETS.PAYSTACK_SECRET_KEY).update(body).digest("hex");
    await POST(post("http://localhost:3000/api/billing/paystack/webhook", { "x-paystack-signature": sig })).catch(() => null); // no database here: the lookup fails
    expect(total() - before).toBeGreaterThan(0);
    expect(wakes).toEqual(["[wake] webhook:paystack"]);
  });

  it("Resend inbound: unsigned or wrongly signed → 401, no query", async () => {
    const { POST } = await import("@/app/api/inbound/resend/route");
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/inbound/resend")));
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/inbound/resend", { "svix-id": "msg_1", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": "v1,AAAA" })));
  });

  it("LiveKit: no or a forged Authorization → 401, no query", async () => {
    const { POST } = await import("@/app/api/livekit/webhook/route");
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/livekit/webhook"), params({})));
    await expectNoDatabase(() => POST(post("http://localhost:3000/api/livekit/webhook", { authorization: "eyJhbGciOiJIUzI1NiJ9.e30.AAAA" }), params({})));
  });
});
