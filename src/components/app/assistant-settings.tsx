"use client";

/**
 * Settings for the assistants (owner decision, 7 October 2026: personal assistants; everyone customises their assistant in
 * Settings). "Your assistant" is every person's own, in every role; "Workspace assistant" is the workspace's, which signs
 * what the workspace sends on its own (the end-of-day team report), edited by owners and HR in the Brenda section.
 *
 * Each is a settings section over one card: the live preview, then the editor's rows (Name, Colour, Visor, Eyes), then
 * a failed save's alert, then the footer. The alert sits right above Save, where the person is looking, and is scrolled
 * into view; a server fault reads as the plain "Could not save" line, not the server's own words (review, 7 October
 * 2026). The footer: "Reset to Brenda" puts Brenda's name and look in the draft (saved only with Save), Save sends it and is
 * off while the draft is what is saved. After a save the page refreshes, so the shell (the sidebar's name and glyph, the
 * faces, the drawer) shows the new assistant at once.
 *
 * Her voice (owner decision, 7 October 2026: phase 2): "Your assistant" is followed by its Voice card
 * (assistant-voice-settings, rendered by the Settings page). The workspace assistant's preview is `quiet`: it is not the
 * person's own, so it never talks while theirs speaks.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api, isApiFailure } from "@/lib/api-client";
import { SettingsSection, SettingsFooter, SettingsAlert, SETTINGS_GROUP } from "@/components/app/settings-forms";
import { AssistantEditor, AssistantPreview, assistantBody, assistantFieldErrors, keepErrors, profileKey, type AssistantFieldErrors } from "@/components/app/assistant-editor";
import { DEFAULT_ASSISTANT, assistantNameProblem, type AssistantProfile } from "@/lib/assistant-look";

const OFFLINE = "Could not save. Check your connection and try again.";

function AssistantForm({ initial, idPrefix, url, read, canEdit, readOnly, quiet = false }: {
  initial: AssistantProfile; idPrefix: string; url: string;
  /** The saved profile out of the PUT's answer. */ read: (r: unknown) => AssistantProfile;
  canEdit: boolean; readOnly?: string;
  /** The preview never talks: it is not the person's own assistant. */ quiet?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  // What the server last confirmed. When the page brings a new one (after a save, or a change made elsewhere), it takes
  // over, and so does the draft unless the person has unsaved changes in it.
  const [saved, setSaved] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (profileKey(seen) !== profileKey(initial)) {
    setSeen(initial); setSaved(initial);
    if (profileKey(draft) === profileKey(saved)) setDraft(initial);
  }
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<AssistantFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failure) alertRef.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [failure]);
  const [status, setStatus] = useState<string | null>(null);
  const dirty = profileKey(draft) !== profileKey(saved);
  const isBrenda = profileKey(draft) === profileKey(DEFAULT_ASSISTANT);

  const change = (next: AssistantProfile) => { setErrors((e) => keepErrors(e, draft, next)); setStatus(null); setFailure(null); setDraft(next); };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canEdit || pending || !dirty) return;
    const problem = assistantNameProblem(draft.name);
    if (problem) { setErrors({ name: problem }); setStatus(null); document.getElementById(`${idPrefix}-name`)?.focus(); return; }
    setPending(true); setErrors({}); setFailure(null); setStatus(null);
    try {
      const r = read(await api(url, { method: "PUT", body: assistantBody(draft) }));
      setSaved(r); setDraft(r); setStatus("Saved");
      router.refresh();
    } catch (err) {
      const fields = assistantFieldErrors(err);
      // A refusal (4xx) says why in words meant for the person; a fault (5xx) or no answer at all is "Could not save".
      if (fields) setErrors(fields); else setFailure(isApiFailure(err) && err.error.status < 500 ? err.error.message : OFFLINE);
    } finally {
      setPending(false);
    }
  };

  return (
    <form className={cn(SETTINGS_GROUP, "@container")} noValidate onSubmit={(e) => void save(e)}>
      <div className="px-5 py-4"><AssistantPreview profile={draft} size={72} quiet={quiet} /></div>
      <AssistantEditor layout="rows" value={draft} onChange={change} idPrefix={idPrefix} disabled={!canEdit || pending} error={errors} />
      {failure ? <div ref={alertRef} className="scroll-mb-24"><SettingsAlert>{failure}</SettingsAlert></div> : null}
      <SettingsFooter status={status ?? undefined} busy={pending ? "Saving…" : undefined}>
        {canEdit ? (
          <>
            <Button variant="ghost" size="md" disabled={pending || isBrenda} onClick={() => change({ ...DEFAULT_ASSISTANT })}>Reset to Brenda</Button>
            <Button type="submit" variant="secondary" size="md" disabled={!dirty} loading={pending}>Save</Button>
          </>
        ) : readOnly ? <p className="text-meta font-normal text-secondary">{readOnly}</p> : null}
      </SettingsFooter>
    </form>
  );
}

const readPersonal = (r: unknown) => (r as { personal: AssistantProfile }).personal;
const readWorkspace = (r: unknown) => (r as { workspace: AssistantProfile }).workspace;

/** "Your assistant": the person's own assistant in this workspace, for every role. */
export function MyAssistantSettings({ orgSlug, initial, impersonated = false }: { orgSlug: string; initial: AssistantProfile; impersonated?: boolean }) {
  return (
    <SettingsSection id="assistant" title="Your assistant" description="The name and look of the assistant who works with you here. People in this workspace can see them.">
      {/* Only the person chooses: an administrator signed in as them sees it read-only (the server refuses the save too). */}
      <AssistantForm initial={initial} idPrefix="my-assistant" url={`/api/orgs/${orgSlug}/brenda/assistant`} read={readPersonal} canEdit={!impersonated}
        readOnly="Only the person can change their assistant. It stays as it is while you are signed in as them." />
    </SettingsSection>
  );
}

/** "Workspace assistant": the workspace's own, which signs what it sends by itself; owners and HR change it. */
export function WorkspaceAssistantSettings({ orgSlug, initial, canEdit }: { orgSlug: string; initial: AssistantProfile; canEdit: boolean }) {
  return (
    <SettingsSection id="workspace-assistant" title="Workspace assistant" description="Signs what the workspace sends on its own, such as the end-of-day team report.">
      <AssistantForm initial={initial} idPrefix="ws" url={`/api/orgs/${orgSlug}/brenda/workspace-assistant`} read={readWorkspace} canEdit={canEdit}
        readOnly="Only the organisation owner or HR can change the workspace assistant." quiet />
    </SettingsSection>
  );
}
