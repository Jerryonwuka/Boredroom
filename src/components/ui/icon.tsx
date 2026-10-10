import {
  CalendarClock, ChartPie, FileCheck, Flag, LayoutDashboard, Laptop, ListChecks, ListTodo, LogIn, LogOut, MessageSquare,
  MonitorPlay, PackageCheck, ShieldCheck, SquareCheckBig, Target, Timer, Users, Video, Building2, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ToolSquare } from "@/components/ui/tool-tile";

/**
 * The v3 3D icon names, kept so callers compile. v4 is monochrome (owner decision, 6 October 2026): every name now
 * draws a line icon (lucide, 1.5 stroke) in the secondary grey, and IconTile draws it in the v4 tool square. Nothing
 * uses the v3 PNGs in public/icons any more (the landing page moved to v4 on 6 October 2026); they stay until the
 * owner decides to remove them.
 */
export const ICON_3D = {
  "flag-alert": "Blocked, flagged, needs attention",
  "chart-ring": "Reports, analytics, hours",
  "eye-dashboard": "Workroom, dashboard, overview",
  "box-doc-check": "Deliverables, uploads, evidence",
  "doc-link-check": "Submissions, links, corrections",
  "eye-checklist": "Reviews, checks",
  "shield-check": "Policy, fairness, security, approved",
  chat: "Messages, conversations",
  // Phase 8 (owner decisions, 8 October 2026): calls replace screen videos. Both names stay so callers compile; the
  // PNGs stay too (the owner's earlier note). "eye-checklist" no longer says playback (fix review, 10 October 2026).
  "video-people": "Calls, meetings",
  "screen-record": "Screen sharing",
  desk: "Workspace, organisation",
  "calendar-clock": "Attendance, schedule, retention",
  "person-laptop": "A staff member, remote work",
  people: "Teams, people",
  "card-check": "Tasks, done, completed",
  "day-checklist": "My Day, to-dos, planning",
  "focus-target": "Focus, everything in view",
  stopwatch: "Timer, sessions, time",
  "clock-in": "Clock in",
  "clock-out": "Clock out",
} as const;
export type Icon3DName = keyof typeof ICON_3D;

/** The line icon for each v3 name. */
export const LINE_ICON: Record<Icon3DName, LucideIcon> = {
  "flag-alert": Flag,
  "chart-ring": ChartPie,
  "eye-dashboard": LayoutDashboard,
  "box-doc-check": PackageCheck,
  "doc-link-check": FileCheck,
  "eye-checklist": ListChecks,
  "shield-check": ShieldCheck,
  chat: MessageSquare,
  "video-people": Video,
  "screen-record": MonitorPlay,
  desk: Building2,
  "calendar-clock": CalendarClock,
  "person-laptop": Laptop,
  people: Users,
  "card-check": SquareCheckBig,
  "day-checklist": ListTodo,
  "focus-target": Target,
  stopwatch: Timer,
  "clock-in": LogIn,
  "clock-out": LogOut,
};

/** A line icon by its v3 name, drawn at 75% of `size` inside a `size` box so it lines up where the 3D icon stood. */
export function Icon3D({ name, size = 40, className, alt = "" }: { name: Icon3DName; size?: number; className?: string; alt?: string }) {
  const Line = LINE_ICON[name];
  return (
    <span role={alt ? "img" : undefined} aria-label={alt || undefined} aria-hidden={alt ? undefined : true} className={cn("inline-grid shrink-0 place-items-center text-secondary", className)} style={{ width: size, height: size }}>
      <Line size={Math.round(size * 0.75)} strokeWidth={1.5} aria-hidden />
    </span>
  );
}

/** The v4 tool square with the line icon: sm 40, md 48, lg 56. */
export function IconTile({ name, size = "md", className }: { name: Icon3DName; size?: "sm" | "md" | "lg"; className?: string }) {
  const Line = LINE_ICON[name];
  const px = size === "sm" ? 40 : size === "lg" ? 56 : 48;
  return <ToolSquare size={px} className={className}><Line strokeWidth={1.75} style={{ width: Math.round(px / 2), height: Math.round(px / 2) }} /></ToolSquare>;
}
