"use client";

/** Development preview of the voice orb (no sign-in needed): the idle turn, and the voice-driven state on request. */
import { useState } from "react";
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb";
import { Button } from "@/components/ui/button";

export default function OrbPreview() {
  const [voice, setVoice] = useState(false);
  const [heard, setHeard] = useState(false);
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-8">
      <div className="size-72"><VoicePoweredOrb enableVoiceControl={voice} onVoiceDetected={setHeard} /></div>
      <Button variant={voice ? "danger" : "primary"} onClick={() => setVoice((v) => !v)}>{voice ? "Stop listening" : "Listen"}</Button>
      <p className="eyebrow">{voice ? (heard ? "Hearing you" : "Listening") : "Idle"}</p>
    </main>
  );
}
