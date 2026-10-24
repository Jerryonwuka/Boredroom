/**
 * Boredroom for Mac's download (owner request, 24 October 2026: people download it before there is an Apple Developer
 * account; option A, the same day: one app, Boredroom.app, with the dashboard window and Brenda in the notch). The disk image lives on the public releases repo, so the website links GitHub's "latest" address, which
 * always points at the newest release's `Boredroom.dmg` (desktop/README.md, "Releasing").
 * Safe on the server and the client: no imports.
 */
export const DEFAULT_DESKTOP_DOWNLOAD_URL = "https://github.com/Jerryonwuka/boredroom-releases/releases/latest/download/Boredroom.dmg";

/** What a Mac needs (the app's minimumSystemVersion is 14.0; one universal download). */
export const MAC_REQUIREMENTS = { macos: "macOS 14 Sonoma or later", chips: "Apple silicon or Intel" } as const;

/**
 * The disk image's address: DESKTOP_DOWNLOAD_URL when it is an https address, the releases default when it is unset or
 * blank, and null for anything else ("off" stops offering the download everywhere).
 */
export function desktopDownloadUrl(env: Record<string, string | undefined> = process.env): string | null {
  const raw = env.DESKTOP_DOWNLOAD_URL?.trim();
  if (!raw) return DEFAULT_DESKTOP_DOWNLOAD_URL;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
