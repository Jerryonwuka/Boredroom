"use client";

/**
 * The prompt box (from the owner's ai-prompt-box reference, 24 September 2026), v4: the home prompt pill measured from
 * the ElevenLabs app (6 October 2026). Min-height 52, r26, fill-1 laid solid over the canvas (so messages never show
 * through when it docks over a chat), a 7.5% ring and the natural shadow; 16/24 text; round 36px actions: an optional
 * `leading` slot on the left (a "+"), and on the right an optional `trailing` slot (a small badge chip), the microphone
 * (ghost) and Send. The textarea grows to `maxHeight` and the actions stay on its last line. Enter sends, Shift+Enter
 * breaks the line.
 *
 * Accent rules (owner decision, 6 October 2026): while the pill has focus its 1px ring turns orange (--accent-ring);
 * Send is orange with a near-black arrow when there is something to send (the screen's standout action), grey when the
 * box is empty or a reply is on its way. While dictating (live) the ring stays orange and the microphone becomes an
 * orange stop square on a quiet grey disc, so the one solid orange button is still Send.
 *
 * While dictating, the notch's voice card sits above the text, inside the pill (owner decision, 5 October 2026;
 * VoiceCapture). The page-wide tooltip layer labels the microphone and Send from their accessible names.
 *
 * `variant="hero"` is Brenda's home box (owner decision, 7 October 2026: her home "just like" the reference AI chat
 * home, in our orange): r16, a 1px orange-tinted hairline with a faint orange glow inside it, translucent over her home
 * panel's glow (globals.css `.prompt-hero`); her glyph in orange at the top left, then the text with room for two or
 * three lines; on a bottom row, `leading` as ghost text actions on the left (`PromptTextAction`: "More asks") and the
 * round microphone and Send on the right. `size="sm"` is the same box docked under her chat: one line to start, 32px
 * actions, and solid (`--surface`) so the conversation never shows through. Same props, dictation and voice card.
 */
import * as React from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { VoiceCapture } from "@/components/app/voice-capture";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---- Prompt input -----------------------------------------------------------

type PromptInputContextType = { isLoading: boolean; value: string; setValue: (v: string) => void; maxHeight: number; onSubmit?: () => void; disabled?: boolean };
const PromptInputContext = React.createContext<PromptInputContextType>({ isLoading: false, value: "", setValue: () => {}, maxHeight: 200, onSubmit: undefined, disabled: false });
function usePromptInput() { return React.useContext(PromptInputContext); }

export function PromptInput({ className, isLoading = false, maxHeight = 200, value, onValueChange, onSubmit, children, disabled = false }: { className?: string; isLoading?: boolean; maxHeight?: number; value: string; onValueChange: (v: string) => void; onSubmit?: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <PromptInputContext.Provider value={{ isLoading, value, setValue: onValueChange, maxHeight, onSubmit, disabled }}>
      <div className={cn("w-full rounded-[26px] bg-surface shadow-[0_0_0_1px_var(--border),var(--elev-natural-xs)] transition-shadow duration-150 focus-within:shadow-[0_0_0_1px_var(--accent-ring),var(--elev-natural-xs)]", className)}>
        {children}
      </div>
    </PromptInputContext.Provider>
  );
}

export function PromptInputTextarea({ className, onKeyDown, placeholder, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight]);
  return (
    <textarea ref={ref} rows={1} value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled} placeholder={placeholder}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit?.(); } onKeyDown?.(e); }}
      className={cn("prompt-scroll block min-h-9 w-full resize-none border-none bg-transparent py-1.5 text-base font-normal text-foreground outline-none placeholder:text-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60", className)} {...props} />
  );
}

export function PromptInputActions({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-1", className)} {...props}>{children}</div>;
}

/** A round 36px ghost action for the pill (the "+", a mode button). Needs an aria-label. */
export const PromptAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { "aria-label": string }>(function PromptAction({ className, type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={cn("grid size-9 shrink-0 place-items-center rounded-full text-secondary transition-colors duration-75 hover:bg-fill-1 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-[18px]", className)} {...props} />;
});

/** A ghost text action with its icon for the hero box's bottom row ("More asks"): 32px, 13px medium, secondary grey. */
export const PromptTextAction = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(function PromptTextAction({ className, type = "button", ...props }, ref) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-lg px-2", className)} {...props} />;
});

// ---- The box ------------------------------------------------------------------

export interface PromptInputBoxProps {
  value: string;
  onValueChange: (v: string) => void;
  onSend: (message: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  /** The textarea's accessible name. */
  label?: string;
  /** Dictation, owned by the parent: whether the microphone is open, and how to toggle it. Omit to hide the microphone. */
  recording?: boolean;
  onToggleRecording?: () => void;
  recordingSupported?: boolean;
  /** True while the speech is being written out after Stop: the voice card shows "Getting your words…". */
  transcribing?: boolean;
  /** The line under the voice card's title (what to do next, the engine, a download's progress). */
  recordingHint?: React.ReactNode;
  /** The words heard so far, in italic quotes on the voice card. */
  recordingHeard?: string | null;
  /** Gives a Cancel button to the voice card: discard the dictation, or stop writing it out. */
  onCancelRecording?: () => void;
  /** Replaces the voice card above the textarea while recording. */
  recordingView?: React.ReactNode;
  /** The textarea's placeholder while recording (on-device dictation writes the words out only when it stops). */
  recordingPlaceholder?: string;
  /** Round actions on the left of the text (a PromptAction "+"). */
  leading?: React.ReactNode;
  /** Small things on the right, before the microphone (a 20px badge chip). */
  trailing?: React.ReactNode;
  /** The textarea's growth limit in px (200 by default). */
  maxHeight?: number;
  /** "pill" (default): the r26 pill with its round actions on one line (the drawer). "hero": Brenda's home box (see above). */
  variant?: "pill" | "hero";
  /** The hero box's size: "md" on her home screen, "sm" docked under her chat (solid, one line to start). */
  size?: "md" | "sm";
}

export const PromptInputBox = React.forwardRef<HTMLDivElement, PromptInputBoxProps>(function PromptInputBox({ value, onValueChange, onSend, isLoading = false, placeholder = "Ask anything…", className, label = "Message Brenda", recording = false, onToggleRecording, recordingSupported = true, transcribing = false, recordingHint, recordingHeard, onCancelRecording, recordingView, recordingPlaceholder = "Listening… your words appear here", leading, trailing, maxHeight = 200, variant = "pill", size = "md" }, ref) {
  // While dictating (or writing the words out), Send is allowed with an empty box: the parent waits for the words and sends them.
  const hasContent = value.trim() !== "" || recording || transcribing;
  const submit = () => { if (hasContent && !isLoading) onSend(value.trim()); };
  const mic = !!onToggleRecording && recordingSupported;
  const hero = variant === "hero";
  const voice = recording && recordingView ? recordingView
    : recording || transcribing ? <VoiceCapture compact phase={recording ? "listening" : "working"} hint={recordingHint} heard={recordingHeard} onCancel={onCancelRecording} className={hero ? "rounded-[10px]" : undefined} />
    : null;

  if (hero) {
    const sm = size === "sm";
    const round = cn("grid shrink-0 place-items-center rounded-full transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] pointer-coarse:size-10", sm ? "size-8 [&_svg]:size-4" : "size-9 [&_svg]:size-[18px]");
    return (
      <div ref={ref} className="w-full">
        <PromptInputContext.Provider value={{ isLoading, value, setValue: onValueChange, maxHeight, onSubmit: submit, disabled: isLoading }}>
          {/* A press on the box's own blank space (beside her glyph, between the actions) puts the cursor in the text. */}
          <div data-recording={recording || undefined} className={cn("prompt-hero", sm && "prompt-hero-sm", className)}
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest("button, a, textarea, input, [role=menu]")) return;
              const field = e.currentTarget.querySelector("textarea");
              if (field && !field.disabled) { e.preventDefault(); field.focus(); }
            }}>
            {voice ? <div className="px-2 pt-2">{voice}</div> : null}
            <div className={cn("flex items-start", sm ? "gap-2.5 px-3 pt-3" : "gap-3 px-4 pt-4")}>
              <BrendaGlyph aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
              <PromptInputTextarea placeholder={recording ? recordingPlaceholder : placeholder} aria-label={label}
                className={cn("py-0", sm ? "min-h-6" : "min-h-12 sm:min-h-[72px]")} />
            </div>
            <div className={cn("flex items-center gap-1", sm ? "px-2 pb-2 pt-1" : "px-3 pb-3 pt-2")}>
              {leading ? <div className="flex min-w-0 items-center gap-0.5">{leading}</div> : null}
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {trailing ? <div className="mr-1 flex items-center gap-1">{trailing}</div> : null}
                {mic ? (
                  <button type="button" onClick={onToggleRecording} disabled={transcribing} aria-pressed={recording} aria-label={recording ? "Stop dictating" : "Dictate"}
                    className={cn(round, "disabled:cursor-not-allowed disabled:opacity-50", recording ? "bg-fill-150 text-accent" : "bg-fill-1 text-secondary hover:bg-fill-150 hover:text-foreground")}>
                    {recording ? <Square className="!size-3.5 fill-current" aria-hidden /> : <Mic aria-hidden />}
                  </button>
                ) : null}
                <button type="button" onClick={submit} disabled={isLoading || !hasContent} aria-label="Send" data-tip={recording ? "Stop dictating and send" : undefined}
                  className={cn(round, "disabled:cursor-not-allowed", hasContent && !isLoading ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-fill-150 text-subtle")}>
                  {isLoading ? <Square className="!size-3 animate-pulse fill-current" aria-hidden /> : <ArrowUp strokeWidth={2.25} aria-hidden />}
                </button>
              </div>
            </div>
          </div>
        </PromptInputContext.Provider>
      </div>
    );
  }

  return (
    <div ref={ref} className="w-full">
      <PromptInput value={value} onValueChange={onValueChange} isLoading={isLoading} onSubmit={submit} maxHeight={maxHeight} className={cn(recording && "shadow-[0_0_0_1px_var(--accent-ring),var(--elev-natural-xs)] focus-within:shadow-[0_0_0_1px_var(--accent-ring),var(--elev-natural-xs)]", className)} disabled={isLoading}>
        {voice ? <div className="px-2 pt-2">{voice}</div> : null}
        <div className="flex items-end gap-1 p-2">
          {leading ? <PromptInputActions className="shrink-0">{leading}</PromptInputActions> : null}
          <PromptInputTextarea placeholder={recording ? recordingPlaceholder : placeholder} aria-label={label} className={leading ? "pl-1" : "pl-3"} />
          <PromptInputActions className="shrink-0">
            {trailing ? <div className="mr-1 flex items-center gap-1 self-center">{trailing}</div> : null}
            {mic ? (
              <button type="button" onClick={onToggleRecording} disabled={transcribing} aria-pressed={recording} aria-label={recording ? "Stop dictating" : "Dictate"}
                className={cn("grid size-9 place-items-center rounded-full transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
                  recording ? "bg-fill-1 text-accent hover:bg-fill-150" : "text-secondary hover:bg-fill-1 hover:text-foreground")}>
                {recording ? <Square className="size-3.5 fill-current" aria-hidden /> : <Mic className="size-[18px]" aria-hidden />}
              </button>
            ) : null}
            {/* The tooltip layer reads the accessible name; `data-tip` says more while dictating, where Send also stops the microphone. */}
            <button type="button" onClick={submit} disabled={isLoading || !hasContent} aria-label="Send" data-tip={recording ? "Stop dictating and send" : undefined}
              className={cn("grid size-9 place-items-center rounded-full transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed",
                hasContent && !isLoading ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-fill-150 text-subtle")}>
              {isLoading ? <Square className="size-3 animate-pulse fill-current" aria-hidden /> : <ArrowUp className="size-[18px]" strokeWidth={2.25} aria-hidden />}
            </button>
          </PromptInputActions>
        </div>
      </PromptInput>
    </div>
  );
});
