import { redirect } from "next/navigation";
import Link from "next/link";
import { Lock } from "lucide-react";
import { getAdmin } from "@/server/admin/auth";
import { getCurrentUser } from "@/server/auth";
import { launchSettings } from "@/server/admin/settings";
import { AdminShell } from "@/components/admin/shell";
import { Logo } from "@/components/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Control Center", template: "%s · Control Center" } };

/** Every Control Center page sits inside this: sign in first; an account without an admin row sees a plain refusal. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  if (!admin) {
    const user = await getCurrentUser();
    if (!user) redirect("/login?next=/admin");
    return (
      <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-5 py-24 text-center">
        <Logo href="/app" height={18} />
        <span aria-hidden className="mt-10 grid size-12 place-items-center rounded-xl bg-fill-1 text-secondary shadow-[0_0_0_1px_var(--border)] [&_svg]:size-6"><Lock strokeWidth={1.75} /></span>
        <h1 className="type-page-title mt-4">This area is for Boredroom administrators</h1>
        <p className="mt-2 text-sm font-normal text-secondary">You are signed in as <span className="font-medium text-foreground">{user.email}</span>, which is not an administrator account. If it should be, ask a super admin to add it under Admins and permissions.</p>
        <Link href="/app" className={cn(buttonVariants({ variant: "primary" }), "mt-6")}>Back to the app</Link>
      </main>
    );
  }
  const launch = await launchSettings(true);
  return <AdminShell admin={admin} launch={launch}>{children}</AdminShell>;
}
