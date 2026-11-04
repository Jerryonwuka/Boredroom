// Brenda for Chrome: the service worker. It talks only to the Brenda Mac app over native messaging and drives
// Brenda's own tabs with chrome.debugger (CDP 1.3). The contract is PROTOCOL.md in this folder.
//
// Never log page text, typed text or URLs: console output is error codes only.

import { checkUrl, hostOf, isLandingAllowed } from "./lib/url.js";
import { classifyEffect } from "./lib/effect.js";
import { isCardField, isPasswordField, isSearchForm, isSensitiveField, isTextInputType } from "./lib/sensitive.js";
import { INPUT_ROLES, attributesToObject, finishElements, pickCandidates } from "./lib/elements.js";
import { ACTING_OPS, OpError, errorReply, eventMessage, okReply, validateRequest } from "./lib/messages.js";
import { keyEvents } from "./lib/keys.js";
import { MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_WIDTH, base64ByteLength, jpegSize } from "./lib/jpeg.js";

const HOST_NAME = "com.boredroom.browser";
const RECONNECT_MS = 5000;
const LOAD_LIMIT_MS = 20000;
const OP_LIMIT_MS = 30000;
const POLL_MS = 250;
const TEXT_LIMIT = 20000;
const GROUP_TITLE = "Brenda";
const WORLD_NAME = "brenda";
const OBJECT_GROUP = "brenda";

// ---------------------------------------------------------------------------------------------------------------
// Connection state. Tab ids (t1, t2, ...) and everything about her tabs live and die with one connection.

/** @type {null | { port: chrome.runtime.Port, hello: Promise<void>, tabs: Map<string, Tab>, byChrome: Map<number, Tab>, nextTab: number, inflight: Set<string> }} */
let conn = null;
let reconnectTimer = null;

/**
 * @typedef {{ wire: string, chromeId: number, attached: boolean, userDetached: boolean, refs: Map<string, {backendId: number, role: string, name: string}>,
 *   navCount: number, mainFrameId: string | null, worldId: number | null, landedBad: boolean, userHere: boolean, closing: boolean, queue: Promise<void> }} Tab
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function connect() {
  if (conn || reconnectTimer) return;
  let port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch {
    console.warn("NATIVE_CONNECT_FAILED");
    scheduleReconnect();
    return;
  }
  const c = { port, hello: Promise.resolve(), tabs: new Map(), byChrome: new Map(), nextTab: 1, inflight: new Set() };
  conn = c;
  port.onMessage.addListener((msg) => onRequest(c, msg));
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError; // read it so Chrome doesn't report it as unchecked
    onDisconnect(c);
  });
  // The hello goes first on every connection; replies and events wait for it.
  c.hello = sendHello(c);
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_MS);
}

async function onDisconnect(c) {
  if (conn === c) conn = null;
  console.warn("NATIVE_DISCONNECTED");
  // Leave her tabs open, but let go of them.
  const tabs = [...c.tabs.values()];
  c.tabs.clear();
  c.byChrome.clear();
  await Promise.all(tabs.map((tab) => detach(tab)));
  scheduleReconnect();
}

function post(c, msg) {
  if (conn !== c) return;
  try {
    c.port.postMessage(msg);
  } catch {
    console.warn("NATIVE_POST_FAILED");
  }
}

function postEvent(c, event, tab) {
  c.hello.then(() => post(c, eventMessage(event, tab)));
}

async function chromeVersion() {
  try {
    const data = await navigator.userAgentData.getHighEntropyValues(["fullVersionList"]);
    const brand = data.fullVersionList.find((b) => b.brand === "Google Chrome" || b.brand === "Chromium");
    if (brand) return brand.version;
  } catch {
    // Older Chrome: fall back to the user agent string.
  }
  const match = /Chrome\/([\d.]+)/.exec(navigator.userAgent);
  return match ? match[1] : "";
}

async function profileEmail() {
  try {
    const info = await chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
    return info && typeof info.email === "string" ? info.email : "";
  } catch {
    return "";
  }
}

async function sendHello(c) {
  const [chromeVer, profile] = await Promise.all([chromeVersion(), profileEmail()]);
  post(c, { v: 1, hello: { version: chrome.runtime.getManifest().version, chrome: chromeVer, profile } });
}

// ---------------------------------------------------------------------------------------------------------------
// Requests: validate, run with a time limit, answer exactly once.

function timeLimit(op, args) {
  if (op === "navigate") return LOAD_LIMIT_MS;
  if (op === "wait_for") return Math.min(args.ms + 5000, OP_LIMIT_MS);
  return OP_LIMIT_MS;
}

function withTimeout(promise, ms) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new OpError("TIMEOUT")), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

async function onRequest(c, msg) {
  await c.hello;
  const req = validateRequest(msg);
  if (!req.ok) {
    if (req.id === null) console.warn("BAD_REQUEST");
    else post(c, errorReply(req.id, req.error, req.message));
    return;
  }
  const { id, op, args } = req;
  // The first request with an id gets the one answer; a duplicate while it runs is dropped.
  if (c.inflight.has(id)) return;
  c.inflight.add(id);

  const run = () => withTimeout(Promise.resolve().then(() => HANDLERS[op](c, args)), timeLimit(op, args));
  // Ops on one tab run one at a time, so refs and focus aren't pulled from under each other.
  const tab = typeof args.tab === "string" ? c.tabs.get(args.tab) : undefined;
  let result;
  if (tab) {
    result = tab.queue.then(run);
    tab.queue = result.then(() => undefined, () => undefined);
  } else {
    result = run();
  }
  result.then(
    (out) => answer(c, id, okReply(id, out)),
    (err) => {
      const code = err instanceof OpError ? err.code : "FAILED";
      if (code === "FAILED" || code === "DEBUGGER" || code === "TIMEOUT") console.warn(op, code);
      answer(c, id, errorReply(id, code, err instanceof OpError ? err.message : undefined));
    },
  );
}

function answer(c, id, reply) {
  if (!c.inflight.delete(id)) return;
  post(c, reply);
}

// ---------------------------------------------------------------------------------------------------------------
// Tabs.

async function getTab(c, wire) {
  const tab = c.tabs.get(wire);
  if (!tab) throw new OpError("NO_TAB");
  try {
    await chrome.tabs.get(tab.chromeId);
  } catch {
    forgetTab(c, tab);
    throw new OpError("NO_TAB");
  }
  return tab;
}

function registerTab(c, chromeId) {
  const tab = {
    wire: `t${c.nextTab++}`, chromeId, attached: false, userDetached: false, refs: new Map(), navCount: 0,
    mainFrameId: null, worldId: null, landedBad: false, userHere: false, closing: false, queue: Promise.resolve(),
  };
  c.tabs.set(tab.wire, tab);
  c.byChrome.set(chromeId, tab);
  return tab;
}

function forgetTab(c, tab) {
  c.tabs.delete(tab.wire);
  if (c.byChrome.get(tab.chromeId) === tab) c.byChrome.delete(tab.chromeId);
}

function tabOf(chromeId) {
  return conn ? conn.byChrome.get(chromeId) : undefined;
}

// Brenda works in the window the person used last, without stealing focus; a new one only when there's none.
async function brendaWindow() {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    if (win && win.type === "normal") return { windowId: win.id, tabId: null };
  } catch {
    // No normal window open.
  }
  const win = await chrome.windows.create({ url: "about:blank", focused: false });
  return { windowId: win.id, tabId: win.tabs && win.tabs[0] ? win.tabs[0].id : null };
}

async function addToGroup(chromeId, windowId) {
  try {
    const [existing] = await chrome.tabGroups.query({ windowId, title: GROUP_TITLE });
    if (existing) {
      await chrome.tabs.group({ groupId: existing.id, tabIds: [chromeId] });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: [chromeId], createProperties: { windowId } });
    await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: "orange" });
  } catch {
    console.warn("GROUP_FAILED");
  }
}

// "The person is here": one of her tabs is the active tab of the focused window.
async function refreshPresence() {
  const c = conn;
  if (!c || c.tabs.size === 0) return;
  let activeId = null;
  try {
    const win = await chrome.windows.getLastFocused();
    if (win && win.focused) {
      const [active] = await chrome.tabs.query({ active: true, windowId: win.id });
      activeId = active ? active.id : null;
    }
  } catch {
    activeId = null;
  }
  for (const tab of c.tabs.values()) {
    const here = tab.chromeId === activeId;
    if (here && !tab.userHere) postEvent(c, "user_here", tab.wire);
    tab.userHere = here;
  }
}

async function assertNotUserHere(tab) {
  await refreshPresence();
  if (tab.userHere) throw new OpError("USER_HERE");
}

async function pageInfo(tab) {
  const t = await chrome.tabs.get(tab.chromeId);
  return { url: t.url || "", title: t.title || "" };
}

// Waits until Chrome says the tab finished loading; false when the time ran out first.
async function waitForLoad(tab, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t = await chrome.tabs.get(tab.chromeId).catch(() => null);
    if (!t) throw new OpError("NO_TAB");
    if (t.status === "complete") return true;
    await sleep(POLL_MS);
  }
  return false;
}

// After a click or a key: give the page a moment, and if it started a navigation, let it finish.
async function settle(tab, navBefore) {
  await sleep(300);
  const t = await chrome.tabs.get(tab.chromeId).catch(() => null);
  if (!t) throw new OpError("NO_TAB");
  if (tab.navCount !== navBefore || t.status === "loading") await waitForLoad(tab, 10000);
}

// ---------------------------------------------------------------------------------------------------------------
// The debugger.

async function cdp(tab, method, params = {}) {
  try {
    return await chrome.debugger.sendCommand({ tabId: tab.chromeId }, method, params);
  } catch (err) {
    const message = String(err && err.message);
    if (/not attached|detached/i.test(message)) {
      tab.attached = false;
      throw new OpError("DEBUGGER");
    }
    throw err;
  }
}

async function ensureAttached(tab) {
  if (tab.attached) return;
  if (tab.userDetached) throw new OpError("DEBUGGER", "The person stopped Brenda's control of Chrome.");
  try {
    await chrome.debugger.attach({ tabId: tab.chromeId }, "1.3");
  } catch {
    throw new OpError("DEBUGGER");
  }
  tab.attached = true;
  tab.worldId = null;
  await cdp(tab, "Page.enable");
  await cdp(tab, "DOM.enable");
  // Best effort: these keep a background tab behaving like a visible one (focus events, no freezing).
  await cdp(tab, "Accessibility.enable").catch(() => {});
  await cdp(tab, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await cdp(tab, "Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  const { frameTree } = await cdp(tab, "Page.getFrameTree");
  tab.mainFrameId = frameTree.frame.id;
}

async function detach(tab) {
  if (!tab.attached) return;
  tab.attached = false;
  try {
    await chrome.debugger.detach({ tabId: tab.chromeId });
  } catch {
    // Already gone.
  }
}

// Scripts run in an isolated world so the page can't tamper with the DOM methods Brenda relies on.
async function worldId(tab) {
  if (tab.worldId) return tab.worldId;
  const { executionContextId } = await cdp(tab, "Page.createIsolatedWorld", { frameId: tab.mainFrameId, worldName: WORLD_NAME, grantUniveralAccess: false });
  tab.worldId = executionContextId;
  return executionContextId;
}

async function evaluate(tab, expression) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const contextId = await worldId(tab);
      const r = await cdp(tab, "Runtime.evaluate", { expression, contextId, returnByValue: true });
      if (r.exceptionDetails) throw new Error("evaluate");
      return r.result.value;
    } catch (err) {
      if (err instanceof OpError || attempt >= 1) throw err;
      tab.worldId = null; // the page navigated and the world went with it
    }
  }
}

async function resolveBackend(tab, backendNodeId) {
  try {
    const { object } = await cdp(tab, "DOM.resolveNode", { backendNodeId, executionContextId: await worldId(tab), objectGroup: OBJECT_GROUP });
    return object.objectId;
  } catch (err) {
    if (err instanceof OpError) throw err;
    tab.worldId = null;
  }
  try {
    const { object } = await cdp(tab, "DOM.resolveNode", { backendNodeId, executionContextId: await worldId(tab), objectGroup: OBJECT_GROUP });
    return object.objectId;
  } catch (err) {
    if (err instanceof OpError) throw err;
  }
  // Not in the main frame's world (an element inside a frame): the page's own world is the only way in.
  const { object } = await cdp(tab, "DOM.resolveNode", { backendNodeId, objectGroup: OBJECT_GROUP });
  return object.objectId;
}

async function resolveRef(tab, ref) {
  const entry = tab.refs.get(ref);
  if (!entry) throw new OpError("STALE_REF");
  try {
    return { entry, objectId: await resolveBackend(tab, entry.backendId) };
  } catch (err) {
    if (err instanceof OpError) throw err;
    throw new OpError("STALE_REF");
  }
}

async function callOn(tab, objectId, fn, args = []) {
  const r = await cdp(tab, "Runtime.callFunctionOn", {
    objectId, functionDeclaration: fn.toString(), arguments: args.map((value) => ({ value })), returnByValue: true,
  });
  if (r.exceptionDetails) throw new OpError("FAILED");
  return r.result.value;
}

function releaseObjects(tab) {
  cdp(tab, "Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP }).catch(() => {});
}

// A page Brenda's tab lands on must be one she may open; otherwise stop it and go back to a blank page.
async function stopBadLanding(tab, committed) {
  tab.landedBad = true;
  tab.refs.clear();
  if (!tab.attached) {
    await chrome.tabs.update(tab.chromeId, { url: "about:blank" }).catch(() => {});
    return;
  }
  await cdp(tab, "Page.stopLoading").catch(() => {});
  if (committed) await cdp(tab, "Page.navigate", { url: "about:blank" }).catch(() => {});
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tab = tabOf(source.tabId);
  if (!tab) return;
  if (method === "Page.frameRequestedNavigation") {
    if (params.frameId === tab.mainFrameId && !isLandingAllowed(params.url)) stopBadLanding(tab, false);
  } else if (method === "Page.frameNavigated") {
    if (params.frame.parentId) return;
    tab.mainFrameId = params.frame.id;
    tab.navCount += 1;
    tab.worldId = null;
    tab.refs.clear(); // the old page's elements are gone
    if (!isLandingAllowed(params.frame.url + (params.frame.urlFragment || ""))) stopBadLanding(tab, true);
  } else if (method === "Page.javascriptDialogOpening") {
    // A dialog would block the page; dismissing it is the cautious answer (it also cancels "leave this page?").
    cdp(tab, "Page.handleJavaScriptDialog", { accept: false }).catch(() => {});
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tab = tabOf(source.tabId);
  if (!tab) return;
  tab.attached = false;
  tab.worldId = null;
  // The person pressed Cancel on Chrome's "is debugging this browser" bar: respect that for this connection.
  if (reason === "canceled_by_user") tab.userDetached = true;
});

// ---------------------------------------------------------------------------------------------------------------
// Functions that run in the page (isolated world). They return facts, never field values.

function pageDescribe() {
  // The function is sent as source text, so it can't call helpers outside itself; name the element once.
  // eslint-disable-next-line @typescript-eslint/no-this-alias
  const el = this;
  const lower = (s) => (typeof s === "string" ? s.toLowerCase() : "");
  const tag = lower(el.localName);
  const attr = (n) => (el.getAttribute ? el.getAttribute(n) : null);
  const form = el.form || (el.closest ? el.closest("form") : null);
  const fieldOf = (f) => ({
    tag: lower(f.localName),
    inputType: lower(f.localName) === "input" ? lower(f.getAttribute("type") || "text") : lower(f.localName),
    autocomplete: f.getAttribute("autocomplete") || "",
    name: f.getAttribute("name") || "",
    id: f.id || "",
    role: f.getAttribute("role") || "",
    placeholder: f.getAttribute("placeholder") || "",
    ariaLabel: f.getAttribute("aria-label") || "",
    inSearchLandmark: Boolean(f.closest && f.closest('[role="search"], search')),
  });
  let fields = [];
  let submitName = "";
  if (form) {
    fields = Array.from(form.elements || []).slice(0, 300).map(fieldOf);
    const btn = form.querySelector('button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]');
    if (btn) submitName = (btn.getAttribute("aria-label") || (btn.localName === "input" ? btn.value : btn.textContent) || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }
  const keep = ["type", "autocomplete", "name", "id", "role", "placeholder", "aria-label", "title"];
  const attributes = {};
  for (const n of keep) {
    const v = attr(n);
    if (v !== null) attributes[n] = v.slice(0, 300);
  }
  const t = lower(attr("type"));
  if (tag === "input" && (t === "submit" || t === "button" || t === "reset" || t === "image")) attributes.value = (el.value || "").slice(0, 200);
  return {
    tag,
    inputType: tag === "input" ? lower(attr("type") || "text") : null,
    attributes,
    inForm: Boolean(form),
    formRole: form ? form.getAttribute("role") || "" : "",
    fields,
    submitName,
    inSearchLandmark: Boolean(el.closest && el.closest('[role="search"], search')),
    href: (tag === "a" || tag === "area") && el.href ? String(el.href) : null,
    downloadAttr: el.hasAttribute && el.hasAttribute("download") ? el.getAttribute("download") : null,
    formAction: form && form.action ? String(form.action) : "",
    pageUrl: String(location.href),
    editable: Boolean(el.isContentEditable),
    disabled: Boolean(el.disabled),
  };
}

// Selects the field's current text so insertText replaces it.
function pageSelectContents() {
  if (typeof this.select === "function") {
    this.select();
    return true;
  }
  if (this.isContentEditable) {
    const range = document.createRange();
    range.selectNodeContents(this);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }
  return false;
}

function pageChooseOption(want) {
  if (this.localName !== "select") return { error: "NOT_SELECT" };
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();
  const options = Array.from(this.options);
  const option = options.find((o) => norm(o.text) === norm(want)) || options.find((o) => norm(o.text).toLowerCase() === norm(want).toLowerCase());
  if (!option) return { error: "NO_OPTION" };
  if (option.disabled || this.disabled) return { error: "DISABLED" };
  this.value = option.value;
  this.dispatchEvent(new Event("input", { bubbles: true }));
  this.dispatchEvent(new Event("change", { bubbles: true }));
  return { value: option.value };
}

// Whether the element at the click point is the target or inside it (shadow roots included).
function pageContains(hit) {
  for (let node = hit; node; node = node.parentNode || node.host) {
    if (node === this) return true;
  }
  return false;
}

const TEXT_EXPRESSION = `(() => {
  const t = document.body ? document.body.innerText : "";
  return { text: t.slice(0, ${TEXT_LIMIT}), truncated: t.length > ${TEXT_LIMIT} };
})()`;

// ---------------------------------------------------------------------------------------------------------------
// Element facts shared by describe, click and type.

async function elementFacts(tab, ref, action = "click") {
  const { entry, objectId } = await resolveRef(tab, ref);
  const dom = await callOn(tab, objectId, pageDescribe);
  let role = entry.role;
  let name = entry.name;
  try {
    const { nodes } = await cdp(tab, "Accessibility.getPartialAXTree", { backendNodeId: entry.backendId, fetchRelatives: false });
    const node = nodes.find((n) => n.backendDOMNodeId === entry.backendId && !n.ignored) || nodes[0];
    if (node && node.role) role = String(node.role.value ?? role);
    if (node && node.name && node.name.value !== undefined) name = String(node.name.value);
  } catch {
    // Keep what read_page saw.
  }
  const field = dom.tag === "input" || dom.tag === "textarea"
    ? { inputType: dom.tag === "input" ? dom.inputType : "textarea", autocomplete: dom.attributes.autocomplete || "", name: dom.attributes.name || "", id: dom.attributes.id || "" }
    : null;
  const sensitive = isSensitiveField(field);
  const info = {
    role, name, tag: dom.tag, inputType: dom.inputType, attributes: dom.attributes, inForm: dom.inForm,
    formHasPassword: dom.fields.some(isPasswordField),
    formHasCardFields: dom.fields.some(isCardField),
    searchForm: dom.inForm && isSearchForm({ role: dom.formRole, fields: dom.fields }),
    inSearchLandmark: dom.inSearchLandmark,
    formSubmitName: dom.submitName,
    href: dom.href,
    downloadAttr: dom.downloadAttr,
    editable: dom.editable,
  };
  const effect = classifyEffect(info, action);
  const host = dom.href ? hostOf(dom.href) : dom.inForm && dom.formAction ? hostOf(dom.formAction) : hostOf(dom.pageUrl);
  return { entry, objectId, dom, role, name, sensitive, effect, host };
}

async function viewportSize(tab) {
  const m = await cdp(tab, "Page.getLayoutMetrics");
  const v = m.cssVisualViewport || m.visualViewport || {};
  const l = m.cssLayoutViewport || m.layoutViewport || {};
  return { width: v.clientWidth || l.clientWidth, height: v.clientHeight || l.clientHeight, pageX: v.pageX || 0, pageY: v.pageY || 0 };
}

// The middle of the element's first visible box, after scrolling it into view.
async function clickPoint(tab, backendNodeId) {
  try {
    await cdp(tab, "DOM.scrollIntoViewIfNeeded", { backendNodeId });
    const { quads } = await cdp(tab, "DOM.getContentQuads", { backendNodeId });
    const vp = await viewportSize(tab);
    for (const q of quads || []) {
      const xs = [q[0], q[2], q[4], q[6]];
      const ys = [q[1], q[3], q[5], q[7]];
      const width = Math.max(...xs) - Math.min(...xs);
      const height = Math.max(...ys) - Math.min(...ys);
      if (width < 1 || height < 1) continue;
      const x = xs.reduce((a, b) => a + b, 0) / 4;
      const y = ys.reduce((a, b) => a + b, 0) / 4;
      if (x >= 0 && y >= 0 && x < vp.width && y < vp.height) return { x, y };
    }
  } catch (err) {
    if (err instanceof OpError) throw err;
  }
  throw new OpError("NOT_VISIBLE");
}

// Make sure the click lands on the element the app described, not on an overlay drawn over it.
async function assertHitsTarget(tab, objectId, point) {
  try {
    const { backendNodeId } = await cdp(tab, "DOM.getNodeForLocation", { x: Math.round(point.x), y: Math.round(point.y), includeUserAgentShadowDOM: false });
    const hitId = await resolveBackend(tab, backendNodeId);
    const r = await cdp(tab, "Runtime.callFunctionOn", { objectId, functionDeclaration: pageContains.toString(), arguments: [{ objectId: hitId }], returnByValue: true });
    if (r.result && r.result.value === true) return;
  } catch (err) {
    if (err instanceof OpError) throw err;
  }
  throw new OpError("NOT_VISIBLE");
}

async function pressKey(tab, key) {
  for (const event of keyEvents(key)) await cdp(tab, "Input.dispatchKeyEvent", event);
}

function assertLandedWell(tab) {
  if (tab.landedBad) throw new OpError("BAD_URL");
}

// ---------------------------------------------------------------------------------------------------------------
// Ops.

async function opStatus(c) {
  return { tabs: c.tabs.size };
}

async function opOpenTab(c, args) {
  const url = checkUrl(args.url);
  if (!url) throw new OpError("BAD_URL");
  const started = Date.now();
  const target = await brendaWindow();
  const created = target.tabId !== null ? { id: target.tabId } : await chrome.tabs.create({ windowId: target.windowId, url: "about:blank", active: false });
  const tab = registerTab(c, created.id);
  const giveUp = async (code) => {
    tab.closing = true;
    await detach(tab);
    forgetTab(c, tab);
    await chrome.tabs.remove(created.id).catch(() => {});
    throw new OpError(code);
  };
  await addToGroup(created.id, target.windowId);
  try {
    await ensureAttached(tab);
  } catch {
    return giveUp("DEBUGGER");
  }
  const nav = await cdp(tab, "Page.navigate", { url }).catch(() => ({ errorText: "navigate" }));
  if (nav.errorText) return giveUp("FAILED");
  const loaded = await waitForLoad(tab, Math.max(0, LOAD_LIMIT_MS - (Date.now() - started)));
  if (tab.landedBad) return giveUp("BAD_URL");
  const info = await pageInfo(tab);
  return loaded ? { tab: tab.wire, ...info } : { tab: tab.wire, ...info, loading: true };
}

async function opNavigate(c, args) {
  const tab = await getTab(c, args.tab);
  const url = checkUrl(args.url);
  if (!url) throw new OpError("BAD_URL");
  await assertNotUserHere(tab);
  await ensureAttached(tab);
  tab.landedBad = false;
  tab.refs.clear();
  const nav = await cdp(tab, "Page.navigate", { url });
  if (nav.errorText) throw new OpError("FAILED", "The page couldn't be loaded.");
  if (!(await waitForLoad(tab, LOAD_LIMIT_MS - 500))) throw new OpError("TIMEOUT");
  assertLandedWell(tab);
  return pageInfo(tab);
}

async function domFacts(tab, backendIds) {
  const out = new Map();
  await Promise.all(backendIds.map(async (backendNodeId) => {
    try {
      const { node } = await cdp(tab, "DOM.describeNode", { backendNodeId });
      out.set(backendNodeId, { tag: String(node.localName || "").toLowerCase(), attributes: attributesToObject(node.attributes) });
    } catch (err) {
      if (err instanceof OpError) throw err;
      // Unknown: elements.js then hides the value.
    }
  }));
  return out;
}

async function opReadPage(c, args) {
  const tab = await getTab(c, args.tab);
  await ensureAttached(tab);
  const { nodes } = await cdp(tab, "Accessibility.getFullAXTree");
  const candidates = pickCandidates(nodes);
  const dom = await domFacts(tab, candidates.filter((x) => INPUT_ROLES.has(x.role)).map((x) => x.backendId));
  const { elements, refs } = finishElements(candidates, dom, { find: args.find });
  tab.refs = refs;
  const page = (await evaluate(tab, TEXT_EXPRESSION)) || { text: "", truncated: false };
  const info = await pageInfo(tab);
  return { url: info.url, title: info.title, text: String(page.text || ""), truncated: Boolean(page.truncated), elements };
}

function base64ToBytes(b64, max) {
  const bin = atob(b64.slice(0, Math.ceil((max * 4) / 3)));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function capture(tab, vp, scale, quality) {
  const { data } = await cdp(tab, "Page.captureScreenshot", {
    format: "jpeg", quality, captureBeyondViewport: false,
    clip: { x: vp.pageX, y: vp.pageY, width: vp.width, height: vp.height, scale },
  });
  // The frame header sits near the start; 64 KB covers any sane EXIF or table block before it.
  const size = jpegSize(base64ToBytes(data, 65536));
  if (!size) throw new OpError("FAILED");
  return { data, ...size };
}

async function opScreenshot(c, args) {
  const tab = await getTab(c, args.tab);
  await ensureAttached(tab);
  const vp = await viewportSize(tab);
  const dpr = Number(await evaluate(tab, "window.devicePixelRatio")) || 1;
  let scale = Math.min(1, MAX_SCREENSHOT_WIDTH / (vp.width * dpr));
  let shot = await capture(tab, vp, scale, 60);
  if (shot.width > MAX_SCREENSHOT_WIDTH) {
    scale *= MAX_SCREENSHOT_WIDTH / shot.width;
    shot = await capture(tab, vp, scale, 60);
  }
  // A very busy page can exceed the size cap at quality 60; one smaller retry, then give up.
  if (base64ByteLength(shot.data) > MAX_SCREENSHOT_BYTES) shot = await capture(tab, vp, scale * 0.75, 45);
  if (base64ByteLength(shot.data) > MAX_SCREENSHOT_BYTES || shot.width > MAX_SCREENSHOT_WIDTH) throw new OpError("FAILED", "The screenshot was too large.");
  return { jpeg: shot.data, width: shot.width, height: shot.height };
}

async function opDescribe(c, args) {
  const tab = await getTab(c, args.tab);
  await ensureAttached(tab);
  try {
    const f = await elementFacts(tab, args.ref, args.action || "click");
    return { role: f.role, name: f.name, tag: f.dom.tag, inputType: f.dom.inputType, inForm: f.dom.inForm, sensitive: f.sensitive, effect: f.effect, host: f.host };
  } finally {
    releaseObjects(tab);
  }
}

async function opClick(c, args) {
  const tab = await getTab(c, args.tab);
  await assertNotUserHere(tab);
  await ensureAttached(tab);
  try {
    const { entry, objectId } = await resolveRef(tab, args.ref);
    const point = await clickPoint(tab, entry.backendId);
    await assertHitsTarget(tab, objectId, point);
    const before = tab.navCount;
    tab.landedBad = false;
    const base = { x: point.x, y: point.y, button: "left", clickCount: 1 };
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mousePressed", ...base, buttons: 1 });
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseReleased", ...base, buttons: 0 });
    await settle(tab, before);
    assertLandedWell(tab);
    return { ...(await pageInfo(tab)), navigated: tab.navCount !== before };
  } finally {
    releaseObjects(tab);
  }
}

async function opType(c, args) {
  const tab = await getTab(c, args.tab);
  await assertNotUserHere(tab);
  await ensureAttached(tab);
  try {
    // Checked against the live element, not read_page's copy: the page may have changed the field since.
    const f = await elementFacts(tab, args.ref);
    if (f.sensitive) throw new OpError("SENSITIVE");
    const takesText = (f.dom.tag === "input" && isTextInputType(f.dom.inputType)) || f.dom.tag === "textarea" || f.dom.editable;
    if (!takesText || f.dom.disabled) throw new OpError("FAILED", "That element doesn't take text.");
    await cdp(tab, "DOM.scrollIntoViewIfNeeded", { backendNodeId: f.entry.backendId }).catch(() => {});
    try {
      await cdp(tab, "DOM.focus", { backendNodeId: f.entry.backendId });
    } catch (err) {
      if (err instanceof OpError) throw err;
      throw new OpError("NOT_VISIBLE");
    }
    await callOn(tab, f.objectId, pageSelectContents);
    if (args.text === "") await pressKey(tab, "Backspace");
    else await cdp(tab, "Input.insertText", { text: args.text });
    tab.landedBad = false;
    if (args.enter === true) {
      const before = tab.navCount;
      await pressKey(tab, "Enter");
      await settle(tab, before);
    }
    assertLandedWell(tab);
    return pageInfo(tab);
  } finally {
    releaseObjects(tab);
  }
}

async function opSelect(c, args) {
  const tab = await getTab(c, args.tab);
  await assertNotUserHere(tab);
  await ensureAttached(tab);
  try {
    const { objectId } = await resolveRef(tab, args.ref);
    const r = await callOn(tab, objectId, pageChooseOption, [args.option]);
    if (!r || r.error === "NOT_SELECT") throw new OpError("FAILED", "That element isn't a list to choose from.");
    if (r.error === "NO_OPTION") throw new OpError("FAILED", "That option isn't in the list.");
    if (r.error) throw new OpError("FAILED", "That list or option is turned off.");
    return { value: String(r.value) };
  } finally {
    releaseObjects(tab);
  }
}

async function opPress(c, args) {
  const tab = await getTab(c, args.tab);
  await assertNotUserHere(tab);
  await ensureAttached(tab);
  const before = tab.navCount;
  tab.landedBad = false;
  await pressKey(tab, args.key);
  await sleep(150);
  if (tab.navCount !== before) await settle(tab, before);
  assertLandedWell(tab);
  return {};
}

async function opScroll(c, args) {
  const tab = await getTab(c, args.tab);
  await assertNotUserHere(tab);
  await ensureAttached(tab);
  if (args.dir === "top" || args.dir === "bottom") {
    await evaluate(tab, args.dir === "top" ? "window.scrollTo(0, 0)" : "window.scrollTo(0, document.documentElement.scrollHeight)");
  } else {
    // A wheel over the middle of the page also scrolls apps whose content sits in an inner scrolling box.
    const vp = await viewportSize(tab);
    const delta = Math.round(vp.height * 0.8) * (args.dir === "up" ? -1 : 1);
    await cdp(tab, "Input.dispatchMouseEvent", { type: "mouseWheel", x: vp.width / 2, y: vp.height / 2, deltaX: 0, deltaY: delta });
  }
  await sleep(200);
  return {};
}

async function opWaitFor(c, args) {
  const tab = await getTab(c, args.tab);
  if (typeof args.text !== "string" || args.text.trim() === "") {
    await sleep(args.ms);
    return { found: true };
  }
  await ensureAttached(tab);
  const want = args.text.toLowerCase();
  const end = Date.now() + args.ms;
  for (;;) {
    const page = await evaluate(tab, TEXT_EXPRESSION.replace(`.slice(0, ${TEXT_LIMIT})`, "")).catch((err) => {
      if (err instanceof OpError) throw err;
      return null; // mid-navigation; try again
    });
    if (page && String(page.text).toLowerCase().includes(want)) return { found: true };
    if (Date.now() + POLL_MS > end) return { found: false };
    await sleep(POLL_MS);
  }
}

async function opCloseTab(c, args) {
  const tab = await getTab(c, args.tab);
  tab.closing = true; // she closed it, so no tab_closed event
  await detach(tab);
  forgetTab(c, tab);
  await chrome.tabs.remove(tab.chromeId).catch(() => {});
  return {};
}

const HANDLERS = {
  status: opStatus,
  open_tab: opOpenTab,
  navigate: opNavigate,
  read_page: opReadPage,
  screenshot: opScreenshot,
  describe: opDescribe,
  click: opClick,
  type: opType,
  select: opSelect,
  press: opPress,
  scroll: opScroll,
  wait_for: opWaitFor,
  close_tab: opCloseTab,
};

// Every acting op must check presence first; fail loudly at startup if one is missing a handler.
for (const op of ACTING_OPS) if (!HANDLERS[op]) throw new Error(`missing handler ${op}`);

// ---------------------------------------------------------------------------------------------------------------
// Chrome events.

chrome.tabs.onRemoved.addListener((chromeId) => {
  const c = conn;
  const tab = tabOf(chromeId);
  if (!c || !tab) return;
  forgetTab(c, tab);
  if (!tab.closing) postEvent(c, "tab_closed", tab.wire);
});

// Chrome swaps in a prerendered tab under a new id; she keeps it.
chrome.tabs.onReplaced.addListener((addedId, removedId) => {
  const c = conn;
  const tab = tabOf(removedId);
  if (!c || !tab) return;
  c.byChrome.delete(removedId);
  tab.chromeId = addedId;
  tab.attached = false;
  tab.worldId = null;
  tab.refs.clear();
  c.byChrome.set(addedId, tab);
});

// A backstop for landings the debugger didn't see (for example while it was detached).
chrome.tabs.onUpdated.addListener((chromeId, change) => {
  const tab = tabOf(chromeId);
  if (tab && typeof change.url === "string" && !isLandingAllowed(change.url)) stopBadLanding(tab, true);
});

chrome.tabs.onActivated.addListener(() => {
  refreshPresence();
});
chrome.windows.onFocusChanged.addListener(() => {
  refreshPresence();
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
