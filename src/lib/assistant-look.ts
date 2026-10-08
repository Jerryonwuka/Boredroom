/**
 * Personal assistants (owner decision, 7 October 2026: phase 1). Every person has their own assistant in each workspace,
 * with a name, a sphere colour from this curated palette, a visor and eyes; the workspace has one of its own that signs
 * what the workspace sends on its own (the end-of-day team report). The default is Brenda as she was: white, the bean
 * visor, pill eyes. This module is the one source for the palette, the presets, the defaults and the name rule, shared by
 * the server, the canvas engine, the CSS faces and the glyph. It imports nothing but types from lib/act-mode (itself
 * import-free) and lib/routines (client-safe), so client code can use it. The notch cannot import it: the desktop state carries the resolved colours
 * instead.
 *
 * Every combination stays readable: the visor is always near-black and the eyes always white, and every sphere colour is
 * light enough for the visor to stand out (at least 7:1 at the sphere's middle tone; tests/unit/assistant-look.test.ts).
 *
 * Her voice (owner decision, 7 October 2026: phase 2): when the person's own assistant reads replies aloud, on the web
 * and in the notch alike ("When I talk to her", the default; "Always"; "Never"). It is the person's preference, so it
 * sits beside `personal` in `AssistantProfiles`, not in a profile (the workspace assistant has none). Which voice and
 * how fast are kept on each device (lib/assistant-speech/prefs), never here.
 */

import type { ActState } from "@/lib/act-mode";
import type { QuietState } from "@/lib/routines";

export const ASSISTANT_COLOURS = ["white", "grey", "yellow", "orange", "coral", "pink", "purple", "blue", "teal", "green"] as const;
export const ASSISTANT_VISORS = ["bean", "band", "screen"] as const;
export const ASSISTANT_EYES = ["pill", "round", "square"] as const;
export type AssistantColour = (typeof ASSISTANT_COLOURS)[number];
export type AssistantVisor = (typeof ASSISTANT_VISORS)[number];
export type AssistantEyes = (typeof ASSISTANT_EYES)[number];

export type AssistantLook = { colour: AssistantColour; visor: AssistantVisor; eyes: AssistantEyes };
export type AssistantProfile = AssistantLook & { name: string };
/**
 * What the workspace pages know: the person's own assistant, the workspace's, whether "Meet your assistant" is done, and
 * when the person's own assistant speaks (phase 2). `act` (owner decision, 8 October 2026: act without asking): whether
 * it asks before acting, as the server reads it (lib/act-mode); optional so every existing literal still compiles, and
 * read as `ASK_STATE` when absent (`actStateOf`).
 */
/**
 * `ai` (review, 8 October 2026): whether the workspace has an AI connection, read only for someone who chose Act without
 * asking (absent otherwise). False: the built-in helper answers, and it always asks first.
 */
/**
 * `quiet` (owner decision, 8 October 2026: phase 7a, quiet hours): whether the person is in their quiet hours now, when
 * they end and when the next begin (lib/routines `QuietState`), as the server read it with the profiles. While active,
 * replies are not read aloud on their own and her sounds do not play (Listen still works); the web re-evaluates it at
 * `until` and `nextStart`. Present only for someone with quiet hours on (so every existing literal still compiles and
 * the shape is unchanged for everyone else); absent or `ready: false` is never quiet.
 */
export type AssistantProfiles = { personal: AssistantProfile; workspace: AssistantProfile; setupDone: boolean; canEditWorkspace: boolean; speak: AssistantSpeak; act?: ActState; ai?: boolean; quiet?: QuietState };

/** The drawn sphere's four stops (lib/brenda-character/engine), from the lit upper left to the rim. */
export type SphereShades = { light: string; mid: string; shade: string; rim: string };
/** The small CSS faces' three stops (`.brenda-face` in globals.css, `.face` in the notch). */
export type FaceShades = { hi: string; mid: string; edge: string };

export const VISOR_INK = "#0b0b0e";

export const PALETTE: Record<AssistantColour, { label: string; sphere: SphereShades; face: FaceShades }> = {
  white:  { label: "White",  sphere: { light: "#ffffff", mid: "#f6f6f8", shade: "#dedfe4", rim: "#b8b9c2" }, face: { hi: "#ffffff", mid: "#ececf0", edge: "#c9cad1" } },
  grey:   { label: "Grey",   sphere: { light: "#f4f4f6", mid: "#c4c5cc", shade: "#a3a4ad", rim: "#7c7d87" }, face: { hi: "#f2f2f4", mid: "#b9bac2", edge: "#8a8b95" } },
  yellow: { label: "Yellow", sphere: { light: "#fff7d1", mid: "#ffdb5c", shade: "#f2c230", rim: "#c99a12" }, face: { hi: "#fff4c2", mid: "#ffd54a", edge: "#d0a015" } },
  orange: { label: "Orange", sphere: { light: "#ffe2c7", mid: "#ffa05c", shade: "#f5822e", rim: "#c9611a" }, face: { hi: "#ffdcbd", mid: "#ff9447", edge: "#d0661c" } },
  coral:  { label: "Coral",  sphere: { light: "#ffe3de", mid: "#ff9384", shade: "#f56d5c", rim: "#c94c3d" }, face: { hi: "#ffddd6", mid: "#ff8676", edge: "#cf5242" } },
  pink:   { label: "Pink",   sphere: { light: "#ffe3f0", mid: "#ff99c8", shade: "#f472ab", rim: "#c94d85" }, face: { hi: "#ffdcec", mid: "#ff8cc0", edge: "#cf528b" } },
  purple: { label: "Purple", sphere: { light: "#eee6ff", mid: "#b39bff", shade: "#9579f5", rim: "#6c52cc" }, face: { hi: "#e9dfff", mid: "#a88cff", edge: "#7559d6" } },
  blue:   { label: "Blue",   sphere: { light: "#e0ecff", mid: "#82adff", shade: "#5d8ff5", rim: "#3a68cc" }, face: { hi: "#dbe8ff", mid: "#74a3ff", edge: "#416fd4" } },
  teal:   { label: "Teal",   sphere: { light: "#d8f7f3", mid: "#5ad6cb", shade: "#2fbcb0", rim: "#1b8c83" }, face: { hi: "#d1f5f0", mid: "#4ccfc3", edge: "#1f948a" } },
  green:  { label: "Green",  sphere: { light: "#dcf8e6", mid: "#74db9c", shade: "#43c278", rim: "#25915a" }, face: { hi: "#d5f5e0", mid: "#62d48f", edge: "#2a9960" } },
};

export const VISORS: Record<AssistantVisor, { label: string }> = {
  bean: { label: "Bean visor" },     // rounded over each eye, a soft dip between them (Brenda's)
  band: { label: "Band visor" },     // a wide, slim capsule across the face
  screen: { label: "Screen visor" }, // a rounded rectangle, taller and narrower
};
export const EYES: Record<AssistantEyes, { label: string }> = {
  pill: { label: "Pill eyes" },      // tall rounded pills (Brenda's)
  round: { label: "Round eyes" },    // circles
  square: { label: "Square eyes" },  // squares with softened corners
};

// ---- When she speaks (owner decision, 7 October 2026: her voice, phase 2) ------------------------------------------
// 'voice': she reads the reply to a message the person dictated on the web or spoke in the notch (the default: talk to
// her and she talks back); 'always': every reply; 'never': only when they press Listen on a reply. Declared before the
// defaults below, which read DEFAULT_SPEAK as the module loads.

export const ASSISTANT_SPEAK = ["voice", "always", "never"] as const;
export type AssistantSpeak = (typeof ASSISTANT_SPEAK)[number];
export const DEFAULT_SPEAK: AssistantSpeak = "voice";
export const isAssistantSpeak = (v: unknown): v is AssistantSpeak => (ASSISTANT_SPEAK as readonly unknown[]).includes(v);
/** A stored value (or nothing, before migration 0036) as a preference: anything unknown is the default. */
export const toSpeak = (v: unknown): AssistantSpeak => (isAssistantSpeak(v) ? v : DEFAULT_SPEAK);

// ---- The defaults --------------------------------------------------------------------------------------------------

export const DEFAULT_ASSISTANT_NAME = "Brenda";
export const DEFAULT_LOOK: AssistantLook = { colour: "white", visor: "bean", eyes: "pill" };
export const DEFAULT_ASSISTANT: AssistantProfile = { name: DEFAULT_ASSISTANT_NAME, ...DEFAULT_LOOK };
export const DEFAULT_PROFILES: AssistantProfiles = { personal: DEFAULT_ASSISTANT, workspace: DEFAULT_ASSISTANT, setupDone: true, canEditWorkspace: false, speak: DEFAULT_SPEAK };

// ---- The name ------------------------------------------------------------------------------------------------------
// It is shown everywhere the assistant appears and goes into the assistant's instructions (as quoted data, copilot.ts),
// so it may only hold what a name needs: never punctuation that could carry an instruction or markup.

export const ASSISTANT_NAME_MAX = 24;
const NAME_CHARS = /^[\p{L}\p{M}\p{N}' .-]+$/u;
// Letters that draw nothing (the Hangul fillers U+115F, U+1160, U+3164, U+FFA0 are letters, Lo, but invisible) and
// marks stacked on marks (zalgo) would make a name that looks blank or unreadable wherever it is shown, to colleagues
// too, so neither is a letter here (review, 7 October 2026). Three marks in a row still cover every script's real
// stacks (a Thai vowel and tone, a Vietnamese vowel and tone before NFC composes them).
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;
const STACKED_MARKS = /\p{M}{4,}/u;

/** NFC, curly apostrophes made straight, every run of whitespace one space, trimmed. */
export function normaliseAssistantName(raw: string): string {
  return raw.normalize("NFC").replace(/[‘’ʼ]/g, "'").replace(/\s+/gu, " ").trim();
}

/** Why a (normalised) name cannot be used, in words for the person; null when it can. Lengths count characters. */
export function assistantNameProblem(raw: string): string | null {
  const n = normaliseAssistantName(raw);
  if (!n) return "Give your assistant a name.";
  if ([...n].length > ASSISTANT_NAME_MAX) return `Use ${ASSISTANT_NAME_MAX} characters or fewer.`;
  if (!NAME_CHARS.test(n) || INVISIBLE.test(n) || STACKED_MARKS.test(n) || !/[\p{L}\p{N}]/u.test(n)) return "Use letters, numbers, spaces, apostrophes, hyphens and full stops only.";
  return null;
}

// ---- Reading stored values -----------------------------------------------------------------------------------------

export const isAssistantColour = (v: unknown): v is AssistantColour => (ASSISTANT_COLOURS as readonly unknown[]).includes(v);
export const isAssistantVisor = (v: unknown): v is AssistantVisor => (ASSISTANT_VISORS as readonly unknown[]).includes(v);
export const isAssistantEyes = (v: unknown): v is AssistantEyes => (ASSISTANT_EYES as readonly unknown[]).includes(v);

/** A stored row (or nothing) as a profile: anything missing or unknown falls back to Brenda's. */
export function toProfile(row: { name?: unknown; colour?: unknown; visor?: unknown; eyes?: unknown } | null | undefined): AssistantProfile {
  const name = typeof row?.name === "string" && !assistantNameProblem(row.name) ? normaliseAssistantName(row.name) : DEFAULT_ASSISTANT_NAME;
  return {
    name,
    colour: isAssistantColour(row?.colour) ? row.colour : DEFAULT_LOOK.colour,
    visor: isAssistantVisor(row?.visor) ? row.visor : DEFAULT_LOOK.visor,
    eyes: isAssistantEyes(row?.eyes) ? row.eyes : DEFAULT_LOOK.eyes,
  };
}

export const lookOf = (p: AssistantLook): AssistantLook => ({ colour: p.colour, visor: p.visor, eyes: p.eyes });
export const sameLook = (a: AssistantLook, b: AssistantLook) => a.colour === b.colour && a.visor === b.visor && a.eyes === b.eyes;

/** The CSS custom properties a small face reads for its sphere (inline style on `.brenda-face`). */
export function faceStyle(colour: AssistantColour): Record<"--sphere-hi" | "--sphere-mid" | "--sphere-edge", string> {
  const f = PALETTE[colour].face;
  return { "--sphere-hi": f.hi, "--sphere-mid": f.mid, "--sphere-edge": f.edge };
}
