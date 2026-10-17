/**
 * Brenda for Mac, phase 2, before migration 0058 (owner request, 12 October 2026; contract D.3): the code runs on a
 * database without it (it waits in db/pending for the owner's go-ahead). Nothing throws; the desktop state reads
 * `act: not_ready`; v2 looks still answer, but propose_task is never offered; the act routes answer 503 ACT_NOT_READY;
 * the owner switch reads as not ready and its write answers 503; Activity, the daily limit and the purge carry on.
 * Local test database only; the model is a scripted fake.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const model = vi.hoisted(() => ({ msgs: [] as Record<string, unknown>[], calls: [] as Record<string, unknown>[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (args: Record<string, unknown>) => { model.calls.push(structuredClone(args)); return model.msgs.shift(); },
      stream: (args: Record<string, unknown>) => {
        model.calls.push(structuredClone(args));
        const next = model.msgs.shift() as { content: { type: string; text?: string }[] };
        async function* events() { for (const [index, b] of next.content.entries()) if (b.type === "text") yield { type: "content_block_delta", index, delta: { type: "text_delta", text: b.text } }; }
        const it = events();
        return { [Symbol.asyncIterator]: () => it, finalMessage: async () => next };
      },
    };
    beta = { messages: { create: async () => { throw new Error("never called before 0058"); } } };
  },
}));
const reqState = vi.hoisted(() => ({ bearer: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(reqState.bearer ? { authorization: `Bearer ${reqState.bearer}` } : {}),
}));

import { resetTestDatabase, adminQuery } from "../helpers/db";
import { buildCompany } from "@/server/services/fixtures";
import { startLink, approveLink, pollLink, desktopState } from "@/server/services/desktop";
import { forget0057 } from "@/server/lib/schema-0057";
import { forget0058 } from "@/server/lib/schema-0058";
import { aiAllowance } from "@/server/services/ai-usage";
import { listActivity } from "@/server/services/assistant-activity";
import { saveScreenHelp, screenHelpView } from "@/server/services/screen-help";
import { purgeTasks } from "@/server/services/act";
import { readNdjson } from "@/server/lib/ndjson";
import { POST as lookPOST } from "@/app/api/orgs/[org]/assistant/look/route";
import { POST as answerPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/answer/route";
import { POST as stepPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/step/route";
import { POST as stopPOST } from "@/app/api/orgs/[org]/assistant/act/[id]/stop/route";
import type { OrgContext } from "@/server/lib/api";

const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6D1/WbfQ7NLm7SV43kEYEQBOSCe5HpXP/APCw9J/5977/AL4T/wCKo+Kn/IvW/wD19L/6A9eWV8rm+b4jCYh0qTVrLofWZPk+GxeGVWqne76ns2geKrHXLx7a0iuUkSMyEyqoGAQOxPrW/Xlnwr/5GG4/69W/9DSvU69fKMVUxeHVWrvdnj5xhKeExLpUtrIKKKK9M8sKKKKACiiigAooooA//9k=";
const saved = { key: process.env.ANTHROPIC_API_KEY, ws: process.env.BRENDA_LOOK_WORKSPACES };
let owner: OrgContext, ada: OrgContext;
let token = "";

/**
 * 0058 moved from db/pending to db/migrations when it was applied (12 October 2026; contract K.10), so the reset applies
 * it: its objects are taken out again here, so this file still proves the code before 0058.
 */
async function before0058() {
  await adminQuery(`DROP TABLE IF EXISTS assistant_tasks CASCADE; DROP TABLE IF EXISTS assistant_task_units CASCADE; DROP TABLE IF EXISTS act_usage_daily CASCADE;
    DROP FUNCTION IF EXISTS assistant_task_units_keep() CASCADE; ALTER TABLE screen_help_settings DROP COLUMN IF EXISTS actions_allowed;`);
}

beforeAll(async () => {
  await resetTestDatabase();
  await before0058();
  forget0057(); forget0058();
  process.env.ANTHROPIC_API_KEY = "test-env-key-not-real";
  process.env.BRENDA_LOOK_WORKSPACES = "company-a";
  const a = await buildCompany("a");
  owner = a.ownerCtx; ada = a.employeeCtx;
  const link = await startLink({ deviceName: "Before Mac" }, { ip: "127.0.9.1", origin: "http://localhost:3000" });
  await approveLink(ada.user, { userCode: link.userCode, orgSlug: ada.org.slug });
  token = ((await pollLink({ deviceCode: link.deviceCode }, { userAgent: "Brenda desktop/test (macos)" })) as { token: string }).token;
});
afterAll(() => {
  for (const [k, v] of [["ANTHROPIC_API_KEY", saved.key], ["BRENDA_LOOK_WORKSPACES", saved.ws]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  reqState.bearer = null;
});
beforeEach(async () => { model.msgs = []; model.calls = []; await adminQuery("DELETE FROM auth_rate_limits WHERE bucket LIKE 'ai.burst:%'"); });

describe("before migration 0058 (contract D.3)", () => {
  it("0058 is not applied here", async () => {
    expect((await adminQuery<{ t: string | null }>("SELECT to_regclass('public.assistant_tasks')::text AS t"))[0].t).toBeNull();
  });
  it("the desktop state: v 2, act not ready; nothing throws", async () => {
    expect((await desktopState(ada)).look).toMatchObject({ ready: true, available: true, v: 2, act: { ready: false, available: false, reason: "not_ready" } });
  });
  it("a v2 look still answers, streamed, without propose_task", async () => {
    model.msgs = [{ content: [{ type: "text", text: "Hold on, that's the Export button." }], stop_reason: "end_turn", model: "m", usage: { input_tokens: 10, output_tokens: 2 } }];
    reqState.bearer = token;
    const q = "rename these files";
    const res = await lookPOST(new Request("http://localhost:3000/api/orgs/company-a/assistant/look", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      version: 2, source: "keys", request: { text: q, via: "voice", ageMs: 10 }, screen: { mediaType: "image/jpeg", data: JPEG, width: 40, height: 24, pointer: null }, crop: null,
      app: { name: "Finder", bundleId: "com.apple.finder" }, hidden: [], abilities: { useMac: true, fileWork: true, busy: null }, files: [], messages: [{ role: "user", content: q }],
    }) }), { params: Promise.resolve({ org: "company-a" }) });
    expect(res.status).toBe(200);
    const lines = await readNdjson(res);
    expect(lines[lines.length - 1].t).toBe("done");
    expect((model.calls[0].tools as { name: string }[]).map((t) => t.name)).not.toContain("propose_task");
    // Phase 3 (contract D.1.5): she says why.
    expect((model.calls[0].system as { text: string }[])[1].text).toContain("Doing things on their Mac isn't set up on this Boredroom yet: if they ask, say so, and help in words.");
  });
  it("the act routes answer 503 ACT_NOT_READY (stop too: there is nothing to stop)", async () => {
    reqState.bearer = token;
    const id = "00000000-0000-4000-8000-000000000001";
    for (const [h, body] of [[answerPOST, { version: 1, answer: "yes", via: "button", planSha256: "0".repeat(64) }], [stepPOST, { version: 1, step: 0, transcript: null, results: [] }], [stopPOST, { version: 1 }]] as const) {
      const res = await h(new Request(`http://localhost:3000/api/orgs/company-a/assistant/act/${id}/x`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ org: "company-a", id }) });
      expect([res.status, (await res.json() as { code: string }).code]).toEqual([503, "ACT_NOT_READY"]);
    }
  });
  it("the owner switch reads as not ready and its write answers 503; the rest of the card still saves", async () => {
    expect(await screenHelpView(owner)).toMatchObject({ ready: true, actReady: false, actionsAllowed: true });
    await expect(saveScreenHelp(owner, { actionsAllowed: false })).rejects.toMatchObject({ status: 503, code: "NOT_READY" });
    await expect(saveScreenHelp(owner, { allowed: true })).resolves.toMatchObject({ allowed: true, actReady: false });
  });
  it("Activity, the daily limit and the purge carry on", async () => {
    expect((await listActivity(ada, { kind: "mac" })).items).toEqual([]);
    expect((await aiAllowance(ada)).ready).toBe(true);
    expect(await purgeTasks()).toEqual({ deleted: 0, expired: 0, stopped: 0 });
  });
});
