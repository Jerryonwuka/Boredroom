import { cn } from "@/lib/utils";

/** The 3D icon set in public/icons (orange glass on black). Use one per page header, empty state or feature card; lucide for controls. */
export const ICON_3D = {
  "flag-alert": "Blocked, flagged, needs attention",
  "chart-ring": "Reports, analytics, hours",
  "eye-dashboard": "Workroom, dashboard, overview",
  "box-doc-check": "Deliverables, uploads, evidence",
  "doc-link-check": "Submissions, links, corrections",
  "eye-checklist": "Reviews, playback, checks",
  "shield-check": "Policy, fairness, security, approved",
  chat: "Messages, conversations",
  "video-people": "Recordings, meetings",
  "screen-record": "Screen recording",
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

export function Icon3D({ name, size = 40, className, alt = "" }: { name: Icon3DName; size?: number; className?: string; alt?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- static PNGs served from /public, sized by the caller
  return <img src={`/icons/${name}.png`} alt={alt} width={size} height={size} loading="lazy" className={cn("inline-block shrink-0 object-contain", className)} style={{ width: size, height: size }} />;
}

/** The lit square that holds a 3D icon: page headers, section openers, empty states. */
export function IconTile({ name, size = "md", className }: { name: Icon3DName; size?: "sm" | "md" | "lg"; className?: string }) {
  const px = size === "sm" ? 40 : size === "lg" ? 72 : 56;
  const icon = size === "sm" ? 26 : size === "lg" ? 50 : 38;
  return (
    <span className={cn("icon-tile", className)} style={{ width: px, height: px, borderRadius: Math.round(px / 4) }}>
      <Icon3D name={name} size={icon} />
    </span>
  );
}
