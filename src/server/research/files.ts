/**
 * Brenda's research as a file (owner decision, 28 October 2026: "give me a PDF when you're done"): PDF, Word or Markdown,
 * all drawn from the one stored structure (research_reports.report), so the three say the same thing. Server-only.
 *
 * - Markdown: the stored Markdown (report.ts markdownOf).
 * - Word (.docx): written here as Office Open XML in a plain zip (stored, no compression; Node's zlib only for the CRC):
 *   Title, Heading 1 and 2 styles, real bullet and numbered lists, bold and italic runs, and the sources as live
 *   hyperlinks. No dependency.
 * - PDF: drawn with pdf-lib (the one dependency added for this, MIT, pure JavaScript, no native code), A4, Helvetica's
 *   four faces, the Boredroom name on top, page numbers below, links on every source. Helvetica draws the Latin-1
 *   ("WinAnsi") characters; anything else (another script, an emoji) is replaced by its plain-letter form or a "?", never
 *   dropped silently into a failure.
 * Every piece of text is the model's or the web's: escaped for XML, drawn as words in the PDF, never markup.
 */
import { crc32 } from "node:zlib";
import { PDFDocument, PDFName, PDFString, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { blocksOf, runsOf, type Block, type Run } from "@/server/research/blocks";
import { bylineOf } from "@/server/research/report";
import type { ResearchFormat, ResearchReport } from "@/lib/research";

export type ReportFile = { bytes: Uint8Array; contentType: string };

// ---- Shared: the report as a list of drawable blocks -------------------------------------------------------------------

type Piece =
  | { kind: "title"; text: string }
  | { kind: "byline"; text: string }
  | { kind: "h1"; text: string }
  | { kind: "block"; block: Block }
  | { kind: "source"; n: number; title: string; url: string };

function piecesOf(r: ResearchReport, tz: string): Piece[] {
  const out: Piece[] = [{ kind: "title", text: r.title }, { kind: "byline", text: `${bylineOf(r, tz)}. The question: ${r.topic}` }];
  if (r.summary) out.push({ kind: "h1", text: "Summary" }, ...blocksOf(r.summary).map((block): Piece => ({ kind: "block", block })));
  if (r.keyFindings.length) out.push({ kind: "h1", text: "Key findings" }, { kind: "block", block: { type: "ul", items: r.keyFindings.map(runsOf) } });
  for (const s of r.sections) out.push({ kind: "h1", text: s.heading }, ...blocksOf(s.body).map((block): Piece => ({ kind: "block", block })));
  if (r.sources.length) out.push({ kind: "h1", text: "Sources" }, ...r.sources.map((s): Piece => ({ kind: "source", n: s.n, title: s.title, url: s.url })));
  return out;
}

// ---- Word ----------------------------------------------------------------------------------------------------------------

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function docxRuns(runs: Run[], links: string[]): string {
  return runs.map((r) => {
    const props = `${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}`;
    const t = `<w:t xml:space="preserve">${xml(r.text)}</w:t>`;
    if (r.href) {
      links.push(r.href);
      return `<w:hyperlink r:id="rIdLink${links.length}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/>${props}</w:rPr>${t}</w:r></w:hyperlink>`;
    }
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${t}</w:r>`;
  }).join("");
}

const para = (style: string | null, inner: string, extra = "") => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${inner}</w:p>`;

function docxBody(r: ResearchReport, tz: string, links: string[]): string {
  let numbered = 0;
  const parts: string[] = [];
  for (const p of piecesOf(r, tz)) {
    // The Boredroom name above the title, as on the PDF.
    if (p.kind === "title") parts.push(para("Brand", docxRuns([{ text: "Boredroom", bold: true }], links)), para("Title", docxRuns([{ text: p.text }], links)));
    else if (p.kind === "byline") parts.push(para("Subtitle", docxRuns([{ text: p.text }], links)));
    else if (p.kind === "h1") parts.push(para("Heading1", docxRuns([{ text: p.text }], links)));
    else if (p.kind === "source") parts.push(para("Source", docxRuns([{ text: `${p.n}. ` }, { text: p.title, href: p.url }, { text: ` ${p.url}`, href: p.url }], links)));
    else {
      const b = p.block;
      if (b.type === "h3") parts.push(para("Heading2", docxRuns(b.runs, links)));
      else if (b.type === "p") parts.push(para(null, docxRuns(b.runs, links)));
      else {
        // Each numbered list restarts at 1: its own numbering instance (numIds 2 and up), bullets share numId 1.
        const numId = b.type === "ul" ? 1 : 2 + numbered++;
        for (const item of b.items) parts.push(para("ListParagraph", docxRuns(item, links), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`));
      }
    }
  }
  return parts.join("");
}

const W_NS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"`;
const FONT = `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/>`;
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr>${FONT}<w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="1A1A1A"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="288" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="44"/><w:szCs w:val="44"/><w:color w:val="111111"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="360"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/><w:color w:val="6B6B6B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/><w:szCs w:val="30"/><w:color w:val="111111"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="111111"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/><w:ind w:left="720"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Brand"><w:name w:val="Brand"/><w:basedOn w:val="Normal"/><w:next w:val="Title"/><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="6" w:color="DDDDDD"/></w:pBdr><w:spacing w:after="280"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/><w:color w:val="6B6B6B"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Source"><w:name w:val="Source"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/><w:ind w:left="360" w:hanging="360"/></w:pPr><w:rPr><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/><w:color w:val="8A8A8A"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F5FBF"/><w:u w:val="single"/></w:rPr></w:style>
</w:styles>`;

function numberingXml(lists: number): string {
  const level = (fmt: "bullet" | "decimal") => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${fmt === "bullet" ? "•" : "%1."}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${fmt === "bullet" ? `<w:rPr>${FONT}</w:rPr>` : ""}</w:lvl>`;
  const nums = [`<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`];
  for (let i = 0; i < lists; i++) nums.push(`<w:num w:numId="${2 + i}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/>${level("bullet")}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/>${level("decimal")}</w:abstractNum>${nums.join("")}</w:numbering>`;
}

const FOOTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W_NS}><w:p><w:pPr><w:pStyle w:val="Footer"/><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">Boredroom, page </w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

/** The report as a Word document (.docx). */
export function renderDocx(r: ResearchReport, tz = "UTC"): Uint8Array {
  const links: string[] = [];
  const body = docxBody(r, tz, links);
  const lists = piecesOf(r, tz).filter((p) => p.kind === "block" && p.block.type === "ol").length;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W_NS}><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1200" w:bottom="1300" w:left="1200" w:header="600" w:footer="600" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>${links.map((href, i) => `<Relationship Id="rIdLink${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xml(href)}" TargetMode="External"/>`).join("")}</Relationships>`;
  const files: [string, string][] = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(r.title)}</dc:title><dc:creator>Boredroom</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${xml(new Date(r.writtenAt).toISOString().replace(/\.\d{3}Z$/, "Z"))}</dcterms:created></cp:coreProperties>`],
    ["word/document.xml", document],
    ["word/_rels/document.xml.rels", rels],
    ["word/styles.xml", STYLES],
    ["word/numbering.xml", numberingXml(lists)],
    ["word/footer1.xml", FOOTER],
  ];
  return zipStored(files.map(([name, text]) => [name, Buffer.from(text, "utf8")]));
}

/** A zip of the files as they are (method 0, "stored"): enough for Word, small, and no compression library. */
export function zipStored(files: [string, Uint8Array][]): Uint8Array {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  // 1 January 2026, 00:00 in DOS time: a fixed stamp, so the same report makes the same bytes.
  const dosTime = 0, dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26); local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, Buffer.from(data));
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt16LE(dosTime, 12); c.writeUInt16LE(dosDate, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBytes.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42);
    central.push(c, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...chunks, centralBuf, end]));
}

// ---- PDF -----------------------------------------------------------------------------------------------------------------

const A4 = { w: 595.28, h: 841.89 };
const M = { x: 62, top: 70, bottom: 70 };
const INK = rgb(0.07, 0.07, 0.07), MUTED = rgb(0.42, 0.42, 0.42), LINK = rgb(0.12, 0.37, 0.75), RULE = rgb(0.86, 0.86, 0.86);
type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont; boldItalic: PDFFont };

/** Text Helvetica can draw: typographic marks kept, letters with marks reduced to their letters, anything else "?". */
export function winAnsi(s: string, charset: ReadonlySet<number>): string {
  let out = "";
  for (const ch of s.replace(/[\t\u00a0\u2007\u202f]/g, " ").replace(/[\p{Cc}\u2028\u2029]/gu, "")) {
    const cp = ch.codePointAt(0)!;
    if (charset.has(cp)) { out += ch; continue; }
    const plain = ch.normalize("NFKD").replace(/\p{M}+/gu, "");
    out += [...plain].every((c) => charset.has(c.codePointAt(0)!)) && plain ? plain : "?";
  }
  return out;
}

type Word = { text: string; font: PDFFont; color: ReturnType<typeof rgb>; href?: string; space: boolean };

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(private doc: PDFDocument, private f: Fonts, private charset: ReadonlySet<number>) { this.newPage(); }
  newPage() { this.page = this.doc.addPage([A4.w, A4.h]); this.pages.push(this.page); this.y = A4.h - M.top; }
  ensure(h: number) { if (this.y - h < M.bottom) this.newPage(); }
  clean(s: string) { return winAnsi(s, this.charset); }
  fontOf(r: Run) { return r.bold && r.italic ? this.f.boldItalic : r.bold ? this.f.bold : r.italic ? this.f.italic : this.f.regular; }

  /** Lays runs out in lines within `width` from `x`, drawing as it goes; links get a clickable box. */
  runs(runs: Run[], o: { size: number; leading: number; x?: number; width?: number; color?: ReturnType<typeof rgb>; after?: number; first?: (y: number) => void }) {
    const x0 = o.x ?? M.x;
    const width = o.width ?? A4.w - M.x * 2;
    const words: Word[] = [];
    for (const r of runs) {
      const font = this.fontOf(r);
      const parts = this.clean(r.text).split(/(\s+)/);
      for (const p of parts) {
        if (!p) continue;
        if (/^\s+$/.test(p)) { if (words.length) words[words.length - 1].space = true; continue; }
        // A word longer than the line (a long address) is cut into pieces that fit.
        let rest = p;
        while (rest) {
          let take = rest.length;
          while (take > 1 && font.widthOfTextAtSize(rest.slice(0, take), o.size) > width) take--;
          words.push({ text: rest.slice(0, take), font, color: r.href ? LINK : (o.color ?? INK), href: r.href, space: false });
          rest = rest.slice(take);
        }
      }
    }
    let line: Word[] = [];
    let lineW = 0;
    let first = true;
    const flush = () => {
      if (!line.length) return;
      this.ensure(o.leading);
      const base = this.y - o.size;
      if (first && o.first) o.first(base);
      first = false;
      let x = x0;
      for (const w of line) {
        const ww = w.font.widthOfTextAtSize(w.text, o.size);
        this.page.drawText(w.text, { x, y: base, size: o.size, font: w.font, color: w.color });
        if (w.href) this.link(x, base - 2, ww, o.size + 3, w.href);
        x += ww + (w.space ? w.font.widthOfTextAtSize(" ", o.size) : 0);
      }
      this.y -= o.leading;
      line = []; lineW = 0;
    };
    for (const w of words) {
      const ww = w.font.widthOfTextAtSize(w.text, o.size);
      const gap = line.length && line[line.length - 1].space ? line[line.length - 1].font.widthOfTextAtSize(" ", o.size) : 0;
      if (line.length && lineW + gap + ww > width) flush();
      lineW += (line.length ? gap : 0) + ww;
      line.push(w);
    }
    flush();
    this.y -= o.after ?? 0;
  }

  link(x: number, y: number, w: number, h: number, href: string) {
    const ctx = this.doc.context;
    const annot = ctx.register(ctx.obj({
      Type: "Annot", Subtype: "Link", Rect: [x, y, x + w, y + h], Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(href) },
    }));
    const existing = this.page.node.lookup(PDFName.of("Annots"));
    if (existing && "push" in (existing as object)) (existing as unknown as { push(v: unknown): void }).push(annot);
    else this.page.node.set(PDFName.of("Annots"), ctx.obj([annot]));
  }

  rule() { this.ensure(12); this.page.drawLine({ start: { x: M.x, y: this.y }, end: { x: A4.w - M.x, y: this.y }, thickness: 0.6, color: RULE }); this.y -= 14; }
}

/** The report as a PDF. */
export async function renderPdf(r: ResearchReport, tz = "UTC"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(r.title.slice(0, 200));
  doc.setAuthor("Boredroom");
  doc.setCreator("Boredroom");
  doc.setProducer("Boredroom");
  doc.setLanguage("en-GB");
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique), boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const charset = new Set(fonts.regular.getCharacterSet());
  const w = new Writer(doc, fonts, charset);
  // The Boredroom name on top of the first page.
  w.runs([{ text: "Boredroom", bold: true }], { size: 10, leading: 14, color: MUTED });
  w.rule();
  for (const p of piecesOf(r, tz)) {
    if (p.kind === "title") w.runs([{ text: p.text, bold: true }], { size: 22, leading: 28, after: 4 });
    else if (p.kind === "byline") w.runs([{ text: p.text }], { size: 9.5, leading: 13, color: MUTED, after: 14 });
    else if (p.kind === "h1") { w.ensure(48); w.y -= 8; w.runs([{ text: p.text, bold: true }], { size: 14, leading: 19, after: 4 }); }
    else if (p.kind === "source") {
      const x = M.x + 22;
      w.runs([{ text: p.title, href: p.url }, { text: ` ${p.url}`, href: p.url }], { size: 9.5, leading: 13, x, width: A4.w - x - M.x, after: 4,
        first: (base) => w.page.drawText(`${p.n}.`, { x: M.x, y: base, size: 9.5, font: fonts.regular, color: MUTED }) });
    } else {
      const b = p.block;
      if (b.type === "h3") { w.ensure(36); w.y -= 2; w.runs(b.runs.map((x) => ({ ...x, bold: true })), { size: 11.5, leading: 16, after: 2 }); }
      else if (b.type === "p") w.runs(b.runs, { size: 10.5, leading: 15, after: 7 });
      else {
        const x = M.x + 18;
        b.items.forEach((item, i) => w.runs(item, { size: 10.5, leading: 15, x, width: A4.w - x - M.x, after: 3,
          first: (base) => w.page.drawText(b.type === "ul" ? "•" : `${i + 1}.`, { x: M.x + 4, y: base, size: 10.5, font: fonts.regular, color: INK }) }));
        w.y -= 5;
      }
    }
  }
  const total = w.pages.length;
  w.pages.forEach((page, i) => {
    const text = `Boredroom, page ${i + 1} of ${total}`;
    const tw = fonts.regular.widthOfTextAtSize(text, 8);
    page.drawText(text, { x: (A4.w - tw) / 2, y: 36, size: 8, font: fonts.regular, color: MUTED });
  });
  return doc.save({ useObjectStreams: false });
}

// ---- One door ------------------------------------------------------------------------------------------------------------

/** The report in the format asked for. */
export async function renderReport(r: ResearchReport, markdown: string, format: ResearchFormat, tz = "UTC"): Promise<ReportFile> {
  if (format === "pdf") return { bytes: await renderPdf(r, tz), contentType: "application/pdf" };
  if (format === "docx") return { bytes: renderDocx(r, tz), contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  return { bytes: new Uint8Array(Buffer.from(markdown, "utf8")), contentType: "text/markdown; charset=utf-8" };
}
