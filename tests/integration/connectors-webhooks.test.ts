/**
 * Connected apps: webhooks (owner decisions, 22 October 2026: connectors; spec §7, §16.3). Verified on raw bytes (401 and
 * nothing queued when not), deduplicated, used only to queue a re-fetch or a sync; a url_verification reply; Asana's
 * handshake secret sealed and echoed; a revocation disconnects; a body over 1 MiB is refused.
 */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061 } from "@/server/lib/schema-0061";
import { applyConnectorsMigration, connectFake } from "@/server/connectors/testing";
import { handleWebhook } from "@/server/connectors/webhooks";
import { signFakeWebhook, fakeServer } from "@/server/connectors/adapters/fake";
import { setAdapterForTests, stubAdapter } from "@/server/connectors/registry";
import { openToken, webhookAad } from "@/server/connectors/crypto";
import { safeEqual } from "@/server/connectors/crypto";
import type { ProviderAdapter } from "@/server/connectors/types";

let a: CompanyFixture;
let workspace: string;
const saved = process.env.CONNECTORS_FAKE;
const URL_ = "http://localhost:3000/api/connectors/webhooks/fake";
const post = (body: string, headers: Headers, url = URL_) => new Request(url, { method: "POST", body, headers });
const jobs = async (type: string) => (await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE type = $1`, [type]))[0].n;

/** An Asana-like adapter: X-Hook-Secret handshake, then X-Hook-Signature over the raw body with that secret. */
const testAsana: ProviderAdapter = {
  ...stubAdapter("asana"), configured: () => true,
  webhook: {
    async verify({ raw, headers, url, secretFor, saveSecret }) {
      const hookId = url.pathname.split("/").pop() ?? "";
      const handshake = headers.get("x-hook-secret");
      if (handshake) return (await saveSecret(hookId, handshake)) ? { ok: true, deliveryId: `handshake-${hookId}`, reply: new Response(null, { status: 200, headers: { "X-Hook-Secret": handshake } }) } : { ok: false };
      const secret = await secretFor(hookId);
      const sig = headers.get("x-hook-signature") ?? "";
      if (!secret || !safeEqual(sig, createHmac("sha256", secret).update(raw).digest("hex"))) return { ok: false };
      return { ok: true, deliveryId: createHmac("sha256", "d").update(raw).digest("hex") };
    },
    route: () => [],
  },
};

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  forget0061();
  a = await buildCompany("a");
  await applyConnectorsMigration(adminQuery);
  fakeServer.reset();
  workspace = await connectFake(a.ownerCtx, "workspace");
  setAdapterForTests("asana", testAsana);
});
afterAll(() => { setAdapterForTests("asana", null); forget0061(); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });

describe("verification", () => {
  it("a good signature queues a re-fetch of the one item it names", async () => {
    await adminQuery(`DELETE FROM jobs WHERE type LIKE 'connector.%'`);
    const body = JSON.stringify({ deliveryId: "d-1", tenant: "fake-team", issueId: "i-1" });
    const res = await handleWebhook("fake", post(body, signFakeWebhook(body)));
    expect(res.status).toBe(200);
    const q = await adminQuery<{ payload: Record<string, unknown> }>(`SELECT payload FROM jobs WHERE type = 'connector.item'`);
    expect(q).toEqual([{ payload: { connectionId: workspace, kind: "issue", externalId: "i-1" } }]);
  });

  it("the same delivery again: 200, nothing more queued", async () => {
    const body = JSON.stringify({ deliveryId: "d-1", tenant: "fake-team", issueId: "i-2" });
    expect((await handleWebhook("fake", post(body, signFakeWebhook(body)))).status).toBe(200);
    expect(await jobs("connector.item")).toBe(1);
  });

  it("a bad signature or a stale timestamp: 401 with no body, nothing queued", async () => {
    const body = JSON.stringify({ deliveryId: "d-2", tenant: "fake-team" });
    const bad = signFakeWebhook(body);
    bad.set("x-fake-signature", "0".repeat(64));
    const r = await handleWebhook("fake", post(body, bad));
    expect(r.status).toBe(401);
    expect(await r.text()).toBe("");
    expect((await handleWebhook("fake", post(body, signFakeWebhook(body, Math.floor(Date.now() / 1000) - 600)))).status).toBe(401);
    // The signature is over the raw bytes: the same JSON with a space added fails.
    expect((await handleWebhook("fake", post(`${body} `, signFakeWebhook(body)))).status).toBe(401);
    expect(await jobs("connector.sync")).toBe(0);
  });

  it("no item named: every stream of the connection syncs", async () => {
    const body = JSON.stringify({ deliveryId: "d-3", tenant: "fake-team" });
    expect((await handleWebhook("fake", post(body, signFakeWebhook(body)))).status).toBe(200);
    expect(await jobs("connector.sync")).toBe(2);
  });

  it("url_verification answers the challenge (after verification only)", async () => {
    const body = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const r = await handleWebhook("fake", post(body, signFakeWebhook(body)));
    expect(await r.json()).toEqual({ challenge: "abc123" });
    const unsigned = await handleWebhook("fake", post(body, new Headers({ "content-type": "application/json" })));
    expect(unsigned.status).toBe(401);
  });

  it("over 1 MiB: 413", async () => {
    const body = "x".repeat(1024 * 1024 + 1);
    expect((await handleWebhook("fake", post(body, signFakeWebhook(body)))).status).toBe(413);
  });
});

describe("Asana's handshake", () => {
  it("seals the secret into the pending hook, echoes it, and then verifies deliveries with it", async () => {
    const hook = (await adminQuery<{ id: string }>(`INSERT INTO connector_webhooks(connection_id, provider, status) VALUES ($1, 'asana', 'pending') RETURNING id`, [workspace]))[0].id;
    const url = `http://localhost:3000/api/connectors/webhooks/asana/${hook}`;
    const r = await handleWebhook("asana", post("", new Headers({ "X-Hook-Secret": "hook-secret-xyz" }), url), hook);
    expect(r.headers.get("X-Hook-Secret")).toBe("hook-secret-xyz");
    const row = await adminQuery<{ secret_enc: string; status: string }>(`SELECT secret_enc, status FROM connector_webhooks WHERE id = $1`, [hook]);
    expect(row[0].status).toBe("active");
    expect(row[0].secret_enc).not.toContain("hook-secret-xyz");
    expect(openToken(row[0].secret_enc, webhookAad(hook))).toBe("hook-secret-xyz");
    // A second handshake (someone replaying it) is refused: the secret is set once.
    expect((await handleWebhook("asana", post("", new Headers({ "X-Hook-Secret": "attacker" }), url), hook)).status).toBe(401);
    const body = JSON.stringify({ events: [] });
    const sig = createHmac("sha256", "hook-secret-xyz").update(body).digest("hex");
    expect((await handleWebhook("asana", post(body, new Headers({ "X-Hook-Signature": sig }), url), hook)).status).toBe(200);
    expect((await handleWebhook("asana", post(body, new Headers({ "X-Hook-Signature": "f".repeat(64) }), url), hook)).status).toBe(401);
  });
});

describe("revocation", () => {
  it("the app says Boredroom was removed: disconnected here, owners and HR told", async () => {
    const body = JSON.stringify({ deliveryId: "d-9", type: "revoked", tenant: "fake-team" });
    expect((await handleWebhook("fake", post(body, signFakeWebhook(body)))).status).toBe(200);
    expect((await adminQuery<{ status: string }>(`SELECT status FROM connector_connections WHERE id = $1`, [workspace]))[0].status).toBe("disconnecting");
    expect(await jobs("connector.revoke")).toBe(1);
    const notes = await adminQuery<{ recipient_membership_id: string }>(`SELECT recipient_membership_id FROM notifications WHERE type = 'connector.trouble'`);
    expect(notes.map((n) => n.recipient_membership_id).sort()).toEqual([a.ownerCtx.membership.id, a.hrCtx.membership.id].sort());
  });
});
