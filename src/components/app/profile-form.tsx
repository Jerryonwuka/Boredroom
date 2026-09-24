"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2 } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Textarea, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { Presence } from "@/components/ui/motion";
import { api, isApiFailure } from "@/lib/api-client";

type Props = { profileId: string; displayName: string; title: string | null; statusText: string | null; avatarKey: string | null };

/** Picture, name, job title and a short status. Saved with one button; the picture uploads on its own. */
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
    setPending("avatar"); setError(null); setSaved(null);
    const url = URL.createObjectURL(file); setPreview(url);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/me/avatar", { method: "POST", body: fd, credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message ?? "Upload failed.");
      setAvatarKey(data.avatarKey); setPreview(null); URL.revokeObjectURL(url); setSaved("Picture updated."); router.refresh();
    } catch (err) { setPreview(null); URL.revokeObjectURL(url); setError((err as Error).message); }
    finally { setPending(null); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <form className="space-y-6" onSubmit={async (e) => {
      e.preventDefault(); setPending("save"); setError(null); setFieldErrors({}); setSaved(null);
      const f = new FormData(e.currentTarget);
      try {
        await api("/api/me/profile", { method: "PATCH", body: { displayName: f.get("displayName"), title: f.get("title") ?? "", statusText: f.get("statusText") ?? "" } });
        setSaved("Profile saved."); router.refresh();
      } catch (err) { if (isApiFailure(err)) { setError(err.error.message); setFieldErrors(err.error.fieldErrors ?? {}); } else setError("Cannot reach the server."); }
      finally { setPending(null); }
    }}>
      <Presence show={!!error}><Alert tone="danger">{error}</Alert></Presence>
      <Presence show={!!saved}><Alert tone="success">{saved}</Alert></Presence>

      <div className="flex flex-wrap items-center gap-5">
        <div className="relative">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the chosen file
            <img src={preview} alt="" className="size-24 rounded-full border border-border object-cover opacity-70" />
          ) : <Avatar profileId={p.profileId} name={p.displayName} avatarKey={avatarKey} size={96} />}
        </div>
        <div className="space-y-2">
          <p className="text-sm text-fg-muted">PNG, JPEG or WebP, up to 2 MB. Shown beside your name across the workspace.</p>
          <div className="flex flex-wrap gap-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" id="avatar-file" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); }} />
            <Button type="button" size="sm" variant="outline" disabled={pending === "avatar"} onClick={() => fileRef.current?.click()}><Camera className="size-4" aria-hidden />{pending === "avatar" ? "Uploading…" : avatarKey ? "Change picture" : "Add a picture"}</Button>
            {avatarKey ? <Button type="button" size="sm" variant="ghost" disabled={pending === "remove"} onClick={async () => { setPending("remove"); setError(null); try { await api("/api/me/avatar", { method: "DELETE" }); setAvatarKey(null); setSaved("Picture removed."); router.refresh(); } catch (err) { setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); } finally { setPending(null); } }}><Trash2 className="size-4" aria-hidden />Remove</Button> : null}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name" htmlFor="displayName" error={fieldErrors.displayName}><Input id="displayName" name="displayName" defaultValue={p.displayName} required maxLength={120} autoComplete="name" /></Field>
        <Field label="Job title" htmlFor="title" hint="optional" error={fieldErrors.title}><Input id="title" name="title" defaultValue={p.title ?? ""} maxLength={80} placeholder="e.g. Product designer" autoComplete="organization-title" /></Field>
      </div>
      <Field label="Status" htmlFor="statusText" hint="optional, one line others see beside your name" error={fieldErrors.statusText}><Textarea id="statusText" name="statusText" defaultValue={p.statusText ?? ""} maxLength={140} rows={2} className="min-h-0" placeholder="e.g. Out until Monday, back on the deck Tuesday" /></Field>
      <div className="flex gap-2"><Button type="submit" disabled={pending === "save"}>{pending === "save" ? "Saving…" : "Save changes"}</Button></div>
    </form>
  );
}
