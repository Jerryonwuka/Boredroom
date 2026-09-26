import { redirect } from "next/navigation";

/** Pricing lives on the home page; this keeps /pricing working as a link. */
export default function PricingPage() {
  redirect("/#pricing");
}
