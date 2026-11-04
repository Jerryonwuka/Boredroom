/**
 * Signing in to MCP servers (owner request, 4 November 2026: phase 1b), the parts that read what servers say: the 401
 * challenge, where metadata lives, which endpoints are accepted, and the token answer.
 */
import { describe, expect, it } from "vitest";
import {
  SignInError, authServerMetadataUrls, browserEndpoint, parseWwwAuthenticate, readAuthServerMetadata, readTokens, resourceMetadataUrls,
} from "@/server/connectors/mcp/oauth";

describe("the 401 challenge", () => {
  it("reads resource_metadata and scope, quoted or not, and nothing from another scheme", () => {
    expect(parseWwwAuthenticate(`Bearer realm="x", resource_metadata="https://a.example/.well-known/oauth-protected-resource/mcp", scope="read write"`))
      .toEqual({ realm: "x", resource_metadata: "https://a.example/.well-known/oauth-protected-resource/mcp", scope: "read write" });
    expect(parseWwwAuthenticate(`bearer error=invalid_token, Resource_Metadata="https://a.example/m"`)).toMatchObject({ error: "invalid_token", resource_metadata: "https://a.example/m" });
    expect(parseWwwAuthenticate(`Basic realm="x"`)).toEqual({});
    expect(parseWwwAuthenticate(null)).toEqual({});
  });
});

describe("where metadata lives", () => {
  it("resource metadata with the server's path, then at the root", () => {
    expect(resourceMetadataUrls("https://mcp.example.com/v1/mcp")).toEqual([
      "https://mcp.example.com/.well-known/oauth-protected-resource/v1/mcp", "https://mcp.example.com/.well-known/oauth-protected-resource"]);
    expect(resourceMetadataUrls("https://mcp.example.com/")).toEqual(["https://mcp.example.com/.well-known/oauth-protected-resource"]);
  });
  it("authorization server metadata in the spec's order", () => {
    expect(authServerMetadataUrls("https://auth.example.com/tenant1")).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server/tenant1",
      "https://auth.example.com/.well-known/openid-configuration/tenant1",
      "https://auth.example.com/tenant1/.well-known/openid-configuration"]);
    expect(authServerMetadataUrls("https://auth.example.com")).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server", "https://auth.example.com/.well-known/openid-configuration"]);
  });
});

describe("authorization server metadata", () => {
  const meta = {
    issuer: "https://auth.example.com", authorization_endpoint: "https://auth.example.com/authorize", token_endpoint: "https://auth.example.com/token",
    registration_endpoint: "https://auth.example.com/register", code_challenge_methods_supported: ["S256"], response_types_supported: ["code"],
  };
  it("accepts https endpoints for the issuer asked for", () => {
    expect(readAuthServerMetadata(meta, "https://auth.example.com/")).toMatchObject({ tokenUrl: "https://auth.example.com/token", registrationUrl: "https://auth.example.com/register", revocationUrl: null });
  });
  it("refuses another issuer, a private token endpoint, and http sign-in pages", () => {
    expect(readAuthServerMetadata({ ...meta, issuer: "https://evil.example.com" }, "https://auth.example.com")).toBeNull();
    expect(readAuthServerMetadata({ ...meta, token_endpoint: "https://169.254.169.254/token" }, "https://auth.example.com")).toBeNull();
    expect(readAuthServerMetadata({ ...meta, authorization_endpoint: "http://auth.example.com/authorize" }, "https://auth.example.com")).toBeNull();
    // A registration endpoint Boredroom can't reach is left out rather than refusing the server.
    expect(readAuthServerMetadata({ ...meta, registration_endpoint: "https://localhost/register" }, "https://auth.example.com")?.registrationUrl).toBeNull();
  });
  it("refuses a server that doesn't offer PKCE S256", () => {
    expect(() => readAuthServerMetadata({ ...meta, code_challenge_methods_supported: ["plain"] }, "https://auth.example.com")).toThrow(SignInError);
  });
  it("lets only this app's own origin open over http, and only outside production", () => {
    const dev = { NODE_ENV: "development", APP_ORIGIN: "http://localhost:3100" } as NodeJS.ProcessEnv;
    expect(browserEndpoint("http://localhost:3100/api/dev/mcp-authorize", dev)).toBe("http://localhost:3100/api/dev/mcp-authorize");
    expect(browserEndpoint("http://localhost:3999/x", dev)).toBeNull();
    expect(browserEndpoint("http://localhost:3100/x", { ...dev, NODE_ENV: "production" })).toBeNull();
    expect(browserEndpoint("https://user:pw@auth.example.com/authorize", dev)).toBeNull();
  });
});

describe("the token answer", () => {
  const now = new Date("2026-11-04T10:00:00Z");
  it("reads a bearer token, its refresh token and when it expires", () => {
    expect(readTokens({ access_token: "a1", token_type: "Bearer", expires_in: 3600, refresh_token: "r1" }, now))
      .toEqual({ accessToken: "a1", refreshToken: "r1", expiresAt: new Date("2026-11-04T11:00:00Z") });
    expect(readTokens({ access_token: "a1" }, now)).toEqual({ accessToken: "a1", refreshToken: null, expiresAt: null });
  });
  it("refuses another token type, a missing or odd token", () => {
    expect(readTokens({ access_token: "a1", token_type: "mac" }, now)).toBeNull();
    expect(readTokens({ token_type: "bearer" }, now)).toBeNull();
    expect(readTokens({ access_token: "a b" }, now)).toBeNull();
    expect(readTokens(null, now)).toBeNull();
  });
});
