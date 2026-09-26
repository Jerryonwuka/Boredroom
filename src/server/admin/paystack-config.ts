import { z } from "zod";
import { getSetting, setSetting } from "@/server/admin/settings";
import { encryptSecret, decryptSecret } from "@/server/lib/crypto";
import { AppError, invalid } from "@/server/lib/errors";
import type { Admin } from "@/server/admin/auth";

/**
 * Paystack keys live in platform settings under `payments` (owner decision, 25 September 2026): a test pair and a
 * live pair, and a switch that says which pair is in use. Secret keys are stored encrypted with the app secret and
 * never sent back to the browser; the form shows their last four characters. Environment variables remain a
 * fallback for servers that were set up before the Control Center existed.
 */
export type PaymentMode = "test" | "live";
type Stored = { mode: PaymentMode; test_public_key: string; test_secret_key: string; live_public_key: string; live_secret_key: string; updated_at?: string };
const EMPTY: Stored = { mode: "test", test_public_key: "", test_secret_key: "", live_public_key: "", live_secret_key: "" };

export const paymentsSchema = z.object({
  mode: z.enum(["test", "live"]),
  test_public_key: z.string().trim().max(120).refine((v) => !v || v.startsWith("pk_test_"), "A test public key starts with pk_test_"),
  test_secret_key: z.string().trim().max(120).refine((v) => !v || v.startsWith("sk_test_"), "A test secret key starts with sk_test_"),
  live_public_key: z.string().trim().max(120).refine((v) => !v || v.startsWith("pk_live_"), "A live public key starts with pk_live_"),
  live_secret_key: z.string().trim().max(120).refine((v) => !v || v.startsWith("sk_live_"), "A live secret key starts with sk_live_"),
});

async function stored(fresh = false): Promise<Stored> {
  return { ...EMPTY, ...(await getSetting<Partial<Stored>>("payments", {}, fresh)) };
}

const reveal = (enc: string) => (enc ? decryptSecret(enc) ?? "" : "");
const tail = (s: string) => (s ? `…${s.slice(-4)}` : "");

/** The keys in use right now: the chosen pair from settings, or the environment when settings hold nothing. */
export async function paystackConfig(): Promise<{ mode: PaymentMode; publicKey: string; secretKey: string; source: "settings" | "env" | "none" }> {
  const s = await stored();
  const secret = reveal(s.mode === "live" ? s.live_secret_key : s.test_secret_key);
  const pub = s.mode === "live" ? s.live_public_key : s.test_public_key;
  if (secret) return { mode: s.mode, publicKey: pub, secretKey: secret, source: "settings" };
  const envSecret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (envSecret) return { mode: envSecret.startsWith("sk_test_") ? "test" : "live", publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? "", secretKey: envSecret, source: "env" };
  return { mode: s.mode, publicKey: "", secretKey: "", source: "none" };
}

/** Every secret that could have signed a webhook: the pair in use first, then the other one, then the environment. */
export async function paystackSecrets(): Promise<string[]> {
  const s = await stored();
  const keys = [s.mode === "live" ? s.live_secret_key : s.test_secret_key, s.mode === "live" ? s.test_secret_key : s.live_secret_key].map(reveal);
  if (process.env.PAYSTACK_SECRET_KEY) keys.push(process.env.PAYSTACK_SECRET_KEY);
  return Array.from(new Set(keys.filter(Boolean)));
}

/** What the settings page shows: which pair is in use, the public keys, the tails of the secrets, and the URLs to paste into Paystack. */
export async function paystackStatus() {
  const s = await stored(true);
  const cfg = await paystackConfig();
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return {
    mode: s.mode, source: cfg.source, configured: !!cfg.secretKey,
    test: { public_key: s.test_public_key, secret_tail: tail(reveal(s.test_secret_key)), complete: !!(s.test_public_key && s.test_secret_key) },
    live: { public_key: s.live_public_key, secret_tail: tail(reveal(s.live_secret_key)), complete: !!(s.live_public_key && s.live_secret_key) },
    webhook_url: `${origin}/api/billing/paystack/webhook`, callback_url: `${origin}/api/billing/paystack/callback`, updated_at: s.updated_at ?? null,
  };
}

/** Saves the keys. A blank secret keeps the one already stored, so the form never has to re-enter secrets to change the mode. */
export async function savePaymentsSettings(admin: Admin, input: z.infer<typeof paymentsSchema>, reason?: string | null) {
  const prev = await stored(true);
  const next: Stored = {
    mode: input.mode,
    test_public_key: input.test_public_key, live_public_key: input.live_public_key,
    test_secret_key: input.test_secret_key ? encryptSecret(input.test_secret_key) : prev.test_secret_key,
    live_secret_key: input.live_secret_key ? encryptSecret(input.live_secret_key) : prev.live_secret_key,
    updated_at: new Date().toISOString(),
  };
  if (input.mode === "live" && !(next.live_public_key && next.live_secret_key)) throw invalid("Live mode needs both live keys.", { live_secret_key: ["Enter the live secret key before switching to live."] });
  if (input.mode === "test" && !(next.test_public_key && next.test_secret_key)) throw invalid("Test mode needs both test keys.", { test_secret_key: ["Enter the test secret key."] });
  // The audit trail sees which keys changed and the mode, never a key.
  await setSetting(admin, "payments", next, reason ?? `Paystack ${input.mode} mode${input.test_secret_key ? ", test secret updated" : ""}${input.live_secret_key ? ", live secret updated" : ""}`);
  return paystackStatus();
}

/** Calls Paystack with the pair in use and reports what it found, so a wrong key is caught here, not at a customer's checkout. */
export async function testPaystack(mode?: PaymentMode) {
  const s = await stored(true);
  const m = mode ?? s.mode;
  const secret = reveal(m === "live" ? s.live_secret_key : s.test_secret_key) || (m === (await paystackConfig()).mode ? (await paystackConfig()).secretKey : "");
  if (!secret) throw new AppError(422, "PAYSTACK_NOT_CONFIGURED", `No ${m} secret key is stored.`);
  const res = await fetch("https://api.paystack.co/transaction?perPage=1", { headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as { status?: boolean; message?: string; meta?: { total?: number } };
  if (!res.ok || body.status === false) throw new AppError(502, "PAYSTACK_ERROR", `Paystack rejected the ${m} secret key: ${body.message ?? res.statusText}`);
  return { ok: true as const, mode: m, transactions: body.meta?.total ?? 0 };
}
