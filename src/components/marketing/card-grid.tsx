import { ToolSquare } from "@/components/ui/tool-tile";
import { Badge } from "@/components/ui/badge";
import { arrive } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

export type CardItem = {
  title: string;
  body: React.ReactNode;
  /** A lucide icon (its animated twin plays where one exists) or BrendaGlyph. */
  icon?: React.ReactNode;
  /** A neutral word at the top right of the cell ("At any price"). */
  badge?: string;
  /** Extra content under the body (a link row, a small table …). */
  footer?: React.ReactNode;
};

/** Grid columns: one on a phone, two from 640px, `columns` from 1024px. */
const COLS: Record<2 | 3 | 4, string> = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };
/** An odd last cell spans what is left of its row (so the hairline grid never shows an empty hole). */
const LAST_SPAN: Record<2 | 3 | 4, (n: number) => string | false> = {
  2: (n) => n % 2 === 1 && "sm:col-span-2",
  3: (n) => (n % 3 === 1 ? "lg:col-span-3" : n % 3 === 2 && "lg:col-span-2") || false,
  4: (n) => (n % 4 === 1 ? "lg:col-span-4" : n % 4 === 2 ? "lg:col-span-3" : n % 4 === 3 && "lg:col-span-2") || false,
};
const SM_SPAN = (n: number, columns: 2 | 3 | 4) => columns !== 2 && n % 2 === 1 && "max-lg:sm:col-span-2";

/**
 * A grid of cards (owner feedback, 17 October 2026: pages v2; the reference's "in practice" cards in the home page's
 * look). `variant="hairline"`: the home page's point grid, cells on the canvas joined by 1px hairlines in one r20 card,
 * whose words arrive in reading order while the cells stay put (so the hairlines never flash). `variant="cards"`:
 * separate r20 cards on fill-0, 12px apart, for text-heavy cards (a tool per card, sourced facts).
 * Cell: a 40px tool square (neutral), the title (h3 by default, 16/24 semibold), the text, an optional footer.
 *
 *   <CardGrid columns={3} items={[{ icon: <ShieldCheck />, title: "…", body: "…" }]} />
 */
export function CardGrid({ items, columns = 3, variant = "hairline", headingLevel = "h3", className }: {
  items: readonly CardItem[];
  columns?: 2 | 3 | 4;
  variant?: "hairline" | "cards";
  headingLevel?: "h3" | "h4";
  className?: string;
}) {
  const Heading = headingLevel;
  const hairline = variant === "hairline";
  const n = items.length;
  return (
    <ul data-lp-arrive={hairline ? true : undefined}
      className={cn("grid", COLS[columns], hairline ? "gap-px overflow-hidden rounded-[20px] border border-border bg-border" : "gap-3", className)}>
      {items.map((item, i) => {
        const lastOdd = i === n - 1;
        const cell = (
          <>
            {item.badge ? <Badge className="absolute right-5 top-5">{item.badge}</Badge> : null}
            {item.icon ? <ToolSquare className="mb-5">{item.icon}</ToolSquare> : null}
            <Heading className={cn("text-base font-semibold text-foreground text-pretty", item.badge && "pr-24")}>{item.title}</Heading>
            <div className="lp-text mk-links mt-1.5 [&>*+*]:mt-3">{item.body}</div>
            {item.footer ? <div className="mt-4">{item.footer}</div> : null}
          </>
        );
        return (
          <li key={item.title} className={cn("relative min-w-0", hairline ? "bg-background p-6" : "lp-reveal rounded-[20px] border border-border bg-fill-0 p-6",
            lastOdd && LAST_SPAN[columns](n), lastOdd && SM_SPAN(n, columns))}
            style={hairline ? undefined : arrive(i % columns)}>
            {hairline ? <div className="lp-item flex h-full flex-col" style={arrive(i)}>{cell}</div> : cell}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What the product never does (owner feedback, 17 October 2026: pages v2; the reference's "limits" grid, and
 * Boredroom's core message: no score, no screen or call recording). A hairline CardGrid whose titles state the limit
 * themselves ("No productivity score"); `badge` puts one neutral word on every cell, only where it adds something
 * ("At any price" on /pricing). Positive rules ("Nothing lands on anyone's list until they accept it") go in a CardGrid.
 */
export function LimitsGrid({ items, columns = 3, badge, headingLevel, className }: {
  items: readonly CardItem[];
  columns?: 2 | 3 | 4;
  badge?: string;
  headingLevel?: "h3" | "h4";
  className?: string;
}) {
  return <CardGrid items={badge ? items.map((i) => ({ ...i, badge: i.badge ?? badge })) : items} columns={columns} headingLevel={headingLevel} className={className} />;
}
