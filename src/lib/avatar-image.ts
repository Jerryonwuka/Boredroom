/**
 * Pictures in the browser (owner request, 11 October 2026: the first-run welcome, D18; contract 10.4). A photo straight
 * off a phone can be 10 MB and carry where it was taken. Before it is uploaded it is redrawn here as a centred square,
 * at most 512px a side, and re-encoded: WebP where the browser can write it, JPEG where it cannot. Drawing onto a canvas
 * keeps only the pixels, so the location and every other tag are gone before anything leaves the device (the server
 * strips them again, server/lib/image-meta). The orientation is applied while decoding, so a portrait photo stays
 * upright. Used by the welcome's "This is you" and by Your profile (ProfileForm).
 *
 * Throws when the browser cannot decode the file. The caller then uploads the original only if it is a PNG, JPEG or WebP
 * of 2 MB or less (the server's own limit; it strips the metadata), else says the image could not be read.
 */

/** What the upload route takes (services/profile). */
export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** The server's limit on an uploaded picture. */
export const AVATAR_UPLOAD_MAX = 2 * 1024 * 1024;
/** The largest file the browser is asked to redraw (a phone's photo fits easily). */
export const AVATAR_INPUT_MAX = 20 * 1024 * 1024;

export const isAvatarType = (type: string): boolean => (AVATAR_TYPES as readonly string[]).includes(type);

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** The picture as a centred square of `min(size, shorter side)` pixels, re-encoded without its metadata. */
export async function squareAvatar(file: File, size = 512): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    if (!side) throw new Error("empty image");
    const out = Math.max(1, Math.min(size, side));
    const canvas = document.createElement("canvas");
    canvas.width = out;
    canvas.height = out;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no canvas");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    const sx = (bitmap.width - side) / 2;
    const sy = (bitmap.height - side) / 2;
    g.drawImage(bitmap, sx, sy, side, side, 0, 0, out, out);
    // A browser that cannot write WebP hands back a PNG instead: JPEG keeps a photo small.
    let blob = await toBlob(canvas, "image/webp", 0.9);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", 0.9);
    if (!blob) throw new Error("could not encode");
    const webp = blob.type === "image/webp";
    return new File([blob], webp ? "avatar.webp" : "avatar.jpg", { type: webp ? "image/webp" : "image/jpeg" });
  } finally {
    bitmap.close();
  }
}

/**
 * What to upload for a chosen file: the redrawn square, or the original when the browser could not redraw it but the
 * server would take it as it is; null when neither (the caller says the image could not be read).
 */
export async function avatarUpload(file: File, size = 512): Promise<File | null> {
  try {
    return await squareAvatar(file, size);
  } catch {
    return isAvatarType(file.type) && file.size <= AVATAR_UPLOAD_MAX ? file : null;
  }
}
