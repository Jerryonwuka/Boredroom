/**
 * Webhooks verify first, against the throwaway test database (owner request, 23 October 2026: realtime plan, phase 0,
 * items 5 and 6). An unsigned delivery: 401, not one statement sent. A signed one: one wake tag, the work queued. A
 * well-formed Asana delivery for an unknown hook: the one secret lookup, then 401. A database without 0061's delivery
 * table: 200 and dropped, as the old guard did, and noted so the fallbacks hold.
 */
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { forget0061, schema0061Missing } from "@/server/lib/schema-0061";
import { connectFake } from "@/server/connectors/testing";
import { handleWebhook } from "@/server/connectors/webhooks";
import { signFakeWebhook, fakeServer } from "@/server/connectors/adapters/fake";

let a: CompanyFixture;
const saved = process.env.CONNECTORS_FAKE;
const URL_ = "http://localhost:3000/api/connectors/webhooks/fake";
const post = (body: string, headers: Headers | Record<string, string>, url = URL_) => new Request(url, { method: "POST", body, headers });
let statements = 0;
let wakes: string[] = [];

beforeAll(async () => {
  process.env.CONNECTORS_FAKE = "1";
  await resetTestDatabase();
  forget0061();
  a = await buildCompany("a");
  fakeServer.reset();
  await connectFake(a.ownerCtx, "workspace");
  const realQuery = Client.prototype.query;
  vi.spyOn(Client.prototype, "query").mockImplementation(function (this: Client, ...args: unknown[]) {
    statements++;
    return (realQuery as (...x: unknown[]) => unknown).apply(this, args) as never;
  } as never);
  const log = console.log.bind(console);
  vi.spyOn(console, "log").mockImplementation((...x: unknown[]) => { if (typeof x[0] === "string" && x[0].startsWith("[wake]")) wakes.push(x[0]); else log(...x); });
});
afterAll(() => { vi.restoreAllMocks(); forget0061(); if (saved === undefined) delete process.env.CONNECTORS_FAKE; else process.env.CONNECTORS_FAKE = saved; });
afterEach(() => { wakes = []; });

describe("the fake provider (secret in the environment)", () => {
  it("unsigned or wrongly signed: 401 and not one statement", async () => {
    const body = JSON.stringify({ deliveryId: "u-1", tenant: "fake-team", issueId: "i-9" });
    const before = statements;
    expect((await handleWebhook("fake", post(body, {}))).status).toBe(401);
    const bad = signFakeWebhook(body);
    bad.set("x-fake-signature", "0".repeat(64));
    expect((await handleWebhook("fake", post(body, bad))).status).toBe(401);
    expect(statements - before).toBe(0);
    expect(wakes).toEqual([]);
  });

  it("signed: 200, the work queued, one wake tag", async () => {
    await adminQuery(`DELETE FROM jobs WHERE type LIKE 'connector.%'`);
    const body = JSON.stringify({ deliveryId: "s-1", tenant: "fake-team", issueId: "i-1" });
    expect((await handleWebhook("fake", post(body, signFakeWebhook(body)))).status).toBe(200);
    expect(wakes).toEqual(["[wake] webhook:fake"]);
    const q = await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM jobs WHERE type = 'connector.item'`);
    expect(q[0].n).toBe(1);
  });
});

describe("Asana (a stored secret per hook)", () => {
  const hook = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  const url = `http://localhost:3000/api/connectors/webhooks/asana/${hook}`;
  const saveEnv: Record<string, string | undefined> = {};
  beforeAll(() => { for (const k of ["ASANA_CLIENT_ID", "ASANA_CLIENT_SECRET"]) { saveEnv[k] = process.env[k]; process.env[k] = `test-${k}`; } });
  afterAll(() => { for (const [k, v] of Object.entries(saveEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

  it("no signature: 401 and not one statement", async () => {
    const before = statements;
    expect((await handleWebhook("asana", post("{}", {}, url), hook)).status).toBe(401);
    expect(statements - before).toBe(0);
    expect(wakes).toEqual([]);
  });

  it("well-formed for a hook Boredroom doesn't have: the one lookup, then 401", async () => {
    const before = statements;
    expect((await handleWebhook("asana", post('{"events":[]}', { "x-hook-signature": "a".repeat(64) }, url), hook)).status).toBe(401);
    expect(statements - before).toBeGreaterThan(0);
    expect(statements - before).toBeLessThanOrEqual(6); // one worker transaction: BEGIN, its settings, the SELECT, COMMIT
    expect(wakes).toEqual(["[wake] webhook:asana"]);
  });
});

describe("a database without 0061", () => {
  it("a signed delivery: 200 and dropped, noted as missing", async () => {
    await adminQuery(`ALTER TABLE connector_webhook_deliveries RENAME TO connector_webhook_deliveries_away`);
    try {
      const body = JSON.stringify({ deliveryId: "m-1", tenant: "fake-team", issueId: "i-2" });
      vi.spyOn(console, "warn").mockImplementation(() => undefined);
      expect((await handleWebhook("fake", post(body, signFakeWebhook(body)))).status).toBe(200);
      expect(schema0061Missing()).toBe(true);
    } finally {
      await adminQuery(`ALTER TABLE connector_webhook_deliveries_away RENAME TO connector_webhook_deliveries`);
      forget0061();
    }
  });
});
