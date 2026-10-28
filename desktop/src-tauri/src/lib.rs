//! Boredroom for Mac (owner decision, option A, 24 October 2026): one app, Boredroom.app, with the dashboard in its own
//! window (`dashboard.rs`) and Brenda in the notch, signed in once for both (`webauth.rs`). The bundle identifier stays
//! `cc.boredroom.brenda`, so `brenda.json` and the Mac's permissions carry over. The window loads remote pages and has
//! no IPC at all (`policy.rs`, and the capability tests below); its menus, quitting and alerts are `appmenu.rs`, its
//! downloads `downloads.rs`.
//!
//! Brenda for Boredroom, the desktop notch (owner decision, 3 October 2026).
//!
//! The Rust side keeps the sign-in (Boredroom's address, the desktop session token and the workspace) in the app's
//! config folder, makes every HTTP call to Boredroom so the token never sits in the web view's storage, places the
//! window as a notch at the top centre of the screen, and puts Brenda in the tray. Everything the person sees is in
//! `src/` (plain HTML, CSS and JavaScript).
//!
//! The computer is acted on only when the person asks Brenda to and says yes to exactly what she will do (owner rule,
//! 12 October 2026). She opens Boredroom's app pages in Boredroom's window and other links in the browser; reads the files the person drops on the notch or asks
//! her to work on (`files.rs`, `filework.rs`); sees the screen under the pointer only while the person holds
//! Control+Command or presses Look (`look.rs`, `capture.rs`); and, only with "Do things when I ask" on and a yes for
//! the task (and another for each step that sends, deletes, pays or can't be undone), moves the pointer, clicks and
//! types (`act.rs`, `input.rs`), opens apps, files, folders and pages (`open.rs`), reads the folder the person names
//! (`folder.rs`), and runs a plan's steps in order under one yes (`plan.rs`; owner request, 12 October 2026). Nothing on
//! a timer, nothing from the server, nothing from what is on the screen. The microphone is used only while the person
//! holds the talk shortcut or the look keys, and only once they turn voice on (`voice.rs`). One setup card turns these
//! on, from the person's own press (`help.rs`). It reports nothing itself; the page tells Boredroom which abilities are
//! on, for the person alone.
//!
//! Brenda and her helpers (owner's approved brief, 12 October 2026: "one Brenda, three lanes"): she also does common
//! things on the Mac directly when the person asks (`front.rs`, `macos.rs`: opening apps, files, folders and pages,
//! windows, quitting, volume, screenshots, copying, typing into the box they're in, Wi-Fi, emptying the Trash), straight
//! away when they're routine and only after a yes when they delete, send, pay or touch security (`risk.rs`), and runs the
//! Files helper's fixed file actions with Undo (`fileops.rs`, `jobs.rs`) and the Mac operator as background jobs. It
//! records what the person asked and what she did with Boredroom, for the person alone.
//!
//! Her voice (owner decision, 7 October 2026: phase 2): `voice.rs` speaks her replies with a moving face; signing out,
//! from the page or the tray, and quitting cut her off. Brenda by the pointer (owner request, 12 October 2026):
//! `companion.rs`.
//!
//! The app's commands are allowed only to the notch window (an app manifest in `build.rs` and `capabilities/`): the
//! companion, ring and outline windows show model text and can call nothing, so no page that shows model text can
//! ever press Yes.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

mod act;
mod appindex;
mod appmenu;
mod ax;
mod capture;
mod chrome;
mod companion;
mod dashboard;
mod downloads;
mod files;
mod front;
mod fileops;
mod filework;
mod folder;
mod guard;
mod help;
mod input;
mod intent;
mod island;
mod jobs;
mod look;
mod macos;
mod open;
mod overlay;
mod plan;
mod policy;
mod risk;
mod updater;
mod voice;
mod webauth;
mod yes;

/// The canonical host (owner request, 24 October 2026): the apex redirects to www, and a redirected POST loses its body.
const DEFAULT_BASE_URL: &str = "https://www.boredroom.cc";

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    base_url: Option<String>,
    token: Option<String>,
    workspace_slug: Option<String>,
    workspace_name: Option<String>,
    display_name: Option<String>,
    /// Hold-to-talk. Off until the person turns it on; the microphone is never opened before.
    #[serde(default)]
    voice: bool,
    /// Brenda's little sounds (opening, a reminder arriving, done, listening). On unless switched off in the tray.
    #[serde(default)]
    muted: bool,
    /// Keep the notch showing even when nothing needs the person (by default it tucks away and peeks out on hover).
    #[serde(default)]
    always_visible: bool,
    /// Screen help (owner decisions, 11 October 2026): the person's own opt-in, kept on this Mac only and never sent to
    /// Boredroom; signing out clears it, since the consent was the signed-in person's.
    #[serde(default)]
    screen_help: bool,
    /// When it was turned on (unix ms), so "Turn off on my Macs" in Boredroom can switch off what was on before it.
    #[serde(default)]
    screen_help_at: Option<u64>,
    /// The system's Screen Recording prompt was shown once on this Mac (macOS shows it only once).
    #[serde(default)]
    screen_help_asked: bool,
    /// Which consent the person agreed to (0b.2, owner request 12 October 2026): 2 is today's (the whole screen, no
    /// preview); a phase 1 opt-in (below 2) sees the update card before its next look.
    #[serde(default)]
    screen_help_consent: u32,
    /// "Show me the picture first" (off by default).
    #[serde(default)]
    look_preview: bool,
    /// "Show Brenda by my pointer" (None = on).
    #[serde(default)]
    companion: Option<bool>,
    /// "Let Brenda use my Mac" (owner rule, 12 October 2026): the person's own opt-in; even then she asks before every
    /// task.
    #[serde(default)]
    use_mac: bool,
    #[serde(default)]
    use_mac_at: Option<u64>,
    /// "Let Brenda work on files".
    #[serde(default)]
    file_work: bool,
    #[serde(default)]
    file_work_at: Option<u64>,
    /// The system's Accessibility prompt was shown once on this Mac.
    #[serde(default)]
    accessibility_asked: bool,
    /// Finder's answer to "Brenda wants to control Finder": "granted" or "denied".
    #[serde(default)]
    finder_answer: Option<String>,
    /// What macOS said when setup asked for the Documents, Desktop and Downloads folders (companion2-spec I.3).
    #[serde(default)]
    folders: Option<FolderAnswers>,
    /// "Check with me before every task" as the page last passed it on (helpers-spec P.6, 0b.22; off by default).
    #[serde(default)]
    check_every: bool,
    /// "Let Brenda click and type for you", once per Mac (I.6): when it was allowed (unix ms).
    #[serde(default)]
    click_consent_at: Option<u64>,
    /// The folders the person added for the Files helper on this Mac (0b.23; absolute paths, at most 10).
    #[serde(default)]
    extra_folders: Vec<String>,
    /// Who this Mac is signed in as, as Boredroom's digest (one sign-in, owner request 24 October 2026): only to notice
    /// that the window's session belongs to someone else, and to keep the opt-ins only for the same person.
    #[serde(default)]
    user_digest: Option<String>,
    /// The Boredroom window has opened once on its own (the first launch).
    #[serde(default)]
    first_run_done: bool,
}

/// macOS's answer for each folder setup asked about: "granted" or "denied" (None: not asked).
#[derive(Default, Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FolderAnswers {
    #[serde(default)]
    pub documents: Option<String>,
    #[serde(default)]
    pub desktop: Option<String>,
    #[serde(default)]
    pub downloads: Option<String>,
}

/// What the web view may know: everything except the token itself.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicConfig {
    base_url: String,
    signed_in: bool,
    workspace_slug: Option<String>,
    workspace_name: Option<String>,
    display_name: Option<String>,
    sounds: bool,
    always_visible: bool,
    screen_help: bool,
}

struct AppState {
    config: Mutex<Config>,
    http: reqwest::Client,
}

#[derive(Serialize, Debug)]
struct ApiError {
    status: u16,
    message: String,
    /// Boredroom's error code when it sent one (`ALREADY_CONFIRMED` for a Confirm that already ran), so the page can
    /// tell such an answer from a failure.
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
}

impl ApiError {
    fn new(status: u16, message: impl Into<String>) -> Self {
        ApiError { status, message: message.into(), code: None }
    }
}

/// The installed app's settings. A dev build keeps its own (owner report, 24 October 2026): both share the bundle
/// identifier, so a dev notch's `http://localhost:3000` reached the installed app, whose window then refused to open.
const CONFIG_FILE: &str = "brenda.json";
const DEV_CONFIG_FILE: &str = "brenda-dev.json";

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join(if cfg!(debug_assertions) { DEV_CONFIG_FILE } else { CONFIG_FILE }))
}

fn read_config(path: &std::path::Path) -> Option<Config> {
    fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
}

fn write_private(path: &std::path::Path, json: &str) {
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(path, json);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
}

/// A local dev site (localhost, 127.0.0.1, [::1] or *.localhost): only a dev build talks to one.
fn is_dev_server(base: &str) -> bool {
    tauri::Url::parse(base).ok().and_then(|u| u.host_str().map(|h| h.trim_matches(['[', ']']).to_ascii_lowercase())).is_some_and(|h| {
        h == "localhost" || h.ends_with(".localhost") || h == "::1" || h.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback())
    })
}

fn load_config(app: &AppHandle) -> Config {
    let Ok(dir) = app.path().app_config_dir() else { return Config::default() };
    let (installed, dev) = (dir.join(CONFIG_FILE), dir.join(DEV_CONFIG_FILE));
    if cfg!(debug_assertions) {
        // The first dev run after the split starts from the shared file, so the dev sign-in carries over.
        return read_config(&dev).or_else(|| read_config(&installed)).unwrap_or_default();
    }
    let mut c = read_config(&installed).unwrap_or_default();
    if c.base_url.as_deref().is_some_and(is_dev_server) {
        // A dev build's sign-in: it moves to the dev file (when that has none yet), and the installed app starts
        // signed out on Boredroom. The token was the dev site's, so it is dropped here, never sent anywhere.
        if !dev.exists() {
            if let Ok(json) = serde_json::to_string_pretty(&c) {
                write_private(&dev, &json);
            }
        }
        c.base_url = None;
        clear_session(&mut c);
        save_config(app, &c);
    }
    c
}

fn save_config(app: &AppHandle, config: &Config) {
    if let (Some(path), Ok(json)) = (config_path(app), serde_json::to_string_pretty(config)) {
        write_private(&path, &json);
    }
}

/// Changes the config and saves it.
fn update_config(app: &AppHandle, f: impl FnOnce(&mut Config)) {
    let state = app.state::<AppState>();
    let mut c = state.config.lock().unwrap();
    f(&mut c);
    save_config(app, &c);
}

fn base_url(config: &Config) -> String {
    let u = config.base_url.clone().unwrap_or_else(|| DEFAULT_BASE_URL.to_string()).trim_end_matches('/').to_string();
    // A config saved with the apex (the old default) goes straight to www too.
    if u.eq_ignore_ascii_case("https://boredroom.cc") {
        DEFAULT_BASE_URL.to_string()
    } else {
        u
    }
}

fn public(config: &Config) -> PublicConfig {
    PublicConfig {
        base_url: base_url(config),
        signed_in: config.token.is_some(),
        workspace_slug: config.workspace_slug.clone(),
        workspace_name: config.workspace_name.clone(),
        display_name: config.display_name.clone(),
        sounds: !config.muted,
        always_visible: config.always_visible,
        screen_help: config.screen_help,
    }
}

/// Rust's own HTTP calls (the window has its own, Safari-like user agent: dashboard.rs).
fn user_agent() -> String {
    let os = if std::env::consts::OS == "macos" { "macOS" } else { std::env::consts::OS };
    format!("Boredroom for Mac/{} ({os})", env!("CARGO_PKG_VERSION"))
}

/// The screen opt-ins are the signed-in person's (and this Boredroom's): signing out or changing Boredroom clears them.
fn clear_opt_ins(c: &mut Config) {
    c.screen_help = false;
    c.screen_help_at = None;
    c.use_mac = false;
    c.use_mac_at = None;
    c.file_work = false;
    c.file_work_at = None;
}

/// Signing out (the page, the tray, another Boredroom): who, where and the token go, and so do the opt-ins.
fn clear_session(c: &mut Config) {
    c.token = None;
    c.workspace_slug = None;
    c.workspace_name = None;
    c.display_name = None;
    c.folders = None;
    // The click consent and the added folders were the signed-in person's (helpers-spec P.6).
    c.click_consent_at = None;
    c.extra_folders.clear();
    c.user_digest = None;
    clear_opt_ins(c);
}

/// A valid digest from Boredroom (hex or base64url, at most 64 characters).
fn digest_of(r: &Value) -> Option<String> {
    r.get("userDigest").and_then(|d| d.as_str()).filter(|d| !d.is_empty() && d.len() <= 64 && d.bytes().all(|c| c.is_ascii_alphanumeric())).map(String::from)
}

/// A link Boredroom approved (the device code or the one sign-in): who and where, and the token. The opt-ins and the
/// person's own setup are kept only for the same person (the same digest); they were someone else's consent otherwise.
fn apply_link(c: &mut Config, r: &Value) {
    let digest = digest_of(r);
    let same = match (&c.user_digest, &digest) {
        (Some(a), Some(b)) => a == b,
        (None, None) => true,
        _ => false,
    };
    if !same {
        c.folders = None;
        c.click_consent_at = None;
        c.extra_folders.clear();
        clear_opt_ins(c);
    }
    c.token = r.get("token").and_then(|t| t.as_str()).map(String::from);
    c.workspace_slug = r.pointer("/workspace/slug").and_then(|s| s.as_str()).map(String::from);
    c.workspace_name = r.pointer("/workspace/name").and_then(|s| s.as_str()).map(String::from);
    c.display_name = r.get("displayName").and_then(|s| s.as_str()).map(String::from);
    c.user_digest = digest;
}

/// Stores a link and answers what the notch may know.
fn store_link(app: &AppHandle, r: &Value) -> PublicConfig {
    let state = app.state::<AppState>();
    let mut c = state.config.lock().unwrap();
    apply_link(&mut c, r);
    save_config(app, &c);
    let p = public(&c);
    drop(c);
    companion::wake(app);
    p
}

/// Signs this Mac out here only (the server already ended the session): the notch hears `brenda://signed-out`.
fn local_sign_out(app: &AppHandle) {
    voice::stop_speaking(app);
    {
        let state = app.state::<AppState>();
        let mut c = state.config.lock().unwrap();
        clear_session(&mut c);
        save_config(app, &c);
    }
    dashboard::update(app, |f| f.last_path = None);
    forget_all(app, "signout");
    companion::wake(app);
    let _ = app.emit("brenda://signed-out", ());
    refresh_tray(app);
}

/// Signing out from the notch or the tray (one sign-in, owner request 24 October 2026): this Mac forgets who it was, the
/// server forgets the desktop session and the window's with it (best effort), and the window shows the sign-in.
fn sign_out_everywhere(app: &AppHandle) -> PublicConfig {
    voice::stop_speaking(app);
    let (old, p) = {
        let state = app.state::<AppState>();
        let mut c = state.config.lock().unwrap();
        let old = c.token.clone();
        clear_session(&mut c);
        save_config(app, &c);
        (old, public(&c))
    };
    forget_all(app, "signout");
    companion::wake(app);
    dashboard::forget_data(app);
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(t) = old {
            webauth::sign_out_server(&app2, t).await;
        }
        dashboard::show_sign_in(&app2);
    });
    p
}

/// Everything that stops and goes when the person signs out (or the app quits): a task, a job, the front desk's outbox.
fn forget_all(app: &AppHandle, why: &str) {
    act::forget(app, why);
    jobs::stop(app, why);
    front::forget(app);
    look::forget(app);
}

fn device_name() -> String {
    let os = match std::env::consts::OS {
        "macos" => "Mac",
        "windows" => "Windows PC",
        "linux" => "Linux computer",
        other => other,
    };
    format!("Boredroom on this {os}")
}

fn voice_on(app: &AppHandle) -> bool {
    app.state::<AppState>().config.lock().unwrap().voice
}

#[tauri::command]
fn voice_status(app: AppHandle) -> voice::VoiceStatus {
    voice::status(&app, voice_on(&app))
}

/// Turns hold-to-talk on or off. Turning it on fetches the speech model the first time (progress arrives as events).
#[tauri::command]
fn set_voice(app: AppHandle, enabled: bool) -> voice::VoiceStatus {
    {
        let state = app.state::<AppState>();
        let mut c = state.config.lock().unwrap();
        c.voice = enabled;
        save_config(&app, &c);
    }
    if enabled && !voice::model_ready(&app) {
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = voice::download_model(handle).await;
        });
    } else if enabled {
        voice::preload(&app);
    }
    refresh_voice_menu(&app);
    voice::status(&app, enabled)
}

#[tauri::command]
fn speak(app: AppHandle, text: String) {
    voice::speak(&app, &text);
}

/// A look's answer, sentence by sentence (B.10).
#[tauri::command]
fn speak_queue(app: AppHandle, text: String, first: bool) {
    voice::speak_queue(&app, &text, first);
}

#[tauri::command]
fn stop_speaking(app: AppHandle) {
    voice::stop_speaking(&app);
}

/// The person's assistant as the companion draws it (validated like the page's `assistantOf`).
#[tauri::command]
fn companion_set_look(app: AppHandle, look: companion::LookIn) {
    companion::set_look(&app, &look);
    refresh_tray(&app);
}

/// The page's natural voice is speaking: the companion pulses (B.10).
#[tauri::command]
fn companion_speaking(app: AppHandle, on: bool) {
    companion::speaking(&app, on, true);
}

struct VoiceMenu(MenuItem<tauri::Wry>);

fn refresh_voice_menu(app: &AppHandle) {
    if let Some(item) = app.try_state::<VoiceMenu>() {
        let _ = item.0.set_text(if voice_on(app) { format!("Turn voice off (hold {})", voice::SHORTCUT_LABEL) } else { "Turn voice on".to_string() });
    }
}

#[tauri::command]
fn get_config(state: State<AppState>) -> PublicConfig {
    public(&state.config.lock().unwrap())
}

/// Points the app at another Boredroom (a staging server, or localhost while developing).
#[tauri::command]
fn set_base_url(app: AppHandle, state: State<AppState>, url: String) -> PublicConfig {
    let mut c = state.config.lock().unwrap();
    let trimmed = url.trim().trim_end_matches('/').to_string();
    c.base_url = if trimmed.is_empty() { None } else { Some(trimmed) };
    c.token = None;
    c.user_digest = None;
    clear_opt_ins(&mut c);
    save_config(&app, &c);
    let p = public(&c);
    drop(c);
    forget_all(&app, "signout");
    companion::wake(&app);
    // The window was signed in to the other server (owner request, 24 October 2026).
    dashboard::forget_data(&app);
    dashboard::show_sign_in(&app);
    p
}

#[tauri::command]
fn sign_out(app: AppHandle) -> PublicConfig {
    sign_out_everywhere(&app)
}

async fn send(state: &State<'_, AppState>, method: &str, path: &str, body: Option<Value>, with_token: bool) -> Result<Value, ApiError> {
    let (base, token) = {
        let c = state.config.lock().unwrap();
        (base_url(&c), c.token.clone())
    };
    if !path.starts_with("/api/") {
        return Err(ApiError::new(400, "Only Boredroom API paths are allowed."));
    }
    // Pictures go only through Rust's own look; tasks only through Rust's own answer, step and stop calls (owner
    // decisions, 11 October 2026; owner rule, 12 October 2026).
    if !look::path_allowed(path) {
        return Err(ApiError::new(400, "Only Brenda's own look and task calls reach that route."));
    }
    let url = format!("{base}{path}");
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| ApiError::new(400, "Unknown method."))?;
    let mut req = state.http.request(m, &url).header("accept", "application/json").header("user-agent", user_agent());
    if with_token {
        if let Some(t) = token {
            req = req.bearer_auth(t);
        } else {
            return Err(ApiError::new(401, "Not signed in."));
        }
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    // A chat turn can take several model calls and, when the person chose to act without asking, act as it goes: the
    // client's 20 s limit used to give up while the server carried on, so the notch showed a failure (and no Undo) for
    // what was done, and asking again did it twice (review, 8 October 2026). Chat and Confirm wait as long as the server's
    // model calls can take; everything else keeps the short limit.
    if path.ends_with("/assistant/chat") || path.ends_with("/brenda/confirm") {
        req = req.timeout(std::time::Duration::from_secs(180));
    }
    let res = req.send().await.map_err(|e| ApiError::new(0, format!("Cannot reach Boredroom: {e}")))?;
    let status = res.status().as_u16();
    let value: Value = res.json().await.unwrap_or(Value::Null);
    if status >= 400 {
        let message = value.get("message").and_then(|m| m.as_str()).unwrap_or("Request failed.").to_string();
        let code = value.get("code").and_then(|c| c.as_str()).map(String::from);
        return Err(ApiError { status, message, code });
    }
    Ok(value)
}

/// Any Boredroom API call as the signed-in person (never the look or act routes).
#[tauri::command]
async fn api(app: AppHandle, state: State<'_, AppState>, method: String, path: String, body: Option<Value>) -> Result<Value, ApiError> {
    let body = with_mac_recent(&method, &path, body, front::recent_now(&app));
    let v = send(&state, &method, &path, body, true).await?;
    // The Dock's badge (the Mac app shell, owner request 26 October 2026): the unread count the notch's state already
    // carries, read on its way past. Nothing new is fetched.
    if let Some(n) = v.get("notificationsUnread").and_then(|n| n.as_i64()) {
        dashboard::set_badge(&app, n);
    }
    Ok(v)
}

/// The notch's chat carries what Brenda did on this Mac lately (`macRecent`; owner report, 28 October 2026), from Rust's
/// own record only: whatever the page put there is replaced, or taken out when there is nothing.
fn with_mac_recent(method: &str, path: &str, body: Option<Value>, recent: Vec<Value>) -> Option<Value> {
    if !method.eq_ignore_ascii_case("POST") || !path.ends_with("/assistant/chat") {
        return body;
    }
    let mut body = body?;
    if let Some(o) = body.as_object_mut() {
        o.remove("macRecent");
        if !recent.is_empty() {
            o.insert("macRecent".into(), Value::Array(recent));
        }
    }
    Some(body)
}

/// Step one of linking: a fresh code to show.
#[tauri::command]
async fn link_start(state: State<'_, AppState>) -> Result<Value, ApiError> {
    send(&state, "POST", "/api/desktop/link", Some(serde_json::json!({ "deviceName": device_name() })), false).await
}

/// Step three: once approved in Boredroom, keep the token here and hand back only who and where.
#[tauri::command]
async fn link_poll(app: AppHandle, state: State<'_, AppState>, device_code: String) -> Result<Value, ApiError> {
    let r = send(&state, "POST", "/api/desktop/link/poll", Some(serde_json::json!({ "deviceCode": device_code })), false).await?;
    if r.get("status").and_then(|s| s.as_str()) == Some("approved") {
        let config = store_link(&app, &r);
        return Ok(serde_json::json!({ "status": "approved", "config": config }));
    }
    Ok(r)
}

/// Where the notch's links go (pure, tested).
#[derive(Debug, PartialEq)]
enum Route {
    /// An app page: Boredroom's window.
    Window(String),
    /// The device-code page and the public site: the default browser.
    Browser(String),
    Refused,
}

fn route(base: &str, path: &str) -> Route {
    let url = if path.starts_with("http://") || path.starts_with("https://") { path.to_string() } else if path.starts_with('/') && !path.starts_with("//") { format!("{base}{path}") } else { return Route::Refused };
    let (Ok(u), Ok(b)) = (tauri::Url::parse(&url), tauri::Url::parse(base)) else { return Route::Refused };
    // 1. Anything off Boredroom's address is refused, as before.
    if policy::Origin::of(&u).is_none() || policy::Origin::of(&u) != policy::Origin::of(&b) {
        return Route::Refused;
    }
    // 2. The device code's page belongs in the browser.
    if policy::under(u.path(), "/desktop/link") {
        return Route::Browser(u.to_string());
    }
    // 3. The app's pages open in the window.
    let mut rel = u.path().to_string();
    if let Some(q) = u.query() {
        rel = format!("{rel}?{q}");
    }
    if let Some(f) = u.fragment() {
        rel = format!("{rel}#{f}");
    }
    if let Some(p) = webauth::safe_app_path(&rel, &[]) {
        return Route::Window(p);
    }
    // 4. The sign-in routes and the API never open from the notch.
    if policy::under(u.path(), "/desktop/app") || policy::under(u.path(), "/api") || u.path().starts_with("/app") {
        return Route::Refused;
    }
    // 5. Any other page on the site (the public pages): the browser, as before.
    Route::Browser(u.to_string())
}

/// Opens a Boredroom page: the app's pages in Boredroom's window, the device-link page and the public site in the browser
/// (owner request, 24 October 2026). Only Boredroom's own address; the sign-in routes and the API never.
#[tauri::command]
fn open_in_browser(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    let base = base_url(&state.config.lock().unwrap());
    match route(&base, &path) {
        Route::Window(p) if dashboard::can_open(&app) => {
            dashboard::open(&app, Some(&p));
            Ok(())
        }
        Route::Window(p) => app.opener().open_url(format!("{base}{p}"), None::<&str>).map_err(|e| e.to_string()),
        Route::Browser(u) => app.opener().open_url(u, None::<&str>).map_err(|e| e.to_string()),
        Route::Refused => {
            eprintln!("Boredroom: the notch asked to open a link that isn't one of Boredroom's pages; refused");
            Err("Only Boredroom links can be opened.".into())
        }
    }
}

/// The assistant's settings on this Mac (the tray's Help settings…, the app menu's "{Name} on this Mac…").
fn open_mac_settings(app: &AppHandle) {
    look::show_notch(app);
    let _ = app.emit("brenda://look-settings", ());
}

/// Gives the notch keyboard focus so the person can type to Brenda (the window does not take focus on its own). The
/// person's app is noted first, so the keyboard can be handed back to it (helpers-spec L.1 step 3).
#[tauri::command]
async fn focus_notch(window: WebviewWindow) -> Result<(), String> {
    let app = window.app_handle().clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        if let Some(f) = capture::person_front(&app) {
            capture::note_person_front(f.pid);
        }
    })
    .await;
    window.set_focus().map_err(|e| e.to_string())
}

struct SoundMenu(MenuItem<tauri::Wry>);
struct VisibleMenu(MenuItem<tauri::Wry>);
/// The tray's Hide/Show item, so a look that shows the notch again keeps its words right.
struct ToggleMenu(MenuItem<tauri::Wry>);

/// The tray's help submenu (companion2-spec A.2).
struct ScreenHelpMenu {
    menu: Submenu<tauri::Wry>,
    status: MenuItem<tauri::Wry>,
    setup: MenuItem<tauri::Wry>,
    look: CheckMenuItem<tauri::Wry>,
    mac: CheckMenuItem<tauri::Wry>,
    files: CheckMenuItem<tauri::Wry>,
    companion: CheckMenuItem<tauri::Wry>,
    companion_line: MenuItem<tauri::Wry>,
    preview: CheckMenuItem<tauri::Wry>,
    stop: MenuItem<tauri::Wry>,
    off: MenuItem<tauri::Wry>,
}

fn visible_label(always: bool, name: &str) -> String {
    if always { format!("Tuck {name} away when idle") } else { format!("Keep {name} always visible") }
}

fn toggle_label(visible: bool, name: &str) -> String {
    if visible { format!("Hide {name}") } else { format!("Show {name}") }
}

fn sounds_label(muted: bool) -> &'static str {
    if muted { "Turn sounds on" } else { "Turn sounds off" }
}

/// The submenu's words and states (A.2, M.3), pure.
#[derive(Debug, PartialEq)]
struct TrayItems {
    title: String,
    status: String,
    /// (label, enabled)
    setup: (String, bool),
    /// (label, checked, enabled)
    look: (String, bool, bool),
    mac: (String, bool, bool),
    files: (String, bool, bool),
    companion: (String, bool, bool),
    companion_line: String,
    preview: (String, bool, bool),
    stop: (String, bool),
    off_enabled: bool,
}

/// Owner report, 12 October 2026 ("when I turned this setting on, I stopped seeing my Brenda"): one plain state in the
/// title, one way to set it all up, the three abilities as switches (one that is off opens the setup; one that is on
/// turns off at once), and whether she is by the pointer and why not.
fn tray_items(s: &look::LookStatus, a: &act::ActStatus, c: &companion::CompanionStatus, name: &str) -> TrayItems {
    let job_live = s.front.as_ref().is_some_and(|f| f.get("jobLive").is_some_and(|j| !j.is_null()));
    let signed_in = c.why != "signed_out";
    let look_on = s.on && s.consent >= 2;
    let ready = signed_in && s.supported && s.available;
    let can_act = ready && a.available;
    let title = if !s.supported || (!s.available && !look_on) || !signed_in {
        format!("{name} can't help on this Mac yet")
    } else if look_on {
        format!("{name} can help on this Mac: On")
    } else {
        format!("{name} can help on this Mac: Off")
    };
    let on: Vec<&str> = [(look_on, "seeing"), (a.use_mac, "doing"), (a.file_work, "files")].iter().filter(|(on, _)| *on).map(|(_, w)| *w).collect();
    let status = if !signed_in {
        "Signed out".to_string()
    } else if !s.supported {
        "Needs macOS 14 or later".to_string()
    } else if !s.available && !look_on {
        "Not available in this workspace".to_string()
    } else if on.is_empty() {
        "Everything is off".to_string()
    } else {
        format!("On: {}", on.join(", "))
    };
    let item = |label: &str, checked: bool, can_turn_on: bool| (if checked { label.to_string() } else { format!("{label}…") }, checked, checked || can_turn_on);
    TrayItems {
        title,
        status,
        setup: (format!("Set up {name} on this Mac…"), ready),
        look: item("See my screen when I ask", look_on, ready),
        mac: item("Do things when I ask", a.use_mac, can_act),
        files: item("Work on my files", a.file_work, can_act),
        companion: (format!("Show {name} by my pointer"), s.companion, look_on),
        companion_line: help::companion_tray_words(c.why).to_string(),
        preview: ("Show me the picture first".to_string(), s.preview, look_on),
        stop: (format!("Stop {name}"), a.task.is_some() || job_live),
        off_enabled: s.on || a.use_mac || a.file_work,
    }
}

/// Puts the tray's words and checks right (after any change of screen help, the options, the abilities, a task or the
/// companion's reason).
fn refresh_tray(app: &AppHandle) {
    let name = companion::name(app);
    if let Some(item) = app.try_state::<ToggleMenu>() {
        let visible = app.get_webview_window("notch").and_then(|w| w.is_visible().ok()).unwrap_or(true);
        let _ = item.0.set_text(toggle_label(visible, &name));
    }
    if let Some(item) = app.try_state::<VisibleMenu>() {
        let always = app.state::<AppState>().config.lock().unwrap().always_visible;
        let _ = item.0.set_text(visible_label(always, &name));
    }
    appmenu::refresh(app);
    let Some(m) = app.try_state::<ScreenHelpMenu>() else { return };
    let t = tray_items(&look::status(app), &act::status(app), &companion::status(app), &name);
    let _ = m.menu.set_text(&t.title);
    let _ = m.status.set_text(&t.status);
    let _ = m.setup.set_text(&t.setup.0);
    let _ = m.setup.set_enabled(t.setup.1);
    for (item, (label, checked, enabled)) in [(&m.look, &t.look), (&m.mac, &t.mac), (&m.files, &t.files), (&m.companion, &t.companion), (&m.preview, &t.preview)] {
        let _ = item.set_text(label);
        let _ = item.set_checked(*checked);
        let _ = item.set_enabled(*enabled);
    }
    let _ = m.companion_line.set_text(&t.companion_line);
    let _ = m.stop.set_text(&t.stop.0);
    let _ = m.stop.set_enabled(t.stop.1);
    let _ = m.off.set_enabled(t.off_enabled);
}

/// The setup card in the notch, focused on one ability or none (A.1): it turns nothing on by itself.
fn open_setup(app: &AppHandle, focus: Option<&str>) {
    look::show_notch(app);
    let _ = app.emit("brenda://help-setup", serde_json::json!({ "focus": focus }));
}

/// Hold to talk: Option+Space on a Mac, Alt+Space elsewhere.
fn talk_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::Space)
}

fn tray_menu_event(app: &AppHandle, id: &str, toggle_item: &MenuItem<tauri::Wry>) {
    match id {
        // Open Boredroom: its window (owner request, 24 October 2026).
        "open" => {
            let c = app.state::<AppState>().config.lock().unwrap().clone();
            let path = match (c.token.as_ref(), c.workspace_slug.as_ref()) {
                (Some(_), Some(s)) => format!("/app/{}", webauth::enc(s)),
                _ => "/app".into(),
            };
            dashboard::open(app, Some(&path));
        }
        "toggle" => {
            if let Some(w) = app.get_webview_window("notch") {
                let visible = w.is_visible().unwrap_or(true);
                let _ = if visible { w.hide() } else { w.show() };
                let _ = toggle_item.set_text(toggle_label(!visible, &companion::name(app)));
            }
        }
        "voice" => {
            let on = !voice_on(app);
            let status = set_voice(app.clone(), on);
            let _ = app.emit("brenda://voice-status", status);
        }
        // Help on this Mac (A.2): the tray turns things off, never on; turning on opens the setup card in the notch.
        "help_setup" => open_setup(app, None),
        "help_off" => look::screen_help_off(app),
        "look" => {
            let s = look::status(app);
            if s.on {
                look::screen_help_off(app);
            } else if s.supported && s.available {
                open_setup(app, Some("look"));
            }
        }
        "look_companion" => {
            let on = !app.state::<AppState>().config.lock().unwrap().companion.unwrap_or(true);
            update_config(app, |c| c.companion = Some(on));
            companion::wake(app);
            let _ = app.emit("brenda://companion", serde_json::json!({ "on": on }));
        }
        "look_preview" => {
            update_config(app, |c| c.look_preview = !c.look_preview);
            let _ = app.emit("brenda://look-status", look::status(app));
        }
        "act_mac" | "act_files" => {
            let mac = id == "act_mac";
            let on = { let c = app.state::<AppState>().config.lock().unwrap().clone(); if mac { c.use_mac } else { c.file_work } };
            if on {
                if (mac && act::live(app)) || (!mac && act::busy_file(app)) {
                    act::stop(app, "tray");
                }
                // Review, 16 October 2026: a background job stops too.
                jobs::switched_off(app);
                update_config(app, |c| {
                    if mac {
                        c.use_mac = false;
                        c.use_mac_at = None;
                    } else {
                        c.file_work = false;
                        c.file_work_at = None;
                    }
                });
                let _ = app.emit("brenda://act", act::ActEvent::Status(act::status(app)));
            } else {
                open_setup(app, Some(if mac { "mac" } else { "files" }));
            }
        }
        "act_stop" => {
            act::stop(app, "tray");
            jobs::stop(app, "tray");
            front::stop_all(app);
        }
        "look_settings" => open_mac_settings(app),
        "sounds" => {
            let state = app.state::<AppState>();
            let mut c = state.config.lock().unwrap();
            c.muted = !c.muted;
            save_config(app, &c);
            if let Some(item) = app.try_state::<SoundMenu>() {
                let _ = item.0.set_text(sounds_label(c.muted));
            }
            let _ = app.emit("brenda://sounds", !c.muted);
        }
        "visible" => {
            let state = app.state::<AppState>();
            let mut c = state.config.lock().unwrap();
            c.always_visible = !c.always_visible;
            save_config(app, &c);
            if let Some(item) = app.try_state::<VisibleMenu>() {
                let _ = item.0.set_text(visible_label(c.always_visible, &companion::name(app)));
            }
            let _ = app.emit("brenda://always-visible", c.always_visible);
        }
        "signout" => {
            sign_out_everywhere(app);
            let _ = app.emit("brenda://signed-out", ());
        }
        // Updates (owner request, 24 October 2026): only ever from the person's click.
        "update_install" => updater::install(app),
        // Quit Boredroom: the notch quits too, so it asks first when that matters (appmenu.rs).
        "quit" => appmenu::quit(app),
        _ => {}
    }
    refresh_tray(app);
}

/// Whether Boredroom's window opens at launch (§5.5, pure): after an update's restart only if it was open; on the first
/// launch; when not signed in (the person needs to sign in); not at login; otherwise yes (a Dock app shows its window).
fn launch_opens_window(restart_open: Option<bool>, first_run_done: bool, linked: bool, login_item: bool) -> bool {
    if let Some(open) = restart_open {
        return open;
    }
    !first_run_done || !linked || !login_item
}

/// Best effort: whether macOS launched Boredroom as a login item (the `oapp` event's `keyAELaunchedAsLogInItem`). When it
/// can't be told, it isn't one.
fn launched_as_login_item() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::{class, msg_send, runtime::AnyObject};
        const OAPP: u32 = u32::from_be_bytes(*b"oapp");
        const LGIT: u32 = u32::from_be_bytes(*b"lgit");
        let mgr: *mut AnyObject = msg_send![class!(NSAppleEventManager), sharedAppleEventManager];
        if mgr.is_null() {
            return false;
        }
        let ev: *mut AnyObject = msg_send![&*mgr, currentAppleEvent];
        if ev.is_null() {
            eprintln!("Boredroom: launch: no Apple event to tell a login launch by");
            return false;
        }
        let id: u32 = msg_send![&*ev, eventID];
        let param: *mut AnyObject = msg_send![&*ev, paramDescriptorForKeyword: LGIT];
        let login = id == OAPP && !param.is_null();
        eprintln!("Boredroom: launch: {}", if login { "as a login item" } else { "by the person" });
        login
    }
    #[cfg(not(target_os = "macos"))]
    false
}

/// `boredroom://` links that arrived before setup finished (a cold start from a link).
static EARLY_LINKS: Mutex<Vec<tauri::Url>> = Mutex::new(Vec::new());

pub fn run() {
    tauri::Builder::default()
        // The opener plugin's link script is off for the whole app (owner request, 24 October 2026): it turned every
        // `target="_blank"` click into an IPC call, which the Boredroom window may not make, so links went dead. The
        // window's links are decided in policy.rs; the notch never had the opener's permission.
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    // Esc is registered only while a question waits or a screen task runs (`act::esc_wanted`).
                    if *shortcut == act::esc_shortcut() {
                        if event.state() == ShortcutState::Pressed {
                            act::esc(app);
                        }
                        return;
                    }
                    if *shortcut != talk_shortcut() {
                        return;
                    }
                    match event.state() {
                        ShortcutState::Pressed => voice::pressed(app, voice_on(app)),
                        ShortcutState::Released => voice::released(app),
                    }
                })
                .build(),
        )
        // Boredroom's Mac menus (owner request, 24 October 2026; appmenu.rs).
        .menu(appmenu::build)
        .on_menu_event(appmenu::on_event)
        .on_web_content_process_terminate(|webview| dashboard::on_web_content_terminated(webview.app_handle(), webview.label()))
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory); // no Dock icon until the Boredroom window opens: Brenda lives in the notch and the menu bar

            let handle = app.handle().clone();
            let config = load_config(&handle);
            app.manage(voice::Voice::default());
            app.manage(AppState {
                config: Mutex::new(config),
                http: reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().expect("http client"),
            });

            app.manage(island::Island::default());
            app.manage(files::Dropped::default());
            app.manage(look::Look::default());
            app.manage(act::Act::default());
            app.manage(front::Front::default());
            app.manage(jobs::Jobs::default());
            app.manage(appindex::AppIndex::default());
            app.manage(webauth::WebAuth::default());
            dashboard::manage(&handle);
            dashboard::no_tabbing();
            // The notch window is made here, after Brenda became a menu-bar app, not from the config at launch (owner
            // report, 17 October 2026: inside a full-screen app the notch never showed). macOS lets a window into other
            // apps' full-screen Spaces only if it was made while its app was already a menu-bar app; one made a moment
            // earlier stays on the ordinary desktops whatever its behaviour (tested on macOS 26 with a 2-point window).
            // The framework's set_activation_policy above only takes effect a moment later, so it is applied at once too.
            island::menu_bar_app_now();
            let notch = app.get_webview_window("notch").or_else(|| {
                let c = app.config().app.windows.iter().find(|w| w.label == "notch")?.clone();
                tauri::WebviewWindowBuilder::from_config(app.handle(), &c).and_then(|b| b.build()).map_err(|e| eprintln!("Brenda: the notch window could not be made ({e})")).ok()
            });
            if let Some(window) = notch {
                let _ = window.set_always_on_top(true);
                let _ = island::place(&window);
                island::start(&handle, window);
            }

            if let Err(e) = app.global_shortcut().register(talk_shortcut()) {
                eprintln!("Brenda: the talk shortcut is taken by another app ({e})");
            }
            // The look keys are not a registered shortcut: Control+Command alone is found by reading the modifier state
            // (`look.rs`), only while screen help is on and the workspace last said it is available.
            look::start(&handle);
            // Brenda by the pointer: her thread parks until screen help and the setting are on.
            companion::start(&handle);
            // The front desk (helpers-spec B.2, E.3, K.1): the app index, the record's outbox, the speech model loaded.
            appindex::start(&handle);
            front::start(&handle);
            if voice_on(&handle) {
                voice::preload(&handle);
            }

            let open = MenuItem::with_id(app, "open", "Open Boredroom", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", toggle_label(true, &companion::name(&handle)), true, None::<&str>)?;
            app.manage(ToggleMenu(toggle.clone()));
            let voice_item = MenuItem::with_id(app, "voice", "Turn voice on", true, None::<&str>)?;
            app.manage(VoiceMenu(voice_item.clone()));
            refresh_voice_menu(&handle);
            let status = MenuItem::with_id(app, "look_status", "Signed out", false, None::<&str>)?;
            let setup = MenuItem::with_id(app, "help_setup", "Set up Brenda on this Mac…", false, None::<&str>)?;
            let look_item = CheckMenuItem::with_id(app, "look", "See my screen when I ask…", false, false, None::<&str>)?;
            let mac = CheckMenuItem::with_id(app, "act_mac", "Do things when I ask…", false, false, None::<&str>)?;
            let files = CheckMenuItem::with_id(app, "act_files", "Work on my files…", false, false, None::<&str>)?;
            let companion_item = CheckMenuItem::with_id(app, "look_companion", "Show Brenda by my pointer", false, true, None::<&str>)?;
            let companion_line = MenuItem::with_id(app, "companion_status", "Hidden: signed out", false, None::<&str>)?;
            let preview = CheckMenuItem::with_id(app, "look_preview", "Show me the picture first", false, false, None::<&str>)?;
            let stop = MenuItem::with_id(app, "act_stop", "Stop Brenda", false, None::<&str>)?;
            let off = MenuItem::with_id(app, "help_off", "Turn off help on this Mac", false, None::<&str>)?;
            let settings = MenuItem::with_id(app, "look_settings", "Help settings…", true, None::<&str>)?;
            let s1 = PredefinedMenuItem::separator(app)?;
            let s2 = PredefinedMenuItem::separator(app)?;
            let s3 = PredefinedMenuItem::separator(app)?;
            let screen_help = Submenu::with_items(
                app,
                "Brenda can't help on this Mac yet",
                true,
                &[&status, &setup, &s1, &look_item, &mac, &files, &s2, &companion_item, &companion_line, &preview, &s3, &stop, &off, &settings],
            )?;
            app.manage(ScreenHelpMenu { menu: screen_help.clone(), status, setup, look: look_item, mac, files, companion: companion_item, companion_line, preview, stop, off });
            refresh_tray(&handle);
            let muted = app.state::<AppState>().config.lock().unwrap().muted;
            let sound_item = MenuItem::with_id(app, "sounds", sounds_label(muted), true, None::<&str>)?;
            app.manage(SoundMenu(sound_item.clone()));
            let always = app.state::<AppState>().config.lock().unwrap().always_visible;
            let visible_item = MenuItem::with_id(app, "visible", visible_label(always, &companion::name(&handle)), true, None::<&str>)?;
            app.manage(VisibleMenu(visible_item.clone()));
            let signout = MenuItem::with_id(app, "signout", "Sign out of Boredroom", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Boredroom", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &toggle, &voice_item, &screen_help, &sound_item, &visible_item, &sep, &signout, &quit])?;
            // "Restart to update" joins the top of the menu only once an update is downloaded (updater.rs).
            app.manage(updater::UpdateMenu {
                menu: menu.clone(),
                item: MenuItem::with_id(app, "update_install", "Restart to update", true, None::<&str>)?,
                sep: PredefinedMenuItem::separator(app)?,
                shown: std::sync::atomic::AtomicBool::new(false),
            });
            app.manage(updater::Updates::default());
            let toggle_item = toggle.clone();
            TrayIconBuilder::with_id("brenda")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Boredroom")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| tray_menu_event(app, event.id().as_ref(), &toggle_item))
                .build(app)?;
            updater::start(&handle);

            // When the Boredroom window opens at launch (§5.5), after the notch is made.
            let restart = dashboard::read(&handle).restart.map(|r| r.open);
            if restart.is_some() {
                dashboard::update(&handle, |f| f.restart = None);
            }
            let (first_done, linked) = {
                let c = handle.state::<AppState>().config.lock().unwrap().clone();
                (c.first_run_done, c.token.is_some())
            };
            if !first_done {
                update_config(&handle, |c| c.first_run_done = true);
            }
            let login = restart.is_none() && first_done && linked && launched_as_login_item();
            if launch_opens_window(restart, first_done, linked, login) {
                dashboard::open(&handle, None);
            }
            for u in std::mem::take(&mut *EARLY_LINKS.lock().unwrap()) {
                webauth::scheme_action(&handle, &u);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Files dropped on the notch only: the Boredroom window's page takes its own drops (attachments).
            if let tauri::WindowEvent::DragDrop(drag) = event {
                if window.label() == "notch" {
                    files::on_drag(window.app_handle(), drag, window.scale_factor().unwrap_or(1.0));
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            voice_status,
            set_voice,
            speak,
            speak_queue,
            stop_speaking,
            set_base_url,
            sign_out,
            api,
            link_start,
            link_poll,
            open_in_browser,
            focus_notch,
            island::set_island_rect,
            island::menu_bar_height,
            island::debug_log,
            files::upload_dropped,
            look::look_status,
            look::set_screen_help,
            look::look_set_options,
            look::look_request_permission,
            look::look_open_privacy_settings,
            look::look_now,
            look::look_send,
            look::look_follow_up,
            look::look_drop_held,
            look::look_discard,
            look::set_call_state,
            look::set_look_rules,
            companion_set_look,
            companion_speaking,
            act::act_status,
            act::act_set_use_mac,
            act::act_set_file_work,
            act::act_request_accessibility,
            act::act_open_accessibility_settings,
            act::act_answer,
            act::act_stop,
            act::act_continue,
            act::act_expect_answer,
            act::act_file_from_drop,
            act::act_reveal,
            act::act_open_output,
            help::help_setup,
            help::help_request_finder,
            help::help_request_folders,
            help::help_open_privacy,
            front::front_send,
            front::front_answer,
            front::front_choose,
            front::front_more,
            front::front_undo,
            front::front_stop,
            front::speak_now,
            front::click_consent,
            front::files_add_folder,
            front::files_remove_folder,
            jobs::job_stop,
            jobs::job_answer,
            jobs::job_continue,
            jobs::job_undo,
            jobs::job_open_output,
            jobs::job_reveal_output,
            jobs::job_show_folder,
            jobs::job_list,
            updater::update_status,
            updater::update_install
        ])
        .build(tauri::generate_context!())
        .expect("error while running Boredroom")
        .run(|app, event| match event {
            // However the app ends (Cmd+Q, logging out, the tray's Quit), her voice ends with it: a spawned `afplay` or
            // `say` is not killed with its parent and would finish the reply on its own (review, 7 October 2026). A task
            // stops too, before anything else is posted.
            tauri::RunEvent::Exit => {
                act::stop(app, "quit");
                jobs::stop(app, "quit");
                voice::stop_speaking(app);
            }
            // The Dock icon, Finder, Launchpad or Spotlight while running: the window (owner request, 24 October 2026).
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => dashboard::open(app, None),
            // `boredroom://` from the browser (the one sign-in's hand-back, "Back to Boredroom"); files dropped on the
            // Dock icon are ignored.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                for u in urls.into_iter().filter(|u| u.scheme() == "boredroom") {
                    if app.try_state::<webauth::WebAuth>().is_some() {
                        webauth::scheme_action(app, &u);
                    } else {
                        EARLY_LINKS.lock().unwrap().push(u);
                    }
                }
            }
            _ => {}
        });
}

/// Every command in `generate_handler!`, which the app manifest (`build.rs`) and the notch's capability list too.
#[cfg(test)]
const COMMANDS: &[&str] = &[
    "get_config",
    "voice_status",
    "set_voice",
    "speak",
    "speak_queue",
    "stop_speaking",
    "set_base_url",
    "sign_out",
    "api",
    "link_start",
    "link_poll",
    "open_in_browser",
    "focus_notch",
    "set_island_rect",
    "menu_bar_height",
    "debug_log",
    "upload_dropped",
    "look_status",
    "set_screen_help",
    "look_set_options",
    "look_request_permission",
    "look_open_privacy_settings",
    "look_now",
    "look_send",
    "look_follow_up",
    "look_drop_held",
    "look_discard",
    "set_call_state",
    "set_look_rules",
    "companion_set_look",
    "companion_speaking",
    "act_status",
    "act_set_use_mac",
    "act_set_file_work",
    "act_request_accessibility",
    "act_open_accessibility_settings",
    "act_answer",
    "act_stop",
    "act_continue",
    "act_expect_answer",
    "act_file_from_drop",
    "act_reveal",
    "act_open_output",
    "help_setup",
    "help_request_finder",
    "help_request_folders",
    "help_open_privacy",
    "front_send",
    "front_answer",
    "front_choose",
    "front_more",
    "front_undo",
    "front_stop",
    "speak_now",
    "click_consent",
    "files_add_folder",
    "files_remove_folder",
    "job_stop",
    "job_answer",
    "job_continue",
    "job_undo",
    "job_open_output",
    "job_reveal_output",
    "job_show_folder",
    "job_list",
    "update_status",
    "update_install",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn status(on: bool, available: bool) -> look::LookStatus {
        look::LookStatus {
            v: 3,
            supported: true,
            unsupported_reason: None,
            permission: "granted",
            on,
            on_at: None,
            keys: look::LOOK_KEYS.name,
            keys_label: look::LOOK_KEYS.symbols,
            armed: on,
            available,
            consent: if on { 3 } else { 0 },
            preview: false,
            companion: true,
            companion_shown: on,
            companion_why: if on { "idle" } else { "screen_help_off" },
            front: None,
        }
    }

    fn act_status(available: bool, use_mac: bool) -> act::ActStatus {
        act::ActStatus {
            supported: true,
            available,
            use_mac,
            use_mac_at: None,
            file_work: false,
            file_work_at: None,
            accessibility: "unknown",
            finder: "unknown".into(),
            esc_registered: false,
            task: None,
            folders: act::Folders::of(None),
            plans: 1,
        }
    }

    fn comp(why: &'static str) -> companion::CompanionStatus {
        companion::CompanionStatus { on: true, shown: companion::shown_for(why), why }
    }

    /// Companion2-spec A.2 and M.3, for every state.
    #[test]
    fn tray_items() {
        // On, with a name.
        let t = super::tray_items(&status(true, true), &act_status(true, false), &comp("idle"), "Max");
        assert_eq!(t.title, "Max can help on this Mac: On");
        assert_eq!(t.status, "On: seeing");
        assert_eq!(t.setup, ("Set up Max on this Mac…".into(), true));
        assert_eq!(t.look, ("See my screen when I ask".into(), true, true), "on: choosing it turns it off");
        assert_eq!(t.mac, ("Do things when I ask…".into(), false, true), "off: choosing it opens the setup");
        assert_eq!(t.files, ("Work on my files…".into(), false, true));
        assert_eq!(t.companion, ("Show Max by my pointer".into(), true, true));
        assert_eq!(t.companion_line, "By your pointer");
        assert_eq!(t.preview, ("Show me the picture first".into(), false, true));
        assert_eq!(t.stop, ("Stop Max".into(), false));
        assert!(t.off_enabled);
        // Everything on.
        let mut a = act_status(true, true);
        a.file_work = true;
        let t = super::tray_items(&status(true, true), &a, &comp("typing"), "Brenda");
        assert_eq!(t.status, "On: seeing, doing, files");
        assert_eq!(t.mac, ("Do things when I ask".into(), true, true));
        assert_eq!(t.companion_line, "By your pointer", "typing hides her only for a moment");
        // Off.
        let t = super::tray_items(&status(false, true), &act_status(true, false), &comp("screen_help_off"), "Brenda");
        assert_eq!(t.title, "Brenda can help on this Mac: Off");
        assert_eq!(t.status, "Everything is off");
        assert_eq!(t.look, ("See my screen when I ask…".into(), false, true));
        assert_eq!(t.companion_line, "Hidden: seeing your screen is off");
        assert!(!t.companion.2 && !t.preview.2, "nothing to set while seeing is off");
        assert!(!t.off_enabled);
        // Not available in the workspace; doing things not allowed there.
        let t = super::tray_items(&status(false, false), &act_status(false, false), &comp("screen_help_off"), "Brenda");
        assert_eq!(t.title, "Brenda can't help on this Mac yet");
        assert_eq!(t.status, "Not available in this workspace");
        assert!(!t.setup.1 && !t.look.2 && !t.mac.2);
        let t = super::tray_items(&status(true, true), &act_status(false, false), &comp("idle"), "Brenda");
        assert!(!t.mac.2 && !t.files.2, "the workspace has switched doing things off");
        // Unsupported; signed out.
        let mut s = status(false, true);
        s.supported = false;
        let t = super::tray_items(&s, &act_status(true, false), &comp("screen_help_off"), "Brenda");
        assert_eq!((t.title.as_str(), t.status.as_str()), ("Brenda can't help on this Mac yet", "Needs macOS 14 or later"));
        let t = super::tray_items(&status(false, true), &act_status(true, false), &comp("signed_out"), "Brenda");
        assert_eq!(t.status, "Signed out");
        assert!(!t.setup.1);
        // Turning off is always possible, even where it isn't available just now.
        let t = super::tray_items(&status(true, false), &act_status(false, true), &comp("idle"), "Brenda");
        assert_eq!(t.look, ("See my screen when I ask".into(), true, true));
        assert_eq!(t.mac, ("Do things when I ask".into(), true, true));
        assert!(t.off_enabled);
        // A task live; each companion reason.
        let mut a = act_status(true, true);
        a.task = Some(act::TaskBrief { id: "t".into(), kind: "plan".into(), phase: act::Phase::Running, plan: "I'll open Figma.".into(), step: 0, started_at: None });
        assert!(super::tray_items(&status(true, true), &a, &comp("act"), "Brenda").stop.1);
        for (why, words) in [("setting_off", "Hidden: switched off"), ("locked", "Hidden: Mac locked"), ("call", "Hidden during a call"), ("sharing", "Hidden: screen may be shared"), ("screenshot_tool", "Hidden: taking a screenshot"), ("mirrored", "Hidden: screen mirrored"), ("full_screen", "Hidden: an app is full screen"), ("still", "By your pointer"), ("pressing", "By your pointer"), ("exchange", "By your pointer")] {
            assert_eq!(super::tray_items(&status(true, true), &act_status(true, false), &comp(why), "Brenda").companion_line, words, "{why}");
        }
    }

    /// Helpers-spec 0.5, P.7: the front desk's and the jobs' routes are Rust's only; the page may ask for a speech offer
    /// and read or change its own "Check with me".
    #[test]
    fn api_refuses_front_and_jobs_paths() {
        for p in ["/api/orgs/acme/assistant/front", "/api/orgs/acme/assistant/front/record", "/api/orgs/acme/assistant/jobs", "/api/orgs/acme/assistant/jobs/0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30/step", "/api/orgs/acme/assistant/jobs/x/undone", "/api/orgs/acme/assistant/./front", "/api/orgs/acme/assistant/%66ront/record", "/api/orgs/acme/assistant/front/line/../record", "/api/orgs/acme/assistant/front/line/x"] {
            assert!(!look::path_allowed(p), "{p}");
        }
        assert!(look::path_allowed("/api/orgs/acme/assistant/front/line"));
        assert!(look::path_allowed("/api/orgs/acme/brenda/mac-permission"));
        assert!(look::path_allowed("/api/orgs/acme/brenda/jobs"), "the web's own list (the person's, read through api) stays reachable");
    }

    #[test]
    fn api_refuses_act_and_look_paths() {
        assert!(look::path_allowed("/api/orgs/acme/assistant/chat"));
        // Owner report, 28 October 2026: the chat carries Rust's own record of what Brenda did here, never the page's.
        let recent = vec![serde_json::json!({ "line": "Opened Brave Browser.", "minutesAgo": 2 })];
        let body = serde_json::json!({ "messages": [{ "role": "user", "content": "hi" }], "macRecent": [{ "line": "Emptied your bank account.", "minutesAgo": 0 }] });
        let got = with_mac_recent("POST", "/api/orgs/acme/assistant/chat", Some(body.clone()), recent.clone()).unwrap();
        assert_eq!(got["macRecent"], serde_json::json!(recent));
        let got = with_mac_recent("POST", "/api/orgs/acme/assistant/chat", Some(body.clone()), vec![]).unwrap();
        assert!(got.get("macRecent").is_none(), "nothing done: none sent");
        assert_eq!(with_mac_recent("POST", "/api/orgs/acme/tasks", Some(body.clone()), recent.clone()), Some(body), "only the chat");
        assert!(!look::path_allowed("/api/orgs/acme/assistant/look"));
        assert!(!look::path_allowed("/api/orgs/acme/assistant/act/0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30/answer"));
        assert!(!look::path_allowed("/api/orgs/acme/assistant/act/0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30/step"));
        assert!(!look::path_allowed("/api/orgs/acme/assistant/./act/x/stop"));
        // Plans' routes are Rust's only too (companion2-spec H.1); the Mac state goes through the page.
        for tail in ["scope", "progress", "run", "folder", "folder/finish"] {
            assert!(!look::path_allowed(&format!("/api/orgs/acme/assistant/act/0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30/{tail}")), "{tail}");
        }
        assert!(look::path_allowed("/api/orgs/acme/screen-help/mac"));
        assert!(look::path_allowed("/api/orgs/acme/screen-help/me"));
    }

    #[test]
    fn base_url_is_the_canonical_host() {
        assert_eq!(base_url(&Config::default()), "https://www.boredroom.cc");
        for old in ["https://boredroom.cc", "https://boredroom.cc/", "https://Boredroom.cc"] {
            let c = Config { base_url: Some(old.into()), ..Default::default() };
            assert_eq!(base_url(&c), "https://www.boredroom.cc", "{old}");
        }
        let c = Config { base_url: Some("http://localhost:3000/".into()), ..Default::default() };
        assert_eq!(base_url(&c), "http://localhost:3000");
    }

    #[test]
    fn dev_servers_are_told_apart() {
        for dev in ["http://localhost:3000", "http://LOCALHOST:3000/", "http://127.0.0.1:3000", "http://[::1]:3000", "http://app.localhost:3000", "http://127.0.0.2"] {
            assert!(is_dev_server(dev), "{dev}");
        }
        for live in ["https://www.boredroom.cc", "https://boredroom.cc", "https://localhost.example.com", "https://staging.boredroom.cc", "not a url"] {
            assert!(!is_dev_server(live), "{live}");
        }
    }

    #[test]
    fn signing_out_clears_every_opt_in() {
        let mut c = Config { token: Some("t".into()), screen_help: true, screen_help_consent: 2, use_mac: true, file_work: true, use_mac_at: Some(1), file_work_at: Some(1), ..Default::default() };
        clear_session(&mut c);
        assert!(c.token.is_none() && !c.screen_help && !c.use_mac && !c.file_work && c.use_mac_at.is_none() && c.file_work_at.is_none());
        let mut c = Config { token: Some("t".into()), folders: Some(FolderAnswers { documents: Some("granted".into()), ..Default::default() }), ..Default::default() };
        clear_session(&mut c);
        assert!(c.folders.is_none(), "macOS's answers were the signed-in person's setup");
        let mut c = Config { token: Some("t".into()), click_consent_at: Some(5), extra_folders: vec!["/Users/a/Projects".into()], check_every: true, ..Default::default() };
        clear_session(&mut c);
        assert!(c.click_consent_at.is_none() && c.extra_folders.is_empty(), "the click consent and added folders were the person's");
        // A phase 1 config (no new fields) still reads, as consent 1.
        let old: Config = serde_json::from_str(r#"{ "token": "t", "screenHelp": true, "screenHelpAt": 5 }"#).unwrap();
        assert_eq!(look::consent_of(old.screen_help, old.screen_help_consent), 1);
        assert!(!old.use_mac && old.companion.is_none() && !old.look_preview);
    }

    /// One sign-in (owner request, 24 October 2026): the window's sign-in and handoff routes are Rust's own; the device
    /// code's stay reachable for Rust's own link_start and link_poll.
    #[test]
    fn api_refuses_desktop_app_paths() {
        for p in ["/api/desktop/app/handoff", "/api/desktop/app/auth/token", "/api/desktop/app/handoff/redeem", "/api/Desktop/App/sign-out", "/api/desktop/./app/handoff", "/api/desktop/%61pp/handoff", "/api/desktop//app/auth/start"] {
            assert!(!look::path_allowed(p), "{p}");
        }
        assert!(look::path_allowed("/api/desktop/link"));
        assert!(look::path_allowed("/api/desktop/link/poll"));
        assert!(look::path_allowed("/api/desktop/apps"), "only the app routes");
    }

    /// §7.2: the notch's links.
    #[test]
    fn notch_links_open_in_the_window_or_the_browser() {
        let b = "https://www.boredroom.cc";
        assert_eq!(route(b, "/app/acme/calls/1?from=notch"), Route::Window("/app/acme/calls/1?from=notch".into()));
        assert_eq!(route(b, "https://www.boredroom.cc/app/acme/home?chat=x"), Route::Window("/app/acme/home?chat=x".into()));
        assert_eq!(route(b, "https://www.boredroom.cc/desktop/link?code=ABCD"), Route::Browser("https://www.boredroom.cc/desktop/link?code=ABCD".into()));
        assert_eq!(route(b, "/pricing"), Route::Browser("https://www.boredroom.cc/pricing".into()));
        for bad in ["/desktop/app/start?t=x", "/desktop/app", "/api/orgs/acme/x", "https://evil.com/app", "https://www.boredroom.cc.evil.com/app", "//evil.com/x", "/app/../desktop/app/start", "javascript:alert(1)", "app/x"] {
            assert_eq!(route(b, bad), Route::Refused, "{bad}");
        }
        assert_eq!(route("http://localhost:3000", "/app"), Route::Window("/app".into()));
        assert_eq!(route("http://localhost:3000", "https://www.boredroom.cc/app"), Route::Refused, "another server");
    }

    #[test]
    fn one_sign_in_config() {
        // An old brenda.json without the new fields still reads.
        let old: Config = serde_json::from_str(r#"{ "token": "t", "workspaceSlug": "acme", "screenHelp": true }"#).unwrap();
        assert!(old.user_digest.is_none() && !old.first_run_done);
        let mut c = Config { token: Some("t".into()), user_digest: Some("abc".into()), ..Default::default() };
        clear_session(&mut c);
        assert!(c.user_digest.is_none());
        // The same person keeps their opt-ins; someone else doesn't.
        let link = |d: &str| serde_json::json!({ "status": "approved", "token": "new", "workspace": { "slug": "acme", "name": "Acme" }, "displayName": "Ada", "userDigest": d });
        let mut c = Config { token: Some("old".into()), user_digest: Some("d1".into()), screen_help: true, use_mac: true, click_consent_at: Some(1), ..Default::default() };
        apply_link(&mut c, &link("d1"));
        assert!(c.screen_help && c.use_mac && c.click_consent_at.is_some());
        assert_eq!((c.token.as_deref(), c.workspace_slug.as_deref(), c.display_name.as_deref(), c.user_digest.as_deref()), (Some("new"), Some("acme"), Some("Ada"), Some("d1")));
        apply_link(&mut c, &link("d2"));
        assert!(!c.screen_help && !c.use_mac && c.click_consent_at.is_none(), "another person's consent goes");
        assert_eq!(c.user_digest.as_deref(), Some("d2"));
        // The device code (no digest) after a sign-out keeps today's behaviour.
        let mut c = Config { screen_help: true, ..Default::default() };
        apply_link(&mut c, &serde_json::json!({ "status": "approved", "token": "t" }));
        assert!(c.screen_help && c.user_digest.is_none());
        // A digest that isn't one is ignored.
        let mut c = Config::default();
        apply_link(&mut c, &link("x\"y"));
        assert!(c.user_digest.is_none());
    }

    #[test]
    fn names_on_the_wire() {
        assert_eq!(user_agent(), format!("Boredroom for Mac/{} (macOS)", env!("CARGO_PKG_VERSION")));
        assert_eq!(device_name(), "Boredroom on this Mac");
        assert_eq!(visible_label(true, "Max"), "Tuck Max away when idle");
        assert_eq!(toggle_label(false, "Max"), "Show Max");
    }

    /// §5.5's five branches.
    #[test]
    fn when_the_window_opens_at_launch() {
        assert!(launch_opens_window(Some(true), true, true, true), "an update restart with it open");
        assert!(!launch_opens_window(Some(false), false, false, false), "an update restart with it closed");
        assert!(launch_opens_window(None, false, true, true), "the first launch");
        assert!(launch_opens_window(None, true, false, true), "not signed in");
        assert!(!launch_opens_window(None, true, true, true), "at login");
        assert!(launch_opens_window(None, true, true, false), "the person opened it");
    }

    /// §12.1 item 13: the bundle's promises.
    #[test]
    fn the_bundle_declares_the_scheme_and_the_camera() {
        let plist = include_str!("../Info.plist");
        assert!(plist.contains("<key>CFBundleURLSchemes</key>") && plist.contains("<string>boredroom</string>"));
        assert!(plist.contains("<key>NSCameraUsageDescription</key>"));
        assert!(plist.contains("<key>NSMicrophoneUsageDescription</key>"));
        assert!(plist.contains("<key>LSUIElement</key>"));
        let ent = include_str!("../Entitlements.plist");
        assert!(ent.contains("com.apple.security.device.camera") && ent.contains("com.apple.security.device.audio-input"));
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(conf["productName"], "Boredroom");
        assert_eq!(conf["identifier"], "cc.boredroom.brenda", "brenda.json and the Mac's permissions carry over");
        assert_eq!(conf["version"], "0.2.0");
    }

    /// The app ACL (0b.14): every command the notch page invokes is allowed to the notch, every command registered is
    /// in the app manifest, and no capability names the companion, ring, outline or render windows.
    mod acl {
        use super::super::COMMANDS;

        fn page_invokes() -> Vec<String> {
            let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../src");
            let mut names = Vec::new();
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.extension().and_then(|e| e.to_str()) != Some("js") {
                    continue;
                }
                let src = std::fs::read_to_string(&path).unwrap();
                let mut rest = src.as_str();
                while let Some(i) = rest.find("invoke(") {
                    rest = &rest[i + 7..];
                    let t = rest.trim_start();
                    if let Some(q) = t.chars().next().filter(|c| *c == '"' || *c == '\'' || *c == '`') {
                        if let Some(end) = t[1..].find(q) {
                            let name = &t[1..1 + end];
                            if name.chars().all(|c| c.is_ascii_lowercase() || c == '_') && !name.is_empty() {
                                names.push(name.to_string());
                            }
                        }
                    }
                }
            }
            names.sort();
            names.dedup();
            names
        }

        fn capability() -> serde_json::Value {
            serde_json::from_str(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities/default.json")).unwrap()).unwrap()
        }

        #[test]
        fn every_page_invoke_is_allowed() {
            let cap = capability();
            let perms: Vec<String> = cap["permissions"].as_array().unwrap().iter().filter_map(|p| p.as_str().map(String::from)).collect();
            let invokes = page_invokes();
            assert!(!invokes.is_empty());
            for name in &invokes {
                assert!(COMMANDS.contains(&name.as_str()), "the page invokes {name}, which is not a command");
                assert!(perms.contains(&format!("allow-{}", name.replace('_', "-"))), "{name} is not allowed to the notch");
            }
            for c in COMMANDS {
                assert!(perms.contains(&format!("allow-{}", c.replace('_', "-"))), "{c} is registered but not allowed to the notch");
            }
            assert_eq!(cap["windows"], serde_json::json!(["notch"]));
            let text = cap.to_string();
            for w in ["companion", "companion-ring", "look-outline", "file-render"] {
                assert!(!cap["windows"].as_array().unwrap().iter().any(|x| x == w), "{w} must have no capability");
            }
            assert!(!text.contains("\"companion\""));
        }

        /// The Boredroom window loads remote pages, so it may call nothing (owner request, 24 October 2026): no capability
        /// file names it, any window or webview by a wildcard, or a remote origin.
        #[test]
        fn the_boredroom_window_has_no_capability() {
            let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/capabilities");
            let mut n = 0;
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                let text = std::fs::read_to_string(&path).unwrap();
                n += 1;
                let v: serde_json::Value = if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    serde_json::from_str(&text).unwrap()
                } else {
                    panic!("{} is not JSON: check it by hand and extend this test", path.display());
                };
                for key in ["windows", "webviews"] {
                    for w in v[key].as_array().into_iter().flatten() {
                        let w = w.as_str().unwrap_or("");
                        assert_ne!(w, crate::dashboard::LABEL, "{} names the Boredroom window", path.display());
                        assert!(!w.contains(['*', '?', '[']), "{} matches windows by a pattern ({w})", path.display());
                    }
                }
                assert!(v.get("remote").is_none(), "{} lets remote pages call commands", path.display());
                assert!(!text.contains("\"remote\""), "{}", path.display());
            }
            assert!(n >= 1);
            assert_eq!(capability()["windows"], serde_json::json!(["notch"]), "the notch's capability is unchanged");
        }

        #[test]
        fn the_manifest_lists_every_command() {
            let build = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs")).unwrap();
            let lib = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs")).unwrap();
            let handler = lib.split("generate_handler![").nth(1).unwrap().split(']').next().unwrap();
            let registered: Vec<String> = handler.split(',').map(|s| s.trim().rsplit("::").next().unwrap().to_string()).filter(|s| !s.is_empty()).collect();
            assert_eq!(registered.len(), COMMANDS.len());
            for c in &registered {
                assert!(COMMANDS.contains(&c.as_str()), "{c} is registered but not in COMMANDS");
                assert!(build.contains(&format!("\"{c}\"")), "{c} is not in build.rs's app manifest");
            }
        }
    }
}
