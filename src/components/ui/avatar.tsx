import { cn } from "@/lib/utils";
import { avatarUrl, initialsOf } from "@/lib/avatar";
import { PresenceDot } from "@/components/ui/presence";
import type { Presence } from "@/lib/presence";

/**
 * A person, v4: their picture if they set one, over their initials on a solid grey-100 disc (which show if the picture
 * fails), round, no ring. 32px by default (the top bar), 20px in the sidebar's workspace row, 40px in list rows. With
 * `presence` the status dot sits on the bottom-right edge. Works in server and client components.
 */
export function Avatar({ profileId, name, avatarKey, presence, size = 32, className }: { profileId: string; name: string; avatarKey?: string | null; presence?: Presence | null; size?: number; className?: string }) {
  const url = avatarUrl(profileId, avatarKey);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  // The initials are always there; a picture is laid over them as a background, so a picture that fails to load (a
  // missing file, an expired link) leaves the initials showing instead of a broken-image icon.
  const disc = (
    <span aria-hidden style={style} className={cn("relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-grey-100 font-medium leading-none text-secondary", !presence && className)}>
      {initialsOf(name)}
      {url ? <span className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${url}")` }} /> : null}
    </span>
  );
  if (!presence) return disc;
  const dot = Math.max(8, Math.round(size * 0.3));
  return (
    <span className={cn("relative inline-block shrink-0 align-middle", className)} style={{ width: size, height: size }}>
      {disc}
      <PresenceDot presence={presence} size={dot} className="absolute -bottom-px -right-px" />
    </span>
  );
}
