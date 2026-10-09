"use client";

/**
 * The person's abilities on the client (owner decisions, 8–9 October 2026: phase 7c, the abilities catalogue; contract
 * G.3). The server is the source of truth and refuses a switched-off ability's tools itself; these two hooks only keep
 * the web from offering what would be refused:
 *
 * - `useVoiceOn()`: whether the person's own assistant may talk and listen. False only when the workspace switched Voice
 *   off (`assistantProfiles` then answers `voice: false`, and `speak` reads "never"): her chat hides the microphone and
 *   every Listen button, and reads nothing aloud. A server from before phase 7c sends no `voice`, which reads as on.
 * - `useAbilitiesOff(orgSlug, enabled)`: the abilities that are not in effect for the person (switched off by the
 *   workspace or by them), read once per page from GET /brenda/abilities, only once `enabled` (the drawer asks when it
 *   opens, not on every page load). Until it answers, and when it cannot be read (before migration 0050 every new
 *   ability reads on), nothing is off. Settings → Abilities calls `forgetAbilities` after a change, so the next read
 *   is fresh.
 *
 * No orange, nothing drawn: a hook.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useAssistant } from "@/components/app/assistant-context";
import { api } from "@/lib/api-client";
import type { AbilitiesView, AbilityKey } from "@/lib/abilities";

/** Whether the person's assistant may talk and listen (phase 7c: the workspace's Voice ability). */
export function useVoiceOn(): boolean {
  // `voice: false` is phase 7c's (assistantProfiles); left out, as by an older server, it is on.
  return useAssistant().voice !== false;
}

const NONE: ReadonlySet<AbilityKey> = new Set();
/** Per workspace: the abilities read as off, or null while not read yet; whether a read is on its way. */
const store = new Map<string, { off: ReadonlySet<AbilityKey> | null; loading: boolean }>();
const listeners = new Set<() => void>();
const tell = () => { for (const l of listeners) l(); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

function load(orgSlug: string) {
  const at = store.get(orgSlug);
  if (at?.loading || at?.off) return;
  store.set(orgSlug, { off: null, loading: true });
  api<AbilitiesView>(`/api/orgs/${orgSlug}/brenda/abilities`).then(
    (v) => {
      const off = new Set<AbilityKey>((v?.cards ?? []).filter((c) => c.effective === false).map((c) => c.key));
      store.set(orgSlug, { off, loading: false });
      tell();
    },
    // Not readable (an older server, a fault): nothing is hidden; the server still refuses what is off, in words.
    () => { store.set(orgSlug, { off: NONE, loading: false }); tell(); },
  );
}

/** Forgets what was read, so the next `useAbilitiesOff` reads again (after a change in Settings). */
export function forgetAbilities(orgSlug: string) {
  store.delete(orgSlug);
  tell();
}

/** The abilities not in effect for the person; empty until read, and when they cannot be. */
export function useAbilitiesOff(orgSlug: string, enabled = true): ReadonlySet<AbilityKey> {
  // The entry itself (stable until it changes), so a forgotten one (gone) reads again.
  const entry = useSyncExternalStore(subscribe, () => store.get(orgSlug) ?? null, () => null);
  useEffect(() => { if (enabled && !entry) load(orgSlug); }, [orgSlug, enabled, entry]);
  return entry?.off ?? NONE;
}
