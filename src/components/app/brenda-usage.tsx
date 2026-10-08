/**
 * Settings → Brenda → "Usage this month" (owner decision, 8 October 2026: personal assistants, phase 3): what the
 * workspace asked of Claude since the 1st, for owners and HR. Four stat cards (requests, tokens in, tokens out, read from
 * the cache), the month by purpose, the five people with the most requests and the daily limit. Requests are chat turns,
 * to-do planner calls, team reports asked for and follow-up asks between assistants (phase 4: one ask, one request,
 * whether it covers one person or 25), each counted once whatever the number of model calls; tokens come from the API's
 * own usage block. No prices
 * anywhere (owner decision): the key's bill is between the owner and Anthropic.
 *
 * Server-safe (no hooks): the Settings page renders it with `usageSummary(ctx)`. Before migration 0037 the ledger does
 * not exist yet and the card says usage appears after the next database update.
 */
import { Alert } from "@/components/ui/states";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { formatLongDate } from "@/lib/utils";
import type { UsagePurpose, UsageSummary } from "@/server/services/ai-usage";

// "followup": follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4).
const PURPOSE_LABEL: Record<UsagePurpose, string> = {
  chat: "Chat", plan: "To-do planner", report: "Team reports", summary: "Summaries", test: "Connection tests", other: "Other", followup: "Follow-ups",
};

const exact = new Intl.NumberFormat("en-GB");
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

/** A figure shown short ("1.2m", "412.9k": en-GB compact), with the exact one in its tooltip and for screen readers. */
function Figure({ value }: { value: number }) {
  const full = exact.format(value);
  const short = compact.format(value);
  if (full === short) return <span className="tabular-nums">{full}</span>;
  return (
    <span title={full} className="tabular-nums">
      <span aria-hidden>{short}</span><span className="sr-only">{full}</span>
    </span>
  );
}

const plural = (n: number, one: string, many: string) => `${exact.format(n)} ${n === 1 ? one : many}`;

export function BrendaUsageCard({ usage }: { usage: UsageSummary }) {
  const { totals } = usage;
  const since = /^\d{4}-\d{2}-\d{2}$/.test(usage.from ?? "") ? ` since ${formatLongDate(usage.from)}` : " this month";
  return (
    <SettingsSection id="usage" title="Usage this month" description={`Requests to Claude and the tokens they used${since}.`}>
      {!usage.ready ? (
        <Alert tone="info">Usage appears here after the next database update.</Alert>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Requests" value={<Figure value={totals.requests} />}
              hint={totals.calls > totals.requests ? `${plural(totals.calls, "call", "calls")} to Claude` : undefined} />
            <StatCard label="Tokens in" value={<Figure value={totals.inputTokens} />}
              hint={totals.cacheWriteTokens ? <>Plus <Figure value={totals.cacheWriteTokens} /> written to the cache</> : undefined} />
            <StatCard label="Tokens out" value={<Figure value={totals.outputTokens} />} />
            <StatCard label="Read from cache" value={<Figure value={totals.cacheReadTokens} />} />
          </div>
          <SettingsGroup>
            <div className="px-5 py-4">
              <h3 className="text-sm font-medium text-foreground">By purpose</h3>
              {usage.byPurpose.length ? (
                // On a phone the table takes the card's width and its headers and labels wrap ("Tokens in" over two lines),
                // so four columns fit at 400px instead of scrolling sideways (review, 8 October 2026).
                <DataTable caption="Usage by purpose" className="mt-1 max-sm:[&_table]:!w-full max-sm:[&_th]:!whitespace-normal">
                  <thead><tr><th>Purpose</th><th className="!text-right">Requests</th><th className="!text-right">Tokens in</th><th className="!text-right">Tokens out</th></tr></thead>
                  <tbody>
                    {usage.byPurpose.map((p) => (
                      <tr key={p.purpose}>
                        <td className="sm:whitespace-nowrap">{PURPOSE_LABEL[p.purpose] ?? PURPOSE_LABEL.other}</td>
                        <td className="text-right tabular-nums">{exact.format(p.requests)}</td>
                        <td className="text-right"><Figure value={p.inputTokens} /></td>
                        <td className="text-right"><Figure value={p.outputTokens} /></td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
              ) : (
                <p className="mt-1 text-sm font-normal text-secondary">Nothing yet this month.</p>
              )}
            </div>
            <div className="px-5 py-4">
              <h3 className="text-sm font-medium text-foreground">Most requests</h3>
              {usage.topPeople.length ? (
                <ol className="mt-2 space-y-1">
                  {usage.topPeople.slice(0, 5).map((p) => (
                    <li key={p.membershipId} className="flex min-h-8 items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium text-foreground">{p.name}</span>
                      <span className="shrink-0 font-normal tabular-nums text-secondary">{plural(p.requests, "request", "requests")}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-sm font-normal text-secondary">Nobody has asked yet this month.</p>
              )}
            </div>
            <p className="rounded-b-[15px] bg-fill-0 px-5 py-3 text-meta font-normal text-secondary">
              Each person can make <span className="tabular-nums">{usage.dailyLimit}</span> requests a day. After that the built-in helper answers until midnight.
            </p>
          </SettingsGroup>
        </div>
      )}
    </SettingsSection>
  );
}
