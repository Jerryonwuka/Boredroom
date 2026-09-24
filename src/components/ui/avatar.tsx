import { cn } from "@/lib/utils";
import { avatarUrl, initialsOf } from "@/lib/avatar";

/** A person: their picture if they set one, otherwise their initials on a dark disc. Works in server and client components. */
export function Avatar({ profileId, name, avatarKey, size = 32, className }: { profileId: string; name: string; avatarKey?: string | null; size?: number; className?: string }) {
  const url = avatarUrl(profileId, avatarKey);
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- served by our own signed-in avatar route
    return <img src={url} alt="" width={size} height={size} style={style} className={cn("shrink-0 rounded-full border border-border object-cover", className)} />;
  }
  return <span aria-hidden style={style} className={cn("inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-[linear-gradient(180deg,#242424,#161616)] font-semibold text-fg-muted", className)}>{initialsOf(name)}</span>;
}
