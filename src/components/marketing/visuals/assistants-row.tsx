import { BrendaFace } from "@/components/app/brenda-face";
import type { AssistantColour } from "@/lib/assistant-look";
import { cn } from "@/lib/utils";

/** Five of the ten colours, neighbours contrasting (the home carousel's order). */
const COLOURS: readonly AssistantColour[] = ["coral", "purple", "yellow", "teal", "blue"];

/**
 * Five assistants in a row (owner feedback, 17 October 2026: pages v2): Brenda's face in five palette colours, quiet,
 * overlapping a little, and the line "Everyone names theirs and picks her colour from ten." (true: personal assistants,
 * ten colours). The faces are decorative; the line says it.
 */
export function AssistantsRow({ caption = "Everyone names theirs and picks her colour from ten.", className }: { caption?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      <span aria-hidden className="flex -space-x-1.5">
        {COLOURS.map((c) => (
          <span key={c} className="grid size-8 place-items-center rounded-full bg-background ring-2 ring-background">
            <BrendaFace size="sm" look={{ colour: c, visor: "bean", eyes: "pill" }} quiet />
          </span>
        ))}
      </span>
      <p className="text-meta font-normal text-secondary">{caption}</p>
    </div>
  );
}
