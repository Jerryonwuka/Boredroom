import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * A defined list (owner decision, 25 September 2026): every row has a place for who, what, a little context and a
 * value on the right, separated by hairlines, brightening on hover. Replaces the "title, name, due date" sentence.
 */
export function RowList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <ul className={cn("divide-y divide-border-soft", className)}>{children}</ul>;
}

export function Row({ leading, title, meta, trailing, href, className }: { leading?: React.ReactNode; title: React.ReactNode; meta?: React.ReactNode; trailing?: React.ReactNode; href?: string; className?: string }) {
  const body = (
    <>
      {leading ? <div className="shrink-0">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{title}</p>
        {meta ? <p className="truncate text-xs text-fg-subtle">{meta}</p> : null}
      </div>
      {trailing ? <div className="shrink-0 text-right text-xs text-fg-muted tabular-nums">{trailing}</div> : null}
    </>
  );
  const cls = cn("flex items-center gap-3 px-2 py-2.5 transition-colors duration-[var(--duration-fast)]", href && "-mx-2 rounded-[var(--radius-sm)] hover:bg-wash", className);
  return <li>{href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

export function RowEmpty({ children = "None." }: { children?: React.ReactNode }) {
  return <li className="px-2 py-3 text-sm text-fg-subtle">{children}</li>;
}
