"use client";

/**
 * Development preview of the voice card (no sign-in needed): the notch's look, used by dictation and voice notes
 * across the web app (owner decision, 5 October 2026). Listening measures your microphone; working shows the shimmer.
 */
import { useState } from "react";
import { notFound } from "next/navigation";
import { VoiceCapture } from "@/components/app/voice-capture";
import { Button } from "@/components/ui/button";

export default function OrbPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  const [phase, setPhase] = useState<"idle" | "listening" | "working">("idle");
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-8">
      {phase === "idle" ? <p className="type-caption">Idle</p> : (
        <>
          <VoiceCapture phase={phase} hint={phase === "listening" ? "Speak to see the orb move." : "Brenda is writing out what you said."} onStop={() => setPhase("working")} onCancel={() => setPhase("idle")} />
          <VoiceCapture compact phase={phase} heard="Remind me at four to send the invoice" />
        </>
      )}
      <div className="flex gap-2">
        <Button variant={phase === "listening" ? "outline" : "primary"} onClick={() => setPhase(phase === "listening" ? "idle" : "listening")}>{phase === "listening" ? "Stop listening" : "Listen"}</Button>
        <Button variant="outline" onClick={() => setPhase("working")}>Working</Button>
      </div>
    </main>
  );
}
