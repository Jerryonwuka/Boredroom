import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Form controls, v4. Every control is a `.field` (globals.css): h36 r10 px12, transparent, a 10% hairline that goes to
 * 16% on hover; focus turns the border to the foreground with a half-pixel ring; placeholder in the subtle grey; text
 * 14/20 regular. `fieldSize`: `sm` 32px (13px text), `md` 36px (default), `lg` 40px r12 (search and toolbars), `xs`
 * 24px (the trigger inside a FilterControl).
 */
export type FieldSize = "xs" | "sm" | "md" | "lg";
const SIZE: Record<FieldSize, string> = { xs: "field-xs", sm: "field-sm", md: "", lg: "field-lg" };

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { fieldSize?: FieldSize }>(function Input({ className, fieldSize = "md", ...props }, ref) {
  return <input ref={ref} className={cn("field", SIZE[fieldSize], className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn("field", className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { fieldSize?: FieldSize }>(function Select({ className, children, fieldSize = "md", ...props }, ref) {
  return <select ref={ref} className={cn("field", SIZE[fieldSize], className)} {...props}>{children}</select>;
});

/** A field with a prefix or suffix drawn inside it: a currency, a unit, a path, a search icon. */
export const InputAdorned = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, "prefix"> & { prefix?: React.ReactNode; suffix?: React.ReactNode; small?: boolean; fieldSize?: FieldSize }>(function InputAdorned({ className, prefix, suffix, small, fieldSize, ...props }, ref) {
  const size = fieldSize ?? (small ? "sm" : "md");
  return (
    <label className={cn("field field-adorned", SIZE[size], className)}>
      {prefix ? typeof prefix === "string" ? <span>{prefix}</span> : prefix : null}
      <input ref={ref} {...props} />
      {suffix ? typeof suffix === "string" ? <span>{suffix}</span> : suffix : null}
    </label>
  );
});

/** A form label: 14/20 medium in the foreground, 6px above its control. `hint` sits beside it in the secondary grey. */
export function Label({ className, children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: React.ReactNode }) {
  return (
    <label className={cn("mb-1.5 block text-sm font-medium text-foreground", className)} {...props}>
      {children}
      {hint ? <span className="ml-1.5 font-normal text-secondary">{hint}</span> : null}
    </label>
  );
}

/**
 * Label + control + help + inline error. The help line (`description`) and the error are linked to the control through
 * aria-describedby, and the control gets aria-invalid, so screen readers hear them with the field. `hint` is a short
 * aside next to the label ("Optional"). The error line is announced when it appears.
 */
export function Field({ label, htmlFor, error, hint, description, children, className }: { label: React.ReactNode; htmlFor: string; error?: string | string[]; hint?: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const msg = Array.isArray(error) ? error[0] : error;
  const errorId = `${htmlFor}-error`;
  const descId = `${htmlFor}-description`;
  const describedBy = [description ? descId : null, msg ? errorId : null].filter(Boolean).join(" ") || undefined;
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, describedBy ? { ...(msg ? { "aria-invalid": true } : {}), "aria-describedby": describedBy } : {})
    : children;
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} hint={hint}>{label}</Label>
      {control}
      {description ? <p id={descId} className="mt-1.5 text-meta font-normal text-secondary">{description}</p> : null}
      {msg ? <p id={errorId} role="alert" className="mt-1.5 text-meta font-medium text-danger">{msg}</p> : null}
    </div>
  );
}
