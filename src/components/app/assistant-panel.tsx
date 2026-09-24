"use client";

/**
 * The to-do assistant on My Day: type or dictate what you are working on; it proposes to-dos (and, for team leads,
 * who each one is for). Nothing is created until the member confirms; each accepted item then goes through
 * the normal to-do endpoint, so assignees are notified the usual way.
 *
 * Dictation uses the browser's own speech recognition (see `hooks/use-dictation`); while listening, the orb turns
 * and ripples with the voice so the person can see they are being heard. No audio is uploaded.
 */
import { useState } from "react";
import { Mic, MicOff, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import { useDictation } from "@/hooks/use-dictation";
import { api, isApiFailure } from "@/lib/api-client";

type Person = { id: string; display_name: string };
type Proposal = { title: string; description: string | null; dueAt: string | null; assigneeMembershipId: string | null; assigneeName: string | null; unmatchedAssignee: string | null; estimateMinutes: number | null };
type PlanResult = { items: Proposal[]; engine: "claude" | "builtin"; reply: string | null; note: string | null; people: Person[] };

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AssistantPanel({ orgSlug, people, configured, onCreated, onClose }: { orgSlug: string; people: Person[]; configured: boolean; onCreated: (count: number) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<"plan" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [items, setItems] = useState<Proposal[]>([]);
  const [voiceActive, setVoiceActive] = useState(false);
  const dictation = useDictation(text, setText);

  async function plan() {
    if (!text.trim()) return;
    if (dictation.listening) dictation.stop();
    setPending("plan"); setError(null);
    try { const r = await api<PlanResult>(`/api/orgs/${orgSlug}/assistant/plan`, { method: "POST", body: { text: text.trim() } }); setResult(r); setItems(r.items); if (r.items.length === 0) setError("No to-dos found in that note. Try one action per sentence, e.g. “Finish the logo export by Friday.”"); }
    catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setPending(null); }
  }

  async function create() {
    setPending("create"); setError(null);
    let n = 0;
    try {
      for (const it of items) {
        if (!it.title.trim()) continue;
        await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: { title: it.title.trim().slice(0, 200), description: it.description || null, dueAt: it.dueAt, assigneeMembershipId: it.assigneeMembershipId, estimateMinutes: it.estimateMinutes } });
        n++;
      }
      setText(""); setItems([]); setResult(null); onCreated(n);
    } catch (err) { setError(`${n} added. ${isApiFailure(err) ? err.error.message : "Cannot reach the server."}`); if (n) onCreated(n); setItems((cur) => cur.slice(n)); }
    finally { setPending(null); }
  }

  const update = (i: number, patch: Partial<Proposal>) => setItems((cur) => cur.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const shownError = error ?? dictation.error;

  return (
    <section aria-labelledby="assistant-heading" className="tile space-y-3 border-accent/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="assistant-heading" className="flex items-center gap-2 font-display text-lg"><Sparkles className="h-4 w-4 text-accent" aria-hidden />Assistant</h2>
          <p className="text-sm text-fg-muted">{people.length ? "Say or type what needs doing and who should do it. It drafts the to-dos; you confirm." : "Say or type what you are working on. It drafts your to-dos; you confirm."}</p>
        </div>
        <Button size="icon" variant="ghost" aria-label="Close assistant" onClick={() => { dictation.stop(); onClose(); }}><X className="h-4 w-4" /></Button>
      </div>
      {!configured ? <Alert tone="warning">The AI is not connected yet, so a simple built-in parser makes these suggestions. An organisation owner connects Claude under Settings, AI assistant (an Anthropic API key).</Alert> : null}
      {dictation.listening ? (
        <div className="flex items-center gap-4 rounded-[var(--radius)] border border-accent/40 bg-accent-soft/40 p-3">
          <div className="size-24 shrink-0"><VoicePoweredOrb enableVoiceControl onVoiceDetected={setVoiceActive} className="rounded-full" /></div>
          <div className="min-w-0 flex-1">
            <p className="eyebrow eyebrow-accent">Listening</p>
            <p role="status" className="mt-1 text-sm text-fg-muted">{voiceActive ? "Hearing you. Keep going, one task per sentence." : dictation.heardWords ? `${dictation.heardWords} word${dictation.heardWords === 1 ? "" : "s"} so far. Press Stop when you are done.` : "Speak naturally, one task per sentence."}</p>
          </div>
          <Button type="button" variant="danger" onClick={() => dictation.stop()}><MicOff className="h-4 w-4" aria-hidden />Stop</Button>
        </div>
      ) : null}
      <Textarea aria-label="What are you working on?" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} placeholder={people.length ? "e.g. Ask Ada to redo the homepage banner by Monday. Ben should fix the checkout bug today. I will prepare the sprint review." : "e.g. Finish the logo export by Friday, then update the brand deck. Also reply to the client email tomorrow morning."} />
      <div className="flex flex-wrap items-center gap-2">
        {dictation.supported ? (dictation.listening ? null : <Button type="button" variant="outline" onClick={() => void dictation.toggle()}><Mic className="h-4 w-4" aria-hidden />Dictate</Button>) : dictation.supported === false ? <span className="text-xs text-fg-subtle">This browser has no dictation (Firefox and Brave do not offer it). Use Chrome, Edge or Safari, or type the note.</span> : null}
        <Button type="button" disabled={pending !== null || !text.trim()} onClick={plan}>{pending === "plan" ? "Thinking…" : "Suggest to-dos"}</Button>
      </div>
      {shownError ? <Alert tone="danger">{shownError}</Alert> : null}
      {result?.reply ? <div className="flex gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 p-3 text-sm"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden /><p>{result.reply}</p></div> : null}
      {result ? <p className="eyebrow">{result.engine === "claude" ? "Suggested by Claude. Check the details, then add." : "Suggested by the built-in parser."}{result.note ? ` ${result.note}` : ""}</p> : null}
      {result && items.length === 0 && !error ? <p className="text-sm text-fg-muted">No to-dos to add from that note.</p> : null}
      {items.length ? (
        <div className="space-y-2">
          <ul className="space-y-2">{items.map((it, i) => (
            <li key={i} className="grid gap-2 rounded-xl border border-border bg-inset p-3 md:grid-cols-[1fr_auto_auto_auto]">
              <div className="grid gap-1">
                <Input aria-label={`To-do ${i + 1} title`} value={it.title} onChange={(e) => update(i, { title: e.target.value })} maxLength={200} />
                {it.unmatchedAssignee ? <p className="text-xs text-warning">“{it.unmatchedAssignee}” is not on your team; choose who this is for.</p> : null}
              </div>
              {people.length ? <Select aria-label={`To-do ${i + 1} assignee`} className="h-10 w-44 py-1 text-sm" value={it.assigneeMembershipId ?? ""} onChange={(e) => update(i, { assigneeMembershipId: e.target.value || null, unmatchedAssignee: null })}><option value="">Me</option>{people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</Select> : null}
              <Input aria-label={`To-do ${i + 1} due`} type="datetime-local" className="h-10 w-48 py-1 text-sm" value={toLocalInput(it.dueAt)} onChange={(e) => update(i, { dueAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              <Button size="icon" variant="ghost" aria-label="Remove suggestion" onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
            </li>
          ))}</ul>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending !== null} onClick={create}>{pending === "create" ? "Adding…" : `Add ${items.length} to-do${items.length === 1 ? "" : "s"}`}</Button>
            <Button variant="ghost" onClick={() => { setItems([]); setResult(null); }}>Discard</Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
