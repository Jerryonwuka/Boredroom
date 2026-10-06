import { notFound } from "next/navigation";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

/** Development-only inbox for the local mail sink. */
export default function DevMailPage() {
  if (process.env.NODE_ENV === "production" || (process.env.MAIL_PROVIDER ?? "sink") !== "sink") notFound();
  const dir = process.env.MAIL_SINK_DIR ?? "./var/mail-outbox";
  let files: string[] = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse().slice(0, 50); } catch { files = []; }
  const messages = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; to: string; subject: string; text: string; html?: string; sentAt: string; category: string });
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between"><Logo /><span className="text-meta font-normal text-subtle">Local mail sink: {dir}</span></div>
      <h1 className="type-page-title">Development inbox</h1>
      <p className="mt-1 type-paragraph">Nothing here was sent to a real mailbox. Links point at this local server. Every template is on <a className="underline" href="/dev/emails">/dev/emails</a>.</p>
      <div className="mt-6 space-y-3">
        {messages.length === 0 ? <p className="card-panel type-paragraph">No messages yet.</p> : messages.map((m) => (
          <details key={m.id} className="card-panel p-4">
            <summary className="cursor-pointer"><span className="font-semibold">{m.subject}</span><span className="ml-2 text-meta font-normal text-secondary">to {m.to}, {new Date(m.sentAt).toLocaleString()}</span></summary>
            {m.html ? <iframe title={m.subject} srcDoc={m.html} sandbox="" className="mt-3 h-[640px] w-full rounded-[10px] border border-border bg-black" /> : null}
            <pre className="mt-3 whitespace-pre-wrap break-all text-sm font-normal text-secondary">{m.text}</pre>
          </details>
        ))}
      </div>
    </main>
  );
}
