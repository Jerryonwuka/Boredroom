"use client";

/**
 * The top bar's breadcrumb, v4 (spec §6, §7): "Section › Page" in 14/20 medium, the section in the secondary grey,
 * a 14px chevron, the page you are on in the foreground. The section is the page's group in the sidebar ("Work",
 * "Records"); page names are the sidebar's labels, so /home reads "Brenda". On a page inside a page (a task, a doc)
 * the page name links back to its list. Phones show the page alone.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type CrumbPage = { label: string; href: string; group?: string };

export function Breadcrumb({ orgName, pages, className }: { orgName: string; pages: CrumbPage[]; className?: string }) {
  const pathname = usePathname();
  // The longest matching page wins, so /tasks/123 reads "Tasks", and there it links back to the list.
  const page = [...pages].sort((a, b) => b.href.length - a.href.length).find((p) => pathname === p.href || pathname.startsWith(p.href + "/"));
  const parent = page && pathname !== page.href ? page : null;
  const section = page?.group ?? orgName;
  const label = page?.label ?? orgName;
  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm font-medium">
        {page ? (
          <li className="hidden min-w-0 shrink items-center gap-1 sm:flex">
            <span className="truncate text-secondary">{section}</span>
            <ChevronRight className="size-3.5 shrink-0 text-secondary" aria-hidden />
          </li>
        ) : null}
        <li className="flex min-w-0">
          {parent
            ? <Link href={parent.href} className="truncate rounded-md text-foreground transition-colors duration-75 hover:text-secondary">{label}</Link>
            : <span aria-current="page" className="truncate text-foreground">{label}</span>}
        </li>
      </ol>
    </nav>
  );
}
