/**
 * The words people see about MCP servers and skills (owner decisions, 4 November 2026: phase 1). A server's own error
 * text is never shown: every problem is one of these, chosen by its code.
 */
import type { McpErrorCode } from "@/server/connectors/mcp/client";

export const MCP_NOT_READY = "MCP servers and skills need a database update first.";
export const MCP_SIGN_IN_NOT_READY = "Signing in to MCP servers needs a database update first. Servers with a key work now.";

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
  SIGN_IN_NEEDED: "Sign in to the server again: its sign-in ended or was turned down.",
};

/** Why a server can't be signed in to (server/connectors/mcp/oauth SignInProblem), and the case where it asks for it. */
export const MCP_SIGN_IN_ERRORS = {
  NO_SIGN_IN: "This server doesn't offer sign-in. Use a key instead.",
  NO_PKCE: "This server's sign-in isn't secure enough for Boredroom (it doesn't offer PKCE).",
  NO_REGISTRATION: "This server doesn't let Boredroom register itself. Add a client ID from the app's developer settings.",
  REGISTRATION_FAILED: "The server turned down Boredroom's registration. Try again, or add a client ID from the app's developer settings.",
  SIGN_IN_OFFERED: "This server asks you to sign in. Choose “Sign in with the app”.",
} as const;

/** Coming back from signing in: `?mcp_error=` codes as words. */
export const MCP_SIGN_IN_RETURN = {
  cancelled: "Sign-in was cancelled, so nothing changed.",
  expired: "That sign-in took longer than 10 minutes. Start it again.",
  mismatch: "That sign-in was started somewhere else. Start it again from this page.",
  not_allowed: "Only the workspace's owner or HR can sign in to MCP servers.",
  failed: "Sign-in didn't finish. Try again.",
} as const;
export type McpSignInReturn = keyof typeof MCP_SIGN_IN_RETURN;

export const mcpErrorWords = (code: string | null | undefined): string | null =>
  code ? (MCP_ERRORS as Record<string, string>)[code] ?? "The server had a problem." : null;
