"use client";

/**
 * "How I like things done" (owner decisions, 8–9 October 2026: phase 7c; contract D.1 and D.5), in Settings → Your
 * assistant after Abilities: the person's own list, in their own words, of how they like their assistant to work for
 * them (tone, sign-off, length, how reports read, when to keep quiet). At most 16, each up to 150 characters. Only the
 * person sees it: the owner and HR never do, and nothing about it is logged or broadcast. Their assistant follows it
 * for style only, as quoted data: it never changes what the assistant may do (the server refuses a line that reads like
 * a permission, and says where permissions live). The assistant never learns silently: in chat it asks "Should I
 * remember …?" and the person's Confirm adds the line here, marked "Added in chat".
 *
 * The card: a list of the lines (each with Edit, an inline one-line box with its counter, Save and Cancel, Escape
 * cancels; and Delete, behind a centred confirm), then the add row (a box with its counter and Add), and "{n} of 16"
 * in the section's header. At 16 the add row waits with "You can keep 16. Delete one to add another." Problems are
 * checked as the server checks them (lib/preferences `preferenceProblem`: empty, too long, a link, a permission) and
 * shown on the box; the server's own words win. While someone else is signed in as the person the list is hidden
 * ("Hidden while someone else is signed in as this person."); before migration 0050 the card is disabled under
 * "Remembering how you like things done needs a database update first.".
 *
 * No orange: Add is the secondary button (the page's standouts are elsewhere); fits 400px (the row's buttons wrap under
 * the line).
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { SettingsAlert, SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { PREFERENCE_LIMITS, PREFERENCE_WORDS, PREFERENCES_NOT_READY, cleanPreference, preferenceProblem, type Preference, type PreferenceList } from "@/lib/preferences";
import { cn } from "@/lib/utils";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const FAILED = "Something went wrong. Nothing was changed; try again.";
/** The server's words for a refusal; a server error is not "cannot reach" (fix review, 9 October 2026). */
const told = (err: unknown) => (!isApiFailure(err) ? OFFLINE : err.error.status < 500 || err.error.code === "NOT_READY" ? err.error.message : FAILED);
const MAX = PREFERENCE_LIMITS.max;
const CHARS = PREFERENCE_LIMITS.chars;

const P = PREFERENCE_WORDS;
/** The card's words: lib/preferences' (contract D.5), and the few only this card says. */
const WORDS = {
  title: P.section,
  description: P.description,
  count: P.count,
  hidden: P.hidden,
  full: P.errors.full,
  exists: P.errors.exists,
  empty: (name: string) => `${P.empty} Or tell ${name} “remember that …” in chat.`,
  placeholder: `For example: ${P.placeholder}`,
  add: P.add,
  addLabel: P.addLabel,
  fromChat: P.fromChat,
  added: "Added",
  saved: P.saved,
  deleted: P.deleted,
  deleteTitle: (body: string) => `Delete “${body}”?`,
  deleteBody: (name: string) => `${name} stops following it.`,
} as const;

/** "48 of 150" under a box: tabular, red past the limit. */
function Counter({ id, n }: { id: string; n: number }) {
  return <p id={id} className={cn("mt-1 text-right text-xs font-normal tabular-nums", n > CHARS ? "text-danger" : "text-subtle")}>{n} of {CHARS}</p>;
}

export function PreferencesSettings({ orgSlug, name, initial }: {
  orgSlug: string; /** The person's own assistant ("Max"). */ name: string;
  /** The list as the page read it; null when it could not, and the card reads it itself. */ initial: PreferenceList | null;
}) {
  const uid = useId();
  const [list, setList] = useState<PreferenceList | null>(initial);
  const [seen, setSeen] = useState(initial);
  if (initial && initial !== seen) { setSeen(initial); setList(initial); }
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [said, setSaid] = useState("");
  const url = `/api/orgs/${orgSlug}/brenda/preferences`;
  // After a delete the row and its button are gone: the focus goes to the Add box rather than the page (fix review,
  // 9 October 2026).
  const addInput = useRef<HTMLInputElement>(null);
  const [deletedAt, setDeletedAt] = useState(0);
  useEffect(() => { if (deletedAt) addInput.current?.focus(); }, [deletedAt]);

  const load = useCallback(() => api<PreferenceList>(url).then((l) => { setList(l); setLoadError(null); }, (err: unknown) => setLoadError(told(err))), [url]);
  const brought = !!initial;
  useEffect(() => { if (!brought) void load(); }, [brought, load]);

  const items = list?.items ?? [];
  const ready = list?.ready ?? false;
  const hidden = list?.hidden ?? false;
  const full = items.length >= MAX;
  const locked = !ready || hidden;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (locked || full || adding) return;
    const body = cleanPreference(text);
    const problem = preferenceProblem(body, name) ?? (items.some((p) => p.body.toLowerCase() === body.toLowerCase()) ? WORDS.exists : null);
    if (problem) { setAddError(problem); return; }
    setAdding(true); setAddError(null);
    try {
      const p = await api<Preference>(url, { method: "POST", body: { body } });
      setList((cur) => (cur ? { ...cur, items: [...cur.items.filter((x) => x.id !== p.id), p] } : cur));
      setText(""); setSaid(WORDS.added); successToast(WORDS.added, `“${p.body}”`);
    } catch (err) { setAddError(told(err)); }
    finally { setAdding(false); }
  }

  const replaced = (p: Preference) => { setList((cur) => (cur ? { ...cur, items: cur.items.map((x) => (x.id === p.id ? p : x)) } : cur)); setSaid(WORDS.saved); };
  async function remove(p: Preference) {
    await api(`${url}/${p.id}`, { method: "DELETE" }); // a refusal stays in the dialog, with why
    setList((cur) => (cur ? { ...cur, items: cur.items.filter((x) => x.id !== p.id) } : cur));
    setSaid(WORDS.deleted);
    setDeletedAt((n) => n + 1);
  }

  const counter = list && ready && !hidden ? <span className="text-sm font-medium tabular-nums text-secondary">{WORDS.count(items.length)}</span> : undefined;
  return (
    <SettingsSection id="preferences" title={WORDS.title} description={WORDS.description(name)} action={counter}>
      <SettingsGroup aria-busy={!list && !loadError}>
        {loadError ? (
          <SettingsAlert>
            <span className="flex flex-wrap items-center justify-between gap-2">{loadError}<Button size="xs" variant="secondary" onClick={() => { setLoadError(null); void load(); }}>Try again</Button></span>
          </SettingsAlert>
        ) : !list ? (
          <div className="space-y-2 px-5 py-4" role="status" aria-label="Getting your preferences"><Skeleton className="h-4 w-64 max-w-full" /><Skeleton className="h-4 w-48" /></div>
        ) : !ready ? (
          <SettingsAlert tone="info">{PREFERENCES_NOT_READY}</SettingsAlert>
        ) : hidden ? (
          <p className="px-5 py-4 text-sm font-normal text-secondary">{WORDS.hidden}</p>
        ) : (
          <>
            {items.length ? (
              <ul className="divide-y divide-border">
                {items.map((p) => <PreferenceRow key={p.id} orgSlug={orgSlug} pref={p} name={name} others={items} onSaved={replaced} onDelete={() => remove(p)} />)}
              </ul>
            ) : <p className="px-5 py-4 text-sm font-normal text-secondary">{WORDS.empty(name)}</p>}
            <form noValidate onSubmit={(e) => void add(e)} className="rounded-b-[15px] bg-fill-0 px-5 py-4">
              <label htmlFor={`${uid}-new`} className="sr-only">{WORDS.addLabel}</label>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-[1_1_14rem]">
                  <Input ref={addInput} id={`${uid}-new`} value={text} maxLength={CHARS + 20} disabled={locked || full || adding} placeholder={WORDS.placeholder} autoComplete="off"
                    aria-invalid={addError ? true : undefined} aria-describedby={[`${uid}-new-count`, addError ? `${uid}-new-error` : full ? `${uid}-full` : null].filter(Boolean).join(" ")}
                    onChange={(e) => { setText(e.target.value); if (addError) setAddError(null); }} />
                  <Counter id={`${uid}-new-count`} n={text.trim().length} />
                </div>
                <Button type="submit" variant="secondary" disabled={locked || full || !text.trim()} loading={adding}>{WORDS.add}</Button>
              </div>
              {addError ? <p id={`${uid}-new-error`} role="alert" className="mt-1 text-meta font-medium text-danger">{addError}</p> : null}
              {full ? <p id={`${uid}-full`} className="mt-1 text-meta font-normal text-secondary">{WORDS.full}</p> : null}
            </form>
          </>
        )}
      </SettingsGroup>
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </SettingsSection>
  );
}

/** One preference: its words (and "Added in chat"), Edit in place and Delete behind a confirm. */
function PreferenceRow({ orgSlug, pref, name, others, onSaved, onDelete }: {
  orgSlug: string; pref: Preference; name: string; others: Preference[]; onSaved: (p: Preference) => void; onDelete: () => Promise<void>;
}) {
  const uid = useId();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(pref.body);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const short = pref.body.length > 60 ? `${pref.body.slice(0, 59).trimEnd()}…` : pref.body;

  const cancel = () => { setEditing(false); setText(pref.body); setError(null); };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const body = cleanPreference(text);
    if (body === pref.body) { cancel(); return; }
    const problem = preferenceProblem(body, name) ?? (others.some((p) => p.id !== pref.id && p.body.toLowerCase() === body.toLowerCase()) ? WORDS.exists : null);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      const p = await api<Preference>(`/api/orgs/${orgSlug}/brenda/preferences/${pref.id}`, { method: "PATCH", body: { body } });
      onSaved(p); setEditing(false);
    } catch (err) { setError(told(err)); }
    finally { setBusy(false); }
  }

  if (editing) {
    return (
      <li className="px-5 py-3">
        <form noValidate onSubmit={(e) => void save(e)} onKeyDown={(e) => { if (e.key === "Escape" && !busy) { e.preventDefault(); cancel(); } }}>
          <label htmlFor={`${uid}-edit`} className="sr-only">Edit this preference</label>
          <Input id={`${uid}-edit`} value={text} maxLength={CHARS + 20} disabled={busy} autoFocus autoComplete="off"
            aria-invalid={error ? true : undefined} aria-describedby={[`${uid}-count`, error ? `${uid}-error` : null].filter(Boolean).join(" ")}
            onChange={(e) => { setText(e.target.value); if (error) setError(null); }} />
          <Counter id={`${uid}-count`} n={text.trim().length} />
          {error ? <p id={`${uid}-error`} role="alert" className="text-meta font-medium text-danger">{error}</p> : null}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={cancel}>{P.cancel}</Button>
            <Button type="submit" variant="primary" size="sm" loading={busy}>{busy ? "Saving…" : P.save}</Button>
          </div>
        </form>
      </li>
    );
  }
  return (
    <li className="flex min-h-12 items-start gap-2 px-5 py-3">
      <div className="min-w-0 flex-1 pt-1">
        <p className="break-words text-sm font-normal text-foreground">{pref.body}</p>
        {pref.source === "chat" ? <p className="text-meta font-normal text-secondary">{WORDS.fromChat}</p> : null}
      </div>
      <IconButton aria-label={`Edit “${short}”`} onClick={() => { setText(pref.body); setEditing(true); }}><Pencil aria-hidden /></IconButton>
      <ConfirmButton title={WORDS.deleteTitle(short)} description={WORDS.deleteBody(name)} confirmLabel={P.deleteConfirm} pendingLabel="Deleting…" onConfirm={onDelete}
        variant="ghost" size="icon-sm" aria-label={`Delete “${short}”`} className="text-secondary hover:text-foreground">
        <Trash2 aria-hidden />
      </ConfirmButton>
    </li>
  );
}
