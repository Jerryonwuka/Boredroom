import { BookOpen, CalendarDays, ListChecks, MessagesSquare } from "lucide-react";
import { ToolSquare } from "@/components/ui/tool-tile";
import type { Category } from "@/lib/connectors/types";

/**
 * A connected app's mark (owner decisions, 22 October 2026: connectors, D11): no provider logos or brand assets, only a
 * neutral icon for the app's category in the tool square, beside its plain name.
 */
const ICONS = { calendar: CalendarDays, chat: MessagesSquare, knowledge: BookOpen, work: ListChecks } as const;

export function ProviderIcon({ category, size = 40, className }: { category: Category; size?: number; className?: string }) {
  const Icon = ICONS[category] ?? ListChecks;
  return <ToolSquare size={size} className={className}><Icon aria-hidden /></ToolSquare>;
}
