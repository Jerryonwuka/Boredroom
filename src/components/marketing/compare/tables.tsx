import { AsOf } from "@/components/marketing/blocks";
import { ComparisonTable, type Cell, type Mark } from "@/components/marketing/comparison-table";
import { AS_OF, CRITERIA, HUB_ORDER, PLANS, TEAM_SIZES, TOOLS, monthlyCost, usd, type CriterionKey, type PlanKey, type ToolId } from "@/components/marketing/compare/data";

/**
 * The comparison pages' tables (owner request, 17 October 2026: SEO analysis, Content Plan pages 6 to 9), all drawn from
 * compare/data.ts so the hub and the head-to-heads always say the same thing in the same columns.
 *
 * Pages v2 (owner feedback, 17 October 2026: "they just look like HTML files"): drawn by the kit's ComparisonTable, a
 * real <table> with a caption and scoped headers in a named region that scrolls on its own (never the page), Boredroom's
 * column on fill-0 (neutral: it is ours, not "chosen"). Where a criterion has a plain yes or no answer, the cell leads
 * with a mark (an icon with its word, neutral) and keeps the vendor's own words after it. A mark is a fact, not a
 * verdict: "No screenshots" is a `no` even though it favours Boredroom.
 */

/**
 * The yes / no facts behind the marks, read from the cells in data.ts (nothing new): screenshots or screen video, a
 * productivity score or rating (an activity percentage counts, as the category page says), call recording, and a free
 * plan. Workstatus's "activity and productivity reports" is not marked: its page does not say it rates people.
 */
const MARKS: Record<ToolId, Partial<Record<CriterionKey, { mark: Mark; markLabel?: string }>>> = {
  boredroom: { screen: { mark: "no" }, score: { mark: "no" }, calls: { mark: "no" }, free: { mark: "yes" } },
  activtrak: { screen: { mark: "partial", markLabel: "Add-on" }, score: { mark: "yes" }, calls: { mark: "no" }, free: { mark: "yes" } },
  hubstaff: { screen: { mark: "yes" }, score: { mark: "yes" }, calls: { mark: "no" }, free: { mark: "no" } },
  timedoctor: { screen: { mark: "yes" }, score: { mark: "yes" }, calls: { mark: "no" }, free: { mark: "no" } },
  workstatus: { screen: { mark: "yes" }, calls: { mark: "no" }, free: { mark: "no" } },
  controlio: { screen: { mark: "yes" }, score: { mark: "yes" }, calls: { mark: "no" }, free: { mark: "no" } },
};

/** A cell: the mark (where the criterion has one) and the tool's own words. */
function cell(id: ToolId, key: CriterionKey, text: string): Cell {
  const m = MARKS[id][key];
  return m ? { ...m, text } : text;
}

/**
 * The hub's big table: the six tools as columns (Boredroom's last, on fill-0), the nine questions as rows, a few words a
 * cell. Wide enough to read at 1440px without scrolling; below that it scrolls in its own region, the question held at
 * the left.
 */
export function CategoryTable({ className }: { className?: string }) {
  return (
    <ComparisonTable
      className={className}
      label="Employee monitoring software comparison table"
      caption={<>Six tools compared on the same nine questions, from each vendor&apos;s own pricing and help pages. <AsOf date={AS_OF} />.</>}
      rowHeader="Question"
      columns={HUB_ORDER.map((id) => ({ key: id, label: TOOLS[id].name, ours: id === "boredroom" }))}
      rows={CRITERIA.map((c) => ({ label: c.label, cells: Object.fromEntries(HUB_ORDER.map((id) => [id, cell(id, c.key, TOOLS[id].short[c.key])])) }))}
      layout="matrix"
      minWidth="64rem"
    />
  );
}

/**
 * A head-to-head: a row per criterion (the hub's nine questions, in the hub's order), Boredroom and the other tool side
 * by side, the full answer in each cell. Below 640px each row becomes a small card (the kit's `versus` layout).
 */
export function HeadToHeadTable({ tool, className }: { tool: Exclude<ToolId, "boredroom">; className?: string }) {
  const them = TOOLS[tool];
  const us = TOOLS.boredroom;
  return (
    <ComparisonTable
      className={className}
      label={`Boredroom vs ${them.name} comparison table`}
      caption={<>Boredroom and {them.name} on the nine questions of our <span className="whitespace-nowrap">category comparison</span>, from {them.name}&apos;s own pricing and help pages. <AsOf date={AS_OF} />.</>}
      rowHeader="Question"
      columns={[{ key: us.id, label: us.name, ours: true }, { key: them.id, label: them.name }]}
      rows={CRITERIA.map((c) => ({ label: c.label, cells: { [us.id]: cell(us.id, c.key, us.cells[c.key]), [them.id]: cell(them.id, c.key, them.cells[c.key]) } }))}
      layout="versus"
    />
  );
}

/**
 * What a team of 10, 50 and 200 people pays a month on each plan given, at the listed price (before tax and before any
 * paid support plan or add-on). The plans' `note`s sit under the table, with `footnote` after them.
 */
export function CostTable({ plans, label = "Cost at 10, 50 and 200 people", footnote, minWidth = "34rem", className }: {
  plans: readonly PlanKey[];
  label?: string;
  footnote?: React.ReactNode;
  minWidth?: string;
  className?: string;
}) {
  const notes = plans.flatMap((k) => {
    const p = PLANS[k];
    return "note" in p && p.note ? [p.note] : [];
  });
  return (
    <ComparisonTable
      className={className}
      label={label}
      caption={<>Cost a month in US dollars at the listed price, before tax, add-ons and support plans. <AsOf date={AS_OF} />.</>}
      rowHeader="Plan"
      columns={TEAM_SIZES.map((n) => ({ key: String(n), label: `${n} people` }))}
      rows={plans.map((k) => {
        const p = PLANS[k];
        return {
          label: p.label,
          cells: Object.fromEntries(TEAM_SIZES.map((n) => {
            const cost = monthlyCost(p, n);
            return [String(n), cost === null ? "Not offered" : usd(cost)];
          })),
        };
      })}
      layout="matrix"
      minWidth={minWidth}
      footnote={notes.length || footnote ? <>{notes.length ? <p>{notes.join(" ")}</p> : null}{footnote ? <div className={notes.length ? "mt-2" : undefined}>{footnote}</div> : null}</> : undefined}
    />
  );
}
