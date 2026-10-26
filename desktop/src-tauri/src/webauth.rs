//! One sign-in for the Boredroom window and Brenda in the notch (owner request, 24 October 2026).
//!
//! The app is signed in when Rust holds a desktop session (the 90-day token in brenda.json, as the device code makes it).
//! The window's web session is always tied to it on the server and goes with it.
//!
//! - **Notch linked, window opens:** Rust asks Boredroom for a 60-second single-use handoff code with its token and hands
//!   it, by `eval`, to Boredroom's own `/desktop/app` page, which POSTs it to a strict same-origin route that sets the
//!   ordinary session cookie. No code or token is ever in a URL.
//! - **Signing in links the notch (PKCE, S256):** Rust starts an auth request with a challenge; the person signs in in
//!   the window (or, for Google and password managers, in their browser); `/desktop/app/finish` sends them to
//!   `boredroom://auth?code&state`, which Rust catches (in the window) or macOS delivers (from the browser). Rust redeems
//!   the code with its verifier and keeps the new desktop token.
//!
//! Rust never stores or logs the codes, verifier, state, start token or tickets: they live in memory only. Its calls go
//! straight to Boredroom with the shared HTTP client, never through the page's `api` command (which refuses
//! `/api/desktop/app/*`, look.rs). A server without these routes (an old website, or migration 0064 not applied) puts the
//! window in legacy mode for 10 minutes: a plain browser of boredroom.cc with its own sign-in, and the device code for
//! the notch.

use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewWindow};

use crate::policy::{self, Origin};

/// The page protocol the window understands (`window.__boredroomDesktop.protocol`).
const PROTOCOL: u64 = 1;
const PENDING_LIFE: Duration = Duration::from_secs(30 * 60);
const LEGACY_FOR: Duration = Duration::from_secs(10 * 60);
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

// ---- pure helpers -----------------------------------------------------------------------------------------------------

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// `n` bytes from the system's random source; None if it can't be read (then nothing is started).
fn random_bytes(n: usize) -> Option<Vec<u8>> {
    use std::io::Read;
    let mut b = vec![0u8; n];
    std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b)).ok()?;
    Some(b)
}

/// base64url(SHA-256(verifier)), RFC 7636 S256.
pub fn challenge_of(verifier: &str) -> String {
    b64(&Sha256::digest(verifier.as_bytes()))
}

/// A fresh verifier (32 random bytes, 43 characters) and its challenge.
pub fn pkce() -> Option<(String, String)> {
    let v = b64(&random_bytes(32)?);
    let c = challenge_of(&v);
    Some((v, c))
}

/// A fresh state (16 random bytes, 22 characters).
pub fn new_state() -> Option<String> {
    Some(b64(&random_bytes(16)?))
}

fn b64url(s: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&s.len()) && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

/// A code the server mints (`randomToken(32)`): exactly 43 base64url characters.
pub fn valid_code(s: &str) -> bool {
    b64url(s, 43, 43)
}

/// Equal without leaking where they differ.
fn ct_eq(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[derive(Debug, PartialEq, Eq)]
pub enum Scheme {
    Auth { code: String, state: String },
    Open { path: String },
}

/// `boredroom://auth?code=<43>&state=<22–64>` or `boredroom://open?path=<…>`, strictly; anything else is None.
pub fn parse_scheme(s: &str) -> Option<Scheme> {
    if s.len() > 2048 {
        return None;
    }
    let u = Url::parse(s).ok()?;
    if u.scheme() != "boredroom" || !u.username().is_empty() || u.password().is_some() || u.port().is_some() || u.fragment().is_some() {
        return None;
    }
    if !matches!(u.path(), "" | "/") {
        return None;
    }
    let pairs: Vec<(String, String)> = u.query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    let one = |k: &str| {
        let mut it = pairs.iter().filter(|(x, _)| x == k);
        let v = it.next()?.1.clone();
        it.next().is_none().then_some(v)
    };
    match u.host_str()? {
        "auth" => {
            let (code, state) = (one("code")?, one("state")?);
            (pairs.len() == 2 && valid_code(&code) && b64url(&state, 22, 64)).then_some(Scheme::Auth { code, state })
        }
        "open" => {
            let path = one("path")?;
            (pairs.len() == 1).then_some(Scheme::Open { path })
        }
        _ => None,
    }
}

/// A Boredroom app page from outside Rust (the notch's links, `boredroom://open`, the remembered path): a path, or a full
/// URL on the window's origins reduced to its path. It must be `/app`, `/app/…` or `/app?…`; `..` segments, `//`, `/\`,
/// control characters and anything over 300 characters are refused, also once decoded. Everything else (the sign-in
/// routes, the API, the public site) is refused.
pub fn safe_app_path(input: &str, origins: &[Origin]) -> Option<String> {
    let s = input.trim();
    let path = if s.starts_with("http://") || s.starts_with("https://") {
        let u = Url::parse(s).ok()?;
        if !policy::is_allowed(&u, origins) {
            return None;
        }
        let mut p = u.path().to_string();
        if let Some(q) = u.query() {
            p = format!("{p}?{q}");
        }
        if let Some(f) = u.fragment() {
            p = format!("{p}#{f}");
        }
        p
    } else {
        s.to_string()
    };
    if path.len() > 300 || path.chars().any(|c| c.is_control()) || path.contains('\\') {
        return None;
    }
    let route = path.split(['?', '#']).next().unwrap_or("");
    let mut decoded = route.to_string();
    for _ in 0..4 {
        let d = crate::look::percent_decode(&decoded);
        if d == decoded {
            break;
        }
        decoded = d;
    }
    if decoded.chars().any(|c| c.is_control()) || decoded.contains('\\') || decoded.contains("//") {
        return None;
    }
    if decoded.split('/').any(|seg| seg == ".." || seg == ".") {
        return None;
    }
    if !(policy::under(&decoded, "/app") && policy::under(route, "/app")) {
        return None;
    }
    Some(path)
}

/// Percent-encodes everything but the unreserved characters (a query value).
pub fn enc(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// The window's entry address for an app path: `<origin>/desktop/app?next=…` (`&u=` with the person's digest when known).
pub fn entry_url(base: &str, next: &str, digest: Option<&str>) -> String {
    let mut u = format!("{base}/desktop/app?next={}", enc(next));
    if let Some(d) = digest.filter(|d| !d.is_empty() && d.len() <= 64 && d.bytes().all(|c| c.is_ascii_alphanumeric())) {
        u.push_str(&format!("&u={d}"));
    }
    u
}

/// The JavaScript that hands the handoff code to Boredroom's page: constant text plus a validated code.
pub fn handoff_js(code: &str) -> Option<String> {
    valid_code(code).then(|| format!("window.__boredroomHandoff&&window.__boredroomHandoff({})", serde_json::to_string(code).unwrap_or_default()))
}

/// What the page says it is (`window.__boredroomDesktop`), from `eval_with_callback`'s JSON: "handoff", "ready" or None.
pub fn probe_page(raw: &str) -> Option<String> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let v = match v {
        Value::String(s) => serde_json::from_str(&s).ok()?,
        v => v,
    };
    if v.get("protocol")?.as_u64()? != PROTOCOL {
        return None;
    }
    v.get("page")?.as_str().map(String::from)
}

// ---- state --------------------------------------------------------------------------------------------------------

struct Pending {
    state: String,
    verifier: String,
    next: String,
    created: Instant,
}

impl Pending {
    fn fresh(&self) -> bool {
        self.created.elapsed() < PENDING_LIFE
    }
}

#[derive(Default)]
struct Inner {
    pending_window: Option<Pending>,
    pending_browser: Option<Pending>,
    legacy_until: Option<Instant>,
    handoff_failures: u8,
    expected_start: Option<String>,
    /// E6 runs at most once per window life.
    e6_done: bool,
    /// After a failed relink (E3), not again until the window is reopened.
    relink_failed: bool,
    /// A flow is talking to the server: page loads in the meantime don't start another.
    inflight: bool,
    last_app_path: Option<String>,
    schemes: VecDeque<Instant>,
}

#[derive(Default)]
pub struct WebAuth {
    inner: Mutex<Inner>,
}

fn wa(app: &AppHandle) -> Option<tauri::State<'_, WebAuth>> {
    app.try_state::<WebAuth>()
}

fn legacy(i: &Inner) -> bool {
    i.legacy_until.is_some_and(|t| Instant::now() < t)
}

fn set_legacy(app: &AppHandle, why: &str) {
    eprintln!("Boredroom: the window signs in on its own for a while ({why})");
    if let Some(w) = wa(app) {
        w.inner.lock().unwrap().legacy_until = Some(Instant::now() + LEGACY_FOR);
    }
}

/// A new window: E6 and the relink may run once again.
pub fn window_opened(app: &AppHandle) {
    if let Some(w) = wa(app) {
        let mut i = w.inner.lock().unwrap();
        i.e6_done = false;
        i.relink_failed = false;
        i.handoff_failures = 0;
        i.inflight = false;
    }
}

/// Rust's one-shot `/desktop/app/start` address, for the navigation policy (taken once it is used).
pub fn expected_start(app: &AppHandle) -> Option<String> {
    wa(app).and_then(|w| w.inner.lock().unwrap().expected_start.clone())
}

pub fn start_used(app: &AppHandle) {
    if let Some(w) = wa(app) {
        w.inner.lock().unwrap().expected_start = None;
    }
}

/// Forgets every pending request (signing out, another server).
pub fn forget(app: &AppHandle) {
    if let Some(w) = wa(app) {
        let mut i = w.inner.lock().unwrap();
        i.pending_window = None;
        i.pending_browser = None;
        i.expected_start = None;
        i.inflight = false;
        i.last_app_path = None;
    }
}

/// The last app page the window showed (the backstop goes back there).
pub fn last_app_path(app: &AppHandle) -> Option<String> {
    wa(app).and_then(|w| w.inner.lock().unwrap().last_app_path.clone())
}

// ---- server calls -----------------------------------------------------------------------------------------------------

struct Linked {
    base: String,
    token: Option<String>,
    digest: Option<String>,
}

fn linked(app: &AppHandle) -> Linked {
    let c = app.state::<crate::AppState>().config.lock().unwrap().clone();
    Linked { base: crate::base_url(&c), token: c.token.clone(), digest: c.user_digest.clone() }
}

async fn post(app: &AppHandle, path: &str, body: Value, bearer: Option<&str>, timeout: Duration) -> Result<(u16, Value), String> {
    let base = linked(app).base;
    let http = app.state::<crate::AppState>().http.clone();
    let mut req = http.post(format!("{base}{path}")).timeout(timeout).header("accept", "application/json").header("user-agent", crate::user_agent()).json(&body);
    if let Some(t) = bearer {
        req = req.bearer_auth(t);
    }
    let res = req.send().await.map_err(|e| format!("{path}: {}", e.without_url()))?;
    let status = res.status().as_u16();
    let value = res.json().await.unwrap_or(Value::Null);
    Ok((status, value))
}

/// Best effort (3 s): the server forgets a desktop session and every window session tied to it.
pub async fn sign_out_server(app: &AppHandle, token: String) {
    match post(app, "/api/desktop/app/sign-out", json!({}), Some(&token), Duration::from_secs(3)).await {
        Ok((s, _)) if s < 400 => {}
        Ok((s, _)) => eprintln!("Boredroom: sign-out on the server answered {s}"),
        Err(e) => eprintln!("Boredroom: sign-out on the server: {e}"),
    }
}

pub fn sign_out_on_server(app: &AppHandle, token: String) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move { sign_out_server(&app, token).await });
}

fn login_url(base: &str, next: &str) -> String {
    format!("{base}/login?next={}", enc(next))
}

fn waiting_url(base: &str, next: &str, error: bool) -> String {
    format!("{base}/desktop/app/waiting?next={}{}", enc(next), if error { "&error=link" } else { "" })
}

/// Starts an auth request (`via` "window" or "browser"); the start address, or the status the server answered.
async fn start_request(app: &AppHandle, via: &str, google: bool, next: &str) -> Result<String, Option<u16>> {
    let (verifier, challenge) = pkce().ok_or(None)?;
    let state = new_state().ok_or(None)?;
    let mut body = json!({ "challenge": challenge, "state": state, "via": via, "deviceName": crate::device_name() });
    if google {
        body["intent"] = json!("google");
    }
    // A linked app sends its Bearer too, so the finish page can name who the notch is signed in as now and ask before
    // replacing them (security review, 24 October 2026: SEC-3). The server ignores one it doesn't know.
    let bearer = linked(app).token;
    let (status, v) = post(app, "/api/desktop/app/auth/start", body, bearer.as_deref(), HTTP_TIMEOUT).await.map_err(|e| {
        eprintln!("Boredroom: sign-in start: {e}");
        None
    })?;
    if status != 200 {
        return Err(Some(status));
    }
    let start = v.get("startUrl").and_then(|s| s.as_str()).ok_or(Some(502))?.to_string();
    let origins = crate::dashboard::origins(app);
    let ok = Url::parse(&start).ok().is_some_and(|u| policy::is_allowed(&u, &origins) && u.path() == policy::APP_START);
    if !ok {
        return Err(Some(502));
    }
    let p = Pending { state, verifier, next: next.to_string(), created: Instant::now() };
    if let Some(w) = wa(app) {
        let mut i = w.inner.lock().unwrap();
        if via == "window" {
            i.pending_window = Some(p);
            i.expected_start = Some(start.clone());
        } else {
            i.pending_browser = Some(p);
        }
    }
    Ok(start)
}

/// A sign-in in the window (E2 unlinked, E3, E6, E7): to `/desktop/app/start`, which sends the person on.
async fn window_request(app: AppHandle, next: String) {
    let base = linked(&app).base;
    match start_request(&app, "window", false, &next).await {
        Ok(start) => crate::dashboard::navigate(&app, &start),
        Err(status) => {
            set_legacy(&app, &format!("start answered {status:?}"));
            crate::dashboard::navigate(&app, &login_url(&base, &next));
        }
    }
}

/// The handoff (E2 linked): a code for this page, delivered by `eval`.
async fn handoff(app: AppHandle, window: WebviewWindow, next: String) {
    let l = linked(&app);
    let Some(token) = l.token.clone() else { return window_request(app, next).await };
    match post(&app, "/api/desktop/app/handoff", json!({ "next": next }), Some(&token), HTTP_TIMEOUT).await {
        Ok((200, v)) => {
            if let Some(d) = v.get("userDigest").and_then(|d| d.as_str()) {
                remember_digest(&app, d);
            }
            let Some(js) = v.get("code").and_then(|c| c.as_str()).and_then(handoff_js) else { return };
            // Still Boredroom's handoff page? A race to another page just leaves the code to expire.
            let here = window.url().ok().is_some_and(|u| policy::is_allowed(&u, &crate::dashboard::origins(&app)) && u.path() == "/desktop/app");
            if here {
                let _ = window.eval(js);
            }
        }
        Ok((401, _)) => {
            eprintln!("Boredroom: this Mac's sign-in was ended on the server");
            crate::local_sign_out(&app);
            window_request(app, next).await;
        }
        Ok((s @ (404 | 503), _)) => {
            set_legacy(&app, &format!("handoff answered {s}"));
            crate::dashboard::navigate(&app, &login_url(&l.base, &next));
        }
        Ok((s, _)) => eprintln!("Boredroom: handoff answered {s}"),
        Err(e) => eprintln!("Boredroom: handoff: {e}"),
    }
}

fn remember_digest(app: &AppHandle, d: &str) {
    if d.is_empty() || d.len() > 64 || !d.bytes().all(|c| c.is_ascii_alphanumeric()) {
        return;
    }
    let changed = app.state::<crate::AppState>().config.lock().unwrap().user_digest.as_deref() != Some(d);
    if changed {
        crate::update_config(app, |c| c.user_digest = Some(d.to_string()));
    }
}

/// The digest of this Mac's person, asked of the server when an older link didn't keep it (a handoff code that is
/// simply left to expire).
async fn learn_digest(app: &AppHandle) -> Option<String> {
    let l = linked(app);
    if l.digest.is_some() {
        return l.digest;
    }
    let token = l.token?;
    match post(app, "/api/desktop/app/handoff", json!({ "next": "/app" }), Some(&token), HTTP_TIMEOUT).await {
        Ok((200, v)) => {
            let d = v.get("userDigest").and_then(|d| d.as_str())?.to_string();
            remember_digest(app, &d);
            Some(d)
        }
        _ => None,
    }
}

/// E4: a sign-in code came back. Redeemed only for a request this app made (constant-time state match).
async fn redeem(app: AppHandle, code: String, state: String) {
    let (pending, in_window) = {
        let Some(w) = wa(&app) else { return };
        let mut i = w.inner.lock().unwrap();
        let win = i.pending_window.as_ref().is_some_and(|p| p.fresh() && ct_eq(&p.state, &state));
        let brw = i.pending_browser.as_ref().is_some_and(|p| p.fresh() && ct_eq(&p.state, &state));
        if win {
            (i.pending_window.take(), true)
        } else if brw {
            (i.pending_browser.take(), false)
        } else {
            (None, false)
        }
    };
    let Some(p) = pending else {
        eprintln!("Boredroom: an unknown sign-in came back; ignored");
        return;
    };
    let base = linked(&app).base;
    let old = linked(&app).token;
    match post(&app, "/api/desktop/app/auth/token", json!({ "code": code, "verifier": p.verifier }), None, HTTP_TIMEOUT).await {
        Ok((200, v)) if v.get("status").and_then(|s| s.as_str()) == Some("approved") && v.get("token").and_then(|t| t.as_str()).is_some() => {
            let public = crate::store_link(&app, &v);
            // Signed in: any other request of ours is done with too.
            if let Some(w) = wa(&app) {
                let mut i = w.inner.lock().unwrap();
                i.pending_window = None;
                i.pending_browser = None;
                i.expected_start = None;
                i.handoff_failures = 0;
            }
            if let Some(old) = old.filter(|o| Some(o.as_str()) != v.get("token").and_then(|t| t.as_str())) {
                sign_out_on_server(&app, old);
            }
            let _ = app.emit_to("notch", "brenda://linked", json!({ "config": public }));
            if in_window {
                crate::dashboard::navigate(&app, &format!("{base}{}", p.next));
            } else {
                crate::dashboard::open(&app, Some(&p.next));
            }
        }
        other => {
            eprintln!("Boredroom: the sign-in code was refused ({})", other.map(|(s, _)| s.to_string()).unwrap_or_else(|e| e));
            if in_window {
                crate::dashboard::navigate(&app, &waiting_url(&base, &p.next, true));
            } else {
                crate::dashboard::open(&app, None);
                crate::dashboard::navigate(&app, &waiting_url(&base, &p.next, true));
            }
        }
    }
}

/// E5: Google's button or "Sign in with your browser": the same sign-in in the person's default browser, and the window
/// waits. `caught` is the URL the window was about to open (used as it was if the server can't start a request).
pub fn browser_sign_in(app: &AppHandle, google: bool, caught: Url, next: Option<String>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let origins = crate::dashboard::origins(&app);
        let pending_next = wa(&app).and_then(|w| w.inner.lock().unwrap().pending_window.as_ref().filter(|p| p.fresh()).map(|p| p.next.clone()));
        let next = pending_next.or_else(|| next.and_then(|n| safe_app_path(&n, &origins))).unwrap_or_else(|| "/app".into());
        let base = linked(&app).base;
        let legacy_now = wa(&app).is_some_and(|w| legacy(&w.inner.lock().unwrap()));
        let started = if legacy_now { Err(None) } else { start_request(&app, "browser", google, &next).await };
        match started {
            Ok(start) => {
                crate::dashboard::open_external(&app, &start);
                crate::dashboard::navigate(&app, &waiting_url(&base, &next, false));
            }
            Err(status) => {
                if status.is_some() {
                    set_legacy(&app, &format!("browser start answered {status:?}"));
                }
                // An old server: the browser signs in on its own (the notch offers the code).
                crate::dashboard::open_external(&app, caught.as_str());
            }
        }
    });
}

/// `boredroom://` from the window (a navigation it caught) or from macOS (`RunEvent::Opened`). At most 5 per 10 s.
pub fn scheme_action(app: &AppHandle, url: &Url) {
    if let Some(w) = wa(app) {
        let mut i = w.inner.lock().unwrap();
        let now = Instant::now();
        while i.schemes.front().is_some_and(|t| now.duration_since(*t) >= Duration::from_secs(10)) {
            i.schemes.pop_front();
        }
        if i.schemes.len() >= 5 {
            eprintln!("Boredroom: too many boredroom:// links; ignored");
            return;
        }
        i.schemes.push_back(now);
    }
    match parse_scheme(url.as_str()) {
        Some(Scheme::Auth { code, state }) => {
            let app = app.clone();
            tauri::async_runtime::spawn(redeem(app, code, state));
        }
        Some(Scheme::Open { path }) => match safe_app_path(&path, &crate::dashboard::origins(app)) {
            Some(p) => crate::dashboard::open(app, Some(&p)),
            None => eprintln!("Boredroom: boredroom://open with a path that isn't an app page; ignored"),
        },
        None => eprintln!("Boredroom: a boredroom:// link that isn't one of ours; ignored"),
    }
}

// ---- page loads (§6.4) -------------------------------------------------------------------------------------------------

/// The window finished (or started) loading a page: the backstop, then the state machine. Never re-enters the webview
/// from inside its own callback: everything it does runs on the async runtime.
pub fn on_page_load(app: &AppHandle, window: WebviewWindow, url: Url, finished: bool) {
    let origins = crate::dashboard::origins(app);
    if matches!(url.scheme(), "http" | "https") && !policy::is_allowed(&url, &origins) {
        // An open redirect that slipped through, or a future WebKit change: the browser gets it, the window goes back.
        eprintln!("Boredroom: the window reached another site; it opens in your browser instead");
        crate::dashboard::open_external(app, url.as_str());
        let back = last_app_path(app).unwrap_or_else(|| "/app".into());
        let l = linked(app);
        crate::dashboard::navigate(app, &entry_url(&l.base, &back, l.digest.as_deref()));
        return;
    }
    if !finished || !policy::is_allowed(&url, &origins) {
        return;
    }
    crate::dashboard::loaded(app);
    let path = url.path().to_string();
    let Some(w) = wa(app) else { return };
    let (is_legacy, inflight, pending_window) = {
        let i = w.inner.lock().unwrap();
        (legacy(&i), i.inflight, i.pending_window.as_ref().is_some_and(|p| p.fresh()))
    };
    let next_of = |u: &Url| policy::query(u, "next").and_then(|n| safe_app_path(&n, &origins)).unwrap_or_else(|| "/app".into());

    if policy::under(&path, "/app") {
        let mut p = path.clone();
        if let Some(q) = url.query() {
            p = format!("{p}?{q}");
        }
        let mut i = w.inner.lock().unwrap();
        if safe_app_path(&p, &origins).is_some() {
            i.last_app_path = Some(p.clone());
        }
        let l = linked(app);
        if l.token.is_some() {
            i.handoff_failures = 0;
        } else if !is_legacy && !i.e6_done && !inflight {
            // E6: an app page while unlinked means the window is signed in: offer to link the notch to it (the finish
            // page asks first unless the person has just signed in in this flow; SEC-3, 24 October 2026).
            i.e6_done = true;
            drop(i);
            spawn_flow(app, window_request(app.clone(), p));
        }
        return;
    }
    if path == "/desktop/app" || path == "/desktop/app/ready" {
        if inflight {
            return;
        }
        let next = next_of(&url);
        let retry = policy::query(&url, "retry").as_deref() == Some("1");
        let u = policy::query(&url, "u");
        let app2 = app.clone();
        let w2 = window.clone();
        let ready_page = path == "/desktop/app/ready";
        // Asked after this callback returns (never re-entering the webview from inside its own delegate).
        let probe_window = window.clone();
        tauri::async_runtime::spawn(async move {
            let probe = probe_window.eval_with_callback("JSON.stringify(window.__boredroomDesktop||null)", move |raw| {
                let page = probe_page(&raw);
                let app = app2.clone();
                let window = w2.clone();
                let next = next.clone();
                let u = u.clone();
                match (ready_page, page.as_deref()) {
                    (false, Some("handoff")) => page_handoff(&app, window, next, retry),
                    (true, Some("ready")) => page_ready(&app, next, u),
                    _ => {
                        // No probe: an old server, or a 404. The window signs in on its own for a while.
                        let base = linked(&app).base;
                        set_legacy(&app, "the page isn't Boredroom's sign-in page");
                        crate::dashboard::navigate(&app, &if ready_page { format!("{base}{next}") } else { login_url(&base, &next) });
                    }
                }
            });
            if probe.is_err() {
                eprintln!("Boredroom: couldn't ask the page what it is");
            }
        });
        return;
    }
    if path == "/login" && !pending_window && !is_legacy && !inflight {
        // E7: the sign-in page with no sign-in of ours waiting (the person may be signing in again).
        let next = next_of(&url);
        let l = linked(app);
        if l.token.is_some() {
            crate::dashboard::navigate(app, &entry_url(&l.base, &next, l.digest.as_deref()));
        } else {
            spawn_flow(app, window_request(app.clone(), next));
        }
    }
}

/// Runs a flow with `inflight` set, so the page loads it causes don't start another.
fn spawn_flow(app: &AppHandle, fut: impl std::future::Future<Output = ()> + Send + 'static) {
    if let Some(w) = wa(app) {
        w.inner.lock().unwrap().inflight = true;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        fut.await;
        if let Some(w) = wa(&app) {
            w.inner.lock().unwrap().inflight = false;
        }
    });
}

/// E2 at Boredroom's handoff page (no session in the window).
fn page_handoff(app: &AppHandle, window: WebviewWindow, next: String, retry: bool) {
    let Some(w) = wa(app) else { return };
    let l = linked(app);
    let is_legacy = legacy(&w.inner.lock().unwrap());
    if is_legacy {
        return crate::dashboard::navigate(app, &login_url(&l.base, &next));
    }
    if l.token.is_some() {
        let again = {
            let mut i = w.inner.lock().unwrap();
            if retry {
                i.handoff_failures = i.handoff_failures.saturating_add(1);
            }
            i.handoff_failures < 2
        };
        if again {
            spawn_flow(app, handoff(app.clone(), window, next));
        } else {
            // Two failed redemptions: the person signs in again; the old token goes once the new one arrives.
            spawn_flow(app, window_request(app.clone(), next));
        }
    } else {
        spawn_flow(app, window_request(app.clone(), next));
    }
}

/// E3: the window has a session; is it this Mac's person?
fn page_ready(app: &AppHandle, next: String, u: Option<String>) {
    let base = linked(app).base;
    let Some(w) = wa(app) else { return };
    let (is_legacy, relink_failed) = {
        let i = w.inner.lock().unwrap();
        (legacy(&i), i.relink_failed)
    };
    // Never relink for an impersonation session.
    if is_legacy || u.as_deref() == Some("imp") || relink_failed {
        return crate::dashboard::navigate(app, &format!("{base}{next}"));
    }
    let app2 = app.clone();
    spawn_flow(app, async move {
        let l = linked(&app2);
        if l.token.is_some() {
            let mine = learn_digest(&app2).await;
            if mine.is_some() && mine == u {
                return crate::dashboard::navigate(&app2, &format!("{base}{next}"));
            }
            // The window's person differs. Security review, 24 October 2026 (SEC-3): the finish page asks first ("Sign
            // {assistant} in your notch in as …? This signs … out"), unless the person has just signed in in this flow;
            // a session someone else put in the window never relinks the notch silently.
            if let Some(w) = wa(&app2) {
                w.inner.lock().unwrap().relink_failed = true; // one try per window life
            }
        }
        window_request(app2, next).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn origins() -> Vec<Origin> {
        policy::allowed_origins("https://www.boredroom.cc", false)
    }

    /// RFC 7636 appendix B.
    #[test]
    fn pkce_matches_the_rfc() {
        assert_eq!(challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let (v, c) = pkce().unwrap();
        assert_eq!(v.len(), 43);
        assert!(b64url(&v, 43, 43) && b64url(&c, 43, 43));
        assert_eq!(challenge_of(&v), c);
        let (v2, _) = pkce().unwrap();
        assert_ne!(v, v2);
        let s = new_state().unwrap();
        assert_eq!(s.len(), 22);
        assert!(b64url(&s, 22, 22));
        assert_ne!(s, new_state().unwrap());
    }

    #[test]
    fn scheme_links() {
        let code = "a".repeat(43);
        let state = "b".repeat(22);
        assert_eq!(parse_scheme(&format!("boredroom://auth?code={code}&state={state}")), Some(Scheme::Auth { code: code.clone(), state: state.clone() }));
        assert_eq!(parse_scheme("boredroom://open?path=%2Fapp%2Facme"), Some(Scheme::Open { path: "/app/acme".into() }));
        for bad in [
            format!("boredroom://auth?code={code}"),
            format!("boredroom://auth?state={state}"),
            format!("boredroom://auth?code={code}&state={state}&x=1"),
            format!("boredroom://auth?code={code}&code={code}&state={state}"),
            format!("boredroom://auth?code={}&state={state}", "a".repeat(42)),
            format!("boredroom://auth?code={code}&state={}", "b".repeat(21)),
            format!("boredroom://auth?code={code}&state={}", "b".repeat(65)),
            format!("boredroom://auth?code={}&state={state}", "a".repeat(42) + "!"),
            format!("boredroom://u@auth?code={code}&state={state}"),
            format!("boredroom://auth:99?code={code}&state={state}"),
            format!("boredroom://auth/x?code={code}&state={state}"),
            format!("boredroom://evil?code={code}&state={state}"),
            format!("https://auth?code={code}&state={state}"),
            "boredroom://open".into(),
            "boredroom://open?path=/app&x=1".into(),
            format!("boredroom://open?path=/app{}", "x".repeat(2100)),
            "not a url".into(),
        ] {
            assert_eq!(parse_scheme(&bad), None, "{bad}");
        }
    }

    #[test]
    fn app_paths() {
        let o = origins();
        for good in ["/app", "/app/x?y=1#z", "/app?tab=1", "/app/acme/calls/1?from=notch"] {
            assert_eq!(safe_app_path(good, &o).as_deref(), Some(good), "{good}");
        }
        assert_eq!(safe_app_path("https://www.boredroom.cc/app/acme?x=1", &o).as_deref(), Some("/app/acme?x=1"));
        for bad in [
            "//evil.com/app",
            "/\\evil",
            "/app/../desktop/app/start",
            "/app/%2e%2e/desktop/app",
            "/app/%252e%252e/x",
            "/app//x",
            "/app/%2F%2Fx",
            "/api/x",
            "/apps",
            "/desktop/app/start",
            "/desktop/app",
            "/desktop/link",
            "/pricing",
            "app",
            "https://evil.com/app",
            "https://www.boredroom.cc.evil.com/app",
            "/app/\u{7}",
            "/app/%0a",
        ] {
            assert_eq!(safe_app_path(bad, &o), None, "{bad}");
        }
        assert_eq!(safe_app_path(&format!("/app/{}", "x".repeat(300)), &o), None);
    }

    #[test]
    fn entry_urls() {
        assert_eq!(entry_url("https://www.boredroom.cc", "/app/acme", None), "https://www.boredroom.cc/desktop/app?next=%2Fapp%2Facme");
        assert_eq!(entry_url("https://www.boredroom.cc", "/app?x=1&y=2", Some("0123abcd0123abcd")), "https://www.boredroom.cc/desktop/app?next=%2Fapp%3Fx%3D1%26y%3D2&u=0123abcd0123abcd");
        assert!(!entry_url("https://www.boredroom.cc", "/app", Some("x&y")).contains("&u="));
    }

    #[test]
    fn the_handoff_script_is_constant_but_the_code() {
        let code = "A".repeat(43);
        assert_eq!(handoff_js(&code).unwrap(), format!("window.__boredroomHandoff&&window.__boredroomHandoff(\"{code}\")"));
        assert!(handoff_js("\");alert(1);//").is_none());
        assert!(handoff_js(&"A".repeat(44)).is_none());
    }

    #[test]
    fn probes() {
        assert_eq!(probe_page(r#""{\"protocol\":1,\"page\":\"handoff\"}""#).as_deref(), Some("handoff"));
        assert_eq!(probe_page(r#"{"protocol":1,"page":"ready"}"#).as_deref(), Some("ready"));
        assert_eq!(probe_page(r#""null""#), None);
        assert_eq!(probe_page("null"), None);
        assert_eq!(probe_page(r#""{\"protocol\":2,\"page\":\"handoff\"}""#), None);
        assert_eq!(probe_page(""), None);
    }

    #[test]
    fn constant_time_equal() {
        assert!(ct_eq("abc", "abc"));
        assert!(!ct_eq("abc", "abd"));
        assert!(!ct_eq("abc", "abcd"));
    }
}
