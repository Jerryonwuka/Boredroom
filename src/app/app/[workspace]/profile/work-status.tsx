"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Segmented } from "@/components/ui/segmented";
import { PresenceDot } from "@/components/ui/presence";
import { api } from "@/lib/api-client";
import { PRESENCE, PRESENCES, type Presence } from "@/lib/presence";

/**
 * The person's work status on their profile, v4: a segmented control (Active, Away, Do not disturb, Offline), each with
 * its dot. A choice saves at once; if it does not go through, the control goes back and says why. The same status the
 * top bar's menu sets.
 */
export function WorkStatus({ value }: { value: Presence }) {
  const router = useRouter();
  const [current, setCurrent] = useState<Presence>(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the page brings a newer status (set from the top bar), it takes over.
  const [seen, setSeen] = useState(value);
  if (seen !== value) { setSeen(value); setCurrent(value); }
  const choose = async (p: Presence) => {
    if (p === current) return;
    const was = current;
    setPending(true); setError(null); setCurrent(p);
    try { await api("/api/me/presence", { method: "PATCH", body: { presence: p } }); router.refresh(); }
    catch { setCurrent(was); setError("Your status did not change. Check your connection and try again."); }
    finally { setPending(false); }
  };
  return (
    <div className="grid gap-2" aria-busy={pending}>
      <Segmented name="presence" aria-label="Work status" value={current} disabled={pending} onChange={(v) => void choose(v as Presence)}
        options={PRESENCES.map((p) => ({ value: p, label: <><span aria-hidden className="inline-flex"><PresenceDot presence={p} size={8} withRing={false} /></span>{PRESENCE[p].label}</> }))} />
      <p className="text-meta font-normal text-secondary">{PRESENCE[current].hint}.</p>
      {error ? <p role="alert" className="text-meta font-medium text-danger">{error}</p> : null}
    </div>
  );
}
