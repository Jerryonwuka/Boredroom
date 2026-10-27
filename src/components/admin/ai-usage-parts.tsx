/**
 * Pieces of the Control Center's AI usage pages (server-safe, no hooks): a large count shown short with the exact figure
 * in its tooltip and for screen readers, and a sortable column header (a link that sets `?sort=&dir=`, with aria-sort and
 * an arrow on the column in use; the arrow is foreground grey, never orange: a sort is not a live state).
 */
import Link from "next/link";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

const exact = new Intl.NumberFormat("en-GB");
const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

/** "1.2M", "412.9K" (en-GB compact) with the exact figure in its tooltip; small numbers as they are. */
export function Big({ value }: { value: number }) {
  const full = exact.format(value);
  const short = compact.format(value);
  if (full === short) return <span className="tabular-nums">{full}</span>;
  return (
    <span title={full} className="tabular-nums">
      <span aria-hidden>{short}</span><span className="sr-only">{full}</span>
    </span>
  );
}

export type SortDir = "asc" | "desc";

/** The page's address with these parameters (undefined ones left out). */
export function sortLink(path: string, params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

export function SortHeader({ label, href, active, dir, numeric = true }: { label: string; href: string; active: boolean; dir: SortDir; numeric?: boolean }) {
  const Arrow = dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined} scope="col">
      <Link href={href} scroll={false} className={cn("-mx-1 inline-flex h-7 items-center gap-1 rounded-md px-1 transition-colors duration-75 hover:text-foreground", active && "text-foreground", numeric && "tabular-nums")}>
        {label}
        {active ? <Arrow className="size-3.5" aria-hidden /> : null}
        <span className="sr-only">{active ? `, sorted ${dir === "asc" ? "lowest" : "highest"} first. Sort the other way` : ", sort by this column"}</span>
      </Link>
    </th>
  );
}
