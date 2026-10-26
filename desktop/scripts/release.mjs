#!/usr/bin/env node
// Releasing Boredroom for Mac (owner request, 24 October 2026): Boredroom.app, the dashboard window and Brenda in the
// notch (option A). Run from desktop/: `pnpm release [--notes "…"]`.
//
// Builds one universal app (Apple silicon and Intel), the disk image people download (Boredroom.dmg) and the signed
// update archive, checks all of it, writes latest.json for the updater, and prints exactly what to upload to which
// GitHub release. It never uploads anything and never prints a key.
//
// Signing: ad-hoc today (`signingIdentity: "-"` in tauri.conf.json). With an Apple Developer account later, set
// APPLE_SIGNING_IDENTITY (and APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID, or APPLE_API_KEY, APPLE_API_ISSUER and
// APPLE_API_KEY_PATH) and run the same command: Tauri signs and notarises the app, and this script signs, notarises
// and staples the disk image. No code changes.
//
// Flags:
//   --notes "text" | --notes-file path   release notes for latest.json (default "Boredroom <version>")
//   --repo owner/name                    the public releases repo (or BOREDROOM_RELEASES_REPO; default below)
//   --out dir                            where to put the files (default desktop/release/v<version>)
//   --plain                              no Finder window layout for the disk image (unattended runs, no Finder automation)
//   --skip-build                         package and check the last build again

import { execFileSync, spawnSync } from "node:child_process";
import { createHash, createPublicKey, verify } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_REPO = "Jerryonwuka/boredroom-releases";
const DMG_NAME = "Boredroom.dmg";
const TARGET = "universal-apple-darwin";
const MIN_MACOS = "14.0";
const ENTITLEMENTS = ["com.apple.security.device.audio-input", "com.apple.security.device.camera", "com.apple.security.automation.apple-events"];

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDir = join(desktop, "src-tauri");

// ---- small helpers ---------------------------------------------------------------------------------------------------

function fail(message, fix) {
  console.error(`\n✗ ${message}${fix ? `\n  Fix: ${fix}` : ""}`);
  process.exit(1);
}
const ok = (message) => console.log(`✓ ${message}`);
const info = (message) => console.log(`  ${message}`);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.error) fail(`${cmd} could not run: ${r.error.message}`);
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}
function must(cmd, args, what, opts) {
  const r = run(cmd, args, opts);
  if (r.code !== 0) fail(`${what} failed:\n${r.out.trim()}`);
  return r.out;
}
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const mb = (file) => { const n = statSync(file).size; return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`; };
function plist(file, key) {
  const r = run("plutil", ["-extract", key, "raw", "-o", "-", file]);
  return r.code === 0 ? r.out.trim() : null;
}

function args(argv) {
  const o = { notes: null, repo: process.env.BOREDROOM_RELEASES_REPO || DEFAULT_REPO, out: null, plain: false, skipBuild: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--notes") o.notes = next();
    else if (a === "--notes-file") o.notes = readFileSync(next(), "utf8").trim();
    else if (a === "--repo") o.repo = next();
    else if (a === "--out") o.out = resolve(next());
    else if (a === "--plain") o.plain = true;
    else if (a === "--skip-build") o.skipBuild = true;
    else if (a === "--help" || a === "-h") {
      console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
      process.exit(0);
    } else fail(`unknown option ${a}`, "pnpm release --help");
  }
  return o;
}

// ---- minisign (the updater's signatures) ------------------------------------------------------------------------------

/** The lines of a base64-wrapped minisign file (Tauri stores both the key and the signatures base64-encoded). */
const minisignLines = (b64) => Buffer.from(b64.trim(), "base64").toString("utf8").split("\n").map((l) => l.replace(/\r$/, ""));

/** Checks an update archive against the public key from tauri.conf.json, as the updater will. Returns the trusted comment. */
function verifyUpdaterSignature(file, sigB64, pubkeyB64) {
  const pk = Buffer.from(minisignLines(pubkeyB64)[1], "base64");
  if (pk.length !== 42 || pk.subarray(0, 2).toString() !== "Ed") fail("the updater public key in tauri.conf.json is not a minisign key");
  const lines = minisignLines(sigB64);
  const sig = Buffer.from(lines[1], "base64");
  const trusted = lines[2]?.startsWith("trusted comment: ") ? lines[2].slice("trusted comment: ".length) : null;
  const global = lines[3] ? Buffer.from(lines[3], "base64") : null;
  if (sig.length !== 74 || trusted === null || !global || global.length !== 64) fail("the update signature is malformed");
  if (!sig.subarray(2, 10).equals(pk.subarray(2, 10))) fail("the update was signed with a different key than the one in tauri.conf.json", "check TAURI_SIGNING_PRIVATE_KEY and plugins.updater.pubkey");
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), pk.subarray(10)]), format: "der", type: "spki" });
  const alg = sig.subarray(0, 2).toString();
  const message = alg === "ED" ? createHash("blake2b512").update(readFileSync(file)).digest() : readFileSync(file);
  if (!verify(null, message, key, sig.subarray(10))) fail("the update signature does not verify");
  if (!verify(null, Buffer.concat([sig.subarray(10), Buffer.from(trusted)]), key, global)) fail("the update signature's trusted comment does not verify");
  return trusted;
}

// ---- 1. preflight ------------------------------------------------------------------------------------------------------

const o = args(process.argv.slice(2));
if (process.platform !== "darwin") fail("Boredroom for Mac is built on a Mac");

const conf = JSON.parse(readFileSync(join(tauriDir, "tauri.conf.json"), "utf8"));
const pkg = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
const cargoVersion = readFileSync(join(tauriDir, "Cargo.toml"), "utf8").match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/m)?.[1];
const version = conf.version;
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) fail(`tauri.conf.json's version "${version}" is not x.y.z`);
if (pkg.version !== version || cargoVersion !== version)
  fail(`the versions differ: tauri.conf.json ${version}, Cargo.toml ${cargoVersion}, package.json ${pkg.version}`, "bump all three to the same version");
const tag = `v${version}`;
const product = conf.productName;
ok(`${product} ${version} (tag ${tag})`);

if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo)) fail(`"${o.repo}" is not owner/name`);
const pubkey = conf.plugins?.updater?.pubkey;
if (!pubkey) fail("tauri.conf.json has no plugins.updater.pubkey");

const installed = run("rustup", ["target", "list", "--installed"]).out;
for (const t of ["aarch64-apple-darwin", "x86_64-apple-darwin"])
  if (!installed.split("\n").includes(t)) fail(`the Rust target ${t} is not installed`, `rustup target add ${t}`);
ok("Rust targets for Apple silicon and Intel");

const env = { ...process.env };
// A global architecture would reach both whisper.cpp builds (whisper-rs-sys forwards every CMAKE_* variable).
delete env.CMAKE_OSX_ARCHITECTURES;
// The speech library (whisper.cpp) is built for every Mac that runs macOS 14, not tuned to this one's processor
// (whisper-rs-sys forwards GGML_* to CMake). Cross-built for Intel, ggml would otherwise fall back to plain SSE; every
// Intel Mac that runs macOS 14 (2017 and later) has AVX2, FMA and F16C, and only some have AVX-512. Arm ignores these.
const GGML = { GGML_NATIVE: "OFF", GGML_AVX: "ON", GGML_AVX2: "ON", GGML_FMA: "ON", GGML_F16C: "ON", GGML_AVX512: "OFF" };
Object.assign(env, GGML);
const ARCHS = ["aarch64-apple-darwin", "x86_64-apple-darwin"];
/** The GGML_* values each built whisper.cpp was configured with (CMakeCache.txt), per target. */
function ggmlCaches(arch) {
  const b = join(tauriDir, "target", arch, "release", "build");
  if (!existsSync(b)) return [];
  return readdirSync(b).filter((x) => x.startsWith("whisper-rs-sys-")).map((x) => join(b, x, "out", "build", "CMakeCache.txt")).filter((f) => existsSync(f))
    .map((f) => Object.fromEntries(Object.keys(GGML).map((k) => [k, readFileSync(f, "utf8").match(new RegExp(`^${k}:BOOL=(\\w+)`, "m"))?.[1]])));
}
const ggmlStale = (arch) => ggmlCaches(arch).some((c) => Object.entries(GGML).some(([k, v]) => c[k] !== v));
let cmake = run("/bin/sh", ["-c", "command -v cmake"]).out.trim();
if (!cmake) {
  const home = homedir();
  const py = join(home, "Library", "Python");
  const candidates = [
    ...(existsSync(py) ? readdirSync(py).flatMap((v) => [join(py, v, "lib", "python", "site-packages", "cmake", "data", "bin", "cmake"), join(py, v, "bin", "cmake")]) : []),
    "/opt/homebrew/bin/cmake",
    "/usr/local/bin/cmake",
    "/Applications/CMake.app/Contents/bin/cmake",
  ];
  cmake = candidates.find((c) => existsSync(c)) ?? "";
}
if (!cmake) fail("cmake is needed to build the speech library", "pip3 install --user cmake, or brew install cmake");
env.CMAKE = cmake;
ok(`cmake: ${cmake}`);

// The updater's private key: a path (never its text in a log). TAURI_SIGNING_PRIVATE_KEY may already hold either.
const defaultKey = join(homedir(), ".tauri", "boredroom-updater.key");
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  if (!existsSync(defaultKey))
    fail(`no updater key at ${defaultKey}`, `pnpm exec tauri signer generate --ci -w ${defaultKey}  (then put the .pub file's text in plugins.updater.pubkey)`);
  env.TAURI_SIGNING_PRIVATE_KEY = defaultKey;
  const mode = statSync(defaultKey).mode & 0o777;
  if (mode & 0o077) console.warn(`! ${defaultKey} can be read by others (mode ${mode.toString(8)}): chmod 600 it`);
  ok(`updater key: ${defaultKey}`);
} else ok("updater key: from TAURI_SIGNING_PRIVATE_KEY");
// Without a password variable the signer stops to ask, even for a key without one.
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";

const identity = env.APPLE_SIGNING_IDENTITY && env.APPLE_SIGNING_IDENTITY !== "-" ? env.APPLE_SIGNING_IDENTITY : null;
const notary =
  env.APPLE_ID && env.APPLE_PASSWORD && env.APPLE_TEAM_ID
    ? ["--apple-id", env.APPLE_ID, "--password", env.APPLE_PASSWORD, "--team-id", env.APPLE_TEAM_ID]
    : env.APPLE_API_KEY && env.APPLE_API_ISSUER
      ? (() => {
          const name = `AuthKey_${env.APPLE_API_KEY}.p8`;
          const path = env.APPLE_API_KEY_PATH || ["private_keys", join(homedir(), "private_keys"), join(homedir(), ".private_keys"), join(homedir(), ".appstoreconnect", "private_keys")].map((d) => join(d, name)).find((p) => existsSync(p));
          if (!path) fail(`APPLE_API_KEY is set but ${name} was not found`, "set APPLE_API_KEY_PATH to the .p8 file");
          return ["--key", path, "--key-id", env.APPLE_API_KEY, "--issuer", env.APPLE_API_ISSUER];
        })()
      : null;
if (identity) {
  ok(`signing: Developer ID "${identity}"`);
  if (notary) ok(`notarisation: on (${env.APPLE_ID ? "APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID" : "APPLE_API_KEY, APPLE_API_ISSUER"})`);
  else console.warn("! notarisation: off (no APPLE_ID/APPLE_PASSWORD/APPLE_TEAM_ID or APPLE_API_KEY/APPLE_API_ISSUER): macOS will still block the app on first open");
} else {
  ok("signing: ad-hoc (not signed for Gatekeeper; people confirm once in Privacy & Security)");
}

// ---- 2. build ----------------------------------------------------------------------------------------------------------

const endpoint = `https://github.com/${o.repo}/releases/latest/download/latest.json`;
if (!o.skipBuild) {
  const tauriArgs = ["exec", "tauri", "build", "--target", TARGET, "--bundles", "app,dmg", "--config", JSON.stringify({ plugins: { updater: { endpoints: [endpoint] } } })];
  // --plain: no Finder AppleScript for the disk image's window (the bundler skips it only when CI=true).
  if (o.plain) {
    tauriArgs.push("--ci");
    env.CI = "true";
  }
  // Disk images left by an interrupted run would otherwise sit beside the app.
  const macosOut = join(tauriDir, "target", TARGET, "release", "bundle", "macos");
  if (existsSync(macosOut)) for (const f of readdirSync(macosOut)) if (/^rw\.\d+\..*\.dmg$/.test(f)) rmSync(join(macosOut, f), { force: true });
  console.log(`\n→ pnpm ${tauriArgs.slice(0, 7).join(" ")} … (the first universal build takes a while)\n`);
  // whisper-rs-sys doesn't rebuild when these change, so a build made with other flags is cleaned first.
  for (const arch of ARCHS) {
    if (!ggmlStale(arch)) continue;
    console.log(`→ the speech library for ${arch} was built with other flags: cleaning it`);
    must("cargo", ["clean", "-p", "whisper-rs-sys", "--release", "--target", arch], "cargo clean", { cwd: tauriDir });
  }
  const r = spawnSync("pnpm", tauriArgs, { cwd: desktop, env, stdio: "inherit" });
  if (r.status !== 0) fail("tauri build failed (see above)");
}

// ---- 3. find what was built ------------------------------------------------------------------------------------------

const bundle = join(tauriDir, "target", TARGET, "release", "bundle");
const app = join(bundle, "macos", `${product}.app`);
const tarball = `${app}.tar.gz`;
const sigFile = `${tarball}.sig`;
const dmgDir = join(bundle, "dmg");
const dmg = existsSync(dmgDir) ? readdirSync(dmgDir).filter((f) => f.endsWith(".dmg") && f.includes(version)).map((f) => join(dmgDir, f))[0] : null;
for (const [what, p] of [["the app", app], ["the update archive", tarball], ["its signature", sigFile], ["the disk image", dmg]])
  if (!p || !existsSync(p)) fail(`${what} was not built (${p ?? join(dmgDir, `*${version}*.dmg`)})`);

// ---- 4. check it ------------------------------------------------------------------------------------------------------

console.log("\nChecks");
const plistFile = join(app, "Contents", "Info.plist");

function checkApp(appPath, label) {
  const p = join(appPath, "Contents", "Info.plist");
  const bin = join(appPath, "Contents", "MacOS", plist(p, "CFBundleExecutable") ?? "");
  const archs = must("lipo", ["-archs", bin], "lipo").trim().split(/\s+/);
  if (!archs.includes("arm64") || !archs.includes("x86_64")) fail(`${label}: not universal (${archs.join(", ")})`);
  for (const arch of ["arm64", "x86_64"]) {
    const minos = must("otool", ["-arch", arch, "-l", bin], "otool").match(/LC_BUILD_VERSION[\s\S]*?minos\s+(\S+)/)?.[1];
    if (minos !== MIN_MACOS) fail(`${label}: the ${arch} slice targets macOS ${minos}, not ${MIN_MACOS}`);
  }
  must("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], `${label}: codesign --verify`);
  const dv = run("codesign", ["-dv", "--verbose=4", appPath]).out;
  if (!/flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/.test(dv)) fail(`${label}: the hardened runtime is off`);
  if (!identity && !/Signature=adhoc/.test(dv)) fail(`${label}: expected an ad-hoc signature`);
  if (identity && !dv.includes(`Authority=${identity}`) && !/Authority=Developer ID Application/.test(dv)) fail(`${label}: not signed with ${identity}`);
  const ent = run("codesign", ["-d", "--entitlements", "-", "--xml", appPath]).out;
  for (const e of ENTITLEMENTS) if (!ent.includes(e)) fail(`${label}: the entitlement ${e} is missing`);
  if (plist(p, "LSMinimumSystemVersion") !== MIN_MACOS) fail(`${label}: LSMinimumSystemVersion is ${plist(p, "LSMinimumSystemVersion")}`);
  if (plist(p, "CFBundleShortVersionString") !== version) fail(`${label}: CFBundleShortVersionString is ${plist(p, "CFBundleShortVersionString")}`);
  for (const k of ["NSMicrophoneUsageDescription", "NSCameraUsageDescription", "NSAppleEventsUsageDescription"]) if (!plist(p, k)) fail(`${label}: Info.plist has no ${k}`);
  // The one sign-in's hand-back from the browser (owner request, 24 October 2026).
  if (plist(p, "CFBundleURLTypes.0.CFBundleURLSchemes.0") !== "boredroom") fail(`${label}: Info.plist doesn't list the boredroom:// URL scheme`);
  if (plist(p, "CFBundleIdentifier") !== conf.identifier) fail(`${label}: the bundle identifier is ${plist(p, "CFBundleIdentifier")}, not ${conf.identifier}`);
  // A headless smoke check (the app itself is not started): it links only what every Mac has.
  const libs = must("otool", ["-arch", "arm64", "-L", bin], "otool -L").split("\n").slice(1).map((l) => l.trim().split(" ")[0]).filter(Boolean);
  const odd = libs.filter((l) => !l.startsWith("/System/Library/") && !l.startsWith("/usr/lib/"));
  if (odd.length) fail(`${label}: links libraries a Mac doesn't have: ${odd.join(", ")}`);
  return { archs, dv };
}

const { archs, dv } = checkApp(app, "app");
ok(`universal: ${archs.join(" + ")}; both slices macOS ${MIN_MACOS}+`);
ok(`signed: ${dv.match(/flags=\S+/)?.[0]} ${identity ? identity : "(ad-hoc)"}, entitlements ${ENTITLEMENTS.map((e) => e.split(".").pop()).join(", ")}`);
ok(`Info.plist: version ${version}, minimum macOS ${MIN_MACOS}, LSUIElement ${plist(plistFile, "LSUIElement") ?? "unset"}, boredroom:// scheme, camera and microphone strings`);
ok("links only system libraries");

for (const arch of ARCHS) {
  const caches = ggmlCaches(arch);
  if (!caches.length) fail(`no speech library build found for ${arch}`);
  if (ggmlStale(arch)) fail(`the speech library for ${arch} was built with other flags (${JSON.stringify(caches)})`, "run pnpm release again without --skip-build");
}
ok("speech library built for every Mac: not tuned to this one (GGML_NATIVE=OFF), AVX2/FMA/F16C for Intel, no AVX-512");

must("hdiutil", ["verify", dmg], "hdiutil verify");
const mount = mkdtempSync(join(tmpdir(), "boredroom-dmg-"));
must("hdiutil", ["attach", "-nobrowse", "-noautoopen", "-readonly", "-mountpoint", mount, dmg], "mounting the disk image");
try {
  const inside = readdirSync(mount);
  if (!inside.includes(`${product}.app`) || !inside.includes("Applications")) fail(`the disk image holds ${inside.join(", ")}`);
  checkApp(join(mount, `${product}.app`), "the app in the disk image");
} finally {
  run("hdiutil", ["detach", mount, "-force"]);
  rmSync(mount, { recursive: true, force: true });
}
ok(`disk image: verifies, mounts, holds ${product}.app and Applications`);

const sig = readFileSync(sigFile, "utf8").trim();
const trusted = verifyUpdaterSignature(tarball, sig, pubkey);
const signedVersion = trusted.split("\t").find((f) => f.startsWith("version:"))?.slice("version:".length);
if (conf.plugins.updater.requireSignedVersion && signedVersion !== version) fail(`the update signature is for version ${signedVersion}, not ${version}`);
const unpack = mkdtempSync(join(tmpdir(), "boredroom-tar-"));
try {
  must("tar", ["-xzf", tarball, "-C", unpack], "unpacking the update archive");
  checkApp(join(unpack, `${product}.app`), "the app in the update archive");
} finally {
  rmSync(unpack, { recursive: true, force: true });
}
ok(`update archive: signature verifies with the key in tauri.conf.json (signed for ${signedVersion}), app inside checks out`);

const gk = run("spctl", ["--assess", "--type", "execute", "-vv", app]);
if (identity && notary && gk.code !== 0) fail(`Gatekeeper rejects the notarised app:\n${gk.out.trim()}`);
info(`Gatekeeper (spctl): ${gk.out.trim().split("\n")[0]}${identity ? "" : "  ← expected without Developer ID"}`);

// ---- 5. stage ---------------------------------------------------------------------------------------------------------

const out = o.out ?? join(desktop, "release", tag);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const outDmg = join(out, DMG_NAME);
const tarName = `${product}_${version}_universal.app.tar.gz`;
const outTar = join(out, tarName);
copyFileSync(dmg, outDmg);
copyFileSync(tarball, outTar); // the signature covers the bytes, not the name

if (identity && notary) {
  console.log("\n→ signing, notarising and stapling the disk image");
  must("codesign", ["--force", "--sign", identity, "--timestamp", outDmg], "codesign the disk image");
  const r = spawnSync("xcrun", ["notarytool", "submit", outDmg, "--wait", ...notary], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) fail("notarising the disk image failed (see above)");
  must("xcrun", ["stapler", "staple", outDmg], "stapling the disk image");
  ok("disk image signed, notarised and stapled");
}

const manifest = {
  version,
  notes: o.notes ?? `${product} ${version}`,
  pub_date: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  platforms: Object.fromEntries(
    ["darwin-aarch64", "darwin-x86_64"].map((p) => [p, { signature: sig, url: `https://github.com/${o.repo}/releases/download/${tag}/${tarName}` }]),
  ),
};
writeFileSync(join(out, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(out, "SHA256SUMS.txt"), `${sha256(outDmg)}  ${DMG_NAME}\n${sha256(outTar)}  ${tarName}\n`);
// The staged copy is what people get: check it once more.
verifyUpdaterSignature(outTar, manifest.platforms["darwin-aarch64"].signature, pubkey);

// ---- 6. what to upload -------------------------------------------------------------------------------------------------

const files = [outDmg, outTar, join(out, "latest.json"), join(out, "SHA256SUMS.txt")];
console.log(`
Release ${tag} → https://github.com/${o.repo}  (a public repo; create it first if it doesn't exist)
Create a release with tag ${tag}, title "${product} ${version}", NOT a pre-release, marked latest, and upload:
${files.map((f) => `  ${f}  (${mb(f)})`).join("\n")}
Or:
  gh release create ${tag} --repo ${o.repo} --title "${product} ${version}" --notes ${JSON.stringify(manifest.notes)} --latest \\
    ${files.map((f) => JSON.stringify(f)).join(" \\\n    ")}

Download link: https://github.com/${o.repo}/releases/latest/download/${DMG_NAME}
Update feed:   ${endpoint}
Signing:       ${identity ? `Developer ID "${identity}"${notary ? ", notarised" : ", NOT notarised"}` : "ad-hoc (people confirm once in System Settings › Privacy & Security › Open Anyway)"}

Every release must upload a file named exactly ${DMG_NAME} and a latest.json, and bump the version in
src-tauri/tauri.conf.json, src-tauri/Cargo.toml and package.json first.`);
