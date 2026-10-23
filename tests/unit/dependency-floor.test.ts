/**
 * Dependency floors (security audit, 23 October 2026, issue 4): Next.js below 16.4.1 and sharp below 0.35.5 carry
 * published critical and high advisories, among them SSRF and RCE in the public /_next/image optimiser
 * (GHSA-cjq9-62q9-8jv4, GHSA-2464-fhr4-w9xw) and sharp's librsvg bug (GHSA-wq5f-xc86-pv6w). vite 8.3.0 to 8.3.2 (dev
 * only, under vitest) has a high dev-server advisory (GHSA-587h-7wmj-h5pm). Vercel and the worker image install from
 * pnpm-lock.yaml, so the lockfile is what is checked here, plus what is actually installed.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const lock = readFileSync(path.join(root, "pnpm-lock.yaml"), "utf8");

function parse(v: string): number[] {
  return v.split("-")[0].split(".").map((n) => Number(n));
}
function atLeast(v: string, floor: string): boolean {
  const a = parse(v);
  const b = parse(floor);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}
/** Every version of `name` the lockfile resolves (keys of the `packages:` section such as `  sharp@0.35.5:`). */
function lockedVersions(name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(`^  '?${escaped}@(\\d+\\.\\d+\\.\\d+[^:(']*)'?:`, "gm");
  return [...new Set([...lock.matchAll(re)].map((m) => m[1]))];
}
/**
 * The version of `pkg` that Node would load from `fromDir`: the nearest node_modules/<pkg> walking up, the same lookup
 * require() does, without going through the package's "exports" (some packages do not export package.json).
 */
function installedVersion(pkg: string, fromDir = root): string {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const base = path.basename(dir) === "node_modules" ? dir : path.join(dir, "node_modules");
    const file = path.join(base, pkg, "package.json");
    if (existsSync(file)) return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
    if (path.dirname(dir) === dir) throw new Error(`${pkg} is not installed`);
  }
}
/** Where pnpm really keeps a direct dependency (node_modules/<pkg> is a symlink into node_modules/.pnpm). */
function packageDir(pkg: string): string {
  return realpathSync(path.join(root, "node_modules", pkg));
}

describe("dependency floors (security audit, 23 October 2026, issue 4)", () => {
  it("locks next, eslint-config-next and @next/* at 16.4.1 or later", () => {
    for (const name of ["next", "eslint-config-next", "@next/env", "@next/eslint-plugin-next"]) {
      const versions = lockedVersions(name);
      expect(versions.length, name).toBeGreaterThan(0);
      for (const v of versions) expect(atLeast(v, "16.4.1"), `${name}@${v}`).toBe(true);
    }
  });

  it("locks every copy of sharp at 0.35.5 or later", () => {
    const versions = lockedVersions("sharp");
    expect(versions.length).toBeGreaterThan(0);
    for (const v of versions) expect(atLeast(v, "0.35.5"), `sharp@${v}`).toBe(true);
  });

  it("locks vite outside the 8.3.0 to 8.3.2 range", () => {
    for (const v of lockedVersions("vite")) {
      expect(atLeast(v, "8.3.0") && !atLeast(v, "8.3.3"), `vite@${v}`).toBe(false);
    }
  });

  it("has the patched versions installed where the app loads them", () => {
    expect(atLeast(installedVersion("next"), "16.4.1")).toBe(true);
    expect(atLeast(installedVersion("sharp", packageDir("@huggingface/transformers")), "0.35.5")).toBe(true);
    expect(atLeast(installedVersion("sharp", packageDir("next")), "0.35.5")).toBe(true);
  });
});
