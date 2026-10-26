//! What the Boredroom window may show, and what happens to everything else (owner request, 24 October 2026).
//!
//! The window loads remote pages, so it has no Tauri IPC at all (no capability names it; see the tests in lib.rs). Its
//! only ways to reach Rust are navigations, which this module decides. Boredroom's own pages stay in the window
//! (https://www.boredroom.cc and the apex; in a development build also the configured server); every other web page
//! opens in the person's default browser; `mailto:` and `tel:` go to macOS; `boredroom://` is caught (webauth.rs);
//! anything else (file:, tauri:, javascript:, other schemes) is refused.
//!
//! wry asks for frames too, with the URL only (it can't tell a frame from the page). Boredroom's CSP has no
//! `frame-src`, so only same-origin frames can exist; that is why "open in the browser" is safe here and rate-limited
//! (3 per 5 seconds) anyway. Whoever ever adds a `frame-src` to next.config.ts must first add that origin's handling
//! here and make `permission` answer `Default` (owner rule R4, 24 October 2026).
//!
//! Everything here is pure and table-tested; the glue that acts on a decision lives in dashboard.rs.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Url;

/// The production hosts (the apex redirects to www).
pub const RELEASE_HOSTS: [&str; 2] = ["www.boredroom.cc", "boredroom.cc"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Origin {
    pub scheme: String,
    pub host: String,
    pub port: u16,
}

impl Origin {
    /// The origin of an http(s) URL with no user name or password; None for anything else.
    pub fn of(u: &Url) -> Option<Origin> {
        if !matches!(u.scheme(), "http" | "https") || !u.username().is_empty() || u.password().is_some() {
            return None;
        }
        let host = u.host_str()?.to_ascii_lowercase();
        Some(Origin { scheme: u.scheme().to_string(), host, port: u.port_or_known_default()? })
    }

    /// "https://www.boredroom.cc" (the port only when it isn't the scheme's default).
    pub fn as_url(&self) -> String {
        let default = if self.scheme == "https" { 443 } else { 80 };
        if self.port == default {
            format!("{}://{}", self.scheme, self.host)
        } else {
            format!("{}://{}:{}", self.scheme, self.host, self.port)
        }
    }
}

/// The window's origins: the two production ones, and in a development build the configured server's too.
pub fn allowed_origins(config_base: &str, debug: bool) -> Vec<Origin> {
    let mut v: Vec<Origin> = RELEASE_HOSTS.iter().map(|h| Origin { scheme: "https".into(), host: (*h).into(), port: 443 }).collect();
    if debug {
        if let Some(o) = Url::parse(config_base).ok().as_ref().and_then(Origin::of) {
            if !v.contains(&o) {
                v.push(o);
            }
        }
    }
    v
}

/// Whether a URL is on one of the window's origins.
pub fn is_allowed(u: &Url, origins: &[Origin]) -> bool {
    Origin::of(u).is_some_and(|o| origins.contains(&o))
}

/// Whether `path` is `prefix` or below it (a whole segment: `/download` but not `/downloads`).
pub fn under(path: &str, prefix: &str) -> bool {
    path == prefix || path.strip_prefix(prefix).is_some_and(|r| r.starts_with('/'))
}

/// The path as the server might route it, read generously (security review, 24 October 2026: SEC-3): percent-decoded
/// until it stops changing (at most 4 times), `\` read as `/`, empty and `.` segments dropped, `..` resolved, lower
/// case, no trailing slash. Every special-path check below compares this, never the raw path, so
/// `/desktop/%63ontinue` or `//Desktop/continue/` can't slip a browser-only page into the window. Reading too much
/// into a path only ever sends a page to the browser or refuses it.
pub fn route_path(u: &Url) -> String {
    let mut s = u.path().to_string();
    for _ in 0..4 {
        let d = crate::look::percent_decode(&s);
        if d == s {
            break;
        }
        s = d;
    }
    let mut parts: Vec<&str> = Vec::new();
    let lower = s.to_lowercase();
    for seg in lower.split(['/', '\\']) {
        match seg {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            x => parts.push(x),
        }
    }
    format!("/{}", parts.join("/"))
}

/// Pages that belong in the person's browser even though they are Boredroom's: linking with a code, the connector
/// bridge's Continue page and the download page. `path` is a `route_path`.
pub fn browser_only(path: &str) -> bool {
    ["/desktop/link", "/desktop/continue", "/download"].iter().any(|p| under(path, p))
}

pub const GOOGLE_START: &str = "/api/auth/google/start";
pub const BROWSER_SIGN_IN: &str = "/desktop/app/browser";
pub const APP_START: &str = "/desktop/app/start";

#[derive(Clone, Debug, PartialEq)]
pub enum Decision {
    Allow,
    /// `boredroom://…`: cancelled, handed to webauth as "in the window".
    Scheme(Url),
    /// Google's button or "Sign in with your browser": cancelled, a browser sign-in starts (`next` from the caught URL).
    BrowserSignIn { google: bool, next: Option<String> },
    /// Cancelled; opened in the default browser.
    Browser(Url),
    /// `http://` on a production host: cancelled; the window goes to the https address instead.
    Upgrade(Url),
    /// `mailto:` or `tel:`: cancelled; macOS picks the app.
    System(Url),
    /// Cancelled and logged.
    Refuse(&'static str),
}

/// The navigation policy (§4.2). `expected_start` is Rust's one-shot `/desktop/app/start` address.
pub fn decide(u: &Url, origins: &[Origin], expected_start: Option<&str>) -> Decision {
    match u.scheme() {
        "boredroom" => return Decision::Scheme(u.clone()),
        "about" => return if matches!(u.as_str(), "about:blank" | "about:srcdoc") { Decision::Allow } else { Decision::Refuse("about") },
        "blob" => {
            return match Url::parse(u.path()) {
                Ok(inner) if is_allowed(&inner, origins) => Decision::Allow,
                _ => Decision::Refuse("blob of another origin"),
            }
        }
        // WebKit itself refuses top-level data: navigations; frames and downloads need them.
        "data" => return Decision::Allow,
        "mailto" | "tel" => return Decision::System(u.clone()),
        "http" | "https" => {}
        _ => return Decision::Refuse("scheme"),
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Decision::Refuse("userinfo");
    }
    if is_allowed(u, origins) {
        let routed = route_path(u);
        let path = routed.as_str();
        if path == GOOGLE_START {
            return Decision::BrowserSignIn { google: true, next: query(u, "next") };
        }
        if path == BROWSER_SIGN_IN {
            return Decision::BrowserSignIn { google: false, next: query(u, "next") };
        }
        if path == APP_START {
            return if expected_start == Some(u.as_str()) { Decision::Allow } else { Decision::Refuse("unexpected start") };
        }
        if browser_only(path) {
            return Decision::Browser(u.clone());
        }
        return Decision::Allow;
    }
    // http on a production host: the same page over https, in the window.
    if u.scheme() == "http" && u.host_str().is_some_and(|h| RELEASE_HOSTS.contains(&h.to_ascii_lowercase().as_str())) && u.port_or_known_default() == Some(80) {
        let mut s = u.clone();
        if s.set_scheme("https").is_ok() {
            return Decision::Upgrade(s);
        }
    }
    Decision::Browser(u.clone())
}

#[derive(Clone, Debug, PartialEq)]
pub enum NewWindow {
    /// An app page: the window goes there (a `target="_blank"` link to the app stays in the app).
    InWindow(Url),
    Browser(Url),
    System(Url),
    Scheme(Url),
    Nothing,
}

/// What a `window.open` or `target="_blank"` asks for (§4.3). The new window itself is always refused.
pub fn new_window(u: &Url, origins: &[Origin]) -> NewWindow {
    match u.scheme() {
        "boredroom" => NewWindow::Scheme(u.clone()),
        "mailto" | "tel" => NewWindow::System(u.clone()),
        "http" | "https" if u.username().is_empty() && u.password().is_none() => {
            if is_allowed(u, origins) && under(&route_path(u), "/app") && under(u.path(), "/app") {
                NewWindow::InWindow(u.clone())
            } else {
                NewWindow::Browser(u.clone())
            }
        }
        _ => NewWindow::Nothing,
    }
}

/// A query parameter's value (the first).
pub fn query(u: &Url, key: &str) -> Option<String> {
    u.query_pairs().find(|(k, _)| k == key).map(|(_, v)| v.into_owned())
}

/// The window's permission answers (§4.5). Security review, 24 October 2026 (SEC-4): the microphone and camera are
/// never granted silently. They answer `Default`, so WebKit shows its own prompt naming the site (the app already holds
/// the macOS microphone permission for hold-to-talk, so without this any script on a page could record unasked; wry
/// doesn't say which frame asked). Everything else is refused.
pub fn permission(kind: tauri::webview::PermissionKind) -> tauri::webview::PermissionResponse {
    use tauri::webview::{PermissionKind as K, PermissionResponse as R};
    match kind {
        K::Microphone | K::Camera => R::Default,
        _ => R::Deny,
    }
}

/// At most `max` external opens per `window` (3 per 5 s by default): a page can't flood the browser.
pub struct RateLimit {
    max: usize,
    window: Duration,
    at: Mutex<VecDeque<Instant>>,
}

impl RateLimit {
    pub const fn new(max: usize, window: Duration) -> Self {
        RateLimit { max, window, at: Mutex::new(VecDeque::new()) }
    }

    pub fn allow(&self, now: Instant) -> bool {
        let mut q = self.at.lock().unwrap();
        while q.front().is_some_and(|t| now.duration_since(*t) >= self.window) {
            q.pop_front();
        }
        if q.len() >= self.max {
            return false;
        }
        q.push_back(now);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn o(debug: bool) -> Vec<Origin> {
        allowed_origins("http://localhost:3000", debug)
    }
    fn d(s: &str, debug: bool) -> Decision {
        decide(&Url::parse(s).unwrap(), &o(debug), None)
    }
    fn browser(s: &str) -> Decision {
        Decision::Browser(Url::parse(s).unwrap())
    }

    #[test]
    fn origins_are_the_production_pair_and_in_debug_the_configured_server() {
        assert_eq!(o(false).len(), 2);
        assert_eq!(o(true).len(), 3);
        assert_eq!(o(true)[2].as_url(), "http://localhost:3000");
        assert_eq!(allowed_origins("https://www.boredroom.cc", true).len(), 2, "no duplicate");
        assert_eq!(allowed_origins("not a url", true).len(), 2);
        assert_eq!(o(false)[0].as_url(), "https://www.boredroom.cc");
    }

    /// §12.1 item 1: at least 40 cases, in release and debug.
    #[test]
    fn the_navigation_table() {
        use Decision::*;
        let cases: Vec<(&str, bool, Decision)> = vec![
            ("https://www.boredroom.cc/app/acme/home", false, Allow),
            ("https://www.boredroom.cc/", false, Allow),
            ("https://boredroom.cc/app", false, Allow),
            ("https://WWW.BOREDROOM.CC/app", false, Allow),
            ("https://www.boredroom.cc:443/app", false, Allow),
            ("https://www.boredroom.cc/login?next=%2Fdesktop%2Fapp%2Ffinish", false, Allow),
            ("https://www.boredroom.cc/desktop/app?next=/app", false, Allow),
            ("https://www.boredroom.cc/desktop/app/finish", false, Allow),
            ("https://www.boredroom.cc/desktop/app/waiting?next=/app", false, Allow),
            ("https://www.boredroom.cc/api/files/abc", false, Allow),
            ("https://www.boredroom.cc/pricing", false, Allow),
            ("about:blank", false, Allow),
            ("about:srcdoc", false, Allow),
            ("about:config", false, Refuse("about")),
            ("blob:https://www.boredroom.cc/0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30", false, Allow),
            ("blob:https://evil.com/0b5ad1f6", false, Refuse("blob of another origin")),
            ("data:text/plain,hello", false, Allow),
            ("https://www.boredroom.cc:8443/", false, browser("https://www.boredroom.cc:8443/")),
            ("https://www.boredroom.cc@evil.com/", false, Refuse("userinfo")),
            ("https://user:pw@www.boredroom.cc/app", false, Refuse("userinfo")),
            ("https://www.boredroom.cc.evil.com/app", false, browser("https://www.boredroom.cc.evil.com/app")),
            ("https://www.boredroom.cc./app", false, browser("https://www.boredroom.cc./app")),
            ("https://evil.com/?u=https://www.boredroom.cc", false, browser("https://evil.com/?u=https://www.boredroom.cc")),
            ("https://example.com/page", false, browser("https://example.com/page")),
            ("https://accounts.google.com/o/oauth2/auth", false, browser("https://accounts.google.com/o/oauth2/auth")),
            ("http://www.boredroom.cc/app/x", false, Upgrade(Url::parse("https://www.boredroom.cc/app/x").unwrap())),
            ("http://boredroom.cc/", false, Upgrade(Url::parse("https://boredroom.cc/").unwrap())),
            ("http://localhost:3000/app", false, browser("http://localhost:3000/app")),
            ("http://localhost:3000/app", true, Allow),
            ("http://localhost:3000/desktop/link", true, browser("http://localhost:3000/desktop/link")),
            ("http://localhost:3001/app", true, browser("http://localhost:3001/app")),
            ("https://www.boredroom.cc/desktop/link?code=ABCD", false, browser("https://www.boredroom.cc/desktop/link?code=ABCD")),
            ("https://www.boredroom.cc/desktop/continue?t=x", false, browser("https://www.boredroom.cc/desktop/continue?t=x")),
            ("https://www.boredroom.cc/download", false, browser("https://www.boredroom.cc/download")),
            ("https://www.boredroom.cc/download#faq", false, browser("https://www.boredroom.cc/download#faq")),
            ("https://www.boredroom.cc/downloads", false, Allow),
            ("https://www.boredroom.cc/api/auth/google/start?next=/app/acme", false, BrowserSignIn { google: true, next: Some("/app/acme".into()) }),
            ("https://www.boredroom.cc/api/auth/google/start", false, BrowserSignIn { google: true, next: None }),
            ("https://www.boredroom.cc/desktop/app/browser?next=/app", false, BrowserSignIn { google: false, next: Some("/app".into()) }),
            ("https://www.boredroom.cc/desktop/app/start?t=abc", false, Refuse("unexpected start")),
            ("tauri://localhost/index.html", false, Refuse("scheme")),
            ("file:///etc/passwd", false, Refuse("scheme")),
            ("javascript:alert(1)", false, Refuse("scheme")),
            ("ipc://localhost/x", false, Refuse("scheme")),
            ("asset://localhost/x", false, Refuse("scheme")),
            ("ftp://example.com/", false, Refuse("scheme")),
            ("mailto:a@b.cc", false, System(Url::parse("mailto:a@b.cc").unwrap())),
            ("tel:+441234", false, System(Url::parse("tel:+441234").unwrap())),
        ];
        assert!(cases.len() >= 40);
        for (url, debug, want) in cases {
            assert_eq!(d(url, debug), want, "{url} (debug {debug})");
        }
        let s = Url::parse("boredroom://auth?code=x&state=y").unwrap();
        assert_eq!(d(s.as_str(), false), Scheme(s));
    }

    /// SEC-3 (security review, 24 October 2026): encoded, doubled, cased and dotted spellings of the special paths.
    #[test]
    fn special_paths_are_compared_as_routed() {
        use Decision::*;
        for s in [
            "https://www.boredroom.cc/desktop/%63ontinue?t=K",
            "https://www.boredroom.cc/desktop/%2563ontinue?t=K",
            "https://www.boredroom.cc/desktop%2Fcontinue?t=K",
            "https://www.boredroom.cc/Desktop/Continue?t=K",
            "https://www.boredroom.cc//desktop/continue?t=K",
            "https://www.boredroom.cc/desktop//continue/?t=K",
            "https://www.boredroom.cc/app/%2e%2e/desktop/continue?t=K",
            "https://www.boredroom.cc/app/%252e%252e/desktop/continue?t=K",
            "https://www.boredroom.cc/desktop/%6Cink?code=ABCD",
            "https://www.boredroom.cc/%64ownload",
        ] {
            assert_eq!(d(s, false), browser(s), "{s}");
        }
        assert_eq!(d("https://www.boredroom.cc/desktop/app/%73tart?t=abc", false), Refuse("unexpected start"));
        let start = "https://www.boredroom.cc/desktop/app/start?t=abc";
        let odd = Url::parse("https://www.boredroom.cc/desktop/app/%73tart?t=abc").unwrap();
        assert_eq!(decide(&odd, &o(false), Some(start)), Refuse("unexpected start"), "only Rust's exact address");
        assert_eq!(d("https://www.boredroom.cc/api/auth/google/%73tart?next=/app", false), BrowserSignIn { google: true, next: Some("/app".into()) });
        assert_eq!(d("https://www.boredroom.cc/desktop/app/%62rowser", false), BrowserSignIn { google: false, next: None });
        assert_eq!(d("https://www.boredroom.cc/app/acme/desktop/continue", false), Allow, "a whole route, not a suffix");
        let r = |s: &str| route_path(&Url::parse(s).unwrap());
        assert_eq!(r("https://www.boredroom.cc/"), "/");
        assert_eq!(r("https://www.boredroom.cc/A/%2E/b/../C/"), "/a/c");
        assert!(matches!(new_window(&Url::parse("https://www.boredroom.cc/app/%2e%2e/desktop/continue").unwrap(), &o(false)), NewWindow::Browser(_)));
    }

    #[test]
    fn the_start_page_only_when_rust_expects_it() {
        let start = "https://www.boredroom.cc/desktop/app/start?t=abc";
        let u = Url::parse(start).unwrap();
        assert_eq!(decide(&u, &o(false), Some(start)), Decision::Allow);
        assert_eq!(decide(&u, &o(false), Some("https://www.boredroom.cc/desktop/app/start?t=other")), Decision::Refuse("unexpected start"));
    }

    #[test]
    fn new_windows() {
        let nw = |s: &str| new_window(&Url::parse(s).unwrap(), &o(false));
        assert_eq!(nw("https://www.boredroom.cc/app/acme/tasks/1"), NewWindow::InWindow(Url::parse("https://www.boredroom.cc/app/acme/tasks/1").unwrap()));
        assert!(matches!(nw("https://www.boredroom.cc/desktop/continue?t=k"), NewWindow::Browser(_)));
        assert!(matches!(nw("https://www.boredroom.cc/pricing"), NewWindow::Browser(_)));
        assert!(matches!(nw("https://www.boredroom.cc/apps"), NewWindow::Browser(_)));
        assert!(matches!(nw("https://github.com/x"), NewWindow::Browser(_)));
        assert!(matches!(nw("mailto:a@b.cc"), NewWindow::System(_)));
        assert!(matches!(nw("boredroom://open?path=%2Fapp"), NewWindow::Scheme(_)));
        assert_eq!(nw("blob:https://www.boredroom.cc/x"), NewWindow::Nothing);
        assert_eq!(nw("data:text/html,x"), NewWindow::Nothing);
        assert_eq!(nw("file:///etc/passwd"), NewWindow::Nothing);
        assert!(matches!(nw("https://u@www.boredroom.cc/app"), NewWindow::Nothing));
    }

    #[test]
    fn permissions() {
        use tauri::webview::{PermissionKind as K, PermissionResponse as R};
        assert!(matches!(permission(K::Microphone), R::Default));
        assert!(matches!(permission(K::Camera), R::Default));
        assert!(matches!(permission(K::Geolocation), R::Deny));
        assert!(matches!(permission(K::Notifications), R::Deny));
    }

    #[test]
    fn external_opens_are_rate_limited() {
        let r = RateLimit::new(3, Duration::from_secs(5));
        let t = Instant::now();
        assert!(r.allow(t) && r.allow(t) && r.allow(t));
        assert!(!r.allow(t + Duration::from_secs(1)));
        assert!(r.allow(t + Duration::from_secs(5)));
    }
}
