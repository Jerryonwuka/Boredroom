import { describe, expect, it } from "vitest";
import nodemailer, { type Transporter } from "nodemailer";
import { ResendMailProvider, SmtpMailProvider, mailConfigProblem } from "@/server/lib/mail";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { f, calls };
}

describe("SMTP mail provider (Nodemailer)", () => {
  it("produces a complete message through a real Nodemailer transport", async () => {
    // jsonTransport runs Nodemailer's full message build (addresses, headers, ids) without a network.
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const p = new SmtpMailProvider(transporter, "Boredroom <no-reply@example.com>");
    const r = await p.send({ to: "ada@example.com", subject: "Hi", text: "Hello", category: "verify_email" });
    expect(r.id).toMatch(/^<.+@.+>$/);
  });

  it("builds a STARTTLS transport from smtp:// and a TLS transport from smtps://", () => {
    const plain = SmtpMailProvider.fromUrl("smtp://you%40example.com:key@smtp-relay.brevo.com:587", "Boredroom <no-reply@example.com>");
    const tls = SmtpMailProvider.fromUrl("smtps://you%40example.com:key@smtp-relay.brevo.com:465", "Boredroom <no-reply@example.com>");
    const opts = (p: SmtpMailProvider) => (p as unknown as { transporter: { options: Record<string, unknown> } }).transporter.options;
    expect(opts(plain)).toMatchObject({ host: "smtp-relay.brevo.com", port: 587, secure: false, requireTLS: true, auth: { user: "you@example.com", pass: "key" } });
    expect(opts(tls)).toMatchObject({ host: "smtp-relay.brevo.com", port: 465, secure: true, requireTLS: false });
  });

  it("explains a relay failure instead of hiding it", async () => {
    const transporter = { sendMail: async () => { throw new Error("535 Authentication failed"); }, verify: async () => { throw new Error("535 Authentication failed"); } } as unknown as Transporter;
    const p = new SmtpMailProvider(transporter, "Boredroom <no-reply@example.com>");
    await expect(p.send({ to: "ada@example.com", subject: "Hi", text: "Hello", category: "invitation" })).rejects.toThrow(/SMTP delivery failed: 535 Authentication failed/);
    await expect(p.verify()).rejects.toThrow(/Cannot log in to the SMTP relay: 535/);
  });
});

describe("SMTP message content", () => {
  it("includes from, to, subject, text and the X-Mailin-Tag header", async () => {
    let captured: Record<string, unknown> | null = null;
    const transporter = { sendMail: async (m: Record<string, unknown>) => { captured = m; return { messageId: "<id@example.com>" }; } } as unknown as Transporter;
    const p = new SmtpMailProvider(transporter, "Boredroom <no-reply@example.com>");
    const r = await p.send({ to: "ada@example.com", subject: "Hi", text: "Hello", category: "recover password" });
    expect(r.id).toBe("<id@example.com>");
    expect(captured).toMatchObject({ from: "Boredroom <no-reply@example.com>", to: "ada@example.com", subject: "Hi", text: "Hello", headers: { "X-Mailin-Tag": "recover_password" } });
    expect((captured as unknown as Record<string, unknown>).html).toBeUndefined();
  });
});

describe("Resend mail provider", () => {
  it("posts the message to Resend with the API key, sender and category tag", async () => {
    const { f, calls } = fakeFetch(200, { id: "msg_123" });
    const p = new ResendMailProvider("re_test", "Boredroom <no-reply@example.com>", f);
    const r = await p.send({ to: "ada@example.com", subject: "Hi", text: "Hello", category: "verify_email" });
    expect(r.id).toBe("msg_123");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({ from: "Boredroom <no-reply@example.com>", to: ["ada@example.com"], subject: "Hi", text: "Hello", tags: [{ name: "category", value: "verify_email" }] });
    expect(body.html).toBeUndefined();
  });

  it("surfaces Resend's own reason when the message is refused", async () => {
    const { f } = fakeFetch(403, { name: "validation_error", message: "The example.com domain is not verified." });
    const p = new ResendMailProvider("re_test", "Boredroom <no-reply@example.com>", f);
    await expect(p.send({ to: "ada@example.com", subject: "Hi", text: "Hello", category: "invitation" })).rejects.toThrow(/validation_error: The example.com domain is not verified/);
  });

  it("reports a network failure instead of hanging or hiding it", async () => {
    const f = (async () => { throw new Error("getaddrinfo ENOTFOUND api.resend.com"); }) as unknown as typeof fetch;
    const p = new ResendMailProvider("re_test", "Boredroom <no-reply@example.com>", f);
    await expect(p.send({ to: "ada@example.com", subject: "Hi", text: "Hello", category: "test" })).rejects.toThrow(/Resend is not reachable/);
  });
});

describe("mail configuration check", () => {
  const from = "Boredroom <no-reply@example.com>";
  it("accepts the sink without further settings", () => {
    expect(mailConfigProblem({ MAIL_PROVIDER: "sink" })).toBeNull();
    expect(mailConfigProblem({})).toBeNull();
  });
  it("requires a usable SMTP_URL and a real sender for smtp", () => {
    expect(mailConfigProblem({ MAIL_PROVIDER: "smtp" })).toMatch(/SMTP_URL/);
    expect(mailConfigProblem({ MAIL_PROVIDER: "smtp", SMTP_URL: "not a url" })).toMatch(/must look like/);
    expect(mailConfigProblem({ MAIL_PROVIDER: "smtp", SMTP_URL: "https://smtp-relay.brevo.com" })).toMatch(/must look like/);
    expect(mailConfigProblem({ MAIL_PROVIDER: "smtp", SMTP_URL: "smtp://smtp-relay.brevo.com:587" })).toMatch(/login and password/);
    expect(mailConfigProblem({ MAIL_PROVIDER: "smtp", SMTP_URL: "smtp://me%40example.com:key@smtp-relay.brevo.com:587" })).toMatch(/MAIL_FROM/);
    expect(mailConfigProblem({ MAIL_PROVIDER: "smtp", SMTP_URL: "smtp://me%40example.com:key@smtp-relay.brevo.com:587", MAIL_FROM: "Boredroom <no-reply@boredroom.local>" })).toMatch(/MAIL_FROM/);
    expect(mailConfigProblem({ MAIL_PROVIDER: "smtp", SMTP_URL: "smtp://me%40example.com:key@smtp-relay.brevo.com:587", MAIL_FROM: from })).toBeNull();
    expect(mailConfigProblem({ MAIL_PROVIDER: "smtp", SMTP_URL: "smtps://me%40example.com:key@smtp-relay.brevo.com:465", MAIL_FROM: from })).toBeNull();
  });
  it("requires a key and a real sender for resend", () => {
    expect(mailConfigProblem({ MAIL_PROVIDER: "resend" })).toMatch(/RESEND_API_KEY/);
    expect(mailConfigProblem({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x" })).toMatch(/MAIL_FROM/);
    expect(mailConfigProblem({ MAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x", MAIL_FROM: from })).toBeNull();
  });
  it("rejects unknown providers by name", () => {
    expect(mailConfigProblem({ MAIL_PROVIDER: "sendgrid" })).toMatch(/not supported/);
  });
});
