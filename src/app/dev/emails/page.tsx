import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import { verifyEmailMail, resetPasswordMail, invitationMail, testMail } from "@/server/lib/emails";

export const dynamic = "force-dynamic";
const SAMPLE_EXPIRY = new Date("2026-10-01T09:00:00Z");

/** Development-only gallery of every email template, rendered as a mail client would see it. */
export default function DevEmailsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const samples = [
    { name: "Confirm your email", ...verifyEmailMail(`${origin}/verify?token=sample`) },
    { name: "Choose a new password", ...resetPasswordMail(`${origin}/recover/reset?token=sample`) },
    { name: "Invitation", ...invitationMail({ inviter: "Ada Okafor", org: "Company A", role: "employee", team: "Design", email: "new.person@example.com", url: `${origin}/invite/sample`, expiresAt: SAMPLE_EXPIRY }) },
    { name: "Mail test", ...testMail("smtp") },
  ];
  return (
    <main id="main" className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between"><Logo /><span className="text-meta font-normal text-subtle">Email templates</span></div>
      <h1 className="type-page-title">Every email, as sent</h1>
      <p className="mt-1 type-paragraph">Rendered from <code>src/server/lib/emails.ts</code> with sample links. The plain-text twin sits under each one.</p>
      <div className="mt-6 grid gap-8">
        {samples.map((s) => (
          <section key={s.name} className="card-panel overflow-hidden p-0">
            <h2 className="type-section-title border-b border-border px-5 py-3">{s.name}</h2>
            <iframe title={s.name} srcDoc={s.html} sandbox="" className="h-[720px] w-full bg-black" />
            <details className="border-t border-border px-5 py-3"><summary className="cursor-pointer text-sm text-secondary">Plain text</summary><pre className="mt-2 whitespace-pre-wrap text-xs font-normal text-secondary">{s.text}</pre></details>
          </section>
        ))}
      </div>
    </main>
  );
}
