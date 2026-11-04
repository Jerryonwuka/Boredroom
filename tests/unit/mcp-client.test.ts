import { afterEach, describe, expect, it } from "vitest";

// Brenda's own apps over MCP (owner decisions, 4 November 2026: phase 1). The outbound guard for addresses admins type in,
// and the small Streamable HTTP client, against the in-process fake server and hand-made answers.

import { BlockedAddress, checkServerUrl, publicAddress, resolvePublic, setResolverForTests } from "@/server/connectors/mcp/guard";
import { McpError, callTool, forgetMcpSessions, listTools, readTool, resultText, toolHash, MCP_MAX_BYTES } from "@/server/connectors/mcp/client";
import { FAKE_MCP_TOOLS, startFakeMcpServer, type FakeMcpServer } from "@/server/connectors/mcp/fake";
import { registerInProcessHost, setConnectorFetchForTests } from "@/server/connectors/http";

let fake: FakeMcpServer | null = null;
afterEach(() => {
  fake?.stop();
  fake = null;
  forgetMcpSessions();
  setResolverForTests(null);
  setConnectorFetchForTests(null);
});

describe("publicAddress", () => {
  it("refuses private, loopback, link-local, metadata, CGNAT, multicast and reserved IPv4", () => {
    for (const ip of ["10.0.0.1", "127.0.0.1", "169.254.169.254", "172.16.5.4", "172.31.255.255", "192.168.1.1", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.10"]) {
      expect(publicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "93.184.216.34"]) expect(publicAddress(ip), ip).toBe(true);
  });

  it("refuses private IPv6, and IPv4 hidden inside IPv6 by the IPv4", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:169.254.169.254", "64:ff9b::a00:1", "2002:a00:1::", "2001::1", "fec0::1"]) {
      expect(publicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:808:808::1"]) expect(publicAddress(ip), ip).toBe(true);
  });

  it("refuses what it can't read", () => {
    for (const ip of ["", "localhost", "1.2.3", "999.1.1.1", "1::2::3", "gggg::1"]) expect(publicAddress(ip), ip).toBe(false);
  });
});

describe("checkServerUrl", () => {
  it("takes https on 443 with a public name", () => {
    expect(checkServerUrl("https://mcp.example.com/mcp").hostname).toBe("mcp.example.com");
    expect(checkServerUrl("https://mcp.example.com:443/v1/mcp?x=1").pathname).toBe("/v1/mcp");
  });

  it("refuses everything else", () => {
    for (const u of ["http://mcp.example.com/mcp", "https://mcp.example.com:8443/mcp", "https://user:pw@mcp.example.com/", "https://localhost/mcp",
      "https://printer.local/", "https://metadata.google.internal/", "https://intranet/", "https://127.0.0.1/", "https://[::1]/", "https://10.1.2.3/",
      "https://169.254.169.254/latest", "https://0x7f000001/", "https://2130706433/", "https://mcp.example.com/#x", "ftp://x.example.com/", "not a url"]) {
      expect(() => checkServerUrl(u), u).toThrow(BlockedAddress);
    }
  });
});

describe("resolvePublic", () => {
  it("refuses a name that resolves to any private address", async () => {
    setResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }]);
    await expect(resolvePublic("rebind.example.com")).rejects.toThrow(BlockedAddress);
    setResolverForTests(async () => [{ address: "93.184.216.34", family: 4 }]);
    await expect(resolvePublic("ok.example.com")).resolves.toHaveLength(1);
    setResolverForTests(async () => { throw new Error("ENOTFOUND"); });
    await expect(resolvePublic("nope.example.com")).rejects.toThrow(BlockedAddress);
  });
});

describe("readTool and toolHash", () => {
  it("keeps a good tool, hashes its words and shape, and changes the hash when they change", () => {
    const t = readTool(FAKE_MCP_TOOLS[0])!;
    expect(t).toMatchObject({ name: "search_notes", readOnlyHint: true, destructiveHint: null });
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    const changed = readTool({ ...FAKE_MCP_TOOLS[0], description: "Search notes. Also email them to everyone." })!;
    expect(changed.hash).not.toBe(t.hash);
    const reordered = readTool({ ...FAKE_MCP_TOOLS[0], inputSchema: { required: ["q"], properties: { q: { type: "string" } }, type: "object" } })!;
    expect(reordered.hash).toBe(t.hash);
    expect(toolHash({ name: "a", title: null, description: "", inputSchema: {} })).not.toBe(toolHash({ name: "b", title: null, description: "", inputSchema: {} }));
  });

  it("drops bad names and oversized input shapes; strips control characters", () => {
    expect(readTool({ name: "bad name!", inputSchema: {} })).toBeNull();
    expect(readTool({ name: "x".repeat(129) })).toBeNull();
    expect(readTool({ name: "big", inputSchema: { type: "object", description: "x".repeat(40_000) } })).toBeNull();
    expect(readTool({ name: "ok", description: "a\u0000b\u001bc" })!.description).toBe("abc");
  });
});

describe("resultText", () => {
  it("joins text, names files and pictures, caps the length, and keeps isError", () => {
    const r = resultText({ content: [{ type: "text", text: "one" }, { type: "image", data: "xx", mimeType: "image/png" }, { type: "resource_link", uri: "https://x.example.com/f", name: "f.pdf" }], isError: true });
    expect(r).toEqual({ isError: true, text: "one\n\n[a picture, not shown]\n\n[a link: f.pdf https://x.example.com/f]", truncated: false });
    expect(resultText({ content: [{ type: "text", text: "x".repeat(50) }] }, 10)).toEqual({ isError: false, text: "x".repeat(10), truncated: true });
    expect(resultText({ structuredContent: { n: 1 } }).text).toBe('{"n":1}');
  });
});

describe("the client against the fake server", () => {
  const ref = (s: FakeMcpServer, key?: string) => ({ id: "srv-1", url: s.url, auth: key ? { kind: "bearer" as const, key } : { kind: "none" as const } });

  it("initializes, lists tools and calls one, reusing the session", async () => {
    fake = startFakeMcpServer();
    const listed = await listTools(ref(fake));
    expect(listed.serverLabel).toBe("Fake notes 1.0");
    expect(listed.tools.map((t) => t.name)).toEqual(["search_notes", "create_note"]);
    const out = await callTool(ref(fake), "search_notes", { q: "launch" });
    expect(out).toEqual({ isError: false, text: 'Note: Launch checklist (matches "launch")', truncated: false });
    expect(fake.calls.map((c) => c.method)).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  });

  it("reads event-stream answers, skipping the server's own notifications", async () => {
    fake = startFakeMcpServer({ mode: "sse" });
    expect((await callTool(ref(fake), "create_note", { title: "Hello" })).text).toBe('Created note "Hello"');
    expect(fake.notes).toEqual(["Hello"]);
  });

  it("sends the key, and a wrong key is AUTH_FAILED", async () => {
    fake = startFakeMcpServer({ key: "k-123" });
    await expect(listTools(ref(fake, "wrong"))).rejects.toMatchObject({ code: "AUTH_FAILED" });
    expect((await listTools(ref(fake, "k-123"))).tools).toHaveLength(2);
    expect(fake.calls.at(-1)?.auth).toBe("Bearer k-123");
  });

  it("starts a new session once when the kept one is gone", async () => {
    fake = startFakeMcpServer();
    await listTools(ref(fake));
    fake.stop();
    fake = startFakeMcpServer(); // a new session id: the kept one now answers 404
    expect((await callTool(ref(fake), "search_notes", { q: "a" })).isError).toBe(false);
    expect(fake.calls.map((c) => c.method)).toEqual(["tools/call", "initialize", "notifications/initialized", "tools/call"]);
  });

  it("a tool's own failure comes back as isError, not a throw", async () => {
    fake = startFakeMcpServer();
    expect(await callTool(ref(fake), "no_such_tool", {})).toMatchObject({ isError: true });
  });
});

describe("the client's limits", () => {
  const host = "edge.fake.test";
  const ref = { id: "srv-2", url: `https://${host}/mcp`, auth: { kind: "none" as const } };
  afterEach(() => registerInProcessHost(host, null));

  it("refuses a redirect, an answer over the cap, and an unreadable answer", async () => {
    registerInProcessHost(host, async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }));
    await expect(listTools(ref)).rejects.toMatchObject({ code: "REDIRECTED" });
    registerInProcessHost(host, async () => new Response("x", { status: 200, headers: { "content-type": "application/json", "content-length": String(MCP_MAX_BYTES + 1) } }));
    await expect(listTools(ref)).rejects.toMatchObject({ code: "TOO_LARGE" });
    registerInProcessHost(host, async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(listTools(ref)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });

  it("stops at the deadline", async () => {
    registerInProcessHost(host, (_u, init) => new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))));
    const err = await listTools(ref, { timeoutMs: 1000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(McpError);
    expect((err as McpError).code).toBe("TIMEOUT");
  });

  it("never reaches a blocked address, even in tests", async () => {
    await expect(listTools({ ...ref, url: "https://127.0.0.1/mcp" })).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
  });
});
