/**
 * The words people see about MCP servers and skills (owner decisions, 4 November 2026: phase 1). A server's own error
 * text is never shown: every problem is one of these, chosen by its code.
 */
import type { McpErrorCode } from "@/server/connectors/mcp/client";

export const MCP_NOT_READY = "MCP servers and skills need a database update first.";

export const MCP_ERRORS: Record<McpErrorCode | "RATE_LIMITED_HOUR" | "NO_TOOLS", string> = {
  BLOCKED_ADDRESS: "Boredroom can only reach public https addresses on port 443.",
  TIMEOUT: "The server took too long to answer.",
  TOO_LARGE: "The server's answer was too large.",
  AUTH_FAILED: "The server refused the key. Check it and save it again.",
  NOT_FOUND: "Nothing answered at that address. Check it ends with the server's MCP path, often /mcp.",
  RATE_LIMITED: "The server asked Boredroom to slow down. Try again in a few minutes.",
  RATE_LIMITED_HOUR: "Brenda used this workspace's 300 app calls for this hour. Try again later.",
  SERVER_DOWN: "Boredroom couldn't reach the server.",
  REDIRECTED: "The server sent Boredroom somewhere else. Use the final address.",
  BAD_RESPONSE: "The server's answer wasn't MCP.",
  PROTOCOL: "The server's answer wasn't MCP.",
  NO_TOOLS: "The server has no tools.",
};

export const mcpErrorWords = (code: string | null | undefined): string | null =>
  code ? (MCP_ERRORS as Record<string, string>)[code] ?? "The server had a problem." : null;
