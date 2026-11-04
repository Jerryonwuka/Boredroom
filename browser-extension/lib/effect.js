// describe.effect: the extension's best guess at what pressing or submitting an element does (PROTOCOL.md).
// The Mac app refuses to act on anything that isn't "none" unless the person was asked, so when in doubt this
// leans towards naming an effect.

import { isSearchField, isTextInputType } from "./sensitive.js";

export const EFFECTS = ["pay", "send", "delete", "sign_in", "accept_terms", "submit", "download", "none"];

// Checked in this order: the costliest consequence wins when a name says two things.
const WORDS = [
  ["pay", ["buy", "pay", "purchase", "checkout", "check out", "place order", "place your order", "subscribe", "donate"]],
  ["delete", ["delete", "remove", "discard", "cancel subscription", "cancel my subscription", "close account", "close my account", "unsubscribe"]],
  ["sign_in", ["sign in", "log in", "login", "continue with google", "continue with apple", "continue with microsoft"]],
  ["send", ["send", "post", "publish", "reply", "comment", "share", "tweet", "message", "invite"]],
  ["accept_terms", ["accept", "agree", "i agree", "consent", "allow"]],
];

const DOWNLOAD_EXTENSIONS = ["pdf", "zip", "csv", "xlsx", "docx", "dmg", "pkg", "exe"];

// Roles the protocol names as plain: tabs, menus, headings and fields (fields are handled through their form).
const PLAIN_ROLES = new Set(["tab", "tablist", "menu", "menubar", "heading", "listbox", "option", "combobox", "textbox", "searchbox", "spinbutton", "slider"]);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Whole words only, so "Sender settings" isn't send and "Payment history" isn't pay.
const PATTERNS = WORDS.map(([effect, phrases]) => [
  effect,
  phrases.map((phrase) => new RegExp(`(?<![\\p{L}\\p{N}])${phrase.split(" ").map(escapeRegExp).join("\\s+")}(?![\\p{L}\\p{N}])`, "iu")),
]);

/** The effect a name's words say, or null. */
export function effectFromWords(name) {
  if (typeof name !== "string" || name.trim() === "") return null;
  const text = name.replace(/[‘’]/g, "'");
  for (const [effect, patterns] of PATTERNS) {
    if (patterns.some((pattern) => pattern.test(text))) return effect;
  }
  return null;
}

function lower(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function isLink(info) {
  return lower(info.role) === "link" || ((lower(info.tag) === "a" || lower(info.tag) === "area") && Boolean(info.href));
}

/** A link with a download attribute, or one whose path ends in a file extension Brenda shouldn't fetch silently. */
export function isDownloadLink(info) {
  if (!isLink(info)) return false;
  if (info.downloadAttr !== null && info.downloadAttr !== undefined) return true;
  if (typeof info.href !== "string" || info.href === "") return false;
  let path;
  try {
    path = new URL(info.href).pathname;
  } catch {
    path = info.href.split(/[?#]/)[0];
  }
  path = path.toLowerCase();
  return DOWNLOAD_EXTENSIONS.some((ext) => path.endsWith(`.${ext}`));
}

/** Pressing it submits its form: <input type=submit|image>, <button type=submit>, or a type-less <button> in a form. */
export function isSubmitter(info) {
  const tag = lower(info.tag);
  const type = lower(info.attributes?.type ?? info.inputType ?? "");
  if (tag === "input") return type === "submit" || type === "image";
  if (tag === "button") return type === "submit" || (type === "" && Boolean(info.inForm));
  return Boolean(info.isDefault);
}

// A single-line text input, where Return submits the form.
function isTextEntry(info) {
  return lower(info.tag) === "input" && isTextInputType(info.inputType ?? info.attributes?.type ?? "text");
}

function isSearchElement(info) {
  return isSearchField({
    inputType: info.inputType,
    role: info.role,
    name: info.attributes?.name,
    id: info.attributes?.id,
    placeholder: info.attributes?.placeholder,
    ariaLabel: info.attributes?.["aria-label"],
    inSearchLandmark: info.inSearchLandmark,
  });
}

// What submitting the element's form does (Return in a field, or a submit button).
function formSubmitEffect(info, wordsEffect) {
  if (info.formHasCardFields) return "pay";
  if (wordsEffect) return wordsEffect;
  if (info.formHasPassword) return "sign_in";
  if (info.searchForm) return "none";
  return "submit";
}

export const ACTIONS = ["click", "enter", "select"];

// Inputs that are pressed rather than typed into; they keep the word and submit rules on a click.
const PRESSED_INPUT_TYPES = new Set(["button", "submit", "image", "reset", "checkbox", "radio"]);
const FIELD_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider", "listbox"]);

// Somewhere to type or choose: clicking into it only moves focus, so it does nothing by itself.
function isField(info) {
  const tag = lower(info.tag);
  if (tag === "input") return !PRESSED_INPUT_TYPES.has(lower(info.inputType ?? info.attributes?.type ?? "text"));
  return tag === "textarea" || tag === "select" || Boolean(info.editable) || FIELD_ROLES.has(lower(info.role));
}

/**
 * The effect of an action on an element. action: "click" (the default), "enter" (Return in it) or "select" (choosing
 * an option). info: { role, name, tag, inputType, attributes, inForm, formHasPassword, formHasCardFields, href,
 * downloadAttr } plus optional { searchForm, inSearchLandmark, formSubmitName, isDefault, editable }.
 */
export function classifyEffect(info, action = "click") {
  if (!info || typeof info !== "object") return "none";
  // Choosing an option never submits by itself.
  if (action === "select") return "none";
  const role = lower(info.role);
  const name = info.name || info.attributes?.["aria-label"] || info.attributes?.value || info.attributes?.title || "";

  if (action === "enter" && isTextEntry(info)) {
    // Return in a field submits its form; a search box (or a search form) only searches.
    if (!info.inForm) return "none";
    const searchForm = Boolean(info.searchForm) || isSearchElement(info);
    return formSubmitEffect({ ...info, searchForm }, effectFromWords(info.formSubmitName));
  }
  if (isField(info)) return "none";
  if (isDownloadLink(info)) return "download";

  const words = PLAIN_ROLES.has(role) ? null : effectFromWords(name);
  if (isSubmitter(info)) return formSubmitEffect(info, words);
  return words || "none";
}
