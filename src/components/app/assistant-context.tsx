"use client";

import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_PROFILES, type AssistantProfile, type AssistantProfiles } from "@/lib/assistant-look";

/**
 * Personal assistants on the client (owner decision, 7 October 2026: personal assistants). `AppShell` reads the person's
 * own assistant and the workspace's once per request (server/services/assistant-profile) and hands them down here, so the
 * sidebar, the top bar, the page, the drawer, the toasts and "Meet your assistant" all name and draw the same one. The
 * provider holds no state of its own: after a save the saving component calls `router.refresh()` and the shell renders
 * again with the new profile. Both contexts have defaults (Brenda, setup done), so every hook works outside a workspace
 * (the landing page, Control Center, the dev pages).
 */

const Profiles = createContext<AssistantProfiles>(DEFAULT_PROFILES);
/** Set by `AssistantScope`: the assistant to draw and name inside it instead of the person's own. */
const Scope = createContext<AssistantProfile | null>(null);

export function AssistantProvider({ value, children }: { value: AssistantProfiles; children: ReactNode }) {
  return <Profiles value={value}>{children}</Profiles>;
}

/** The person's own assistant, the workspace's, setup state. Outside a provider (landing page, Control Center, dev pages): Brenda, setupDone true. */
export function useAssistant(): AssistantProfiles {
  return useContext(Profiles);
}

/** Draws everything inside it as another assistant: a preview, the workspace assistant's report row. */
export function AssistantScope({ profile, children }: { profile: AssistantProfile; children: ReactNode }) {
  return <Scope value={profile}>{children}</Scope>;
}

/** The assistant to draw and name here: the nearest AssistantScope's, else the person's own. */
export function useScopedAssistant(): AssistantProfile {
  const scoped = useContext(Scope);
  const { personal } = useContext(Profiles);
  return scoped ?? personal;
}

/** The scoped assistant's name as text, for server components rendered inside AppShell ("Back to <AssistantName />"). */
export function AssistantName() {
  return <>{useScopedAssistant().name}</>;
}
