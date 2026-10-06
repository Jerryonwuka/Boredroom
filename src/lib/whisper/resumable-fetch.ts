/**
 * A `fetch` for the model download that survives a dropped connection (owner decision, 5 October 2026).
 *
 * transformers.js downloads each model file in one request; on a slow or unreliable link (tested at 64 KB/s, where the
 * 31 MB decoder takes minutes) one dropped connection lost all progress and dictation never became ready. This keeps
 * what has arrived and asks the server for the rest (`Range: bytes=N-`, which Hugging Face's CDN supports), retrying
 * with growing pauses. The library still sees one complete response with the original length, so its progress
 * reporting and browser caching are unchanged. Requests that already carry a Range header, and non-GET requests, pass
 * straight through.
 */

const MAX_FAILURES_WITHOUT_PROGRESS = 8;
const pause = (attempt: number) => new Promise((r) => setTimeout(r, Math.min(15_000, 1000 * 2 ** (attempt - 1))));

function urlOf(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** One request, retried while the network itself fails (no response at all). */
async function attempt(url: string, init: RequestInit | undefined, range: number | null): Promise<Response> {
  for (let failures = 1; ; failures++) {
    try {
      const headers = new Headers(init?.headers);
      if (range !== null) headers.set("Range", `bytes=${range}-`);
      return await fetch(url, { ...init, headers });
    } catch (err) {
      if (failures >= MAX_FAILURES_WITHOUT_PROGRESS) throw err;
      await pause(failures);
    }
  }
}

export async function resumableFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" || new Headers(init?.headers).has("Range")) return fetch(input, init);

  const url = urlOf(input);
  const first = await attempt(url, init, null);
  const total = Number(first.headers.get("content-length")) || 0;
  // Errors, unknown sizes and empty bodies go back as they are; only a known-length body can be resumed.
  if (!first.ok || first.status !== 200 || !first.body || !total) return first;

  let received = 0;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let current: Response = first;
      let failures = 0;
      for (;;) {
        try {
          const reader = current.body!.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            failures = 0;
            controller.enqueue(value);
          }
          if (received >= total) { controller.close(); return; }
          throw new Error("The connection closed before the file finished.");
        } catch (err) {
          if (++failures > MAX_FAILURES_WITHOUT_PROGRESS) { controller.error(err); return; }
          await pause(failures);
          try {
            const next = await attempt(url, init, received);
            // 206 is the rest of the file. Anything else (a server that ignores ranges) cannot be stitched safely.
            if (next.status !== 206 || !next.body) { controller.error(err); return; }
            current = next;
          } catch (retryErr) {
            controller.error(retryErr); return;
          }
        }
      }
    },
  });
  return new Response(body, { status: 200, statusText: "OK", headers: first.headers });
}
