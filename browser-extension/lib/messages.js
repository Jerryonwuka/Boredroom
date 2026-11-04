// The wire messages (PROTOCOL.md, Messages and Ops): request checks, replies, events and error codes.

export const PROTOCOL_VERSION = 1;

export const ERROR_CODES = ["BAD_REQUEST", "NO_TAB", "STALE_REF", "NOT_VISIBLE", "SENSITIVE", "BAD_URL", "USER_HERE", "TIMEOUT", "DEBUGGER", "FAILED"];

// Plain words for the person; never page text or URLs.
export const ERROR_MESSAGES = {
  BAD_REQUEST: "That request wasn't understood.",
  NO_TAB: "That tab isn't one of Brenda's, or it was closed.",
  STALE_REF: "That element isn't on the page any more. Read the page again.",
  NOT_VISIBLE: "That element can't be seen or something is covering it.",
  SENSITIVE: "Brenda doesn't type into password, card or code fields.",
  BAD_URL: "Brenda only opens ordinary web pages (http or https, without a password in the address).",
  USER_HERE: "The person is using that tab right now.",
  TIMEOUT: "That took too long.",
  DEBUGGER: "Couldn't control that tab. DevTools may be open on it.",
  FAILED: "That didn't work.",
};

/** The error an op answers with: a code from ERROR_CODES and an optional plain message. */
export class OpError extends Error {
  constructor(code, message) {
    super(message || ERROR_MESSAGES[code] || ERROR_MESSAGES.FAILED);
    this.code = ERROR_CODES.includes(code) ? code : "FAILED";
  }
}

export const KEYS = ["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Home", "End", "Backspace"];
// Return goes only through `type` with enter: true, so the app's describe check always sees the field (4 Nov 2026).
export const PRESS_KEYS = KEYS.filter((key) => key !== "Enter");
export const SCROLL_DIRS = ["up", "down", "top", "bottom"];
export const DESCRIBE_ACTIONS = ["click", "enter", "select"];
export const MAX_WAIT_MS = 20000;

/** Ops that act on the page; they answer USER_HERE while the person has the tab in front of them. */
export const ACTING_OPS = new Set(["click", "type", "select", "press", "scroll", "navigate"]);

const TAB_ID = /^t[1-9]\d{0,8}$/;
const REF_ID = /^e[1-9]\d{0,8}$/;

const isString = (max) => (v) => typeof v === "string" && v.length <= max;
const optional = (check) => (v) => v === undefined || check(v);
const RULES = {
  tab: (v) => typeof v === "string" && TAB_ID.test(v),
  ref: (v) => typeof v === "string" && REF_ID.test(v),
  url: isString(8192),
  text: isString(20000),
  option: isString(1000),
  find: isString(500),
  enter: (v) => typeof v === "boolean",
  key: (v) => PRESS_KEYS.includes(v),
  dir: (v) => SCROLL_DIRS.includes(v),
  action: (v) => DESCRIBE_ACTIONS.includes(v),
  ms: (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_WAIT_MS,
};

// Each op's args: required unless listed as optional.
export const OPS = {
  status: { required: [], optional: [] },
  open_tab: { required: ["url"], optional: [] },
  navigate: { required: ["tab", "url"], optional: [] },
  read_page: { required: ["tab"], optional: ["find"] },
  screenshot: { required: ["tab"], optional: [] },
  describe: { required: ["tab", "ref"], optional: ["action"] },
  click: { required: ["tab", "ref"], optional: [] },
  type: { required: ["tab", "ref", "text"], optional: ["enter"] },
  select: { required: ["tab", "ref", "option"], optional: [] },
  press: { required: ["tab", "key"], optional: [] },
  scroll: { required: ["tab", "dir"], optional: [] },
  wait_for: { required: ["tab", "ms"], optional: ["text"] },
  close_tab: { required: ["tab"], optional: [] },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function bad(id, message) {
  return { ok: false, id, error: "BAD_REQUEST", message: message || ERROR_MESSAGES.BAD_REQUEST };
}

/**
 * Checks a request from the app. Returns { ok: true, id, op, args } or { ok: false, id, error, message }, where id is
 * null when the request had no usable id (there's nothing to answer to then).
 */
export function validateRequest(msg) {
  if (!isPlainObject(msg)) return bad(null);
  const id = typeof msg.id === "string" && msg.id.length > 0 && msg.id.length <= 64 ? msg.id : null;
  if (msg.v !== PROTOCOL_VERSION) return bad(id, "Unsupported protocol version.");
  if (id === null) return bad(null);
  if (typeof msg.op !== "string" || !Object.hasOwn(OPS, msg.op)) return bad(id, "Unknown op.");
  const args = msg.args === undefined ? {} : msg.args;
  if (!isPlainObject(args)) return bad(id, "args must be an object.");
  const rule = OPS[msg.op];
  for (const name of rule.required) {
    if (!RULES[name](args[name])) return bad(id, `Missing or invalid ${name}.`);
  }
  for (const name of rule.optional) {
    if (!optional(RULES[name])(args[name])) return bad(id, `Invalid ${name}.`);
  }
  return { ok: true, id, op: msg.op, args };
}

export function okReply(id, out) {
  return { v: PROTOCOL_VERSION, id, ok: true, out };
}

export function errorReply(id, code, message) {
  const error = ERROR_CODES.includes(code) ? code : "FAILED";
  return { v: PROTOCOL_VERSION, id, ok: false, error, message: message || ERROR_MESSAGES[error] };
}

export function eventMessage(event, tab) {
  return { v: PROTOCOL_VERSION, event, tab };
}
