import { FileText } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { listTemplates } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader, SectionTitle } from "@/components/ui/card";
import { MonoChip } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { TemplateForm, TemplatePreview } from "@/components/admin/marketing-forms";
import { EditSheet, SheetButton } from "@/components/admin/actions";
import { MARKETING_TABS, words } from "@/components/admin/fields";

export const metadata = { title: "Email templates" };

export default async function TemplatesPage() {
  const admin = await requireAdmin("marketing.view");
  const templates = await listTemplates();
  const editable = can(admin, "marketing.create");
  const groups = ["marketing", "lifecycle", "billing", "transactional"].map((cat) => ({ cat, items: templates.filter((t) => t.category === cat) }));
  return (
    <>
      <PageHeader title="Email templates" description="Every email a campaign or automation can send, on the Boredroom design. Variables in double braces are filled per recipient."
        actions={editable ? <SheetButton label="New template" icon="plus" variant="accent" sheetSize="lg" title="New template"><TemplateForm /></SheetButton> : null}
        tabs={MARKETING_TABS} tabsLabel="Marketing sections" />
      {templates.length === 0 ? <EmptyState icon={FileText} title="No templates yet" description="Campaigns and automations send from these." /> : null}
      {groups.map((g) => g.items.length ? (
        <section key={g.cat} className="mb-10" aria-labelledby={`templates-${g.cat}`}>
          <SectionTitle id={`templates-${g.cat}`} title={words(g.cat)} />
          <div className="grid gap-3 md:grid-cols-2">{g.items.map((t) => (
            <Card key={t.id} className="min-w-0">
              <CardHeader title={<span className="flex flex-wrap items-center gap-2">{t.name}<MonoChip>{t.code}</MonoChip></span>} description={t.subject} size="sm" className="mb-3" />
              <p className="line-clamp-3 text-sm font-normal text-secondary">{t.body}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {editable ? <EditSheet title={`Edit ${t.name}`} size="lg"><TemplateForm template={t} /></EditSheet> : null}
                <TemplatePreview id={t.id} name={t.name} />
              </div>
            </Card>
          ))}</div>
        </section>
      ) : null)}
    </>
  );
}
