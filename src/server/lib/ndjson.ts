/**
 * A streamed answer, one JSON object per line (`application/x-ndjson`), for Brenda for Mac's look turn (owner request,
 * 12 October 2026: "short spoken answers first, streamed"; contract B.3.3, D.5).
 *
 * `ndjsonResponse(run, o)` starts `run(write, signal)` and waits for its first line before it answers: anything `run`
 * throws before then is thrown here, so the route answers an ordinary error response with its fixed words; once a line
 * has gone, a later failure becomes one `error` line (`o.onError` gives its fields, which must never carry the request's
 * words) and the stream ends. A `ping` line goes every 10 seconds while nothing else does, so proxies keep the request
 * open. When the Mac goes away, `signal` aborts and later writes are dropped.
 */

export type NdjsonLine = { t: string } & Record<string, unknown>;
export type NdjsonWrite = (line: NdjsonLine) => void;

const encoder = new TextEncoder();
export const NDJSON_HEADERS = {
  "content-type": "application/x-ndjson; charset=utf-8",
  "cache-control": "no-store",
  "x-accel-buffering": "no",
} as const;

/** One line's bytes: the object as JSON and a line feed (JSON.stringify never writes a raw line feed). */
export function ndjsonLine(line: NdjsonLine): Uint8Array {
  return encoder.encode(`${JSON.stringify(line)}\n`);
}

export async function ndjsonResponse(
  run: (write: NdjsonWrite, signal: AbortSignal) => Promise<void>,
  o: { onError: (err: unknown) => Record<string, unknown>; pingMs?: number; status?: number },
): Promise<Response> {
  const abort = new AbortController();
  const queue: Uint8Array[] = [];
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let started = false;
  let lastWrite = Date.now();
  let markStarted: () => void = () => undefined;
  const firstLine = new Promise<void>((resolve) => { markStarted = resolve; });

  const push = (bytes: Uint8Array) => {
    if (closed) return;
    lastWrite = Date.now();
    if (controller) {
      try { controller.enqueue(bytes); } catch { closed = true; }
    } else queue.push(bytes);
  };
  const write: NdjsonWrite = (line) => {
    if (closed) return;
    push(ndjsonLine(line));
    if (!started) { started = true; markStarted(); }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    try { controller?.close(); } catch { /* already closed */ }
  };
  const pingMs = o.pingMs ?? 10_000;
  const ping = setInterval(() => { if (started && Date.now() - lastWrite >= pingMs) push(ndjsonLine({ t: "ping" })); }, Math.max(50, Math.min(pingMs, 1_000)));

  const done = run(write, abort.signal).then(
    () => ({ ok: true as const }),
    (err: unknown) => ({ ok: false as const, err }),
  );

  const first = await Promise.race([firstLine.then(() => null), done]);
  if (first && !started) {
    clearInterval(ping);
    closed = true;
    if (!first.ok) throw first.err;
    // Nothing was written and nothing went wrong: an empty stream.
  }

  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      for (const b of queue.splice(0)) c.enqueue(b);
      if (closed) { try { c.close(); } catch { /* closed */ } return; }
      void done.then((r) => {
        if (!r.ok) push(ndjsonLine({ t: "error", ...o.onError(r.err) }));
        close();
      });
    },
    cancel() {
      closed = true;
      clearInterval(ping);
      abort.abort();
    },
  });
  return new Response(stream, { status: o.status ?? 200, headers: NDJSON_HEADERS });
}

/** Reads a streamed answer back into its lines (the tests, and anything server-side that needs it). */
export async function readNdjson(res: Response): Promise<NdjsonLine[]> {
  const text = await res.text();
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as NdjsonLine);
}
