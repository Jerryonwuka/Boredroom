/**
 * Atlassian helpers for the Jira adapter (work group, owner decisions 22 October 2026: connectors; spec §8.6, §16.2).
 * - Atlassian Document Format (ADF): plain text to ADF paragraphs for what Boredroom sends (comments, descriptions), and
 *   ADF flattened to plain text for what Brenda reads (read_app_item). Links are never carried into the text Brenda
 *   reads (people open items from My Day).
 * - Personal data reporting (Atlassian's user privacy guide): every stored Atlassian account id is reported in batches of
 *   90 to `POST https://api.atlassian.com/app/report-accounts/`; an account Atlassian says is `closed` is erased here
 *   (identity rows deleted, assignee id and label nulled on items). The `Cycle-Period` answer header is honoured.
 * Server-only.
 */
import { ConnectorError, type ConnectionRef, type MaintenanceInput, type ProviderHttp } from "../types";

// ---- ADF ----------------------------------------------------------------------------------------------------------------

type AdfNode = { type: string; text?: string; content?: AdfNode[]; attrs?: Record<string, unknown> };
export type AdfDoc = { type: "doc"; version: 1; content: AdfNode[] };

/**
 * Plain text as an ADF document: blank lines separate paragraphs, single line breaks become hard breaks. Nothing else
 * is interpreted (no marks, no links, no mentions), so what the card shows is exactly what Jira shows.
 */
export function textToAdf(text: string): AdfDoc {
  const paragraphs = text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => {
      const content: AdfNode[] = [];
      p.split("\n").forEach((line, i) => {
        if (i > 0) content.push({ type: "hardBreak" });
        if (line) content.push({ type: "text", text: line });
      });
      return { type: "paragraph", content };
    }),
  };
}

const BLOCKS = new Set(["paragraph", "heading", "blockquote", "codeBlock", "panel", "rule", "mediaSingle", "mediaGroup", "table", "tableRow", "expand", "nestedExpand", "decisionList", "taskList"]);

/** An ADF document (or anything else) flattened to plain text, at most `maxChars`. Unknown nodes give their text only. */
export function adfToText(doc: unknown, maxChars = 20_000): string {
  const out: string[] = [];
  let size = 0;
  const push = (s: string) => {
    if (size >= maxChars) return;
    out.push(s);
    size += s.length;
  };
  const walk = (n: unknown, prefix: string): void => {
    if (!n || typeof n !== "object" || size >= maxChars) return;
    const node = n as AdfNode;
    switch (node.type) {
      case "text": push(typeof node.text === "string" ? node.text : ""); return;
      case "hardBreak": push("\n"); return;
      case "mention": push(typeof node.attrs?.text === "string" ? String(node.attrs.text) : "@someone"); return;
      case "emoji": push(typeof node.attrs?.text === "string" ? String(node.attrs.text) : typeof node.attrs?.shortName === "string" ? String(node.attrs.shortName) : ""); return;
      case "inlineCard": case "blockCard": case "embedCard": push("[link]"); return;
      case "date": {
        const ts = Number(node.attrs?.timestamp);
        push(Number.isFinite(ts) ? new Date(ts).toISOString().slice(0, 10) : "");
        return;
      }
      case "status": push(typeof node.attrs?.text === "string" ? `[${String(node.attrs.text)}]` : ""); return;
      case "rule": push("\n---\n"); return;
      case "media": case "mediaInline": push("[attachment]"); return;
      case "bulletList": case "orderedList": {
        (node.content ?? []).forEach((li, i) => {
          push(`${prefix}${node.type === "orderedList" ? `${i + 1}. ` : "- "}`);
          walk(li, `${prefix}  `);
          push("\n");
        });
        push("\n");
        return;
      }
      case "taskItem": push(node.attrs?.state === "DONE" ? "[x] " : "[ ] "); break;
      case "listItem": {
        // A list item's paragraphs are its lines, not blocks of their own.
        (node.content ?? []).forEach((c, i) => {
          if (i > 0) push(`\n${prefix}`);
          if ((c as AdfNode)?.type === "paragraph") ((c as AdfNode).content ?? []).forEach((x) => walk(x, prefix));
          else walk(c, prefix);
        });
        return;
      }
      case "tableCell": case "tableHeader": {
        (node.content ?? []).forEach((c) => walk(c, prefix));
        push(" | ");
        return;
      }
      default: break;
    }
    const kids = node.content ?? [];
    kids.forEach((c) => walk(c, prefix));
    if (BLOCKS.has(node.type) || node.type === "taskItem" || node.type === "decisionItem") push("\n\n");
  };
  if (doc && typeof doc === "object" && Array.isArray((doc as AdfNode).content)) walk(doc, "");
  else if (typeof doc === "string") push(doc);
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxChars);
}

// ---- Personal data reporting -----------------------------------------------------------------------------------------------

export const REPORT_ACCOUNTS_URL = "https://api.atlassian.com/app/report-accounts/";
export const REPORT_BATCH = 90;
const DEFAULT_CYCLE_MS = 7 * 24 * 3600_000;

/** When the next cycle may run (the `Cycle-Period` header Atlassian answered with); in-process, the worker's memory. */
let nextCycleAt = 0;
/** Tests only. */
export function resetReportingCycleForTests(): void { nextCycleAt = 0; }

/**
 * `Cycle-Period` as milliseconds. Atlassian's guide names the recommended period between reporting cycles; it is read
 * as seconds, and a small number (under 1,000) as hours (decision 22 October 2026: the unit could not be re-read on the
 * day, so both readings are accepted; a week is the default either way).
 */
export function cyclePeriodMs(h: string | null | undefined): number | null {
  const v = Number((h ?? "").trim());
  if (!h || !Number.isFinite(v) || v <= 0) return null;
  const ms = v < 1000 ? v * 3600_000 : v * 1000;
  return Math.min(30 * 24 * 3600_000, Math.max(3600_000, ms));
}

type ReportAnswer = { accounts?: { accountId?: unknown; status?: unknown }[] };

/**
 * One reporting cycle (the worker's `connector.maintenance`, `report_accounts`, every 168 hours): for each site, its
 * stored account ids in batches of 90, with when Boredroom last changed what it holds about them, sent with a live
 * connection on that site. `closed` accounts are erased. A 429 stops the cycle (the next one carries on).
 */
export async function reportAccounts(c: MaintenanceInput): Promise<{ reported: number; erased: number }> {
  const now = c.now.getTime();
  if (now < nextCycleAt) return { reported: 0, erased: 0 };
  const accounts = await c.accounts();
  const byConn = new Map<string, ConnectionRef>(c.connections.map((x) => [x.id, x]));
  // Group by the connection that will report them (one on the account's site).
  const groups = new Map<string, { conn: ConnectionRef; rows: { accountId: string; updatedAt: string }[] }>();
  for (const a of accounts) {
    if (!a.externalUserId || !/^[A-Za-z0-9:_-]{1,128}$/.test(a.externalUserId)) continue;
    const conn = byConn.get(a.connectionId) ?? c.connections.find((x) => x.externalTenantId && x.externalTenantId === a.tenantId);
    if (!conn) continue;
    const g = groups.get(conn.id) ?? { conn, rows: [] };
    const updated = Number.isNaN(Date.parse(a.updatedAt)) ? new Date(now).toISOString() : new Date(a.updatedAt).toISOString();
    g.rows.push({ accountId: a.externalUserId, updatedAt: updated });
    groups.set(conn.id, g);
  }
  let reported = 0;
  let erased = 0;
  let cycle: number | null = null;
  let stopped = false;
  outer: for (const { conn, rows } of groups.values()) {
    const http: ProviderHttp = c.httpFor(conn);
    for (let i = 0; i < rows.length; i += REPORT_BATCH) {
      const batch = rows.slice(i, i + REPORT_BATCH);
      let res;
      try {
        res = await http.request<ReportAnswer | null>({ method: "POST", url: REPORT_ACCOUNTS_URL, json: { accounts: batch } });
      } catch (err) {
        if (err instanceof ConnectorError && err.code === "RATE_LIMITED") { stopped = true; break outer; }
        if (err instanceof ConnectorError && (err.code === "REAUTH_REQUIRED" || err.code === "FORBIDDEN")) continue outer; // another site's connection reports later
        throw err;
      }
      reported += batch.length;
      cycle = cyclePeriodMs(res.headers.get("cycle-period")) ?? cycle;
      if (res.status === 204 || !res.body || !Array.isArray(res.body.accounts)) continue;
      const sent = new Set(batch.map((b) => b.accountId));
      for (const a of res.body.accounts) {
        if (a?.status === "closed" && typeof a.accountId === "string" && sent.has(a.accountId)) {
          await c.eraseAccount(a.accountId);
          erased++;
        }
      }
    }
  }
  // A cycle cut short by a 429 is not a cycle: the next maintenance run reports again.
  if (!stopped) nextCycleAt = now + (cycle ?? DEFAULT_CYCLE_MS) - 3600_000;
  return { reported, erased };
}
