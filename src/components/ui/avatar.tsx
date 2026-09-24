import { cn } from "@/lib/utils";
import { avatarUrl, initialsOf } from "@/lib/avatar";
import { PresenceDot } from "@/components/ui/presence";
import type { Presence } from "@/lib/presence";

/**
 * A person: their picture if they set one, otherwise their initials on a dark disc. With `presence` the status dot
 * sits on the bottom-right edge. Works in server and client components.
 */
export function Avatar({ profileId, name, avatarKey, presence, size = 32, className }: { profileId: string; name: string; avatarKey?: string | null; presence?: Presence | null; size?: number; className?: string }) {
  const url = avatarUrl(profileId, avatarKey);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  const disc = url
    // eslint-disable-next-line @next/next/no-img-element -- served by our own signed-in avatar route
    ? <img src={url} alt="" width={size} height={size} style={style} className={cn("shrink-0 rounded-full border border-border object-cover", !presence && className)} />
    : <span aria-hidden style={style} className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-[linear-gradient(180deg,var(--avatar-top),var(--avatar-bottom))] font-semibold text-fg-muted", !presence && className)}>{initialsOf(name)}</span>;
  if (!presence) return disc;
  const dot = Math.max(8, Math.round(size * 0.3));
  return (
    <span className={cn("relative inline-block shrink-0 align-middle", className)} style={{ width: size, height: size }}>
      {disc}
      <PresenceDot presence={presence} size={dot} className="absolute -bottom-px -right-px" />
    </span>
  );
}
