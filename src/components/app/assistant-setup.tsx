"use client";

/**
 * "Meet your assistant" (owner decision, 7 October 2026: personal assistants). The first time a person opens a workspace
 * page with no saved setup (one per workspace: it is per membership), while the plan includes the assistant and nobody
 * is impersonating, `AppShell` mounts this and it opens at once, focus in the Name field. They give their assistant a
 * name, a colour, a visor and eyes with the live preview above, or keep Brenda.
 *
 * Calm and skippable: "Keep Brenda", Escape and the close button all keep Brenda and mark setup done, so it never comes
 * back on the next page; a click on the overlay does nothing, so a stray click does not decide for them. If the skip
 * cannot be saved it still closes for this page view (it asks again next time) and says nothing. Save checks the name
 * first with the server's own rule, shows the server's field errors on their fields and anything else above the footer.
 * No orange button: the chosen swatch's ring is the only orange.
 */
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { successToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { useAssistant } from "@/components/app/assistant-context";
import { AssistantEditor, AssistantPreview, assistantBody, assistantFieldErrors, keepErrors, type AssistantFieldErrors } from "@/components/app/assistant-editor";
import { assistantNameProblem, type AssistantProfile } from "@/lib/assistant-look";

const ID = "setup";

export function AssistantSetup({ orgSlug, orgName }: { orgSlug: string; orgName: string }) {
  const router = useRouter();
  const { personal } = useAssistant();
  const formId = useId();
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState<AssistantProfile>(personal);
  const [busy, setBusy] = useState<"save" | "skip" | null>(null);
  const [errors, setErrors] = useState<AssistantFieldErrors>({});
  const [failed, setFailed] = useState(false);

  const change = (next: AssistantProfile) => { setErrors((e) => keepErrors(e, draft, next)); setFailed(false); setDraft(next); };

  const keepBrenda = async () => {
    if (busy) return;
    setBusy("skip");
    try {
      await api(`/api/orgs/${orgSlug}/brenda/assistant/skip`, { method: "POST", retries: 1 });
      router.refresh();
    } catch { /* closes anyway for this page view; it asks again next time */ }
    setBusy(null);
    setOpen(false);
  };

  const save = async () => {
    if (busy) return;
    const problem = assistantNameProblem(draft.name);
    if (problem) { setErrors({ name: problem }); document.getElementById(`${ID}-name`)?.focus(); return; }
    setBusy("save"); setFailed(false); setErrors({});
    try {
      const r = await api<{ personal: AssistantProfile; setupDone: true }>(`/api/orgs/${orgSlug}/brenda/assistant`, { method: "PUT", body: assistantBody(draft) });
      setOpen(false);
      successToast(`Say hello to ${r.personal.name}`, "Change the name or look any time in Settings.");
      router.refresh();
    } catch (err) {
      const fields = assistantFieldErrors(err);
      if (fields) setErrors(fields); else setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onClose={() => void keepBrenda()} dismissible={false} closeLabel="Close and keep Brenda"
      title="Meet your assistant"
      description={`Your assistant works with you in ${orgName}. Give them a name and a look, or keep Brenda. You can change this any time in Settings.`}
      footer={
        <>
          <Button variant="secondary" size="md" disabled={!!busy} loading={busy === "skip"} onClick={() => void keepBrenda()}>{busy === "skip" ? "Saving…" : "Keep Brenda"}</Button>
          <Button type="submit" form={formId} size="md" disabled={!!busy} loading={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</Button>
        </>
      }>
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); void save(); }} className="grid gap-5">
        <AssistantPreview profile={draft} size={64} className="justify-center border-b border-border pb-4" />
        <AssistantEditor value={draft} onChange={change} idPrefix={ID} disabled={!!busy} error={errors} />
        {failed ? <Alert tone="danger">Could not save. Check your connection and try again.</Alert> : null}
      </form>
    </Dialog>
  );
}
