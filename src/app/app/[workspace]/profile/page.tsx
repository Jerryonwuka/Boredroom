import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell, ROLE_LABEL } from "@/components/app/shell";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProfileForm } from "@/components/app/profile-form";
import { PresencePicker } from "@/components/app/topbar";
import { myProfile } from "@/server/services/profile";
import { formatLongDate } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile" };

/** The person's own page: picture, name, title, status; the account and the workspaces they belong to. */
export default async function ProfilePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/profile`);
  const me = await myProfile(ctx.user);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="person-laptop" back={{ href: `/app/${ctx.org.slug}`, label: "Home" }} title="Your profile" description="How you appear to the people you work with. Your picture, name and status show beside your name across the workspace." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <ProfileForm profileId={me.id} displayName={me.displayName} title={me.title} statusText={me.statusText} avatarKey={me.avatarKey} />
        </Card>
        <aside className="space-y-4">
          <Card>
            <CardHeader title="Work status" description="Shown as the dot on your picture wherever your name appears." className="mb-1" />
            <PresencePicker value={me.presence} className="border-0 px-0 pb-0" />
          </Card>
          <Card>
            <CardHeader title="Account" className="mb-2" />
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-fg-subtle">Email</dt><dd className="mt-0.5">{me.email} {ctx.user.emailVerified ? <Badge tone="success">verified</Badge> : <Badge tone="warning">not verified</Badge>}</dd></div>
              <div><dt className="text-xs text-fg-subtle">Member since</dt><dd className="mt-0.5">{formatLongDate(me.createdAt.slice(0, 10))}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-fg-subtle">Change your password from <Link href="/recover" className="text-fg-muted hover:text-fg">Recover a password</Link>; the link goes to your email.</p>
          </Card>
          <Card>
            <CardHeader title="Your workspaces" className="mb-2" />
            <ul className="space-y-2 text-sm">
              {me.workspaces.map((w) => (
                <li key={w.id} className="chip chip-link px-3 py-2">
                  <Link href={`/app/${w.slug}`} className="flex items-center justify-between gap-2"><span className="font-medium">{w.name}</span><Badge tone={w.slug === ctx.org.slug ? "accent" : "neutral"}>{ROLE_LABEL[w.role] ?? w.role}</Badge></Link>
                  <p className="mt-0.5 text-xs text-fg-subtle">ID {w.employeeCode}{w.teams.length ? `, ${w.teams.join(", ")}` : ""}</p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </AppShell>
  );
}
