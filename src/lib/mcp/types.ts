/**
 * Brenda's own apps (MCP) and skills: what the Settings screens see (owner decisions, 4 November 2026: phase 1). Never a
 * key: a server shows only that it has one and its last four characters.
 */

export type McpAuthKind = "none" | "bearer" | "header";
export type McpAccess = "off" | "read" | "act";
export type McpServerStatus = "active" | "needs_attention" | "paused";

export type McpToolView = {
  id: string;
  name: string;
  title: string | null;
  description: string;
  /** What the admin chose. */
  access: McpAccess;
  /** The server changed the tool since the admin chose: it stays off until they choose again. */
  changed: boolean;
  /** The server stopped listing it. */
  gone: boolean;
  /** The server's own hint, which only suggests Read or Act. */
  suggested: "read" | "act";
  destructive: boolean;
};

export type McpServerView = {
  id: string;
  name: string;
  url: string;
  useFor: string | null;
  authKind: McpAuthKind;
  authHeader: string | null;
  keyHint: string | null;
  status: McpServerStatus;
  serverLabel: string | null;
  lastCheckedAt: string | null;
  lastOkAt: string | null;
  /** Words for the last problem, when there was one. */
  problem: string | null;
  tools: McpToolView[];
};

export type SkillFile = { name: string; text: string };

export type SkillView = {
  id: string | null;
  slug: string;
  name: string;
  useWhen: string;
  builtin: boolean;
  enabled: boolean;
  /** The body and files, for the workspace's own skills (a built-in's live in code). */
  body: string | null;
  files: { name: string; size: number }[];
};
