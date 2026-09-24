"use client";

/**
 * A toast for every message someone sends you (from the owner's toast reference, 24 September 2026, on sonner):
 * their picture, "New message from …", the first line, and Reply, which opens the thread. Fed by the realtime
 * stream: on a messages or notifications change the browser asks for messages since the last look. Nothing shows
 * for the thread that is open on screen, and nothing shows twice.
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Toaster, toast } from "sonner";
import { Avatar } from "@/components/ui/avatar";
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
          toast.custom((t) => (
            <div className="tile flex w-[340px] items-start gap-3 p-4">
              <Avatar profileId={m.sender_profile_id} name={m.sender_name} avatarKey={m.sender_avatar_key} size={40} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">New message from {m.sender_name}{m.kind !== "direct" ? <span className="text-fg-subtle"> in {m.conversation_title}</span> : null}</p>
                <p className="line-clamp-2 text-sm text-fg-muted">{m.body}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => { toast.dismiss(t); router.push(href); }}>Reply</Button>
                  <Button size="sm" variant="ghost" onClick={() => toast.dismiss(t)}>Later</Button>
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

  return <Toaster position="bottom-left" theme={theme} offset={24} gap={12} toastOptions={{ unstyled: true, classNames: { toast: "w-auto" } }} />;
}
