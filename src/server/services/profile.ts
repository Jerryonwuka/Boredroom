import { z } from "zod";
import { withUser } from "@/server/db";
import { storage } from "@/server/lib/storage";
import { invalid, notFound } from "@/server/lib/errors";
import type { CurrentUser } from "@/server/auth";
export { avatarUrl } from "@/lib/avatar";

export const profileSchema = z.object({
  displayName: z.string().trim().min(1, "Name is required.").max(120),
  title: z.string().trim().max(80).transform((s) => s || null),
  statusText: z.string().trim().max(140).transform((s) => s || null),
});

export type MyProfile = {
  id: string; email: string; displayName: string; title: string | null; statusText: string | null; statusSetAt: string | null;
  avatarKey: string | null; createdAt: string;
  workspaces: { id: string; slug: string; name: string; role: string; employeeCode: string; teams: string[] }[];
};

/** The caller's own profile and every workspace they belong to. */
export async function myProfile(user: CurrentUser): Promise<MyProfile> {
  return withUser(user.profileId, async (db) => {
    const p = await db.one<{ id: string; email: string; display_name: string; title: string | null; status_text: string | null; status_set_at: string | null; avatar_key: string | null; created_at: string; workspaces: MyProfile["workspaces"] | null }>(
      `SELECT p.id, p.email, p.display_name, p.title, p.status_text, p.status_set_at, p.avatar_key, p.created_at,
              (SELECT json_agg(json_build_object('id', o.id, 'slug', o.slug, 'name', o.name, 'role', m.role, 'employeeCode', m.employee_code,
                 'teams', COALESCE((SELECT json_agg(t.name ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id AND t.archived_at IS NULL), '[]'::json)) ORDER BY o.name)
               FROM memberships m JOIN organisations o ON o.id = m.organisation_id WHERE m.user_id = p.id AND m.status = 'active') AS workspaces
       FROM profiles p WHERE p.id = $1`, [user.profileId]);
    return { id: p.id, email: p.email, displayName: p.display_name, title: p.title, statusText: p.status_text, statusSetAt: p.status_set_at, avatarKey: p.avatar_key, createdAt: p.created_at, workspaces: p.workspaces ?? [] };
  });
}

export async function updateMyProfile(user: CurrentUser, input: z.infer<typeof profileSchema>) {
  return withUser(user.profileId, async (db) => {
    await db.query(
      `UPDATE profiles SET display_name = $2, title = $3,
              status_text = $4, status_set_at = CASE WHEN status_text IS DISTINCT FROM $4 THEN now() ELSE status_set_at END,
              updated_at = now()
       WHERE id = $1`, [user.profileId, input.displayName, input.title, input.statusText]);
    return { ok: true };
  });
}

const AVATAR_MAX = 2 * 1024 * 1024;
const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};
const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** Stores a new avatar (PNG, JPEG or WebP, 2 MB or less, content checked) and forgets the old file. */
export async function setMyAvatar(user: CurrentUser, file: { type: string; bytes: Buffer }) {
  const type = file.type.split(";")[0].trim().toLowerCase();
  if (file.bytes.length === 0) throw invalid("The image is empty.");
  if (file.bytes.length > AVATAR_MAX) throw invalid("Images must be 2 MB or smaller.");
  if (!MAGIC[type]) throw invalid("Use a PNG, JPEG or WebP image.");
  if (!MAGIC[type](file.bytes)) throw invalid("The file content does not match its declared type.");
  const key = `users/${user.profileId.replace(/-/g, "")}/avatar-${crypto.randomUUID()}.${EXT[type]}`;
  await storage().put(key, file.bytes, type);
  const old = await withUser(user.profileId, async (db) => {
    const prev = await db.maybeOne<{ avatar_key: string | null }>(`SELECT avatar_key FROM profiles WHERE id = $1`, [user.profileId]);
    await db.query(`UPDATE profiles SET avatar_key = $2, avatar_mime = $3, updated_at = now() WHERE id = $1`, [user.profileId, key, type]);
    return prev?.avatar_key ?? null;
  });
  if (old) await storage().delete(old).catch(() => undefined);
  return { avatarKey: key };
}

export async function removeMyAvatar(user: CurrentUser) {
  const old = await withUser(user.profileId, async (db) => {
    const prev = await db.maybeOne<{ avatar_key: string | null }>(`SELECT avatar_key FROM profiles WHERE id = $1`, [user.profileId]);
    await db.query(`UPDATE profiles SET avatar_key = NULL, avatar_mime = NULL, updated_at = now() WHERE id = $1`, [user.profileId]);
    return prev?.avatar_key ?? null;
  });
  if (old) await storage().delete(old).catch(() => undefined);
  return { ok: true };
}

/** The avatar file of a profile the viewer may see (themselves, or a co-member of one of their organisations). */
export async function avatarFor(viewer: CurrentUser, profileId: string) {
  const row = await withUser(viewer.profileId, (db) => db.maybeOne<{ avatar_key: string | null; avatar_mime: string | null }>(`SELECT avatar_key, avatar_mime FROM profiles WHERE id = $1`, [profileId]));
  if (!row || !row.avatar_key || !row.avatar_mime) throw notFound("No avatar.");
  return { key: row.avatar_key, mime: row.avatar_mime };
}
