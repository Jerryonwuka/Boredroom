// The PDF page's one script (contract B.9.4, C.1, should; owner request, 12 October 2026). See render.html. Plain JavaScript,
// loadable by Node for the unit tests (`Render` needs a document only when set() is called).
const Render = (() => {
  // The tags markdownToHtml writes (contract D.9), and nothing else. Every attribute is dropped, so no link, image,
  // style or handler survives; anything else is replaced by its text.
  const KEEP = new Set(["H1", "H2", "H3", "P", "UL", "OL", "LI", "STRONG", "B", "EM", "I", "CODE", "PRE", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "BR", "HR", "BLOCKQUOTE"]);
  function clean(node) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;
      if (child.nodeType !== 1 || !KEEP.has(child.tagName)) { child.replaceWith(document.createTextNode(child.nodeType === 1 && !/^(SCRIPT|STYLE|TEMPLATE|IFRAME|OBJECT|EMBED)$/.test(child.tagName) ? child.textContent : "")); continue; }
      for (const a of [...child.attributes]) child.removeAttribute(a.name);
      clean(child);
    }
  }
  function set(html) {
    // Parsed in a separate, inert document (nothing in it runs or loads), cleaned, then moved in.
    const doc = new DOMParser().parseFromString(typeof html === "string" ? html.slice(0, 2_000_000) : "", "text/html");
    clean(doc.body);
    document.body.replaceChildren(...[...doc.body.childNodes].map((n) => document.adoptNode(n)));
    return true;
  }
  return Object.freeze({ set });
})();
if (typeof window === "object" && window) window.Render = Render;
if (typeof module === "object" && module && module.exports) module.exports = Render;
