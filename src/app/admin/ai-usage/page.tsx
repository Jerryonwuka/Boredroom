import Link from "next/link";
import { Sparkles } from "lucide-react";
import { requireAdmin } from "@/server/admin/auth";
import { AI_PERIODS, aiUsageOverview, isAiPeriod, type AiPeriod, type OrgAiRow } from "@/server/admin/ai-usage";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { AnalyticsCard } from "@/components/ui/analytics-card";
import { BarChart } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { PeriodSwitch } from "@/components/admin/period-switch";
import { Big, SortHeader, sortLink, type SortDir } from "@/components/admin/ai-usage-parts";
import { linkCls, subCls, words } from "@/components/admin/fields";
import { PRICES_AS_OF, formatUsd } from "@/lib/ai-pricing";
import { num } from "@/lib/format";

export const metadata = { title: "AI usage" };

/**
 * Control Center → Product → AI usage (owner request, 27 October 2026: "which company is spending more tokens, how many AI
 * bots, how many Brendas they have, so we can manage AI usage"). For administrators with usage.view (read-only admins
 * included). A period switch (this month, the last 30 or 7 days), four figures for the whole platform, tokens and the
 * estimated cost per day, then every organisation in one table, most tokens first and sortable by any column, with a
 * totals row on top; each name opens its drill-down (/admin/ai-usage/[id]). Brenda for Mac's looks and tasks are
 * platform-wide only (recorded with no workspace by the owner's decisions). Views are not audited, as on the other
 * usage pages. Cost is an estimate from lib/ai-pricing's list prices.
 */
const SORTS = {
  tokens: (r: OrgAiRow) => r.totalTokens, requests: (r: OrgAiRow) => r.requests, input: (r: OrgAiRow) => r.inputTokens, output: (r: OrgAiRow) => r.outputTokens,
  cacheRead: (r: OrgAiRow) => r.cacheReadTokens, cacheWrite: (r: OrgAiRow) => r.cacheWriteTokens, cost: (r: OrgAiRow) => r.costUsd,
  assistants: (r: OrgAiRow) => r.assistants, people: (r: OrgAiRow) => r.people, voice: (r: OrgAiRow) => r.voiceCharacters,
} as const;
type SortKey = keyof typeof SORTS | "name";
const isSort = (v: unknown): v is SortKey => v === "name" || (typeof v === "string" && v in SORTS);

export default async function AiUsagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin("usage.view");
  const sp = await searchParams;
  const period: AiPeriod = isAiPeriod(sp.period) ? sp.period : "month";
  const sort: SortKey = isSort(sp.sort) ? sp.sort : "tokens";
  const dir: SortDir = sp.dir === "asc" || sp.dir === "desc" ? sp.dir : sort === "name" ? "asc" : "desc";
  const u = await aiUsageOverview(period);
  const periodLabel = AI_PERIODS.find((p) => p.value === period)!.label;
  const rows = [...u.orgs].sort((a, b) => {
    const c = sort === "name" ? a.name.localeCompare(b.name) : SORTS[sort](a) - SORTS[sort](b);
    return (dir === "asc" ? c : -c) || b.totalTokens - a.totalTokens || a.name.localeCompare(b.name);
  });
  const base = { period: period === "month" ? undefined : period };
  const th = (key: SortKey, label: string, numeric = true) => (
    <SortHeader label={label} active={sort === key} dir={dir} numeric={numeric}
      href={sortLink("/admin/ai-usage", { ...base, sort: key, dir: sort === key ? (dir === "asc" ? "desc" : "asc") : key === "name" ? "asc" : "desc" })} />
  );
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const t = u.totals;
  const drill = (id: string) => `/admin/ai-usage/${id}${period === "month" ? "" : `?period=${period}`}`;

  return (
    <>
      <div>
        <PageHeader title="AI usage" description="What each company asks of Claude and ElevenLabs on Boredroom's keys: requests, tokens, an estimated cost, and how many assistants they have."
          actions={<PeriodSwitch value={period} options={AI_PERIODS} label="Period" />} />

        {!u.ready.ai ? <EmptyState icon={Sparkles} title="AI usage isn't recorded yet" description="The usage ledger arrives with a database update (migration 0037). Nothing to show until then." /> : (
          <>
            <Ledger items={[
              { label: "Estimated cost", value: formatUsd(t.costUsd), note: `${periodLabel}, Claude only` },
              { label: "Tokens", value: <Big value={t.totalTokens} />, note: <><Big value={t.inputTokens} /> in, <Big value={t.outputTokens} /> out</> },
              { label: "Requests", value: <Big value={t.requests} />, note: `${num(t.people)} people, ${num(t.orgsUsing)} of ${num(u.orgs.length)} companies` },
              { label: "Assistants", value: <Big value={t.assistants} />, note: `${num(t.setUp)} set up by their person` },
            ]} />

            <AnalyticsCard className="my-6" label="AI usage per day" metrics={[
              { key: "tokens", label: "Tokens", value: <Big value={t.totalTokens} />, hint: periodLabel, content: <BarChart title={`Tokens per day, ${periodLabel.toLowerCase()}`} labels={u.byDay.map((d) => dayLabel(d.day))} values={u.byDay.map((d) => d.tokens)} format={(n) => num(Math.round(n))} empty="No AI requests in this period." /> },
              { key: "cost", label: "Estimated cost", value: formatUsd(t.costUsd), hint: "List prices", content: <BarChart title={`Estimated cost per day in US dollars, ${periodLabel.toLowerCase()}`} labels={u.byDay.map((d) => dayLabel(d.day))} values={u.byDay.map((d) => Math.round(d.costUsd * 100) / 100)} format={(n) => formatUsd(n)} empty="No AI requests in this period." /> },
              { key: "voice", label: "Natural voice", value: <Big value={t.voiceCharacters} />, hint: `characters, ${num(t.voiceUtterances)} replies said` },
            ]}>
              <p className="py-10 text-center text-sm font-normal text-secondary">Natural voice is counted per company in the table below; ElevenLabs bills it by characters on Boredroom&apos;s plan.</p>
            </AnalyticsCard>

            <Card variant="plain" className="min-w-0">
              <div className="px-5 pt-5"><CardHeader title="By company" description={`${periodLabel}. Most tokens first; choose a column to sort by it.`} /></div>
              {rows.length === 0 ? <EmptyState compact icon={Sparkles} title="No companies yet" description="Companies appear here as soon as they sign up." /> : (
                <DataTable caption={`AI usage by company, ${periodLabel.toLowerCase()}`}>
                  <thead>
                    <tr>
                      {th("name", "Company", false)}{th("requests", "Requests")}{th("input", "Tokens in")}{th("output", "Tokens out")}{th("cacheRead", "Cache read")}{th("cacheWrite", "Cache write")}
                      {th("tokens", "Total tokens")}{th("cost", "Est. cost")}{th("assistants", "Assistants")}{th("people", "Using AI")}{th("voice", "Voice chars")}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="bg-fill-0 font-medium [&>td]:font-medium">
                      <td>All companies<span className={subCls}>{num(u.orgs.length)} companies</span></td>
                      <td className="tabular-nums"><Big value={t.requests} /></td><td className="tabular-nums"><Big value={t.inputTokens} /></td><td className="tabular-nums"><Big value={t.outputTokens} /></td>
                      <td className="tabular-nums"><Big value={t.cacheReadTokens} /></td><td className="tabular-nums"><Big value={t.cacheWriteTokens} /></td><td className="tabular-nums"><Big value={t.totalTokens} /></td>
                      <td className="tabular-nums">{formatUsd(t.costUsd)}</td><td className="tabular-nums">{num(t.assistants)}</td><td className="tabular-nums">{num(t.people)}</td><td className="tabular-nums"><Big value={t.voiceCharacters} /></td>
                    </tr>
                    {rows.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <Link href={drill(o.id)} className={linkCls}>{o.name}</Link>
                          <span className={subCls}>{o.plan ?? "No plan"}{o.status !== "active" ? <>, {words(o.status).toLowerCase()}</> : null}</span>
                        </td>
                        <td className="tabular-nums">{o.requests ? <Big value={o.requests} /> : <span className="text-subtle">0</span>}</td>
                        <td className="tabular-nums"><Big value={o.inputTokens} /></td>
                        <td className="tabular-nums"><Big value={o.outputTokens} /></td>
                        <td className="tabular-nums"><Big value={o.cacheReadTokens} /></td>
                        <td className="tabular-nums"><Big value={o.cacheWriteTokens} /></td>
                        <td className="tabular-nums"><Big value={o.totalTokens} /></td>
                        <td className="tabular-nums">{formatUsd(o.costUsd)}</td>
                        <td className="tabular-nums">{num(o.assistants)}<span className={subCls}>{num(o.setUp)} set up</span></td>
                        <td className="tabular-nums">{num(o.people)}<span className={subCls}>of {num(o.members)}</span></td>
                        <td className="tabular-nums"><Big value={o.voiceCharacters} /></td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </Card>

            {u.mac ? (
              <Card className="mt-6 min-w-0">
                <CardHeader title="Brenda for Mac, whole platform" description="Looks at the screen and tasks on people's Macs are recorded with no company and no person (owner decisions, 11 and 12 October 2026), so they can't be split by company." />
                <DataTable caption={`Brenda for Mac usage, ${periodLabel.toLowerCase()}`}>
                  <thead><tr><th>What</th><th>Count</th><th>Model calls</th><th>Tokens</th><th>Est. cost</th></tr></thead>
                  <tbody>
                    <tr><td>Screen help looks<span className={subCls}><Big value={u.mac.looks.imageTokens} /> picture tokens</span></td><td className="tabular-nums">{num(u.mac.looks.looks)}</td><td className="tabular-nums">{num(u.mac.looks.steps)}</td><td className="tabular-nums"><Big value={u.mac.looks.totalTokens} /></td><td className="tabular-nums">{formatUsd(u.mac.looks.costUsd)}</td></tr>
                    <tr><td>Tasks on the Mac and file jobs</td><td className="tabular-nums">{num(u.mac.tasks.tasks)}</td><td className="tabular-nums">{num(u.mac.tasks.steps)}</td><td className="tabular-nums"><Big value={u.mac.tasks.totalTokens} /></td><td className="tabular-nums">{formatUsd(u.mac.tasks.costUsd)}</td></tr>
                    <tr><td>Front desk (which helper answers)<span className={subCls}>Also in the companies&apos; chat rows</span></td><td className="tabular-nums">—</td><td className="tabular-nums">{num(u.mac.router.steps)}</td><td className="tabular-nums"><Big value={u.mac.router.totalTokens} /></td><td className="tabular-nums">{formatUsd(u.mac.router.costUsd)}</td></tr>
                  </tbody>
                </DataTable>
              </Card>
            ) : null}
          </>
        )}
      </div>
      <PageNotes>
        <PageNote section="Estimated cost">An estimate at Anthropic&apos;s list prices as of {PRICES_AS_OF} (src/lib/ai-pricing.ts, one table to edit), with cache writes at the 5-minute rate. Anthropic&apos;s invoice is the real figure. Natural voice is not priced: ElevenLabs bills characters on Boredroom&apos;s plan.</PageNote>
        {u.unpriced.length ? <PageNote section="Not in the price table">{u.unpriced.join(", ")}: priced as the nearest model until the table names {u.unpriced.length === 1 ? "it" : "them"}.</PageNote> : null}
        <PageNote section="Requests">One request is one thing asked (a chat turn, a report, a follow-up), however many model calls it took. Tokens are the API&apos;s own counts. This month starts on the 1st (UTC).</PageNote>
        <PageNote section="Assistants">Every active member has their own assistant, plus one for the company itself. &ldquo;Set up&rdquo; counts the people who named theirs and chose its look.</PageNote>
        <PageNote section="Brenda for Mac">A look&apos;s words (without the picture) and the front desk also appear in a company&apos;s chat requests, so the two tables overlap a little.</PageNote>
      </PageNotes>
    </>
  );
}
