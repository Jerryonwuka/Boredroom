import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listMyWorkspaces } from "@/server/services/orgs";

/** From the pricing page, signed in: lands on the plan section of the first workspace the person owns, with the plan chosen. */
export default async function BillingRedirect({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/app/billing${plan ? `?plan=${plan}` : ""}`)}`);
  const workspaces = await listMyWorkspaces(user.profileId);
  const owned = workspaces.find((w) => w.role === "owner" || w.role === "hr") ?? workspaces[0];
  if (!owned) redirect(`/onboarding${plan ? `?plan=${plan}` : ""}`);
  redirect(`/app/${owned.slug}/settings?billing=1${plan ? `&plan=${encodeURIComponent(plan)}` : ""}#billing`);
}
