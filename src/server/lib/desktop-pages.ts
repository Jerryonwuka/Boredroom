/**
 * The tiny self-contained pages Boredroom for Mac's window passes through (owner request, 24 October 2026: option A;
 * spec §6.3, §6.5): route handlers, so every visit is a full page load the app sees, with no external resources (inline
 * CSS with the v4 tokens: the canvas #0F0F10, Inter falling back to system-ui, light via prefers-color-scheme), never
 * cached (`no-store`) and never sending a Referer. Server-only.
 */

/** Text for HTML (and attribute values). */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const CSS = `
:root{color-scheme:dark light;--bg:#0f0f10;--fg:#fff;--secondary:rgb(255 255 255/.64);--border:rgb(255 255 255/.1);--fill:rgb(255 255 255/.043)}
@media (prefers-color-scheme:light){:root{--bg:#fff;--fg:#0f0f10;--secondary:rgb(0 0 0/.6);--border:rgb(0 0 0/.1);--fill:rgb(0 0 0/.043)}}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg);color:var(--fg);font:500 14px/20px Inter,system-ui,-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;padding:20px}
main{max-width:400px;width:100%;text-align:center}
h1{font-size:20px;line-height:28px;font-weight:600;margin:0}
p{margin:8px 0 0;color:var(--secondary);font-weight:400}
.later{display:none;margin-top:24px}.later.on{display:block}
a.button{display:inline-flex;align-items:center;justify-content:center;min-height:40px;padding:0 16px;border-radius:9999px;border:1px solid var(--border);background:var(--fill);color:var(--fg);text-decoration:none;margin-top:16px}
a.button:focus-visible{outline:2px solid #ff6c02;outline-offset:2px}
`;

export function desktopHtml(o: { title: string; body: string; head?: string; script?: string; status?: number }): Response {
  const html = `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>${escapeHtml(o.title)}</title>${o.head ?? ""}<style>${CSS}</style></head>`
    + `<body><main>${o.body}</main>${o.script ? `<script>${o.script}</script>` : ""}</body></html>`;
  return new Response(html, { status: o.status ?? 200, headers: desktopHeaders({ "content-type": "text/html; charset=utf-8" }) });
}

export function desktopHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex", ...extra });
}

/** A 303 to a path on this site, with the same headers. */
export function desktopRedirect(req: Request, path: string): Response {
  const base = process.env.APP_ORIGIN ?? new URL(req.url).origin;
  return new Response(null, { status: 303, headers: desktopHeaders({ location: new URL(path, base).toString() }) });
}
