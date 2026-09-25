import { requireAdmin, can } from "@/server/admin/auth";
import { listTemplates } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TemplateForm, TemplatePreview } from "@/components/admin/marketing-forms";
import { EditSheet } from "@/components/admin/actions";

export const metadata = { title: "Email templates" };

export default async function TemplatesPage() {
  const admin = await requireAdmin("marketing.view");
  const templates = await listTemplates();
  const editable = can(admin, "marketing.create");
  const groups = ["marketing", "lifecycle", "billing", "transactional"].map((cat) => ({ cat, items: templates.filter((t) => t.category === cat) }));
  return (
    <>
      <PageHeader icon="doc-link-check" title="Email templates" description="Every email a campaign or automation can send, on the Boredroom design. Variables in double braces are filled per recipient." />
      {groups.map((g) => g.items.length ? (
        <section key={g.cat} className="mb-8">
          <h2 className="eyebrow mb-3">{g.cat}</h2>
          <div className="grid gap-4 md:grid-cols-2">{g.items.map((t) => (
            <Card key={t.id}><CardHeader title={<span className="flex items-center gap-2">{t.name}<Badge tone="neutral">{t.code}</Badge></span>} description={t.subject} />
              <p className="line-clamp-3 text-sm text-fg-muted">{t.body}</p>
              <div className="mt-3 flex flex-wrap gap-2"><TemplatePreview id={t.id} /></div>
              {editable ? <div className="mt-3"><EditSheet title={`Edit ${t.name}`}><TemplateForm template={t} /></EditSheet></div> : null}
            </Card>
          ))}</div>
        </section>
      ) : null)}
      {editable ? <Card><CardHeader title="New template" /><TemplateForm /></Card> : null}
    </>
  );
}
