"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { SETTINGS_GROUP, SettingsRow, SettingsFooter, SettingsAlert } from "@/components/app/settings-forms";
import { api, isApiFailure } from "@/lib/api-client";

type Props = { profileId: string; displayName: string; title: string | null; statusText: string | null; avatarKey: string | null };

const OFFLINE = "Cannot reach the server. Check your connection and try again.";
const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PICTURE_MAX = 2 * 1024 * 1024;

/**
 * Picture, name, job title and a short status, as settings rows (v4). Saved with one button in the footer; the picture
 * uploads on its own the moment it is chosen. Errors sit at the top of the card and on their fields; what went through
 * is said in the footer.
 */
export function ProfileForm(p: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [avatarKey, setAvatarKey] = useState(p.avatarKey);
  const [pending, setPending] = useState<"save" | "avatar" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null); setSaved(null);
    // Checked here first, so a wrong file is turned away at once instead of after the upload.
    if (!PICTURE_TYPES.includes(file.type)) { setError("That file is not a PNG, JPEG or WebP image. Choose one of those."); if (fileRef.current) fileRef.current.value = ""; return; }
    if (file.size > PICTURE_MAX) { setError(`That image is ${(file.size / 1048576).toFixed(1)} MB. Choose one under 2 MB, or make it smaller first.`); if (fileRef.current) fileRef.current.value = ""; return; }
    setPending("avatar");
    const url = URL.createObjectURL(file); setPreview(url);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/me/avatar", { method: "POST", body: fd, credentials: "same-origin" }).catch(() => null);
      if (!res) throw new Error(`${OFFLINE} Your picture was not changed.`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "The picture was not uploaded. Try again, or choose another image.");
      setAvatarKey(data.avatarKey); setPreview(null); URL.revokeObjectURL(url); setSaved("Picture updated."); router.refresh();
    } catch (err) { setPreview(null); URL.revokeObjectURL(url); setError((err as Error).message); }
    finally { setPending(null); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <form className={SETTINGS_GROUP} onSubmit={async (e) => {
      e.preventDefault(); setPending("save"); setError(null); setFieldErrors({}); setSaved(null);
      const f = new FormData(e.currentTarget);
      try {
        await api("/api/me/profile", { method: "PATCH", body: { displayName: f.get("displayName"), title: f.get("title") ?? "", statusText: f.get("statusText") ?? "" } });
        setSaved("Profile saved."); router.refresh();
      } catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError(`${OFFLINE} Your changes are still in the form.`); }
      finally { setPending(null); }
    }}>
      {error ? <SettingsAlert>{error}</SettingsAlert> : null}
      <SettingsRow label="Picture" hint="PNG, JPEG or WebP, up to 2 MB. Shown beside your name across the workspace." labelId="avatar">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative" aria-busy={pending === "avatar"}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
              <img src={preview} alt="" className="size-16 rounded-full object-cover opacity-70" />
            ) : <Avatar profileId={p.profileId} name={p.displayName} avatarKey={avatarKey} size={64} />}
          </div>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="avatar-file" tabIndex={-1} aria-hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
            <Button type="button" size="sm" variant="secondary" aria-describedby="avatar-hint" loading={pending === "avatar"} disabled={pending === "remove"} onClick={() => fileRef.current?.click()}>{pending === "avatar" ? null : <Camera aria-hidden />}{pending === "avatar" ? "Uploading…" : avatarKey ? "Change picture" : "Add a picture"}</Button>
            {avatarKey ? <Button type="button" size="sm" variant="ghost" loading={pending === "remove"} disabled={pending === "avatar"} onClick={async () => { setPending("remove"); setError(null); setSaved(null); try { await api("/api/me/avatar", { method: "DELETE" }); setAvatarKey(null); setSaved("Picture removed."); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : `${OFFLINE} Your picture was not removed.`); } finally { setPending(null); } }}>{pending === "remove" ? null : <Trash2 aria-hidden />}{pending === "remove" ? "Removing…" : "Remove"}</Button> : null}
          </div>
        </div>
      </SettingsRow>
      <SettingsRow label="Name" hint="Your full name, as your team knows you." htmlFor="displayName" error={fieldErrors.displayName}><Input id="displayName" name="displayName" defaultValue={p.displayName} required maxLength={120} autoComplete="name" /></SettingsRow>
      <SettingsRow label="Job title" hint="Optional." htmlFor="title" error={fieldErrors.title}><Input id="title" name="title" defaultValue={p.title ?? ""} maxLength={80} placeholder="e.g. Product designer" autoComplete="organization-title" /></SettingsRow>
      <SettingsRow label="Status" hint="Optional. One line others see beside your name." htmlFor="statusText" error={fieldErrors.statusText}><Textarea id="statusText" name="statusText" defaultValue={p.statusText ?? ""} maxLength={140} rows={2} className="min-h-0" placeholder="e.g. Out until Monday, back on the deck Tuesday" /></SettingsRow>
      <SettingsFooter status={saved}><Button type="submit" size="md" loading={pending === "save"}>{pending === "save" ? "Saving…" : "Save changes"}</Button></SettingsFooter>
    </form>
  );
}
