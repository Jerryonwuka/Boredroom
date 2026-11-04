"use client";

/**
 * Settings → Connectors → Your own apps (MCP) (owners and HR; owner decisions, 4 November 2026: phase 1). Add a remote MCP
 * server by its https address (and a key, when it needs one); Boredroom lists its tools, all off. For each tool the admin
 * chooses Off, Read (Brenda uses it when someone asks) or Act (always a Confirm card first). The server's own hint only
 * suggests which; a tool the server changed shows "Changed" and stays off until chosen again. Never shows a key.
 * A server may sign in instead of taking a key (phase 1b): saving it goes straight on to the app's sign-in page, and the
 * way back lands here with a confirmation or one sentence on what went wrong.
 */
import { useEffect, useId, useState } from "react";
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
import { MCP_NOT_READY, MCP_SIGN_IN_NOT_READY, MCP_SIGN_IN_RETURN, type McpSignInReturn } from "@/lib/mcp/words";
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
const DAY = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

/** Sends the browser to the server's sign-in page; the way back is this page. Words when it can't start. */
async function startSignIn(base: string, serverId: string): Promise<string | null> {
  try {
    const { url } = await api<{ url: string }>(`${base}/${serverId}/sign-in`, { method: "POST", retries: 0 });
    window.location.assign(url);
    return null;
  } catch (err) { return failure(err); }
}

export function McpServersSettings({ orgSlug, initial, ready, signInReady = true }: { orgSlug: string; initial: McpServerView[]; ready: boolean; signInReady?: boolean }) {
  const [servers, setServers] = useState(initial);
  const [adding, setAdding] = useState(false);
  const [returned, setReturned] = useState<string | null>(null);
  // Back from a sign-in: a toast for success, one sentence for a problem; the query is taken off the address.
  useEffect(() => {
    const u = new URL(window.location.href);
    const signedIn = u.searchParams.get("mcp_signed_in");
    const problem = u.searchParams.get("mcp_error");
    if (!signedIn && !problem) return;
    if (signedIn) successToast(`Signed in to ${initial.find((x) => x.id === signedIn)?.name ?? "the server"}. Choose which tools Brenda may use.`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the address the sign-in came back to
    if (problem) setReturned(MCP_SIGN_IN_RETURN[problem as McpSignInReturn] ?? MCP_SIGN_IN_RETURN.failed);
    u.searchParams.delete("mcp_signed_in"); u.searchParams.delete("mcp_error");
    window.history.replaceState(null, "", u.toString());
  }, [initial]);
  const base = `/api/orgs/${orgSlug}/mcp/servers`;
  const put = (s: McpServerView) => setServers((xs) => (xs.some((x) => x.id === s.id) ? xs.map((x) => (x.id === s.id ? s : x)) : [...xs, s].sort((a, b) => a.name.localeCompare(b.name))));
  const description = "Add an MCP server and choose which of its tools Brenda may use for everyone. Read tools run when someone asks; Act tools always wait for their Confirm.";

  if (!ready) return <SettingsSection id="mcp" title="Your own apps (MCP)" description={description}><Alert tone="info">{MCP_NOT_READY}</Alert></SettingsSection>;
  return (
    <SettingsSection id="mcp" title="Your own apps (MCP)" description={description}
      action={servers.length ? <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>Add MCP server</Button> : undefined}>
      {returned ? <Alert tone="warning" className="mb-4">{returned}</Alert> : null}
      {servers.length === 0
        ? <EmptyState compact title="No MCP servers yet" description="Add one by its https address to let Brenda use its tools." action={<Button onClick={() => setAdding(true)}>Add MCP server</Button>} />
        : <div className="space-y-4">{servers.map((s) => <ServerCard key={s.id} base={base} server={s} signInReady={signInReady} onChange={put} onRemoved={() => setServers((xs) => xs.filter((x) => x.id !== s.id))} />)}</div>}
      <AddServerSheet base={base} open={adding} signInReady={signInReady} onClose={() => setAdding(false)} onAdded={(s) => { put(s); setAdding(false); if (s.authKind !== "oauth") successToast(`Added ${s.name}. Choose which tools Brenda may use.`); }} />
    </SettingsSection>
  );
}

function ServerCard({ base, server, signInReady, onChange, onRemoved }: { base: string; server: McpServerView; signInReady: boolean; onChange: (s: McpServerView) => void; onRemoved: () => void }) {
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
  const signIn = server.signIn;
  const needsSignIn = !!signIn && !signIn.signedIn;
  async function signInNow() {
    setBusy("sign-in"); setError(null);
    const problem = await startSignIn(base, server.id);
    if (problem) { setError(problem); setBusy(null); }
  }
  const how = server.authKind === "oauth"
    ? signIn?.signedIn ? `, signed in${signIn.by ? ` by ${signIn.by}` : ""}${signIn.at ? ` on ${DAY.format(new Date(signIn.at))}` : ""}` : ", not signed in"
    : server.authKind === "none" ? ", no key" : server.keyHint ? `, key ending ${server.keyHint}` : ", key saved";
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
            {how}
            {server.serverLabel ? `. Calls itself ${server.serverLabel}.` : "."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" loading={busy === "refresh"} onClick={() => run("refresh", `${base}/${server.id}/refresh`, "POST")}>Check tools</Button>
          {signIn?.signedIn ? <Button variant="ghost" size="sm" loading={busy === "sign-in"} onClick={signInNow}>Sign in again</Button> : null}
          <Button variant="ghost" size="sm" onClick={() => setKeyOpen(true)}>{server.authKind === "oauth" ? "Sign-in settings" : "Change key"}</Button>
          <Button variant="ghost" size="sm" loading={busy === "pause"} onClick={() => run("pause", `${base}/${server.id}`, "PATCH", { paused: server.status !== "paused" })}>{server.status === "paused" ? "Resume" : "Pause"}</Button>
          <ConfirmButton variant="danger" size="sm" title={`Remove ${server.name}?`} description="Brenda stops using its tools for everyone, and Boredroom deletes its key. You can add it again later."
            confirmLabel="Remove server" pendingLabel="Removing…" onConfirm={remove}>Remove</ConfirmButton>
        </div>
      </div>
      {needsSignIn
        ? <div className="px-4 pb-4"><Alert tone="info" action={<Button size="sm" loading={busy === "sign-in"} onClick={signInNow}>{server.lastOkAt ? "Sign in again" : "Sign in"}</Button>}>
            {server.lastOkAt ? "The sign-in ended. Sign in again so Brenda can use its tools." : "Sign in to the app so Boredroom can list its tools. Brenda will use this account for everyone."}
          </Alert></div>
        : server.problem ? <div className="px-4 pb-4"><Alert tone="warning">{server.problem}</Alert></div> : null}
      {error ? <div className="px-4 pb-4"><Alert tone="danger">{error}</Alert></div> : null}
      {visible.length
        ? <ul className="divide-y divide-border border-t border-border">{visible.map((t) => (
            <ToolRow key={t.id} tool={t} busy={busy === t.id} onAccess={(access) => run(t.id, `${base}/${server.id}/tools/${t.id}`, "PUT", { access })} />
          ))}</ul>
        : needsSignIn ? null : <p className="border-t border-border p-4 text-sm font-normal text-secondary">The server lists no tools. Check tools again after it adds some.</p>}
      <KeySheet base={base} server={server} signInReady={signInReady} open={keyOpen} onClose={() => setKeyOpen(false)} onSaved={(s) => { onChange(s); setKeyOpen(false); if (s.authKind !== "oauth") successToast("Key saved and checked."); }} />
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

type Client = { clientId: string; clientSecret: string };
const authBody = (kind: McpAuthKind, key: string, header: string, client: Client) => ({
  kind, ...(kind === "bearer" || kind === "header" ? { key } : {}), ...(kind === "header" ? { header } : {}),
  ...(kind === "oauth" && client.clientId.trim() ? { clientId: client.clientId, ...(client.clientSecret.trim() ? { clientSecret: client.clientSecret } : {}) } : {}),
});

function AuthFields({ kind, setKind, keyValue, setKey, header, setHeader, client, setClient, signInReady, errors, idPrefix }: {
  kind: McpAuthKind; setKind: (k: McpAuthKind) => void; keyValue: string; setKey: (v: string) => void; header: string; setHeader: (v: string) => void;
  client: Client; setClient: (c: Client) => void; signInReady: boolean; errors: Record<string, string[]>; idPrefix: string;
}) {
  const [showClient, setShowClient] = useState(!!client.clientId);
  return (
    <>
      <div>
        <p className="mb-2 text-sm font-medium" id={`${idPrefix}-auth`}>How it signs in</p>
        <Segmented aria-label="How it signs in" value={kind} onChange={(v) => setKind(v as McpAuthKind)}
          options={[{ value: "none", label: "No key" }, { value: "oauth", label: "Sign in", disabled: !signInReady }, { value: "bearer", label: "Bearer key" }, { value: "header", label: "Custom header" }]} />
        <p className="mt-1.5 text-meta font-normal text-secondary">
          {!signInReady ? MCP_SIGN_IN_NOT_READY : kind === "oauth" ? "You sign in to the app next. Brenda uses that account for everyone in the workspace." : "Choose Sign in for apps that ask you to sign in with an account."}
        </p>
      </div>
      {kind === "oauth"
        ? showClient
          ? <>
              <Field label="Client ID" htmlFor={`${idPrefix}-client`} error={errors.clientId} hint="Optional" description="Only for apps that won't let Boredroom register itself. Find it in the app's developer settings.">
                <Input id={`${idPrefix}-client`} value={client.clientId} onChange={(e) => setClient({ ...client, clientId: e.currentTarget.value })} autoComplete="off" spellCheck={false} />
              </Field>
              <Field label="Client secret" htmlFor={`${idPrefix}-secret`} error={errors.clientSecret} hint="Optional" description="Stored encrypted. Nobody can see it again.">
                <Input id={`${idPrefix}-secret`} type="password" value={client.clientSecret} onChange={(e) => setClient({ ...client, clientSecret: e.currentTarget.value })} autoComplete="off" spellCheck={false} />
              </Field>
            </>
          : <button type="button" className="link-inline text-meta" aria-expanded={false} onClick={() => setShowClient(true)}>Use a client ID from the app</button>
        : null}
      {kind === "header"
        ? <Field label="Header name" htmlFor={`${idPrefix}-header`} error={errors.header}><Input id={`${idPrefix}-header`} value={header} onChange={(e) => setHeader(e.currentTarget.value)} placeholder="X-API-Key" autoComplete="off" spellCheck={false} /></Field>
        : null}
      {kind === "bearer" || kind === "header"
        ? <Field label="Key" htmlFor={`${idPrefix}-key`} error={errors.key} description="Stored encrypted. Nobody can see it again, only its last four characters.">
            <Input id={`${idPrefix}-key`} type="password" value={keyValue} onChange={(e) => setKey(e.currentTarget.value)} autoComplete="off" spellCheck={false} />
          </Field>
        : null}
    </>
  );
}

function AddServerSheet({ base, open, signInReady, onClose, onAdded }: { base: string; open: boolean; signInReady: boolean; onClose: () => void; onAdded: (s: McpServerView) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [useFor, setUseFor] = useState("");
  const [kind, setKind] = useState<McpAuthKind>("none");
  const [key, setKey] = useState("");
  const [header, setHeader] = useState("");
  const [client, setClient] = useState<Client>({ clientId: "", clientSecret: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const close = () => { setError(null); setErrors({}); onClose(); };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setErrors({});
    try {
      const s = await api<McpServerView>(base, { method: "POST", retries: 0, body: { name, url, useFor: useFor || null, auth: authBody(kind, key, header, client) } });
      setName(""); setUrl(""); setUseFor(""); setKind("none"); setKey(""); setHeader(""); setClient({ clientId: "", clientSecret: "" });
      onAdded(s);
      // A server that signs in goes straight on to its sign-in page (the card offers Sign in if it can't start).
      if (s.authKind === "oauth") { const problem = await startSignIn(base, s.id); if (problem) setError(problem); }
    } catch (err) {
      setError(failure(err)); setErrors(fieldErrors(err));
      if (isApiFailure(err) && err.error.code === "MCP_SIGN_IN_OFFERED" && signInReady) setKind("oauth");
    } finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={close} title="Add MCP server" description="Boredroom connects to it and lists its tools. Every tool starts off."
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" form="mcp-add" loading={busy}>{kind === "oauth" ? "Add and sign in" : "Add server"}</Button></>}>
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
        <AuthFields kind={kind} setKind={setKind} keyValue={key} setKey={setKey} header={header} setHeader={setHeader} client={client} setClient={setClient} signInReady={signInReady} errors={errors} idPrefix="mcp-add" />
      </form>
    </Sheet>
  );
}

function KeySheet({ base, server, open, signInReady, onClose, onSaved }: { base: string; server: McpServerView; open: boolean; signInReady: boolean; onClose: () => void; onSaved: (s: McpServerView) => void }) {
  const [kind, setKind] = useState<McpAuthKind>(server.authKind);
  const [key, setKey] = useState("");
  const [header, setHeader] = useState(server.authHeader ?? "");
  const [client, setClient] = useState<Client>({ clientId: "", clientSecret: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const form = `mcp-key-${server.id}`;
  const close = () => { setError(null); setErrors({}); setKey(""); onClose(); };
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setErrors({});
    try {
      const s = await api<McpServerView>(`${base}/${server.id}`, { method: "PATCH", retries: 0, body: { auth: authBody(kind, key, header, client) } });
      setKey(""); setClient({ clientId: "", clientSecret: "" });
      onSaved(s);
      if (s.authKind === "oauth" && !s.signIn?.signedIn) { const problem = await startSignIn(base, s.id); if (problem) setError(problem); }
    } catch (err) { setError(failure(err)); setErrors(fieldErrors(err)); }
    finally { setBusy(false); }
  }
  return (
    <Sheet open={open} onClose={close} title={`How ${server.name} signs in`} description={kind === "oauth" ? "Saving goes on to the app's sign-in page when it isn't signed in." : "Boredroom checks the new key with the server before saving it."}
      footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button type="submit" form={form} loading={busy}>{kind === "oauth" ? "Save" : "Save key"}</Button></>}>
      <form id={form} onSubmit={submit} className="space-y-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <AuthFields kind={kind} setKind={setKind} keyValue={key} setKey={setKey} header={header} setHeader={setHeader} client={client} setClient={setClient} signInReady={signInReady} errors={errors} idPrefix={form} />
      </form>
    </Sheet>
  );
}
