"use client";

/**
 * The person's permission mode in her box (owner decision, 8 October 2026: "for where we give it task and it always has to
 * ask us to confirm before it proceeds, there should be a setting where we can bypass the permission, you can toggle it
 * on and off, just like the way it is on Claude Code"). Two parts:
 *
 * - `useActMode(orgSlug)`: one store per workspace for the whole page (`useSyncExternalStore`), shared by every box of hers
 *   (Brenda's page, the drawer) and the Permissions card in Settings, so a switch made in one shows in all of them. It
 *   starts from the server's read of the person's mode (`useAssistant().act`, or the page's own read) and takes a newer
 *   one when the server brings it: a refresh, a save's answer, or the mode a chat reply says the server used. A change
 *   shows at once and is saved (PUT /brenda/act-mode); choices made in a burst are saved in order, the last one winning;
 *   a refused save goes back and says why in a toast (the Settings card says it in place instead). Her chat waits for
 *   the save before sending (`settled`), so a message sent right after a switch runs in the mode shown.
 * - `ActModePill`: the chip at the start of the box's trailing actions. "Ask first" (shield, secondary grey) or "Acting
 *   without asking" (a bolt in amber: caution, never orange, with its word; "Auto" below 480px; in the drawer below a
 *   30rem box only the icon, the words for screen readers and in the tooltip). Locked (the workspace turned it off, or
 *   someone else is signed in as the person) it reads "Ask first", changes nothing, and says why in its tooltip and, when
 *   pressed, in a toast. Hidden before migration 0045 (`ready` false). Shift+Tab while typing in the box switches it,
 *   like Claude Code (BrendaComposer listens); a polite status says the new mode at once.
 *
 * The server decides whether anything runs without a Confirm (services/act-decision); this only shows and saves the
 * person's choice.
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Zap } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { notify } from "@/components/ui/toast";
import { useAssistant } from "@/components/app/assistant-context";
import { api, isApiFailure } from "@/lib/api-client";
import { ACT_WORDS, actStateOf, type ActMode, type ActState } from "@/lib/act-mode";
import { cn } from "@/lib/utils";

const W = ACT_WORDS.pill;
const OFFLINE = "Cannot reach the server. Nothing was changed.";

/** What a save came to: saved (with the server's state), refused (its words), or null when a later choice overtook it. */
export type ActModeSaveResult = { ok: true; state: ActState } | { ok: false; message: string } | null;

type Snap = {
  /** The newest state the server gave (the page's read, a save's answer, a chat reply's); null until the first. */
  known: ActState | null;
  /** The mode on its way to the server, shown at once. */
  wanted: ActMode | null;
  saving: boolean;
  /** Said once the server has the new mode (the pill's polite status). */
  said: string;
};
type Entry = {
  snap: Snap;
  /** The page's read last taken in: the same read is not taken twice (a refresh brings a new one). */
  seedKey: string | null;
  saving: number;
  /** Bumped by every choice made here: the last one wins, and a chat reply sent before it does not put the old mode back. */
  rev: number;
  chain: Promise<void>;
  listeners: Set<() => void>;
};

const EMPTY: Snap = { known: null, wanted: null, saving: false, said: "" };
// One per workspace, for the page's lifetime. Only effects and presses change it, never a render, so the server's copy
// of this module stays empty.
const entries = new Map<string, Entry>();

function entryFor(orgSlug: string): Entry {
  let e = entries.get(orgSlug);
  if (!e) { e = { snap: EMPTY, seedKey: null, saving: 0, rev: 0, chain: Promise.resolve(), listeners: new Set() }; entries.set(orgSlug, e); }
  return e;
}

function update(e: Entry, patch: Partial<Snap>) {
  e.snap = { ...e.snap, ...patch, saving: e.saving > 0 };
  for (const l of e.listeners) l();
}

const keyOf = (s: ActState) => `${s.ready ? 1 : 0}:${s.mode}:${s.allowed ? 1 : 0}:${s.effective}:${s.locked ?? ""}`;

/** The server's words for a refusal (4xx, and its "needs a database update"); anything else plainly. */
function failure(err: unknown): string {
  return isApiFailure(err) && (err.error.status < 500 || err.error.code === "NOT_READY") ? err.error.message : OFFLINE;
}

/** The state as shown: the server's, with a choice on its way laid over it (only when the person's choice is in force). */
function shown(base: ActState, wanted: ActMode | null): ActState {
  if (!wanted || !base.ready || base.locked) return base;
  return { ...base, mode: wanted, effective: wanted };
}

/**
 * The person's mode in this workspace, shared by everything on the page that shows or changes it. `initial`: the page's
 * own read (Settings); otherwise the shell's (`useAssistant().act`).
 */
export function useActMode(orgSlug: string, initial?: ActState) {
  const assistants = useAssistant();
  const router = useRouter();
  const seed = initial ?? actStateOf(assistants);
  const store = useMemo(() => {
    const e = entryFor(orgSlug);
    return {
      subscribe: (cb: () => void) => { e.listeners.add(cb); return () => { e.listeners.delete(cb); }; },
      get: () => e.snap,
      /** A newer read from the server (a refresh): taken unless a save is on its way, whose answer is newer still. */
      take: (s: ActState) => {
        const key = keyOf(s);
        if (e.seedKey === key) return;
        e.seedKey = key;
        if (e.saving) return;
        update(e, { known: s });
      },
      /** The mode a chat reply says the server used, unless the person switched since the message left (`since`). */
      seed: (s: ActState, since?: number) => {
        if (e.saving || (since !== undefined && since !== e.rev)) return;
        update(e, { known: s });
      },
      rev: () => e.rev,
      /** Resolves once every save asked for so far has finished (they never reject). */
      settled: () => e.chain,
      set: (mode: ActMode, now: ActState, opts: { quiet?: boolean } = {}): Promise<ActModeSaveResult> => {
        if (!now.ready || now.locked) return Promise.resolve(null);
        const mine = ++e.rev;
        e.saving += 1;
        // Said at once, as the pill changes (review, 8 October 2026: after the save it came 2 to 4 seconds late); a refused
        // save says so in its toast and puts the pill back.
        update(e, { wanted: mode, said: mode === "auto" ? W.announceAuto : W.announceAsk });
        let result: ActModeSaveResult = null;
        const url = `/api/orgs/${orgSlug}/brenda/act-mode`;
        e.chain = e.chain.then(async () => {
          try {
            if (e.rev !== mine) return; // a later choice came before this one's turn: only the last is sent
            try {
              const r = await api<ActState>(url, { method: "PUT", body: { mode }, retries: 0 });
              e.snap = { ...e.snap, known: r };
              if (e.rev !== mine) return;
              result = { ok: true, state: r };
              e.snap = { ...e.snap, wanted: null };
              // The shell reads again what goes with the mode (whether an AI is connected, read only for 'auto'), so the
              // drawer, the line under the box and the pill's tooltip say what holds (review, 8 October 2026).
              router.refresh();
            } catch (err) {
              if (e.rev !== mine) return;
              const message = failure(err);
              result = { ok: false, message };
              // Back at once, with the toast (review, 8 October 2026: it showed the refused mode until the read below).
              update(e, { wanted: null, said: "" });
              if (!opts.quiet) notify(message, { tone: "danger" });
              // What the server holds now (the workspace may have turned it off meanwhile), quietly.
              try { e.snap = { ...e.snap, known: await api<ActState>(url, { retries: 1 }) }; } catch { /* keep what it had */ }
            }
          } finally {
            e.saving -= 1;
            update(e, {});
          }
        });
        return e.chain.then(() => result);
      },
    };
  }, [orgSlug, router]);
  const snap = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);
  // The server's read, taken in when it changes (a refresh after a save, the workspace switching it off).
  useEffect(() => { store.take(seed); }, [store, seed]);

  const state = shown(snap.known ?? seed, snap.wanted);
  const canToggle = state.ready && !state.locked;
  return {
    state,
    /** Whether the person's choice is in force here (ready, not locked): the pill and Shift+Tab switch it. */
    canToggle,
    saving: snap.saving,
    said: snap.said,
    set: (mode: ActMode, opts?: { quiet?: boolean }) => store.set(mode, state, opts),
    toggle: () => {
      if (canToggle) { void store.set(state.mode === "auto" ? "ask" : "auto", state); return; }
      // Locked: say why where it can be seen, on touch too (the tooltip needs a hover; review, 8 October 2026).
      if (state.ready && state.locked) notify(state.locked === "impersonated" ? W.lockedImpersonated : W.lockedWorkspace);
    },
    settled: store.settled,
    seed: store.seed,
    rev: store.rev,
  };
}

export type ActModeControl = ReturnType<typeof useActMode>;

/**
 * The chip in her box. Its name is its words then what a press does ("Acting without asking. Switch to ask first"),
 * built from what shows, so a phone's shorter "Auto" still starts it. No aria-pressed (review, 8 October 2026): the name
 * already changes with the mode, and "pressed" beside "Switch to ask first" said the state twice, confusingly.
 * `compact` (the drawer): inside an `@container`, below 30rem the pill is its icon alone, the words kept for screen
 * readers and in the tooltip, so the box keeps room for its placeholder on a phone (review, 8 October 2026).
 * `ai` false: the person chose 'auto' but no AI is connected, so the built-in helper still asks; the tooltip says so.
 */
export function ActModePill({ control, className, compact = false, ai }: { control: ActModeControl; className?: string; compact?: boolean; ai?: boolean }) {
  const { state, canToggle, toggle, said } = control;
  if (!state.ready) return null;
  const auto = state.effective === "auto";
  const lock = state.locked === "impersonated" ? W.lockedImpersonated : state.locked ? W.lockedWorkspace : null;
  const words = auto ? W.auto : W.ask;
  const label = auto ? W.labelAuto : W.labelAsk;
  // What the name says after the visible words (". Switch to ask first"), or why it cannot be switched.
  const rest = lock ? `. ${lock}` : label.startsWith(words) ? label.slice(words.length) : `. ${label}`;
  const tip = lock ?? (auto && ai === false ? `${W.needsAi}. ${W.labelAuto.slice(W.auto.length + 2)} (${W.shortcut})` : `${label} (${W.shortcut})`);
  // In the drawer below 30rem the words are for screen readers only. On Brenda's page "Auto" below 480px, not the
  // contract's 360px (review, 8 October 2026: measured at 400px, the full words ran into "More asks" on the box's row).
  const full = compact ? "@max-[30rem]:sr-only" : "max-[479px]:hidden";
  const short = compact ? "hidden" : "min-[480px]:hidden";
  return (
    <>
      <button type="button" aria-disabled={canToggle ? undefined : true} aria-keyshortcuts={canToggle ? W.shortcut : undefined}
        data-tip={tip} onClick={() => toggle()}
        className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "gap-1 rounded-full px-2 aria-disabled:pointer-events-auto aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-transparent aria-disabled:hover:text-secondary", className)}>
        {auto ? <Zap className="text-warning" aria-hidden /> : <ShieldCheck aria-hidden />}
        {auto ? (
          <>
            <span className={full}>{W.auto}</span>
            <span className={short}>{W.autoShort}<span className="sr-only">, {W.auto.toLowerCase()}</span></span>
          </>
        ) : <span className={compact ? full : undefined}>{W.ask}</span>}
        <span className="sr-only">{rest}</span>
      </button>
      {/* Beside the button, not in it, so it is not part of the button's name. */}
      <span role="status" aria-live="polite" className="sr-only">{said}</span>
    </>
  );
}
