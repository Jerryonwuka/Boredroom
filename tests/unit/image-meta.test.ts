/**
 * Profile pictures without their hidden data (owner request, 11 October 2026: the first-run welcome asks for a photo, D18).
 * Synthetic files, built byte by byte: a JPEG keeps its JFIF header and its picture data, loses its Exif (a GPS position
 * among it), its comment and its other APPn segments, and keeps only the orientation in a minimal Exif; a PNG keeps only
 * its picture's chunks; a WebP loses its EXIF and XMP chunks and their flags. Anything after the picture (an image a phone
 * appends, with its own Exif) is dropped, and anything malformed is refused (null) (review, 11 October 2026).
 */
import { describe, expect, it } from "vitest";
import { sniffImage, stripImageMetadata } from "@/server/lib/image-meta";

const SECRET = Buffer.from("GPS 6.4541N 3.3947E PhoneMaker", "latin1");

/** A marker segment: FF, the marker, a big-endian length that counts itself, the payload. */
function segment(marker: number, payload: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** A little-endian Exif payload: IFD0 with the orientation and a GPS IFD pointer; the GPS IFD holds a latitude ref and the secret. */
function exifPayload(orientation: number): Buffer {
  const t = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 12 + 4 + SECRET.length);
  t.write("II", 0, "latin1");
  t.writeUInt16LE(42, 2);
  t.writeUInt32LE(8, 4);
  let o = 8;
  t.writeUInt16LE(2, o); o += 2;
  t.writeUInt16LE(0x0112, o); t.writeUInt16LE(3, o + 2); t.writeUInt32LE(1, o + 4); t.writeUInt16LE(orientation, o + 8); o += 12;
  const gps = 8 + 2 + 2 * 12 + 4;
  t.writeUInt16LE(0x8825, o); t.writeUInt16LE(4, o + 2); t.writeUInt32LE(1, o + 4); t.writeUInt32LE(gps, o + 8); o += 12;
  t.writeUInt32LE(0, o); o += 4;
  t.writeUInt16LE(1, o); o += 2;
  t.writeUInt16LE(0x0002, o); t.writeUInt16LE(7, o + 2); t.writeUInt32LE(SECRET.length, o + 4); t.writeUInt32LE(gps + 2 + 12 + 4, o + 8); o += 12;
  t.writeUInt32LE(0, o); o += 4;
  SECRET.copy(t, o);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]);
}

const SOI = Buffer.from([0xff, 0xd8]);
const APP0 = segment(0xe0, Buffer.from([0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]));
const DQT = segment(0xdb, Buffer.alloc(65, 1));
const SOS_ON = Buffer.concat([segment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd9])]);

function jpeg(orientation: number): Buffer {
  return Buffer.concat([SOI, APP0, segment(0xe1, exifPayload(orientation)), segment(0xed, Buffer.from("Photoshop 3.0\0IPTC city", "latin1")), segment(0xfe, Buffer.from("secret comment", "latin1")), DQT, SOS_ON]);
}

describe("stripImageMetadata: JPEG", () => {
  it("keeps JFIF and the picture, and keeps only the orientation of the Exif", () => {
    const out = stripImageMetadata("image/jpeg", jpeg(6))!;
    expect(out.subarray(0, 2).equals(SOI)).toBe(true);
    expect(out.subarray(2, 2 + APP0.length).equals(APP0)).toBe(true);
    const app1 = out.subarray(2 + APP0.length, 2 + APP0.length + 36);
    expect(app1[0]).toBe(0xff);
    expect(app1[1]).toBe(0xe1);
    expect(app1.readUInt16BE(2)).toBe(34);
    expect(app1.subarray(4, 10).toString("latin1")).toBe("Exif\0\0");
    expect(app1.readUInt16BE(18)).toBe(1); // one entry
    expect(app1.readUInt16BE(20)).toBe(0x0112);
    expect(app1.readUInt16BE(28)).toBe(6);
    const rest = out.subarray(2 + APP0.length + 36);
    expect(rest.equals(Buffer.concat([DQT, SOS_ON]))).toBe(true);
    expect(out.includes(SECRET)).toBe(false);
    expect(out.includes(Buffer.from("secret comment", "latin1"))).toBe(false);
    expect(out.includes(Buffer.from("IPTC", "latin1"))).toBe(false);
    expect([...out].filter((_, i) => out[i] === 0xff && out[i + 1] === 0xe1)).toHaveLength(1);
  });

  it("drops the Exif entirely when the picture stands upright", () => {
    const out = stripImageMetadata("image/jpeg", jpeg(1))!;
    expect(out.equals(Buffer.concat([SOI, APP0, DQT, SOS_ON]))).toBe(true);
  });

  it("copies everything from the start of scan as it is", () => {
    const input = jpeg(3);
    const out = stripImageMetadata("image/jpeg", input)!;
    expect(out.subarray(out.length - SOS_ON.length).equals(input.subarray(input.length - SOS_ON.length))).toBe(true);
  });

  it("drops an image appended after the first EOI, with its own Exif (MPF, gain maps)", () => {
    const second = Buffer.concat([SOI, segment(0xe1, exifPayload(1)), DQT, SOS_ON]);
    const out = stripImageMetadata("image/jpeg", Buffer.concat([jpeg(1), second]))!;
    expect(out.equals(Buffer.concat([SOI, APP0, DQT, SOS_ON]))).toBe(true);
    expect(out.includes(SECRET)).toBe(false);
  });

  it("keeps an ICC profile in APP2, and drops an MPF index in APP2", () => {
    const icc = segment(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01profile", "latin1"));
    const mpf = segment(0xe2, Buffer.from("MPF\0MM\0*index", "latin1"));
    const out = stripImageMetadata("image/jpeg", Buffer.concat([SOI, APP0, icc, mpf, DQT, SOS_ON]))!;
    expect(out.equals(Buffer.concat([SOI, APP0, icc, DQT, SOS_ON]))).toBe(true);
  });

  it("walks every scan of a progressive file, dropping what sits between them", () => {
    const scan = Buffer.concat([segment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])), Buffer.from([0x12, 0xff, 0x00, 0xff, 0xd3, 0x34])]);
    const dht = segment(0xc4, Buffer.alloc(20, 2));
    const input = Buffer.concat([SOI, APP0, DQT, scan, dht, segment(0xfe, Buffer.from("secret comment", "latin1")), scan, Buffer.from([0xff, 0xd9])]);
    const out = stripImageMetadata("image/jpeg", input)!;
    expect(out.equals(Buffer.concat([SOI, APP0, DQT, scan, dht, scan, Buffer.from([0xff, 0xd9])]))).toBe(true);
  });

  it("puts the orientation right after SOI when there is no JFIF header", () => {
    const input = Buffer.concat([SOI, segment(0xe1, exifPayload(8)), DQT, SOS_ON]);
    const out = stripImageMetadata("image/jpeg", input)!;
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe1);
    expect(out.readUInt16BE(2 + 28)).toBe(8);
    expect(out.subarray(2 + 36).equals(Buffer.concat([DQT, SOS_ON]))).toBe(true);
  });
});

/** A PNG chunk: length, type, data, and a CRC (the stripper never reads it). */
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  return Buffer.concat([head, data, Buffer.from([0xde, 0xad, 0xbe, 0xef])]);
}
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = chunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]));
const IDAT = chunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01]));
const IEND = chunk("IEND", Buffer.alloc(0));

describe("stripImageMetadata: PNG", () => {
  it("keeps only IHDR, IDAT and IEND, with the signature intact", () => {
    const input = Buffer.concat([PNG_SIG, IHDR, chunk("eXIf", exifPayload(6).subarray(6)), chunk("tEXt", Buffer.from("Comment\0secret comment", "latin1")), chunk("tIME", Buffer.alloc(7, 7)), IDAT, IEND]);
    const out = stripImageMetadata("image/png", input)!;
    expect(out.equals(Buffer.concat([PNG_SIG, IHDR, IDAT, IEND]))).toBe(true);
    expect(out.includes(SECRET)).toBe(false);
  });

  it("stops at IEND", () => {
    const out = stripImageMetadata("image/png", Buffer.concat([PNG_SIG, IHDR, IDAT, IEND, Buffer.from("trailing junk")]))!;
    expect(out.equals(Buffer.concat([PNG_SIG, IHDR, IDAT, IEND]))).toBe(true);
  });
});

/** A RIFF chunk: fourcc, little-endian size, data, a pad byte when the size is odd. */
function riff(fourcc: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(fourcc, 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, data.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function webp(chunks: Buffer[]): Buffer {
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "latin1");
  return Buffer.concat([head, body]);
}

describe("stripImageMetadata: WebP", () => {
  it("drops EXIF and XMP, clears their VP8X flags and fixes the RIFF size", () => {
    const vp8x = Buffer.alloc(10);
    vp8x[0] = 0x0c | 0x10; // EXIF, XMP and alpha
    const vp8 = Buffer.from([1, 2, 3, 4, 5, 6, 7]); // odd: padded
    const input = webp([riff("VP8X", vp8x), riff("VP8 ", vp8), riff("EXIF", exifPayload(6).subarray(6)), riff("XMP ", Buffer.from("<x:xmpmeta>secret</x:xmpmeta>", "latin1"))]);
    const out = stripImageMetadata("image/webp", input)!;
    const cleared = Buffer.from(vp8x);
    cleared[0] = 0x10;
    expect(out.equals(webp([riff("VP8X", cleared), riff("VP8 ", vp8)]))).toBe(true);
    expect(out.readUInt32LE(4)).toBe(out.length - 8);
    expect(out.includes(SECRET)).toBe(false);
    expect(out.includes(Buffer.from("xmpmeta", "latin1"))).toBe(false);
  });

  it("leaves a simple WebP as it was", () => {
    const input = webp([riff("VP8L", Buffer.from([0x2f, 0, 0, 0, 0x10]))]);
    expect(stripImageMetadata("image/webp", input)!.equals(input)).toBe(true);
  });
});

describe("stripImageMetadata: malformed files are refused (null), never kept with their metadata", () => {
  it.each([
    ["a JPEG cut inside a segment", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00])],
    ["a JPEG with a length past its end", "image/jpeg", Buffer.concat([SOI, Buffer.from([0xff, 0xe1, 0x40, 0x00, 1, 2, 3])])],
    ["a JPEG with junk where a marker should be", "image/jpeg", Buffer.concat([SOI, Buffer.from([0x00, 0x11, 0x22, 0x33])])],
    ["not a JPEG at all", "image/jpeg", Buffer.from("hello world")],
    ["a PNG chunk past its end", "image/png", Buffer.concat([PNG_SIG, IHDR, Buffer.from([0, 0, 1, 0, 0x74, 0x45, 0x58, 0x74, 1, 2])])],
    ["a PNG without its signature", "image/png", Buffer.from("PNG but not really")],
    ["a WebP chunk past its end", "image/webp", (() => { const w = webp([riff("VP8 ", Buffer.alloc(8))]); w.writeUInt32LE(4000, 16); return w; })()],
    ["a RIFF that is not WebP", "image/webp", Buffer.from("RIFF\x04\x00\x00\x00WAVE", "latin1")],
    ["a JPEG with no picture data", "image/jpeg", Buffer.concat([SOI, APP0, segment(0xe1, exifPayload(6)), Buffer.from([0xff, 0xd9])])],
    ["a PNG without IEND", "image/png", Buffer.concat([PNG_SIG, IHDR, IDAT])],
  ] as const)("%s", (_name, type, input) => {
    expect(stripImageMetadata(type, input)).toBeNull();
  });
});

describe("sniffImage", () => {
  it("accepts the bytes each type starts with", () => {
    expect(sniffImage("image/jpeg", jpeg(1))).toBe(true);
    expect(sniffImage("image/png", Buffer.concat([PNG_SIG, IHDR]))).toBe(true);
    expect(sniffImage("image/webp", webp([riff("VP8L", Buffer.alloc(5))]))).toBe(true);
  });

  it("refuses the wrong type, other types, and short or empty files", () => {
    expect(sniffImage("image/png", jpeg(1))).toBe(false);
    expect(sniffImage("image/jpeg", Buffer.concat([PNG_SIG, IHDR]))).toBe(false);
    expect(sniffImage("image/webp", Buffer.from("RIFF\x04\x00\x00\x00WAVE", "latin1"))).toBe(false);
    expect(sniffImage("image/gif", Buffer.from("GIF89a"))).toBe(false);
    expect(sniffImage("image/svg+xml", Buffer.from("<svg/>"))).toBe(false);
    expect(sniffImage("image/jpeg", Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(sniffImage("image/png", Buffer.alloc(0))).toBe(false);
  });
});
