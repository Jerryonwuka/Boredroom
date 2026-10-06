import Link from "next/link";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { WRAP } from "@/components/landing/parts";
import { cn } from "@/lib/utils";

const LINK = "flex h-7 items-center text-sm font-normal text-secondary transition-colors duration-75 hover:text-foreground";

/** The footer, v4: a hairline above, the logo and one line, three quiet link columns, the closing line. */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className={cn(WRAP, "grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]")}>
        <div className="max-w-xs">
          <Logo />
          <p className="mt-4 text-sm font-normal text-secondary">A live view of what your remote team plans, works on and delivers. No status meeting required.</p>
          <Badge tone="success" dot size="lg" className="mt-5">Private pilot, accepting workspaces</Badge>
        </div>
        <nav aria-label="Product">
          <p className="mb-2 text-sm font-medium text-foreground">Product</p>
          <a href="#how" className={LINK}>How it works</a>
          <a href="#product" className={LINK}>The day</a>
          <a href="#control" className={LINK}>Everything in view</a>
          <a href="#fair" className={LINK}>Fairness</a>
        </nav>
        <nav aria-label="Account">
          <p className="mb-2 text-sm font-medium text-foreground">Account</p>
          <Link href="/login" className={LINK}>Log in</Link>
          <Link href="/signup?intent=org" className={LINK}>Create an organisation</Link>
          <Link href="/join" className={LINK}>Join with a code</Link>
          <Link href="/recover" className={LINK}>Recover a password</Link>
        </nav>
        <nav aria-label="Help">
          <p className="mb-2 text-sm font-medium text-foreground">Help</p>
          <a href="#faq" className={LINK}>FAQ</a>
          <a href="#fair" className={LINK}>What is recorded</a>
          <a href="mailto:jonwuka@xsitecapital.com" className={LINK}>Contact</a>
        </nav>
      </div>
      <div className="border-t border-border">
        <p className={cn(WRAP, "py-6 text-xs font-normal text-subtle")}>Boredroom, 2026. Built for teams that are out of sight, not out of the loop.</p>
      </div>
    </footer>
  );
}
