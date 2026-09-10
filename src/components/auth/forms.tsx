"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { api, isApiFailure } from "@/lib/api-client";

type Errors = Record<string, string[]>;

function useSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    setPending(true); setError(null); setFieldErrors({});
    try { return await fn(); }
    catch (err) {
      if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); }
      else setError("Cannot reach the server. Check your connection and try again.");
      return null;
    } finally { setPending(false); }
  }
  return { pending, error, fieldErrors, run };
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const r = await run(() => api<{ next: string }>("/api/auth/login", { method: "POST", body: { email: f.get("email"), password: f.get("password"), next }, retries: 0 }));
      if (r) router.push(r.next);
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" htmlFor="password" error={fieldErrors.password}><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
      <p className="text-center text-sm text-fg-muted"><Link className="underline hover:text-fg" href="/recover">Forgot your password?</Link></p>
    </form>
  );
}

export function SignupForm({ next }: { next?: string }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const r = await run(() => api<{ next: string }>("/api/auth/signup", { method: "POST", body: { displayName: f.get("displayName"), email: f.get("email"), password: f.get("password") }, retries: 0 }));
      if (r) router.push(next ? `${r.next}?next=${encodeURIComponent(next)}` : r.next);
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Your name" htmlFor="displayName" error={fieldErrors.displayName}><Input id="displayName" name="displayName" autoComplete="name" required maxLength={120} /></Field>
      <Field label="Work email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" htmlFor="password" hint="at least 10 characters" error={fieldErrors.password}><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Creating account…" : "Create account"}</Button>
    </form>
  );
}

export function RecoverForm() {
  const { pending, error, fieldErrors, run } = useSubmit();
  const [done, setDone] = useState(false);
  if (done) return <Alert tone="success" title="Check your email">If an account exists for that address, a reset link is on its way. It expires in 60 minutes.</Alert>;
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const r = await run(() => api("/api/auth/recover", { method: "POST", body: { email: f.get("email") }, retries: 0 }));
      if (r) setDone(true);
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="Email" htmlFor="email" error={fieldErrors.email}><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</Button>
    </form>
  );
}

export function ResetForm({ token }: { token: string }) {
  const router = useRouter();
  const { pending, error, fieldErrors, run } = useSubmit();
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const r = await run(() => api("/api/auth/reset", { method: "POST", body: { token, password: f.get("password") }, retries: 0 }));
      if (r) router.push("/login?reset=1");
    }}>
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="New password" htmlFor="password" hint="at least 10 characters" error={fieldErrors.password}><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} /></Field>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>{pending ? "Saving…" : "Set new password"}</Button>
    </form>
  );
}

export function VerifyButton({ token }: { token: string }) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button size="lg" className="w-full" disabled={pending} onClick={async () => {
        const r = await run(() => api("/api/auth/verify", { method: "POST", body: { token }, retries: 0 }));
        if (r) router.push("/app?verified=1");
      }}>{pending ? "Verifying…" : "Confirm my email"}</Button>
    </div>
  );
}

export function ResendVerification() {
  const { pending, error, run } = useSubmit();
  const [sent, setSent] = useState(false);
  return (
    <div className="space-y-3">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {sent ? <Alert tone="success">A new verification email was sent.</Alert> : null}
      <Button variant="outline" className="w-full" disabled={pending || sent} onClick={async () => { const r = await run(() => api("/api/auth/resend-verification", { method: "POST", retries: 0 })); if (r) setSent(true); }}>Resend verification email</Button>
    </div>
  );
}

export function AcceptInvitation({ token, orgName }: { token: string; orgName: string }) {
  const router = useRouter();
  const { pending, error, run } = useSubmit();
  return (
    <div className="space-y-4">
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Button size="lg" className="w-full" disabled={pending} onClick={async () => {
        const r = await run(() => api<{ orgSlug: string }>("/api/invitations/accept", { method: "POST", body: { token }, retries: 0 }));
        if (r) router.push(`/app/${r.orgSlug}/policy?welcome=1`);
      }}>{pending ? "Joining…" : `Join ${orgName}`}</Button>
    </div>
  );
}

export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  return <Button variant="ghost" size="sm" className={className} onClick={async () => { await api("/api/auth/logout", { method: "POST", retries: 0 }); router.push("/login"); router.refresh(); }}>Sign out</Button>;
}
