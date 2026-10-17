/**
 * The one HTML the server makes from a model's words (file work, owner request 12 October 2026; contract D.9): every
 * text node escaped; no tag, attribute, link or script from the model or the file reaches the page.
 */
import { describe, expect, it } from "vitest";
import { DOC_STYLE, escapeHtml, inlineHtml, markdownBody, markdownToHtml } from "@/server/lib/markdown-html";

describe("markdownToHtml", () => {
  it("headings, paragraphs, lists, bold, italic, code, fences and tables", () => {
    const md = "# Q3 brief\n\nRevenue **rose** by *4%* in `Q3`.\nStill one paragraph.\n\n## Points\n- one\n- two\n  wrapped\n\n1. first\n2) second\n\n```\nconst a = 1 < 2;\n```\n\n| Name | Total |\n|---|---:|\n| Ada | 3 |\n\n#### Deep";
    expect(markdownBody(md)).toBe([
      "<h1>Q3 brief</h1>",
      "<p>Revenue <strong>rose</strong> by <em>4%</em> in <code>Q3</code>. Still one paragraph.</p>",
      "<h2>Points</h2>",
      "<ul><li>one</li><li>two wrapped</li></ul>",
      "<ol><li>first</li><li>second</li></ol>",
      "<pre><code>const a = 1 &lt; 2;</code></pre>",
      "<table><thead><tr><th>Name</th><th>Total</th></tr></thead><tbody><tr><td>Ada</td><td>3</td></tr></tbody></table>",
      "<h3>Deep</h3>",
    ].join("\n"));
  });
  it("escapes <script>, attributes and HTML in every place", () => {
    const md = "<script>alert(1)</script>\n\n# <img src=x onerror=alert(1)>\n\n- <b onclick=\"x\">hi</b>\n\n`<script>`\n\n| <i>a</i> |\n|---|\n| \"q\" & 'r' |";
    const html = markdownBody(md);
    // No real tag or attribute: the words stay, as text.
    expect(html).not.toMatch(/<(?:script|img|b|i)[\s>]|onclick="/);
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&quot;q&quot; &amp; &#39;r&#39;");
  });
  it("links and pictures become their words and address, as text, never an anchor", () => {
    expect(inlineHtml("See [the report](https://evil.example/x?a=1&b=2) and ![logo](javascript:alert(1))")).toBe("See the report (https://evil.example/x?a=1&amp;b=2) and logo (javascript:alert(1))");
    expect(markdownBody("[x](https://a.b)")).not.toContain("<a");
  });
  it("a whole document with the fixed stylesheet, the title escaped", () => {
    const doc = markdownToHtml("Hi", "Q3 <brief>");
    expect(doc.startsWith("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Q3 &lt;brief&gt;</title><style>\n")).toBe(true);
    expect(doc).toContain(DOC_STYLE);
    expect(DOC_STYLE).toContain("font-size: 11pt; line-height: 1.4");
    expect(DOC_STYLE).toContain("@page { size: A4;");
    expect(doc).toContain("<body>\n<p>Hi</p>\n</body>");
    expect(escapeHtml("<&>\"'")).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});
