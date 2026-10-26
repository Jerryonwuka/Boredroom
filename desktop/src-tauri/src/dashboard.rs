//! The Boredroom window: the whole web dashboard in its own Mac window (owner request, 24 October 2026).
//!
//! One window, label `boredroom`, made on demand and destroyed when closed (its memory freed, its page stopped). While it
//! exists the app is an ordinary Mac app (a Dock icon, ⌘Tab, the menu bar); 1.5 s after it is destroyed Boredroom goes
//! back to being a menu-bar app, with Brenda in the notch as before. Its size and place are remembered in
//! `dashboard.json` beside `brenda.json`.
//!
//! Security (non-negotiable): the window loads remote pages, so it has no Tauri IPC at all: no capability names it (a test
//! in lib.rs reads every capability file), and the opener plugin's link script is off for the whole app. It may show
//! only https://www.boredroom.cc and the apex (in a development build also the configured server); every other link opens
//! in the default browser (policy.rs). It has its own website data store, never the notch's. No devtools in a release
//! build (tauri's `devtools` feature is off). Microphone and camera are allowed for calls; nothing else (policy.rs).

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
    webview::{NewWindowResponse, PageLoadEvent},
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

use crate::policy::{self, Decision, NewWindow, Origin, RateLimit};

pub const LABEL: &str = "boredroom";

/// The window's own website data (cookies, storage, cache), never the notch's (owner request, 24 October 2026).
/// Generated once with `uuidgen` (293B21EA-666D-41FF-BA91-1445EA35B2BC); NEVER change it: the window would lose its
/// sign-in and storage.
pub const STORE_ID: [u8; 16] = [0x29, 0x3B, 0x21, 0xEA, 0x66, 0x6D, 0x41, 0xFF, 0xBA, 0x91, 0x14, 0x45, 0xEA, 0x35, 0xB2, 0xBC];

const DEFAULT_W: f64 = 1280.0;
const DEFAULT_H: f64 = 832.0;
const MIN_W: f64 = 720.0;
const MIN_H: f64 = 520.0;
/// Back to a menu-bar app this long after the window goes (quick show/hide toggles leave ghost Dock icons).
const ACCESSORY_AFTER: Duration = Duration::from_millis(1500);
const SAVE_AFTER: Duration = Duration::from_millis(500);
/// A Rust-initiated navigation with no finished page in this long shows the offline page.
const OFFLINE_AFTER: Duration = Duration::from_secs(15);
pub const ZOOMS: [f64; 11] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Restart {
    pub open: bool,
}

/// `dashboard.json` (0600): where the window was, and the window's own settings. Separate from `brenda.json` on purpose:
/// who is signed in and where the window was are different concerns, and the frame is written often.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashFile {
    #[serde(default)]
    pub frame: Option<Frame>,
    #[serde(default)]
    pub maximized: bool,
    #[serde(default = "one")]
    pub zoom: f64,
    #[serde(default)]
    pub last_path: Option<String>,
    /// The escape hatch: false keeps Boredroom a menu-bar app (no Dock icon) even while the window is open.
    #[serde(default = "yes")]
    pub dock_icon: bool,
    /// "Don't ask again" on the one-time quit explanation.
    #[serde(default)]
    pub quit_asked: bool,
    /// Written by an update just before it restarts: whether the window was open.
    #[serde(default)]
    pub restart: Option<Restart>,
    /// The page's theme as last seen ("light" or "dark"; chrome.rs), so the window opens in it.
    #[serde(default)]
    pub theme: Option<String>,
}

fn one() -> f64 {
    1.0
}
fn yes() -> bool {
    true
}

impl Default for DashFile {
    fn default() -> Self {
        DashFile { frame: None, maximized: false, zoom: 1.0, last_path: None, dock_icon: true, quit_asked: false, restart: None, theme: None }
    }
}

#[derive(Default)]
pub struct Dash {
    file: Mutex<DashFile>,
    accessory_gen: AtomicU64,
    save_gen: AtomicU64,
    /// Finished page loads (the offline watchdog compares).
    loads: AtomicU64,
    last_crash_reload: Mutex<Option<Instant>>,
}

static EXTERNAL: RateLimit = RateLimit::new(3, Duration::from_secs(5));

fn file_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("dashboard.json"))
}

pub fn load(app: &AppHandle) -> DashFile {
    file_path(app).and_then(|p| std::fs::read_to_string(p).ok()).and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save(app: &AppHandle, f: &DashFile) {
    let Some(path) = file_path(app) else { return };
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(f) {
        let _ = std::fs::write(&path, json);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
    }
}

/// Changes `dashboard.json` and saves it.
pub fn update(app: &AppHandle, f: impl FnOnce(&mut DashFile)) {
    let Some(d) = app.try_state::<Dash>() else { return };
    let mut file = d.file.lock().unwrap();
    f(&mut file);
    save(app, &file);
}

pub fn read(app: &AppHandle) -> DashFile {
    app.try_state::<Dash>().map(|d| d.file.lock().unwrap().clone()).unwrap_or_default()
}

pub fn manage(app: &AppHandle) {
    let d = Dash::default();
    *d.file.lock().unwrap() = load(app);
    app.manage(d);
}

// ---- pure helpers ---------------------------------------------------------------------------------------------------

/// The page title with Boredroom's own suffix removed; empty becomes "Boredroom".
pub fn window_title(t: &str) -> String {
    let t = t.trim();
    let t = [" | Boredroom", " · Boredroom", " - Boredroom", " — Boredroom"].iter().find_map(|s| t.strip_suffix(s)).unwrap_or(t).trim();
    if t.is_empty() || t.eq_ignore_ascii_case("boredroom") {
        "Boredroom".into()
    } else {
        t.chars().take(200).collect()
    }
}

/// The remembered frame if it still overlaps a monitor's work area by at least 120×80 points, clamped to that work area
/// (logical points, top-left origin); None means "centre the default".
pub fn frame_on_screen(frame: Frame, work_areas: &[Frame]) -> Option<Frame> {
    if !(frame.width.is_finite() && frame.height.is_finite() && frame.x.is_finite() && frame.y.is_finite()) {
        return None;
    }
    let overlap = |a: &Frame| {
        let w = (frame.x + frame.width).min(a.x + a.width) - frame.x.max(a.x);
        let h = (frame.y + frame.height).min(a.y + a.height) - frame.y.max(a.y);
        (w.max(0.0), h.max(0.0))
    };
    let area = work_areas.iter().filter(|a| {
        let (w, h) = overlap(a);
        w >= 120.0 && h >= 80.0
    }).max_by(|a, b| {
        let (aw, ah) = overlap(a);
        let (bw, bh) = overlap(b);
        (aw * ah).total_cmp(&(bw * bh))
    })?;
    let width = frame.width.clamp(MIN_W.min(area.width), area.width);
    let height = frame.height.clamp(MIN_H.min(area.height), area.height);
    let x = frame.x.clamp(area.x, area.x + area.width - width);
    let y = frame.y.clamp(area.y, area.y + area.height - height);
    Some(Frame { x, y, width, height })
}

/// The default frame: 1280×832 centred on the work area, capped to it.
pub fn default_frame(area: Frame) -> Frame {
    let width = DEFAULT_W.min(area.width);
    let height = DEFAULT_H.min(area.height);
    Frame { x: area.x + (area.width - width) / 2.0, y: area.y + (area.height - height) / 2.0, width, height }
}

/// The next zoom step (`dir` +1 in, -1 out, 0 actual size).
pub fn zoom_step(current: f64, dir: i32) -> f64 {
    match dir {
        0 => 1.0,
        d if d > 0 => ZOOMS.iter().copied().find(|z| *z > current + 0.001).unwrap_or(ZOOMS[ZOOMS.len() - 1]),
        _ => ZOOMS.iter().rev().copied().find(|z| *z < current - 0.001).unwrap_or(ZOOMS[0]),
    }
}

/// The Safari version WebKit on this macOS matches (14 → 17, 15 → 18, 26 and later → itself), so LiveKit and other
/// user-agent parsers treat the window as Safari.
pub fn safari_major(macos_major: u32) -> u32 {
    match macos_major {
        0..=14 => 17,
        15 => 18,
        m => m,
    }
}

/// The window's user agent. The only contract with the web is the `BoredroomDesktop/` token, used for the interface
/// only, never for security.
pub fn dashboard_user_agent(macos_major: u32) -> String {
    format!(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/{}.0 Safari/605.1.15 BoredroomDesktop/{}",
        safari_major(macos_major),
        env!("CARGO_PKG_VERSION")
    )
}

fn macos_major() -> u32 {
    #[cfg(target_os = "macos")]
    {
        objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion().majorVersion.max(0) as u32
    }
    #[cfg(not(target_os = "macos"))]
    {
        14
    }
}

/// The offline page: self-contained (no network), drawn into `about:blank`, with Try again going to the entry address.
pub fn offline_js(entry: &str) -> String {
    let u = serde_json::to_string(entry).unwrap_or_else(|_| "\"/\"".into());
    format!(
        r##"(()=>{{const u={u};const d=document;d.title="Boredroom";const dark=matchMedia("(prefers-color-scheme: dark)").matches;const b=d.body||d.documentElement.appendChild(d.createElement("body"));b.style.cssText="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font:500 14px/20px Inter,system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;background:"+(dark?"#0f0f10":"#ffffff")+";color:"+(dark?"#ffffff":"#0f0f10");const w=d.createElement("div");w.style.cssText="text-align:center;max-width:320px;padding:16px";const h=d.createElement("p");h.textContent="Boredroom can't connect.";h.style.cssText="margin:0;font-size:16px;line-height:24px;font-weight:600";const s=d.createElement("p");s.textContent="Check your internet connection.";s.style.cssText="margin:4px 0 16px;color:"+(dark?"rgba(255,255,255,.64)":"rgba(15,15,16,.64)");const t=d.createElement("button");t.textContent="Try again";t.style.cssText="font:inherit;height:32px;padding:0 14px;border-radius:8px;border:0;cursor:pointer;background:"+(dark?"#ffffff":"#0f0f10")+";color:"+(dark?"#0f0f10":"#ffffff");t.onclick=()=>{{location.href=u}};w.append(h,s,t);b.replaceChildren(w);t.focus()}})()"##
    )
}

// ---- origins and links ----------------------------------------------------------------------------------------------

/// The window's origins for the server this Mac uses.
pub fn origins(app: &AppHandle) -> Vec<Origin> {
    let base = crate::base_url(&app.state::<crate::AppState>().config.lock().unwrap());
    policy::allowed_origins(&base, cfg!(debug_assertions))
}

fn base(app: &AppHandle) -> String {
    crate::base_url(&app.state::<crate::AppState>().config.lock().unwrap())
}

/// Whether the configured server is one the window may show (a release build pointed elsewhere: no window).
pub fn can_open(app: &AppHandle) -> bool {
    Url::parse(&base(app)).ok().is_some_and(|u| policy::is_allowed(&u, &origins(app)))
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

pub fn exists(app: &AppHandle) -> bool {
    window(app).is_some()
}

/// Opens a URL in the default browser (rate-limited: 3 per 5 s).
pub fn open_external(app: &AppHandle, url: &str) {
    if !EXTERNAL.allow(Instant::now()) {
        eprintln!("Boredroom: too many links opened at once; one was dropped");
        return;
    }
    if let Err(e) = app.opener().open_url(url, None::<&str>) {
        eprintln!("Boredroom: couldn't open a link in the browser ({e})");
    }
}

/// The window's entry address for an app path (signed in through the handoff when this Mac is linked).
pub fn entry(app: &AppHandle, path: &str) -> String {
    let c = app.state::<crate::AppState>().config.lock().unwrap().clone();
    let digest = c.token.as_ref().and(c.user_digest.as_deref());
    crate::webauth::entry_url(&crate::base_url(&c), path, digest)
}

/// The path the window opens with no other: the remembered one, else the workspace's, else `/app`.
fn default_path(app: &AppHandle) -> String {
    let o = origins(app);
    let remembered = read(app).last_path.and_then(|p| crate::webauth::safe_app_path(&p, &o));
    remembered.unwrap_or_else(|| {
        let c = app.state::<crate::AppState>().config.lock().unwrap().clone();
        match (c.token.as_ref(), c.workspace_slug.as_ref()) {
            (Some(_), Some(s)) => format!("/app/{}", crate::webauth::enc(s)),
            _ => "/app".into(),
        }
    })
}

// ---- opening ----------------------------------------------------------------------------------------------------------

/// The single entry point: shows the window (made if needed), at `path` when given (an app page, checked). Safe from any
/// thread.
pub fn open(app: &AppHandle, path: Option<&str>) {
    let o = origins(app);
    let path = path.and_then(|p| crate::webauth::safe_app_path(p, &o));
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || open_now(&app2, path));
}

fn open_now(app: &AppHandle, path: Option<String>) {
    if let Some(w) = window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        if let Some(p) = path {
            navigate(app, &entry(app, &p));
        }
        return;
    }
    if !can_open(app) {
        let b = base(app);
        let origin = Url::parse(&b).ok().and_then(|u| Origin::of(&u)).map(|o| o.as_url()).unwrap_or(b);
        let name = crate::companion::name(app);
        crate::appmenu::alert(app, crate::appmenu::Alert::info("The Boredroom window only opens boredroom.cc", &format!("This Mac is set to use {origin}. {name} in your notch still uses it; the window doesn't.")), |_, _| {});
        return;
    }
    let dash = app.state::<Dash>();
    dash.accessory_gen.fetch_add(1, Ordering::SeqCst); // a pending switch back to a menu-bar app is cancelled
    let file = read(app);
    // The Dock icon first, then the window (the notch stays the window made at launch while a menu-bar app).
    if file.dock_icon {
        crate::island::regular_app_now();
    }
    let path = path.unwrap_or_else(|| default_path(app));
    let Ok(url) = Url::parse(&entry(app, &path)) else { return };
    let area = primary_work_area(app).unwrap_or(Frame { x: 0.0, y: 0.0, width: 1440.0, height: 900.0 });
    let frame = file.frame.and_then(|f| frame_on_screen(f, &work_areas(app))).unwrap_or_else(|| default_frame(area));
    crate::webauth::window_opened(app);
    let (a1, a2, a3, a4, a5) = (app.clone(), app.clone(), app.clone(), app.clone(), app.clone());
    // The Mac app shell (owner request, 26 October 2026; chrome.rs): no title bar of its own (the title stays for the
    // Window menu and Mission Control, hidden), the traffic lights in the page's floating sidebar, the sidebar
    // vibrancy behind a transparent page, in the theme the page last showed (else the system's).
    let theme = crate::chrome::remembered(app).map(|t| t.tauri()).unwrap_or(if dark_appearance() { tauri::Theme::Dark } else { tauri::Theme::Light });
    let built = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External(url))
        .title("Boredroom")
        .inner_size(frame.width, frame.height)
        .min_inner_size(MIN_W, MIN_H)
        .position(frame.x, frame.y)
        .resizable(true)
        .decorations(true)
        .visible(false)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(crate::chrome::TRAFFIC_LIGHTS.0, crate::chrome::TRAFFIC_LIGHTS.1))
        .transparent(true)
        .effects(tauri::utils::config::WindowEffectsConfig {
            effects: vec![tauri::window::Effect::Sidebar],
            state: Some(tauri::window::EffectState::FollowsWindowActiveState),
            ..Default::default()
        })
        .theme(Some(theme))
        .data_store_identifier(STORE_ID)
        .user_agent(&dashboard_user_agent(macos_major()))
        .devtools(cfg!(debug_assertions))
        .allow_link_preview(false)
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(false)
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Throttle)
        .on_navigation(move |url| on_navigation(&a1, url))
        .on_new_window(move |url, _features| on_new_window(&a2, url))
        .on_download(move |w, e| crate::downloads::on_download(&a3, w, e))
        .on_permission_request(|_, kind| policy::permission(kind))
        .on_page_load(move |w, p| {
            let finished = p.event() == PageLoadEvent::Finished;
            crate::webauth::on_page_load(&a4, w.clone(), p.url().clone(), finished);
            if finished {
                crate::chrome::probe(&a4, &w);
            }
        })
        .on_document_title_changed(|w, t| {
            let _ = w.set_title(&window_title(&t));
        })
        .build();
    let w = match built {
        Ok(w) => w,
        Err(e) => {
            eprintln!("Boredroom: the window could not be made ({e})");
            schedule_accessory(app);
            return;
        }
    };
    if file.maximized {
        let _ = w.maximize();
    }
    if (file.zoom - 1.0).abs() > 0.001 {
        let _ = w.set_zoom(file.zoom);
    }
    crate::chrome::install(app, &w);
    let _ = w.show();
    let _ = w.set_focus();
    watch(app);
    w.on_window_event(move |e| window_event(&a5, e));
}

fn dark_appearance() -> bool {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if ns_app.is_null() {
            return true;
        }
        let ap: *mut AnyObject = msg_send![&*ns_app, effectiveAppearance];
        if ap.is_null() {
            return true;
        }
        let name: Option<Retained<objc2_foundation::NSString>> = msg_send![&*ap, name];
        name.is_some_and(|n| n.to_string().contains("Dark"))
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}

fn to_frame(r: tauri::PhysicalRect<i32, u32>, scale: f64) -> Frame {
    Frame { x: r.position.x as f64 / scale, y: r.position.y as f64 / scale, width: r.size.width as f64 / scale, height: r.size.height as f64 / scale }
}

fn work_areas(app: &AppHandle) -> Vec<Frame> {
    app.available_monitors().unwrap_or_default().iter().map(|m| to_frame(*m.work_area(), m.scale_factor())).collect()
}

fn primary_work_area(app: &AppHandle) -> Option<Frame> {
    app.primary_monitor().ok().flatten().map(|m| to_frame(*m.work_area(), m.scale_factor()))
}

// ---- navigation ------------------------------------------------------------------------------------------------------

/// Sends the window to an address, after the current callback returns, and watches for a page that never arrives.
pub fn navigate(app: &AppHandle, url: &str) {
    let Ok(u) = Url::parse(url) else { return };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(w) = window(&app) {
            if w.navigate(u).is_ok() {
                watch(&app);
            }
        }
    });
}

/// A page finished loading in the window.
pub fn loaded(app: &AppHandle) {
    if let Some(d) = app.try_state::<Dash>() {
        d.loads.fetch_add(1, Ordering::SeqCst);
    }
}

/// The offline watchdog: no finished page within 15 s of a navigation Rust started → "Boredroom can't connect."
fn watch(app: &AppHandle) {
    let Some(d) = app.try_state::<Dash>() else { return };
    let before = d.loads.load(Ordering::SeqCst);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(OFFLINE_AFTER).await;
        let Some(d) = app.try_state::<Dash>() else { return };
        if d.loads.load(Ordering::SeqCst) != before {
            return;
        }
        let Some(w) = window(&app) else { return };
        let path = crate::webauth::last_app_path(&app).unwrap_or_else(|| default_path(&app));
        let js = offline_js(&entry(&app, &path));
        let Ok(blank) = Url::parse("about:blank") else { return };
        if w.navigate(blank).is_ok() {
            tokio::time::sleep(Duration::from_millis(300)).await;
            let _ = w.eval(js);
        }
    });
}

/// The window's navigation policy (§4.2). Actions run after the callback returns.
fn on_navigation(app: &AppHandle, url: &Url) -> bool {
    let expected = crate::webauth::expected_start(app);
    let decision = policy::decide(url, &origins(app), expected.as_deref());
    let app = app.clone();
    match decision {
        Decision::Allow => {
            if url.path() == policy::APP_START && expected.as_deref() == Some(url.as_str()) {
                crate::webauth::start_used(&app);
            }
            true
        }
        Decision::Scheme(u) => {
            tauri::async_runtime::spawn(async move { crate::webauth::scheme_action(&app, &u) });
            false
        }
        Decision::BrowserSignIn { google, next } => {
            let caught = url.clone();
            crate::webauth::browser_sign_in(&app, google, caught, next);
            false
        }
        Decision::Browser(u) | Decision::System(u) => {
            tauri::async_runtime::spawn(async move { open_external(&app, u.as_str()) });
            false
        }
        Decision::Upgrade(u) => {
            navigate(&app, u.as_str());
            false
        }
        Decision::Refuse(why) => {
            eprintln!("Boredroom: the window refused a {} link ({why})", url.scheme());
            false
        }
    }
}

/// New windows are always refused; what they asked for goes where it belongs (§4.3).
fn on_new_window(app: &AppHandle, url: Url) -> NewWindowResponse<tauri::Wry> {
    let app = app.clone();
    match policy::new_window(&url, &origins(&app)) {
        NewWindow::InWindow(u) => navigate(&app, u.as_str()),
        NewWindow::Browser(u) | NewWindow::System(u) => {
            tauri::async_runtime::spawn(async move { open_external(&app, u.as_str()) });
        }
        NewWindow::Scheme(u) => {
            tauri::async_runtime::spawn(async move { crate::webauth::scheme_action(&app, &u) });
        }
        NewWindow::Nothing => eprintln!("Boredroom: the window asked for a new {} window; refused", url.scheme()),
    }
    NewWindowResponse::Deny
}

/// The WebContent process crashed: reload the window (once per 10 s at most). The notch is left as it is.
pub fn on_web_content_terminated(app: &AppHandle, label: &str) {
    if label != LABEL {
        return;
    }
    let Some(d) = app.try_state::<Dash>() else { return };
    let mut last = d.last_crash_reload.lock().unwrap();
    if last.is_some_and(|t| t.elapsed() < Duration::from_secs(10)) {
        return;
    }
    *last = Some(Instant::now());
    eprintln!("Boredroom: the window's page stopped; reloading it");
    if let Some(w) = window(app) {
        let _ = w.reload();
    }
}

// ---- window life -------------------------------------------------------------------------------------------------------

/// The current app path the window shows (client-side navigation included), if it is one.
fn current_app_path(app: &AppHandle) -> Option<String> {
    let u = window(app)?.url().ok()?;
    if !policy::is_allowed(&u, &origins(app)) {
        return None;
    }
    let p = match u.query() {
        Some(q) => format!("{}?{q}", u.path()),
        None => u.path().to_string(),
    };
    crate::webauth::safe_app_path(&p, &origins(app))
}

fn save_frame_now(app: &AppHandle) {
    let Some(w) = window(app) else { return };
    let maximized = w.is_maximized().unwrap_or(false);
    let full = w.is_fullscreen().unwrap_or(false);
    let scale = w.scale_factor().unwrap_or(1.0);
    let (Ok(pos), Ok(size)) = (w.outer_position(), w.inner_size()) else { return };
    let frame = Frame { x: pos.x as f64 / scale, y: pos.y as f64 / scale, width: size.width as f64 / scale, height: size.height as f64 / scale };
    let path = current_app_path(app);
    update(app, |f| {
        // Full screen and maximised keep the ordinary frame from before.
        if !maximized && !full {
            f.frame = Some(frame);
        }
        f.maximized = maximized;
        if path.is_some() {
            f.last_path = path;
        }
    });
}

fn save_frame_soon(app: &AppHandle) {
    let Some(d) = app.try_state::<Dash>() else { return };
    let gen = d.save_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SAVE_AFTER).await;
        if app.try_state::<Dash>().is_some_and(|d| d.save_gen.load(Ordering::SeqCst) == gen) {
            save_frame_now(&app);
        }
    });
}

/// Back to a menu-bar app 1.5 s after the window went, unless it came back.
fn schedule_accessory(app: &AppHandle) {
    let Some(d) = app.try_state::<Dash>() else { return };
    let gen = d.accessory_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(ACCESSORY_AFTER).await;
        let still = app.try_state::<Dash>().is_some_and(|d| d.accessory_gen.load(Ordering::SeqCst) == gen);
        if still && !exists(&app) {
            let _ = app.run_on_main_thread(crate::island::menu_bar_app_now);
        }
    });
}

/// A fresh live call, as the notch's page last said (within a minute).
pub fn on_call(app: &AppHandle) -> bool {
    crate::look::call_fresh(app, Duration::from_secs(60))
}

fn window_event(app: &AppHandle, e: &WindowEvent) {
    match e {
        WindowEvent::CloseRequested { api, .. } => {
            if on_call(app) {
                api.prevent_close();
                let a = crate::appmenu::Alert {
                    title: "Leave the call?".into(),
                    message: "Closing the Boredroom window ends your call.".into(),
                    buttons: vec!["Leave Call".into(), "Cancel".into()],
                    destructive: Some(0),
                    suppress: false,
                };
                let app2 = app.clone();
                crate::appmenu::alert(app, a, move |i, _| {
                    if i == 0 {
                        save_frame_now(&app2);
                        if let Some(w) = window(&app2) {
                            let _ = w.destroy();
                        }
                    }
                });
                return;
            }
            save_frame_now(app);
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => save_frame_soon(app),
        WindowEvent::Destroyed => schedule_accessory(app),
        _ => {}
    }
}

/// Closes the window (⌘W, the front desk's "close this window").
pub fn close(app: &AppHandle) {
    if let Some(w) = window(app) {
        let _ = w.close();
    }
}

pub fn minimise(app: &AppHandle) -> bool {
    window(app).is_some_and(|w| w.minimize().is_ok())
}

/// Brings the window to the front (handing the front back to Boredroom's own window).
pub fn focus(app: &AppHandle) -> bool {
    let Some(w) = window(app) else { return false };
    let _ = w.unminimize();
    let _ = w.show();
    w.set_focus().is_ok()
}

// ---- the Dock's badge (the Mac app shell, owner request 26 October 2026) -----------------------------------------------

/// The badge for an unread count: none at 0, "99+" past 99. Pure (tested).
pub fn badge_label(unread: i64) -> Option<String> {
    match unread {
        n if n <= 0 => None,
        n if n > 99 => Some("99+".into()),
        n => Some(n.to_string()),
    }
}

static BADGE: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(-1);

/// Shows the unread notifications on the Dock icon (it shows while the Boredroom window is open); 0 clears it.
pub fn set_badge(app: &AppHandle, unread: i64) {
    let unread = unread.max(0);
    if BADGE.swap(unread, Ordering::SeqCst) == unread {
        return;
    }
    let label = badge_label(unread);
    let _ = app.run_on_main_thread(move || {
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::{class, msg_send, runtime::AnyObject};
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            if ns_app.is_null() {
                return;
            }
            let tile: *mut AnyObject = msg_send![&*ns_app, dockTile];
            if tile.is_null() {
                return;
            }
            match &label {
                Some(l) => {
                    let s = objc2_foundation::NSString::from_str(l);
                    let _: () = msg_send![&*tile, setBadgeLabel: &*s];
                }
                None => {
                    let nil: *mut AnyObject = std::ptr::null_mut();
                    let _: () = msg_send![&*tile, setBadgeLabel: nil];
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        let _ = label;
    });
}

// ---- the Go menu (the Mac app shell, owner request 26 October 2026) ---------------------------------------------------

/// ⌘1–⌘9: the workspace's main sections, in the sidebar's order for staff. Sections a role doesn't have send the page on
/// where it belongs (the web app does that: My Day and To-dos take owners and HR to the Dashboard and Tasks).
pub const SECTIONS: [(&str, &str); 9] = [
    ("home", ""),
    ("my-day", "My Day"),
    ("todos", "To-dos"),
    ("tasks", "Tasks"),
    ("commitments", "Commitments"),
    ("messages", "Messages"),
    ("calls", "Calls"),
    ("docs", "Docs"),
    ("notifications", "Notifications"),
];

/// A workspace slug as the web app makes them (lowercase letters, digits, hyphens); anything else is not one.
fn slug_ok(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The workspace an app path is in (`/app/<slug>/…`). Pure (tested).
pub fn workspace_of(path: &str) -> Option<String> {
    let rest = path.strip_prefix("/app/")?;
    let slug = rest.split(['/', '?', '#']).next()?;
    (slug_ok(slug) && slug != "billing").then(|| slug.to_string())
}

/// Where a Go item goes: `rel` (a section, with an optional query) in the workspace the window shows, else the one this
/// Mac is linked to, else `/app` (pick a workspace). Pure (tested).
pub fn section_path(current: Option<&str>, linked: Option<&str>, rel: &str) -> String {
    let slug = current.and_then(workspace_of).or_else(|| linked.filter(|s| slug_ok(s)).map(String::from));
    match slug {
        Some(s) => format!("/app/{s}/{rel}"),
        None => "/app".into(),
    }
}

/// The script that moves the page (the web app's router when it is there, a page load otherwise). The path is the app's
/// own, written as a JSON string. Pure (tested).
pub fn go_js(path: &str) -> String {
    let p = serde_json::to_string(path).unwrap_or_else(|_| "\"/app\"".into());
    format!("(()=>{{const p={p};const s=window.__boredroomShell;if(s&&typeof s.go===\"function\")s.go(p);else location.assign(p)}})()")
}

/// Go › a section, File › New To-do: in the window (made and shown if needed).
pub fn go(app: &AppHandle, rel: &str) {
    let linked = app.state::<crate::AppState>().config.lock().unwrap().workspace_slug.clone();
    let current = if exists(app) { current_app_path(app) } else { None };
    let path = section_path(current.as_deref(), linked.as_deref(), rel);
    match window(app) {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
            let _ = w.eval(go_js(&path));
        }
        None => open(app, Some(&path)),
    }
}

/// The View and Window menus (only when the window is key).
pub fn view_action(app: &AppHandle, id: &str) {
    let Some(w) = window(app) else { return };
    if !w.is_focused().unwrap_or(false) {
        return;
    }
    match id {
        "app.reload" => {
            let _ = w.reload();
            watch(app);
        }
        "app.zoom0" | "app.zoomin" | "app.zoomout" => {
            let dir = match id {
                "app.zoomin" => 1,
                "app.zoomout" => -1,
                _ => 0,
            };
            let z = zoom_step(read(app).zoom, dir);
            if w.set_zoom(z).is_ok() {
                update(app, |f| f.zoom = z);
            }
        }
        "app.back" => {
            let _ = w.eval("history.back()");
        }
        "app.forward" => {
            let _ = w.eval("history.forward()");
        }
        "app.fullscreen" => {
            let full = w.is_fullscreen().unwrap_or(false);
            let _ = w.set_fullscreen(!full);
        }
        "app.minimise" => {
            let _ = w.minimize();
        }
        "app.zoom" => {
            let _ = if w.is_maximized().unwrap_or(false) { w.unmaximize() } else { w.maximize() };
        }
        "app.close" => {
            let _ = w.close();
        }
        _ => {}
    }
}

/// Signing out (the notch, the tray, another server), step one: the window forgets its website data (the remembered
/// page was the other person's too).
pub fn forget_data(app: &AppHandle) {
    update(app, |f| f.last_path = None);
    set_badge(app, 0);
    crate::webauth::forget(app);
    match window(app) {
        Some(w) => {
            let _ = w.clear_all_browsing_data();
        }
        None => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = app.remove_data_store(STORE_ID).await {
                    // Nothing to remove when the window has never been opened.
                    eprintln!("Boredroom: the window's data store: {e}");
                }
            });
        }
    }
}

/// Step two, once the server has forgotten the session: the window shows the sign-in (or closes, for a server it may
/// not show).
pub fn show_sign_in(app: &AppHandle) {
    if !exists(app) {
        return;
    }
    if can_open(app) {
        navigate(app, &entry(app, "/app"));
    } else {
        close(app);
    }
}

/// Before an update restarts the app: whether the window was open.
pub fn note_restart(app: &AppHandle) {
    let open = exists(app);
    if open {
        save_frame_now(app);
    }
    update(app, |f| f.restart = Some(Restart { open }));
}

/// No "Show Tab Bar" in the window's menus.
pub fn no_tabbing() {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::{class, msg_send};
        let _: () = msg_send![class!(NSWindow), setAllowsAutomaticWindowTabbing: false];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_store_id_never_changes() {
        assert_eq!(STORE_ID, [0x29, 0x3B, 0x21, 0xEA, 0x66, 0x6D, 0x41, 0xFF, 0xBA, 0x91, 0x14, 0x45, 0xEA, 0x35, 0xB2, 0xBC]);
        assert_eq!(LABEL, "boredroom");
    }

    #[test]
    fn titles() {
        assert_eq!(window_title("Home | Boredroom"), "Home");
        assert_eq!(window_title("Tasks · Boredroom"), "Tasks");
        assert_eq!(window_title("Boredroom"), "Boredroom");
        assert_eq!(window_title("  "), "Boredroom");
        assert_eq!(window_title("Acme Calls"), "Acme Calls");
    }

    #[test]
    fn frames() {
        let main = Frame { x: 0.0, y: 25.0, width: 1440.0, height: 850.0 };
        let right = Frame { x: 1440.0, y: 0.0, width: 1920.0, height: 1055.0 };
        let f = Frame { x: 100.0, y: 60.0, width: 1280.0, height: 800.0 };
        assert_eq!(frame_on_screen(f, &[main]), Some(f));
        // Hanging off the edge but mostly on: clamped inside.
        let g = frame_on_screen(Frame { x: 1000.0, y: 80.0, width: 1280.0, height: 800.0 }, &[main]).unwrap();
        assert!(g.x + g.width <= 1440.0 && g.x >= 0.0);
        // Too big: capped to the work area.
        let h = frame_on_screen(Frame { x: 0.0, y: 0.0, width: 3000.0, height: 2000.0 }, &[main]).unwrap();
        assert_eq!((h.width, h.height), (1440.0, 850.0));
        // On a monitor that's gone: the default.
        assert_eq!(frame_on_screen(Frame { x: 4000.0, y: 100.0, width: 1280.0, height: 800.0 }, &[main]), None);
        // A sliver (under 120×80 points) on screen counts as gone.
        assert_eq!(frame_on_screen(Frame { x: 1340.0, y: 100.0, width: 1280.0, height: 800.0 }, &[main]), None);
        // On the second monitor.
        let k = Frame { x: 1600.0, y: 100.0, width: 1280.0, height: 800.0 };
        assert_eq!(frame_on_screen(k, &[main, right]), Some(k));
        assert_eq!(frame_on_screen(Frame { x: f64::NAN, ..f }, &[main]), None);
        let d = default_frame(main);
        assert_eq!((d.width, d.height), (1280.0, 832.0));
        assert_eq!(d.x, 80.0);
        let small = default_frame(Frame { x: 0.0, y: 0.0, width: 1024.0, height: 700.0 });
        assert_eq!((small.width, small.height, small.x, small.y), (1024.0, 700.0, 0.0, 0.0));
    }

    #[test]
    fn zoom_steps() {
        assert_eq!(zoom_step(1.0, 1), 1.1);
        assert_eq!(zoom_step(1.0, -1), 0.9);
        assert_eq!(zoom_step(2.0, 1), 2.0);
        assert_eq!(zoom_step(0.5, -1), 0.5);
        assert_eq!(zoom_step(1.75, 0), 1.0);
        assert_eq!(zoom_step(1.2, 1), 1.25, "an odd value goes to the next step");
    }

    #[test]
    fn user_agent() {
        let ua = dashboard_user_agent(14);
        assert!(ua.contains("BoredroomDesktop/0.2.0"));
        assert!(ua.contains("Version/17.0 Safari/605.1.15"));
        assert!(dashboard_user_agent(15).contains("Version/18.0 "));
        assert!(dashboard_user_agent(26).contains("Version/26.0 "));
        assert!(ua.starts_with("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"));
    }

    #[test]
    fn the_settings_file() {
        let d: DashFile = serde_json::from_str("{}").unwrap();
        assert_eq!(d, DashFile::default());
        assert!(d.dock_icon && d.zoom == 1.0 && !d.quit_asked);
        let f: DashFile = serde_json::from_str(r#"{ "frame": { "x": 120, "y": 80, "width": 1280, "height": 832 }, "maximized": false, "zoom": 1.25, "lastPath": "/app/acme/home", "dockIcon": false, "quitAsked": true, "restart": { "open": true } }"#).unwrap();
        assert_eq!(f.frame, Some(Frame { x: 120.0, y: 80.0, width: 1280.0, height: 832.0 }));
        assert!(!f.dock_icon && f.quit_asked && f.restart == Some(Restart { open: true }));
        assert_eq!(f.last_path.as_deref(), Some("/app/acme/home"));
    }

    #[test]
    fn badges() {
        assert_eq!(badge_label(0), None);
        assert_eq!(badge_label(-3), None);
        assert_eq!(badge_label(7).as_deref(), Some("7"));
        assert_eq!(badge_label(99).as_deref(), Some("99"));
        assert_eq!(badge_label(100).as_deref(), Some("99+"));
    }

    #[test]
    fn the_go_menu() {
        assert_eq!(workspace_of("/app/acme/tasks?x=1"), Some("acme".into()));
        assert_eq!(workspace_of("/app/acme"), Some("acme".into()));
        assert_eq!(workspace_of("/app"), None);
        assert_eq!(workspace_of("/app/billing"), None);
        assert_eq!(workspace_of("/app/Ev%2Fil/x"), None);
        assert_eq!(workspace_of("/login"), None);
        assert_eq!(section_path(Some("/app/north-wind/docs"), Some("acme"), "todos?add=1"), "/app/north-wind/todos?add=1");
        assert_eq!(section_path(None, Some("acme"), "home"), "/app/acme/home");
        assert_eq!(section_path(Some("/desktop/app"), Some("bad slug"), "home"), "/app");
        let js = go_js("/app/acme/home");
        assert!(js.contains(r#"const p="/app/acme/home""#) && js.contains("__boredroomShell") && js.contains("location.assign(p)"));
        assert!(go_js("/app/a\"</script>").contains(r#""/app/a\"</script>""#), "written as a JSON string");
        assert_eq!(SECTIONS.len(), 9);
    }

    #[test]
    fn the_offline_page_is_self_contained() {
        let js = offline_js("https://www.boredroom.cc/desktop/app?next=%2Fapp");
        assert!(js.contains("Boredroom can't connect.") && js.contains("Check your internet connection.") && js.contains("Try again"));
        assert!(!js.contains("http://") && !js.contains("src="), "no network");
        assert!(offline_js("\"</script>").contains(r#"const u="\"</script>""#));
    }
}
