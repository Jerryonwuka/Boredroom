"use client";

export type ApiError = { code: string; message: string; fieldErrors?: Record<string, string[]>; details?: Record<string, unknown>; requestId?: string; status: number };

export class ApiFailure extends Error {
  readonly error: ApiError;
  constructor(error: ApiError) { super(error.message); this.error = error; }
}

function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

/**
 * JSON fetch helper for the browser. Mutations carry an Idempotency-Key so a retry after a
 * timeout returns the committed result instead of duplicating work.
 */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string; signal?: AbortSignal; retries?: number } = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  const key = method !== "GET" ? (init.idempotencyKey ?? newKey()) : undefined;
  if (key) headers["Idempotency-Key"] = key;
  const retries = init.retries ?? (method === "GET" ? 0 : 2);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(path, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: init.signal, credentials: "same-origin" });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new ApiFailure({ status: res.status, code: data?.code ?? "HTTP_ERROR", message: data?.message ?? res.statusText, fieldErrors: data?.fieldErrors, details: data?.details, requestId: data?.requestId });
      return data as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof ApiFailure) throw err;
      if (init.signal?.aborted) throw err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Network error");
}

export function isApiFailure(err: unknown): err is ApiFailure { return err instanceof ApiFailure; }
