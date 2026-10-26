import { describe, expect, it } from "vitest";
import { shellFor, shellScript, SHELL_COOKIE } from "@/lib/desktop-app";
import { shellPath } from "@/components/app/mac-shell";

const APP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 BoredroomDesktop/0.2.0";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("the Mac app shell", () => {
  it("is the app's window only, from the user agent", () => {
    expect(shellFor(APP, null, false)).toBe("mac");
    expect(shellFor(SAFARI, null, false)).toBe("web");
    expect(shellFor(null, null, false)).toBe("web");
  });
  it("can be forced by the cookie in development only", () => {
    expect(shellFor(SAFARI, "mac", true)).toBe("mac");
    expect(shellFor(APP, "web", true)).toBe("web");
    expect(shellFor(SAFARI, "mac", false)).toBe("web");
    expect(shellFor(SAFARI, "nonsense", true)).toBe("web");
  });
  it("leaves the development override out of a production build", () => {
    expect(shellScript(false)).not.toContain(SHELL_COOKIE);
    expect(shellScript(false)).not.toContain("location.search");
    expect(shellScript(true)).toContain(SHELL_COOKIE);
  });

  function run(script: string, ua: string, search = "", cookie = "") {
    const dataset: Record<string, string> = {};
    const doc = { documentElement: { dataset }, cookie };
    new Function("navigator", "location", "document", script)({ userAgent: ua }, { search }, doc);
    return { dataset, cookie: doc.cookie };
  }
  it("marks <html> before first paint", () => {
    expect(run(shellScript(false), APP).dataset).toEqual({ shell: "mac" });
    expect(run(shellScript(false), SAFARI).dataset).toEqual({});
    const forced = run(shellScript(true), SAFARI, "?shell=mac");
    expect(forced.dataset).toEqual({ shell: "mac", shellSim: "" });
    expect(forced.cookie).toContain(`${SHELL_COOKIE}=mac`);
    expect(run(shellScript(true), SAFARI, "", `${SHELL_COOKIE}=mac`).dataset.shell).toBe("mac");
    expect(run(shellScript(true), APP, "?shell=web").dataset).toEqual({});
    expect(run(shellScript(false), SAFARI, "?shell=mac").dataset).toEqual({});
  });
  it("lets the app's menus change page only to a workspace page", () => {
    expect(shellPath("/app/acme/todos?add=1")).toBe("/app/acme/todos?add=1");
    expect(shellPath("/app")).toBe("/app");
    for (const bad of ["https://evil.example/app", "//evil.example/app", "/admin", "/app\\..\\x", "javascript:alert(1)", 42, null, "/application"]) expect(shellPath(bad)).toBeNull();
  });
});
