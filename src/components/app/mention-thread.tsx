"use client";

/**
 * @mentions in a thread (owner decision, 8 October 2026: personal assistants, phase 5). What Messages draws around a
 * message that tagged its sender's own assistant ("@Max what's left on the landing page?"), and the mentions inside a
 * message's text. The server decides who sees what (contract B.3: `MentionView.private` is the tagger's alone, by
 * row-level security and again by the service); these parts only draw it.
 *
 * - `MentionText`: a message's text with its mentions marked: a quiet fill for anyone else, the orange tint
 *   (`bg-accent-soft text-accent-text`) when it is you who was mentioned (the accent rules: something that wants your
 *   attention). Never a link; plain text otherwise, as every message.
 * - Under the tagging message, left-aligned like an assistant's own message, with the TAGGER's assistant's small face:
 *   "Max is thinking…" (everyone in the conversation, `role="status"`), "Waiting for Olu to confirm" (everyone but Olu),
 *   or, for Olu alone, the private card: "Only visible to you", the answer as plain text, a note, each Confirm card, and
 *   Post to channel / Dismiss / Continue with Max.
 * - `FullAnswerToggle`: under the assistant's shortened public reply, for the tagger only, "Read the full answer".
 *
 * Faces here are `quiet` (they never talk along); no orange button (Confirm is the white primary); every press refreshes
 * the page, and a press that fails says why inline (`role="alert"`).
 *
 * Someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6, contract H.4): "@Ben's Brenda,
 * where is the deck?" makes BEN's assistant answer. `MentionView.assistant` is then the answering assistant and
 * `MentionView.owner` its owner, so every row here shows the answering assistant's face and name, the badge "Ben's
 * assistant" ("Your assistant" for Ben) and "asked by Olu" ("asked by you" for Olu). Its private card (Olu's alone)
 * names "Ben's Brenda", never offers Post to channel (what Ben's work shows is not Olu's to post), and "Continue with"
 * names Olu's OWN assistant. "I've asked Ben. I'll reply here." and Ben's reply are messages of Ben's assistant in the
 * thread (the page draws them, with "asked by Olu"); while the mention is 'asked' nothing more shows under the tagging
 * message. In a message's text a tag of someone else's assistant is marked like any assistant tag, titled "Ben's
 * assistant", in the orange tint for Ben (it wants his attention).
 */
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import { AssistantAvatar } from "@/components/app/assistant-chip";
import { useAssistant } from "@/components/app/assistant-context";
import { focusComposer } from "@/components/app/messages";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { api, isApiFailure } from "@/lib/api-client";
import { MENTION_WORDS, splitMentions, type MentionProposalView, type MentionRef, type MentionView } from "@/lib/mentions";
import type { AssistantProfile } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

const OFFLINE = "Cannot reach the server. Check your connection and try again.";
const reason = (err: unknown) => (isApiFailure(err) ? err.error.message : OFFLINE);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * While a press is in flight the buttons say so with aria-disabled instead of disabled, so the pressed one keeps the
 * keyboard focus (review, 8 October 2026: focus fell to the page for the whole request). Presses are ignored meanwhile.
 */
const busyProps = (busy: boolean, pressed: boolean) => ({
  "aria-disabled": busy || undefined, "aria-busy": pressed || undefined,
  className: busy && !pressed ? "opacity-50" : undefined,
});
const Spin = ({ on }: { on: boolean }) => (on ? <Loader2 className="animate-spin" aria-hidden /> : null);

// ---- The text of a message ----------------------------------------------------------------------------------------

/**
 * A message's text with its stored mentions marked (contract F.2). `me` is the viewer's membership; `senderName` names
 * whose assistant an assistant tag is ("Olu's assistant"; "Your assistant" on your own).
 *
 * Phase 6: an assistant tag whose membership is not the sender's (`senderId`) is someone else's assistant; `owners`
 * names its owner ("Ben's assistant", or the label's own words when the owner is not listed here any more). It is in the
 * orange tint for its owner, as a mention of them is: someone asked their assistant.
 */
export function MentionText({ body, refs, me, senderName, senderId, owners }: { body: string; refs: MentionRef[]; me: string; senderName: string; senderId?: string; owners?: Record<string, string> }) {
  const pieces = splitMentions(body, refs);
  return (
    <span className="whitespace-pre-wrap break-words">
      {pieces.map((p, i) => {
        if (!("ref" in p)) return <Fragment key={i}>{p.text}</Fragment>;
        const you = p.ref.membershipId === me;
        const theirs = p.ref.kind === "assistant" && senderId !== undefined && p.ref.membershipId !== senderId;
        const owner = theirs ? owners?.[p.ref.membershipId] : undefined;
        const title = p.ref.kind === "person" ? p.ref.label.replace(/^@/, "")
          : you ? MENTION_WORDS.assistantOption
            : theirs ? (owner ? MENTION_WORDS.otherAssistantSecondary(firstName(owner)) : p.ref.label.replace(/^@/, ""))
              : `${firstName(senderName)}'s assistant`;
        const tint = you && (p.ref.kind === "person" || theirs);
        return <span key={i} title={title} className={cn("rounded px-0.5 font-medium", tint ? "bg-accent-soft text-accent-text" : "bg-fill-150 text-foreground ring-1 ring-inset ring-border-input")}>{p.text}</span>;
      })}
    </span>
  );
}

// ---- Under the tagging message --------------------------------------------------------------------------------------

/**
 * A line under a bubble, on the left like an assistant's own message: the answering assistant's 24px face (the
 * tagger's own, or, phase 6, the owner's when someone else's assistant was tagged), then the line.
 */
function Row({ assistant, wide = false, children }: { assistant: AssistantProfile; wide?: boolean; children: ReactNode }) {
  return (
    <div className="mt-2 flex w-full justify-start">
      <div className={cn("flex min-w-0 items-start gap-2", wide ? "w-full max-w-full sm:max-w-[min(80%,40rem)]" : "max-w-[min(100%,40rem)]")}>
        <div className="grid w-8 shrink-0 place-items-center pt-0.5"><AssistantAvatar assistant={assistant} size={24} /></div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

/**
 * Whose assistant answers: "Olu's assistant", or "Your assistant" for the person who asked; for someone else's
 * assistant (phase 6) "Ben's assistant" ("Your assistant" for Ben), then "asked by Olu" ("asked by you" for Olu).
 */
function WhoseBadge({ mention }: { mention: MentionView }) {
  return <>
    <Badge size="sm">{MENTION_WORDS.badgeFor(mention)}</Badge>
    {mention.owner ? <span className="text-meta font-normal text-secondary">{MENTION_WORDS.askedBy(mention.tagger.firstName, mention.tagger.isYou)}</span> : null}
  </>;
}

/** The answering assistant as the private card names it: "Max", or "Ben's Brenda" when it is someone else's (phase 6). */
const answeringName = (mention: MentionView) => (mention.owner ? MENTION_WORDS.otherAssistantOption(mention.owner.firstName, mention.assistant.name) : mention.assistant.name);

/** How often, and for how long, a thinking row looks again when the live updates bring nothing. */
const THINKING_POLL_MS = 4000;
const THINKING_POLL_FOR_MS = 120_000;

/** "Max is thinking…" (or "Brenda is thinking…" for Ben's): everyone in the conversation sees it while the run is on (static under reduced motion). */
export function ThinkingRow({ mention }: { mention: MentionView }) {
  const router = useRouter();
  // The live updates usually replace this row with the answer; when they bring nothing (a connection that drops
  // NOTIFY), the page looks again every few seconds while the row shows and the tab is visible, for two minutes at most
  // (review, 8 October 2026). The row unmounts once the refreshed page says the run is over.
  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > THINKING_POLL_FOR_MS) { window.clearInterval(timer); return; }
      if (document.visibilityState === "visible") router.refresh();
    }, THINKING_POLL_MS);
    // Back on a tab that was hidden meanwhile: look at once.
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [mention.id, router]);
  return (
    <Row assistant={mention.assistant}>
      <p role="status" className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="brenda-shimmer text-sm font-normal text-secondary">{MENTION_WORDS.thinking(mention.assistant.name)}</span>
        <WhoseBadge mention={mention} />
      </p>
    </Row>
  );
}

/** "Waiting for Olu to confirm": everyone but Olu, while her Confirm cards are open. */
export function WaitingRow({ mention }: { mention: MentionView }) {
  return (
    <Row assistant={mention.assistant}>
      <p className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-0.5 text-meta font-normal text-secondary">
        <span>{MENTION_WORDS.waiting(mention.tagger.firstName)}</span>
        <WhoseBadge mention={mention} />
      </p>
    </Row>
  );
}

/**
 * What goes under a message that tagged an assistant: the thinking line, the waiting line, or the tagger's private card,
 * whichever applies now (nothing once it is answered in public, refused for someone else, or dismissed; nothing while
 * someone else's assistant has asked its owner, phase 6: its "I've asked Ben" message says so in the thread).
 */
export function MentionRows({ orgSlug, mention, conversationKind }: { orgSlug: string; mention: MentionView; conversationKind: string }) {
  // Dismissed here: gone at once, before the refresh brings `dismissedAt`.
  const [dismissed, setDismissed] = useState(false);
  if (mention.thinking) return <ThinkingRow mention={mention} />;
  const own = mention.tagger.isYou ? mention.private : null;
  if (own && own.kind !== "full_answer" && !own.dismissedAt && !dismissed) {
    return (
      <Row assistant={mention.assistant} wide>
        <PrivateAnswerCard orgSlug={orgSlug} mention={mention} conversationKind={conversationKind} onDismissed={() => { setDismissed(true); focusComposer(); }} />
      </Row>
    );
  }
  if (!mention.tagger.isYou && mention.waiting) return <WaitingRow mention={mention} />;
  return null;
}

/**
 * The tagger's private card (contract F.3): a hairline card shaped like a bubble. "Only visible to you" with the
 * assistant's name; the answer (plain text); a note (why it was not answered in public); each Confirm card; then Post
 * to channel ("Post to chat" in a direct thread; only when it can be posted), Dismiss, and Continue with Max (their own
 * chat). Posted, it collapses to "Posted to the conversation."
 *
 * Phase 6, someone else's assistant answered privately: the card names "Ben's Brenda", has no Post to channel (the
 * server says `canPost` false; what Ben's work shows the tagger is theirs alone, and the card never offers it either
 * way), and "Continue with" names the tagger's own assistant, whose chat it opens. A request it could not make itself
 * ("add … to Ben's to-dos") comes as a Confirm card here: confirmed, Ben gets it to accept in his inbox.
 */
export function PrivateAnswerCard({ orgSlug, mention, conversationKind, onDismissed }: { orgSlug: string; mention: MentionView; conversationKind: string; onDismissed: () => void }) {
  const router = useRouter();
  const { personal } = useAssistant();
  const headId = useId();
  const [busy, setBusy] = useState<"post" | "dismiss" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const postedLine = useRef<HTMLParagraphElement>(null);
  // The Post button is gone once it worked: the focus moves to the line that says so.
  useEffect(() => { if (posted) postedLine.current?.focus(); }, [posted]);
  const p = mention.private;
  if (!p) return null;
  const name = answeringName(mention);
  const canPost = p.canPost && !mention.owner;
  const base = `/api/orgs/${orgSlug}/mentions/${mention.id}`;

  if (posted || p.postedAt) {
    return <p ref={postedLine} tabIndex={-1} role="status" className="flex min-h-6 items-center text-meta font-normal text-secondary outline-none">{MENTION_WORDS.posted}</p>;
  }

  const post = async () => {
    if (busy) return;
    setBusy("post"); setError(null);
    try { await api(`${base}/post`, { method: "POST", retries: 0 }); setPosted(true); router.refresh(); }
    catch (err) { setError(reason(err)); if (isApiFailure(err)) router.refresh(); }
    finally { setBusy(null); }
  };
  const dismiss = async () => {
    if (busy) return;
    setBusy("dismiss"); setError(null);
    try { await api(`${base}/dismiss`, { method: "POST", retries: 0 }); onDismissed(); router.refresh(); }
    catch (err) { setError(reason(err)); if (isApiFailure(err)) router.refresh(); }
    finally { setBusy(null); }
  };

  return (
    <div role="group" aria-labelledby={headId} className="rounded-2xl rounded-tl-md border border-border bg-fill-0 px-3.5 py-2.5 text-sm">
      <p id={headId} className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-meta font-semibold text-foreground">{name}</span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-secondary"><EyeOff className="size-3.5 shrink-0" aria-hidden />{MENTION_WORDS.onlyYou}</span>
      </p>
      {p.text ? <p className="whitespace-pre-wrap break-words font-normal text-foreground">{p.text}</p> : null}
      {p.note ? <p className={cn("text-meta font-normal text-secondary", p.text && "mt-1.5")}>{p.note.words}</p> : null}
      {p.proposals.length ? (
        <ul className="mt-2.5 space-y-2">
          {p.proposals.map((x) => <li key={x.index}><ProposalCard orgSlug={orgSlug} mentionId={mention.id} proposal={x} assistantName={name} /></li>)}
        </ul>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-meta font-medium text-danger">{error}</p> : null}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {canPost ? <Button size="sm" variant="secondary" {...busyProps(busy !== null, busy === "post")} onClick={() => void post()}><Spin on={busy === "post"} />{busy === "post" ? "Posting…" : MENTION_WORDS.post(conversationKind === "direct")}</Button> : null}
        <Button size="sm" variant="ghost" {...busyProps(busy !== null, busy === "dismiss")} onClick={() => void dismiss()}><Spin on={busy === "dismiss"} />{MENTION_WORDS.dismiss}</Button>
        <Link href={`/app/${orgSlug}/home`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{MENTION_WORDS.continueWith(personal.name)}</Link>
      </div>
    </div>
  );
}

/**
 * One action waiting for the tagger's yes, drawn as in their own chat: the warning shield, what it will do, every word
 * of it in a scrolling box, then Not now and Confirm (the white primary). It is decided by its place in the list (the
 * signed token never leaves the server, contract C.4); once decided it shows what happened instead.
 */
export function ProposalCard({ orgSlug, mentionId, proposal, assistantName }: { orgSlug: string; mentionId: string; proposal: MentionProposalView; assistantName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"confirm" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The answer to a press shows at once; the page's own copy takes over once the refresh brings it.
  const [result, setResult] = useState<MentionProposalView | null>(null);
  const p = proposal.state === "open" && result ? result : proposal;
  const decide = async (decision: "confirm" | "decline") => {
    if (busy) return;
    setBusy(decision); setError(null);
    try {
      const r = await api<{ error: string | null; proposal: MentionProposalView }>(`/api/orgs/${orgSlug}/mentions/${mentionId}/proposals/${proposal.index}`, { method: "POST", body: { decision }, retries: 0 });
      setResult(r.proposal);
      if (r.error) setError(r.error);
      router.refresh();
    } catch (err) { setError(reason(err)); if (isApiFailure(err)) router.refresh(); }
    finally { setBusy(null); }
  };
  const decided = p.state === "done" ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success"><Check className="size-3.5 shrink-0" aria-hidden />{p.result ?? "Done"}</span>
    : p.state === "declined" ? <span className="text-xs font-medium text-secondary">Not done</span>
      : p.state === "expired" ? <span className="text-xs font-normal text-subtle">Expired. Ask {assistantName} again.</span>
        : p.state === "failed" ? <span className="text-xs font-medium text-danger">{p.result ?? "That didn't go through."}</span> : null;
  return (
    <div className="rounded-xl border border-border-input bg-background p-3 text-sm">
      <p className="flex items-start gap-2.5 font-medium text-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><span className="min-w-0 break-words">{p.summary}</span></p>
      {/* Every word of what it will do or send (review, 8 October 2026); a long one scrolls. */}
      {p.detail ? <div role="region" tabIndex={0} aria-label="The full details" className="ml-[26px] mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-fill-0 px-3 py-2 font-normal text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{p.detail}</div> : null}
      {error ? <p role="alert" className="ml-[26px] mt-2 text-meta font-medium text-danger">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {decided ?? <>
          <Button size="sm" variant="ghost" {...busyProps(busy !== null, busy === "decline")} onClick={() => void decide("decline")}><Spin on={busy === "decline"} />Not now</Button>
          <Button size="sm" variant="primary" {...busyProps(busy !== null, busy === "confirm")} onClick={() => void decide("confirm")}>{busy === "confirm" ? <Spin on /> : <Check aria-hidden />}Confirm</Button>
        </>}
      </div>
    </div>
  );
}

// ---- Under the assistant's public reply ---------------------------------------------------------------------------

/**
 * "Read the full answer": a public reply is kept to about six lines; when the assistant had more to say, the person
 * who asked reads the rest here, inline and only for them.
 */
export function FullAnswerToggle({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="min-w-0">
      <Button size="xs" variant="ghost" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>{open ? MENTION_WORDS.hideFull : MENTION_WORDS.readFull}</Button>
      <div id={id} hidden={!open} className="mt-1.5 rounded-2xl border border-border bg-fill-0 px-3.5 py-2.5 text-sm">
        <p className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-secondary"><EyeOff className="size-3.5 shrink-0" aria-hidden />{MENTION_WORDS.onlyYou}</p>
        <p className="whitespace-pre-wrap break-words font-normal text-foreground">{text}</p>
      </div>
    </div>
  );
}
