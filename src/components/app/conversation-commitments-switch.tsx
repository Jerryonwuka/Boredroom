"use client";

/**
 * A conversation's "Commitments" section, in its details pane after "Assistants" (owner decision, 8 October 2026: phase
 * 7b, workspace commitments). When an owner or HR turns on "Track commitments in group chats" (Settings → Brenda), the
 * workspace assistant notices promises and agreed asks in channels, team chats and Everyone, marks them "Noted" and asks
 * each person to accept them onto their own list. Every such conversation has its own switch, on until someone who runs
 * it turns it off here (`conversations.track_commitments`, migration 0048; the workspace's switch is the master).
 *
 * - Who may switch it (`ConversationTracking.canChange`, the server's `app_can_manage_conversation`): a named channel's
 *   creator, owners and HR; owners and HR for Everyone; owners, HR and the team's leads for a team channel. They see a
 *   `Switch` "Note commitments here" with the hint, which saves the moment it moves (PATCH …/messages/conversations/{id}
 *   `{ trackCommitments }`): the choice shows at once and goes back, with the server's words inline, if the save fails;
 *   an older answer never overwrites a newer choice.
 * - While the workspace's switch is off the switch is disabled and reads off (nothing is noted anywhere then; review,
 *   9 October 2026: a checked switch read as "still noting"), and a line says who can turn it on. This conversation's own
 *   choice is kept for when the workspace's comes on.
 * - Everyone else reads "Brenda notes commitments made here." (with the hint) or "Commitments aren't noted here."
 * - Nothing at all on a direct thread (`applies` false: direct messages are never tracked) or before migration 0048
 *   (`ready` false).
 *
 * The details pane is drawn twice on a page (the side pane from 1280px and the side sheet below it), so each copy takes
 * the page's value when a refresh brings a new one, and a save refreshes the page: the other copy and the composer's
 * disclosure line follow. No orange of its own (the switch is white when on, accent rules, 6 October 2026); the words
 * carry the state. The name is the workspace assistant's (`workspaceAssistantName`): it is the one that notes.
 */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { api, isApiFailure } from "@/lib/api-client";
import { LOOP_WORDS, type ConversationTracking } from "@/lib/commitments";

const OFFLINE = "Could not save. Check your connection and try again.";

export function ConversationCommitmentsSwitch({ orgSlug, conversationId, state }: { orgSlug: string; conversationId: string; state: ConversationTracking }) {
  const router = useRouter();
  const id = useId();
  const titleId = `${id}-title`;
  // What the server last confirmed (the page's value takes over when it brings a new one) and the choice on its way,
  // shown at once.
  const [saved, setSaved] = useState(state.here);
  const [seen, setSeen] = useState(state.here);
  const [target, setTarget] = useState<boolean | null>(null);
  if (seen !== state.here) { setSeen(state.here); setSaved(state.here); setTarget(null); }
  const on = target ?? saved;
  const [save, setSave] = useState<{ state: "idle" | "saving" | "saved" | "error"; message?: string }>({ state: "idle" });
  // One save at a time, in the order chosen; a choice overtaken before its turn is not sent, so the last one wins.
  const wanted = useRef<boolean | null>(null);
  const queue = useRef(Promise.resolve());

  if (!state.ready || !state.applies) return null;
  const W = state.workspaceAssistantName;
  const words = LOOP_WORDS.conversationSwitch;

  const change = (value: boolean) => {
    wanted.current = value;
    setTarget(value);
    setSave({ state: "saving" });
    queue.current = queue.current.then(async () => {
      if (wanted.current !== value) return;
      try {
        const r = await api<{ id?: string; trackCommitments?: boolean }>(`/api/orgs/${orgSlug}/messages/conversations/${conversationId}`, { method: "PATCH", body: { trackCommitments: value }, retries: 0 });
        setSaved(r.trackCommitments ?? value);
        if (wanted.current !== value) return;
        setTarget(null);
        setSave({ state: "saved" });
        router.refresh();
      } catch (err) {
        if (wanted.current !== value) return;
        setTarget(null);
        // A refusal (403 "Only someone who runs this conversation can change this.", 422 "Direct messages are never
        // tracked.") and the server's "needs a database update" (503 NOT_READY) say why in words meant for the person;
        // any other fault, or no answer, is "Could not save".
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setSave({ state: "error", message: told ? err.error.message : OFFLINE });
      }
    });
  };

  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} className="mb-1 mt-7 px-2 text-sm font-medium text-secondary">Commitments</h3>
      <div className="px-2">
        {state.canChange ? (
          <Switch checked={state.workspaceOn && on} disabled={!state.workspaceOn} onChange={(e) => change(e.target.checked)} hint={words.hint(W)} className="pointer-coarse:min-h-10">
            {words.label}
          </Switch>
        ) : (
          <div className="py-2">
            <p className="text-sm font-medium text-foreground">{state.tracked ? words.readOnlyOn(W) : words.readOnlyOff}</p>
            {state.tracked ? <p className="text-meta font-normal text-secondary">{words.hint(W)}</p> : null}
          </div>
        )}
        {state.canChange && !state.workspaceOn ? <p className="text-meta font-normal text-secondary">{words.offWorkspace(W)}</p> : null}
        {save.state === "error" ? <p role="alert" className="mt-1.5 text-meta font-medium text-danger">{save.message}</p> : null}
        {/* Only a screen reader needs to hear the save land: the switch itself already shows the choice. */}
        <p role="status" aria-live="polite" className="sr-only">{save.state === "saving" ? "Saving…" : save.state === "saved" ? "Saved" : ""}</p>
      </div>
    </section>
  );
}
