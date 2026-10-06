"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, isApiFailure } from "@/lib/api-client";

/** "Mark read" on one notification (a 28px ghost button): says it is working, and says why when it does not go through. */
export function MarkRead({ orgSlug, id, title }: { orgSlug: string; id: string; title: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="xs" variant="ghost" aria-label={`${pending ? "Marking" : "Mark read"}: ${title}`} disabled={pending}
        onClick={async () => {
          setPending(true); setError(null);
          try { await api(`/api/orgs/${orgSlug}/notifications/${id}`, { method: "PATCH" }); router.refresh(); }
          catch (err) { setError(isApiFailure(err) ? err.error.message : "Not marked: the server could not be reached. Try again."); }
          finally { setPending(false); }
        }}>
        {pending ? "Marking…" : "Mark read"}
      </Button>
      {error ? <p role="alert" className="max-w-48 text-right text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}

/**
 * "Mark all as read": marks each unread notification on the page through the same endpoint as "Mark read", a few at a
 * time, then refreshes. If some do not go through it says how many, and they stay unread to try again.
 */
export function MarkAllRead({ orgSlug, ids }: { orgSlug: string; ids: string[] }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setPending(true); setError(null);
    let failed = 0;
    for (let i = 0; i < ids.length; i += 5) {
      const batch = ids.slice(i, i + 5);
      const results = await Promise.allSettled(batch.map((id) => api(`/api/orgs/${orgSlug}/notifications/${id}`, { method: "PATCH" })));
      failed += results.filter((r) => r.status === "rejected").length;
    }
    setPending(false);
    if (failed) setError(failed === ids.length ? "Nothing was marked: the server could not be reached. Try again." : `${failed} of ${ids.length} could not be marked. Try again.`);
    router.refresh();
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="secondary" loading={pending} onClick={() => void run()}>{pending ? null : <CheckCheck aria-hidden />}{pending ? "Marking…" : "Mark all as read"}</Button>
      {error ? <p role="alert" className="max-w-64 text-right text-xs font-medium text-danger">{error}</p> : null}
    </div>
  );
}
