// Screenshot size checks: the real pixel size of a JPEG (device pixel ratio makes the CSS size unreliable) and its bytes.

export const MAX_SCREENSHOT_WIDTH = 1280;
export const MAX_SCREENSHOT_BYTES = 1.5 * 1024 * 1024;

/** Decoded byte length of a base64 string, without decoding it. */
export function base64ByteLength(b64) {
  if (typeof b64 !== "string" || b64.length === 0) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** { width, height } from a JPEG's start-of-frame marker, or null when it isn't a readable JPEG. */
export function jpegSize(bytes) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // SOF0..SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    }
    i += 2 + length;
  }
  return null;
}
