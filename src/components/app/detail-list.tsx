import { cn } from "@/lib/utils";

/**
 * Label and value rows for a details panel (v4): the label 13/19.5 in the secondary grey on the left, the value 14/20
 * medium in the foreground beside it, rows separated by space, never lines. Used by the task page's details panel and
 * the task and to-do pop-ups.
 */
export function DetailList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4", className)}>{children}</dl>;
}

export function DetailRow({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <>
      <dt className="py-2 text-meta leading-5 font-normal text-secondary">{label}</dt>
      <dd className={cn("min-w-0 py-2 text-sm font-medium text-foreground [overflow-wrap:anywhere]", className)}>{children}</dd>
    </>
  );
}
