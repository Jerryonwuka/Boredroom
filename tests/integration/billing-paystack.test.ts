/**
 * Paystack trust boundaries (security audit, 23 October 2026: issues 2, 9 and 10). Made-up keys only; Paystack is never
 * called (its verify endpoint is stubbed where the callback path needs it).
 *
 * - Issue 2: a plan is granted only for a reference Boredroom created, and only when the amount, currency and domain
 *   Paystack reports match the stored row. Metadata never names the workspace, plan or interval.
 * - Issue 9: a webhook verifies only with the current mode's secret key.
 * - Issue 10: success and refunded are final; the period is extended only by the first success; replaying the callback
 *   does nothing.
 */
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany, type CompanyFixture } from "@/server/services/fixtures";
import { recordPayment, verifyAndRecord, verifyPaystackSignature, processPaystackEvent, markRefunded } from "@/server/admin/billing";
import { resolveEntitlements } from "@/server/lib/entitlements";
import { createVerifiedUser } from "@/server/services/fixtures";
import { permissionsFor } from "@/server/admin/permissions";
import type { Admin } from "@/server/admin/auth";
import { allSettings } from "@/server/admin/settings";
import { encryptSecret } from "@/server/lib/crypto";
import { withSystem } from "@/server/db";

const ENV_KEY = "sk_test_billing_fixer_env_made_up";
let savedEnv: string | undefined;
let a: CompanyFixture;
let b: CompanyFixture;
let proId: string;
let enterpriseId: string;
let seq = 0;

type Sub = { plan_id: string; status: string; current_period_end: string | null; payment_status: string | null; paystack_subscription_code: string | null };
const sub = async (orgId: string) => (await adminQuery<Sub>(`SELECT plan_id, status, current_period_end::text, payment_status, paystack_subscription_code FROM subscriptions WHERE organisation_id = $1`, [orgId]))[0] ?? null;
const txRow = async (reference: string) => (await adminQuery<{ status: string; organisation_id: string | null }>(`SELECT status, organisation_id FROM payment_transactions WHERE reference = $1`, [reference]))[0] ?? null;
const reviewEvents = async (reference: string) => (await adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM platform_events WHERE type = 'PAYMENT_NEEDS_REVIEW' AND payload->>'reference' = $1`, [reference]))[0].n;

/** A pending row exactly as startCheckout writes it, without calling Paystack. */
async function serverRow(orgId: string, planId: string, amount: number, interval: "monthly" | "annual" = "monthly", currency = "NGN") {
  const reference = `BR-TEST-${Date.now().toString(36)}-${++seq}`.toUpperCase();
  await adminQuery(`INSERT INTO payment_transactions(reference, organisation_id, plan_id, amount, currency, status, interval) VALUES ($1, $2, $3, $4, $5, 'pending', $6)`, [reference, orgId, planId, amount, currency, interval]);
  return reference;
}

const paid = (reference: string, over: Record<string, unknown> = {}) => ({
  id: 1000 + seq, reference, status: "success", amount: 1500000, currency: "NGN", domain: "test", channel: "card", paid_at: new Date().toISOString(),
  customer: { email: "payer@company-a.test", customer_code: "CUS_made_up" }, ...over,
}) as Parameters<typeof recordPayment>[1];

async function useSettings(value: Record<string, unknown> | null) {
  await adminQuery(`DELETE FROM platform_settings WHERE key = 'payments'`);
  if (value) await adminQuery(`INSERT INTO platform_settings(key, value) VALUES ('payments', $1)`, [JSON.stringify(value)]);
  await allSettings(true);
}

beforeAll(async () => {
  savedEnv = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = ENV_KEY;
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
  const plans = await adminQuery<{ id: string; code: string }>(`SELECT id, code FROM plans WHERE code IN ('pro', 'enterprise')`);
  proId = plans.find((p) => p.code === "pro")!.id;
  enterpriseId = plans.find((p) => p.code === "enterprise")!.id;
  // Both workspaces start on Free, active, as every workspace did when billing arrived (migration 0021).
  for (const org of [a.ownerCtx.org.id, b.ownerCtx.org.id]) await adminQuery(`INSERT INTO subscriptions(organisation_id, plan_id, status) SELECT $1, id, 'active' FROM plans WHERE code = 'free' ON CONFLICT (organisation_id) DO NOTHING`, [org]);
  await useSettings(null);
});
afterAll(() => { if (savedEnv === undefined) delete process.env.PAYSTACK_SECRET_KEY; else process.env.PAYSTACK_SECRET_KEY = savedEnv; });
// Nothing here may reach api.paystack.co: every fetch fails unless a test stubs the answer it needs.
beforeEach(() => { vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test")); });
afterEach(() => { vi.restoreAllMocks(); });

describe("issue 2: only references Boredroom created, at the price it asked", () => {
  it("a foreign reference whose metadata names a workspace and the top plan grants nothing and is flagged", async () => {
    const before = await sub(b.ownerCtx.org.id);
    const r = await withSystem((db) => recordPayment(db, paid("FOREIGN-REF-1", { amount: 100, metadata: { organisation_id: b.ownerCtx.org.id, plan_id: enterpriseId, interval: "annual" } })));
    expect(r).toMatchObject({ changed: false, status: "unmatched", organisationId: null });
    expect(await sub(b.ownerCtx.org.id)).toEqual(before);
    expect(await txRow("FOREIGN-REF-1")).toBeNull();
    expect(await reviewEvents("FOREIGN-REF-1")).toBe(1);
  });

  it("a foreign failed charge naming another workspace does not mark it payment_failed", async () => {
    const before = await sub(b.ownerCtx.org.id);
    await processPaystackEvent({ event: "charge.failed", data: paid("FOREIGN-REF-2", { status: "failed", metadata: { organisation_id: b.ownerCtx.org.id } }) as unknown as Record<string, unknown> }, {});
    expect(await sub(b.ownerCtx.org.id)).toEqual(before);
    expect(await txRow("FOREIGN-REF-2")).toBeNull();
  });

  it("an underpayment on our own reference grants nothing and is flagged once", async () => {
    const ref = await serverRow(a.ownerCtx.org.id, proId, 15000000, "annual");
    const before = await sub(a.ownerCtx.org.id);
    const r = await withSystem((db) => recordPayment(db, paid(ref, { amount: 100 })));
    expect(r).toMatchObject({ changed: false, status: "mismatch" });
    expect(await sub(a.ownerCtx.org.id)).toEqual(before);
    expect((await txRow(ref))!.status).toBe("pending");
    await withSystem((db) => recordPayment(db, paid(ref, { amount: 100 })));
    expect(await reviewEvents(ref)).toBe(1);
  });

  it("the wrong currency, or another mode's domain (or none), grants nothing", async () => {
    const before = await sub(a.ownerCtx.org.id);
    const r1 = await serverRow(a.ownerCtx.org.id, proId, 1500000);
    expect((await withSystem((db) => recordPayment(db, paid(r1, { currency: "USD" })))).status).toBe("mismatch");
    const r2 = await serverRow(a.ownerCtx.org.id, proId, 1500000);
    expect((await withSystem((db) => recordPayment(db, paid(r2, { domain: "live" })))).status).toBe("mismatch");
    const r3 = await serverRow(a.ownerCtx.org.id, proId, 1500000);
    expect((await withSystem((db) => recordPayment(db, paid(r3, { domain: undefined })))).status).toBe("mismatch");
    expect(await sub(a.ownerCtx.org.id)).toEqual(before);
  });

  it("metadata cannot change the plan or workspace of our own reference", async () => {
    const ref = await serverRow(a.ownerCtx.org.id, proId, 1500000);
    const beforeB = await sub(b.ownerCtx.org.id);
    const r = await withSystem((db) => recordPayment(db, paid(ref, { metadata: { organisation_id: b.ownerCtx.org.id, plan_id: enterpriseId, interval: "annual" } })));
    expect(r).toMatchObject({ changed: true, status: "success", organisationId: a.ownerCtx.org.id });
    expect((await sub(a.ownerCtx.org.id))!.plan_id).toBe(proId);
    expect(await sub(b.ownerCtx.org.id)).toEqual(beforeB);
  });

  it("subscription.create cannot attach a Paystack subscription to a workspace named only in metadata", async () => {
    await processPaystackEvent({ event: "subscription.create", data: { domain: "test", subscription_code: "SUB_forged", email_token: "tok", customer: { customer_code: "CUS_attacker" }, metadata: { organisation_id: b.ownerCtx.org.id } } }, {});
    expect((await sub(b.ownerCtx.org.id))!.paystack_subscription_code).toBeNull();
  });
});

describe("issue 10: success and refunded are final", () => {
  const months = (from: string | null, to: string | null) => Math.round((new Date(to!).getTime() - new Date(from ?? Date.now()).getTime()) / (30.4 * 86_400_000));

  it("replaying the callback after a refund neither revives the payment nor adds a period", async () => {
    const ref = await serverRow(a.ownerCtx.org.id, proId, 15000000, "annual");
    await withSystem((db) => recordPayment(db, paid(ref, { amount: 15000000 })));
    const paidUp = await sub(a.ownerCtx.org.id);
    await processPaystackEvent({ event: "refund.processed", data: { id: 7001, domain: "test", transaction_reference: ref, status: "processed" } }, {});
    expect((await txRow(ref))!.status).toBe("refunded");
    const refunded = await sub(a.ownerCtx.org.id);
    expect(refunded!.current_period_end).not.toBe(paidUp!.current_period_end);
    // Paystack still reports the original charge as a success; the callback asks it again.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: true, data: paid(ref, { amount: 15000000 }) }));
    const r = await verifyAndRecord(ref);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ changed: false, status: "refunded" });
    expect((await txRow(ref))!.status).toBe("refunded");
    expect((await sub(a.ownerCtx.org.id))!.current_period_end).toBe(refunded!.current_period_end);
  });

  it("success, then a stray failure, then the success again extends the period only once", async () => {
    const ref = await serverRow(a.ownerCtx.org.id, proId, 1500000);
    const before = await sub(a.ownerCtx.org.id);
    await withSystem((db) => recordPayment(db, paid(ref)));
    const once = await sub(a.ownerCtx.org.id);
    expect(months(before!.current_period_end, once!.current_period_end)).toBe(1);
    await processPaystackEvent({ event: "charge.failed", data: paid(ref, { status: "failed" }) as unknown as Record<string, unknown> }, {});
    expect((await txRow(ref))!.status).toBe("success");
    expect((await sub(a.ownerCtx.org.id))!.status).toBe("active");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: true, data: paid(ref) }));
    expect((await verifyAndRecord(ref)).changed).toBe(false);
    expect((await sub(a.ownerCtx.org.id))!.current_period_end).toBe(once!.current_period_end);
  });

  // Verification V5 (security audit, 23 October 2026): a refund also takes back the time that payment bought.
  it("V5: a refunded annual payment ends the year it bought at once, with no grace days", async () => {
    const org = b.ownerCtx.org.id;
    const ref = await serverRow(org, enterpriseId, 15000000, "annual");
    await withSystem((db) => recordPayment(db, paid(ref, { amount: 15000000 })));
    expect((await sub(org))!.status).toBe("active");
    await processPaystackEvent({ event: "refund.processed", data: { id: 7101, domain: "test", transaction_reference: ref, status: "processed" } }, {});
    const after = await sub(org);
    expect(after).toMatchObject({ status: "expired", payment_status: "refunded" });
    expect(new Date(after!.current_period_end!).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    const e = await withSystem((db) => resolveEntitlements(db, org));
    expect(e.lapsed).toBe(true);
    const [ev] = await adminQuery<{ payload: Record<string, unknown> }>(`SELECT payload FROM platform_events WHERE type = 'PAYMENT_REFUNDED' AND payload->>'reference' = $1`, [ref]);
    expect(ev.payload).toMatchObject({ statusBefore: "active", statusAfter: "expired", periodEndBefore: expect.any(String), periodEndAfter: expect.any(String) });
  });

  it("V5: an admin's refund of one of two monthly payments takes one month back and keeps the plan running", async () => {
    const org = b.ownerCtx.org.id;
    await adminQuery(`UPDATE subscriptions SET status = 'active', current_period_end = NULL, payment_status = NULL WHERE organisation_id = $1`, [org]);
    const first = await serverRow(org, proId, 1500000);
    const second = await serverRow(org, proId, 1500000);
    await withSystem((db) => recordPayment(db, paid(first)));
    await withSystem((db) => recordPayment(db, paid(second)));
    const twoMonths = await sub(org);
    const adminUser = await createVerifiedUser("billing-admin@boredroom.test", "Billing Admin");
    const [adm] = await adminQuery<{ id: string }>(`INSERT INTO platform_admins(auth_user_id, role, status) VALUES ($1, 'super_admin', 'active') RETURNING id`, [adminUser.authUserId]);
    const admin: Admin = { user: { profileId: adminUser.profileId, authUserId: adminUser.authUserId, email: adminUser.email, displayName: adminUser.displayName, emailVerified: true, sessionId: "test", impersonation: null }, adminId: adm.id, role: "super_admin", permissions: permissionsFor("super_admin"), ip: null };
    const [tx] = await adminQuery<{ id: string }>(`SELECT id FROM payment_transactions WHERE reference = $1`, [second]);
    await markRefunded(admin, tx.id, "customer asked");
    const after = await sub(org);
    expect(after).toMatchObject({ status: "active", payment_status: "refunded" });
    expect(months(after!.current_period_end, twoMonths!.current_period_end)).toBe(1);
    const [audit] = await adminQuery<{ after: Record<string, unknown> }>(`SELECT after FROM platform_audit_events WHERE action = 'payment.refunded' AND target_id = $1`, [tx.id]);
    expect(audit.after).toMatchObject({ status: "refunded", subscription: "active", periodEnd: expect.any(String) });
  });

  it("a reference Boredroom never created is not even looked up at Paystack from the callback", async () => {
    const fetchSpy = vi.mocked(globalThis.fetch);
    const r = await verifyAndRecord("BR-NOT-OURS-123");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r).toMatchObject({ changed: false, status: "unmatched", organisationId: null });
  });
});

describe("issue 9: webhooks verify only with the current mode's key", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "X", domain: "live" } });
  const sign = (key: string) => createHmac("sha512", key).update(body).digest("hex");
  const TEST_KEY = "sk_test_stored_made_up", LIVE_KEY = "sk_live_stored_made_up";

  it("in live mode, the stored test key and the environment's test key are refused; the live key passes", async () => {
    await useSettings({ mode: "live", test_public_key: "pk_test_x", test_secret_key: encryptSecret(TEST_KEY), live_public_key: "pk_live_x", live_secret_key: encryptSecret(LIVE_KEY) });
    expect(await verifyPaystackSignature(body, sign(TEST_KEY))).toBe(false);
    expect(await verifyPaystackSignature(body, sign(ENV_KEY))).toBe(false);
    expect(await verifyPaystackSignature(body, sign(LIVE_KEY))).toBe(true);
  });

  it("in test mode the live key is refused", async () => {
    await useSettings({ mode: "test", test_public_key: "pk_test_x", test_secret_key: encryptSecret(TEST_KEY), live_public_key: "pk_live_x", live_secret_key: encryptSecret(LIVE_KEY) });
    expect(await verifyPaystackSignature(body, sign(LIVE_KEY))).toBe(false);
    expect(await verifyPaystackSignature(body, sign(TEST_KEY))).toBe(true);
  });

  it("with nothing stored, the environment's key is the current one", async () => {
    await useSettings(null);
    expect(await verifyPaystackSignature(body, sign(ENV_KEY))).toBe(true);
    expect(await verifyPaystackSignature(body, sign(LIVE_KEY))).toBe(false);
  });

  it("an event from the other mode's domain is stored but not applied", async () => {
    await useSettings(null); // test mode, from the environment's sk_test_ key
    const ref = await serverRow(a.ownerCtx.org.id, proId, 1500000);
    await withSystem((db) => recordPayment(db, paid(ref)));
    await processPaystackEvent({ event: "refund.processed", data: { id: 7002, domain: "live", transaction_reference: ref } }, {});
    expect((await txRow(ref))!.status).toBe("success");
    const ev = (await adminQuery<{ error: string | null }>(`SELECT error FROM paystack_events WHERE event_key = $1`, ["refund.processed:7002"]))[0];
    expect(ev.error).toMatch(/domain/i);
  });
});
