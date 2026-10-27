/**
 * Settings → Brenda → AI and voice, for owners and HR (owner request, 27 October 2026: "remove every API key store … the
 * organisation should not have to put any API key inside"). Read-only: Claude and the natural voices are Boredroom's, for
 * every workspace, so there is no key, test or model to choose. One card of rows, each with a status dot and its word
 * (status colours, never orange: accent rules): Claude connected or not, natural voices connected or computer voice only,
 * and the characters this workspace said aloud today and this month (a real per-workspace figure, not a key). Before
 * migration 0053 an info alert says natural voices need a database update.
 */
import { StatusDot } from "@/components/ui/status-dot";
import { SettingsAlert, SettingsGroup, SettingsRow } from "@/components/app/settings-forms";
import { NATURAL_WORDS } from "@/lib/assistant-speech/natural-words";
import type { VoiceConnectionStatus } from "@/lib/natural-voices";

const W = NATURAL_WORDS.connection;

function State({ on, onWord, offWord, line }: { on: boolean; onWord: string; offWord: string; line?: string }) {
  return (
    <span className="grid gap-0.5">
      <span className="flex items-center gap-2 text-foreground"><StatusDot tone={on ? "success" : "neutral"} />{on ? onWord : offWord}</span>
      {!on && line ? <span className="text-meta font-normal text-secondary">{line}</span> : null}
    </span>
  );
}

export function AiProvidedSettings({ claude, voice }: { claude: boolean; voice: VoiceConnectionStatus }) {
  const voiceOn = voice.ready && voice.source !== "none";
  return (
    <SettingsGroup>
      {!voice.ready ? <SettingsAlert tone="info">{W.notReady}</SettingsAlert> : null}
      {voice.ready && voice.low ? <SettingsAlert tone="warning">{W.lowShared}</SettingsAlert> : null}
      <SettingsRow label={W.claude} hint={W.claudeHint} align="text">
        <State on={claude} onWord={W.claudeOn} offWord={W.claudeOff} line={W.claudeOffLine} />
      </SettingsRow>
      <SettingsRow label={W.voice} hint={W.voiceHint} align="text">
        <State on={voiceOn} onWord={W.voiceOn} offWord={W.voiceOff} line={W.voiceOffLine} />
      </SettingsRow>
      {voice.ready ? (
        <SettingsRow label={W.workspace} hint={W.workspaceHint} align="text">
          <span className="tabular-nums">{W.workspaceValue(voice.today.used, voice.workspaceMonth)}</span>
        </SettingsRow>
      ) : null}
    </SettingsGroup>
  );
}
