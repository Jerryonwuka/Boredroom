import Link from "next/link";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { CONTACT_EMAIL, WRAP } from "@/components/landing/parts";
import { ENTITY_SENTENCE } from "@/lib/marketing/site";
import type { MarketingPath } from "@/lib/marketing/registry";
import { cn } from "@/lib/utils";

const LINK = "flex min-h-7 items-center py-0.5 text-sm font-normal text-secondary transition-colors duration-75 hover:text-foreground";

/**
 * The site's pages, by column (owner request, 17 October 2026: SEO analysis, Section D: the footer links the site, not
 * the home page's anchors, so it works on every public page). The section pages and the flagship page of each; the
 * home page's own sections are reached from its nav and from Help. Anchor text names the destination.
 */
const COLUMNS: { title: string; links: { label: string; href: MarketingPath }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "AI assistant for teams", href: "/features/ai-assistant" },
      { label: "Brenda for Mac", href: "/download" },
      { label: "Attendance and timesheets", href: "/features/attendance-timesheets" },
      { label: "Solutions", href: "/solutions" },
      { label: "Use cases", href: "/usecases" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Blog", href: "/blog" },
      { label: "End-of-day report guide", href: "/blog/end-of-day-report" },
      { label: "Free tools", href: "/free-tools" },
      { label: "Work hours calculator", href: "/free-tools/work-hours-calculator" },
      { label: "Compare", href: "/compare" },
      { label: "Employee monitoring software comparison", href: "/compare/employee-monitoring-software" },
    ],
  },
];

/**
 * The footer, v4: a hairline above, the logo and the sentence that defines Boredroom (the same words everywhere, GEO
 * §15.1), the site's columns, Account and Help, then the closing line. The badge says where the product stands (owner
 * request, 10 October 2026): "Opening soon" in waitlist mode, "Private pilot" otherwise. The logo sits below the fold, so
 * it loads lazily (SEO analysis, A10).
 */
export function SiteFooter({ waitlist = false }: { waitlist?: boolean }) {
  return (
    <footer className="mt-24 border-t border-border">
      <div className={cn(WRAP, "grid gap-x-8 gap-y-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1.2fr_1fr_0.8fr]")}>
        <div className="max-w-xs sm:col-span-2 lg:col-span-1">
          <Logo alt="Boredroom" loading="lazy" />
          <p className="mt-4 text-sm font-normal text-secondary">{ENTITY_SENTENCE} No productivity score, and no screen or call recording.</p>
          {waitlist ? <Badge dot size="lg" className="mt-5">Opening soon</Badge> : <Badge tone="success" dot size="lg" className="mt-5">Private pilot</Badge>}
        </div>
        {COLUMNS.map((c) => (
          <nav key={c.title} aria-label={c.title}>
            <p className="mb-2 text-sm font-medium text-foreground">{c.title}</p>
            {c.links.map((l) => <Link key={l.href} href={l.href} className={LINK}>{l.label}</Link>)}
          </nav>
        ))}
        <nav aria-label="Account">
          <p className="mb-2 text-sm font-medium text-foreground">Account</p>
          <Link href="/login" className={LINK}>Log in</Link>
          <Link href="/signup?intent=org" className={LINK}>Create an organisation</Link>
          <Link href="/join" className={LINK}>Join with a code</Link>
          <Link href="/recover" className={LINK}>Recover a password</Link>
        </nav>
        <nav aria-label="Help">
          <p className="mb-2 text-sm font-medium text-foreground">Help</p>
          <Link href="/#faq" className={LINK}>FAQ</Link>
          <Link href="/#fair" className={LINK}>What is tracked</Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className={LINK}>Contact</a>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className={cn(WRAP, "py-6 text-xs font-normal text-subtle")}>Boredroom, 2026. Built for teams that are out of sight, not out of the loop.</p>
      </div>
    </footer>
  );
}
