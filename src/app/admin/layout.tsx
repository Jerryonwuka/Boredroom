import { redirect } from "next/navigation";
import { getAdmin } from "@/server/admin/auth";
import { getCurrentUser } from "@/server/auth";
import { launchSettings } from "@/server/admin/settings";
import { AdminShell } from "@/components/admin/shell";
import { Logo } from "@/components/logo";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Control Center", template: "%s · Control Center" } };

/** Every Control Center page sits inside this: sign in first; an account without an admin row sees a plain refusal. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdmin();
  if (!admin) {
    const user = await getCurrentUser();
    if (!user) redirect("/login?next=/admin");
    return (
      <main className="mx-auto max-w-lg px-4 py-24 text-center">
        <Logo />
        <h1 className="mt-8 font-display text-2xl">This area is for Boredroom administrators</h1>
        <p className="mt-2 text-fg-muted">You are signed in as {user.email}, which is not an administrator account. If it should be, a super admin adds it under Admins and permissions, or the address goes in PLATFORM_SUPER_ADMINS on the server.</p>
        <Link href="/app" className="btn mt-6 inline-flex h-11 items-center rounded-[var(--radius)] px-5 text-sm font-semibold">Back to the app</Link>
      </main>
    );
  }
  const launch = await launchSettings(true);
  return <AdminShell admin={admin} launch={launch}>{children}</AdminShell>;
}
