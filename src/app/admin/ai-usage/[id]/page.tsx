import Link from "next/link";
import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { AI_PERIODS, aiUsageForOrg, isAiPeriod, type AiPeriod, type OrgAiDetail } from "@/server/admin/ai-usage";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { BarChart } from "@/components/ui/charts";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { PeriodSwitch } from "@/components/admin/period-switch";
import { Big } from "@/components/admin/ai-usage-parts";
import { ORG_ROLE, subCls } from "@/components/admin/fields";
import { PURPOSE_LABEL } from "@/components/app/brenda-usage";
import { PRICES_AS_OF, formatUsd } from "@/lib/ai-pricing";
import { num } from "@/lib/format";

export const metadata = { title: "AI usage" };

/**
 * Control Center → AI usage → one company (owner request, 27 October 2026). The same sources as the overview, for one
 * organisation: the figures, tokens per day, what the requests were for (chat, reports, standups, follow-ups, call notes…),
 * which models, the people who asked most and the company's own jobs, and natural voice. People are named only for an
 * administrator who may already see the company's members (organization.view or user.view); otherwise they read
 * "Person 1", "Person 2". Brenda for Mac's looks and tasks have no company by design, so they are not here.
 */
export default async function OrgAiUsagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("usage.view");
  const { id } = await params;
  const sp = await searchParams;
  const period: AiPeriod = isAiPeriod(sp.period) ? sp.period : "month";
  const names = can(admin, "organization.view") || can(admin, "user.view");
  let d: OrgAiDetail;
  try { d = await aiUsageForOrg(id, period, { names }); } catch (err) { if (err instanceof AppError && err.status === 404) notFound(); throw err; }
  const periodLabel = AI_PERIODS.find((p) => p.value === period)!.label;
  const t = d.totals;
  const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const back = `/admin/ai-usage${period === "month" ? "" : `?period=${period}`}`;

  return (
    <>
      <div>
        <PageHeader back={{ href: back, label: "AI usage" }} title={d.org.name} description={`AI usage, ${periodLabel.toLowerCase()}: Claude on Boredroom's key and natural voices.`}
          actions={<>
            <PeriodSwitch value={period} options={AI_PERIODS} label="Period" />
            {can(admin, "organization.view") ? <Link href={`/admin/organisations/${d.org.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Open company</Link> : null}
          </>} />

        {!d.ready.ai ? <EmptyState icon={Sparkles} title="AI usage isn't recorded yet" description="The usage ledger arrives with a database update (migration 0037)." /> : (
          <>
            <Ledger items={[
              { label: "Estimated cost", value: formatUsd(t.costUsd), note: "Claude, list prices" },
              { label: "Tokens", value: <Big value={t.totalTokens} />, note: <><Big value={t.inputTokens} /> in, <Big value={t.outputTokens} /> out</> },
              { label: "Requests", value: <Big value={t.requests} />, note: `${num(t.people)} of ${num(d.org.members)} people` },
              { label: "Assistants", value: num(d.org.assistants), note: `${num(d.org.setUp)} set up, plus ${d.org.workspaceAssistant} for the company` },
            ]} />

            <Card className="my-6 min-w-0">
              <CardHeader title="Tokens per day" description={`${periodLabel}, by UTC day.${d.org.plan ? ` ${d.org.plan} plan.` : ""}`} />
              <BarChart title={`Tokens per day for ${d.org.name}, ${periodLabel.toLowerCase()}`} labels={d.byDay.map((x) => dayLabel(x.day))} values={d.byDay.map((x) => x.tokens)} format={(n) => num(Math.round(n))} empty="No AI requests in this period." />
            </Card>

            <Card variant="plain" className="min-w-0">
              <div className="px-5 pt-5"><CardHeader title="By purpose" description="What the requests were for, most tokens first." /></div>
              {d.byPurpose.length === 0 ? <EmptyState compact icon={Sparkles} title="No AI requests in this period" description="Try a longer period." /> : (
                <DataTable caption={`AI usage by purpose for ${d.org.name}`}>
                  <thead><tr><th>Purpose</th><th>Requests</th><th>Model calls</th><th>Tokens in</th><th>Tokens out</th><th>Cache read</th><th>Cache write</th><th>Est. cost</th></tr></thead>
                  <tbody>
                    {d.byPurpose.map((p) => (
                      <tr key={p.purpose}>
                        <td>{PURPOSE_LABEL[p.purpose] ?? PURPOSE_LABEL.other}</td>
                        <td className="tabular-nums"><Big value={p.requests} /></td><td className="tabular-nums"><Big value={p.calls} /></td>
                        <td className="tabular-nums"><Big value={p.inputTokens} /></td><td className="tabular-nums"><Big value={p.outputTokens} /></td>
                        <td className="tabular-nums"><Big value={p.cacheReadTokens} /></td><td className="tabular-nums"><Big value={p.cacheWriteTokens} /></td>
                        <td className="tabular-nums">{formatUsd(p.costUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
            </Card>

            <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Card variant="plain" className="min-w-0">
                <div className="px-5 pt-5"><CardHeader title="Most requests" description={names ? "The people who asked most, and the company's own jobs." : "Names are shown to administrators who can see the company's members."} /></div>
                {d.topPeople.length === 0 && d.workspace.calls === 0 ? <p className="px-5 pb-5 text-sm font-normal text-secondary">Nobody asked in this period.</p> : (
                  <DataTable caption={`People with the most AI requests in ${d.org.name}`}>
                    <thead><tr><th>Who</th><th>Requests</th><th>Tokens</th><th>Est. cost</th></tr></thead>
                    <tbody>
                      {d.topPeople.map((p, i) => (
                        <tr key={p.membershipId}>
                          <td>{names ? (p.name ?? "Someone") : `Person ${i + 1}`}{names && p.role ? <span className={subCls}>{ORG_ROLE[p.role] ?? p.role}</span> : null}</td>
                          <td className="tabular-nums"><Big value={p.requests} /></td><td className="tabular-nums"><Big value={p.totalTokens} /></td><td className="tabular-nums">{formatUsd(p.costUsd)}</td>
                        </tr>
                      ))}
                      {d.workspace.calls > 0 ? (
                        <tr>
                          <td>{d.org.workspaceAssistant}, for the company<span className={subCls}>Daily report, commitments, call notes</span></td>
                          <td className="tabular-nums"><Big value={d.workspace.requests} /></td><td className="tabular-nums"><Big value={d.workspace.totalTokens} /></td><td className="tabular-nums">{formatUsd(d.workspace.costUsd)}</td>
                        </tr>
                      ) : null}
                    </tbody>
                  </DataTable>
                )}
              </Card>

              <div className="grid content-start gap-6">
                <Card variant="plain" className="min-w-0">
                  <div className="px-5 pt-5"><CardHeader title="By model" /></div>
                  {d.byModel.length === 0 ? <p className="px-5 pb-5 text-sm font-normal text-secondary">No model calls in this period.</p> : (
                    <DataTable caption={`AI usage by model for ${d.org.name}`}>
                      <thead><tr><th>Model</th><th>Model calls</th><th>Tokens</th><th>Est. cost</th></tr></thead>
                      <tbody>
                        {d.byModel.map((m) => (
                          <tr key={m.model}>
                            <td className="font-mono text-meta">{m.model}{!m.exact ? <span className={subCls}>Priced as {m.priced}</span> : null}</td>
                            <td className="tabular-nums"><Big value={m.calls} /></td><td className="tabular-nums"><Big value={m.totalTokens} /></td><td className="tabular-nums">{formatUsd(m.costUsd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  )}
                </Card>
                <Card className="min-w-0">
                  <CardHeader title="Natural voice" description="ElevenLabs, on Boredroom's key." />
                  {d.ready.voice ? (
                    <dl className="grid grid-cols-3 gap-3">
                      <div><dt className="text-sm font-medium text-secondary">Characters</dt><dd className="type-stat mt-1"><Big value={t.voiceCharacters} /></dd></div>
                      <div><dt className="text-sm font-medium text-secondary">Replies said</dt><dd className="type-stat mt-1"><Big value={t.voiceUtterances} /></dd></div>
                      <div><dt className="text-sm font-medium text-secondary">People</dt><dd className="type-stat mt-1">{num(t.voicePeople)}</dd></div>
                    </dl>
                  ) : <p className="text-sm font-normal text-secondary">Natural voices need a database update (migration 0053).</p>}
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
      <PageNotes>
        <PageNote section="Estimated cost">At Anthropic&apos;s list prices as of {PRICES_AS_OF} (src/lib/ai-pricing.ts). Anthropic&apos;s invoice is the real figure.</PageNote>
        {d.unpriced.length ? <PageNote section="Not in the price table">{d.unpriced.join(", ")}: priced as the nearest model.</PageNote> : null}
        <PageNote section="Requests">One request is one thing asked, however many model calls it took; a follow-up or a standup counts once for the person who asked.</PageNote>
        <PageNote section="Brenda for Mac">Looks at the screen and tasks on people&apos;s Macs have no company by design; the platform total is on the AI usage page.</PageNote>
      </PageNotes>
    </>
  );
}
