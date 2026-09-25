"use client";

/**
 * The shared client pieces of the Control Center: a button that calls an admin endpoint (with a confirmation and a
 * reason when the action needs one), a JSON form, filters that update the URL, a pager, and a CSV link.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { X, Download } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Textarea, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Method = "POST" | "PATCH" | "PUT" | "DELETE";

/** A button that performs one administrative action. With `confirm` it opens a dialog; with `reason` it asks for one. */
export function AdminAction({ path, method = "POST", body, children, confirm, reason = false, danger = false, onDone, size = "sm", variant, className, disabled }: { path: string; method?: Method; body?: Record<string, unknown>; children: ReactNode; confirm?: { title: string; description?: string; label?: string }; reason?: boolean; danger?: boolean; onDone?: (r: unknown) => void; size?: ButtonProps["size"]; variant?: ButtonProps["variant"]; className?: string; disabled?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const titleId = useId();
  const run = async () => {
    setPending(true); setError(null);
    try {
      const r = await api(path, { method, body: { ...(body ?? {}), ...(reason ? { reason: why } : {}) }, retries: 0 });
      ref.current?.close();
      setWhy("");
      onDone ? onDone(r) : router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); }
    finally { setPending(false); }
  };
  const v = variant ?? (danger ? "danger" : "outline");
  if (!confirm && !reason) return <><Button size={size} variant={v} className={className} disabled={pending || disabled} onClick={run}>{pending ? "Working…" : children}</Button>{error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}</>;
  return (
    <>
      <Button size={size} variant={v} className={className} disabled={disabled} onClick={() => ref.current?.showModal()}>{children}</Button>
      <dialog ref={ref} className="sheet" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); ref.current?.close(); }}>
        <form className="grid gap-3 p-5" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          <div className="flex items-start justify-between gap-3">
            <div><h2 id={titleId} className="font-display text-xl">{confirm?.title ?? String(children)}</h2>{confirm?.description ? <p className="mt-1 text-sm text-fg-muted">{confirm.description}</p> : null}</div>
            <Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => ref.current?.close()}><X className="size-4" aria-hidden /></Button>
          </div>
          {reason ? <label className="grid gap-1.5 text-sm font-medium text-fg-muted"><span className="font-medium">Reason <span className="text-fg-subtle">(written to the audit trail)</span></span><Textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} maxLength={1000} required minLength={3} placeholder="Why this is being done" /></label> : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => ref.current?.close()}>Cancel</Button><Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending || (reason && why.trim().length < 3)}>{pending ? "Working…" : confirm?.label ?? "Confirm"}</Button></div>
        </form>
      </dialog>
    </>
  );
}

/** An Edit link that opens its form in a sheet, so a table row never has to grow to hold a form. */
export function EditSheet({ title, label = "Edit", children }: { title: string; label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button type="button" className="text-sm text-fg-muted hover:text-fg" onClick={() => ref.current?.showModal()}>{label}</button>
      <dialog ref={ref} className="sheet" aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); ref.current?.close(); }}>
        <div className="grid gap-4 p-5">
          <div className="flex items-start justify-between gap-3"><h2 id={titleId} className="font-display text-xl">{title}</h2><Button type="button" variant="ghost" size="icon" aria-label="Close" onClick={() => ref.current?.close()}><X className="size-4" aria-hidden /></Button></div>
          {children}
        </div>
      </dialog>
    </>
  );
}

/** A form whose fields become one JSON body. Field values are read from the form; numbers and booleans by `type`. */
export function JsonForm({ path, method = "POST", transform, children, submitLabel = "Save", onDone, className, successMessage = "Saved." }: { path: string; method?: Method; transform?: (data: Record<string, FormDataEntryValue>) => Record<string, unknown>; children: ReactNode; submitLabel?: string; onDone?: (r: unknown) => void; className?: string; successMessage?: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [done, setDone] = useState<string | null>(null);
  return (
    <form className={cn("grid gap-4", className)} onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null); setFieldErrors({}); setDone(null);
      const data = Object.fromEntries(new FormData(e.currentTarget).entries());
      try { const r = await api(path, { method, body: transform ? transform(data) : data, retries: 0 }); setDone(successMessage); onDone ? onDone(r) : router.refresh(); }
      catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); }
      finally { setPending(false); }
    }}>
      {error ? <Alert tone="danger">{error}{Object.keys(fieldErrors).length ? <ul className="mt-1 text-xs">{Object.entries(fieldErrors).map(([k, v]) => <li key={k}>{k}: {v.join(", ")}</li>)}</ul> : null}</Alert> : null}
      {done ? <Alert tone="success">{done}</Alert> : null}
      {children}
      <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : submitLabel}</Button></div>
    </form>
  );
}

/** Filters as a GET form: every named field becomes a query parameter, and the page is reset. */
export function Filters({ children, className }: { children: ReactNode; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <form className={cn("chip mb-4 flex flex-wrap items-end gap-2 px-3 py-2.5", className)} onSubmit={(e) => { e.preventDefault(); const p = new URLSearchParams(); for (const [k, v] of new FormData(e.currentTarget).entries()) if (typeof v === "string" && v) p.set(k, v); router.push(`${pathname}?${p}`); }}>
      {children}
      <Button type="submit" size="sm" variant="subtle" className="rounded-full">Apply</Button>
    </form>
  );
}

export function Pager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => { const q = new URLSearchParams(sp.toString()); q.set("page", String(p)); router.push(`${pathname}?${q}`); };
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm text-fg-muted">
      <span className="tabular-nums">{total === 0 ? "Nothing to show" : `${(page - 1) * pageSize + 1} to ${Math.min(total, page * pageSize)} of ${total}`}</span>
      <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => go(page - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => go(page + 1)}>Next</Button></div>
    </div>
  );
}

export function CsvLink({ href, children = "Export CSV" }: { href: string; children?: ReactNode }) {
  return <a href={href} className="btn inline-flex h-9 items-center gap-2 rounded-[10px] px-3 text-sm font-medium"><Download className="size-4" aria-hidden />{children}</a>;
}

export { Input };
