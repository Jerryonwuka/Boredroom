/**
 * Brenda in Chrome, end to end on this computer (owner decisions, 4 November 2026: phase 2): a throwaway Chromium (from
 * Playwright, its own profile folder) loads browser-extension/, starts the Mac app's real relay
 * (desktop/src-tauri/target/debug/brenda-desktop, built with `cargo build`) as its native messaging host, and the relay
 * connects to this script's socket, which plays the Mac app. Local pages play the websites: a checkout form, a password
 * field, a search box, a link. Every operation in browser-extension/PROTOCOL.md is tried, with the refusals.
 *
 * Nothing touches the person's own Chrome, their profile or a running Brenda: the host manifest goes in the throwaway
 * profile, and the relay is pointed at this script's socket (BRENDA_BROWSER_SOCKET, honoured by debug builds only).
 * Run: npx tsx scripts/check-browser-extension.mts
 */
import { createServer as httpServer } from "node:http";
import { createServer as netServer, type Socket } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const ext = join(root, "browser-extension");
const relay = join(root, "desktop/src-tauri/target/debug/brenda-desktop");
const id = readFileSync(join(ext, "EXTENSION_ID"), "utf8").trim();
const dir = mkdtempSync(join(tmpdir(), "bx-"));
const sock = join(dir, "b.sock");
const profile = join(dir, "profile");
mkdirSync(join(profile, "NativeMessagingHosts"), { recursive: true });
// The host Chromium starts: a wrapper that notes each start (for the diagnosis below), then the real relay.
const wrapper = join(dir, "host.sh");
writeFileSync(wrapper, `#!/bin/sh\necho "started $1" >> "${join(dir, "host.log")}"\nexec "${relay}" "$@"\n`, { mode: 0o755 });
const manifest = JSON.stringify({ name: "com.boredroom.browser", description: "test", path: wrapper, type: "stdio", allowed_origins: [`chrome-extension://${id}/`] });
writeFileSync(join(profile, "NativeMessagingHosts", "com.boredroom.browser.json"), manifest);

const PAGES: Record<string, string> = {
  "/form": `<!doctype html><title>Checkout</title><h1>Checkout</h1>
    <form action="/paid" method="get"><label>Card number <input name="cardnumber" autocomplete="cc-number"></label><button type="submit">Pay £42.00</button></form>
    <form action="/login" method="get"><label>Email <input name="email" type="email"></label><label>Password <input id="pw" name="pw" type="password"></label><button>Sign in</button></form>
    <form role="search" action="/search"><input type="search" name="q" aria-label="Search"></form>
    <a href="/next">Next page</a>`,
  "/next": `<!doctype html><title>Next</title><h1>Arrived</h1><p>Second page.</p>`,
};
const web = httpServer((req, res) => {
  const page = PAGES[(req.url ?? "/").split("?")[0]] ?? `<!doctype html><title>Other</title><p>${(req.url ?? "").split("?")[0].replace(/[<>&]/g, "")}</p>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page);
});
await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(web.address() as { port: number }).port}`;

// ---- the Mac app's side of the socket ------------------------------------------------------------------------------------
let conn: Socket | null = null;
let hello: Record<string, unknown> | null = null;
const waiting = new Map<string, (v: Record<string, unknown>) => void>();
const events: Record<string, unknown>[] = [];
let n = 0;
const frame = (v: unknown) => { const b = Buffer.from(JSON.stringify(v)); const h = Buffer.alloc(4); h.writeUInt32LE(b.length); return Buffer.concat([h, b]); };
const app = netServer((s) => {
  let buf = Buffer.alloc(0);
  let first = true;
  s.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
      const len = buf.readUInt32LE(0);
      const msg = JSON.parse(buf.subarray(4, 4 + len).toString("utf8")) as Record<string, unknown>;
      buf = buf.subarray(4 + len);
      if (first) { first = false; if ((msg.relay as { origin?: string })?.origin === `chrome-extension://${id}/`) conn = s; else s.destroy(); continue; }
      if (msg.hello) hello = msg.hello as Record<string, unknown>;
      else if (typeof msg.id === "string") waiting.get(msg.id)?.(msg);
      else events.push(msg);
    }
  });
});
await new Promise<void>((r) => app.listen(sock, r));

function call(op: string, args: Record<string, unknown> = {}, ms = 30_000): Promise<Record<string, unknown>> {
  const mid = String(++n);
  return new Promise((resolve) => {
    const t = setTimeout(() => { waiting.delete(mid); resolve({ ok: false, error: "NO_REPLY" }); }, ms);
    waiting.set(mid, (v) => { clearTimeout(t); waiting.delete(mid); resolve(v); });
    conn!.write(frame({ v: 1, id: mid, op, args }));
  });
}

// ---- Chromium with the extension -----------------------------------------------------------------------------------------
// Launched directly (Playwright's own launch blocks extensions), headless, in the throwaway profile; the extension is
// loaded over the DevTools protocol, which Chrome allows only with --enable-unsafe-extension-debugging (a test browser).
const exe = process.env.CHROMIUM_PATH ?? chromium.executablePath();
const chrome = spawn(exe, [
  "--headless=new", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--enable-unsafe-extension-debugging",
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { env: { ...process.env, BRENDA_BROWSER_SOCKET: sock }, stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise<string>((resolve, reject) => {
  let err = "";
  chrome.stderr!.on("data", (d) => { err += String(d); const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) resolve(m[1]); });
  setTimeout(() => reject(new Error("Chromium didn't start")), 20_000);
});
const browser = await chromium.connectOverCDP(wsUrl);
const cdp = await browser.newBrowserCDPSession();
const loaded = await cdp.send("Extensions.loadUnpacked" as never, { path: ext } as never).catch((e: Error) => ({ error: e.message }));

let failed = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` → ${JSON.stringify(detail).slice(0, 400)}`}`);
};

try {
  for (let i = 0; i < 100 && !(conn && hello); i++) await new Promise((r) => setTimeout(r, 200));
  check("the extension connects through the relay and says hello", !!conn && !!hello, { conn: !!conn, hello, loaded, host: (() => { try { return readFileSync(join(dir, "host.log"), "utf8"); } catch { return "never started"; } })() });
  if (!conn || !hello) throw new Error("no connection");

  check("status", (await call("status")).ok === true);
  const opened = await call("open_tab", { url: `${base}/form` });
  const tab = (opened.out as { tab?: string })?.tab ?? "";
  check("open_tab opens a tab of hers", opened.ok === true && /^t\d+$/.test(tab), opened);

  const read = await call("read_page", { tab, find: "" });
  const out = read.out as { title?: string; text?: string; elements?: { ref: string; role: string; name: string; sensitive: boolean; value: unknown }[] };
  check("read_page gives the text and elements with refs", read.ok === true && out?.title === "Checkout" && (out?.text ?? "").includes("Checkout") && (out?.elements?.length ?? 0) > 3, read);
  const el = (pred: (e: { ref: string; role: string; name: string; sensitive: boolean }) => boolean) => out?.elements?.find(pred)?.ref ?? "";
  const pay = el((e) => /pay/i.test(e.name) && e.role === "button");
  const card = el((e) => /card/i.test(e.name));
  const pw = el((e) => /password/i.test(e.name));
  const search = el((e) => /search/i.test(e.name) && e.role !== "search");
  const next = el((e) => e.role === "link" && /next/i.test(e.name));
  check("the elements include the pay button, card, password, search and link", !!(pay && card && pw && search && next), out?.elements);
  check("sensitive fields are marked and carry no value", out?.elements?.filter((e) => e.sensitive).every((e) => e.value === null) === true && !!out?.elements?.find((e) => e.ref === pw)?.sensitive, out?.elements?.filter((e) => e.sensitive));

  const effect = async (ref: string, action: string) => ((await call("describe", { tab, ref, action })).out as { effect?: string })?.effect;
  check("describe: the pay button pays", (await effect(pay, "click")) === "pay");
  check("describe: clicking into the card field is none, Return there pays", (await effect(card, "click")) === "none" && (await effect(card, "enter")) === "pay");
  check("describe: Return in the password field signs in", (await effect(pw, "enter")) === "sign_in");
  check("describe: Return in the search box is none", (await effect(search, "enter")) === "none");
  check("describe: the link is none", (await effect(next, "click")) === "none");

  const typedPw = await call("type", { tab, ref: pw, text: "hunter2", enter: false });
  check("type into a password field is refused (SENSITIVE)", typedPw.ok === false && typedPw.error === "SENSITIVE", typedPw);
  const typed = await call("type", { tab, ref: search, text: "invoices", enter: false });
  check("type into the search box", typed.ok === true, typed);
  check("press Enter is refused", (await call("press", { tab, key: "Enter" })).error === "BAD_REQUEST");
  check("press Escape", (await call("press", { tab, key: "Escape" })).ok === true);
  check("scroll", (await call("scroll", { tab, dir: "down" })).ok === true);

  const shot = await call("screenshot", { tab });
  check("screenshot of a background tab", shot.ok === true && typeof (shot.out as { jpeg?: string })?.jpeg === "string", { ok: shot.ok, error: shot.error, message: shot.message });

  const clicked = await call("click", { tab, ref: next });
  check("click the link navigates", clicked.ok === true, clicked);
  const waited = await call("wait_for", { tab, text: "Arrived", ms: 10_000 });
  check("wait_for finds the next page's text", waited.ok === true && (waited.out as { found?: boolean })?.found === true, waited);
  const stale = await call("click", { tab, ref: next });
  check("an old ref after navigating is STALE_REF", stale.error === "STALE_REF", stale);

  const nav = await call("navigate", { tab, url: `${base}/form` });
  check("navigate", nav.ok === true, nav);
  for (const url of ["file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.com/", "chrome://settings"]) {
    const r = await call("open_tab", { url });
    check(`open_tab ${url.split(":")[0]}… is BAD_URL`, r.ok === false && r.error === "BAD_URL", r);
  }
  check("an unknown tab is NO_TAB", (await call("read_page", { tab: "t99", find: "" })).error === "NO_TAB");
  check("an unknown op is BAD_REQUEST", (await call("format_disk", {})).error === "BAD_REQUEST");
  check("close_tab", (await call("close_tab", { tab })).ok === true);
} catch (err) {
  failed++;
  console.log("FAIL", (err as Error).message);
} finally {
  await browser.close().catch(() => undefined);
  chrome.kill();
  app.close(); web.close();
  await new Promise((r) => setTimeout(r, 500));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
