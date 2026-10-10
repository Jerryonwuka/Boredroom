"use client";

/**
 * Settings → Your assistant → Calls (owner decision, 10 October 2026: "incoming calls get their own sound setting,
 * separate from Brenda's sound effects, default on"; fix review, 10 October 2026: turning Brenda's chimes off silenced
 * incoming calls too, without saying so). One switch, "Ring for incoming calls", on unless the person turned it off,
 * remembered in this browser like her chimes (`brenda-sound` `callRingOff`). Turning it on plays the ring once. The card
 * still shows when someone else is signed in as the person: it changes only this browser, never their account. No orange
 * of its own (the switch is white).
 */
import { useSyncExternalStore } from "react";
import { Switch } from "@/components/ui/switch";
import { SettingsGroup, SettingsSection } from "@/components/app/settings-forms";
import { callRingOff, previewCallRing, setCallRingOff, subscribeCallRing } from "@/lib/brenda-sound";
import { CALL_WORDS } from "@/lib/calls";

const W = CALL_WORDS.settings;

export function CallSoundSettings({ name }: { /** The person's own assistant ("Max"), whose chimes have their own switch. */ name: string }) {
  const off = useSyncExternalStore(subscribeCallRing, callRingOff, () => false);
  return (
    <SettingsSection id="calls" title={W.section} description={W.description}>
      <SettingsGroup>
        <Switch className="px-5 py-4" checked={!off} hint={W.ringHint(name)}
          onChange={(e) => { setCallRingOff(!e.target.checked); if (e.target.checked) previewCallRing(); }}>
          {W.ring}
        </Switch>
      </SettingsGroup>
    </SettingsSection>
  );
}
