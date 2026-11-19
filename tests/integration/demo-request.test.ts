/**
 * Book a demo (owner request, 17 November 2026): the public form's route saves the request on a marketing contact,
 * emails it to Boredroom and sends the person a receipt; asking for a demo is not asking for product news; the form
 * works in every launch mode; and one address cannot flood it.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined }), headers: async () => new Headers() }));

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { withSystem } from "@/server/db";
import { allSettings } from "@/server/admin/settings";
import { audienceSql, listContacts, upsertContact } from "@/server/admin/marketing";
import { POST as demoRoute } from "@/app/api/demo/route";
import { SUPPORT_EMAIL } from "@/lib/legal";

const post = (body: unknown, ip = "192.0.2.20") => demoRoute(
  new Request("http://localhost:3000/api/demo", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-forwarded-for": ip }, body: JSON.stringify(body) }),
  { params: Promise.resolve({}) });
const contact = async (email: string) => (await adminQuery<{ id: string; source: string; is_waitlist: boolean; company: string; company_size: string | null; attributes: { demo_request?: Record<string, string>; marketing_consent?: string } }>(
  `SELECT id, source, is_waitlist, company, company_size, attributes FROM marketing_contacts WHERE email = $1`, [email]))[0];
const mailTo = (to: string) => adminQuery<{ subject: string; category: string }>(`SELECT subject, category FROM email_log WHERE to_email = $1 ORDER BY created_at`, [to]);
const inAudience = async (email: string) => {
  const { sql, params } = audienceSql({ kind: "all" });
  return (await adminQuery<{ n: number }>(`SELECT count(*)::int AS n ${sql} AND c.email = $${params.length + 1}`, [...params, email]))[0].n === 1;
};
const FORM = { firstName: "Dana", lastName: "Demo", email: "Dana@Example.test", company: "Acme Ltd", companySize: "6-20", role: "Head of Ops", times: "Weekday mornings", notes: "The end-of-day report", timezone: "Africa/Lagos", source: "/demo", website: "" };

beforeAll(async () => {
  await resetTestDatabase();
  // Maintenance, with the waitlist closed: the demo form must not depend on the launch mode.
  await adminQuery(`UPDATE platform_settings SET value = $1 WHERE key = 'launch'`, [JSON.stringify({ mode: "maintenance", waitlist_open: false, app_access: false })]);
  await allSettings(true);
});

describe("the Book a demo route", () => {
  it("saves the request on a contact, with no waitlist place and no product news", async () => {
    const res = await post(FORM);
    expect(res.status).toBe(201);
    const c = await contact("dana@example.test");
    expect(c).toMatchObject({ source: "demo", is_waitlist: false, company: "Acme Ltd", company_size: "6-20" });
    expect(c.attributes.demo_request).toMatchObject({ times: "Weekday mornings", notes: "The end-of-day report", timezone: "Africa/Lagos", page: "/demo" });
    expect(Number.isNaN(Date.parse(c.attributes.demo_request!.at))).toBe(false);
    expect(c.attributes.marketing_consent).toBeUndefined();
    expect(await inAudience("dana@example.test")).toBe(false);
  });

  it("emails the request to Boredroom and a receipt to the person", async () => {
    expect(await mailTo(SUPPORT_EMAIL)).toEqual([{ subject: "Demo request: Dana Demo, Acme Ltd", category: "transactional" }]);
    expect(await mailTo("dana@example.test")).toEqual([{ subject: "We have your demo request", category: "transactional" }]);
  });

  it("keeps a waitlist contact on the waitlist, and the Control Center can list who asked", async () => {
    await withSystem((db) => upsertContact(db, { email: "wendy@example.test", firstName: "Wendy", source: "landing", isWaitlist: true }));
    expect((await post({ ...FORM, email: "wendy@example.test", firstName: "Wendy", lastName: "" }, "192.0.2.21")).status).toBe(201);
    const c = await contact("wendy@example.test");
    expect(c).toMatchObject({ source: "landing", is_waitlist: true });
    expect(c.attributes.demo_request).toBeDefined();
    const asked = await listContacts({ demo: true });
    expect(asked.rows.map((r) => r.email).sort()).toEqual(["dana@example.test", "wendy@example.test"]);
  });

  it("refuses a form with no company, a bad address or the hidden field filled, and saves nothing", async () => {
    for (const bad of [{ company: "" }, { email: "not-an-address" }, { website: "https://spam.example" }, { timezone: "<script>" }]) {
      const res = await post({ ...FORM, email: "bad@example.test", ...bad }, "192.0.2.22");
      expect(res.status, JSON.stringify(bad)).toBe(422);
    }
    expect(await contact("bad@example.test")).toBeUndefined();
  });

  it("stops one address after ten requests in the hour", async () => {
    for (let i = 0; i < 10; i++) expect((await post({ ...FORM, email: `flood${i}@example.test` }, "192.0.2.23")).status).toBe(201);
    expect((await post({ ...FORM, email: "flood10@example.test" }, "192.0.2.23")).status).toBe(429);
    expect(await contact("flood10@example.test")).toBeUndefined();
  });
});
