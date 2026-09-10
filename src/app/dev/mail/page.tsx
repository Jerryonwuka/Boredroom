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
  const messages = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { id: string; to: string; subject: string; text: string; sentAt: string; category: string });
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between"><Logo /><span className="text-sm text-fg-subtle">Local mail sink · {dir}</span></div>
      <h1 className="text-2xl font-display">Development inbox</h1>
      <p className="mt-1 text-sm text-fg-muted">Nothing here was sent to a real mailbox. Links point at this local server.</p>
      <div className="mt-6 space-y-3">
        {messages.length === 0 ? <p className="tile p-6 text-fg-muted">No messages yet.</p> : messages.map((m) => (
          <details key={m.id} className="tile p-4">
            <summary className="cursor-pointer"><span className="font-semibold">{m.subject}</span><span className="ml-2 text-sm text-fg-subtle">to {m.to} · {new Date(m.sentAt).toLocaleString()}</span></summary>
            <pre className="mt-3 whitespace-pre-wrap break-all text-sm text-fg-muted">{m.text}</pre>
          </details>
        ))}
      </div>
    </main>
  );
}
