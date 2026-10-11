"use client";

/**
 * "Bring your team", the welcome's last step for owners and HR (owner request, 11 October 2026: the first-run welcome;
 * contract sections 5.6 and 10.3). Two ways in, both optional: invite by email (paste or type the addresses, choose
 * what they join as and which team, optionally a new one), or turn on the join link and copy it. Nothing is forced:
 * "Later" and an empty Continue both finish the welcome, and nothing on this step is ever shown to anyone else.
 *
 * Sending checks every address first and sends nothing while one looks wrong; a new team is created before the
 * invitations so they can name it; invitations go one at a time, in order, and a full plan (402 SEATS_FULL) stops the
 * batch with the server's words on every address not sent. When some fail, the box keeps only those, so the person
 * fixes them or presses Later. When all are sent the step finishes by itself (the person pressed Send).
 *
 * What was typed and chosen, and what has happened (the teams made, the invitations sent, the join link), lives in the
 * flow as a `TeamDraft`, not here: the step unmounts on Back, the rail and the browser's Back, and coming back must find
 * it all, and the end screen must report it truly (review, 11 October 2026). While the flow finishes the welcome, the
 * step shows it as busy (`busy`), so a second press never finishes it twice.
 */
import { useId, useRef, useState, type SetStateAction } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { StepFrame } from "@/components/app/welcome/step-frame";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { IconButton } from "@/components/ui/icon-button";
import { MonoChip } from "@/components/ui/badge";
import { api, isApiFailure } from "@/lib/api-client";
import { parseInviteEmails } from "@/lib/invite-emails";
import { SITE_ORIGIN } from "@/lib/site";
import { cn } from "@/lib/utils";
import { INVITE_BATCH_MAX, WELCOME_WORDS, type WelcomeTeamData } from "@/lib/welcome";

export type TeamStepResult = { skipped: boolean; invited: number; linkOn: boolean; teamCreated: boolean };
type InviteRole = "employee" | "manager" | "hr";
type Result = { email: string; ok: boolean; message: string | null };
type JoinCode = WelcomeTeamData["joinCode"];

/** The step's draft and outcomes, kept by the flow (see above). */
export type TeamDraft = {
  text: string; role: InviteRole; teams: { id: string; name: string }[]; teamId: string; newTeamName: string;
  teamCreated: boolean; invitedSoFar: number; results: Result[]; code: JoinCode;
  /** Invitations or a new team are being sent (the flow holds the browser's Back meanwhile). */
  sending: boolean;
};
export const teamDraftFrom = (data: WelcomeTeamData): TeamDraft => ({
  text: "", role: "employee", teams: data.teams, teamId: "", newTeamName: "", teamCreated: false, invitedSoFar: 0, results: [], code: data.joinCode, sending: false,
});

export type TeamStepProps = {
  orgSlug: string;
  orgName: string;
  assistantName: string;
  data: WelcomeTeamData;
  draft: TeamDraft;
  onDraft: (next: SetStateAction<TeamDraft>) => void;
  /** The flow is finishing the welcome. */
  busy: boolean;
  stepLabel: string;
  focusTitle: boolean;
  onBack: () => void;
  /** The step is finished (Later, Continue, or every invitation sent): the flow records it and finishes the welcome. */
  onDone: (result: TeamStepResult) => void;
  /** Brenda's line on the stage. */
  onSay: (line: string) => void;
};

const T = WELCOME_WORDS.team;
const B = WELCOME_WORDS.buttons;
const NEW_TEAM = "__new";
/** The join-code route answers with the organisation's row. */
type JoinCodeRow = { join_code: string | null; join_code_enabled: boolean; join_code_role: string; join_code_team_id: string | null };

const failureText = (err: unknown, field?: string): string => {
  if (!isApiFailure(err)) return WELCOME_WORDS.errors.offline;
  return (field ? err.error.fieldErrors?.[field]?.[0] : undefined) ?? err.error.message;
};

export function TeamStep({ orgSlug, data, draft, onDraft, busy, stepLabel, focusTitle, onBack, onDone, onSay }: TeamStepProps) {
  const id = useId();
  const emailsId = `${id}-emails`;
  const teamNameId = `${id}-team-name`;
  const emailsRef = useRef<HTMLTextAreaElement>(null);
  const teamNameRef = useRef<HTMLInputElement>(null);

  // What was typed and chosen, and what has happened, lives in the flow (`draft`), so Back never loses it.
  const { text, role, teams, teamId, newTeamName, teamCreated, sending, results, invitedSoFar, code } = draft;
  const patch = (p: Partial<TeamDraft>) => onDraft((d) => ({ ...d, ...p }));
  const setText = (v: string) => patch({ text: v });
  const setRole = (v: InviteRole) => patch({ role: v });
  const setTeamId = (v: string) => patch({ teamId: v });
  const setNewTeamName = (v: string) => patch({ newTeamName: v });
  const setSending = (v: boolean) => patch({ sending: v });
  const setCode = (v: JoinCode) => patch({ code: v });

  const [emailsError, setEmailsError] = useState<string | null>(null);
  const [teamNameError, setTeamNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [copyFailed, setCopyFailed] = useState(false);

  const hasText = text.trim().length > 0;
  const creatingTeam = teamId === NEW_TEAM;
  const link = code.code ? `${SITE_ORIGIN}/join/${code.code}` : null;
  const linkOn = code.enabled && !!code.code;

  /** "New team…" with a name: create it first (once), so the invitations can name it. Null when it could not be made. */
  async function ensureTeam(): Promise<{ id: string | null } | null> {
    if (!creatingTeam) return { id: teamId || null };
    const name = newTeamName.trim();
    if (!name) { setTeamNameError(T.errors.teamName); teamNameRef.current?.focus(); return null; }
    try {
      const team = await api<{ id: string; name?: string }>(`/api/orgs/${orgSlug}/teams`, { method: "POST", body: { name }, retries: 0 });
      // The select now names the new team, so a second Send never creates it again.
      onDraft((d) => ({
        ...d, teams: [...d.teams, { id: team.id, name: team.name ?? name }].sort((a, b) => a.name.localeCompare(b.name)),
        teamId: team.id, newTeamName: "", teamCreated: true,
      }));
      return { id: team.id };
    } catch (err) {
      if (isApiFailure(err) && (err.error.code === "TEAM_EXISTS" || err.error.status === 422)) {
        setTeamNameError(failureText(err, "name"));
        teamNameRef.current?.focus();
      } else setError(failureText(err));
      return null;
    }
  }

  async function send() {
    const parsed = parseInviteEmails(text);
    setError(null); setEmailsError(null); setTeamNameError(null);
    if (parsed.tooMany) { setEmailsError(T.errors.tooMany(INVITE_BATCH_MAX)); emailsRef.current?.focus(); return; }
    if (parsed.invalid.length) { setEmailsError(parsed.invalid.map((a) => T.errors.invalid(a)).join(" ")); emailsRef.current?.focus(); return; }
    if (!parsed.emails.length) { setEmailsError(T.errors.none); emailsRef.current?.focus(); return; }

    setSending(true);
    try {
      const team = await ensureTeam();
      if (!team) return;
      const out: Result[] = [];
      let stopped: string | null = null;
      for (const email of parsed.emails) {
        if (stopped) { out.push({ email, ok: false, message: stopped }); continue; }
        try {
          await api(`/api/orgs/${orgSlug}/invitations`, { method: "POST", body: { email, role, teamId: team.id, employeeCode: null }, retries: 0 });
          out.push({ email, ok: true, message: null });
        } catch (err) {
          const message = failureText(err, "email");
          // A full plan refuses every address after it too: stop asking, and say so beside each one not sent.
          if (isApiFailure(err) && err.error.code === "SEATS_FULL") stopped = message;
          out.push({ email, ok: false, message });
        }
      }
      const sent = out.filter((r) => r.ok).length;
      const failed = out.filter((r) => !r.ok);
      const total = invitedSoFar + sent;
      patch({ invitedSoFar: total, results: out });
      if (!failed.length) {
        onSay(T.bubbleSent(total));
        onDone({ skipped: false, invited: total, linkOn, teamCreated: teamCreated || (creatingTeam && team.id !== null) });
        return;
      }
      // Keep only what didn't go, so a second Send never invites anyone twice.
      setText(failed.map((r) => r.email).join("\n"));
      setError(T.partial(sent, out.length));
      if (sent) onSay(T.bubbleSent(total));
    } finally {
      setSending(false);
    }
  }

  async function finish(skipped: boolean) {
    setError(null); setEmailsError(null); setTeamNameError(null);
    let created = teamCreated;
    // A new team that was named but not sent with invitations is still created: the person typed it to have it.
    if (!skipped && creatingTeam && newTeamName.trim()) {
      setSending(true);
      const team = await ensureTeam().finally(() => setSending(false));
      if (!team) return;
      created = true;
    }
    onDone({ skipped: skipped || (!linkOn && invitedSoFar === 0 && !created), invited: invitedSoFar, linkOn, teamCreated: created });
  }

  async function toggleLink(on: boolean) {
    const before = code;
    setLinkBusy(true); setError(null); setCopyFailed(false);
    setCode({ ...code, enabled: on });
    try {
      // With no code yet the server makes one; it starts as staff, the safe default.
      const body = on ? (code.code ? { enabled: true } : { enabled: true, role: "employee" as const }) : { enabled: false };
      const row = await api<JoinCodeRow>(`/api/orgs/${orgSlug}/settings/join-code`, { method: "PATCH", body, retries: 0 });
      setCode({ code: row.join_code, enabled: row.join_code_enabled, role: row.join_code_role === "manager" ? "manager" : "employee", teamId: row.join_code_team_id });
    } catch (err) {
      setCode(before);
      setError(failureText(err));
    } finally {
      setLinkBusy(false);
    }
  }

  async function copy(value: string, what: "link" | "code") {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 2000);
    } catch {
      setCopied(null);
      setCopyFailed(true);
    }
  }

  return (
    <StepFrame
      stepLabel={stepLabel}
      title={T.title}
      lede={T.lede}
      focusTitle={focusTitle}
      onBack={onBack}
      onSubmit={() => { if (sending || busy) return; if (hasText) void send(); else void finish(false); }}
      secondary={{ label: B.later, onClick: () => void finish(true), disabled: sending }}
      primary={{ label: hasText ? B.send : B.continue, loading: sending || busy, disabled: linkBusy }}
      error={error}
    >
      <div className="@container flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          <Field label={T.emails} htmlFor={emailsId} description={T.emailsHint} error={emailsError ?? undefined}>
            <Textarea
              ref={emailsRef}
              id={emailsId}
              name="emails"
              rows={3}
              value={text}
              placeholder="ada@acme.com, ben@acme.com"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              className="min-h-[88px] resize-y py-2"
              onChange={(e) => { setText(e.target.value); if (emailsError) setEmailsError(null); }}
              // Enter makes a new line here; Ctrl or Cmd with Enter sends, as the step's other fields continue on Enter.
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
            />
          </Field>

          {results.length ? (
            <ul aria-label={T.results} className="-mt-1 flex flex-col">
              {results.map((r) => (
                <li key={r.email} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border py-2 text-sm last:border-b-0">
                  <span className="min-w-0 truncate font-medium text-foreground">{r.email}</span>
                  {r.ok
                    ? <span className="inline-flex shrink-0 items-center gap-1 text-meta font-normal text-success"><Check aria-hidden className="size-3.5" />{T.sent}</span>
                    : <span className="min-w-0 text-meta font-normal text-danger">{r.message}</span>}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="grid gap-4 @[30rem]:grid-cols-2">
            <Field label={T.role} htmlFor={`${id}-role`}>
              <Select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as InviteRole)}>
                <option value="employee">{T.roles.employee}</option>
                <option value="manager">{T.roles.manager}</option>
                {data.isOwner ? <option value="hr">{T.roles.hr}</option> : null}
              </Select>
            </Field>
            <Field label={T.teamLabel} htmlFor={`${id}-team`}>
              <Select id={`${id}-team`} value={teamId} onChange={(e) => { setTeamId(e.target.value); setTeamNameError(null); if (e.target.value === NEW_TEAM) requestAnimationFrame(() => teamNameRef.current?.focus()); }}>
                <option value="">{T.noTeam}</option>
                {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                <option value={NEW_TEAM}>{T.newTeam}</option>
              </Select>
            </Field>
          </div>

          {creatingTeam ? (
            <Field label={T.newTeamName} htmlFor={teamNameId} description={T.newTeamHint} error={teamNameError ?? undefined}>
              <Input ref={teamNameRef} id={teamNameId} name="teamName" maxLength={120} autoComplete="off" value={newTeamName}
                onChange={(e) => { setNewTeamName(e.target.value); if (teamNameError) setTeamNameError(null); }} />
            </Field>
          ) : null}
        </div>

        <section aria-labelledby={`${id}-link-heading`} className="flex flex-col gap-3 border-t border-border pt-6">
          <h2 id={`${id}-link-heading`} className="text-sm font-semibold text-foreground">{T.linkHeading}</h2>
          {/* The switch follows the press at once (a new workspace has no code yet: the server makes one, and the link
              shows when it answers); a refused save puts it back. Held with aria-disabled while it saves, so it keeps
              focus. A lead code that names a team says so: everyone who joins with it becomes that team's lead. */}
          <Switch checked={code.enabled} aria-disabled={linkBusy || undefined} onChange={(e) => { if (!linkBusy) void toggleLink(e.target.checked); }}
            hint={code.enabled ? T.linkOn(code.role, teams.find((t) => t.id === code.teamId)?.name ?? null) : T.linkOff} className="py-0">
            {T.linkSwitch}
          </Switch>
          {linkOn && link ? (
            <div className="flex flex-col gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <Input readOnly value={link} aria-label={T.linkField} className="min-w-0 flex-1 select-all font-mono text-meta" onFocus={(e) => e.currentTarget.select()} />
                <IconButton aria-label={copied === "link" ? T.copied : T.copyLink} onClick={() => void copy(link, "link")} className={cn(copied === "link" && "text-success hover:text-success")}>
                  {copied === "link" ? <Check aria-hidden /> : <Link2 aria-hidden />}
                </IconButton>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-meta font-normal text-secondary">{T.code}</span>
                <MonoChip className="select-all text-foreground">{code.code}</MonoChip>
                <IconButton aria-label={copied === "code" ? T.copied : T.copyCode} onClick={() => void copy(code.code!, "code")} className={cn(copied === "code" && "text-success hover:text-success")}>
                  {copied === "code" ? <Check aria-hidden /> : <Copy aria-hidden />}
                </IconButton>
                <span aria-live="polite" className="text-xs font-medium text-secondary">{copied ? T.copied : ""}</span>
              </div>
              {copyFailed ? <p role="alert" className="text-meta font-normal text-danger">{T.copyFailed}</p> : null}
            </div>
          ) : null}
        </section>
      </div>
    </StepFrame>
  );
}
