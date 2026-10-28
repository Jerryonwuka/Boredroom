//! Opening things (owner request, 12 October 2026: "I wanted Brenda to assist me with some things, like open an app on
//! my desktop, and it said it can't do that, why?"; companion2-spec B), only under the owner's permission rule: an
//! open is a step of a plan the person asked for, heard ("I'll open Figma. Do you want me to do this?") and said yes
//! to. Nothing here starts anything.
//!
//! What this file promises, and how:
//! - Apps open by name from the Applications folders only (`/Applications`, its Utilities, `/System/Applications`,
//!   its Utilities, `~/Applications`, and from CoreServices Finder only), matched by the bundle's name, then a short
//!   alias table, then Spotlight within those folders. Never: an app on the never-look or never-act lists (Terminal,
//!   System Settings, Keychain Access, password managers, messaging and call apps, launchers, the installer), an app
//!   that installs, uninstalls, updates or erases (`guard::installer_like`), an app from anywhere else, or one that came
//!   from the internet and was never opened (`guard::never_open`).
//! - Pages: only `https` and `http`, no credentials in the address, short enough for its line to show the whole address
//!   (`url_shown`, review of 12 October 2026: the yes covers the query and fragment too), never a banking or payment
//!   page (by host, path, query or fragment), never a redirect to another address in the query or fragment, and never a
//!   download of an installer, a disk image, a script or a link file.
//! - Files and folders: what `folder.rs` found or the person pointed at, re-checked right before opening (still there,
//!   still the same kind, still allowed), and the app macOS would open a file with must be one Brenda works in
//!   (`guard::handler_refused`; review, 12 October 2026: a certificate opens Keychain Access, a disk image mounts).
//! - Opening goes through `NSWorkspace` (`openURL:`, `activateFileViewerSelectingURLs:`), never by clicking. The
//!   `Opener` is the only thing that opens; `WorkspaceOpener` is built in exactly one place (`plan::run_open`) and the
//!   tests use `RecordingOpener`, so no test ever opens anything.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use crate::guard::{self, NeverOpen, OpenProbe};
use crate::look::{AppId, Rule};

/// Everyday names for apps whose bundles are called something longer (companion2-spec I.4.3; the same table as
/// `APP_ALIASES` in `src/lib/act.ts`).
pub const APP_ALIASES: &[(&str, &str)] = &[
    ("vs code", "Visual Studio Code"),
    ("vscode", "Visual Studio Code"),
    ("code", "Visual Studio Code"),
    ("word", "Microsoft Word"),
    ("excel", "Microsoft Excel"),
    ("powerpoint", "Microsoft PowerPoint"),
    ("outlook", "Microsoft Outlook"),
    ("onenote", "Microsoft OneNote"),
    ("chrome", "Google Chrome"),
    ("edge", "Microsoft Edge"),
    ("notes", "Notes"),
    ("calendar", "Calendar"),
    ("mail", "Mail"),
    ("music", "Music"),
    ("photos", "Photos"),
    ("preview", "Preview"),
    ("finder", "Finder"),
];

pub const APP_NAME_MAX: usize = 80;
pub const URL_MAX: usize = 2_000;
const MDFIND_TIME: Duration = Duration::from_secs(2);
const PLUTIL_TIME: Duration = Duration::from_secs(1);

/// Why something was not found or will not be opened (H.2.2 `why`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Why {
    None,
    Denied,
    Forbidden,
    Quarantined,
    Outside,
    Runs,
    Timeout,
    Gone,
}

impl Why {
    pub fn key(self) -> &'static str {
        match self {
            Why::None => "none",
            Why::Denied => "denied",
            Why::Forbidden => "forbidden",
            Why::Quarantined => "quarantined",
            Why::Outside => "outside",
            Why::Runs => "runs",
            Why::Timeout => "timeout",
            Why::Gone => "gone",
        }
    }

    pub fn of_never(n: NeverOpen) -> Why {
        match n {
            NeverOpen::Runs => Why::Runs,
            NeverOpen::NewApp => Why::Quarantined,
            NeverOpen::OutsideApp => Why::Outside,
        }
    }
}

// ---- the Mac, as the rules read it ----------------------------------------------------------------------------------

/// The real probe: the home folder, the quarantine attribute (`getxattr`, read only), execute bits.
pub struct RealProbe;

impl OpenProbe for RealProbe {
    fn home(&self) -> Option<PathBuf> {
        crate::filework::home()
    }
    fn quarantine(&self, path: &Path) -> Option<String> {
        quarantine_of(path)
    }
    fn handler(&self, path: &Path) -> Option<AppId> {
        let app = handler_app_of(path)?;
        let name = stem(&app);
        Some(AppId { bundle_id: bundle_id_of(&app), names: if name.is_empty() { vec![] } else { vec![name] } })
    }
    fn exec_file(&self, path: &Path) -> bool {
        std::fs::metadata(path).is_ok_and(|m| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                m.is_file() && m.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                let _ = m;
                false
            }
        })
    }
}

/// `com.apple.quarantine` of a file or bundle, read only.
#[cfg(target_os = "macos")]
pub fn quarantine_of(path: &Path) -> Option<String> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    extern "C" {
        fn getxattr(path: *const std::ffi::c_char, name: *const std::ffi::c_char, value: *mut std::ffi::c_void, size: usize, position: u32, options: i32) -> isize;
    }
    let p = CString::new(path.as_os_str().as_bytes()).ok()?;
    let name = c"com.apple.quarantine";
    let mut buf = vec![0u8; 512];
    let n = unsafe { getxattr(p.as_ptr(), name.as_ptr(), buf.as_mut_ptr().cast(), buf.len(), 0, 0) };
    if n <= 0 {
        return None;
    }
    buf.truncate(n as usize);
    Some(String::from_utf8_lossy(&buf).trim_end_matches('\0').to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn quarantine_of(_path: &Path) -> Option<String> {
    None
}

/// The app macOS opens a file with by default (`NSWorkspace URLForApplicationToOpenURL:`, which reads Launch Services
/// and opens nothing; review, 12 October 2026). NSWorkspace may be used from any thread [UNVERIFIED for this call on
/// every macOS: checked by hand on this Mac with `system_open_reads`].
#[cfg(target_os = "macos")]
pub fn handler_app_of(path: &Path) -> Option<PathBuf> {
    use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| unsafe {
        let (ws_cls, url_cls) = (AnyClass::get(c"NSWorkspace")?, AnyClass::get(c"NSURL")?);
        let ws: Option<Retained<AnyObject>> = msg_send![ws_cls, sharedWorkspace];
        let ws = ws?;
        let s = NSString::from_str(&path.to_string_lossy());
        let url: Option<Retained<AnyObject>> = msg_send![url_cls, fileURLWithPath: &*s];
        let url = url?;
        let app: Option<Retained<AnyObject>> = msg_send![&*ws, URLForApplicationToOpenURL: &*url];
        let app = app?;
        let p: Option<Retained<NSString>> = msg_send![&*app, path];
        let p = p?.to_string();
        (!p.is_empty()).then(|| PathBuf::from(p))
    })
}

#[cfg(not(target_os = "macos"))]
pub fn handler_app_of(_path: &Path) -> Option<PathBuf> {
    None
}

/// An app's bundle identifier, from its Info.plist (`plutil`, 1 s) [UNVERIFIED on every app: checked on Safari].
pub fn bundle_id_of(app: &Path) -> Option<String> {
    let plist = app.join("Contents/Info.plist");
    let out = run("/usr/bin/plutil", &["-extract", "CFBundleIdentifier", "raw", "-o", "-", &plist.to_string_lossy()], PLUTIL_TIME)?;
    let id = String::from_utf8_lossy(&out).trim().to_string();
    (1..=255).contains(&id.len()).then_some(id).filter(|i| i.chars().all(|c| c.is_ascii_alphanumeric() || ".-_".contains(c)))
}

/// Runs a system tool with a time limit; its output, or None.
fn run(program: &str, args: &[&str], limit: Duration) -> Option<Vec<u8>> {
    use std::process::{Command, Stdio};
    let mut child = Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = std::io::Read::read_to_end(&mut out, &mut buf);
        buf
    });
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status.success().then(|| reader.join().ok()).flatten(),
            Ok(None) if started.elapsed() < limit => std::thread::sleep(Duration::from_millis(15)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// Spotlight, behind a trait (companion2-spec I.4.3, I.4.4).
pub trait AppSearch {
    /// Apps whose name is `name`, within `dirs`.
    fn find_apps(&self, name: &str, dirs: &[PathBuf]) -> Vec<PathBuf>;
}

#[cfg(test)]
pub struct NoSearch;

#[cfg(test)]
impl AppSearch for NoSearch {
    fn find_apps(&self, _name: &str, _dirs: &[PathBuf]) -> Vec<PathBuf> {
        vec![]
    }
}

/// `mdfind` and `mdls` [UNVERIFIED: what Spotlight answers a non-sandboxed app under TCC].
pub struct Spotlight;

impl AppSearch for Spotlight {
    /// One `mdfind` over the whole Mac (about 0.1 s here), its answers kept only inside `dirs`.
    fn find_apps(&self, name: &str, dirs: &[PathBuf]) -> Vec<PathBuf> {
        let clean: String = name.chars().filter(|c| c.is_alphanumeric() || " .-_".contains(*c)).collect();
        let clean = clean.trim();
        if clean.is_empty() {
            return vec![];
        }
        let query = format!("kMDItemContentType == \"com.apple.application-bundle\" && (kMDItemDisplayName == \"{clean}\"cd || kMDItemDisplayName == \"{clean}.app\"cd)");
        let Some(bytes) = run("/usr/bin/mdfind", &[&query], MDFIND_TIME) else { return vec![] };
        String::from_utf8_lossy(&bytes)
            .lines()
            .map(str::trim)
            .filter(|l| l.starts_with('/') && l.to_lowercase().ends_with(".app"))
            .map(PathBuf::from)
            .filter(|p| dirs.iter().any(|d| p.starts_with(d)))
            .take(20)
            .collect()
    }
}

impl crate::folder::LastUsed for Spotlight {
    fn last_used(&self, paths: &[PathBuf]) -> Option<Vec<Option<i64>>> {
        if paths.is_empty() || paths.len() > 100 {
            return None;
        }
        let mut args: Vec<String> = vec!["-raw".into(), "-name".into(), "kMDItemLastUsedDate".into()];
        args.extend(paths.iter().map(|p| p.to_string_lossy().to_string()));
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = run("/usr/bin/mdls", &refs, MDFIND_TIME)?;
        let values: Vec<Option<i64>> = String::from_utf8_lossy(&out).split('\0').map(parse_md_date).collect();
        (values.len() == paths.len()).then_some(values)
    }
}

/// "2026-10-05 07:54:23 +0000" (mdls) as unix seconds; "(null)" or anything else is None.
pub fn parse_md_date(s: &str) -> Option<i64> {
    let s = s.trim();
    let (date, rest) = s.split_once(' ')?;
    let (time, zone) = rest.split_once(' ')?;
    let d: Vec<i64> = date.split('-').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    let t: Vec<i64> = time.split(':').map(|x| x.parse().ok()).collect::<Option<_>>()?;
    if d.len() != 3 || t.len() != 3 || zone.len() != 5 {
        return None;
    }
    let sign = if zone.starts_with('-') { -1 } else { 1 };
    let off = sign * (zone[1..3].parse::<i64>().ok()? * 3600 + zone[3..5].parse::<i64>().ok()? * 60);
    let (y, m, day) = (d[0], d[1], d[2]);
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86_400 + t[0] * 3600 + t[1] * 60 + t[2] - off)
}

// ---- apps -----------------------------------------------------------------------------------------------------------

/// An app found by name.
#[derive(Clone, Debug, PartialEq)]
pub struct AppFound {
    pub path: PathBuf,
    /// Its own name (the bundle's, without `.app`).
    pub name: String,
    pub bundle_id: Option<String>,
    /// "Applications", "Utilities", "System Applications", "your Applications".
    pub where_: &'static str,
}

/// A name as a person says it: trimmed, one line, a trailing ".app" dropped.
pub fn app_name_ok(name: &str) -> bool {
    let n = name.trim();
    (1..=APP_NAME_MAX).contains(&n.chars().count()) && !n.contains(['/', '\n', '\r']) && !n.chars().any(char::is_control)
}

fn clean_name(name: &str) -> String {
    let n = name.trim();
    let n = if n.to_lowercase().ends_with(".app") { &n[..n.len() - 4] } else { n };
    n.trim().to_string()
}

/// The `.app` bundles directly in a folder (links count: `/Applications/Safari.app` is one).
fn apps_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    let mut out: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app"))).collect();
    out.sort();
    out
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

/// Finds an app by name (companion2-spec I.4.3) in `folders` (the app folders in order, with their words) and checks
/// the rules (B.1): the never-look and never-act lists by name and bundle id, the folder, the quarantine flag.
pub fn resolve_app(name: &str, folders: &[(PathBuf, &'static str)], search: &dyn AppSearch, probe: &dyn OpenProbe, bundle: &dyn Fn(&Path) -> Option<String>, rules: &[Rule]) -> Result<AppFound, Why> {
    if !app_name_ok(name) {
        return Err(Why::None);
    }
    let wanted = clean_name(name);
    if guard::no_act(&AppId { bundle_id: None, names: vec![wanted.clone()] }, rules).is_some() {
        return Err(Why::Forbidden);
    }
    if guard::installer_like(std::slice::from_ref(&wanted), None) {
        return Err(Why::Runs);
    }
    let alias = APP_ALIASES.iter().find(|(a, _)| a.eq_ignore_ascii_case(&wanted)).map(|(_, t)| t.to_string());
    // CoreServices holds Finder and system helpers (Erase Assistant, installers, updaters): only Finder is opened from
    // there (review, 12 October 2026).
    let find = |n: &str| -> Option<(PathBuf, &'static str)> {
        folders.iter().find_map(|(dir, words)| {
            let core = dir.ends_with("CoreServices");
            apps_in(dir).into_iter().filter(|p| !core || p.as_path() == Path::new(guard::FINDER_APP)).find(|p| stem(p).eq_ignore_ascii_case(n)).map(|p| (p, *words))
        })
    };
    let found = find(&wanted).or_else(|| alias.as_deref().and_then(find)).or_else(|| {
        let dirs: Vec<PathBuf> = folders.iter().map(|(d, _)| d.clone()).collect();
        search.find_apps(&wanted, &dirs).into_iter().find_map(|p| {
            let words = folders.iter().filter(|(d, _)| p.starts_with(d)).max_by_key(|(d, _)| d.components().count()).map(|(_, w)| *w)?;
            Some((p, words))
        })
    });
    let Some((path, where_)) = found else { return Err(Why::None) };
    let own = stem(&path);
    let bundle_id = bundle(&path);
    if guard::no_act(&AppId { bundle_id: bundle_id.clone(), names: vec![own.clone(), wanted.clone()] }, rules).is_some() {
        return Err(Why::Forbidden);
    }
    if guard::installer_like(&[own.clone(), wanted], bundle_id.as_deref()) {
        return Err(Why::Runs);
    }
    if path.starts_with("/System/Library/CoreServices") && bundle_id.as_deref() != Some(guard::FINDER_ID) {
        return Err(Why::Outside);
    }
    if let Some(n) = guard::never_open(&path, probe) {
        return Err(Why::of_never(n));
    }
    Ok(AppFound { path, name: own, bundle_id, where_ })
}

/// The front desk's app rules (owner brief, 12 October 2026; helpers-spec 0b.15, B.2): an app the index resolved is
/// opened, switched to, hidden, arranged or quit whatever list it is on (she reads nothing inside it), except an app that
/// installs, updates or erases (`installer`), one outside the app folders that isn't running (`outside_apps`), one from
/// the internet never opened (`quarantined`), and anything from CoreServices but Finder. Checked right before it is used.
pub fn resolve_app_v2(path: Option<&Path>, name: &str, bundle_id: Option<&str>, running: bool, probe: &dyn OpenProbe) -> Result<(), Why> {
    let own = path.map(stem).unwrap_or_default();
    if guard::installer_like(&[name.to_string(), own], bundle_id) {
        return Err(Why::Runs);
    }
    if running {
        return Ok(());
    }
    let Some(path) = path else { return Err(Why::None) };
    if path.starts_with("/System/Library/CoreServices") && path != Path::new(guard::FINDER_APP) {
        return Err(Why::Outside);
    }
    match guard::never_open(path, probe) {
        Some(n) => Err(Why::of_never(n)),
        None => Ok(()),
    }
}

/// A web page the front desk may open (helpers-spec C.2; owner brief, 12 October 2026: "Go to stripe.com … opens"):
/// phase 3's `url_ok` without the payment refusal and without the "shown whole" cap. `https://` is added to a bare host.
/// Kept: https or http only, at most 2,000 characters, no user name or password, a host, no control characters, no file
/// that runs or holds secrets at the end of the path, no other address in the query or fragment. The cleaned address,
/// or None. The same vectors as `frontUrl` in `src/lib/front.ts`.
pub fn front_url_ok(url: &str) -> Option<String> {
    let u = url.trim();
    if u.is_empty() || u.chars().count() > URL_MAX || u.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return None;
    }
    let lower = u.to_lowercase();
    let full = if lower.starts_with("http://") || lower.starts_with("https://") {
        u.to_string()
    } else if !u.contains("://") && !lower.starts_with("javascript:") && !lower.starts_with("data:") && !lower.starts_with("file:") && u.split('/').next().is_some_and(|h| h.contains('.') && !h.contains(':') && !h.contains('@')) {
        format!("https://{u}")
    } else {
        return None;
    };
    let parsed = reqwest::Url::parse(&full).ok()?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none_or(str::is_empty) {
        return None;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return None;
    }
    let mut parts: Vec<String> = parsed.query_pairs().flat_map(|(k, v)| [k.to_string(), v.to_string()]).collect();
    if let Some(f) = parsed.fragment() {
        parts.push(percent_decode(f));
    }
    if parts.iter().any(|p| redirects(&p.to_lowercase())) {
        return None;
    }
    let last = parsed.path_segments().and_then(|mut s| s.next_back()).map(percent_decode).unwrap_or_default();
    let last = Path::new(&last);
    if guard::runs_something(last) || guard::secret_file(last) {
        return None;
    }
    let s = parsed.to_string();
    Some(if parsed.path() == "/" && parsed.query().is_none() && parsed.fragment().is_none() { s.trim_end_matches('/').to_string() } else { s })
}

// ---- browsers (owner report, 28 October 2026) ---------------------------------------------------------------------------

/// One web browser people name: what they say, the app's own names, its bundle ids. Owner report, 28 October 2026 ("open
/// a new tab in Brave" got "Opened Brave Browser": the front desk only knew `open_app`): a tab, a page in a named
/// browser and a search go only to an app in this table, the front app when it is one, or the Mac's default browser.
/// The same names as `BROWSERS` in `src/lib/front.ts`.
pub struct Browser {
    pub said: &'static [&'static str],
    pub names: &'static [&'static str],
    pub bundle_ids: &'static [&'static str],
}

pub const BROWSERS: &[Browser] = &[
    Browser { said: &["safari"], names: &["Safari"], bundle_ids: &["com.apple.Safari"] },
    Browser { said: &["chrome", "google chrome"], names: &["Google Chrome"], bundle_ids: &["com.google.Chrome"] },
    Browser { said: &["brave", "brave browser"], names: &["Brave Browser"], bundle_ids: &["com.brave.Browser"] },
    Browser { said: &["arc"], names: &["Arc"], bundle_ids: &["company.thebrowser.Browser"] },
    Browser { said: &["firefox", "mozilla firefox", "fire fox"], names: &["Firefox"], bundle_ids: &["org.mozilla.firefox"] },
    Browser { said: &["edge", "microsoft edge"], names: &["Microsoft Edge"], bundle_ids: &["com.microsoft.edgemac"] },
    Browser { said: &["opera"], names: &["Opera"], bundle_ids: &["com.operasoftware.Opera"] },
    Browser { said: &["vivaldi"], names: &["Vivaldi"], bundle_ids: &["com.vivaldi.Vivaldi"] },
    Browser { said: &["orion"], names: &["Orion"], bundle_ids: &["com.kagi.kagimacOS"] },
    Browser { said: &["zen", "zen browser"], names: &["Zen", "Zen Browser"], bundle_ids: &["app.zen-browser.zen"] },
    Browser { said: &["duckduckgo", "duck duck go"], names: &["DuckDuckGo"], bundle_ids: &["com.duckduckgo.macos.browser"] },
];

/// The browser a name means, by what people say or the app's own name ("brave", "Brave Browser", "chrome").
pub fn browser_said(said: &str) -> Option<&'static Browser> {
    let k = crate::appindex::key_of(&crate::appindex::clean_said(said));
    if k.is_empty() {
        return None;
    }
    BROWSERS.iter().find(|b| b.said.iter().chain(b.names).any(|n| crate::appindex::key_of(n) == k))
}

/// Whether an app is a web browser: its bundle id, else its own name, in `BROWSERS`.
pub fn is_browser(name: &str, bundle_id: Option<&str>) -> bool {
    if let Some(id) = bundle_id.filter(|i| !i.is_empty()) {
        if BROWSERS.iter().any(|b| b.bundle_ids.iter().any(|x| x.eq_ignore_ascii_case(id))) {
            return true;
        }
    }
    let k = crate::appindex::key_of(name);
    !k.is_empty() && BROWSERS.iter().any(|b| b.names.iter().any(|n| crate::appindex::key_of(n) == k))
}

/// The page a new tab falls back to when the keys can't be pressed (no Accessibility, or the browser wasn't open):
/// Google's home page, as a search would use.
pub const BROWSER_HOME: &str = "https://www.google.com";
/// The most a search's words may be (characters).
pub const SEARCH_MAX: usize = 200;

/// Google's results for `words` (owner report, 28 October 2026): `https://www.google.com/search?q=…`, the words
/// form-encoded. None for nothing to search, more than 200 characters, or control characters. The host and path are
/// fixed, so the words can never make it another page.
pub fn search_url(words: &str) -> Option<String> {
    let w = words.trim();
    if w.is_empty() || w.chars().count() > SEARCH_MAX || w.chars().any(char::is_control) {
        return None;
    }
    reqwest::Url::parse_with_params("https://www.google.com/search", &[("q", w)]).ok().map(|u| u.to_string())
}

// ---- pages ----------------------------------------------------------------------------------------------------------

/// Query parameters whose value is another address: a redirector ("google.com/url?q=https://paypal.com/…") would open a
/// page the line doesn't name (review, 12 October 2026).
fn redirects(value: &str) -> bool {
    let v = value.trim().to_lowercase();
    v.starts_with("http:") || v.starts_with("https:") || v.starts_with("//") || v.starts_with("www.") || v.contains("://")
}

/// The address as the plan's line shows it, and as the person says yes to it (review, 12 October 2026: the line showed
/// only the host and part of the path, so a query or fragment could hide a form submission or a download): everything
/// after `https://`, the `www.` and a lone trailing `/` left out. The same as `urlShown` in `src/lib/act.ts`.
pub fn url_shown(url: &str) -> Option<String> {
    let u = reqwest::Url::parse(url.trim()).ok()?;
    let host = u.host_str()?;
    let host = host.strip_prefix("www.").unwrap_or(host).to_string();
    let port = u.port().map(|p| format!(":{p}")).unwrap_or_default();
    let path = if u.path() == "/" { String::new() } else { u.path().to_string() };
    // As the browser's `search` and `hash` read them: an empty "?" or "#" shows nothing.
    let query = u.query().filter(|q| !q.is_empty()).map(|q| format!("?{q}")).unwrap_or_default();
    let frag = u.fragment().filter(|f| !f.is_empty()).map(|f| format!("#{f}")).unwrap_or_default();
    let scheme = if u.scheme() == "http" { "http://" } else { "" };
    Some(format!("{scheme}{host}{port}{path}{query}{frag}"))
}

/// The longest address a line can show whole ("Open {address} in your browser" within the line's 200 characters).
pub const URL_SHOWN_MAX: usize = 170;

/// A web page Brenda may open (companion2-spec B.1): `https`/`http`, a host, no user name or password, short enough to
/// show whole in its line, not a banking or payment page (by host, path, query or fragment), not a redirect to another
/// address, not a download of something that runs.
pub fn url_ok(url: &str) -> bool {
    let u = url.trim();
    if u.is_empty() || u.chars().count() > URL_MAX || u.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return false;
    }
    let Ok(parsed) = reqwest::Url::parse(u) else { return false };
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none_or(str::is_empty) {
        return false;
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return false;
    }
    if guard::payment_page(u) {
        return false;
    }
    if url_shown(u).is_none_or(|s| s.chars().count() > URL_SHOWN_MAX) {
        return false;
    }
    // The query and fragment, decoded, are read too: a payment hint, a redirect or a file that runs refuses.
    let mut parts: Vec<String> = parsed.query_pairs().flat_map(|(k, v)| [k.to_string(), v.to_string()]).collect();
    if let Some(f) = parsed.fragment() {
        parts.push(percent_decode(f));
    }
    for p in &parts {
        let l = p.to_lowercase();
        if redirects(&l) || guard::PAYMENT_HINTS.iter().any(|h| l.contains(h)) || l.split(['/', '&', '=', '?']).any(|seg| guard::runs_something(Path::new(seg.trim()))) {
            return false;
        }
    }
    !guard::runs_something(Path::new(parsed.path()))
}

/// `%xx` decoded (bytes as UTF-8, lossy); anything malformed stays as it is.
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    let hex = |c: u8| (c as char).to_digit(16);
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

// ---- opening --------------------------------------------------------------------------------------------------------

/// The only thing that opens (companion2-spec I.4.5).
pub trait Opener {
    fn open_path(&mut self, p: &Path) -> bool;
    fn reveal(&mut self, p: &Path) -> bool;
    fn open_url(&mut self, u: &str) -> bool;
    /// `u` in the app at `app` (a browser; owner report, 28 October 2026), not the default browser.
    fn open_url_in(&mut self, u: &str, app: &Path) -> bool;
}

/// Records what would have been opened (tests).
#[cfg(test)]
#[derive(Default, Debug)]
pub struct RecordingOpener {
    pub calls: Vec<String>,
}

#[cfg(test)]
impl Opener for RecordingOpener {
    fn open_path(&mut self, p: &Path) -> bool {
        self.calls.push(format!("open {}", p.display()));
        true
    }
    fn reveal(&mut self, p: &Path) -> bool {
        self.calls.push(format!("reveal {}", p.display()));
        true
    }
    fn open_url(&mut self, u: &str) -> bool {
        self.calls.push(format!("url {u}"));
        true
    }
    fn open_url_in(&mut self, u: &str, app: &Path) -> bool {
        self.calls.push(format!("url {u} in {}", app.display()));
        true
    }
}

/// `NSWorkspace` on the main thread. Built only by `plan::run_open`.
pub struct WorkspaceOpener {
    app: tauri::AppHandle,
}

impl WorkspaceOpener {
    pub(crate) fn new(app: &tauri::AppHandle) -> Self {
        WorkspaceOpener { app: app.clone() }
    }

    fn on_main(&self, what: Target) -> bool {
        // An app's launch is not waited for (review, 16 October 2026: "Open Figma" measured 682 ms, almost all of it
        // macOS starting the app): once the open is on its way, the done line comes. macOS's own answer still counts
        // when it is quick (a refusal comes at once); otherwise the launch is in flight and taken as done.
        let launch = matches!(&what, Target::Path(p) if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app")));
        let (tx, rx) = std::sync::mpsc::channel();
        let sent = self.app.run_on_main_thread(move || {
            let _ = tx.send(workspace(what));
        });
        if sent.is_err() {
            return false;
        }
        launch_answer(rx.recv_timeout(if launch { LAUNCH_WAIT } else { Duration::from_secs(5) }), launch)
    }
}

enum Target {
    Path(PathBuf),
    Reveal(PathBuf),
    Url(String),
}

/// How long an app's open waits for macOS's answer before the done line (review, 16 October 2026).
pub const LAUNCH_WAIT: Duration = Duration::from_millis(150);

/// macOS's answer to an open: an app's launch still under way when the wait ends is taken as done; anything else is
/// whatever macOS said (no answer at all is a failure).
fn launch_answer(got: Result<bool, std::sync::mpsc::RecvTimeoutError>, launch: bool) -> bool {
    match got {
        Ok(ok) => ok,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => launch,
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => false,
    }
}

impl Opener for WorkspaceOpener {
    fn open_path(&mut self, p: &Path) -> bool {
        self.on_main(Target::Path(p.to_path_buf()))
    }
    fn reveal(&mut self, p: &Path) -> bool {
        self.on_main(Target::Reveal(p.to_path_buf()))
    }
    fn open_url(&mut self, u: &str) -> bool {
        self.on_main(Target::Url(u.to_string()))
    }
    /// `openURLs:withApplicationAtURL:configuration:completionHandler:` on the main thread (owner report, 28 October
    /// 2026). macOS answers in the completion handler: an error is a failure; no answer within 3 s is a browser still
    /// launching, taken as opened (as an app's launch is, `launch_answer`).
    fn open_url_in(&mut self, u: &str, app: &Path) -> bool {
        let (tx, rx) = std::sync::mpsc::channel::<bool>();
        let (u, app_path) = (u.to_string(), app.to_path_buf());
        let sent = self.app.run_on_main_thread(move || {
            if !open_in(&u, &app_path, tx.clone()) {
                let _ = tx.send(false);
            }
        });
        if sent.is_err() {
            return false;
        }
        launch_answer(rx.recv_timeout(Duration::from_secs(3)), true)
    }
}

/// Starts opening `u` with the app at `app`; `done` gets macOS's answer. Whether the call was made. Main thread only.
#[cfg(target_os = "macos")]
fn open_in(u: &str, app: &Path, done: std::sync::mpsc::Sender<bool>) -> bool {
    use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| unsafe {
        let (Some(ws_cls), Some(url_cls), Some(arr_cls), Some(cfg_cls)) = (AnyClass::get(c"NSWorkspace"), AnyClass::get(c"NSURL"), AnyClass::get(c"NSArray"), AnyClass::get(c"NSWorkspaceOpenConfiguration")) else { return false };
        let ws: Option<Retained<AnyObject>> = msg_send![ws_cls, sharedWorkspace];
        let Some(ws) = ws else { return false };
        let us = NSString::from_str(u);
        let url: Option<Retained<AnyObject>> = msg_send![url_cls, URLWithString: &*us];
        let ps = NSString::from_str(&app.to_string_lossy());
        let app_url: Option<Retained<AnyObject>> = msg_send![url_cls, fileURLWithPath: &*ps];
        let (Some(url), Some(app_url)) = (url, app_url) else { return false };
        let urls: Option<Retained<AnyObject>> = msg_send![arr_cls, arrayWithObject: &*url];
        let config: Option<Retained<AnyObject>> = msg_send![cfg_cls, configuration];
        let (Some(urls), Some(config)) = (urls, config) else { return false };
        let _: () = msg_send![&*config, setActivates: true];
        let done = std::sync::Mutex::new(Some(done));
        let block = block2::RcBlock::new(move |_app: *mut AnyObject, error: *mut AnyObject| {
            if let Some(tx) = done.lock().ok().and_then(|mut d| d.take()) {
                let _ = tx.send(error.is_null());
            }
        });
        let _: () = msg_send![&*ws, openURLs: &*urls, withApplicationAtURL: &*app_url, configuration: &*config, completionHandler: &*block];
        true
    })
}

#[cfg(not(target_os = "macos"))]
fn open_in(_u: &str, _app: &Path, _done: std::sync::mpsc::Sender<bool>) -> bool {
    false
}

/// The app macOS opens web pages with (`URLForApplicationToOpenURL:`), or None. Main thread only.
#[cfg(target_os = "macos")]
pub(crate) fn default_browser_now() -> Option<PathBuf> {
    use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| unsafe {
        let ws_cls = AnyClass::get(c"NSWorkspace")?;
        let url_cls = AnyClass::get(c"NSURL")?;
        let ws: Option<Retained<AnyObject>> = msg_send![ws_cls, sharedWorkspace];
        let s = NSString::from_str(BROWSER_HOME);
        let probe: Option<Retained<AnyObject>> = msg_send![url_cls, URLWithString: &*s];
        let app: Option<Retained<AnyObject>> = msg_send![&*ws?, URLForApplicationToOpenURL: &*probe?];
        let path: Option<Retained<NSString>> = msg_send![&*app?, path];
        path.map(|p| PathBuf::from(p.to_string())).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app")))
    })
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn default_browser_now() -> Option<PathBuf> {
    None
}

#[cfg(target_os = "macos")]
fn workspace(what: Target) -> bool {
    use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| unsafe {
        let (Some(ws_cls), Some(url_cls), Some(arr_cls)) = (AnyClass::get(c"NSWorkspace"), AnyClass::get(c"NSURL"), AnyClass::get(c"NSArray")) else { return false };
        let ws: Option<Retained<AnyObject>> = msg_send![ws_cls, sharedWorkspace];
        let Some(ws) = ws else { return false };
        let url: Option<Retained<AnyObject>> = match &what {
            Target::Path(p) | Target::Reveal(p) => {
                let s = NSString::from_str(&p.to_string_lossy());
                msg_send![url_cls, fileURLWithPath: &*s]
            }
            Target::Url(u) => {
                let s = NSString::from_str(u);
                msg_send![url_cls, URLWithString: &*s]
            }
        };
        let Some(url) = url else { return false };
        match what {
            Target::Reveal(_) => {
                let arr: Option<Retained<AnyObject>> = msg_send![arr_cls, arrayWithObject: &*url];
                let Some(arr) = arr else { return false };
                let _: () = msg_send![&*ws, activateFileViewerSelectingURLs: &*arr];
                true
            }
            _ => msg_send![&*ws, openURL: &*url],
        }
    })
}

#[cfg(not(target_os = "macos"))]
fn workspace(_what: Target) -> bool {
    false
}

/// Opens a path through `NSWorkspace` on the calling thread: only `macos::tests::open_calculator` (ignored; the
/// integrator runs it once on the owner's Mac, then Calculator is quit).
#[cfg(test)]
pub(crate) fn open_now_for_test(p: &Path) -> bool {
    workspace(Target::Path(p.to_path_buf()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_bundle(_p: &Path) -> Option<String> {
        None
    }

    /// C.2's vectors (the same as `frontUrl` in `src/lib/front.ts`).
    #[test]
    fn front_url_vectors() {
        assert_eq!(front_url_ok("https://stripe.com").as_deref(), Some("https://stripe.com"));
        assert_eq!(front_url_ok("stripe.com").as_deref(), Some("https://stripe.com"), "https is added");
        assert_eq!(front_url_ok("http://intranet.local/x").as_deref(), Some("http://intranet.local/x"));
        assert_eq!(front_url_ok("https://paypal.com/myaccount").as_deref(), Some("https://paypal.com/myaccount"), "payment pages open now (0b.12)");
        for bad in ["ftp://x.com", "https://user:pw@x.com", "https://x.com/setup.pkg", "https://google.com/url?q=https://paypal.com", "javascript:alert(1)", "", "https://", "https://x.com/a b", "file:///etc/passwd", "https://x.com/backup.kdbx"] {
            assert_eq!(front_url_ok(bad), None, "{bad}");
        }
        assert!(front_url_ok(&format!("https://x.com/{}", "a".repeat(1_990))).is_none());
        assert!(front_url_ok(&format!("https://x.com/{}", "a".repeat(400))).is_some(), "no 170-character cap any more");
    }

    /// Owner report, 28 October 2026: the browsers people name, and Google's results for their words.
    #[test]
    fn browsers_and_searches() {
        for (said, name) in [("brave", "Brave Browser"), ("Brave Browser", "Brave Browser"), ("chrome", "Google Chrome"), ("Safari", "Safari"), ("arc", "Arc"), ("Firefox", "Firefox"), ("edge", "Microsoft Edge"), ("opera", "Opera"), ("Vivaldi", "Vivaldi"), ("orion", "Orion"), ("zen", "Zen"), ("duck duck go", "DuckDuckGo"), ("the Brave app", "Brave Browser")] {
            assert_eq!(browser_said(said).map(|b| b.names[0]), Some(name), "{said}");
        }
        for not in ["notes", "figma", "", "browser"] {
            assert!(browser_said(not).is_none(), "{not}");
        }
        assert!(is_browser("Brave Browser", None) && is_browser("Whatever", Some("com.brave.Browser")) && is_browser("Zen Browser", None));
        assert!(!is_browser("Notes", Some("com.apple.Notes")) && !is_browser("", None));
        assert_eq!(search_url("remote work tools").as_deref(), Some("https://www.google.com/search?q=remote+work+tools"));
        assert_eq!(search_url(" a&b=c#d ").as_deref(), Some("https://www.google.com/search?q=a%26b%3Dc%23d"), "the words never become another parameter");
        assert_eq!(search_url("https://evil.example/x").map(|u| u.starts_with("https://www.google.com/search?q=")), Some(true), "Google's page, whatever the words");
        assert!(search_url("").is_none() && search_url("   ").is_none() && search_url(&"x".repeat(201)).is_none() && search_url("a\u{0}b").is_none());
        assert_eq!(super::BROWSERS.len(), 11);
    }

    /// Review, 16 October 2026: an app's launch is not waited for; a file or page still is.
    #[test]
    fn launch_is_not_waited_for() {
        use std::sync::mpsc::RecvTimeoutError::{Disconnected, Timeout};
        assert!(launch_answer(Err(Timeout), true), "an app still launching counts as opened");
        assert!(!launch_answer(Err(Timeout), false), "a file that never answered did not open");
        assert!(!launch_answer(Ok(false), true), "macOS's quick no stands");
        assert!(!launch_answer(Err(Disconnected), true));
        assert!(LAUNCH_WAIT <= Duration::from_millis(200));
    }

    #[test]
    fn resolve_app_v2_rules() {
        let home = crate::folder::tests::scratch("home-apps-v2");
        std::fs::create_dir_all(home.join("Applications/Slack.app/Contents")).unwrap();
        std::fs::create_dir_all(home.join("Downloads/Stray.app/Contents")).unwrap();
        let pr = guard::tests::FakeProbe { home: Some(home.clone()), quarantine: vec![], exec: vec![] };
        let slack = home.join("Applications/Slack.app");
        assert_eq!(resolve_app_v2(Some(&slack), "Slack", Some("com.tinyspeck.slackmacgap"), false, &pr), Ok(()), "never-look apps open (0b.15)");
        assert_eq!(resolve_app_v2(Some(&home.join("Downloads/Stray.app")), "Stray", None, false, &pr), Err(Why::Outside));
        assert_eq!(resolve_app_v2(Some(&home.join("Downloads/Stray.app")), "Stray", None, true, &pr), Ok(()), "already running: switching to it is fine");
        assert_eq!(resolve_app_v2(Some(&slack), "Install macOS", None, false, &pr), Err(Why::Runs));
        assert_eq!(resolve_app_v2(Some(Path::new("/System/Library/CoreServices/Erase Assistant.app")), "Erase Assistant", None, false, &pr), Err(Why::Runs));
        assert_eq!(resolve_app_v2(Some(Path::new("/System/Library/CoreServices/Ticket Viewer.app")), "Ticket Viewer", None, false, &pr), Err(Why::Outside));
        let pr = guard::tests::FakeProbe { home: Some(home.clone()), quarantine: vec![(slack.to_string_lossy().to_string(), "0081;65f0;Safari;".into())], exec: vec![] };
        assert_eq!(resolve_app_v2(Some(&slack), "Slack", None, false, &pr), Err(Why::Quarantined));
    }

    /// A temp home folder whose own Applications folder holds the apps (never the Mac's real folders).
    #[test]
    fn resolve_app() {
        let home = crate::folder::tests::scratch("home-apps");
        for n in ["Figma.app", "Visual Studio Code.app", "Microsoft Word.app", "Terminal.app", "Notes.app"] {
            std::fs::create_dir_all(home.join("Applications").join(n).join("Contents")).unwrap();
        }
        std::fs::create_dir_all(home.join("Elsewhere/Stray.app")).unwrap();
        let folders = vec![(home.join("Applications"), "your Applications")];
        let pr = guard::tests::FakeProbe { home: Some(home.clone()), quarantine: vec![], exec: vec![] };
        let r = |n: &str| super::resolve_app(n, &folders, &NoSearch, &pr, &no_bundle, &[]);
        let f = r("figma").unwrap();
        assert_eq!((f.name.as_str(), f.where_), ("Figma", "your Applications"), "case-insensitive");
        assert_eq!(f.path, home.join("Applications/Figma.app"));
        assert_eq!(r(" Figma.app ").unwrap().name, "Figma");
        assert_eq!(r("VS Code").unwrap().name, "Visual Studio Code", "the alias table");
        assert_eq!(r("word").unwrap().name, "Microsoft Word");
        assert_eq!(r("Sketch"), Err(Why::None));
        assert_eq!(r("Terminal"), Err(Why::Forbidden), "never-act by name, before looking");
        assert_eq!(r("Install macOS Sequoia"), Err(Why::Runs), "installers by name, before looking");
        assert_eq!(super::resolve_app("Notes", &folders, &NoSearch, &pr, &|_| Some("com.apple.InstallAssistant.macOSSequoia".into()), &[]), Err(Why::Runs), "installers by bundle id");
        assert_eq!(r(""), Err(Why::None));
        assert_eq!(r("a/b"), Err(Why::None));
        // CoreServices: Finder only (review, 12 October 2026).
        let core = home.join("System/Library/CoreServices");
        for n in ["DiskImageMounter.app", "Database Events.app", "Erase Assistant.app"] {
            std::fs::create_dir_all(core.join(n)).unwrap();
        }
        let cs = vec![(core.clone(), "System Applications")];
        assert_eq!(super::resolve_app("DiskImageMounter", &cs, &NoSearch, &pr, &no_bundle, &[]), Err(Why::None), "not offered from CoreServices");
        assert_eq!(super::resolve_app("Database Events", &cs, &NoSearch, &pr, &no_bundle, &[]), Err(Why::None));
        assert_eq!(super::resolve_app("Erase Assistant", &cs, &NoSearch, &pr, &no_bundle, &[]), Err(Why::Runs));
        // A folder that is not an Applications folder.
        let stray = vec![(home.join("Elsewhere"), "Applications")];
        assert_eq!(super::resolve_app("Stray", &stray, &NoSearch, &pr, &no_bundle, &[]), Err(Why::Outside));
        // A bundle id on the lists refuses too.
        assert_eq!(super::resolve_app("Notes", &folders, &NoSearch, &pr, &|_| Some("com.apple.Terminal".into()), &[]), Err(Why::Forbidden));
        // The person's own never-look rule.
        let rules = vec![Rule { name: "Figma".into(), bundle_id: None, source: crate::look::RuleSource::You }];
        assert_eq!(super::resolve_app("Figma", &folders, &NoSearch, &pr, &no_bundle, &rules), Err(Why::Forbidden));
        // From the internet and never opened [the bit is UNVERIFIED for a never-opened app].
        let q = guard::tests::FakeProbe { home: Some(home.clone()), quarantine: vec![(home.join("Applications/Figma.app").to_string_lossy().to_string(), "0083;x;Safari;".into())], exec: vec![] };
        assert_eq!(super::resolve_app("Figma", &folders, &NoSearch, &q, &no_bundle, &[]), Err(Why::Quarantined));
        // Spotlight's fallback counts only within the folders.
        struct Found(PathBuf);
        impl AppSearch for Found {
            fn find_apps(&self, _n: &str, _d: &[PathBuf]) -> Vec<PathBuf> {
                vec![PathBuf::from("/Users/a/Downloads/Evil.app"), self.0.clone()]
            }
        }
        let s = Found(home.join("Applications/Notes.app"));
        assert_eq!(super::resolve_app("My notes app", &folders, &s, &pr, &no_bundle, &[]).unwrap().name, "Notes");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn url_rules() {
        assert!(url_ok("https://www.figma.com/files/recent"));
        assert!(url_ok("http://example.com"));
        assert!(!url_ok("file:///etc/hosts"));
        assert!(!url_ok("javascript:alert(1)"));
        assert!(!url_ok("ftp://example.com/x"));
        assert!(!url_ok("https://user:pw@example.com/"));
        assert!(!url_ok("https://www.paypal.com/"));
        assert!(!url_ok("https://shop.example.com/checkout"));
        assert!(!url_ok("https://example.com/Setup.dmg"));
        assert!(!url_ok("https://example.com/install.sh"));
        assert!(url_ok("https://example.com/report.pdf"));
        assert!(!url_ok(&format!("https://example.com/{}", "a".repeat(2_000))));
        assert!(!url_ok("https://exa mple.com"));
        assert!(!url_ok(""));
        // Review, 12 October 2026: the query and fragment are read, redirects refused, and the address must fit its line.
        assert!(url_ok("https://www.figma.com/files/recent?fuid=123#top"));
        assert!(url_ok("https://www.google.com/search?q=boredroom+app"));
        assert!(!url_ok("https://www.google.com/url?q=https://www.paypal.com/signin"), "a redirector");
        assert!(!url_ok("https://l.example.com/?u=https%3A%2F%2Fpaypal.com%2F"), "encoded");
        assert!(!url_ok("https://t.example.com/r?to=//evil.example/x"));
        assert!(!url_ok("https://example.com/next#https://paypal.com"));
        assert!(!url_ok("https://example.com/dl?file=setup.iso"), "a download that mounts");
        assert!(!url_ok("https://example.com/get?name=installer.pkg"));
        assert!(!url_ok("https://shop.example.com/cart?step=checkout"), "a payment hint in the query");
        assert!(!url_ok(&format!("https://example.com/?q={}", "a".repeat(170))), "too long to show whole");
        assert_eq!(url_shown("https://www.figma.com/").as_deref(), Some("figma.com"));
        assert_eq!(url_shown("https://www.figma.com/files/recent?fuid=1#x").as_deref(), Some("figma.com/files/recent?fuid=1#x"));
        assert_eq!(url_shown("http://example.com:8080/a?").as_deref(), Some("http://example.com:8080/a"));
        assert_eq!(url_shown("https://docs.google.com/forms/d/x/formResponse?entry.1=yes&submit=Submit").as_deref(), Some("docs.google.com/forms/d/x/formResponse?entry.1=yes&submit=Submit"));
    }

    #[test]
    fn mdls_dates_and_aliases() {
        assert_eq!(parse_md_date("1970-01-01 00:00:00 +0000"), Some(0));
        assert_eq!(parse_md_date("2026-10-05 07:54:23 +0000"), Some(1_791_186_863));
        assert_eq!(parse_md_date("2026-10-05 08:54:23 +0100"), Some(1_791_186_863));
        assert_eq!(parse_md_date("(null)"), None);
        assert_eq!(APP_ALIASES.len(), 17);
        assert!(APP_ALIASES.iter().all(|(a, _)| a.to_lowercase() == *a));
        assert_eq!(Why::Quarantined.key(), "quarantined");
        assert_eq!(Why::of_never(NeverOpen::OutsideApp), Why::Outside);
    }

    /// By hand only, read only (no open, no write): the real app folders, Spotlight, `plutil` and the quarantine flags on
    /// this Mac. Prints names and flags only. `true --lib -- --ignored system_open_reads --nocapture`.
    #[test]
    #[ignore]
    fn system_open_reads() {
        let home = crate::filework::home();
        let folders = guard::app_folders(home.as_deref());
        for name in ["Safari", "notes", "word", "Terminal", "No Such App"] {
            let r = super::resolve_app(name, &folders, &Spotlight, &RealProbe, &bundle_id_of, &[]);
            println!("{name}: {:?}", r.map(|a| (a.name, a.bundle_id, a.where_)));
        }
        for dir in ["/Applications"] {
            for app in apps_in(Path::new(dir)) {
                if let Some(q) = quarantine_of(&app) {
                    println!("{}: {} -> unapproved {}", stem(&app), q.split(';').next().unwrap_or(""), guard::quarantine_unapproved(Some(&q)));
                }
            }
        }
        println!("mdfind Safari: {}", Spotlight.find_apps("Safari", &[PathBuf::from("/Applications")]).len());
        // The default app for a few kinds of file, by Launch Services (opens nothing; temp files only).
        let d = crate::folder::tests::scratch("handlers");
        for n in ["a.pdf", "a.txt", "a.cer", "a.iso", "a.alfredworkflow", "a.zzzz"] {
            let p = crate::folder::tests::file(&d, n, 10, 0);
            let h = RealProbe.handler(&p);
            println!("{n}: {:?} -> refused {:?}", h.as_ref().map(|a| (a.bundle_id.clone(), a.names.clone())), h.as_ref().and_then(|a| guard::handler_refused(a, &[])));
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn recording_opener_records() {
        let mut o = RecordingOpener::default();
        assert!(o.open_url("https://example.com"));
        assert!(o.reveal(Path::new("/x/a.pdf")));
        assert_eq!(o.calls, vec!["url https://example.com", "reveal /x/a.pdf"]);
    }
}
