import { ChartColumn, CreditCard, Scale, type LucideProps } from "lucide-react";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import {
  AnimatedCalendarCheck, AnimatedClipboardCheck, AnimatedClipboardList, AnimatedCopy, AnimatedFileText, AnimatedLayoutGrid, AnimatedListChecks,
  AnimatedMessageSquareReply, AnimatedMessagesSquare, AnimatedShieldCheck, AnimatedTimer, AnimatedUsersRound, AnimatedVideo,
} from "@/components/ui/animated-icons";
import type { PageIconName } from "@/lib/marketing/menus";

/**
 * A public page's icon (owner feedback, 17 October 2026: pages v2): the menus, the index cards and the related cards
 * draw a page with the same line icon (lib/marketing/menus.ts PAGE_ICON). The animated twin where one exists, so it
 * plays while its link is hovered or focused from the keyboard (never on its own); Brenda's own glyph for her page.
 * Safe in server and client components alike. Always decorative: the link's words name the page.
 */
type IconComponent = React.ComponentType<LucideProps> | typeof BrendaGlyph;

const ICONS: Record<PageIconName, IconComponent> = {
  brenda: BrendaGlyph,
  "calendar-check": AnimatedCalendarCheck,
  video: AnimatedVideo,
  "file-text": AnimatedFileText,
  "shield-check": AnimatedShieldCheck,
  "message-square-reply": AnimatedMessageSquareReply,
  "list-checks": AnimatedListChecks,
  "users-round": AnimatedUsersRound,
  "layout-grid": AnimatedLayoutGrid,
  scale: Scale,
  timer: AnimatedTimer,
  "clipboard-list": AnimatedClipboardList,
  copy: AnimatedCopy,
  "clipboard-check": AnimatedClipboardCheck,
  "messages-square": AnimatedMessagesSquare,
  "chart-column": ChartColumn,
  "credit-card": CreditCard,
};

export function PageIcon({ name, className }: { name: PageIconName; className?: string }) {
  const Icon = ICONS[name] as React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  return <Icon aria-hidden className={className} />;
}
