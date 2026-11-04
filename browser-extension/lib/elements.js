// read_page's elements: the interesting nodes of Chrome's accessibility tree, given refs e1, e2, ... (PROTOCOL.md, Refs).

import { isSensitiveField } from "./sensitive.js";

export const MAX_ELEMENTS = 400;
// Names are labels, not content; a page could otherwise stuff megabytes into one aria-label.
export const MAX_NAME_LENGTH = 500;

const KEEP_ROLES = new Set([
  "link", "button", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio", "switch", "slider",
  "spinbutton", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "heading", "treeitem",
]);

// Roles whose name is just their own text, or a copy of another element's name.
const SKIP_ROLES = new Set(["StaticText", "InlineTextBox", "LineBreak", "RootWebArea", "WebArea", "LabelText", "none", "presentation", "row"]);

/** Roles that hold typed text; their DOM attributes decide whether the value is sensitive. */
export const INPUT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);

function axValue(field) {
  return field && field.value !== undefined && field.value !== null ? field.value : undefined;
}

function axProperty(node, name) {
  const found = (node.properties || []).find((p) => p.name === name);
  return found ? axValue(found.value) : undefined;
}

// The tree's nodes in document order (depth first from the root), falling back to the array order.
function inDocumentOrder(nodes) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const root = nodes.find((n) => !n.parentId) || nodes[0];
  if (!root) return [];
  const ordered = [];
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node.nodeId)) continue;
    seen.add(node.nodeId);
    ordered.push(node);
    const children = (node.childIds || []).map((id) => byId.get(id)).filter(Boolean);
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return ordered.length > 1 ? ordered : nodes;
}

/** Candidates from Accessibility.getFullAXTree's nodes: [{ backendId, role, name, value, href }] in document order. */
export function pickCandidates(nodes) {
  if (!Array.isArray(nodes)) return [];
  const out = [];
  const seenBackend = new Set();
  for (const node of inDocumentOrder(nodes)) {
    if (node.ignored || !node.backendDOMNodeId || seenBackend.has(node.backendDOMNodeId)) continue;
    const role = String(axValue(node.role) ?? "");
    const name = String(axValue(node.name) ?? "").replace(/\s+/g, " ").trim();
    if (!KEEP_ROLES.has(role) && !(name && !SKIP_ROLES.has(role))) continue;
    seenBackend.add(node.backendDOMNodeId);
    const value = axValue(node.value);
    const href = axProperty(node, "url");
    out.push({
      backendId: node.backendDOMNodeId,
      role,
      name,
      value: value === undefined || value === "" ? null : String(value),
      href: typeof href === "string" && href !== "" ? href : null,
    });
  }
  return out;
}

/** DOM.describeNode's flat [name, value, name, value] attribute list as an object. */
export function attributesToObject(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (let i = 0; i + 1 < list.length; i += 2) out[String(list[i]).toLowerCase()] = String(list[i + 1]);
  return out;
}

/** The sensitive-field facts of a DOM node { tag, attributes }, or null when it isn't an input or textarea. */
export function fieldFromDom(dom) {
  if (!dom || (dom.tag !== "input" && dom.tag !== "textarea")) return null;
  const attrs = dom.attributes || {};
  return {
    inputType: dom.tag === "input" ? (attrs.type || "text").toLowerCase() : "textarea",
    autocomplete: attrs.autocomplete || "",
    name: attrs.name || "",
    id: attrs.id || "",
  };
}

function findWords(find) {
  return typeof find === "string" ? find.toLowerCase().split(/\s+/).filter(Boolean) : [];
}

function matchesFind(element, words) {
  if (!words.length) return true;
  const haystack = `${element.name} ${element.value ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * The elements list and its refs. domById: Map backendId -> { tag, attributes } for the input-like candidates.
 * Returns { elements, refs: Map ref -> { backendId, role, name } }.
 */
export function finishElements(candidates, domById, options = {}) {
  const max = options.max ?? MAX_ELEMENTS;
  const words = findWords(options.find);
  const elements = [];
  const refs = new Map();
  for (const c of candidates) {
    if (elements.length >= max) break;
    const dom = domById ? domById.get(c.backendId) : undefined;
    const field = fieldFromDom(dom);
    const sensitive = isSensitiveField(field);
    // A typed-text field whose DOM we couldn't see may be a password box: don't repeat its value.
    const unknownField = INPUT_ROLES.has(c.role) && !dom;
    const element = {
      ref: "",
      role: c.role,
      name: c.name.slice(0, MAX_NAME_LENGTH),
      value: sensitive || unknownField || c.value === null ? null : c.value.slice(0, MAX_NAME_LENGTH),
      inputType: dom && dom.tag === "input" ? field.inputType : null,
      sensitive,
      href: c.href ?? (dom?.attributes?.href || null),
    };
    if (!matchesFind(element, words)) continue;
    element.ref = `e${elements.length + 1}`;
    elements.push(element);
    refs.set(element.ref, { backendId: c.backendId, role: c.role, name: c.name });
  }
  return { elements, refs };
}
