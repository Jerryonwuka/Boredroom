"use client";

/**
 * Where Boredroom posts (owner decisions, 22 October 2026: connectors; spec §10.1, §11.1): the end-of-day digest (the whole
 * workspace or one team), each team's standup rollup, and each team's standup reminder, each in one of the selected
 * channels. Choosing a channel saves the route off; "Preview and turn on" shows what it would post now from today's data
 * with who receives it, and "Turn on" there is the workspace's standing consent for exactly that. "Turn off" stops it.
 * Teams appear one at a time ("Add a team"), each behind its own disclosure (fix, 22 October 2026).
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/sheet";
import { Alert } from "@/components/ui/states";
import { SettingsRow } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";
import { CONNECTOR_WORDS } from "@/lib/connectors/words";
import { READBACK_WORDS } from "@/lib/confirm-readback";
import type { RoutePurpose, RouteView, SourceView } from "@/lib/connectors/types";

const W = CONNECTOR_WORDS.routes;
const OFFLINE = "Cannot reach the server. Check your connection and try again; nothing was changed.";
type Preview = { preview: { heading: string; lines: string[]; link?: { label: string; href: string } } | null; readback: { to: string[]; what: string } };

export function ChannelRoutes({ orgSlug, connectionId, provider, routes, teams, connectedByName, version = 0 }: { orgSlug: string; connectionId: string; provider: string; routes: RouteView[]; teams: { id: string; name: string }[]; connectedByName?: string | null; version?: number }) {
  const router = useRouter();
  const [channels, setChannels] = useState<SourceView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ route: RouteView; data: Preview } | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    api<{ sources: SourceView[] }>(`/api/orgs/${orgSlug}/connectors/connections/${connectionId}/sources`)
      .then((r) => { if (alive) setChannels(r.sources.filter((s) => s.kind === "channel" && s.selected && !s.archived)); }, () => undefined);
    return () => { alive = false; };
    // `version` changes when the channel picker above saves (integration fix, 22 October 2026), so new channels show at once.
  }, [orgSlug, connectionId, version]);
  const mine = routes.filter((r) => channels.some((c) => c.id === r.sourceId) || r.provider === provider);
  const routeFor = (purpose: RoutePurpose, teamId: string | null) => mine.find((r) => r.purpose === purpose && r.teamId === teamId) ?? null;
  async function run<T>(key: string, fn: () => Promise<T>) {
    setBusy(key); setError(null);
    try { const r = await fn(); router.refresh(); return r; }
    catch (err) { setError(isApiFailure(err) ? err.error.message : OFFLINE); return null; }
    finally { setBusy(null); }
  }
  const choose = (purpose: RoutePurpose, teamId: string | null, sourceId: string) =>
    run(`set:${purpose}:${teamId}`, () => api(`/api/orgs/${orgSlug}/connectors/routes`, { method: "PUT", body: { purpose, teamId, sourceId: sourceId || null } }));
  const openPreview = async (route: RouteView) => {
    const data = await run(`preview:${route.id}`, () => api<Preview>(`/api/orgs/${orgSlug}/connectors/routes/${route.id}/preview`, { method: "POST" }));
    if (data) setPreview({ route, data });
  };
  // Fix, 22 October 2026: the workspace's digest, then only the teams that have a route (or were just added), each behind
  // its own disclosure, instead of three rows for every team at once.
  const routed = new Set(mine.map((r) => r.teamId).filter((t): t is string => !!t));
  const shownTeams = teams.filter((t) => routed.has(t.id) || added.includes(t.id));
  const addable = teams.filter((t) => !routed.has(t.id) && !added.includes(t.id));
  const teamRows = (t: { id: string; name: string }) => ([
    { purpose: "daily_digest" as const, teamId: t.id, label: W.purposes.daily_digest },
    { purpose: "standup" as const, teamId: t.id, label: W.purposes.standup },
    { purpose: "reminders" as const, teamId: t.id, label: W.purposes.reminders },
  ]);
  const routeRow = (row: { purpose: RoutePurpose; teamId: string | null; label: string }, context: string) => {
    const r = routeFor(row.purpose, row.teamId);
    const key = `${row.purpose}:${row.teamId}`;
    return (
      <SettingsRow key={key} label={row.label} hint={r && !r.enabled ? W.off : undefined} labelId={`route-${connectionId}-${key}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Select fieldSize="sm" aria-label={`${W.channel}: ${context}`} value={r?.sourceId ?? ""} disabled={busy !== null} onChange={(e) => choose(row.purpose, row.teamId, e.currentTarget.value)} className="w-52">
            <option value="">{W.noChannel}</option>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
          {r ? (r.enabled
            ? <><Badge tone="success" dot>{W.on}</Badge><Button variant="ghost" size="sm" loading={busy === `off:${r.id}`} onClick={() => run(`off:${r.id}`, () => api(`/api/orgs/${orgSlug}/connectors/routes/${r.id}/disable`, { method: "POST" }))}>{W.turnOff}</Button></>
            : <Button variant="secondary" size="sm" loading={busy === `preview:${r.id}`} onClick={() => openPreview(r)}>{W.preview}</Button>) : null}
        </div>
      </SettingsRow>
    );
  };
  return (
    <div>
      <div className="px-5 pt-4">
        <p className="text-sm font-medium text-foreground">{W.title}</p>
        {provider === "teams" ? <p className="mt-0.5 text-meta font-normal text-secondary">{W.teamsHint(connectedByName ?? "the account that connected Teams")}</p> : null}
        {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}
      </div>
      {routeRow({ purpose: "daily_digest", teamId: null, label: `${W.purposes.daily_digest}: ${W.wholeWorkspace}` }, `${W.purposes.daily_digest}: ${W.wholeWorkspace}`)}
      {shownTeams.map((t) => (
        <details key={t.id} open={added.includes(t.id) || undefined} className="group border-t border-border">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--ring)]">{W.teamRoutes(t.name)}</summary>
          {teamRows(t).map((row) => routeRow(row, `${row.label}: ${t.name}`))}
        </details>
      ))}
      {addable.length ? (
        <SettingsRow label={W.addTeam} labelId={`route-${connectionId}-add`}>
          <Select fieldSize="sm" aria-labelledby={`route-${connectionId}-add`} value="" disabled={busy !== null} onChange={(e) => { const id = e.currentTarget.value; if (id) setAdded((a) => [...a, id]); }} className="w-52">
            <option value="">{W.addTeamPlaceholder}</option>
            {addable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </SettingsRow>
      ) : null}
      <Dialog open={!!preview} onClose={() => setPreview(null)} title={preview ? (preview.route.enabled ? W.previewOnly : W.preview) : ""}
        footer={preview ? <>
          <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
          {!preview.route.enabled ? <Button variant="primary" loading={busy === `on:${preview.route.id}`} onClick={async () => { const ok = await run(`on:${preview.route.id}`, () => api(`/api/orgs/${orgSlug}/connectors/routes/${preview.route.id}/enable`, { method: "POST" })); if (ok) setPreview(null); }}>{W.turnOn}</Button> : null}
        </> : null}>
        {preview ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border p-4">
              {preview.data.preview ? (
                <>
                  <p className="text-sm font-semibold text-foreground">{preview.data.preview.heading}</p>
                  {preview.data.preview.lines.map((l, i) => <p key={i} className="text-sm font-normal text-secondary">{l}</p>)}
                  {preview.data.preview.link ? <p className="mt-2 text-sm font-medium text-foreground">{preview.data.preview.link.label}</p> : null}
                </>
              ) : <p className="text-sm font-normal text-secondary">{W.nothingToPost}</p>}
            </div>
            <div className="text-sm">
              <p className="font-medium text-foreground">{READBACK_WORDS.goesTo}: <span className="font-normal text-secondary">{preview.data.readback.to.join("; ")}</span></p>
              <p className="mt-1 font-medium text-foreground">{READBACK_WORDS.what}: <span className="font-normal text-secondary">{preview.data.readback.what}</span></p>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
