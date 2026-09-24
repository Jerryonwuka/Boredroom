/** Work status a person sets for themselves. Active is the live green dot; the others are still and coloured. */
export const PRESENCES = ["active", "away", "busy", "offline"] as const;
export type Presence = (typeof PRESENCES)[number];

export const PRESENCE: Record<Presence, { label: string; hint: string; color: string; live: boolean }> = {
  active: { label: "Active", hint: "Working and reachable", color: "var(--success)", live: true },
  away: { label: "Away", hint: "Stepped out for a while", color: "var(--warning)", live: false },
  busy: { label: "Do not disturb", hint: "Heads down; reply later", color: "var(--danger)", live: false },
  offline: { label: "Offline", hint: "Not working now", color: "var(--fg-faint)", live: false },
};

export function isPresence(v: unknown): v is Presence {
  return typeof v === "string" && (PRESENCES as readonly string[]).includes(v);
}
