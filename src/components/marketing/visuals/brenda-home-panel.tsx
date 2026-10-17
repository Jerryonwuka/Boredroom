import { Stage } from "@/components/landing/parts";
import { BrendaHomePanelBody } from "@/components/landing/hero-frame";

const LABEL: Record<0 | 1 | 2 | 3, string> = {
  0: "Brenda's home for a team lead: her greeting, “What do you want to do today?”, quick asks such as “What did I miss?”, “Who's working?” and “Who's late?”, and the box to ask her anything.",
  1: "Brenda's home for a team lead: her greeting, quick asks such as “Who's working?” and “Who's late?”, the box to ask her anything, and a card to summarise the week.",
  2: "Brenda's home for a team lead: her greeting, quick asks such as “Who's working?” and “Who's late?”, the box to ask her anything, and cards to summarise the week and chase work.",
  3: "Brenda's home for a team lead: her greeting, quick asks such as “Who's working?” and “Who's late?”, the box to ask her anything, and cards to summarise the week, chase work and write a doc.",
};

/**
 * Brenda's home without the app frame (owner feedback, 17 October 2026: pages v2): her panel as the home page draws it
 * (landing/hero-frame.tsx BrendaHomePanelBody: the purple glow of the approved home-panel exception, her face, "Good
 * afternoon, David.", "What do you want to do today?", a lead's quick asks, her box and `cards` of a lead's three
 * cards) on a Stage. A picture: role="img" with its own description, its insides hidden. `reveal` fades the stage in as
 * it arrives (off in a hero, which is on screen at load).
 */
export function BrendaHomePanel({ cards = 3, reveal = false, className }: { cards?: 0 | 1 | 2 | 3; reveal?: boolean; className?: string }) {
  return (
    <Stage reveal={reveal} className={className} innerClassName="p-2 sm:p-3">
      <div role="img" aria-label={LABEL[cards]}>
        <div aria-hidden inert>
          <BrendaHomePanelBody cards={cards} />
        </div>
      </div>
    </Stage>
  );
}
