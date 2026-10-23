"use client";

/**
 * A connected app's card (owner decisions, 22 October 2026: connectors; spec §11.1, §11.2). The header is the neutral
 * category icon, the plain name and a status badge (Connected, Needs attention, Not connected, Paused, Not set up yet);
 * the body says what the app is for, what the assistant can see and do there, and, once connected, the account, the last
 * check, the switches, the sources or channels, and Check now, Reconnect and Disconnect (through ConfirmButton). No
 * orange buttons here: the accent goes to checked boxes and the status dot only.
 */
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm";
import { Switch } from "@/components/ui/switch";
import { Alert } from "@/components/ui/states";
import { SettingsFooter, SettingsGroup, SettingsRow } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { formatDateTime } from "@/lib/utils";
import { CONNECTOR_WORDS, errorWords } from "@/lib/connectors/words";
import { fillWords } from "@/lib/connectors/catalogue";
import type { CatalogueCard, ConnectionView, PolicyView, RouteView } from "@/lib/connectors/types";
import { ProviderIcon } from "./provider-icon";
import { SourcePicker } from "./source-picker";
import { ChannelRoutes } from "./channel-routes";
import { ConnectSheet, startConnect } from "./connect-sheet";

const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
const S = CONNECTOR_WORDS.status;
const WS = CONNECTOR_WORDS.workspace;

export function StatusBadge({ c, configured }: { c: Pick<ConnectionView, "status"> | null; configured: boolean }) {
  if (!configured) return <Badge>{S.notSetUp}</Badge>;
  if (!c) return <Badge>{S.notConnected}</Badge>;
  if (c.status === "active") return <Badge tone="success" dot>{S.connected}</Badge>;
  if (c.status === "needs_reauth") return <Badge tone="warning" dot>{S.attention}</Badge>;
  return <Badge>{S.paused}</Badge>;
}

function List({ title, items, name }: { title: string; items: string[]; name: string }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-meta font-normal text-secondary">{items.map((s) => <li key={s}>{fillWords(s, { name })}</li>)}</ul>
    </div>
  );
}

function Header({ card, badge, children }: { card: CatalogueCard; badge: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <ProviderIcon category={card.entry.category} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-foreground">{card.entry.label}</p>{badge}</div>
        {children}
      </div>
    </div>
  );
}

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run<T>(key: string, fn: () => Promise<T>, ok?: string): Promise<T | null> {
    setBusy(key); setError(null); setDone(null);
    try { const r = await fn(); if (ok) setDone(ok); router.refresh(); return r; }
    catch (err) { setError(isApiFailure(err) ? err.error.message : OFFLINE); return null; }
    finally { setBusy(null); }
  }
  return { busy, error, done, run, setError };
}

const checked = (c: ConnectionView, tz: string) => (c.lastSyncAt ? WS.lastChecked(formatDateTime(c.lastSyncAt, tz)) : WS.firstCheck);

/**
 * Not set up on this server (owners only): which console, the steps, the variable names and every URL the console asks
 * for (filled from APP_ORIGIN), never a value. Fix, 22 October 2026: the console is named first, GitHub's Setup URL is
 * the real one, and the restart is said once for every app.
 */
export function SetupSteps({ card }: { card: CatalogueCard }) {
  const s = card.entry.setup;
  return (
    <details className="mt-2 text-meta font-normal text-secondary">
      <summary className="cursor-pointer font-medium text-foreground">{WS.howToSetUp}</summary>
      <p className="mt-2 font-medium text-foreground">{WS.setupIn(s.console)}</p>
      <ol className="mt-1 list-decimal space-y-1 pl-5">{s.steps.map((x) => <li key={x}>{x}</li>)}</ol>
      {s.env.length ? <p className="mt-2">{WS.variables}: <span className="font-mono">{s.env.join(", ")}</span></p> : null}
      {card.redirectUrl ? <p className="mt-1 break-all">{WS.redirectUrl}: <span className="font-mono">{card.redirectUrl}</span></p> : null}
      {card.extraUrls?.map((x) => <p key={x.label} className="mt-1 break-all">{x.label}: <span className="font-mono">{x.url}</span></p>)}
      {card.webhookUrl ? <p className="mt-1 break-all">{WS.webhookUrl}: <span className="font-mono">{card.webhookUrl}</span></p> : null}
      <p className="mt-2">{WS.restart}</p>
    </details>
  );
}

/** Settings → Connectors: one app for the whole workspace (owners and HR). */
export function WorkspaceConnectionCard({ orgSlug, card, connection, policy, teams, routes, timeZone, returnTo, assistantName }: {
  orgSlug: string; card: CatalogueCard; connection: ConnectionView | null; policy: PolicyView; teams: { id: string; name: string }[]; routes: RouteView[]; timeZone: string; returnTo: string;
  /** The workspace's assistant name (fix, 22 October 2026). */ assistantName: string;
}) {
  const a = useAction();
  const e = card.entry;
  const name = assistantName;
  const setPolicy = async (patch: Partial<Omit<PolicyView, "provider">>) => {
    await a.run("policy", () => api(`/api/orgs/${orgSlug}/connectors/policies/${e.slug}`, { method: "PUT", body: patch }), "Saved.");
    // Connected without permission to make changes (minimal scopes, fix 22 October 2026): turning changes on asks the app.
    if (patch.brendaActs === true && connection && !connection.actScopesGranted && e.id !== "jira" && e.id !== "asana") {
      const err = await startConnect(orgSlug, e.slug, { kind: "workspace", act: true, purpose: "upgrade", connectionId: connection.id, returnTo });
      if (err) a.setError(err);
    }
  };
  const connect = (purpose: "connect" | "reconnect") => a.run(purpose, async () => {
    // Only what's needed (fix, 22 October 2026: minimal scopes): permission to make changes only while the workspace lets
    // the assistant make them (Jira and Asana never act from the workspace's connection).
    const act = policy.brendaActs && e.id !== "jira" && e.id !== "asana";
    const err = await startConnect(orgSlug, e.slug, { kind: "workspace", act, purpose, ...(connection ? { connectionId: connection.id } : {}), returnTo });
    if (err) throw new Error(err);
  });
  const work = e.category === "work" || e.category === "knowledge";
  const chat = e.category === "chat";
  const ownAccount = e.id === "jira" || e.id === "asana";
  const [channelsVersion, setChannelsVersion] = useState(0);
  return (
    <SettingsGroup>
      <Header card={card} badge={<StatusBadge c={connection} configured={card.configured} />}>
        {!card.configured ? (<><p className="mt-1 text-meta font-normal text-secondary">{WS.notSetUp(e.label)}</p><SetupSteps card={card} /></>)
          : connection ? (
            <>
              <p className="mt-0.5 text-meta font-normal text-secondary">{connection.accountLabel ? WS.connectedTo(connection.accountLabel) : null}{connection.accountLabel ? ", " : ""}{checked(connection, timeZone)}</p>
              {connection.settings?.waiting ? <p className="mt-1 text-meta font-normal text-secondary">{WS.githubWaiting}</p> : null}
            </>
          ) : <p className="mt-0.5 text-meta font-normal text-secondary">{e.workspace ? fillWords(e.workspace.what, { name }) : null}</p>}
      </Header>
      {a.error ? <div className="px-5 py-3"><Alert tone="danger">{a.error}</Alert></div> : null}
      {card.configured && connection && connection.status === "needs_reauth" ? (
        <div className="px-5 py-3"><Alert tone="warning" action={<Button size="sm" variant="secondary" onClick={() => connect("reconnect")} loading={a.busy === "reconnect"}>{WS.reconnect}</Button>}>{errorWords(connection.errorCode ?? "REAUTH_REQUIRED", e.id)}</Alert></div>
      ) : null}
      {card.configured && !connection && e.workspace ? (
        <div className="grid gap-3 px-5 py-4 md:grid-cols-2">
          <List title={WS.sees(name)} items={e.workspace.sees} name={name} />
          <List title={WS.does(name)} items={e.workspace.does} name={name} />
        </div>
      ) : null}
      {card.configured && connection && connection.status !== "disconnecting" ? (
        <>
          {work ? <SourcePicker orgSlug={orgSlug} connectionId={connection.id} app={e.label} teams={teams} name={name} /> : null}
          {chat ? <SourcePicker orgSlug={orgSlug} connectionId={connection.id} app={e.label} teams={[]} kinds={["channel"]} name={name} note={e.id === "slack" ? CONNECTOR_WORDS.routes.slackHint : undefined} onChanged={() => setChannelsVersion((v) => v + 1)} /> : null}
          {chat ? <ChannelRoutes orgSlug={orgSlug} connectionId={connection.id} provider={e.id} routes={routes} teams={teams} version={channelsVersion} connectedByName={typeof connection.settings?.postsAs === "string" ? connection.settings.postsAs : null} /> : null}
          {/* Chat apps are only places to post (fix, 22 October 2026): no "read" switch, and the one switch says what it allows. */}
          {!chat ? (
            <SettingsRow label={WS.brendaReads(e.label, name)} labelId={`${e.slug}-reads`}>
              <Switch aria-labelledby={`${e.slug}-reads`} checked={policy.brendaReads} onChange={(ev) => setPolicy({ brendaReads: ev.currentTarget.checked })} disabled={a.busy !== null} />
            </SettingsRow>
          ) : null}
          <SettingsRow label={chat ? WS.chatActs(name) : ownAccount ? WS.ownAccountActsLabel(e.label, name) : WS.brendaActs(e.label, name)} hint={ownAccount ? WS.ownAccountActs : undefined} labelId={`${e.slug}-acts`}>
            <Switch aria-labelledby={`${e.slug}-acts`} checked={policy.brendaActs} onChange={(ev) => setPolicy({ brendaActs: ev.currentTarget.checked })} disabled={a.busy !== null} />
          </SettingsRow>
          {e.kinds.includes("personal") ? (
            <SettingsRow label={WS.personalAllowed(e.label)} labelId={`${e.slug}-personal`}>
              <Switch aria-labelledby={`${e.slug}-personal`} checked={policy.personalAllowed} onChange={(ev) => setPolicy({ personalAllowed: ev.currentTarget.checked })} disabled={a.busy !== null} />
            </SettingsRow>
          ) : null}
        </>
      ) : null}
      {card.configured ? (
        <SettingsFooter status={a.done}>
          {connection ? (
            <>
              <Button variant="ghost" size="sm" loading={a.busy === "sync"} onClick={() => a.run("sync", () => api(`/api/orgs/${orgSlug}/connectors/connections/${connection.id}/sync`, { method: "POST" }), "Checking now.")}>{WS.checkNow}</Button>
              <Button variant="ghost" size="sm" loading={a.busy === "reconnect"} onClick={() => connect("reconnect")}>{WS.reconnect}</Button>
              <ConfirmButton variant="danger" size="sm" title={WS.disconnect} description={WS.disconnectConfirm(e.label)} confirmLabel={WS.disconnect}
                onConfirm={async () => { await a.run("disconnect", () => api(`/api/orgs/${orgSlug}/connectors/connections/${connection.id}`, { method: "DELETE" })); }}>{WS.disconnect}</ConfirmButton>
            </>
          ) : <Button variant="secondary" size="sm" loading={a.busy === "connect"} onClick={() => connect("connect")}>{WS.connect(e.label)}</Button>}
        </SettingsFooter>
      ) : null}
    </SettingsGroup>
  );
}

/** Settings → Your assistant → Your connections: one app for the person themself (private to them). */
export function PersonalConnectionCard({ orgSlug, card, connection, name, timeZone, returnTo }: {
  orgSlug: string; card: CatalogueCard; connection: ConnectionView | null; name: string; timeZone: string; returnTo: string;
}) {
  const a = useAction();
  const [sheet, setSheet] = useState(false);
  const e = card.entry;
  const P = CONNECTOR_WORDS.personal;
  const patch = async (body: { canRead?: boolean; canAct?: boolean }) => {
    const r = await a.run("patch", () => api<{ needsConsent?: boolean }>(`/api/orgs/${orgSlug}/connectors/connections/${connection!.id}`, { method: "PATCH", body }), "Saved.");
    // Acting needs more consent from the app: off to it to agree.
    if (r?.needsConsent) {
      const err = await startConnect(orgSlug, e.slug, { kind: "personal", act: true, purpose: "upgrade", connectionId: connection!.id, returnTo });
      if (err) a.setError(err);
    }
  };
  const reconnect = () => a.run("reconnect", async () => { const err = await startConnect(orgSlug, e.slug, { kind: "personal", purpose: "reconnect", connectionId: connection!.id, act: connection!.canAct, returnTo }); if (err) throw new Error(err); });
  return (
    <SettingsGroup>
      <Header card={card} badge={<StatusBadge c={connection} configured={card.configured} />}>
        <p className="mt-0.5 text-meta font-normal text-secondary">
          {connection ? <>{connection.accountLabel ? P.connectedAs(connection.accountLabel) : null}{connection.accountLabel ? ", " : ""}{checked(connection, timeZone)}</> : e.personal ? fillWords(e.personal.what, { name }) : null}
        </p>
        {card.googleTesting ? <p className="mt-1 text-meta font-normal text-secondary">{P.googleTesting}</p> : null}
        {e.id === "github" ? <p className="mt-1 text-meta font-normal text-secondary">{P.githubPersonal}</p> : null}
      </Header>
      {a.error ? <div className="px-5 py-3"><Alert tone="danger">{a.error}</Alert></div> : null}
      {connection?.status === "needs_reauth" ? (
        <div className="px-5 py-3"><Alert tone="warning" action={<Button size="sm" variant="secondary" onClick={reconnect} loading={a.busy === "reconnect"}>{WS.reconnect}</Button>}>{errorWords(connection.errorCode ?? "REAUTH_REQUIRED", e.id)}</Alert></div>
      ) : null}
      {e.personal ? (
        <div className="grid gap-3 px-5 py-4 md:grid-cols-2">
          <List title={WS.sees(name)} items={e.personal.sees} name={name} />
          <List title={WS.does(name)} items={e.personal.does} name={name} />
        </div>
      ) : null}
      {connection ? (
        <>
          <SettingsRow label={P.canRead(name)} labelId={`${e.slug}-me-read`}>
            <Switch aria-labelledby={`${e.slug}-me-read`} checked={connection.canRead} onChange={(ev) => patch({ canRead: ev.currentTarget.checked })} disabled={a.busy !== null} />
          </SettingsRow>
          <SettingsRow label={P.canAct(name)} hint={!connection.actScopesGranted ? P.willConfirm(e.label) : undefined} labelId={`${e.slug}-me-act`}>
            <Switch aria-labelledby={`${e.slug}-me-act`} checked={connection.canAct} onChange={(ev) => patch({ canAct: ev.currentTarget.checked })} disabled={a.busy !== null} />
          </SettingsRow>
        </>
      ) : null}
      <SettingsFooter status={a.done}>
        {connection ? (
          <>
            <Button variant="ghost" size="sm" loading={a.busy === "sync"} onClick={() => a.run("sync", () => api(`/api/orgs/${orgSlug}/connectors/connections/${connection.id}/sync`, { method: "POST" }), "Checking now.")}>{WS.checkNow}</Button>
            <Button variant="ghost" size="sm" loading={a.busy === "reconnect"} onClick={reconnect}>{WS.reconnect}</Button>
            <ConfirmButton variant="danger" size="sm" title={WS.disconnect} description={P.disconnectConfirm(e.label, e.removeAt)} confirmLabel={WS.disconnect}
              onConfirm={async () => { await a.run("disconnect", () => api(`/api/orgs/${orgSlug}/connectors/connections/${connection.id}`, { method: "DELETE" })); }}>{WS.disconnect}</ConfirmButton>
          </>
        ) : <Button variant="secondary" size="sm" onClick={() => setSheet(true)}>{P.connect}</Button>}
      </SettingsFooter>
      <ConnectSheet orgSlug={orgSlug} entry={e} name={name} open={sheet} onClose={() => setSheet(false)} returnTo={returnTo} />
    </SettingsGroup>
  );
}
