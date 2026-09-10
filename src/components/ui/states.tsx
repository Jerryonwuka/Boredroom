import { cn } from "@/lib/utils";
import { AlertTriangle, Inbox, Lock, WifiOff } from "lucide-react";

export function EmptyState({ title, description, action, icon: Icon = Inbox, className }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; className?: string }) {
  return (
    <div className={cn("tile flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <Icon className="mb-3 h-8 w-8 text-fg-subtle" aria-hidden />
      <p className="font-semibold text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", description, action }: { title?: string; description?: string; action?: React.ReactNode }) {
  return <EmptyState icon={AlertTriangle} title={title} description={description} action={action} className="border-danger/40" />;
}

export function PermissionDenied({ description = "You do not have access to this area. Ask a workspace owner if you think you should." }: { description?: string }) {
  return <EmptyState icon={Lock} title="Permission denied" description={description} />;
}

export function OfflineState() {
  return <EmptyState icon={WifiOff} title="Connection lost" description="Boredroom cannot reach the server. Your timer state is kept on the server; reconnect to continue." />;
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: string; children?: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-info/40 bg-info/10 text-fg",
    warning: "border-warning/40 bg-warning/10 text-fg",
    danger: "border-danger/40 bg-danger/10 text-fg",
    success: "border-success/40 bg-success/10 text-fg",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", tones[tone], className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1 text-fg-muted" : ""}>{children}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-white/6", className)} aria-hidden />;
}
