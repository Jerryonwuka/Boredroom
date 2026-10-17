/**
 * Profile pictures without their hidden data (owner request, 11 October 2026: the first-run welcome asks for a photo; a
 * phone's JPEG carries where it was taken, and colleagues would have been served it). The browser already re-encodes a
 * chosen picture (lib/avatar-image); this is the server's own pass for anything that arrives unchanged (an older page, an
 * API client, the Google picture), with no image library:
 * - `sniffImage`: the bytes really are the declared PNG, JPEG or WebP (moved from services/profile, and now used by the
 *   Google import too).
 * - `stripImageMetadata`: JPEG loses its APP1 (Exif, XMP), APP13 (IPTC) and other APPn segments and its comments, keeping
 *   JFIF (APP0), the colour profile (APP2 "ICC_PROFILE" only, never MPF) and Adobe's (APP14); the Exif orientation
 *   survives as a minimal Exif segment, so a sideways phone photo still stands up. It walks every scan to the first EOI and
 *   drops whatever follows, so an image a phone appends after the picture (MPF images, gain maps), with its own Exif and
 *   GPS, is dropped too. PNG loses eXIf, tEXt, zTXt, iTXt and tIME and anything after IEND. WebP loses its EXIF and XMP
 *   chunks (and their VP8X flags) and anything after the RIFF. The picture's own data is never touched.
 * - A file that cannot be read this way gives null and is refused, never stored with its metadata (review, 11 October
 *   2026: it used to come back as it was, and the copy from the first scan on kept appended images' Exif).
 * - `imageSize` (owner decisions, 11 October 2026: screen help on Brenda for Mac): a JPEG's (SOF0, SOF1, SOF2) or PNG's
 *   (IHDR) own width and height, so the look route checks that a picture is the size the Mac says it is. It reads the
 *   headers only, never the picture.
 */

export type ImageType = "image/png" | "image/jpeg" | "image/webp";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** True when `bytes` start the way `type` says. */
export function sniffImage(type: string, bytes: Buffer): type is ImageType {
  if (type === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE);
  if (type === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
  return false;
}

/** The same picture without its metadata (see above); null when it is not a well-formed file of that type. */
export function stripImageMetadata(type: ImageType, bytes: Buffer): Buffer | null {
  try {
    if (type === "image/jpeg") return stripJpeg(bytes);
    if (type === "image/png") return stripPng(bytes);
    return stripWebp(bytes);
  } catch {
    return null;
  }
}

/** A JPEG's or PNG's own width and height from its headers; null when it cannot be read (or is another type). */
export function imageSize(type: string, bytes: Buffer): { width: number; height: number } | null {
  try {
    if (type === "image/png") {
      if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.subarray(12, 16).toString("latin1") !== "IHDR") return null;
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    if (type !== "image/jpeg" || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      let j = i;
      while (j < bytes.length && bytes[j] === 0xff) j++;
      if (j >= bytes.length) return null;
      const marker = bytes[j];
      if (marker === 0xd9 || marker === 0xda) return null; // the end, or the picture's data, before any frame header
      if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i = j + 1; continue; }
      if (j + 3 > bytes.length) return null;
      const len = bytes.readUInt16BE(j + 1);
      if (len < 2 || j + 1 + len > bytes.length) return null;
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (len < 7) return null;
        const height = bytes.readUInt16BE(j + 4), width = bytes.readUInt16BE(j + 6);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      i = j + 1 + len;
    }
    return null;
  } catch {
    return null;
  }
}

// ---- JPEG ----------------------------------------------------------------------------------------------------------------

/** The APPn segments kept, each only with its own identifier: JFIF (APP0), the ICC colour profile (APP2), Adobe (APP14). */
const KEEP_APP: Record<number, string> = { 0xe0: "JFIF\0", 0xe2: "ICC_PROFILE\0", 0xee: "Adobe" };

/** The end of a scan's entropy-coded data: the next marker that is not a stuffed 0xFF00 or a restart (RSTn). */
function scanEnd(b: Buffer, from: number): number {
  let k = from;
  while (k < b.length) {
    if (b[k] !== 0xff) { k++; continue; }
    const n = b[k + 1];
    if (n === undefined) return b.length; // cut off inside the scan
    if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) { k += 2; continue; }
    if (n === 0xff) { k++; continue; } // fill before a marker
    return k;
  }
  return b.length;
}

function stripJpeg(b: Buffer): Buffer | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out: Buffer[] = [b.subarray(0, 2)];
  let orientation: number | null = null;
  let i = 2;
  let insertAt = 1; // after SOI, or after APP0 once seen
  let scanned = false;
  while (i < b.length) {
    if (b[i] !== 0xff) return null; // not at a marker: malformed
    let j = i;
    while (j < b.length && b[j] === 0xff) j++; // fill bytes
    if (j >= b.length) return null;
    const marker = b[j];
    // EOI: the picture ends here. Anything after it (another image a phone appended, with its own Exif) is dropped.
    if (marker === 0xd9) { out.push(b.subarray(j - 1, j + 1)); break; }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { out.push(b.subarray(i, j + 1)); i = j + 1; continue; }
    if (j + 3 > b.length) return null;
    const len = b.readUInt16BE(j + 1);
    const end = j + 1 + len;
    if (len < 2 || end > b.length) return null;
    if (marker === 0xda) {
      // SOS: its header, then the picture's data, copied as it is up to the next marker (a progressive file has several).
      const data = scanEnd(b, end);
      out.push(b.subarray(i, data));
      scanned = true;
      i = data;
      continue;
    }
    const segment = b.subarray(i, end);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    if (marker === 0xe1 && orientation === null) orientation = exifOrientation(b.subarray(j + 3, end));
    const keep = isApp ? KEEP_APP[marker] !== undefined && b.subarray(j + 3, end).toString("latin1").startsWith(KEEP_APP[marker]) : marker !== 0xfe;
    if (!keep) { i = end; continue; } // dropped
    out.push(segment);
    if (marker === 0xe0) insertAt = out.length;
    i = end;
  }
  if (!scanned) return null; // no picture data at all
  if (orientation !== null && orientation >= 2 && orientation <= 8) out.splice(insertAt, 0, minimalExif(orientation));
  return Buffer.concat(out);
}

/** The orientation tag (0x0112) of IFD0 in an Exif APP1 payload ("Exif\0\0" + TIFF), or null. */
function exifOrientation(p: Buffer): number | null {
  if (p.length < 14 || p.subarray(0, 6).toString("latin1") !== "Exif\0\0") return null;
  const t = p.subarray(6);
  const le = t.subarray(0, 2).toString("latin1") === "II";
  if (!le && t.subarray(0, 2).toString("latin1") !== "MM") return null;
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  if (u16(2) !== 42) return null;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return null;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > t.length) return null;
    if (u16(e) === 0x0112 && u16(e + 2) === 3) return u16(e + 8);
  }
  return null;
}

/** An APP1 holding only the orientation: "Exif\0\0", a big-endian TIFF header, one IFD with one SHORT entry. */
function minimalExif(orientation: number): Buffer {
  const s = Buffer.alloc(36);
  s.writeUInt16BE(0xffe1, 0);
  s.writeUInt16BE(34, 2); // the length counts itself and the 32 bytes after it
  s.write("Exif\0\0", 4, "latin1");
  s.write("MM", 10, "latin1");
  s.writeUInt16BE(42, 12);
  s.writeUInt32BE(8, 14); // IFD0 right after the header
  s.writeUInt16BE(1, 18); // one entry
  s.writeUInt16BE(0x0112, 20);
  s.writeUInt16BE(3, 22); // SHORT
  s.writeUInt32BE(1, 24);
  s.writeUInt16BE(orientation, 28);
  s.writeUInt16BE(0, 30);
  s.writeUInt32BE(0, 32); // no next IFD
  return s;
}

// ---- PNG -----------------------------------------------------------------------------------------------------------------

const PNG_DROP = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(b: Buffer): Buffer | null {
  if (b.length < 8 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const out: Buffer[] = [b.subarray(0, 8)];
  let i = 8;
  let ended = false;
  while (i < b.length) {
    if (i + 12 > b.length) return null;
    const len = b.readUInt32BE(i);
    const type = b.subarray(i + 4, i + 8).toString("latin1");
    const end = i + 12 + len;
    if (end > b.length) return null;
    if (!PNG_DROP.has(type)) out.push(b.subarray(i, end));
    i = end;
    if (type === "IEND") { ended = true; break; }
  }
  return ended ? Buffer.concat(out) : null;
}

// ---- WebP ----------------------------------------------------------------------------------------------------------------

function stripWebp(b: Buffer): Buffer | null {
  if (b.length < 12 || b.subarray(0, 4).toString("latin1") !== "RIFF" || b.subarray(8, 12).toString("latin1") !== "WEBP") return null;
  const chunks: Buffer[] = [];
  let i = 12;
  const stop = Math.min(b.length, 8 + b.readUInt32LE(4));
  while (i + 8 <= stop) {
    const fourcc = b.subarray(i, i + 4).toString("latin1");
    const size = b.readUInt32LE(i + 4);
    const end = i + 8 + size + (size & 1);
    if (i + 8 + size > b.length) return null;
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = Buffer.from(b.subarray(i, Math.min(end, b.length)));
      if (fourcc === "VP8X" && size >= 1) chunk[8] &= ~(0x08 | 0x04); // the EXIF and XMP flags
      chunks.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}
