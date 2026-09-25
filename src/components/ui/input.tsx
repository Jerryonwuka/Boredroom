import * as React from "react";
import { cn } from "@/lib/utils";

/** Every control is a `.field` (globals.css): inset, hairline brightens on hover, soft grey ring on focus. */
const base = "field";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(base, className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(base, className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...props }, ref) {
  return <select ref={ref} className={cn(base, className)} {...props}>{children}</select>;
});

export function Label({ className, children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: string }) {
  return (
    <label className={cn("block text-sm font-medium text-fg-muted mb-1.5", className)} {...props}>
      {children}
      {hint ? <span className="ml-2 font-normal text-fg-subtle">{hint}</span> : null}
    </label>
  );
}

/**
 * Label + control + inline error. The error is announced and linked to the control (aria-describedby, aria-invalid)
 * so screen readers hear it next to the field, not somewhere else on the page.
 */
export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string | string[]; hint?: string; children: React.ReactNode }) {
  const msg = Array.isArray(error) ? error[0] : error;
  const errorId = `${htmlFor}-error`;
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, msg ? { "aria-invalid": true, "aria-describedby": errorId } : {})
    : children;
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} hint={hint}>{label}</Label>
      {control}
      {msg ? <p id={errorId} role="alert" className="text-sm text-danger">{msg}</p> : null}
    </div>
  );
}
