"use client";

/**
 * Track an issue as a to-do (owner decisions, 22 October 2026: connectors; spec §11.5): "A new to-do" (its title prefilled
 * with "{key} {title}", editable) or "One of your to-dos", "Start the timer now", and the readback (the team lead sees the
 * to-do like any to-do; a personal item's link stays private). "Track" is the sheet's main (white) button, as the To-dos
 * sheet's Start.
 */
import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox, Radio } from "@/components/ui/switch";
import { Input, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { CONNECTOR_WORDS } from "@/lib/connectors/words";
import { PROVIDER_LABELS, type DayItem } from "@/lib/connectors/types";

const T = CONNECTOR_WORDS.trackSheet;
const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";

export function TrackSheet({ orgSlug, item, open, onClose, todos, lead }: { orgSlug: string; item: DayItem | null; open: boolean; onClose: () => void; todos: { id: string; title: string }[]; lead?: string | null }) {
  const router = useRouter();
  // A name of its own per sheet and a value per choice (integration fix, 22 October 2026), as the other radio groups do:
  // two groups sharing "track-mode" (another sheet still mounted) unchecked each other's circles.
  const group = `${useId()}-track-mode`;
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState("");
  const [taskId, setTaskId] = useState("");
  const [timer, setTimer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!item) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTitle(`${item.externalKey ? `${item.externalKey} ` : ""}${item.title}`.slice(0, 200));
    setMode("new"); setTaskId(todos[0]?.id ?? ""); setTimer(false); setError(null);
  }, [item, todos]);
  if (!item) return null;
  const key = item.externalKey ?? item.title;
  const app = PROVIDER_LABELS[item.provider];
  async function track() {
    setBusy(true); setError(null);
    try {
      await api(`/api/orgs/${orgSlug}/connectors/items/${item!.id}/track`, { method: "POST", body: mode === "new" ? { newTodo: { title }, startTimer: timer } : { taskId, startTimer: timer } });
      onClose(); router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : OFFLINE); }
    finally { setBusy(false); }
  }
  return (
    <Sheet size="sm" open={open} onClose={onClose} title={T.title(key)}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={mode === "existing" && !taskId} onClick={track}>{T.button}</Button></>}>
      <div className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div role="radiogroup" aria-label={T.title(key)} className="space-y-2">
          <Radio name={group} value="new" checked={mode === "new"} onChange={() => setMode("new")}>{T.newTodo}</Radio>
          {mode === "new" ? <Input aria-label={T.newTodo} value={title} maxLength={200} onChange={(e) => setTitle(e.currentTarget.value)} /> : null}
          <Radio name={group} value="existing" checked={mode === "existing"} onChange={() => setMode("existing")} disabled={!todos.length}>{T.existing}</Radio>
          {mode === "existing" ? (todos.length
            ? <Select aria-label={T.existing} value={taskId} onChange={(e) => setTaskId(e.currentTarget.value)}>{todos.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select>
            : <p className="text-meta font-normal text-secondary">{T.noTodos}</p>) : null}
        </div>
        <Checkbox checked={timer} onChange={(e) => setTimer(e.currentTarget.checked)}>{T.startTimer}</Checkbox>
        <div className="rounded-xl bg-fill-0 p-3 text-meta font-normal text-secondary">
          <p>{T.readback(lead ?? null)}</p>
          {item.visibility === "personal" ? <p className="mt-1">{T.privateLink(app)}</p> : null}
        </div>
      </div>
    </Sheet>
  );
}
