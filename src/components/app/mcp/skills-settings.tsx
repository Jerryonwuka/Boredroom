"use client";

/**
 * Settings → Brenda → Skills (owners and HR; owner decisions, 4 November 2026: phase 1). The workspace's own skills (a
 * SKILL.md and up to 5 reference files, pasted or uploaded) and Brenda's starter skills, each with an on/off switch.
 * Everyone's Brenda opens a skill when a request matches it; a skill never changes what waits for Confirm.
 */
import { useRef, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ConfirmButton } from "@/components/ui/confirm";
import { Alert } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { MCP_NOT_READY } from "@/lib/mcp/words";
import type { SkillView } from "@/lib/mcp/types";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const failure = (err: unknown) => (isApiFailure(err) ? err.error.message : OFFLINE);
const EXAMPLE = "---\nname: release-notes\ndescription: The person asks to write release notes for a version.\n---\n1. Read the finished tasks with list_tasks.\n2. Group them as New, Fixed and Changed.";
const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

type Draft = { id: string | null; skillMd: string; files: { name: string; text: string; size: number }[]; keepFiles: boolean };

export function SkillsSettings({ orgSlug, initial, ready }: { orgSlug: string; initial: SkillView[]; ready: boolean }) {
  const [skills, setSkills] = useState(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/orgs/${orgSlug}/skills`;
  const description = "Step-by-step instructions Brenda follows when a request matches one, for everyone in the workspace. A skill never lets her skip a Confirm.";
  if (!ready) return <SettingsSection id="skills" title="Skills" description={description}><Alert tone="info">{MCP_NOT_READY}</Alert></SettingsSection>;
  const own = skills.filter((s) => !s.builtin);
  const builtins = skills.filter((s) => s.builtin);
  const replace = (s: SkillView) => setSkills((xs) => xs.map((x) => (x.slug === s.slug ? s : x)));

  async function toggle(s: SkillView, enabled: boolean) {
    setError(null);
    replace({ ...s, enabled });
    try {
      const next = s.builtin
        ? await api<SkillView>(`${base}/builtin/${s.slug}`, { method: "PUT", body: { enabled }, retries: 0 })
        : await api<SkillView>(`${base}/${s.id}`, { method: "PATCH", body: { enabled }, retries: 0 });
      replace(next);
    } catch (err) { replace(s); setError(failure(err)); }
  }
  async function remove(s: SkillView) {
    try { await api(`${base}/${s.id}`, { method: "DELETE", retries: 0 }); setSkills((xs) => xs.filter((x) => x.slug !== s.slug)); successToast(`Removed ${s.name}.`); }
    catch (err) { setError(failure(err)); }
  }
  const row = (s: SkillView) => (
    <li key={s.slug} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={`skill-${s.slug}`} className="text-sm font-medium">{s.name}</span>
          {s.builtin ? <Badge size="sm">From Boredroom</Badge> : null}
          {s.files.length ? <span className="text-meta text-secondary tabular-nums">{s.files.length} {s.files.length === 1 ? "file" : "files"}</span> : null}
        </div>
        <p className="text-meta font-normal text-secondary">{s.useWhen}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!s.builtin ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => setDraft({ id: s.id, skillMd: `---\nname: ${s.slug}\ntitle: ${s.name}\ndescription: ${s.useWhen}\n---\n${s.body ?? ""}`, files: [], keepFiles: true })}>Edit</Button>
            <ConfirmButton variant="ghost" size="sm" title={`Remove ${s.name}?`} description="Brenda stops using it for everyone. This can't be undone."
              confirmLabel="Remove skill" pendingLabel="Removing…" onConfirm={() => remove(s)}>Remove</ConfirmButton>
          </>
        ) : null}
        <Switch aria-labelledby={`skill-${s.slug}`} checked={s.enabled} onChange={(e) => toggle(s, e.currentTarget.checked)} />
      </div>
    </li>
  );
  return (
    <SettingsSection id="skills" title="Skills" description={description}
      action={<Button variant="secondary" size="sm" onClick={() => setDraft({ id: null, skillMd: "", files: [], keepFiles: false })}>Add skill</Button>}>
      {error ? <Alert tone="danger" className="mb-4">{error}</Alert> : null}
      <div className="space-y-4">
        {own.length ? <ul className="card-panel divide-y divide-border p-0">{own.map(row)}</ul>
          : <p className="text-sm font-normal text-secondary">No skills of your own yet. Add one from a SKILL.md file.</p>}
        <ul className="card-panel divide-y divide-border p-0" aria-label="Brenda's starter skills">{builtins.map(row)}</ul>
      </div>
      {draft ? <SkillSheet base={base} draft={draft} onClose={() => setDraft(null)} onSaved={(s, isNew) => {
        setSkills((xs) => (isNew ? [s, ...xs] : xs.map((x) => (x.slug === s.slug ? s : x))));
        setDraft(null);
        successToast(isNew ? `Added ${s.name}.` : `Saved ${s.name}.`);
      }} /> : null}
    </SettingsSection>
  );
}

function SkillSheet({ base, draft, onClose, onSaved }: { base: string; draft: Draft; onClose: () => void; onSaved: (s: SkillView, isNew: boolean) => void }) {
  const [skillMd, setSkillMd] = useState(draft.skillMd);
  const [files, setFiles] = useState(draft.files);
  const [replaceFiles, setReplaceFiles] = useState(!draft.keepFiles);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const mdInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const isNew = draft.id === null;

  async function readMd(list: FileList | null) {
    const f = list?.[0];
    if (f) setSkillMd(await f.text());
  }
  async function addFiles(list: FileList | null) {
    const picked = await Promise.all([...(list ?? [])].map(async (f) => ({ name: f.name, text: await f.text(), size: f.size })));
    setFiles((xs) => [...xs, ...picked].slice(0, 5));
    setReplaceFiles(true);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setErrors({});
    const body = { skillMd, ...(replaceFiles ? { files: files.map(({ name, text }) => ({ name, text })) } : {}) };
    try {
      const s = isNew ? await api<SkillView>(base, { method: "POST", body, retries: 0 }) : await api<SkillView>(`${base}/${draft.id}`, { method: "PATCH", body, retries: 0 });
      onSaved(s, isNew);
    } catch (err) {
      setError(failure(err));
      setErrors(isApiFailure(err) ? err.error.fieldErrors ?? {} : {});
    } finally { setBusy(false); }
  }
  const mdError = errors.skill ?? errors.name ?? errors.description ?? errors.body;
  return (
    <Sheet open onClose={onClose} size="lg" title={isNew ? "Add skill" : "Edit skill"} description="A SKILL.md starts with name: and description: between --- lines, then the steps."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="skill-form" loading={busy}>{isNew ? "Add skill" : "Save skill"}</Button></>}>
      <form id="skill-form" onSubmit={submit} className="space-y-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="SKILL.md" htmlFor="skill-md" error={mdError}
          description={<>Paste it, or <button type="button" className="link-inline" onClick={() => mdInput.current?.click()}>upload a file</button>. The description says when Brenda should use it, in up to 200 characters.</>}>
          <Textarea id="skill-md" value={skillMd} onChange={(e) => setSkillMd(e.currentTarget.value)} rows={14} required placeholder={EXAMPLE} spellCheck={false} className="font-mono text-meta" />
        </Field>
        <input ref={mdInput} type="file" accept=".md,text/markdown,text/plain" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void readMd(e.currentTarget.files); e.currentTarget.value = ""; }} />
        <div>
          <p className="text-sm font-medium">Reference files</p>
          <p className="mt-1 text-meta font-normal text-secondary">Up to 5 plain-text files (templates, examples), 200 KB in all. Brenda opens them when the steps say to.</p>
          {!replaceFiles ? <p className="mt-2 text-meta text-secondary">The skill keeps its files. Adding files replaces them.</p> : null}
          {files.length ? (
            <ul className="mt-3 divide-y divide-border rounded-[var(--radius-sm)] border border-border">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate font-mono text-meta">{f.name}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-meta text-secondary tabular-nums">{kb(f.size)}</span>
                    <Button variant="ghost" size="xs" aria-label={`Remove ${f.name}`} onClick={() => setFiles((xs) => xs.filter((_, j) => j !== i))}>Remove</Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {errors.files ? <p role="alert" className="mt-1.5 text-meta font-medium text-danger">{errors.files[0]}</p> : null}
          <Button variant="secondary" size="sm" className="mt-3" disabled={files.length >= 5} onClick={() => fileInput.current?.click()}>Add files</Button>
          <input ref={fileInput} type="file" multiple accept=".md,.txt,.csv,.json,.yaml,.yml,text/*" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void addFiles(e.currentTarget.files); e.currentTarget.value = ""; }} />
        </div>
      </form>
    </Sheet>
  );
}
