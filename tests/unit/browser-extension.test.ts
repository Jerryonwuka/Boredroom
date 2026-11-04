/**
 * Brenda for Chrome (Phase 2): the extension's pure logic in browser-extension/lib — effect guesses, sensitive fields,
 * URL refusals, read_page's elements and request checks (browser-extension/PROTOCOL.md).
 */
import { describe, expect, it } from "vitest";
import { classifyEffect, effectFromWords } from "../../browser-extension/lib/effect.js";
import { isSensitiveField, isCardField, isPasswordField, isSearchField, isSearchForm } from "../../browser-extension/lib/sensitive.js";
import { checkUrl, isLandingAllowed, hostOf } from "../../browser-extension/lib/url.js";
import { pickCandidates, finishElements, attributesToObject, MAX_ELEMENTS } from "../../browser-extension/lib/elements.js";
import { validateRequest, okReply, errorReply, eventMessage, OpError } from "../../browser-extension/lib/messages.js";
import { keyEvents } from "../../browser-extension/lib/keys.js";
import { jpegSize, base64ByteLength } from "../../browser-extension/lib/jpeg.js";

const button = (name: string, extra: Record<string, unknown> = {}) => ({ role: "button", name, tag: "button", inputType: null, attributes: { type: "button" }, inForm: false, ...extra });
const link = (name: string, href: string, extra: Record<string, unknown> = {}) => ({ role: "link", name, tag: "a", inputType: null, attributes: {}, inForm: false, href, downloadAttr: null, ...extra });
const field = (attributes: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  role: "textbox", name: "", tag: "input", inputType: (attributes.type || "text").toLowerCase(), attributes, inForm: true, ...extra,
});

describe("effect classification", () => {
  it("names pay, send, delete, sign in and accept terms from whole words", () => {
    expect(classifyEffect(button("Pay £42.00"))).toBe("pay");
    expect(classifyEffect(button("Buy now"))).toBe("pay");
    expect(classifyEffect(button("Place order"))).toBe("pay");
    expect(classifyEffect(button("Subscribe"))).toBe("pay");
    expect(classifyEffect(button("Send"))).toBe("send");
    expect(classifyEffect(button("Post reply"))).toBe("send");
    expect(classifyEffect(button("Invite teammates"))).toBe("send");
    expect(classifyEffect(button("Delete file"))).toBe("delete");
    expect(classifyEffect(button("Cancel subscription"))).toBe("delete");
    expect(classifyEffect(button("Unsubscribe"))).toBe("delete");
    expect(classifyEffect(button("Sign in"))).toBe("sign_in");
    expect(classifyEffect(button("Continue with Google"))).toBe("sign_in");
    expect(classifyEffect(button("Accept all cookies"))).toBe("accept_terms");
    expect(classifyEffect(button("I agree"))).toBe("accept_terms");
  });

  it("matches whole words only", () => {
    expect(classifyEffect(button("Sender settings"))).toBe("none");
    expect(classifyEffect(button("Repost history"))).toBe("none");
    expect(effectFromWords("Payment history")).toBeNull();
    expect(classifyEffect(link("Payment history", "https://shop.example/payments"))).toBe("none");
    expect(effectFromWords("SEND")).toBe("send");
  });

  it("treats plain links, tabs and menus as none, but a link that says pay is pay", () => {
    expect(classifyEffect(link("About us", "https://example.com/about"))).toBe("none");
    expect(classifyEffect({ role: "tab", name: "Message", tag: "div", attributes: {} })).toBe("none");
    expect(classifyEffect(link("Pay now", "https://example.com/pay"))).toBe("pay");
  });

  it("finds submit buttons and form effects", () => {
    expect(classifyEffect(button("Continue", { attributes: {}, inForm: true }))).toBe("submit");
    expect(classifyEffect({ role: "button", name: "Go", tag: "input", inputType: "submit", attributes: { type: "submit" }, inForm: false })).toBe("submit");
    expect(classifyEffect(button("Continue", { attributes: { type: "button" }, inForm: true }))).toBe("none");
    expect(classifyEffect(button("Continue", { attributes: {}, inForm: true, formHasCardFields: true }))).toBe("pay");
    expect(classifyEffect(button("Continue", { attributes: {}, inForm: true, formHasPassword: true }))).toBe("sign_in");
    expect(classifyEffect(button("Delete account", { attributes: {}, inForm: true, formHasPassword: true }))).toBe("delete");
  });

  it("counts Return in a form field as the form's submit", () => {
    expect(classifyEffect(field({ type: "email", name: "email" }), "enter")).toBe("submit");
    expect(classifyEffect(field({ type: "email", name: "email" }, { formHasPassword: true }), "enter")).toBe("sign_in");
    expect(classifyEffect(field({ name: "cardholder" }, { formHasCardFields: true }), "enter")).toBe("pay");
    expect(classifyEffect(field({ name: "body" }, { formSubmitName: "Post" }), "enter")).toBe("send");
    expect(classifyEffect(field({ name: "city" }, { inForm: false }), "enter")).toBe("none");
    expect(classifyEffect({ role: "textbox", name: "Notes", tag: "textarea", attributes: {}, inForm: true }, "enter")).toBe("none");
  });

  it("treats a search box or a search form as none", () => {
    expect(classifyEffect(field({ type: "search", name: "query" }), "enter")).toBe("none");
    expect(classifyEffect(field({ name: "q" }), "enter")).toBe("none");
    expect(classifyEffect(field({ placeholder: "Search products" }), "enter")).toBe("none");
    expect(classifyEffect(field({ "aria-label": "Search" }), "enter")).toBe("none");
    expect(classifyEffect(field({ name: "searchQuery" }), "enter")).toBe("none");
    expect(classifyEffect(field({ name: "query" }, { role: "searchbox" }), "enter")).toBe("none");
    expect(classifyEffect(field({ name: "query" }, { role: "combobox", inSearchLandmark: true }), "enter")).toBe("none");
    expect(classifyEffect(field({ name: "query" }, { searchForm: true }), "enter")).toBe("none");
    expect(classifyEffect(button("Search", { attributes: {}, inForm: true, searchForm: true }))).toBe("none");
    expect(classifyEffect(button("Search", { attributes: {}, inForm: true, searchForm: true }), "enter")).toBe("none");
    // "research" isn't the word search; a card form still pays.
    expect(classifyEffect(field({ name: "research" }), "enter")).toBe("submit");
    expect(classifyEffect(field({ name: "q" }, { formHasCardFields: true }), "enter")).toBe("pay");
  });

  it("action click: clicking into a field is none, buttons and submits keep their rules", () => {
    const login = { formHasPassword: true };
    expect(classifyEffect(field({ type: "password", name: "pw" }, login), "click")).toBe("none");
    expect(classifyEffect(field({ type: "password", name: "pw" }, login), "enter")).toBe("sign_in");
    expect(classifyEffect(field({ type: "password", name: "pw" }, login))).toBe("none"); // click is the default
    expect(classifyEffect(field({ type: "email", name: "email" }, { formHasCardFields: true }), "click")).toBe("none");
    expect(classifyEffect(field({ type: "date", name: "when" }), "click")).toBe("none");
    expect(classifyEffect({ role: "textbox", name: "Reply", tag: "textarea", attributes: {}, inForm: true }, "click")).toBe("none");
    expect(classifyEffect({ role: "combobox", name: "Send to", tag: "select", attributes: {}, inForm: true }, "click")).toBe("none");
    expect(classifyEffect({ role: "textbox", name: "Post a comment", tag: "div", attributes: {}, inForm: false, editable: true }, "click")).toBe("none");
    expect(classifyEffect(button("Sign in", { attributes: {}, inForm: true, formHasPassword: true }), "click")).toBe("sign_in");
    expect(classifyEffect(button("Continue", { attributes: {}, inForm: true, formHasPassword: true }), "click")).toBe("sign_in");
    expect(classifyEffect({ role: "button", name: "Go", tag: "input", inputType: "submit", attributes: { type: "submit" }, inForm: true }, "click")).toBe("submit");
    expect(classifyEffect({ role: "checkbox", name: "I agree to the terms", tag: "input", inputType: "checkbox", attributes: { type: "checkbox" }, inForm: true }, "click")).toBe("accept_terms");
    expect(classifyEffect({ role: "menuitem", name: "Delete", tag: "div", attributes: {} }, "click")).toBe("delete");
    expect(classifyEffect(link("Pay now", "https://example.com/pay"), "click")).toBe("pay");
  });

  it("action enter: fields follow their form, outside a form or in a textarea none, other elements their own rules", () => {
    expect(classifyEffect(field({ type: "text", name: "title" }), "enter")).toBe("submit");
    expect(classifyEffect(field({ type: "text", name: "title" }, { inForm: false }), "enter")).toBe("none");
    expect(classifyEffect({ role: "textbox", name: "Body", tag: "textarea", attributes: {}, inForm: true, formHasPassword: true }, "enter")).toBe("none");
    expect(classifyEffect(button("Send", { attributes: {}, inForm: true }), "enter")).toBe("send");
  });

  it("action select: choosing an option is always none", () => {
    expect(classifyEffect({ role: "combobox", name: "Plan", tag: "select", attributes: {}, inForm: true, formHasCardFields: true }, "select")).toBe("none");
    expect(classifyEffect(button("Pay now", { attributes: {}, inForm: true }), "select")).toBe("none");
  });

  it("decides search forms from role=search or a single search input", () => {
    expect(isSearchForm({ role: "search", fields: [] })).toBe(true);
    expect(isSearchForm({ role: "", fields: [{ tag: "input", inputType: "text", name: "q" }, { tag: "input", inputType: "submit" }] })).toBe(true);
    expect(isSearchForm({ role: "", fields: [{ tag: "input", inputType: "text", name: "q" }, { tag: "input", inputType: "email", name: "email" }] })).toBe(false);
    expect(isSearchField({ inputType: "search" })).toBe(true);
    expect(isSearchField({ inputType: "text", name: "username" })).toBe(false);
  });

  it("spots downloads", () => {
    expect(classifyEffect(link("Invoice", "https://example.com/files/inv-42.PDF?x=1"))).toBe("download");
    expect(classifyEffect(link("Get it", "https://example.com/app", { downloadAttr: "" }))).toBe("download");
    expect(classifyEffect(link("Report", "https://example.com/report.html"))).toBe("none");
  });

  it("answers none for nonsense", () => {
    expect(classifyEffect(null)).toBe("none");
    expect(classifyEffect({})).toBe("none");
  });
});

describe("sensitive fields", () => {
  it("covers passwords, card and code autocomplete, and card/cvv/cvc/iban/ssn/pin names", () => {
    expect(isSensitiveField({ inputType: "password" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", autocomplete: "cc-number" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", autocomplete: "one-time-code" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", autocomplete: "section-a new-password" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", name: "cardNumber" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", id: "card_cvc" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", name: "cvv2" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", name: "iban" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", name: "ssn" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", name: "pin" })).toBe(true);
    expect(isSensitiveField({ inputType: "text", id: "pinCode" })).toBe(true);
  });

  it("leaves ordinary fields alone", () => {
    expect(isSensitiveField({ inputType: "email", name: "email", autocomplete: "email" })).toBe(false);
    expect(isSensitiveField({ inputType: "text", name: "shipping" })).toBe(false);
    expect(isSensitiveField({ inputType: "text", name: "spinner" })).toBe(false);
    expect(isSensitiveField({ inputType: "text", name: "className" })).toBe(false);
    expect(isSensitiveField(null)).toBe(false);
  });

  it("tells password fields from card fields", () => {
    expect(isPasswordField({ inputType: "password" })).toBe(true);
    expect(isPasswordField({ inputType: "text", name: "cardNumber" })).toBe(false);
    expect(isCardField({ autocomplete: "cc-exp" })).toBe(true);
    expect(isCardField({ name: "pin" })).toBe(false);
  });
});

describe("URLs", () => {
  it("allows http and https", () => {
    expect(checkUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(checkUrl("http://example.com")).toBe("http://example.com/");
  });

  it("refuses other schemes, credentials and junk", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "chrome://settings", "data:text/html,hi", "https://user:pw@x.com", "https://user@x.com", "ftp://x.com", "example.com", "", "https://"]) {
      expect(checkUrl(bad)).toBeNull();
    }
    expect(checkUrl(42)).toBeNull();
    expect(checkUrl(`https://x.com/${"a".repeat(9000)}`)).toBeNull();
  });

  it("lets about:blank and javascript: links through as non-landings, and nothing else", () => {
    expect(isLandingAllowed("about:blank")).toBe(true);
    expect(isLandingAllowed("javascript:void(0)")).toBe(true);
    expect(isLandingAllowed("https://ok.example")).toBe(true);
    expect(isLandingAllowed("data:text/html,x")).toBe(false);
    expect(isLandingAllowed("file:///x")).toBe(false);
    expect(hostOf("https://a.example:8443/x")).toBe("a.example:8443");
    expect(hostOf("nope")).toBe("");
  });
});

type AxNode = { nodeId: string; parentId?: string; childIds?: string[]; ignored?: boolean; role?: { value: string }; name?: { value: string }; value?: { value: string }; backendDOMNodeId?: number; properties?: { name: string; value: { value: string } }[] };

function axTree(children: Omit<AxNode, "parentId">[]): AxNode[] {
  const root: AxNode = { nodeId: "root", role: { value: "RootWebArea" }, name: { value: "Page" }, childIds: children.map((c) => c.nodeId), backendDOMNodeId: 1 };
  return [root, ...children.map((c) => ({ ...c, parentId: "root" }))];
}

describe("read_page elements", () => {
  const nodes = axTree([
    { nodeId: "1", role: { value: "heading" }, name: { value: "Checkout" }, backendDOMNodeId: 10 },
    { nodeId: "2", role: { value: "StaticText" }, name: { value: "Some text" }, backendDOMNodeId: 11 },
    { nodeId: "3", role: { value: "textbox" }, name: { value: "Email" }, value: { value: "jo@example.com" }, backendDOMNodeId: 12 },
    { nodeId: "4", role: { value: "textbox" }, name: { value: "Password" }, value: { value: "hunter2" }, backendDOMNodeId: 13 },
    { nodeId: "5", role: { value: "textbox" }, name: { value: "Card number" }, value: { value: "4242424242424242" }, backendDOMNodeId: 14 },
    { nodeId: "6", role: { value: "button" }, name: { value: "Pay £42.00" }, backendDOMNodeId: 15 },
    { nodeId: "7", role: { value: "link" }, name: { value: "Terms" }, backendDOMNodeId: 16, properties: [{ name: "url", value: { value: "https://shop.example/terms" } }] },
    { nodeId: "8", role: { value: "button" }, name: { value: "Hidden" }, ignored: true, backendDOMNodeId: 17 },
    { nodeId: "9", role: { value: "generic" }, name: { value: "" }, backendDOMNodeId: 18 },
  ]);
  const dom = new Map([
    [12, { tag: "input", attributes: attributesToObject(["type", "email", "name", "email"]) }],
    [13, { tag: "input", attributes: attributesToObject(["type", "password", "name", "pw"]) }],
    [14, { tag: "input", attributes: attributesToObject(["type", "text", "autocomplete", "cc-number"]) }],
  ]);

  it("keeps interesting nodes in document order, nulls sensitive values and gives fresh refs", () => {
    const { elements, refs } = finishElements(pickCandidates(nodes), dom, {});
    expect(elements.map((e: { name: string }) => e.name)).toEqual(["Page", "Checkout", "Email", "Password", "Card number", "Pay £42.00", "Terms"].filter((n) => n !== "Page"));
    expect(elements.map((e: { ref: string }) => e.ref)).toEqual(["e1", "e2", "e3", "e4", "e5", "e6"]);
    const byName = Object.fromEntries((elements as { name: string; href: string | null }[]).map((e) => [e.name, e]));
    expect(byName.Email).toMatchObject({ value: "jo@example.com", inputType: "email", sensitive: false });
    expect(byName.Password).toMatchObject({ value: null, inputType: "password", sensitive: true });
    expect(byName["Card number"]).toMatchObject({ value: null, sensitive: true });
    expect(byName.Terms.href).toBe("https://shop.example/terms");
    expect(refs.get("e5")).toMatchObject({ backendId: 15, role: "button" });
  });

  it("hides the value of a text field whose DOM couldn't be read", () => {
    const { elements } = finishElements(pickCandidates(nodes), new Map(), {});
    expect(elements.find((e: { name: string }) => e.name === "Email")?.value).toBeNull();
  });

  it("narrows with find (every word, case-insensitive, sensitive values never match)", () => {
    expect(finishElements(pickCandidates(nodes), dom, { find: "PAY" }).elements.map((e: { name: string }) => e.name)).toEqual(["Pay £42.00"]);
    expect(finishElements(pickCandidates(nodes), dom, { find: "jo@example" }).elements.map((e: { ref: string; name: string }) => [e.ref, e.name])).toEqual([["e1", "Email"]]);
    expect(finishElements(pickCandidates(nodes), dom, { find: "hunter2" }).elements).toEqual([]);
    expect(finishElements(pickCandidates(nodes), dom, { find: "card number" }).elements).toHaveLength(1);
  });

  it("caps the list at 400", () => {
    const many = axTree(Array.from({ length: 450 }, (_, i) => ({ nodeId: `n${i}`, role: { value: "link" }, name: { value: `Link ${i}` }, backendDOMNodeId: 100 + i })));
    const { elements, refs } = finishElements(pickCandidates(many), new Map(), {});
    expect(MAX_ELEMENTS).toBe(400);
    expect(elements).toHaveLength(400);
    expect(refs.size).toBe(400);
    expect(elements[399].name).toBe("Link 399");
  });
});

describe("request validation", () => {
  it("accepts well-formed requests", () => {
    expect(validateRequest({ v: 1, id: "17", op: "read_page", args: { tab: "t1" } })).toEqual({ ok: true, id: "17", op: "read_page", args: { tab: "t1" } });
    expect(validateRequest({ v: 1, id: "1", op: "status" })).toMatchObject({ ok: true, args: {} });
    expect(validateRequest({ v: 1, id: "2", op: "type", args: { tab: "t2", ref: "e3", text: "hello", enter: true } }).ok).toBe(true);
    expect(validateRequest({ v: 1, id: "3", op: "wait_for", args: { tab: "t1", ms: 20000 } }).ok).toBe(true);
    for (const action of ["click", "enter", "select", undefined]) {
      expect(validateRequest({ v: 1, id: "4", op: "describe", args: { tab: "t1", ref: "e1", action } }).ok).toBe(true);
    }
    expect(validateRequest({ v: 1, id: "4", op: "describe", args: { tab: "t1", ref: "e1", action: "submit" } })).toMatchObject({ ok: false, error: "BAD_REQUEST" });
  });

  it("refuses bad versions, ids, ops and args with BAD_REQUEST", () => {
    expect(validateRequest(null)).toMatchObject({ ok: false, id: null, error: "BAD_REQUEST" });
    expect(validateRequest({ v: 2, id: "1", op: "status" })).toMatchObject({ ok: false, id: "1", error: "BAD_REQUEST" });
    expect(validateRequest({ v: 1, id: 5, op: "status" })).toMatchObject({ ok: false, id: null });
    expect(validateRequest({ v: 1, id: "1", op: "eval", args: {} })).toMatchObject({ ok: false, id: "1" });
    expect(validateRequest({ v: 1, id: "1", op: "toString", args: {} })).toMatchObject({ ok: false });
    expect(validateRequest({ v: 1, id: "1", op: "read_page", args: [] })).toMatchObject({ ok: false });
    expect(validateRequest({ v: 1, id: "1", op: "read_page", args: { tab: "1" } })).toMatchObject({ ok: false });
    expect(validateRequest({ v: 1, id: "1", op: "click", args: { tab: "t1", ref: "x1" } })).toMatchObject({ ok: false });
    expect(validateRequest({ v: 1, id: "1", op: "scroll", args: { tab: "t1", dir: "left" } })).toMatchObject({ ok: false });
    expect(validateRequest({ v: 1, id: "1", op: "wait_for", args: { tab: "t1", ms: 20001 } })).toMatchObject({ ok: false });
    expect(validateRequest({ v: 1, id: "1", op: "type", args: { tab: "t1", ref: "e1", text: 5 } })).toMatchObject({ ok: false });
  });

  it("refuses press Enter (Return only goes through type with enter: true)", () => {
    expect(validateRequest({ v: 1, id: "1", op: "press", args: { tab: "t1", key: "Enter" } })).toMatchObject({ ok: false, error: "BAD_REQUEST" });
    expect(validateRequest({ v: 1, id: "1", op: "press", args: { tab: "t1", key: "Escape" } }).ok).toBe(true);
  });

  it("builds replies and events in the protocol's shapes", () => {
    expect(okReply("9", { tabs: 0 })).toEqual({ v: 1, id: "9", ok: true, out: { tabs: 0 } });
    expect(errorReply("9", "NO_TAB")).toMatchObject({ v: 1, id: "9", ok: false, error: "NO_TAB" });
    expect(errorReply("9", "WHATEVER").error).toBe("FAILED");
    expect(eventMessage("tab_closed", "t1")).toEqual({ v: 1, event: "tab_closed", tab: "t1" });
    expect(new OpError("STALE_REF").code).toBe("STALE_REF");
  });
});

describe("keys and screenshots", () => {
  it("makes key events for allowed keys only", () => {
    expect(keyEvents("Enter")?.[0]).toMatchObject({ type: "keyDown", text: "\r", windowsVirtualKeyCode: 13 });
    expect(keyEvents("Tab")?.[0]).toMatchObject({ type: "rawKeyDown", key: "Tab" });
    expect(keyEvents("a")).toBeNull();
  });

  it("reads JPEG sizes and base64 byte lengths", () => {
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xd0, 0x05, 0x00, 0x03, 0, 0, 0, 0]);
    expect(jpegSize(bytes)).toEqual({ width: 1280, height: 720 });
    expect(jpegSize(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
    expect(base64ByteLength(Buffer.from("hello!!").toString("base64"))).toBe(7);
  });
});
