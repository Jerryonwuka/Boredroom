import { cn } from "@/lib/utils";
import { CircleAlert, CircleCheck, Info, Inbox, Lock, TriangleAlert, WifiOff } from "lucide-react";
import { LINE_ICON, type Icon3DName } from "@/components/ui/icon";
import { withAnimatedIcons } from "@/components/ui/animated-icons";

type IconComponent = React.ComponentType<{ className?: string; strokeWidth?: number; "aria-hidden"?: boolean }>;

/** The icon square's look per tone: the accent tint by default; status meaning wins over accent. */
const SQUARE = {
  accent: "bg-accent-tint text-accent-text",
  neutral: "bg-fill-1 text-secondary",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
} as const;

/**
 * An empty state, v4 with the accent rules (6 October 2026): centred, the line icon in a small orange-tinted square
 * (48px r12 with a 24px icon; compact 36px r10 with 18px), the title 14/20 medium, the description 14/20 regular in the
 * secondary grey (max 448px, balanced), and one optional next action (an outline button). No card of its own. `icon3d`
 * names a v3 icon and draws its line equivalent; `icon` takes any line icon (BrendaGlyph for Brenda). `compact` for
 * inside a card or a list. `tone`: `accent` (default), `neutral` (a locked or quiet state), `warning`, `danger` (errors).
 * The icon is its animated twin where it has one (components/ui/animated-icons): it plays while the pointer is over
 * the empty state or the keyboard is on its action, never by itself.
 */
export function EmptyState({ title, description, action, icon, icon3d, className, compact = false, tone = "accent" }: { title: string; description?: React.ReactNode; action?: React.ReactNode; icon?: IconComponent; icon3d?: Icon3DName; className?: string; compact?: boolean; tone?: keyof typeof SQUARE }) {
  const Icon: IconComponent = icon ?? (icon3d ? LINE_ICON[icon3d] : Inbox);
  return (
    <div data-icon-trigger className={cn("flex flex-col items-center justify-center text-center", compact ? "px-4 py-6" : "px-6 py-12", className)}>
      <span aria-hidden className={cn("grid shrink-0 place-items-center shadow-[0_0_0_1px_var(--border)]", SQUARE[tone], compact ? "mb-2.5 size-9 rounded-[10px] [&_svg]:size-[18px]" : "mb-4 size-12 rounded-xl [&_svg]:size-6")}>
        {withAnimatedIcons(<Icon strokeWidth={1.75} aria-hidden />)}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-md text-balance text-sm font-normal text-secondary">{description}</p> : null}
      {action ? <div className={compact ? "mt-3" : "mt-4"}>{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, action }: { title?: string; description?: string; action?: React.ReactNode }) {
  return <EmptyState tone="danger" icon={TriangleAlert} title={title} description={description} action={action} />;
}

export function PermissionDenied({ description = "You do not have access to this area. Ask a workspace owner if you think you should." }: { description?: string }) {
  return <EmptyState tone="neutral" icon={Lock} title="Permission denied" description={description} />;
}

export function OfflineState() {
  return <EmptyState tone="warning" icon={WifiOff} title="Connection lost" description="Boredroom cannot reach the server. Your timer state is kept on the server; reconnect to continue." />;
}

/**
 * An inline notice: r12, a hairline, fill-0, a 16px status icon, the title 14/20 medium and the body in the secondary
 * grey. Danger and warning carry a light wash of their colour so they are not missed. Danger is announced as an alert.
 */
export function Alert({ tone = "info", title, children, className, action }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children?: React.ReactNode; className?: string; action?: React.ReactNode }) {
  const look = {
    info: { box: "border-border bg-fill-0", icon: Info, color: "text-secondary" },
    success: { box: "border-border bg-fill-0", icon: CircleCheck, color: "text-success" },
    warning: { box: "border-warning/25 bg-warning/[0.06]", icon: TriangleAlert, color: "text-warning" },
    danger: { box: "border-danger/30 bg-danger/[0.07]", icon: CircleAlert, color: "text-danger" },
  }[tone];
  const Icon = look.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm", look.box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", look.color)} aria-hidden />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children ? <div className={cn("font-normal", title ? "mt-0.5 text-secondary" : "text-foreground")}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A loading placeholder: fill-1, r8, pulsing (still under reduced motion). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-fill-1", className)} aria-hidden />;
}
