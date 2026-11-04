"use client";

/**
 * Settings → Connectors → Your own apps (MCP) (owners and HR; owner decisions, 4 November 2026: phase 1). Add a remote MCP
 * server by its https address (and a key, when it needs one); Boredroom lists its tools, all off. For each tool the admin
 * chooses Off, Read (Brenda uses it when someone asks) or Act (always a Confirm card first). The server's own hint only
 * suggests which; a tool the server changed shows "Changed" and stays off until chosen again. Never shows a key.
 */
import { useId, useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { ConfirmButton } from "@/components/ui/confirm";
import { Alert, EmptyState } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { SettingsSection } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { MCP_NOT_READY } from "@/lib/mcp/words";
import type { McpAccess, McpAuthKind, McpServerView, McpToolView } from "@/lib/mcp/types";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const failure = (err: unknown) => (isApiFailure(err) ? err.error.message : OFFLINE);
const fieldErrors = (err: unknown): Record<string, string[]> => (isApiFailure(err) ? err.error.fieldErrors ?? {} : {});

const STATUS: Record<McpServerView["status"], { tone: "success" | "warning" | "neutral"; label: string }> = {
  active: { tone: "success", label: "Working" },
  needs_attention: { tone: "warning", label: "Needs attention" },
  paused: { tone: "neutral", label: "Paused" },
};
const ACCESS_OPTIONS = [{ value: "off", label: "Off" }, { value: "read", label: "Read" }, { value: "act", label: "Act" }];

export function McpServersSettings({ orgSlug, initial, ready }: { orgSlug: string; initial: McpServerView[]; ready: boolean }) {
  const [servers, setServers] = useState(initial);
  const [adding, setAdding] = useState(false);
  const base = `/api/orgs/${orgSlug}/mcp/servers`;
  const put = (s: McpServerView) => setServers((xs) => (xs.some((x) => x.id === s.id) ? xs.map((x) => (x.id === s.id ? s : x)) : [...xs, s].sort((a, b) => a.name.localeCompare(b.name))));
  const description = "Add an MCP server and choose which of its tools Brenda may use for everyone. Read tools run when someone asks; Act tools always wait for their Confirm.";

  if (!ready) return <SettingsSection id="mcp" title="Your own apps (MCP)" description={description}><Alert tone="info">{MCP_NOT_READY}</Alert></SettingsSection>;
  return (
    <SettingsSection id="mcp" title="Your own apps (MCP)" description={description}
      action={servers.length ? <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>Add MCP server</Button> : undefined}>
      {servers.length === 0
        ? <EmptyState compact title="No MCP servers yet" description="Add one by its https address to let Brenda use its tools." action={<Button onClick={() => setAdding(true)}>Add MCP server</Button>} />
        : <div className="space-y-4">{servers.map((s) => <ServerCard key={s.id} base={base} server={s} onChange={put} onRemoved={() => setServers((xs) => xs.filter((x) => x.id !== s.id))} />)}</div>}
      <AddServerSheet base={base} open={adding} onClose={() => setAdding(false)} onAdded={(s) => { put(s); setAdding(false); successToast(`Added ${s.name}. Choose which tools Brenda may use.`); }} />
    </SettingsSection>
  );
}

function ServerCard({ base, server, onChange, onRemoved }: { base: string; server: McpServerView; onChange: (s: McpServerView) => void; onRemoved: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const status = STATUS[server.status];
  const on = server.tools.filter((t) => t.access !== "off" && !t.changed && !t.gone).length;
  async function run(what: string, path: string, method: string, body?: unknown) {
    setBusy(what); setError(null);
    try { onChange(await api<McpServerView>(path, { method, body, retries: 0 })); }
    catch (err) { setError(failure(err)); }
    finally { setBusy(null); }
  }
  async function remove() {
    try { await api(`${base}/${server.id}`, { method: "DELETE", retries: 0 }); onRemoved(); successToast(`Removed ${server.name}.`); }
    catch (err) { setError(failure(err)); }
  }
  const visible = server.tools.filter((t) => !t.gone || t.access !== "off");
  return (
    <div className="card-panel p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{server.name}</h3>
            <Badge tone={status.tone} dot size="sm">{status.label}</Badge>
          </div>
          <p className="truncate font-mono text-meta text-secondary">{server.url}</p>
          <p className="text-meta font-normal text-secondary">
            {server.useFor ? `For ${server.useFor}. ` : ""}
            <span className="tabular-nums">{on} of {server.tools.filter((t) => !t.gone).length}</span> tools on
            {server.authKind === "none" ? ", no key" : server.keyHint ? `, key ending ${server.keyHint}` : ", key saved"}
            {server.serverLabel ? `. Calls itself ${server.serverLabel}.` : "."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={busy === "refresh"} onClick={() => run("refresh", `${base}/${server.id}/refresh`, "POST")}>Check tools</Button>
          <Button variant="ghost" size="sm" onClick={() => setKeyOpen(true)}>Change key</Button>
          <Button variant="ghost" size="sm" loading={busy === "pause"} onClick={() => run("pause", `${base}/${server.id}`, "PATCH", { paused: server.status !== "paused" })}>{server.status === "paused" ? "Resume" : "Pause"}</Button>
          <ConfirmButton variant="danger" size="sm" title={`Remove ${server.name}?`} description="Brenda stops using its tools for everyone, and Boredroom deletes its key. You can add it again later."
            confirmLabel="Remove server" pendingLabel="Removing…" onConfirm={remove}>Remove</ConfirmButton>
        </div>
      </div>
      {server.problem ? <div className="px-4 pb-4"><Alert tone="warning">{server.problem}</Alert></div> : null}
      {error ? <div className="px-4 pb-4"><Alert tone="danger">{error}</Alert></div> : null}
      {visible.length
        ? <ul className="divide-y divide-border border-t border-border">{visible.map((t) => (
            <ToolRow key={t.id} tool={t} busy={busy === t.id} onAccess={(access) => run(t.id, `${base}/${server.id}/tools/${t.id}`, "PUT", { access })} />
          ))}</ul>
        : <p className="border-t border-border p-4 text-sm font-normal text-secondary">The server lists no tools. Check tools again after it adds some.</p>}
      <KeySheet base={base} server={server} open={keyOpen} onClose={() => setKeyOpen(false)} onSaved={(s) => { onChange(s); setKeyOpen(false); successToast("Key saved and checked."); }} />
    </div>
  );
}

function ToolRow({ tool, busy, onAccess }: { tool: McpToolView; busy: boolean; onAccess: (a: McpAccess) => void }) {
  const id = useId();
  // A changed tool shows Off as chosen: choosing Read or Act approves it as it is now.
  const shown = tool.changed || tool.gone ? "off" : tool.access;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span id={id} className="font-mono text-meta font-medium text-foreground">{tool.name}</span>
          {tool.title ? <span className="text-meta text-secondary">{tool.title}</span> : null}
          {tool.changed ? <Badge tone="warning" size="sm">Changed: choose again</Badge> : null}
          {tool.gone ? <Badge tone="neutral" size="sm">No longer listed</Badge> : null}
        </div>
        {tool.description ? <p className="line-clamp-2 text-meta font-normal text-secondary">{tool.description}</p> : null}
        <p className="text-meta font-normal text-subtle">
          The server says it {tool.suggested === "read" ? "only reads" : "may change things"}{tool.destructive ? " and may delete" : ""}.
        </p>
      </div>
      <div className="shrink-0">
        <Segmented aria-label={`What Brenda may do with ${tool.name}`} value={shown} disabled={busy || tool.gone}
          onChange={(v) => onAccess(v as McpAccess)} options={ACCESS_OPTIONS} />
      </div>
    </li>
  );
}

function AuthFields({ kind, setKind, keyValue, setKey, header, setHeader, errors, idPrefix }: {
  kind: McpAuthKind; setKind: (k: McpAuthKind) => void; keyValue: string; setKey: (v: string) => void; header: string; setHeader: (v: string) => void;
  errors: Record<string, string[]>; idPrefix: string;
}) {
  return (
    <>
      <div>
        <p className="mb-2 text-sm font-medium" id={`${idPrefix}-auth`}>How it signs in</p>
        <Segmented aria-label="How it signs in" value={kind} onChange={(v) => setKind(v as McpAuthKind)}
          options={[{ value: "none", label: "No key" }, { value: "bearer", label: "Bearer key" }, { value: "header", label: "Custom header" }]} />
        <p className="mt-1.5 text-meta font-normal text-secondary">Servers that only offer signing in with an account can&apos;t be added yet.</p>
      </div>
      {kind === "header"
        ? <Field label="Header name" htmlFor={`${idPrefix}-header`} error={errors.header}><Input id={`${idPrefix}-header`} value={header} onChange={(e) => setHeader(e.currentTarget.value)} placeholder="X-API-Key" autoComplete="off" spellCheck={false} /></Field>
        : null}
      {kind !== "none"
        ? <Field label="Key" htmlFor={`${idPrefix}-key`} error={errors.key} description="Stored encrypted. Nobody can see it again, only its last four characters.">
            <Input id={`${idPrefix}-key`} type="password" value={keyValue} onChange={(e) => setKey(e.currentTarget.value)} autoComplete="off" spellCheck={false} />
          </Field>
        : null}
    </>
  );
}

function AddServerSheet({ base, open, onClose, onAdded }: { base: string; open: boolean; onClose: () => void; onAdded: (s: McpServerView) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [useFor, setUseFor] = useState("");
  const [kind, setKind] = useState<McpAuthKind>("none");
  const [key, setKey] = useState("");
  const [header, setHeader] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const close = () => { setError(null); setErrors({}); onClose(); };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setErrors({});
    try {
      const s = await api<McpServerView>(base, { method: "POST", retries: 0, body: { name, url, useFor: useFor || null, auth: { kind, ...(kind !== "none" ? { key } : {}), ...(kind === "header" ? { header } : {}) } } });
      setName(""); setUrl(""); setUseFor(""); setKind("none"); setKey(""); setHeader("");
      onAdded(s);
    } catch (err) { setError(failure(err)); setErrors(fieldErrors(err)); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={close} title="Add MCP server" description="Boredroom connects to it and lists its tools. Every tool starts off."
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" form="mcp-add" loading={busy}>Add server</Button></>}>
      <form id="mcp-add" onSubmit={submit} className="space-y-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Name" htmlFor="mcp-name" error={errors.name} description="What Brenda and your team call it.">
          <Input id="mcp-name" value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={60} required placeholder="Company wiki" />
        </Field>
        <Field label="Address" htmlFor="mcp-url" error={errors.url} description="The server's https address, often ending in /mcp.">
          <Input id="mcp-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.currentTarget.value)} required placeholder="https://mcp.example.com/mcp" spellCheck={false} />
        </Field>
        <Field label="What it's for" htmlFor="mcp-use" error={errors.useFor} hint="Optional" description="Helps Brenda pick it, like “the support team's tickets”.">
          <Input id="mcp-use" value={useFor} onChange={(e) => setUseFor(e.currentTarget.value)} maxLength={200} />
        </Field>
        <AuthFields kind={kind} setKind={setKind} keyValue={key} setKey={setKey} header={header} setHeader={setHeader} errors={errors} idPrefix="mcp-add" />
      </form>
    </Sheet>
  );
}

function KeySheet({ base, server, open, onClose, onSaved }: { base: string; server: McpServerView; open: boolean; onClose: () => void; onSaved: (s: McpServerView) => void }) {
  const [kind, setKind] = useState<McpAuthKind>(server.authKind);
  const [key, setKey] = useState("");
  const [header, setHeader] = useState(server.authHeader ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const form = `mcp-key-${server.id}`;
  const close = () => { setError(null); setErrors({}); setKey(""); onClose(); };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setErrors({});
    try {
      const s = await api<McpServerView>(`${base}/${server.id}`, { method: "PATCH", retries: 0, body: { auth: { kind, ...(kind !== "none" ? { key } : {}), ...(kind === "header" ? { header } : {}) } } });
      setKey("");
      onSaved(s);
    } catch (err) { setError(failure(err)); setErrors(fieldErrors(err)); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={close} title={`Change ${server.name}'s key`} description="Boredroom checks the new key with the server before saving it."
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" form={form} loading={busy}>Save key</Button></>}>
      <form id={form} onSubmit={submit} className="space-y-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <AuthFields kind={kind} setKind={setKind} keyValue={key} setKey={setKey} header={header} setHeader={setHeader} errors={errors} idPrefix={form} />
      </form>
    </Sheet>
  );
}
