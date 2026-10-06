/**
 * Where to go after signing in, signing up or confirming an email: a path on this site, or the workspace list.
 * The path is resolved the way a browser would, because "//host", "/\host" and "/<tab>/host" all lead to another
 * site once a browser reads them, and a sign-in page that follows them is an open redirect.
 */
export function safeNextPath(next: string | string[] | null | undefined, fallback = "/app"): string {
  // A repeated ?next= arrives as a list; the first one counts.
  const path = Array.isArray(next) ? next[0] : next;
  if (typeof path !== "string" || !path.startsWith("/")) return fallback;
  try {
    const url = new URL(path, "http://boredroom.invalid");
    return url.origin === "http://boredroom.invalid" ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/** The invitation or join code a `next` path leads to, so sign-up and sign-in can say which organisation it is. */
export function joiningTarget(next: string | null | undefined): { kind: "invite"; token: string } | { kind: "join"; code: string } | null {
  const path = safeNextPath(next, "");
  const invite = /^\/invite\/([^/?#]+)$/.exec(path);
  if (invite) return { kind: "invite", token: decodeSegment(invite[1]) };
  const join = /^\/join\/([^/?#]+)$/.exec(path);
  return join ? { kind: "join", code: decodeSegment(join[1]) } : null;
}

/** A path segment as typed: a malformed escape stays as it is instead of throwing. */
export function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}
