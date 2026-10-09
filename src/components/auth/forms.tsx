"use client";

import { forwardRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { AUTH_LINK } from "@/components/auth/auth-shell";
import { safeNextPath } from "@/components/auth/next-path";

type Errors = Record<string, string[]>;
type Failure = { message: string; code?: string };

/**
 * One submit for every form on the way in. The control stays busy from the press until the next page has arrived
 * (a success that navigates cannot be sent twice), field errors land beside their fields with the cursor in the
 * first, and a failure says what went wrong.
 */
export function useSubmit() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [navigating, startNavigation] = useTransition();
  const [error, setError] = useState<Failure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  function markFields(form: HTMLFormElement | null, errors: Errors) {
    setFieldErrors(errors);
    const first = Object.keys(errors)[0];
    if (form && first) form.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
  }
  /** The check before sending failed: the fields say why, and an older failure from the server goes away. */
  function showFieldErrors(form: HTMLFormElement | null, errors: Errors) { setError(null); markFields(form, errors); }
  async function run<T>(fn: () => Promise<T>, form?: HTMLFormElement | null): Promise<T | null> {
    setBusy(true); setError(null); setFieldErrors({});
    try { return await fn(); }
    catch (err) {
      if (isApiFailure(err)) { setError({ message: err.error.message, code: err.error.code }); markFields(form ?? null, err.error.fieldErrors ?? {}); }
      else setError({ message: "Cannot reach the server. Check your connection and try again." });
      return null;
    } finally { setBusy(false); }
  }
  function go(href: string) { startNavigation(() => router.push(href)); }
  return { pending: busy || navigating, error, fieldErrors, run, go, showFieldErrors };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
type Rule = (value: string) => string | null;
const email: Rule = (raw) => { const v = raw.trim(); return !v ? "Enter your email address." : EMAIL.test(v) ? null : "Enter an email address like name@company.com."; };
const newPassword: Rule = (v) => (!v ? "Choose a password." : v.length < 10 ? "Use at least 10 characters." : v.length > 200 ? "Use 200 characters or fewer." : null);

/**
 * Checks a form before it is sent, so a mistake shows beside its field in plain words rather than as a browser bubble.
 * Rules get the value as typed (a password keeps its spaces); a rule trims what it should.
 */
export function check(form: HTMLFormElement, rules: Record<string, Rule>): Errors | null {
  const data = new FormData(form);
  const errors: Errors = {};
  for (const [name, rule] of Object.entries(rules)) {
    const message = rule(String(data.get(name) ?? ""));
    if (message) errors[name] = [message];
  }
  return Object.keys(errors).length ? errors : null;
}

/**
 * A 40px password box with a show and hide switch inside it (a 32px ghost icon button, 4px from the right edge), so
 * people on phones can check what they typed.
 */
const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PasswordInput({ className, ...props }, ref) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input ref={ref} fieldSize="lg" {...props} type={shown ? "text" : "password"} className={cn("pr-11 pointer-coarse:pr-12", className)} />
      <IconButton aria-label={shown ? "Hide password" : "Show password"} aria-controls={props.id} onClick={() => setShown((s) => !s)}
        className="absolute right-1 top-1/2 -translate-y-1/2 pointer-coarse:right-0">
        {shown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </IconButton>
    </div>
  );
});

/* Every entry form: fields 16px apart, the full-width 40px primary button 24px below the last one. */
const FORM = "flex flex-col gap-4";
const SUBMIT = "mt-2 w-full";

/* People who sign up from a join link confirm their email in a new tab; the link in that email cannot carry where
   they were going, so this browser remembers it for a day and the confirmation page picks it up. */
const AFTER_VERIFY_KEY = "boredroom-after-verify";
function rememberAfterVerify(next: string) {
  try { localStorage.setItem(AFTER_VERIFY_KEY, JSON.stringify({ next, at: Date.now() })); } catch { /* private mode: the workspace list still offers the code */ }
}
function takeAfterVerify(): string | null {
  try {
    const raw = localStorage.getItem(AFTER_VERIFY_KEY);
    localStorage.removeItem(AFTER_VERIFY_KEY);
    const saved = raw ? (JSON.parse(raw) as { next?: string; at?: number }) : null;
    return saved?.next && saved.at && Date.now() - saved.at < 86_400_000 ? safeNextPath(saved.next, "") || null : null;
  } catch { return null; }
}

// Every form here is `method="post"`: before the page's script runs (slow or blocked JavaScript), pressing Enter submits
// natively, and a GET would put the email and the password in the address bar, the history and the server logs (fix
// review, 9 October 2026). A POST keeps them in the body; the page then simply loads again.
export function LoginForm({ next, email: knownEmail }: { next?: string; email?: string }) {
  const { pending, error, fieldErrors, run, go, showFieldErrors } = useSubmit();
  return (
    <form className={FORM} method="post" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const errors = check(form, { email, password: (v) => (v ? null : "Enter your password.") });
      if (errors) return showFieldErrors(form, errors);
      const f = new FormData(form);
      const safe = next ? safeNextPath(next) : undefined;
      const r = await run(() => api<{ next: string }>("/api/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password"), next: safe }, retries: 0 }), form);
      if (!r) return;
      // An unconfirmed email is sent to the verification page; it carries the join link on, so nothing is lost.
      go(r.next === "/verify/pending" && safe ? `/verify/pending?next=${encodeURIComponent(safe)}` : safeNextPath(r.next));
    }}>
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      <Field label="Email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" fieldSize="lg" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} defaultValue={knownEmail} placeholder="name@company.com" required /></Field>
      {/* "Forgot password?" sits on the label's line, right-aligned; in the tab order it follows the password box. */}
      <div className="relative">
        <Field label="Password" htmlFor="password" error={fieldErrors.password}><PasswordInput id="password" name="password" autoComplete="current-password" required /></Field>
        <Link href="/recover" className="absolute right-0 top-0 rounded-[4px] text-meta font-normal text-secondary transition-colors duration-75 hover:text-foreground">Forgot password?</Link>
      </div>
      <Button type="submit" size="lg" className={SUBMIT} loading={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}

export function SignupForm({ next, email: knownEmail }: { next?: string; email?: string }) {
  const { pending, error, fieldErrors, run, go, showFieldErrors } = useSubmit();
  const safe = next ? safeNextPath(next, "") : "";
  return (
    <form className={FORM} method="post" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const errors = check(form, { displayName: (v) => (v.trim() ? null : "Enter your name."), email, password: newPassword });
      if (errors) return showFieldErrors(form, errors);
      const f = new FormData(form);
      const r = await run(() => api<{ next: string }>("/api/auth/signup", { method: "POST", body: { displayName: f.get("displayName"), email: f.get("email"), password: f.get("password") }, retries: 0 }), form);
      if (!r) return;
      if (safe) rememberAfterVerify(safe);
      go(safe ? `${r.next}?next=${encodeURIComponent(safe)}` : r.next);
    }}>
      {error ? (
        <Alert tone="danger">
          {error.message}
          {error.code === "EMAIL_TAKEN" ? <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1"><Link className={AUTH_LINK} href={safe ? `/login?next=${encodeURIComponent(safe)}` : "/login"}>Sign in</Link><Link className={AUTH_LINK} href="/recover">Reset your password</Link></span> : null}
        </Alert>
      ) : null}
      <Field label="Your name" htmlFor="displayName" error={fieldErrors.displayName}><Input id="displayName" name="displayName" fieldSize="lg" autoComplete="name" required maxLength={120} /></Field>
      <Field label="Work email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" fieldSize="lg" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} defaultValue={knownEmail} placeholder="name@company.com" required /></Field>
      <Field label="Password" htmlFor="password" description="At least 10 characters." error={fieldErrors.password}><PasswordInput id="password" name="password" autoComplete="new-password" required minLength={10} maxLength={200} /></Field>
      <Button type="submit" size="lg" className={SUBMIT} loading={pending}>{pending ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}

export function RecoverForm() {
  const { pending, error, fieldErrors, run, showFieldErrors } = useSubmit();
  const [sentTo, setSentTo] = useState<string | null>(null);
  if (sentTo) {
    return (
      <div className="flex flex-col gap-4">
        <Alert tone="success" title="Check your email">If an account exists for {sentTo}, a reset link is on its way. It works once and expires in 60 minutes.</Alert>
        <Button variant="outline" size="lg" className="w-full" onClick={() => setSentTo(null)}>Use a different email</Button>
      </div>
    );
  }
  return (
    <form className={FORM} method="post" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const errors = check(form, { email });
      if (errors) return showFieldErrors(form, errors);
      const address = String(new FormData(form).get("email")).trim();
      const r = await run(() => api("/api/auth/recover", { method: "POST", body: { email: address }, retries: 0 }), form);
      if (r) setSentTo(address);
    }}>
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      <Field label="Email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" fieldSize="lg" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="name@company.com" required /></Field>
      <Button type="submit" size="lg" className={SUBMIT} loading={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const { pending, error, fieldErrors, run, go, showFieldErrors } = useSubmit();
  return (
    <form className={FORM} method="post" noValidate onSubmit={async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const errors = check(form, { password: newPassword });
      if (errors) return showFieldErrors(form, errors);
      const f = new FormData(form);
      const r = await run(() => api("/api/auth/reset", { method: "POST", body: { token, password: f.get("password") }, retries: 0 }), form);
      if (r) go("/login?reset=1");
    }}>
      {error ? (
        <Alert tone="danger">
          {error.message}
          {error.code === "TOKEN_INVALID" ? <span className="mt-2 block"><Link className={AUTH_LINK} href="/recover">Send a new reset link</Link></span> : null}
        </Alert>
      ) : null}
      <Field label="New password" htmlFor="password" description="At least 10 characters." error={fieldErrors.password}><PasswordInput id="password" name="password" autoComplete="new-password" required minLength={10} maxLength={200} autoFocus /></Field>
      <Button type="submit" size="lg" className={SUBMIT} loading={pending}>{pending ? "Saving…" : "Set new password"}</Button>
    </form>
  );
}

export function VerifyButton({ token }: { token: string }) {
  const { pending, error, run, go } = useSubmit();
  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert tone="danger">
          {error.message}
          {error.code === "TOKEN_INVALID" ? <span className="mt-2 block">Sign in and send a new link from the <Link className={AUTH_LINK} href="/verify/pending">verification page</Link>.</span> : null}
        </Alert>
      ) : null}
      <Button size="lg" className="w-full" loading={pending} onClick={async () => {
        const r = await run(() => api("/api/auth/verify", { method: "POST", body: { token }, retries: 0 }));
        if (r) go(takeAfterVerify() ?? "/app?verified=1");
      }}>{pending ? "Confirming…" : "Confirm my email"}</Button>
    </div>
  );
}

export function ResendVerification() {
  const { pending, error, run } = useSubmit();
  const [sent, setSent] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      {error ? <Alert tone="danger">{error.message}</Alert> : null}
      {sent ? <Alert tone="success">A new verification email is on its way. It can take a minute to arrive; check your spam folder too.</Alert> : null}
      <Button variant="outline" size="lg" className="w-full" loading={pending} disabled={sent} onClick={async () => { const r = await run(() => api("/api/auth/resend-verification", { method: "POST", retries: 0 })); if (r) setSent(true); }}>
        {pending ? "Sending…" : sent ? "Email sent" : "Resend verification email"}
      </Button>
    </div>
  );
}

export function AcceptInvitation({ token, orgName, orgSlug }: { token: string; orgName: string; orgSlug: string }) {
  const { pending, error, run, go } = useSubmit();
  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <Alert tone="danger">
          {error.message}
          {error.code === "ALREADY_MEMBER" ? <span className="mt-2 block"><Link className={AUTH_LINK} href={`/app/${orgSlug}`}>Open {orgName}</Link></span> : null}
        </Alert>
      ) : null}
      <Button size="lg" className="w-full" loading={pending} onClick={async () => {
        const r = await run(() => api<{ orgSlug: string }>("/api/invitations/accept", { method: "POST", body: { token }, retries: 0 }));
        if (r) go(`/app/${r.orgSlug}/home`); // straight in: no policy step (owner decision, 5 October 2026)
      }}>{pending ? "Joining…" : `Join ${orgName}`}</Button>
    </div>
  );
}

/** Signs out and goes to `to` (sign in by default; back to the same invitation when switching accounts). A ghost button. */
export function SignOutButton({ className, to = "/login", size = "md" }: { className?: string; to?: string; size?: ButtonProps["size"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      {failed ? <span role="alert" className="text-meta font-normal text-danger">Could not sign out. Try again.</span> : null}
      <Button variant="ghost" size={size} className={className} disabled={busy} onClick={async () => {
        setBusy(true); setFailed(false);
        try { await api("/api/auth/logout", { method: "POST", retries: 0 }); router.push(to); router.refresh(); }
        catch { setFailed(true); setBusy(false); }
      }}>{busy ? "Signing out…" : "Sign out"}</Button>
    </span>
  );
}
