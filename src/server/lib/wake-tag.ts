/**
 * Wake tags (owner request, 23 October 2026: realtime plan, phase 0, item 6; goal G1). Public routes and webhook routes
 * log one word when a request is about to reach the database, so Vercel's logs tell bots from people and say what woke
 * Neon at night. Only the tag: never an address, an id, an email, a token or a body.
 */
export type WakeTagName = "auth" | "waitlist" | "invite" | "join" | "link" | `webhook:${string}`;

const SAFE = /^(auth|waitlist|invite|join|link|webhook:[a-z0-9_-]{1,40})$/;

/** Logs `[wake] <tag>`. A tag outside the fixed set is logged as `[wake] other` (nothing request-made reaches the log). */
export function wakeTag(tag: WakeTagName): void {
  console.log(`[wake] ${SAFE.test(tag) ? tag : "other"}`);
}

/** A once-only tagger for one request: the first call logs, later ones don't (a request that queries several times). */
export function wakeTagOnce(tag: WakeTagName): () => void {
  let done = false;
  return () => { if (done) return; done = true; wakeTag(tag); };
}
