"use client";

/**
 * The assistant's prompt box (from the owner's ai-prompt-box reference, 24 September 2026), on the design tokens:
 * a rounded box with a growing textarea, a microphone that hands over to dictation, and one round send button that
 * turns orange when there is something to send. The reference's web-search, think and canvas modes and image
 * upload were left out: the assistant has no use for them here. The stylesheet the reference injected into
 * `document` at import time is gone (it broke server rendering); the scrollbar rule lives in globals.css.
 */
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { ArrowUp, Mic, Square, StopCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// ---- Tooltip ----------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;
export const TooltipContent = React.forwardRef<React.ComponentRef<typeof TooltipPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(({ className, sideOffset = 6, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content ref={ref} sideOffset={sideOffset} className={cn("z-[var(--z-toast)] rounded-[10px] border border-border bg-popover px-2.5 py-1.5 text-xs font-medium text-fg shadow-[var(--ring-lift)]", className)} {...props} />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = "TooltipContent";

// ---- Prompt input -----------------------------------------------------------

type PromptInputContextType = { isLoading: boolean; value: string; setValue: (v: string) => void; maxHeight: number; onSubmit?: () => void; disabled?: boolean };
const PromptInputContext = React.createContext<PromptInputContextType>({ isLoading: false, value: "", setValue: () => {}, maxHeight: 200, onSubmit: undefined, disabled: false });
function usePromptInput() { return React.useContext(PromptInputContext); }

export function PromptInput({ className, isLoading = false, maxHeight = 200, value, onValueChange, onSubmit, children, disabled = false }: { className?: string; isLoading?: boolean; maxHeight?: number; value: string; onValueChange: (v: string) => void; onSubmit?: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <TooltipProvider delayDuration={300}>
      <PromptInputContext.Provider value={{ isLoading, value, setValue: onValueChange, maxHeight, onSubmit, disabled }}>
        <div className={cn("rounded-[22px] border border-border bg-[linear-gradient(180deg,var(--surface-top),var(--surface-bottom))] p-2 shadow-[var(--card-shadow)] transition-[border-color,box-shadow] duration-[var(--duration)] focus-within:border-border-strong", className)}>
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipProvider>
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
      className={cn("prompt-scroll flex min-h-[44px] w-full resize-none border-none bg-transparent px-3 py-2.5 text-base text-fg outline-none placeholder:text-fg-subtle focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />
  );
}

export function PromptInputActions({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2", className)} {...props}>{children}</div>;
}

export function PromptInputAction({ tooltip, children, side = "top" }: { tooltip: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  const { disabled } = usePromptInput();
  return (
    <Tooltip>
      <TooltipTrigger asChild disabled={disabled}>{children}</TooltipTrigger>
      <TooltipContent side={side}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

// ---- The box ------------------------------------------------------------------

export interface PromptInputBoxProps {
  value: string;
  onValueChange: (v: string) => void;
  onSend: (message: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
  /** Dictation, owned by the parent: whether the microphone is open, and how to toggle it. Omit to hide the microphone. */
  recording?: boolean;
  onToggleRecording?: () => void;
  recordingSupported?: boolean;
  /** Shown above the textarea while recording (the orb and the status line). */
  recordingView?: React.ReactNode;
  /** Extra controls on the left of the action row (chips, hints). */
  leading?: React.ReactNode;
}

export const PromptInputBox = React.forwardRef<HTMLDivElement, PromptInputBoxProps>(function PromptInputBox({ value, onValueChange, onSend, isLoading = false, placeholder = "Ask anything…", className, recording = false, onToggleRecording, recordingSupported = true, recordingView, leading }, ref) {
  const hasContent = value.trim() !== "";
  const submit = () => { if (hasContent && !isLoading) onSend(value.trim()); };
  const mic = !!onToggleRecording && recordingSupported;
  return (
    <div ref={ref}>
      <PromptInput value={value} onValueChange={onValueChange} isLoading={isLoading} onSubmit={submit} className={cn(recording && "border-accent/60", className)} disabled={isLoading}>
        {recording && recordingView ? <div className="px-1 pb-2">{recordingView}</div> : null}
        <PromptInputTextarea placeholder={recording ? "Listening… your words appear here" : placeholder} aria-label="Ask the assistant" />
        <PromptInputActions className="justify-between px-1 pb-0.5 pt-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {mic ? (
              <PromptInputAction tooltip={recording ? "Stop dictating" : "Dictate"}>
                <button type="button" onClick={onToggleRecording} aria-pressed={recording} aria-label={recording ? "Stop dictating" : "Dictate"} className={cn("grid size-8 place-items-center rounded-full transition-colors duration-[var(--duration-fast)]", recording ? "bg-danger/15 text-danger" : "text-fg-subtle hover:bg-wash hover:text-fg")}>
                  {recording ? <StopCircle className="size-[18px]" aria-hidden /> : <Mic className="size-[18px]" aria-hidden />}
                </button>
              </PromptInputAction>
            ) : null}
            {leading}
          </div>
          <PromptInputAction tooltip={isLoading ? "Thinking" : hasContent ? "Send" : "Type or dictate first"}>
            <button type="button" onClick={submit} disabled={isLoading || !hasContent} aria-label="Send" className={cn("grid size-8 place-items-center rounded-full transition-[background-color,color,box-shadow,transform] duration-[var(--duration-fast)] disabled:cursor-not-allowed", hasContent && !isLoading ? "bg-accent hover:bg-[var(--accent-hover)] text-accent-fg hover:scale-105" : "bg-wash text-fg-subtle")}>
              {isLoading ? <Square className="size-3.5 animate-pulse fill-current" aria-hidden /> : <ArrowUp className="size-4" aria-hidden />}
            </button>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>
    </div>
  );
});
