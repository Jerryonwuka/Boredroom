"use client";

/**
 * A toast for every message someone sends you (from the owner's toast reference, 24 September 2026, on sonner):
 * their picture, "New message from …", the first line, and Reply, which opens the thread. Fed by the realtime
 * stream: on a messages or notifications change the browser asks for messages since the last look. Nothing shows
 * for the thread that is open on screen, and nothing shows twice.
 *
 * v4 (spec §7 Toasts): the toast surface (grey at 85% in dark, white in light) with the toast shadow, r12, the title
 * 14/20 medium, the line in the toast's description colour, and two small buttons. This file also holds the page's
 * one <Toaster>: every toast in the app (`notify`, `successToast`, these) floats bottom left, clear of Brenda's button.
 *
 * Personal assistants, phase 3 (owner decision, 8 October 2026): a message someone's assistant sent for them after they
 * confirmed it has the "via Max" chip on a line under the title; an assistant's own message has the assistant's face,
 * "New message from Max" and ", Olu's assistant" in the description colour (as "in #Design" is). The title wraps onto a
 * second line rather than being cut, so the room's name still shows.
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Toaster, toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
import { AssistantAvatar, AssistantChip, firstName } from "@/components/app/assistant-chip";
import { toProfile } from "@/lib/assistant-look";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ui/theme-toggle";
import { api } from "@/lib/api-client";
import { CHANGE_EVENT, type ChangeEvent } from "@/components/app/realtime";
import type { IncomingMessage } from "@/server/services/messaging";

export function MessageToasts({ orgSlug }: { orgSlug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const theme = useTheme();
  const since = useRef(new Date().toISOString());
  const seen = useRef(new Set<string>());
  const openConversation = useRef<string | null>(null);
  const currentConversation = pathname.endsWith("/messages") ? search.get("c") : null;
  useEffect(() => { openConversation.current = currentConversation; }, [currentConversation]);

  useEffect(() => {
    let busy = false;
    const onChange = async (e: Event) => {
      const d = (e as CustomEvent<ChangeEvent>).detail;
      if (!d || (d.table !== "messages" && d.table !== "notifications") || d.op !== "INSERT" || busy) return;
      busy = true;
      try {
        const r = await api<{ messages: IncomingMessage[] }>(`/api/orgs/${orgSlug}/messages/incoming?after=${encodeURIComponent(since.current)}`);
        for (const m of r.messages.reverse()) {
          if (seen.current.has(m.id)) continue;
          seen.current.add(m.id);
          if (m.created_at > since.current) since.current = m.created_at;
          if (openConversation.current === m.conversation_id) continue;
          const href = `/app/${orgSlug}/messages?c=${m.conversation_id}`;
          // Who wrote it (anything unknown, or a message from before migration 0037, is the person's own).
          const assistant = m.author_kind === "via_assistant" || m.author_kind === "assistant" ? toProfile(m.assistant) : null;
          const byAssistant = m.author_kind === "assistant" ? assistant : null;
          const room = m.kind !== "direct" ? (m.kind === "organisation" ? "Everyone" : `#${m.conversation_title}`) : null;
          toast.custom((t) => (
            <div className="toast-surface flex w-[340px] max-w-[calc(100vw-2.5rem)] items-start gap-3 p-3 pr-4">
              {byAssistant ? <AssistantAvatar assistant={byAssistant} /> : <Avatar profileId={m.sender_profile_id} name={m.sender_name} avatarKey={m.sender_avatar_key} size={32} />}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 break-words text-sm font-medium text-foreground">
                  New message from {byAssistant ? byAssistant.name : m.sender_name}
                  {byAssistant ? <span className="font-normal text-[var(--toast-description)]">, {firstName(m.sender_name)}&apos;s assistant{room ? "," : ""}</span> : null}
                  {room ? <span className="font-normal text-[var(--toast-description)]"> in {room}</span> : null}
                </p>
                {assistant && !byAssistant ? <p className="mt-1 flex"><AssistantChip assistant={assistant} personName={m.sender_name} isYou={false} /></p> : null}
                <p className="mt-0.5 line-clamp-2 break-words text-sm font-normal text-[var(--toast-description)]">{m.body}</p>
                <div className="mt-2.5 flex gap-1.5">
                  <Button size="xs" onClick={() => { toast.dismiss(t); router.push(href); }}>Reply</Button>
                  <Button size="xs" variant="ghost" onClick={() => toast.dismiss(t)}>Later</Button>
                </div>
              </div>
            </div>
          ), { duration: 8000 });
        }
      } catch { /* the badge still updates on refresh */ }
      finally { busy = false; }
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => window.removeEventListener(CHANGE_EVENT, onChange);
  }, [orgSlug, router]);

  return <Toaster position="bottom-left" theme={theme} offset={20} mobileOffset={12} gap={8} toastOptions={{ unstyled: true, classNames: { toast: "w-auto" } }} />;
}
