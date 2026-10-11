"use client";

/**
 * "This is you" (owner request, 11 October 2026: "where they can set their names, images, choose settings"; contract 5.2).
 * Already filled in: their name as they gave it, the photo their Google account brought (said so), the theme this device
 * shows. The name is saved on Continue (only when it changed); a photo uploads the moment it is chosen, redrawn first as
 * a 512px square without its location (lib/avatar-image), and Remove takes it off at once; the theme changes the page at
 * once and stays on this device. Their assistant watches the name being typed and is pleased by a new photo or theme.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { applyTheme, useTheme, type Theme } from "@/components/ui/theme-toggle";
import { StepFrame } from "@/components/app/welcome/step-frame";
import { api, isApiFailure } from "@/lib/api-client";
import { AVATAR_INPUT_MAX, AVATAR_UPLOAD_MAX, avatarUpload, isAvatarType } from "@/lib/avatar-image";
import { WELCOME_WORDS } from "@/lib/welcome";

const Y = WELCOME_WORDS.you;
export const YOU_NAME_ID = "welcome-you-name";

export type StepYouProps = {
  profileId: string;
  org: string;
  stepLabel: string | null;
  note?: ReactNode;
  focusTitle: boolean;
  name: string;
  onName: (v: string) => void;
  nameError?: string | null;
  avatarKey: string | null;
  onAvatar: (key: string | null) => void;
  /** The photo is the one their Google account brought, unchanged. */
  fromGoogle: boolean;
  onTheme: (t: Theme) => void;
  error: string | null;
  onError: (message: string | null) => void;
  busy: boolean;
  onBack: () => void;
  onContinue: () => void;
  /** Her eyes on a spot of the page (the end of the name as it is typed), or back to the pointer. */
  onLook: (x: number | null, y?: number) => void;
};

export function StepYou(p: StepYouProps) {
  const theme = useTheme();
  const file = useRef<HTMLInputElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const photoButton = useRef<HTMLButtonElement>(null);
  // The photo buttons are disabled while they work, which drops focus to the page: put it back on "Change photo" (or
  // "Add a photo", after Remove) once they are done (review, 11 October 2026).
  const refocus = () => requestAnimationFrame(() => {
    const a = document.activeElement;
    if (!a || a === document.body) photoButton.current?.focus();
  });
  const [pending, setPending] = useState<"upload" | "remove" | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (blurTimer.current) clearTimeout(blurTimer.current); }, []);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  // Her eyes go to the end of the name as it is typed (the field's right edge, where the caret is).
  const look = () => {
    const el = input.current; if (!el) return;
    if (blurTimer.current) clearTimeout(blurTimer.current);
    const r = el.getBoundingClientRect();
    p.onLook(r.right - 12, r.top + r.height / 2);
  };

  const reset = () => { if (file.current) file.current.value = ""; };
  async function choose(f: File) {
    p.onError(null);
    if (!isAvatarType(f.type)) { p.onError(Y.errors.type); reset(); return; }
    if (f.size > AVATAR_INPUT_MAX) { p.onError(Y.errors.tooBig((f.size / 1048576).toFixed(1))); reset(); return; }
    setPending("upload");
    const square = await avatarUpload(f);
    if (!square || square.size > AVATAR_UPLOAD_MAX) { setPending(null); p.onError(Y.errors.unreadable); reset(); refocus(); return; }
    const url = URL.createObjectURL(square);
    setPreview(url);
    try {
      const fd = new FormData(); fd.append("file", square);
      const res = await fetch("/api/me/avatar", { method: "POST", body: fd, credentials: "same-origin" }).catch(() => null);
      if (!res) throw new Error(Y.errors.offline);
      const data = await res.json().catch(() => null) as { avatarKey?: string; message?: string } | null;
      if (!res.ok || !data?.avatarKey) throw new Error(data?.message ?? Y.errors.offline);
      p.onAvatar(data.avatarKey);
    } catch (err) {
      p.onError((err as Error).message || Y.errors.offline);
    } finally {
      setPreview(null); setPending(null); reset(); refocus();
    }
  }
  async function remove() {
    p.onError(null); setPending("remove");
    try { await api("/api/me/avatar", { method: "DELETE" }); p.onAvatar(null); }
    catch (err) { p.onError(isApiFailure(err) ? err.error.message : Y.errors.offline); }
    finally { setPending(null); refocus(); }
  }

  const hintId = "welcome-photo-hint";
  return (
    <StepFrame stepLabel={p.stepLabel} title={Y.title} lede={Y.lede(p.org)} note={p.note} focusTitle={p.focusTitle} error={p.error}
      onSubmit={p.onContinue} onBack={p.onBack} primary={{ label: WELCOME_WORDS.buttons.continue, loading: p.busy, disabled: !!pending }}>
      <div className="grid gap-7">
        <Field label={Y.name} htmlFor={YOU_NAME_ID} error={p.nameError ?? undefined}>
          <Input ref={input} id={YOU_NAME_ID} fieldSize="lg" value={p.name} maxLength={120} autoComplete="name"
            onChange={(e) => { p.onName(e.target.value); look(); }} onFocus={look}
            onBlur={() => { blurTimer.current = setTimeout(() => p.onLook(null), 600); }} />
        </Field>

        <div role="group" aria-labelledby="welcome-photo-label" aria-describedby={hintId}>
          <p id="welcome-photo-label" className="mb-2 text-sm font-medium text-foreground">{Y.photo}</p>
          <div className="flex items-center gap-4">
            <span className="relative shrink-0" aria-busy={pending === "upload"}>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- the chosen photo while it uploads
                <img src={preview} alt="" className="size-[72px] rounded-full object-cover opacity-70" />
              ) : <Avatar profileId={p.profileId} name={p.name.trim() || "?"} avatarKey={p.avatarKey} size={72} />}
            </span>
            <div className="flex min-w-0 flex-wrap gap-2">
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); }} />
              <Button ref={photoButton} size="sm" variant="secondary" loading={pending === "upload"} disabled={pending === "remove"} onClick={() => file.current?.click()}>
                {pending === "upload" ? null : <Camera aria-hidden />}{pending === "upload" ? Y.uploading : p.avatarKey ? Y.change : Y.add}
              </Button>
              {p.avatarKey ? (
                <Button size="sm" variant="ghost" loading={pending === "remove"} disabled={pending === "upload"} onClick={() => void remove()}>
                  {pending === "remove" ? null : <Trash2 aria-hidden />}{pending === "remove" ? Y.removing : Y.remove}
                </Button>
              ) : null}
            </div>
          </div>
          <p id={hintId} className="mt-2 text-meta font-normal text-secondary">
            {Y.photoHint}{p.fromGoogle && p.avatarKey ? ` ${Y.fromGoogle}` : ""}
          </p>
        </div>

        <div>
          <p id="welcome-theme-label" className="mb-2 text-sm font-medium text-foreground">{Y.theme}</p>
          <Segmented aria-label={Y.theme} name="welcome-theme" value={theme}
            onChange={(v) => { const t = v === "light" ? "light" : "dark"; applyTheme(t); p.onTheme(t); }}
            options={[{ value: "dark", label: Y.dark }, { value: "light", label: Y.light }]} />
          <p className="mt-2 text-meta font-normal text-secondary">{Y.themeHint}</p>
        </div>
      </div>
    </StepFrame>
  );
}
