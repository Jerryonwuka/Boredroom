import { Suspense } from "react";
import { notFound } from "next/navigation";
import { DesignGallery } from "./gallery";

export const metadata = { title: "Design system v4" };

/**
 * Development gallery of design system v4 (no sign-in needed, never in production): every primitive in src/components/ui
 * in each state, dark and light side by side, and a sample app frame to copy patterns from. docs/design-system.md has
 * the rules.
 */
export default function DesignPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <Suspense><DesignGallery /></Suspense>;
}
