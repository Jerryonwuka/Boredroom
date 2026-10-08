"use client";

/**
 * A conversation's "Assistants" section, in its details pane under People (owner decision, 8 October 2026: personal
 * assistants, phase 5). When someone tags their own assistant in a conversation ("@Max …"), it reads the conversation's
 * recent messages to answer there, under its own name and who asked; this section says so in one line to everyone who
 * reads the conversation, and lets the people who run it switch that off for this conversation alone.
 *
 * - Who may switch it (contract 0.11, `app_can_manage_conversation`): a named channel's creator, owners and HR; either
 *   person in a direct thread; owners and HR for Everyone; owners, HR and the team's leads for a team channel. They see
 *   a `Switch` "Assistants can reply here" that saves the moment it moves (PATCH …/messages/conversations/{id}
 *   `{ assistantReplies }`): the choice shows at once and goes back, with the reason inline, if the save fails; an older
 *   answer never overwrites a newer choice. Everyone else reads "Assistants can reply here: on" or "off".
 * - When an owner or HR has switched assistant replies off for the whole workspace (Settings → Brenda → Messages), the
 *   switch is disabled, still showing this conversation's own choice for when the workspace's comes back on, and a line
 *   says why; the read-only line then says "off", which is what holds.
 * - Hidden entirely before migration 0041 (`state.ready` false): there is nothing to switch and nothing reads anything.
 *
 * The details pane is drawn twice on a page (the side pane from 1280px and the side sheet below it), so each copy takes
 * the page's value when a refresh brings a new one, and a save refreshes the page: the other copy and the composer's
 * autocomplete (which offers the assistant only where it may reply) follow. No orange of its own: the switch is white
 * when on (accent rules, 6 October 2026); the words carry the state.
 */
import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Switch } from "@/components/ui/switch";
import { api, isApiFailure } from "@/lib/api-client";
import { MENTION_WORDS, type AssistantRepliesState } from "@/lib/mentions";

const OFFLINE = "Could not save. Check your connection and try again.";

export function ConversationAssistantSwitch({ orgSlug, conversationId, state }: { orgSlug: string; conversationId: string; state: AssistantRepliesState }) {
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

  if (!state.ready) return null;

  const change = (value: boolean) => {
    wanted.current = value;
    setTarget(value);
    setSave({ state: "saving" });
    queue.current = queue.current.then(async () => {
      if (wanted.current !== value) return;
      try {
        const r = await api<{ id: string; assistantReplies?: boolean }>(`/api/orgs/${orgSlug}/messages/conversations/${conversationId}`, { method: "PATCH", body: { assistantReplies: value }, retries: 0 });
        setSaved(r.assistantReplies ?? value);
        if (wanted.current !== value) return;
        setTarget(null);
        setSave({ state: "saved" });
        router.refresh();
      } catch (err) {
        if (wanted.current !== value) return;
        setTarget(null);
        // A refusal (4xx: "Only someone who runs this conversation can change this.") and the server's "needs a database
        // update" (503 NOT_READY) say why in words meant for the person; any other fault, or no answer, is "Could not save".
        const told = isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY");
        setSave({ state: "error", message: told ? err.error.message : OFFLINE });
      }
    });
  };

  return (
    <section aria-labelledby={titleId}>
      <h3 id={titleId} className="mb-1 mt-7 px-2 text-sm font-medium text-secondary">Assistants</h3>
      <div className="px-2">
        {state.canChange ? (
          <Switch checked={on} disabled={!state.workspaceOn} onChange={(e) => change(e.target.checked)} hint={MENTION_WORDS.disclosure} className="pointer-coarse:min-h-10">
            {MENTION_WORDS.switchLabel}
          </Switch>
        ) : (
          <div className="py-2">
            <p className="text-sm font-medium text-foreground">{MENTION_WORDS.switchState(state.here && state.workspaceOn)}</p>
            <p className="text-meta font-normal text-secondary">{MENTION_WORDS.disclosure}</p>
          </div>
        )}
        {!state.workspaceOn ? <p className="text-meta font-normal text-secondary">{MENTION_WORDS.workspaceOff}</p> : null}
        {save.state === "error" ? <p role="alert" className="mt-1.5 text-meta font-medium text-danger">{save.message}</p> : null}
        {/* Only a screen reader needs to hear the save land: the switch itself already shows the choice. */}
        <p role="status" aria-live="polite" className="sr-only">{save.state === "saving" ? "Saving…" : save.state === "saved" ? "Saved" : ""}</p>
      </div>
    </section>
  );
}
