"use client";

/**
 * The prompt box (from the owner's ai-prompt-box reference, 24 September 2026), v4: the home prompt pill measured from
 * the ElevenLabs app (6 October 2026). Min-height 52, r26, fill-1 laid solid over the canvas (so messages never show
 * through when it docks over a chat), a 7.5% ring and the natural shadow; 16/24 text; round 36px actions: an optional
 * `leading` slot on the left (a "+"), and on the right an optional `trailing` slot (a small badge chip), the microphone
 * (ghost) and Send (the white primary with a near-black arrow, grey while there is nothing to send). The textarea grows
 * to `maxHeight` and the actions stay on its last line. Enter sends, Shift+Enter breaks the line.
 *
 * While dictating, the notch's voice card sits above the text, inside the pill (owner decision, 5 October 2026;
 * VoiceCapture). The page-wide tooltip layer labels the microphone and Send from their accessible names.
 */
import * as React from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import { VoiceCapture } from "@/components/app/voice-capture";
import { cn } from "@/lib/utils";

// ---- Prompt input -----------------------------------------------------------

type PromptInputContextType = { isLoading: boolean; value: string; setValue: (v: string) => void; maxHeight: number; onSubmit?: () => void; disabled?: boolean };
const PromptInputContext = React.createContext<PromptInputContextType>({ isLoading: false, value: "", setValue: () => {}, maxHeight: 200, onSubmit: undefined, disabled: false });
function usePromptInput() { return React.useContext(PromptInputContext); }

export function PromptInput({ className, isLoading = false, maxHeight = 200, value, onValueChange, onSubmit, children, disabled = false }: { className?: string; isLoading?: boolean; maxHeight?: number; value: string; onValueChange: (v: string) => void; onSubmit?: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <PromptInputContext.Provider value={{ isLoading, value, setValue: onValueChange, maxHeight, onSubmit, disabled }}>
      <div className={cn("w-full rounded-[26px] bg-surface shadow-[0_0_0_1px_var(--border),var(--elev-natural-xs)] transition-shadow duration-150 focus-within:shadow-[0_0_0_1px_var(--border-input-hover),var(--elev-natural-xs)]", className)}>
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
}

export const PromptInputBox = React.forwardRef<HTMLDivElement, PromptInputBoxProps>(function PromptInputBox({ value, onValueChange, onSend, isLoading = false, placeholder = "Ask anything…", className, label = "Message Brenda", recording = false, onToggleRecording, recordingSupported = true, transcribing = false, recordingHint, recordingHeard, onCancelRecording, recordingView, recordingPlaceholder = "Listening… your words appear here", leading, trailing, maxHeight = 200 }, ref) {
  // While dictating (or writing the words out), Send is allowed with an empty box: the parent waits for the words and sends them.
  const hasContent = value.trim() !== "" || recording || transcribing;
  const submit = () => { if (hasContent && !isLoading) onSend(value.trim()); };
  const mic = !!onToggleRecording && recordingSupported;
  const voice = recording && recordingView ? recordingView
    : recording || transcribing ? <VoiceCapture compact phase={recording ? "listening" : "working"} hint={recordingHint} heard={recordingHeard} onCancel={onCancelRecording} />
    : null;
  return (
    <div ref={ref} className="w-full">
      <PromptInput value={value} onValueChange={onValueChange} isLoading={isLoading} onSubmit={submit} maxHeight={maxHeight} className={cn(recording && "shadow-[0_0_0_1px_var(--ring),var(--elev-natural-xs)] focus-within:shadow-[0_0_0_1px_var(--ring),var(--elev-natural-xs)]", className)} disabled={isLoading}>
        {voice ? <div className="px-2 pt-2">{voice}</div> : null}
        <div className="flex items-end gap-1 p-2">
          {leading ? <PromptInputActions className="shrink-0">{leading}</PromptInputActions> : null}
          <PromptInputTextarea placeholder={recording ? recordingPlaceholder : placeholder} aria-label={label} className={leading ? "pl-1" : "pl-3"} />
          <PromptInputActions className="shrink-0">
            {trailing ? <div className="mr-1 flex items-center gap-1 self-center">{trailing}</div> : null}
            {mic ? (
              <button type="button" onClick={onToggleRecording} disabled={transcribing} aria-pressed={recording} aria-label={recording ? "Stop dictating" : "Dictate"}
                className={cn("grid size-9 place-items-center rounded-full transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed disabled:opacity-50",
                  recording ? "bg-danger/15 text-danger hover:bg-danger/20" : "text-secondary hover:bg-fill-1 hover:text-foreground")}>
                {recording ? <Square className="size-3.5 fill-current" aria-hidden /> : <Mic className="size-[18px]" aria-hidden />}
              </button>
            ) : null}
            {/* The tooltip layer reads the accessible name; `data-tip` says more while dictating, where Send also stops the microphone. */}
            <button type="button" onClick={submit} disabled={isLoading || !hasContent} aria-label="Send" data-tip={recording ? "Stop dictating and send" : undefined}
              className={cn("grid size-9 place-items-center rounded-full transition-colors duration-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] disabled:cursor-not-allowed",
                hasContent && !isLoading ? "bg-primary text-primary-fg hover:bg-primary-hover" : "bg-fill-150 text-subtle")}>
              {isLoading ? <Square className="size-3 animate-pulse fill-current" aria-hidden /> : <ArrowUp className="size-[18px]" strokeWidth={2.25} aria-hidden />}
            </button>
          </PromptInputActions>
        </div>
      </PromptInput>
    </div>
  );
});
