/**
 * The site's top-level navigation (owner request, 17 October 2026: SEO analysis, Implementation Spec Section B: exactly
 * these seven links, these labels, this order). Kept apart from the registry so the notch nav (a client component) does
 * not carry every page's copy to the browser; tests/unit/marketing-registry.test.ts checks each path is registered.
 */
export const NAV = [
  { label: "Features", path: "/features" },
  { label: "Solutions", path: "/solutions" },
  { label: "Use cases", path: "/usecases" },
  { label: "Compare", path: "/compare" },
  { label: "Free tools", path: "/free-tools" },
  { label: "Blog", path: "/blog" },
  { label: "Pricing", path: "/pricing" },
] as const;

export type NavItem = (typeof NAV)[number];

/** The nav item a path belongs to (the item itself or any page under it), if any. */
export function navItemFor(pathname: string | null | undefined): NavItem | undefined {
  if (!pathname) return undefined;
  return NAV.find((n) => pathname === n.path || pathname.startsWith(`${n.path}/`));
}
