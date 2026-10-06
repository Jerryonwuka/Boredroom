"use client";

/**
 * The shared client pieces of the Control Center, v4 (design system v4 and its accent rules, owner decisions 6 October
 * 2026): a button that calls an admin endpoint (with a centred confirmation and a reason when the action needs one),
 * right-side sheets for forms (`EditSheet`, `SheetButton`), a JSON form that confirms with a toast, filters that
 * update the URL, a pager, a CSV link, a three-way choice for flags, and the toaster the confirmations float in.
 */
import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, Download, Plus, Upload } from "lucide-react";
import { Toaster } from "sonner";
import { Button, buttonVariants, type ButtonProps } from "@/components/ui/button";
import { EditButton } from "@/components/ui/edit-button";
import { Textarea, Input } from "@/components/ui/input";
import { Dialog, Sheet } from "@/components/ui/sheet";
import { Alert } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { useTheme } from "@/components/ui/theme-toggle";
import { Labelled } from "@/components/admin/fields";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";

type Method = "POST" | "PATCH" | "PUT" | "DELETE";

/** A form inside a sheet closes it when it saves; the sheet hands it this. */
const SheetContext = createContext<{ close: () => void } | null>(null);

const OFFLINE = "Cannot reach the server. Check your connection and try again.";

/**
 * A button that performs one administrative action. With `confirm` it opens a centred dialog (r16, 440px) that names
 * the action; with `reason` the dialog asks why, and the reason goes to the audit trail. The trigger is an outline
 * button (`danger`: outline with red text); the dialog's confirm is the white primary, or the red fill for a
 * destructive action. A failure keeps the dialog open and says why.
 */
export function AdminAction({ path, method = "POST", body, children, confirm, reason = false, danger = false, onDone, size = "sm", variant, className, disabled }: { path: string; method?: Method; body?: Record<string, unknown>; children: ReactNode; confirm?: { title: string; description?: string; label?: string }; reason?: boolean; danger?: boolean; onDone?: (r: unknown) => void; size?: ButtonProps["size"]; variant?: ButtonProps["variant"]; className?: string; disabled?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  const run = async () => {
    setPending(true); setError(null);
    try {
      const r = await api(path, { method, body: { ...(body ?? {}), ...(reason ? { reason: why } : {}) }, retries: 0 });
      setOpen(false);
      setWhy("");
      if (onDone) onDone(r); else router.refresh();
    } catch (err) { setError(isApiFailure(err) ? err.error.message : OFFLINE); }
    finally { setPending(false); }
  };
  const v = variant ?? (danger ? "danger" : "secondary");
  if (!confirm && !reason) {
    return (
      <>
        <Button size={size} variant={v} className={className} disabled={disabled} loading={pending} onClick={run}>{pending ? "Working…" : children}</Button>
        {error ? <p role="alert" className="mt-1 text-xs text-danger">{error}</p> : null}
      </>
    );
  }
  const close = () => { if (pending) return; setOpen(false); setError(null); };
  return (
    <>
      <Button size={size} variant={v} className={className} disabled={disabled} aria-haspopup="dialog" onClick={() => { setError(null); setOpen(true); }}>{children}</Button>
      <Dialog open={open} onClose={close} dismissible={!pending} title={confirm?.title ?? (typeof children === "string" ? children : "Are you sure?")} description={confirm?.description}>
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void run(); }}>
          {reason ? (
            <Labelled label="Reason" hint="written to the audit trail">
              <Textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} maxLength={1000} required minLength={3} placeholder="Why this is being done" />
            </Labelled>
          ) : null}
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={close} disabled={pending}>Cancel</Button>
            <Button type="submit" variant={danger ? "destructive" : "primary"} loading={pending} disabled={reason && why.trim().length < 3}>{pending ? "Working…" : confirm?.label ?? "Confirm"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** An Edit button that opens its form in a right-side sheet (512px; `size="lg"` 720px), so a row never grows to hold a form. */
export function EditSheet({ title, description, label = "Edit", size, children }: { title: string; description?: ReactNode; label?: ReactNode; size?: "sm" | "md" | "lg"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <EditButton label={label} aria-haspopup="dialog" onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title={title} description={description} size={size}>
        <SheetContext.Provider value={{ close: () => setOpen(false) }}>{children}</SheetContext.Provider>
      </Sheet>
    </>
  );
}

/**
 * A button that opens a right-side sheet: "New plan", "Import contacts". The page's one standout action may pass
 * `variant="accent"` (accent rules: never two orange buttons on a screen); the rest stay outline.
 */
export function SheetButton({ label, title, description, icon, variant = "secondary", size = "sm", sheetSize, children }: { label: ReactNode; title: string; description?: ReactNode; icon?: "plus" | "upload"; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; sheetSize?: "sm" | "md" | "lg"; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const Icon = icon === "plus" ? Plus : icon === "upload" ? Upload : null;
  return (
    <>
      <Button variant={variant} size={size} aria-haspopup="dialog" onClick={() => setOpen(true)}>{Icon ? <Icon aria-hidden /> : null}{label}</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title} description={description} size={sheetSize}>
        <SheetContext.Provider value={{ close: () => setOpen(false) }}>{children}</SheetContext.Provider>
      </Sheet>
    </>
  );
}

/**
 * A form whose fields become one JSON body. Field values are read from the form; `transform` shapes them. A save
 * confirms with a toast (`successMessage`, null for none) and refreshes the page; inside a sheet it also closes the
 * sheet, and the actions sit right-aligned with a Cancel. Errors stay in the form, field by field.
 */
export function JsonForm({ path, method = "POST", transform, children, submitLabel = "Save", onDone, className, successMessage = "Saved.", submitVariant = "primary" }: { path: string; method?: Method; transform?: (data: Record<string, FormDataEntryValue>) => Record<string, unknown>; children: ReactNode; submitLabel?: string; onDone?: (r: unknown) => void; className?: string; successMessage?: string | null; submitVariant?: ButtonProps["variant"] }) {
  const router = useRouter();
  const sheet = useContext(SheetContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  return (
    <form className={cn("grid gap-4", className)} onSubmit={async (e) => {
      e.preventDefault(); setPending(true); setError(null); setFieldErrors({});
      const data = Object.fromEntries(new FormData(e.currentTarget).entries());
      try {
        const r = await api(path, { method, body: transform ? transform(data) : data, retries: 0 });
        if (successMessage) successToast(successMessage);
        if (onDone) onDone(r); else router.refresh();
        sheet?.close();
      } catch (err) {
        if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError(OFFLINE);
      } finally { setPending(false); }
    }}>
      {error ? <Alert tone="danger">{error}{Object.keys(fieldErrors).length ? <ul className="mt-1 text-meta">{Object.entries(fieldErrors).map(([k, v]) => <li key={k}>{k}: {v.join(", ")}</li>)}</ul> : null}</Alert> : null}
      {children}
      <div className={cn("flex flex-wrap items-center gap-2 pt-1", sheet && "justify-end")}>
        {sheet ? <Button type="button" variant="secondary" onClick={sheet.close} disabled={pending}>Cancel</Button> : null}
        <Button type="submit" variant={submitVariant} loading={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}

/**
 * Filters as a GET form (a toolbar of filter controls, `F` in fields.tsx): every named field becomes a query
 * parameter and the page starts again at 1. Apply submits; Enter in a text field does too.
 */
export function Filters({ children, className, label = "Filters" }: { children: ReactNode; className?: string; label?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <form aria-label={label} className={cn("mb-4 flex flex-wrap items-center gap-2", className)} onSubmit={(e) => { e.preventDefault(); const p = new URLSearchParams(); for (const [k, v] of new FormData(e.currentTarget).entries()) if (typeof v === "string" && v) p.set(k, v); router.push(`${pathname}?${p}`); }}>
      {children}
      <Button type="submit" size="sm" variant="secondary">Apply</Button>
    </form>
  );
}

/** "21 to 40 of 134", then Previous and Next when there is more than one page. */
export function Pager({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const go = (p: number) => { const q = new URLSearchParams(sp.toString()); q.set("page", String(p)); router.push(`${pathname}?${q}`); };
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <span className="text-meta font-normal tabular-nums text-secondary">{total === 0 ? "Nothing to show" : `${(page - 1) * pageSize + 1} to ${Math.min(total, page * pageSize)} of ${total}`}</span>
      {pages > 1 ? (
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => go(page - 1)}><ChevronLeft aria-hidden />Previous</Button>
          <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => go(page + 1)}>Next<ChevronRight aria-hidden /></Button>
        </div>
      ) : null}
    </nav>
  );
}

/** A small outline link that downloads a CSV. */
export function CsvLink({ href, children = "Export CSV" }: { href: string; children?: ReactNode }) {
  return <a href={href} className={buttonVariants({ variant: "secondary", size: "sm" })}><Download aria-hidden />{children}</a>;
}

/**
 * A three-way choice in the segmented look (fill-1 r10 p2, items h28 r7) for flags: the default, on, off. Real radios,
 * so arrow keys move the choice. The chosen item sits on the canvas colour; "on" is green and "off" red (status
 * meaning). The default carries no orange dot, unlike Segmented: a list of twenty flags would be twenty orange marks.
 */
export function TriState({ name, label, value, onChange, options }: { name: string; label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; tone?: "success" | "danger" }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 gap-0.5 rounded-[10px] bg-fill-1 p-0.5">
      {options.map((o) => {
        const chosen = value === o.value;
        return (
          <label key={o.value} className="relative inline-flex">
            <input type="radio" name={name} value={o.value} checked={chosen} onChange={() => onChange(o.value)}
              className="peer absolute inset-0 m-0 size-full cursor-pointer rounded-[7px] border-0 opacity-0" />
            <span className={cn("inline-flex h-7 items-center rounded-[7px] border px-2.5 text-meta font-medium transition-colors duration-75 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[var(--ring)] pointer-coarse:h-10",
              chosen ? "border-border bg-background shadow-natural-xs" : "border-transparent text-secondary peer-hover:text-foreground",
              chosen && (o.tone === "success" ? "text-success" : o.tone === "danger" ? "text-danger" : "text-foreground"))}>{o.label}</span>
          </label>
        );
      })}
    </div>
  );
}

/** Where the Control Center's toasts float: bottom left, as in the app. */
export function AdminToaster() {
  const theme = useTheme();
  return <Toaster position="bottom-left" theme={theme} offset={20} mobileOffset={12} gap={8} toastOptions={{ unstyled: true, classNames: { toast: "w-auto" } }} />;
}

export { Input };
