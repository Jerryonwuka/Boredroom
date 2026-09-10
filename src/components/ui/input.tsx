import * as React from "react";
import { cn } from "@/lib/utils";

const base = "w-full rounded-xl border border-border-strong bg-inset px-3.5 py-2.5 text-base text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 disabled:opacity-50 aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(base, className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(base, "min-h-24 resize-y", className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return <select ref={ref} className={cn(base, "appearance-none pr-9 bg-[url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23b5b5b5' stroke-width='2'><path d='m6 9 6 6 6-6'/></svg>\")] bg-no-repeat bg-[right_0.9rem_center]", className)} {...props}>{children}</select>;
});

export function Label({ className, children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label className={cn("block text-sm font-semibold text-fg-muted mb-1.5", className)} {...props}>
      {children}
      {hint ? <span className="ml-2 font-normal text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string | string[]; hint?: string; children: React.ReactNode }) {
  const msg = Array.isArray(error) ? error[0] : error;
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} hint={hint}>{label}</Label>
      {children}
      {msg ? <p id={`${htmlFor}-error`} role="alert" className="text-sm text-danger">{msg}</p> : null}
    </div>
  );
}
