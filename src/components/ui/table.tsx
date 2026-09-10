import { cn } from "@/lib/utils";

export function DataTable({ children, className, caption }: { children: React.ReactNode; className?: string; caption?: string }) {
  return (
    <div className={cn("tile overflow-x-auto", className)}>
      <table className="data">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}
