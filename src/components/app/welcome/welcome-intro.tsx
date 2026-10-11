"use client";

/**
 * The welcome's first screen, the pitch (owner request, 11 October 2026: "an elevator pitch kind of thing"; contract 5.1).
 * Not a step: the rail shows Account ticked and nothing current. The title greets the person by name ("Welcome to Acme,
 * Ada", or "Acme is ready, Olu" for the founder), one plain sentence says what Boredroom is for them, then three short
 * beats for THEIR role (pitchFor): what it does for them, not a tour. The beats are a plain list, not numbered (they are
 * not a sequence), each with a 36px square holding its icon; the assistant's beat uses her glyph, never a generic AI icon.
 * One button, "Set up in 2 minutes", with how many short steps follow beside it.
 */
import type { ComponentType, ReactNode } from "react";
import { BellRing, ClipboardCheck, HandHelping, LayoutDashboard, LayoutGrid, LifeBuoy, MessagesSquare, Scale, Sun, Users } from "lucide-react";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { StepFrame } from "@/components/app/welcome/step-frame";
import { WELCOME_WORDS, type BeatIcon, type Pitch } from "@/lib/welcome";

const ICONS: Record<BeatIcon, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  day: Sun, chase: BellRing, help: LifeBuoy, talk: MessagesSquare, board: LayoutGrid, hand: HandHelping, check: ClipboardCheck,
  glance: LayoutDashboard, assistants: BrendaGlyph, messages: MessagesSquare, fair: Scale, people: Users,
};

export function WelcomeIntro({ pitch, stepCount, note, focusTitle, error, onStart }: {
  pitch: Pitch; stepCount: number; note?: ReactNode; focusTitle: boolean; error?: string | null; onStart: () => void;
}) {
  return (
    <StepFrame stepLabel={null} title={pitch.title} lede={pitch.lede} note={note} focusTitle={focusTitle} error={error}
      onSubmit={onStart} primary={{ label: WELCOME_WORDS.buttons.start }} hint={WELCOME_WORDS.welcome.hint(stepCount)}>
      <ul className="grid gap-4">
        {pitch.beats.map((b) => {
          const Icon = ICONS[b.icon];
          return (
            <li key={b.icon + b.title} className="flex items-start gap-3.5">
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl border border-border bg-fill-0 text-secondary">
                <Icon aria-hidden className="size-[18px]" />
              </span>
              <span className="min-w-0 pt-px">
                <span className="block text-sm font-semibold text-foreground">{b.title}</span>
                <span className="block text-sm font-normal text-secondary">{b.line}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </StepFrame>
  );
}
