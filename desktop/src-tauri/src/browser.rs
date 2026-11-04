//! Brenda in Chrome (owner decisions, 4 November 2026: phase 2, "go with your recommendations": a private install first,
//! one Chrome profile, the Mac app must be running). The wire is `browser-extension/PROTOCOL.md`.
//!
//! - **The relay.** Chrome starts this app's own binary for native messaging with the extension's origin as its first
//!   argument (`main.rs` hands it to `relay_main` before anything of Tauri starts). The relay checks that origin is our
//!   extension's, connects to the running app's socket and copies frames both ways until either side closes. It reads
//!   nothing and keeps nothing.
//! - **The socket.** `~/Library/Application Support/cc.boredroom.brenda/browser.sock`, mode 0600 in a folder only this
//!   person can write, so only their own processes reach it; the relay's first frame names the origin again. One
//!   connection at a time: a new one replaces the old, whose waiting calls fail.
//! - **The hub.** Calls go out with an id and wait for exactly that reply, each with its own deadline; the extension's
//!   hello (its version, Chrome's, the profile's email) is what Settings and the router hear; `user_here` marks a tab the
//!   person is in.
//! - **The host manifest.** Written only when the person connects Chrome (`browser_connect`), naming only our extension.
//!
//! Nothing here logs page text, typed text or addresses. Pure parts (framing, the manifest, the hub over any stream) are
//! tested without Chrome.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// The native messaging host's name (the extension's `connectNative`).
pub const HOST_NAME: &str = "com.boredroom.browser";
/// Fixed by the `key` in the extension's manifest.
pub const EXTENSION_ID: &str = include_str!("../../../browser-extension/EXTENSION_ID");
/// The largest frame either side sends (PROTOCOL.md).
pub const MAX_FRAME: usize = 8 * 1024 * 1024;
const BUNDLE_ID: &str = "cc.boredroom.brenda";

/// `chrome-extension://<id>/`, as Chrome passes it to the relay.
pub fn origin() -> String {
    format!("chrome-extension://{}/", EXTENSION_ID.trim())
}

// ---- framing (u32 little-endian length + UTF-8 JSON) --------------------------------------------------------------------

/// One frame, or None at a clean end of the stream. A frame over `MAX_FRAME` is an error.
pub fn read_frame(r: &mut impl Read) -> std::io::Result<Option<Vec<u8>>> {
    let mut len = [0u8; 4];
    match r.read_exact(&mut len) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(e) => return Err(e),
    }
    let n = u32::from_le_bytes(len) as usize;
    if n > MAX_FRAME {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "frame too large"));
    }
    let mut buf = vec![0u8; n];
    r.read_exact(&mut buf)?;
    Ok(Some(buf))
}

pub fn write_frame(w: &mut impl Write, bytes: &[u8]) -> std::io::Result<()> {
    if bytes.len() > MAX_FRAME {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "frame too large"));
    }
    w.write_all(&(bytes.len() as u32).to_le_bytes())?;
    w.write_all(bytes)?;
    w.flush()
}

// ---- where things live -------------------------------------------------------------------------------------------------

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|h| h.is_absolute())
}

pub fn socket_path() -> Option<PathBuf> {
    // Development builds only: tests point the relay at their own socket, never a running Brenda's.
    if cfg!(debug_assertions) {
        if let Some(p) = std::env::var_os("BRENDA_BROWSER_SOCKET").map(PathBuf::from).filter(|p| p.is_absolute()) {
            return Some(p);
        }
    }
    home().map(|h| h.join("Library/Application Support").join(BUNDLE_ID).join("browser.sock"))
}

/// Google Chrome's per-user folder for native messaging hosts.
pub fn host_manifest_path() -> Option<PathBuf> {
    home().map(|h| h.join("Library/Application Support/Google/Chrome/NativeMessagingHosts").join(format!("{HOST_NAME}.json")))
}

/// The host manifest: this binary, stdio, our extension only.
pub fn host_manifest(exe: &Path) -> Value {
    json!({
        "name": HOST_NAME,
        "description": "Brenda for Mac: lets Brenda work in your Chrome when you ask.",
        "path": exe.to_string_lossy(),
        "type": "stdio",
        "allowed_origins": [origin()],
    })
}

/// Writes the host manifest for the running binary. Err: words for the person.
pub fn install_host() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|_| "I couldn't find Brenda's own app on this Mac.".to_string())?;
    let path = host_manifest_path().ok_or("I couldn't find your home folder.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|_| "I couldn't set Chrome up for Brenda.".to_string())?;
    }
    let body = serde_json::to_vec_pretty(&host_manifest(&exe)).unwrap_or_default();
    std::fs::write(&path, body).map_err(|_| "I couldn't set Chrome up for Brenda.".to_string())?;
    Ok(path)
}

/// Removes the host manifest (disconnecting Chrome). Best effort.
pub fn remove_host() {
    if let Some(p) = host_manifest_path() {
        let _ = std::fs::remove_file(p);
    }
}

// ---- the relay (Chrome's side of the socket) -----------------------------------------------------------------------------

/// Runs as Chrome's native messaging host: our extension only; frames copied both ways until either side ends. The
/// process exit code: 0 at a clean end, 2 for another origin, 3 when the app isn't running.
pub fn relay_main(origin_arg: &str) -> i32 {
    if origin_arg != origin() {
        return 2;
    }
    let Some(path) = socket_path() else { return 3 };
    let Ok(mut sock) = UnixStream::connect(&path) else {
        // The extension hears the port close and tries again later.
        return 3;
    };
    let hello = json!({ "v": 1, "relay": { "origin": origin_arg } });
    if write_frame(&mut sock, hello.to_string().as_bytes()).is_err() {
        return 3;
    }
    let Ok(mut back) = sock.try_clone() else { return 3 };
    std::thread::spawn(move || {
        let mut out = std::io::stdout().lock();
        while let Ok(Some(f)) = read_frame(&mut back) {
            if write_frame(&mut out, &f).is_err() {
                break;
            }
        }
        // The app went away: end the relay, so Chrome tells the extension.
        std::process::exit(0);
    });
    let mut input = std::io::stdin().lock();
    while let Ok(Some(f)) = read_frame(&mut input) {
        if write_frame(&mut sock, &f).is_err() {
            break;
        }
    }
    let _ = sock.shutdown(std::net::Shutdown::Both);
    0
}

// ---- the hub (the app's side) -----------------------------------------------------------------------------------------------

/// What the extension said about itself.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Hello {
    pub version: String,
    pub chrome: String,
    /// The Chrome profile's signed-in email, or "".
    pub profile: String,
}

/// A call's failure: the extension's code (PROTOCOL.md), or DISCONNECTED / TIMEOUT from here, and its words.
#[derive(Clone, Debug, PartialEq)]
pub struct CallError {
    pub code: String,
    pub message: String,
}

impl CallError {
    fn new(code: &str, message: &str) -> Self {
        CallError { code: code.into(), message: message.into() }
    }
}

#[derive(Default)]
struct Inner {
    writer: Mutex<Option<(u64, UnixStream)>>,
    pending: Mutex<HashMap<String, mpsc::Sender<Value>>>,
    hello: Mutex<Option<Hello>>,
    here: Mutex<HashSet<String>>,
    next: AtomicU64,
    generation: AtomicU64,
}

/// The connection to the extension. Cheap to clone.
#[derive(Clone, Default)]
pub struct Hub {
    inner: Arc<Inner>,
}

const CALL_LIMIT_MS: u64 = 35_000;

fn clip(v: Option<&Value>, max: usize) -> String {
    v.and_then(|s| s.as_str()).unwrap_or("").chars().filter(|c| !c.is_control()).take(max).collect()
}

impl Hub {
    /// The extension's hello while it is connected.
    pub fn hello(&self) -> Option<Hello> {
        self.inner.hello.lock().unwrap().clone()
    }

    pub fn connected(&self) -> bool {
        self.inner.writer.lock().unwrap().is_some() && self.hello().is_some()
    }

    /// Whether the person is in one of Brenda's tabs (the extension's `user_here`), cleared once read.
    pub fn take_here(&self, tab: &str) -> bool {
        self.inner.here.lock().unwrap().remove(tab)
    }

    /// Takes a new connection (after the relay's first frame was checked): replaces the old one and reads it on a thread.
    pub fn attach(&self, stream: UnixStream) {
        let generation = self.inner.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let Ok(reader) = stream.try_clone() else { return };
        if let Some((_, old)) = self.inner.writer.lock().unwrap().replace((generation, stream)) {
            let _ = old.shutdown(std::net::Shutdown::Both);
        }
        self.fail_pending();
        *self.inner.hello.lock().unwrap() = None;
        let hub = self.clone();
        std::thread::Builder::new()
            .name("brenda-browser-reader".into())
            .spawn(move || hub.read_loop(reader, generation))
            .ok();
    }

    fn fail_pending(&self) {
        // Dropping the senders wakes every waiting call with DISCONNECTED.
        self.inner.pending.lock().unwrap().clear();
    }

    fn read_loop(&self, mut reader: UnixStream, generation: u64) {
        while let Ok(Some(f)) = read_frame(&mut reader) {
            let Ok(v) = serde_json::from_slice::<Value>(&f) else { continue };
            self.take_message(v);
        }
        let mut w = self.inner.writer.lock().unwrap();
        if w.as_ref().is_some_and(|(g, _)| *g == generation) {
            *w = None;
            drop(w);
            *self.inner.hello.lock().unwrap() = None;
            self.inner.here.lock().unwrap().clear();
            self.fail_pending();
        }
    }

    /// One message from the extension: its hello, a reply to a waiting call, or an event.
    pub fn take_message(&self, v: Value) {
        if v.get("v").and_then(|x| x.as_u64()) != Some(1) {
            return;
        }
        if let Some(h) = v.get("hello") {
            *self.inner.hello.lock().unwrap() = Some(Hello { version: clip(h.get("version"), 20), chrome: clip(h.get("chrome"), 40), profile: clip(h.get("profile"), 320) });
            return;
        }
        if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
            if let Some(tx) = self.inner.pending.lock().unwrap().remove(id) {
                let _ = tx.send(v);
            }
            return;
        }
        match v.get("event").and_then(|e| e.as_str()) {
            Some("user_here") => {
                if let Some(t) = v.get("tab").and_then(|t| t.as_str()) {
                    self.inner.here.lock().unwrap().insert(t.chars().take(8).collect());
                }
            }
            Some("tab_closed") => {}
            _ => {}
        }
    }

    /// One call: sends it and waits for its reply (up to `ms`, at most 35 s). The reply's `out`, or its error.
    pub fn call(&self, op: &str, args: Value, ms: u64) -> Result<Value, CallError> {
        let id = (self.inner.next.fetch_add(1, Ordering::SeqCst) + 1).to_string();
        let (tx, rx) = mpsc::channel();
        self.inner.pending.lock().unwrap().insert(id.clone(), tx);
        let msg = json!({ "v": 1, "id": id, "op": op, "args": args }).to_string();
        let sent = {
            let mut w = self.inner.writer.lock().unwrap();
            match w.as_mut() {
                Some((_, s)) => write_frame(s, msg.as_bytes()).is_ok(),
                None => false,
            }
        };
        if !sent {
            self.inner.pending.lock().unwrap().remove(&id);
            return Err(CallError::new("DISCONNECTED", "Brenda isn't connected to Chrome."));
        }
        let reply = rx.recv_timeout(Duration::from_millis(ms.clamp(1_000, CALL_LIMIT_MS)));
        self.inner.pending.lock().unwrap().remove(&id);
        match reply {
            Ok(v) if v.get("ok").and_then(|o| o.as_bool()) == Some(true) => Ok(v.get("out").cloned().unwrap_or(Value::Null)),
            Ok(v) => Err(CallError { code: clip(v.get("error"), 30).to_uppercase(), message: clip(v.get("message"), 300) }),
            Err(mpsc::RecvTimeoutError::Timeout) => Err(CallError::new("TIMEOUT", "Chrome took too long.")),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(CallError::new("DISCONNECTED", "Chrome went away.")),
        }
    }
}

/// Checks a new socket connection's first frame: the relay's hello naming our extension.
pub fn relay_ok(first: &[u8]) -> bool {
    serde_json::from_slice::<Value>(first).ok().is_some_and(|v| {
        v.get("v").and_then(|x| x.as_u64()) == Some(1) && v.get("relay").and_then(|r| r.get("origin")).and_then(|o| o.as_str()) == Some(origin().as_str())
    })
}

/// Listens on the socket for the life of the app (a thread). Each connection must start with the relay's hello.
pub fn listen(hub: Hub) {
    let Some(path) = socket_path() else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::remove_file(&path);
    let Ok(listener) = UnixListener::bind(&path) else {
        eprintln!("[browser] SOCKET_FAILED");
        return;
    };
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    std::thread::Builder::new()
        .name("brenda-browser-socket".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut s = stream;
                let _ = s.set_read_timeout(Some(Duration::from_secs(5)));
                let ok = matches!(read_frame(&mut s), Ok(Some(f)) if relay_ok(&f));
                if !ok {
                    let _ = s.shutdown(std::net::Shutdown::Both);
                    continue;
                }
                let _ = s.set_read_timeout(None);
                hub.attach(s);
            }
        })
        .ok();
}

// ---- the notch's commands ----------------------------------------------------------------------------------------------------

/// What the notch shows about Chrome: connected (and as whom), and whether this Mac is set up for it.
#[tauri::command]
pub(crate) async fn browser_status(app: tauri::AppHandle) -> Value {
    use tauri::Manager;
    let hello = app.try_state::<Hub>().and_then(|h| h.hello());
    json!({
        "connected": hello.is_some(),
        "profile": hello.as_ref().map(|h| h.profile.clone()).unwrap_or_default(),
        "chrome": hello.as_ref().map(|h| h.chrome.clone()).unwrap_or_default(),
        "installed": host_manifest_path().is_some_and(|p| p.exists()),
        "extensionId": EXTENSION_ID.trim(),
    })
}

/// "Connect Chrome" (a real press only): writes the host manifest for this app, shows the extension's folder in Finder
/// and opens Chrome's extensions page, where the person turns on Developer mode and loads it (a private install first:
/// owner decisions, 4 November 2026). Nothing else is changed in Chrome.
#[tauri::command]
pub(crate) async fn browser_connect(app: tauri::AppHandle) -> Result<Value, crate::ApiError> {
    use tauri::Manager;
    if !crate::act::real_press(&app) {
        return Err(crate::ApiError { status: 0, message: "Press the button to connect Chrome.".into(), code: Some("ACT_NOT_A_PRESS".into()) });
    }
    install_host().map_err(|m| crate::ApiError { status: 0, message: m, code: Some("BROWSER_SETUP".into()) })?;
    if let Ok(dir) = app.path().resource_dir() {
        let ext = dir.join("browser-extension");
        if ext.join("manifest.json").exists() {
            let _ = std::process::Command::new("/usr/bin/open").arg("-R").arg(ext.join("manifest.json")).spawn();
        }
    }
    let _ = std::process::Command::new("/usr/bin/open").args(["-a", "Google Chrome", "chrome://extensions/"]).spawn();
    Ok(browser_status(app).await)
}

// ---- for the person's eyes ---------------------------------------------------------------------------------------------------

/// The page's host for a question ("dashboard.stripe.com"), or "".
pub fn host_of(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or("");
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit('@').next().unwrap_or("");
    host.split(':').next().unwrap_or("").chars().filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-').take(100).collect::<String>().to_lowercase()
}

/// Whether a page's host is on a never-look list: a rule whose name is a domain ("bank.example.com") covers that host and
/// every host under it. App rules never match a site.
pub fn never_site(host: &str, rules: &[crate::look::Rule]) -> bool {
    let host = host.trim().trim_end_matches('.').to_lowercase();
    if host.is_empty() {
        return false;
    }
    rules.iter().any(|r| {
        let d = r.name.trim().trim_end_matches('.').to_lowercase();
        let domain = d.contains('.') && !d.contains(' ') && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
        domain && (host == d || host.ends_with(&format!(".{d}")))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip_and_refuse_oversize() {
        let mut buf = Vec::new();
        write_frame(&mut buf, b"{\"v\":1}").unwrap();
        assert_eq!(&buf[..4], &7u32.to_le_bytes());
        let mut r = &buf[..];
        assert_eq!(read_frame(&mut r).unwrap().unwrap(), b"{\"v\":1}");
        assert_eq!(read_frame(&mut r).unwrap(), None);
        let big = ((MAX_FRAME + 1) as u32).to_le_bytes();
        assert!(read_frame(&mut &big[..]).is_err());
    }

    #[test]
    fn the_manifest_names_only_our_extension() {
        let m = host_manifest(Path::new("/Applications/Boredroom.app/Contents/MacOS/Boredroom"));
        assert_eq!(m["name"], HOST_NAME);
        assert_eq!(m["type"], "stdio");
        assert_eq!(m["allowed_origins"], json!([origin()]));
        assert_eq!(EXTENSION_ID.trim().len(), 32);
        assert!(EXTENSION_ID.trim().chars().all(|c| ('a'..='p').contains(&c)));
    }

    #[test]
    fn only_the_relay_for_our_extension_is_taken() {
        assert!(relay_ok(json!({ "v": 1, "relay": { "origin": origin() } }).to_string().as_bytes()));
        assert!(!relay_ok(json!({ "v": 1, "relay": { "origin": "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/" } }).to_string().as_bytes()));
        assert!(!relay_ok(b"not json"));
    }

    /// A fake extension on the other end of a socket pair: answers each call with `answer(op, args)`.
    fn fake_extension(answer: impl Fn(&str, &Value) -> Value + Send + 'static) -> (Hub, UnixStream) {
        let (app_end, mut ext) = UnixStream::pair().unwrap();
        let hub = Hub::default();
        hub.attach(app_end);
        let mut w = ext.try_clone().unwrap();
        write_frame(&mut w, json!({ "v": 1, "hello": { "version": "0.1.0", "chrome": "131", "profile": "ada@example.com" } }).to_string().as_bytes()).unwrap();
        std::thread::spawn(move || {
            while let Ok(Some(f)) = read_frame(&mut ext) {
                let v: Value = serde_json::from_slice(&f).unwrap();
                let mut reply = answer(v["op"].as_str().unwrap_or(""), &v["args"]);
                reply["v"] = json!(1);
                reply["id"] = v["id"].clone();
                write_frame(&mut w, reply.to_string().as_bytes()).unwrap();
            }
        });
        // The hello arrives on the reader thread.
        for _ in 0..100 {
            if hub.connected() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        (hub, UnixStream::pair().unwrap().0)
    }

    #[test]
    fn calls_get_their_own_reply_and_errors_their_code() {
        let (hub, _keep) = fake_extension(|op, args| match op {
            "status" => json!({ "ok": true, "out": { "tabs": 0 } }),
            "click" if args["ref"] == "e1" => json!({ "ok": true, "out": { "url": "https://example.com/", "navigated": false } }),
            _ => json!({ "ok": false, "error": "STALE_REF", "message": "Read the page again." }),
        });
        assert_eq!(hub.hello().unwrap().profile, "ada@example.com");
        assert_eq!(hub.call("status", json!({}), 2_000).unwrap(), json!({ "tabs": 0 }));
        assert_eq!(hub.call("click", json!({ "tab": "t1", "ref": "e1" }), 2_000).unwrap()["navigated"], false);
        assert_eq!(hub.call("click", json!({ "tab": "t1", "ref": "e9" }), 2_000).unwrap_err().code, "STALE_REF");
    }

    #[test]
    fn no_connection_or_a_silent_extension_fails_the_call() {
        assert_eq!(Hub::default().call("status", json!({}), 1_000).unwrap_err().code, "DISCONNECTED");
        let (app_end, _ext) = UnixStream::pair().unwrap();
        let hub = Hub::default();
        hub.attach(app_end);
        assert_eq!(hub.call("status", json!({}), 1_000).unwrap_err().code, "TIMEOUT");
    }

    #[test]
    fn events_mark_the_tab_the_person_is_in() {
        let hub = Hub::default();
        hub.take_message(json!({ "v": 1, "event": "user_here", "tab": "t2" }));
        assert!(hub.take_here("t2"));
        assert!(!hub.take_here("t2"));
    }

    #[test]
    fn never_look_sites_cover_their_subdomains_only() {
        let rules = vec![crate::look::Rule { name: "mybank.com".into(), bundle_id: None, source: crate::look::RuleSource::You }, crate::look::Rule { name: "Slack".into(), bundle_id: None, source: crate::look::RuleSource::Workspace }];
        assert!(never_site("mybank.com", &rules));
        assert!(never_site("login.MyBank.com", &rules));
        assert!(!never_site("notmybank.com", &rules));
        assert!(!never_site("slack.com", &rules));
    }

    #[test]
    fn hosts_for_questions() {
        assert_eq!(host_of("https://Dashboard.Stripe.com/invoices?x=1"), "dashboard.stripe.com");
        assert_eq!(host_of("https://user@evil.example:8443/x"), "evil.example");
        assert_eq!(host_of("nonsense"), "");
    }
}
