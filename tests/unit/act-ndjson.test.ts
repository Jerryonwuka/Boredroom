/**
 * The streamed answer's framing (owner request, 12 October 2026: "short spoken answers first, streamed"; contract
 * B.3.3, D.5): one JSON object per line; an error before the first line is an ordinary error response (thrown); after
 * it, an `error` line and the end; a ping while nothing else goes.
 */
import { describe, expect, it } from "vitest";
import { NDJSON_HEADERS, ndjsonLine, ndjsonResponse, readNdjson } from "@/server/lib/ndjson";
import { AppError } from "@/server/lib/errors";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ndjsonResponse", () => {
  it("frames each line as JSON and a line feed, line separators kept inside strings", async () => {
    expect(new TextDecoder().decode(ndjsonLine({ t: "text", d: "a\nb c" }))).toBe(`${JSON.stringify({ t: "text", d: "a\nb c" })}\n`);
    const res = await ndjsonResponse(async (write) => { write({ t: "text", d: "Hi." }); await sleep(5); write({ t: "done", result: { reply: "Hi." } }); }, { onError: () => ({}) });
    expect(res.headers.get("content-type")).toBe(NDJSON_HEADERS["content-type"]);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(await readNdjson(res)).toEqual([{ t: "text", d: "Hi." }, { t: "done", result: { reply: "Hi." } }]);
  });
  it("an error before the first line is thrown (the route answers an ordinary error)", async () => {
    await expect(ndjsonResponse(async () => { throw new AppError(429, "LOOK_LIMIT", "limit"); }, { onError: () => ({}) })).rejects.toMatchObject({ code: "LOOK_LIMIT" });
  });
  it("an error after the first line becomes an error line, with the fixed words onError gives", async () => {
    const res = await ndjsonResponse(async (write) => { write({ t: "text", d: "Hi" }); await sleep(5); throw new Error("ZEBRA secret words"); },
      { onError: () => ({ status: 502, code: "LOOK_FAILED", message: "Boredroom couldn't answer just now." }) });
    const lines = await readNdjson(res);
    expect(lines).toEqual([{ t: "text", d: "Hi" }, { t: "error", status: 502, code: "LOOK_FAILED", message: "Boredroom couldn't answer just now." }]);
    expect(JSON.stringify(lines)).not.toContain("ZEBRA");
  });
  it("pings while nothing else is written", async () => {
    const res = await ndjsonResponse(async (write) => { write({ t: "text", d: "a" }); await sleep(260); write({ t: "done" }); }, { onError: () => ({}), pingMs: 100 });
    const lines = await readNdjson(res);
    expect(lines[0]).toEqual({ t: "text", d: "a" });
    expect(lines.filter((l) => l.t === "ping").length).toBeGreaterThanOrEqual(1);
    expect(lines[lines.length - 1]).toEqual({ t: "done" });
  });
  it("a cancelled stream aborts the run and drops later writes", async () => {
    let aborted = false;
    const res = await ndjsonResponse(async (write, signal) => { write({ t: "text", d: "a" }); signal.addEventListener("abort", () => { aborted = true; }); await sleep(30); write({ t: "text", d: "b" }); }, { onError: () => ({}) });
    await res.body!.cancel();
    await sleep(40);
    expect(aborted).toBe(true);
  });
});
