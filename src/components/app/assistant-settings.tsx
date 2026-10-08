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
 *
 * Permissions (owner decision, 8 October 2026: act without asking, "you can toggle it on and off, just like the way it is
 * on Claude Code"): `MyActModeSettings`, after Voice. Two radios, "Ask me before acting" (the default) and "Act without
 * asking", saved the moment one is chosen through the page's shared mode (act-mode-pill's `useActMode`), so her box's
 * pill follows at once; the choice shows at once and goes back, with the reason, if the save fails, the last of a burst
 * winning. Disabled, with the saved choice shown, while the workspace has it turned off (an info alert says so), while
 * someone else is signed in as the person, and before migration 0045. No orange of its own: the chosen radio is the
 * primitive's.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Radio } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { api, isApiFailure } from "@/lib/api-client";
import { SettingsSection, SettingsFooter, SettingsAlert, SETTINGS_GROUP } from "@/components/app/settings-forms";
import { AssistantEditor, AssistantPreview, assistantBody, assistantFieldErrors, keepErrors, profileKey, type AssistantFieldErrors } from "@/components/app/assistant-editor";
import { useActMode } from "@/components/app/act-mode-pill";
import { DEFAULT_ASSISTANT, assistantNameProblem, type AssistantProfile } from "@/lib/assistant-look";
import { ACT_WORDS, type ActMode, type ActState } from "@/lib/act-mode";

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

const P = ACT_WORDS.settings;

/**
 * "Permissions": whether the person's assistant asks before acting (owner decision, 8 October 2026). `initial`: the page's
 * read of the person's mode (`assistantProfiles(ctx).act`). Review, 8 October 2026: `ai` false (no AI connected) says that
 * acting without asking needs it, since the built-in helper always asks; the floors are a list under the choice, not a
 * paragraph; `workspaceHref` (owners and HR) links the workspace lock to the switch in Settings → Brenda.
 */
export function MyActModeSettings({ orgSlug, name, initial, ai = true, workspaceHref }: { orgSlug: string; name: string; initial: ActState; ai?: boolean; workspaceHref?: string }) {
  const id = useId();
  const labelId = `${id}-label`;
  const { state, set } = useActMode(orgSlug, initial);
  const locked = !state.ready || !!state.locked;
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  // Only the newest choice made here says how it went.
  const latest = useRef(0);

  const choose = async (mode: ActMode) => {
    if (locked || mode === state.mode) return;
    const mine = ++latest.current;
    setSave({ state: "saving" });
    const r = await set(mode, { quiet: true });
    if (latest.current !== mine) return;
    setSave(!r ? { state: "idle" } : r.ok ? { state: "saved" } : { state: "error", message: r.message });
  };

  // What still asks, as a list under the choices (a list is never a paragraph; owner rule, 7 October 2026), outside the
  // radio's label so its name stays short; the "Act without asking" radio is described by it.
  const floorsId = `${id}-floors`;
  const options: { value: ActMode; label: string; hint: string; describedBy?: string }[] = [
    { value: "ask", label: P.ask.label, hint: P.ask.hint(name) },
    { value: "auto", label: P.auto.label, hint: P.auto.hint(name), describedBy: floorsId },
  ];
  return (
    <SettingsSection id="permissions" title={P.section} description={P.description(name)}>
      <div className={cn(SETTINGS_GROUP, "@container")}>
        {!state.ready ? <SettingsAlert tone="info">{P.notReady}</SettingsAlert>
          : state.locked === "workspace" ? (
            <SettingsAlert tone="info">
              {P.lockedWorkspace(name)}
              {workspaceHref ? <> <Link href={workspaceHref} className="link-inline font-medium">{P.openWorkspaceSetting}</Link></> : null}
            </SettingsAlert>
          ) : !ai ? <SettingsAlert tone="info">{P.needsAi(name)}</SettingsAlert> : null}
        {/* A settings row: the group's name in the label column, the two choices beside it (under it on a phone). */}
        <div className="grid min-w-0 gap-x-8 gap-y-3 px-5 py-4 @2xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @2xl:items-start">
          <p id={labelId} className="text-sm font-medium text-foreground">{P.group(name)}</p>
          <div className="grid min-w-0 gap-3">
            <div role="radiogroup" aria-labelledby={labelId} className="grid min-w-0 gap-3">
              {options.map((o) => (
                <Radio key={o.value} name={`${id}-act-mode`} value={o.value} checked={state.mode === o.value} disabled={locked} onChange={() => void choose(o.value)} hint={o.hint} aria-describedby={o.describedBy}>
                  {o.label}
                </Radio>
              ))}
            </div>
            <div id={floorsId} className={cn("pl-[26px] text-meta font-normal text-secondary", locked && "opacity-60")}>
              <p>{P.auto.stillAsksLead}</p>
              <ul className="mt-0.5 list-disc pl-[1.25em] marker:text-secondary [&>li+li]:mt-0.5">
                {P.auto.stillAsks.map((x) => <li key={x}>{x}</li>)}
              </ul>
            </div>
            {state.locked === "impersonated" ? <p className="text-meta font-normal text-secondary">{P.lockedImpersonated}</p>
              : !locked ? <p className="text-meta font-normal text-secondary">{P.tip(name)}</p> : null}
          </div>
        </div>
        {save.state === "error" ? <SettingsAlert>{save.message}</SettingsAlert> : null}
        {/* The footer only says what happened, so it shows only then; its live region stays in place for screen readers. */}
        <SettingsFooter className={save.state === "saving" || save.state === "saved" ? undefined : "sr-only"}
          busy={save.state === "saving" ? P.saving : undefined} status={save.state === "saved" ? P.saved : undefined} />
      </div>
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
