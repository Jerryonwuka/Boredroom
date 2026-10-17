import { describe, it, expect, vi } from "vitest";

// Screen help on Brenda for Mac (owner decisions, 11 October 2026; contract A.6, D.6, D.9): the look route's body check,
// the picture's own size, and the ledger's share of a look. Every bad body is one generic 422 with nothing from the body
// in it. No database, no model.

vi.mock("@/server/db", () => {
  const refuse = async () => { throw new Error("no database in unit tests"); };
  return { withUser: refuse, withSystem: refuse, withWorker: refuse };
});

import { imageSize, stripImageMetadata } from "@/server/lib/image-meta";
import { lookBodySchema, lookErrorReason, neverLookRefusal, readLookBody } from "@/server/services/screen-help";
import { withoutImage } from "@/server/services/ai-usage";
import { AppError } from "@/server/lib/errors";

/** 40×24 pictures made for these tests (an orange block on grey): baseline JPEG, progressive JPEG, PNG. */
const JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6D1/WbfQ7NLm7SV43kEYEQBOSCe5HpXP/APCw9J/5977/AL4T/wCKo+Kn/IvW/wD19L/6A9eWV8rm+b4jCYh0qTVrLofWZPk+GxeGVWqne76ns2geKrHXLx7a0iuUkSMyEyqoGAQOxPrW/Xlnwr/5GG4/69W/9DSvU69fKMVUxeHVWrvdnj5xhKeExLpUtrIKKKK9M8sKKKKACiiigAooooA//9k=";
const PROGRESSIVE = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAYACgDASIAAhEBAxEB/8QAGAABAQADAAAAAAAAAAAAAAAAAAYEBQf/xAAWAQEBAQAAAAAAAAAAAAAAAAAABAX/2gAMAwEAAhADEAAAAeg69LZWtZ58tU1xhVKAAB//xAAcEAACAgIDAAAAAAAAAAAAAAACAwAFBDQQFSD/2gAIAQEAAQUCe4UB2CojKB58WuvKrY9//8QAGREAAgMBAAAAAAAAAAAAAAAAAgMABBIg/9oACAEDAQE/AadNbV6KXFCpmR5//8QAGREAAgMBAAAAAAAAAAAAAAAAAgMABBIg/9oACAECAQE/AbdtimZGVGk1ei5//8QAHRAAAgEEAwAAAAAAAAAAAAAAAhEAEBIhcgEwMv/aAAgBAQAGPwK4mmsTyctHgmnmo7ULXo//xAAcEAEAAQQDAAAAAAAAAAAAAAABABAwobEx0fH/2gAIAQEAAT8hIClB5p3Hgg4BXA6aZHZY/9oADAMBAAIAAwAAABDhbzzzz//EABkRAQACAwAAAAAAAAAAAAAAAAEAESAxQf/aAAgBAwEBPxAObdvYr10Y/wD/xAAZEQEAAgMAAAAAAAAAAAAAAAABABEgMUH/2gAIAQIBAT8QdOVRyEt9uP8A/8QAGRABAAMBAQAAAAAAAAAAAAAAARFBURAw/9oACAEBAAE/EDH6ARZRbTORmH6SQgQpd9UaP//Z";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAACgAAAAYCAIAAAAH5iiXAAAATUlEQVR4nO3VIQ4AIAxD0dHgSTgvkvOScQP8HIhO0O8qlidX3N0yQopqgonVsNvoV/d7rjcYlhQEswJNCgmmhe/gon/MCjQpJJhWGnwA+AEI0Z1Jq1kAAAAASUVORK5CYII=";
const SECRET = "ZEBRA-7731 the question words";

const good = (o: Record<string, unknown> = {}) => ({
  version: 1, source: "keys",
  image: { mediaType: "image/jpeg", data: JPEG, width: 40, height: 24 },
  pointer: { x: 10, y: 8 },
  app: { name: "Figma", bundleId: "com.figma.Desktop" },
  messages: [{ role: "user", content: "What's on today?" }, { role: "assistant", content: "Two tasks.", tainted: false }, { role: "user", content: SECRET }],
  ...o,
});
const bytesOf = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));

describe("imageSize (contract D.6)", () => {
  it("reads a JPEG's frame header (baseline and progressive) and a PNG's IHDR", () => {
    expect(imageSize("image/jpeg", Buffer.from(JPEG, "base64"))).toEqual({ width: 40, height: 24 });
    expect(imageSize("image/jpeg", Buffer.from(PROGRESSIVE, "base64"))).toEqual({ width: 40, height: 24 });
    expect(imageSize("image/png", Buffer.from(PNG, "base64"))).toEqual({ width: 40, height: 24 });
  });

  it("junk, the wrong type or a cut-off file is null", () => {
    expect(imageSize("image/jpeg", Buffer.from(PNG, "base64"))).toBeNull();
    expect(imageSize("image/png", Buffer.from(JPEG, "base64"))).toBeNull();
    expect(imageSize("image/jpeg", Buffer.from(JPEG, "base64").subarray(0, 100))).toBeNull();
    expect(imageSize("image/png", Buffer.from(PNG, "base64").subarray(0, 20))).toBeNull();
    expect(imageSize("image/jpeg", Buffer.from("not a picture at all"))).toBeNull();
    expect(imageSize("image/webp", Buffer.from(JPEG, "base64"))).toBeNull();
    expect(imageSize("image/jpeg", Buffer.alloc(0))).toBeNull();
  });
});

describe("readLookBody (contract A.6, D.6)", () => {
  it("a good body: the look and the messages, the picture's metadata stripped", () => {
    const b = readLookBody(bytesOf(good()));
    expect(b.look.app).toEqual({ name: "Figma", bundleId: "com.figma.Desktop" });
    expect(b.look.pointer).toEqual({ x: 10, y: 8 });
    expect(b.look.source).toBe("keys");
    expect(b.look.image).toMatchObject({ mediaType: "image/jpeg", width: 40, height: 24 });
    expect(b.look.image.data).toBe(stripImageMetadata("image/jpeg", Buffer.from(JPEG, "base64"))!.toString("base64"));
    expect(b.messages.at(-1)).toEqual({ role: "user", content: SECRET });
    // A PNG, from the button (no pointer), an app with no bundle id.
    const p = readLookBody(bytesOf(good({ source: "button", pointer: null, image: { mediaType: "image/png", data: PNG, width: 40, height: 24 }, app: { name: "  My  App ", bundleId: null } })));
    expect(p.look).toMatchObject({ source: "button", pointer: null, app: { name: "My App", bundleId: null } });
  });

  const BAD: [string, unknown][] = [
    ["not JSON", "{ nope"],
    ["an array", [good()]],
    ["version 2", good({ version: 2 })],
    ["a third source", good({ source: "timer" })],
    ["another type", good({ image: { mediaType: "image/webp", data: JPEG, width: 40, height: 24 } })],
    ["a PNG called a JPEG", good({ image: { mediaType: "image/jpeg", data: PNG, width: 40, height: 24 } })],
    ["base64 with a line break", good({ image: { mediaType: "image/jpeg", data: `${JPEG.slice(0, 76)}\n${JPEG.slice(76)}`, width: 40, height: 24 } })],
    ["base64 with junk", good({ image: { mediaType: "image/jpeg", data: `${JPEG.slice(0, -4)}$$$$`, width: 40, height: 24 } })],
    ["a cut-off picture", good({ image: { mediaType: "image/jpeg", data: JPEG.slice(0, 400), width: 40, height: 24 } })],
    ["the wrong width", good({ image: { mediaType: "image/jpeg", data: JPEG, width: 41, height: 24 } })],
    ["the wrong height", good({ image: { mediaType: "image/jpeg", data: JPEG, width: 40, height: 25 } })],
    ["an edge under 16", good({ image: { mediaType: "image/jpeg", data: JPEG, width: 15, height: 24 } })],
    ["an edge over 2,576", good({ image: { mediaType: "image/jpeg", data: JPEG, width: 2577, height: 24 } })],
    ["over 3.6 megapixels", good({ image: { mediaType: "image/jpeg", data: JPEG, width: 2000, height: 1801 } })],
    ["a pointer outside", good({ pointer: { x: 40, y: 8 } })],
    ["a pointer below", good({ pointer: { x: 1, y: 24 } })],
    ["a negative pointer", good({ pointer: { x: -1, y: 8 } })],
    ["a fractional pointer", good({ pointer: { x: 1.5, y: 8 } })],
    ["no pointer field", (() => { const g = good(); delete (g as Record<string, unknown>).pointer; return g; })()],
    ["an empty app name", good({ app: { name: "   ", bundleId: null } })],
    ["an app name over 80", good({ app: { name: "x".repeat(81), bundleId: null } })],
    ["a control character in the name", good({ app: { name: "Fig\u0000ma", bundleId: null } })],
    ["a bad bundle id", good({ app: { name: "Figma", bundleId: "com figma" } })],
    ["an empty bundle id", good({ app: { name: "Figma", bundleId: "" } })],
    ["a bundle id over 255", good({ app: { name: "Figma", bundleId: "a".repeat(256) } })],
    ["no messages", good({ messages: [] })],
    ["31 messages", good({ messages: Array.from({ length: 31 }, () => ({ role: "user", content: SECRET })) })],
    ["a message over 4,000", good({ messages: [{ role: "user", content: `${SECRET}${"x".repeat(4000)}` }] })],
    ["the last message hers", good({ messages: [{ role: "user", content: SECRET }, { role: "assistant", content: "Sure." }] })],
    ["a system role", good({ messages: [{ role: "system", content: SECRET }] })],
  ];

  for (const [what, body] of BAD) {
    it(`refuses ${what}: one 422 LOOK_INVALID, no field errors, nothing from the body`, () => {
      let err: unknown;
      try { readLookBody(bytesOf(body)); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(AppError);
      const e = err as AppError;
      expect([e.status, e.code, e.message]).toEqual([422, "LOOK_INVALID", "That picture couldn't be read. Look again."]);
      expect(e.fieldErrors).toBeUndefined();
      expect(e.details).toBeUndefined();
      expect(JSON.stringify({ m: e.message, s: e.stack?.split("\n")[0] })).not.toMatch(/ZEBRA|Figma|\/9j\//);
    });
  }

  it("the schema caps the base64 at the decoded limit", () => {
    const big = "A".repeat(Math.ceil(2_621_440 / 3) * 4 + 4);
    expect(lookBodySchema.safeParse(good({ image: { mediaType: "image/jpeg", data: big, width: 40, height: 24 } })).success).toBe(false);
  });
});

describe("what owners and the logs see", () => {
  it("withoutImage takes the picture's tokens out of the input, never below 0, the rest as it was", () => {
    expect(withoutImage({ input_tokens: 5000, output_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 }, 1924))
      .toEqual({ input_tokens: 3076, output_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 });
    expect(withoutImage({ input_tokens: 100 }, 1924)).toEqual({ input_tokens: 0 });
    expect(withoutImage({ output_tokens: 3 }, 10)).toEqual({ output_tokens: 3, input_tokens: 0 });
    expect(withoutImage(null, 10)).toBeNull();
  });

  it("a never-look refusal names the rule, not what the body said", () => {
    const e = neverLookRefusal({ name: "Totally Not Slack", bundleId: "com.tinyspeck.slackmacgap" }, { workspace: [], you: [] });
    expect([e?.status, e?.code, e?.message]).toEqual([409, "LOOK_NEVER_LOOK", "I never look at Slack."]);
    expect(neverLookRefusal({ name: "Figma", bundleId: "com.figma.Desktop" }, { workspace: [], you: [] })).toBeNull();
  });

  it("a server log line about a failure carries its status, class and code, never its message", () => {
    const err = Object.assign(new Error(`bad request: ${SECRET}`), { status: 400, code: "invalid_request" });
    expect(lookErrorReason(err)).toBe("status 400, Error, invalid_request");
    expect(lookErrorReason(null)).toBe("unknown error");
    expect(lookErrorReason("ZEBRA-7731")).toBe("unknown error");
  });
});
