/** The URL a browser loads an avatar from; the key's file name makes it change whenever the image does. Pure, safe for the client. */
export function avatarUrl(profileId: string, avatarKey: string | null | undefined): string | null {
  return avatarKey ? `/api/avatars/${profileId}?v=${encodeURIComponent(avatarKey.split("/").pop() ?? "")}` : null;
}

export function initialsOf(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}
