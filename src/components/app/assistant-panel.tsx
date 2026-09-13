"use client";

/**
 * The to-do assistant: type or dictate what you are working on; it proposes to-dos (and, for team leads,
 * who each one is for). Nothing is created until the member confirms; each accepted item then goes through
 * the normal to-do endpoint, so assignees are notified the usual way.
 *
 * Dictation uses the browser's own speech recognition (Chrome, Edge and Safari have it). No audio is uploaded.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

type Person = { id: string; display_name: string };
type Proposal = { title: string; description: string | null; dueAt: string | null; assigneeMembershipId: string | null; assigneeName: string | null; unmatchedAssignee: string | null; estimateMinutes: number | null };
type PlanResult = { items: Proposal[]; engine: "claude" | "builtin"; note: string | null; people: Person[] };

type SpeechRecognitionLike = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
function speechCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AssistantPanel({ orgSlug, people, configured, onCreated, onClose }: { orgSlug: string; people: Person[]; configured: boolean; onCreated: (count: number) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  // null during server render / hydration, then the browser's real answer.
  const speechSupported = useSyncExternalStore(() => () => undefined, () => !!speechCtor(), () => null);
  const [pending, setPending] = useState<"plan" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [items, setItems] = useState<Proposal[]>([]);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const base = useRef("");

  useEffect(() => () => { rec.current?.stop(); }, []);

  function toggleMic() {
    if (listening) { rec.current?.stop(); setListening(false); return; }
    const Ctor = speechCtor(); if (!Ctor) return;
    const r = new Ctor(); rec.current = r;
    r.lang = navigator.language || "en-GB"; r.continuous = true; r.interimResults = true;
    base.current = text ? text.trimEnd() + " " : "";
    r.onresult = (e) => {
      let finalText = "", interim = "";
      for (let i = 0; i < e.results.length; i++) { const res = e.results[i]; const t = res[0].transcript; if (res.isFinal) finalText += t + " "; else interim += t; }
      setText(base.current + finalText + interim);
    };
    r.onerror = (e) => { setError(e.error === "not-allowed" ? "Microphone access was declined." : `Dictation stopped (${e.error}).`); setListening(false); };
    r.onend = () => setListening(false);
    try { r.start(); setListening(true); setError(null); } catch { setError("Could not start dictation."); }
  }

  async function plan() {
    if (!text.trim()) return;
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

  return (
    <section aria-labelledby="assistant-heading" className="tile space-y-3 border-accent/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="assistant-heading" className="flex items-center gap-2 font-display text-lg"><Sparkles className="h-4 w-4 text-accent" aria-hidden />Assistant</h2>
          <p className="text-sm text-fg-muted">{people.length ? "Say or type what needs doing and who should do it. It drafts the to-dos; you confirm." : "Say or type what you are working on. It drafts your to-dos; you confirm."}</p>
        </div>
        <Button size="icon" variant="ghost" aria-label="Close assistant" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <Textarea aria-label="What are you working on?" value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={4000} placeholder={people.length ? "e.g. Ask Ada to redo the homepage banner by Monday. Ben should fix the checkout bug today. I will prepare the sprint review." : "e.g. Finish the logo export by Friday, then update the brand deck. Also reply to the client email tomorrow morning."} />
      <div className="flex flex-wrap items-center gap-2">
        {speechSupported ? <Button type="button" variant={listening ? "danger" : "outline"} onClick={toggleMic}>{listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}{listening ? "Stop dictating" : "Dictate"}</Button> : speechSupported === false ? <span className="text-xs text-fg-subtle">Dictation needs Chrome, Edge or Safari; typing works everywhere.</span> : null}
        <Button type="button" disabled={pending !== null || !text.trim()} onClick={plan}>{pending === "plan" ? "Thinking…" : "Suggest to-dos"}</Button>
        {listening ? <span className="text-xs text-danger">Listening… speak naturally, one task per sentence.</span> : null}
      </div>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {result ? <p className="text-xs text-fg-subtle">{result.engine === "claude" ? "Suggested by Claude." : configured ? "Suggested by the built-in parser." : "Suggested by the built-in parser (no AI key configured; set ANTHROPIC_API_KEY on the server for smarter suggestions)."}{result.note ? ` ${result.note}` : ""}</p> : null}
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
