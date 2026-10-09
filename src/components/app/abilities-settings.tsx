"use client";

/**
 * Brenda's abilities as cards (owner decisions, 8–9 October 2026: phase 7c, the abilities catalogue; contract C and
 * G.3). A curated catalogue, never written by people: catch-up, loose ends, follow-ups, passing messages and requests
 * between assistants, @mentions in Messages, routines (with their templates), commitments, standup, voice, acting
 * without asking and the morning opener. Each card says what it does, "Use when…" and what it never does (its
 * anti-jobs: "never messages anyone without your Confirm"), and its state in a word.
 *
 * Two places, one part (`scope`):
 * - Settings → Brenda → Abilities (`workspace`, owners and HR; nobody else sees the Brenda section): "Offer {title} in
 *   this workspace" for the abilities that had no switch of their own (`brenda_settings.abilities_off`). The ones that
 *   already had one (@mentions, commitments, acting without asking) are not switched twice: their card shows the real
 *   switch's state and links to its own card on the page ("Change in Messages"), which stays the source of truth.
 * - Settings → Your assistant → Abilities (`personal`, everyone): "Use {title}" for the person's own assistant
 *   (`assistant_private.abilities_off`), the existing personal choices (voice, permissions, tags) linked the same way,
 *   commitments "Set by your workspace". An ability the workspace does not offer shows "Off for this workspace" with its
 *   switch disabled and the reason. Read-only while someone else is signed in as the person.
 *
 * Every switch saves the moment it moves (PATCH /brenda/abilities `{ key, on }`, or /brenda/abilities/workspace `{ key,
 * offered }`): the card shows the choice at once and goes back, with a toast in the server's words, if the save fails;
 * the page then refreshes so everything that depends on it follows (her home's asks, the drawer's starters). Defaults:
 * everything built stays on. Before migration 0050 the new switches are disabled under an info alert, and the linked
 * existing switches still work.
 *
 * The server enforces all of it (a switched-off ability's tools refuse with a friendly line that says where to switch it
 * on); this is where people choose. Design: a list of cards (one column below a 40rem card area, two above), a 32px
 * icon square, the title, a neutral or success state badge (never orange: an ability being on is not the one thing to
 * do), the sentences in the secondary grey, the control at the foot. Switches stay white.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, AtSign, Inbox, ListChecks, MessageCircleQuestion, Mic, NotebookPen, Repeat, Sun, Sunrise, Zap, type LucideIcon } from "lucide-react";
import { AnimatedArrowUpRight } from "@/components/ui/animated-icons";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/states";
import { notify } from "@/components/ui/toast";
import { SettingsAlert, SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { forgetAbilities } from "@/hooks/use-abilities";
import { api, isApiFailure } from "@/lib/api-client";
import { ABILITIES_NOT_READY, ABILITY_WORDS, type AbilitiesView, type AbilityCard, type AbilityKey } from "@/lib/abilities";
import { cn } from "@/lib/utils";

const OFFLINE = "Cannot reach the server. Nothing was changed.";
const FAILED = "Something went wrong. Nothing was changed; try again.";
/** The server's words for a refusal; a server error is not "cannot reach" (fix review, 9 October 2026). */
const told = (err: unknown) => (!isApiFailure(err) ? OFFLINE : err.error.status < 500 || err.error.code === "NOT_READY" ? err.error.message : FAILED);

/** The cards' icons, by the catalogue's names (lucide; still, as icons outside a control are). */
const ICONS: Record<string, LucideIcon> = {
  Inbox, ListChecks, MessageCircleQuestion, ArrowLeftRight, AtSign, Repeat, NotebookPen, Sunrise, Mic, Zap, Sun,
};

/** Where an existing switch lives, by its card's anchor on the Settings page. */
const CARD_NAMES: Record<string, string> = {
  mentions: "Messages", commitments: "Commitments in group chats", "act-mode": "Acting without asking", routines: "Routines",
  voice: "Voice", permissions: "Permissions", "assistant-talk": "Other people's assistants",
};
const cardName = (href: string) => CARD_NAMES[href.split("#")[1] ?? ""] ?? "its own card";
/** The catalogue's sentence without the label it starts with ("Use when you've…" under "Use when": "you've…"). */
const after = (sentence: string, label: string) => (sentence.toLowerCase().startsWith(`${label.toLowerCase()} `) ? sentence.slice(label.length + 1) : sentence);

const A = ABILITY_WORDS;
const ON_OFF = { on: A.state.on, off: A.state.off };
/** The person's act mode, as Permissions words it ("When Max acts: Asks first"). */
const ACT_STATE = { on: "Acts without asking", off: A.state.asksFirst };

export function AbilitiesSettings({ orgSlug, scope, name, initial }: {
  orgSlug: string;
  /** Settings → Brenda (`workspace`, owners and HR) or Settings → Your assistant (`personal`). */ scope: "workspace" | "personal";
  /** The person's own assistant ("Max"). */ name: string;
  /** The catalogue as the page read it; null when it could not, and the card reads it itself. */ initial: AbilitiesView | null;
}) {
  const router = useRouter();
  const [view, setView] = useState<AbilitiesView | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => api<AbilitiesView>(`/api/orgs/${orgSlug}/brenda/abilities`).then((v) => { setView(v); setLoadError(null); }, (err: unknown) => setLoadError(told(err))), [orgSlug]);
  const brought = !!initial;
  useEffect(() => { if (!brought) void load(); }, [brought, load]);
  // A refreshed page brings the catalogue again: it takes over.
  const [seen, setSeen] = useState(initial);
  if (initial && initial !== seen) { setSeen(initial); setView(initial); }
  // Choices on their way: shown at once, the last one per ability winning.
  const [pending, setPending] = useState<Partial<Record<AbilityKey, boolean>>>({});
  const [said, setSaid] = useState("");
  const queue = useRef(Promise.resolve());
  const latest = useRef<Partial<Record<AbilityKey, boolean>>>({});

  const personal = scope === "personal";
  const ready = view?.ready ?? false;
  const locked = !view || !ready || (personal ? view.impersonated : !view.canEditWorkspace);

  const change = (card: AbilityCard, value: boolean) => {
    if (locked) return;
    latest.current[card.key] = value;
    setPending((p) => ({ ...p, [card.key]: value }));
    queue.current = queue.current.then(async () => {
      if (latest.current[card.key] !== value) return;
      try {
        const v = personal
          ? await api<AbilitiesView>(`/api/orgs/${orgSlug}/brenda/abilities`, { method: "PATCH", body: { key: card.key, on: value }, retries: 0 })
          : await api<AbilitiesView>(`/api/orgs/${orgSlug}/brenda/abilities/workspace`, { method: "PATCH", body: { key: card.key, offered: value }, retries: 0 });
        setView(v);
        if (latest.current[card.key] !== value) return;
        setPending((p) => { const n = { ...p }; delete n[card.key]; return n; });
        setSaid(A.saved(card.title, value));
        forgetAbilities(orgSlug);
        router.refresh(); // her home, the drawer and Brenda's log follow
      } catch (err) {
        if (latest.current[card.key] !== value) return;
        setPending((p) => { const n = { ...p }; delete n[card.key]; return n; });
        const words = told(err);
        setSaid(words);
        notify(words, { tone: "danger" });
      }
    });
  };

  const title = personal ? A.sections.personalTitle : A.sections.workspaceTitle;
  const description = personal ? A.sections.personalDescription(name) : A.sections.workspaceDescription;
  if (!view) {
    return (
      <SettingsSection id="abilities" title={title} description={description}>
        {loadError ? (
          <SettingsGroup>
            <SettingsAlert>
              <span className="flex flex-wrap items-center justify-between gap-2">{loadError}<Button size="xs" variant="secondary" onClick={() => { setLoadError(null); void load(); }}>Try again</Button></span>
            </SettingsAlert>
          </SettingsGroup>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2" role="status" aria-label="Getting the abilities">
            {[0, 1].map((i) => <div key={i} className="card-panel space-y-2 p-4"><Skeleton className="h-4 w-32" /><Skeleton className="h-3.5 w-56 max-w-full" /></div>)}
          </div>
        )}
      </SettingsSection>
    );
  }
  return (
    <SettingsSection id="abilities" title={title} description={description}>
      {!ready ? <div className="mb-3"><SettingsGroup><SettingsAlert tone="info">{ABILITIES_NOT_READY}</SettingsAlert></SettingsGroup></div>
        : personal && view.impersonated ? <div className="mb-3"><SettingsGroup><SettingsAlert tone="info">{A.notes.impersonated}</SettingsAlert></SettingsGroup></div> : null}
      <div className="@container">
        <ul className="grid gap-3 @[40rem]:grid-cols-2">
          {view.cards.map((card) => (
            <AbilityCardView key={card.key} card={card} scope={scope} name={name} locked={locked} pending={pending[card.key]} canSwitchWorkspace={view.canEditWorkspace}
              onChange={(v) => change(card, v)} />
          ))}
        </ul>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{said}</p>
    </SettingsSection>
  );
}

/** An existing switch: its label and state, and "Change in Messages", a link to its own card (an anchor on the page). */
function ExistingControl({ label, on, href, words = ON_OFF }: { label: string; on: boolean; href: string; words?: { on: string; off: string } }) {
  const where = cardName(href);
  const cls = cn(buttonVariants({ variant: "ghost", size: "xs" }), "-mr-1.5");
  const inner = <>Change in {where}<AnimatedArrowUpRight aria-hidden /></>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <p className="min-w-0 flex-[1_1_10rem] break-words text-sm font-medium text-foreground">{label}<span className="font-normal text-secondary">: {on ? words.on : words.off}</span></p>
      {href.startsWith("#") ? <a href={href} className={cls}>{inner}</a> : <Link href={href} className={cls}>{inner}</Link>}
    </div>
  );
}

function AbilityCardView({ card, scope, name, locked, pending, canSwitchWorkspace, onChange }: {
  card: AbilityCard; scope: "workspace" | "personal"; name: string; locked: boolean; pending?: boolean; canSwitchWorkspace: boolean; onChange: (on: boolean) => void;
}) {
  const id = useId();
  const Icon = ICONS[card.icon] ?? Sun;
  const personal = scope === "personal";
  // Not offered by the workspace (a switch of its own): the person's switch waits, with why.
  const workspaceOff = card.workspace.kind === "switch" && !card.workspace.offered;
  // Settings → Brenda reads about everyone's assistant and the workspace's own switch, not the viewer's own (fix
  // review, 9 October 2026); Settings → Your assistant reads the person's.
  const what = !personal && card.whatWorkspace ? card.whatWorkspace : card.what;
  const state = !personal && card.workspaceState ? card.workspaceState : card.state;
  const stateTone = (personal ? card.effective : true) && /^On\b/.test(state) ? "success" : "neutral";

  let control: React.ReactNode = null;
  if (!personal) {
    const w = card.workspace;
    control = w.kind === "switch"
      ? <Switch checked={pending ?? w.offered} disabled={locked} onChange={(e) => onChange(e.target.checked)}>{A.switches.workspace(card.title)}</Switch>
      : <ExistingControl label={w.label} on={w.on} href={w.href} />;
  } else {
    const p = card.personal;
    control = p.kind === "switch" ? (
      <Switch checked={workspaceOff ? false : pending ?? p.on} disabled={locked || workspaceOff} onChange={(e) => onChange(e.target.checked)}
        hint={workspaceOff ? A.refusal(card.title, "workspace", name, canSwitchWorkspace) : undefined}>
        {A.switches.personal(card.title)}
      </Switch>
    ) : p.kind === "existing" ? <ExistingControl label={p.label} on={p.on} href={p.href} words={card.key === "act" ? ACT_STATE : undefined} />
      : <p className="text-sm font-normal text-secondary">{p.label}</p>;
  }
  // Further existing choices a card surfaces in this section (`also`): who may tag the person's assistant (mentions,
  // personal), who may schedule routines that chase other people (routines, workspace).
  const also = (card.also ?? []).filter((x) => x.scope === scope);

  return (
    <li className="card-panel flex min-w-0 flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-secondary [&_svg]:size-4"><Icon /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <h3 id={`${id}-title`} className="min-w-0 flex-[1_1_8rem] break-words text-sm font-semibold text-foreground">{card.title}</h3>
            <Badge tone={stateTone} className="shrink-0">{state}</Badge>
          </div>
          <p className="mt-1 text-sm font-normal text-secondary">{what}</p>
        </div>
      </div>
      {/* "Use when you've been away…", "Never marks anything…": the label leads its own sentence, read as one line. */}
      <dl className="grid gap-1.5 text-meta font-normal text-secondary">
        <div><dt className="inline font-medium text-foreground">{A.card.useWhen}</dt> <dd className="inline">{after(card.useWhen, A.card.useWhen)}</dd></div>
        <div><dt className="inline font-medium text-foreground">{A.card.never}</dt> <dd className="inline">{after(card.never, A.card.never)}</dd></div>
      </dl>
      {card.templates?.length ? (
        <div className="text-meta">
          <p id={`${id}-templates`} className="font-medium text-foreground">{A.card.templates}</p>
          <ul aria-labelledby={`${id}-templates`} className="mt-1 list-disc space-y-0.5 pl-[1.25em] font-normal text-secondary marker:text-subtle">
            {card.templates.map((t) => (
              <li key={t.template} className="break-words">
                <span className={t.available ? "text-foreground" : "text-subtle"}>{t.label}</span>
                {t.needs ? <span className={t.available ? undefined : "text-subtle"}> ({t.available ? A.card.needs(t.needs) : A.card.switchedOff(t.needs)})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {card.key === "standup" && !personal ? <p className="text-meta font-normal text-secondary">{A.card.teamPage}</p> : null}
      {card.key === "follow_ups" && personal ? <p className="text-meta font-normal text-secondary">{A.card.followUpsAnswering(name)}</p> : null}
      {card.key === "assistant_talk" ? <p className="text-meta font-normal text-secondary">{personal ? A.card.assistantTalkSending : `${A.card.assistantTalkSending} ${A.card.assistantTalkNotes}`}</p> : null}
      <div className="mt-auto space-y-2 border-t border-border pt-3">
        {control}
        {also.map((x) => <ExistingControl key={x.href} label={x.label} on={x.on} href={x.href} />)}
      </div>
    </li>
  );
}
