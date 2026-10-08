//! Brenda for Boredroom, the desktop notch (owner decision, 3 October 2026).
//!
//! The Rust side is deliberately small. It keeps the sign-in (Boredroom's address, the desktop session token and the
//! workspace) in the app's config folder, makes every HTTP call to Boredroom so the token never sits in the web view's
//! storage, places the window as a notch at the top centre of the screen, and puts Brenda in the tray. Everything the
//! person sees is in `src/` (plain HTML, CSS and JavaScript).
//!
//! The computer is only ever acted on by opening a Boredroom link in the browser. No files, keyboard or screen access.
//! The microphone is used only while the person holds the talk shortcut, and only once they turn voice on (`voice.rs`).
//!
//! Her voice (owner decision, 7 October 2026: phase 2): `voice.rs` speaks her replies with a moving face; signing out,
//! from the page or the tray, and quitting cut her off.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State, WebviewWindow,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

mod files;
mod island;
mod voice;

const DEFAULT_BASE_URL: &str = "https://boredroom.cc";

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
}

struct AppState {
    config: Mutex<Config>,
    http: reqwest::Client,
}

#[derive(Serialize)]
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

fn config_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("brenda.json"))
}

fn load_config(app: &AppHandle) -> Config {
    config_path(app)
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_config(app: &AppHandle, config: &Config) {
    if let Some(path) = config_path(app) {
        if let Some(dir) = path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_string_pretty(config) {
            let _ = fs::write(&path, json);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
            }
        }
    }
}

fn base_url(config: &Config) -> String {
    config
        .base_url
        .clone()
        .unwrap_or_else(|| DEFAULT_BASE_URL.to_string())
        .trim_end_matches('/')
        .to_string()
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
    }
}

fn device_name() -> String {
    let os = match std::env::consts::OS {
        "macos" => "Mac",
        "windows" => "Windows PC",
        "linux" => "Linux computer",
        other => other,
    };
    format!("Brenda on this {os}")
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
    }
    refresh_voice_menu(&app);
    voice::status(&app, enabled)
}

#[tauri::command]
fn speak(app: AppHandle, text: String) {
    voice::speak(&app, &text);
}

#[tauri::command]
fn stop_speaking(app: AppHandle) {
    voice::stop_speaking(&app);
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
    save_config(&app, &c);
    public(&c)
}

#[tauri::command]
fn sign_out(app: AppHandle, state: State<AppState>) -> PublicConfig {
    voice::stop_speaking(&app);
    let mut c = state.config.lock().unwrap();
    c.token = None;
    c.workspace_slug = None;
    c.workspace_name = None;
    c.display_name = None;
    save_config(&app, &c);
    public(&c)
}

async fn send(state: &State<'_, AppState>, method: &str, path: &str, body: Option<Value>, with_token: bool) -> Result<Value, ApiError> {
    let (base, token) = {
        let c = state.config.lock().unwrap();
        (base_url(&c), c.token.clone())
    };
    if !path.starts_with("/api/") {
        return Err(ApiError::new(400, "Only Boredroom API paths are allowed."));
    }
    let url = format!("{base}{path}");
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| ApiError::new(400, "Unknown method."))?;
    let mut req = state.http.request(m, &url).header("accept", "application/json").header("user-agent", format!("Brenda desktop/{} ({})", env!("CARGO_PKG_VERSION"), std::env::consts::OS));
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

/// Any Boredroom API call as the signed-in person.
#[tauri::command]
async fn api(state: State<'_, AppState>, method: String, path: String, body: Option<Value>) -> Result<Value, ApiError> {
    send(&state, &method, &path, body, true).await
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
        let mut c = state.config.lock().unwrap();
        c.token = r.get("token").and_then(|t| t.as_str()).map(String::from);
        c.workspace_slug = r.pointer("/workspace/slug").and_then(|s| s.as_str()).map(String::from);
        c.workspace_name = r.pointer("/workspace/name").and_then(|s| s.as_str()).map(String::from);
        c.display_name = r.get("displayName").and_then(|s| s.as_str()).map(String::from);
        save_config(&app, &c);
        return Ok(serde_json::json!({ "status": "approved", "config": public(&c) }));
    }
    Ok(r)
}

/// Opens a Boredroom page (or the approval page) in the person's browser. Only Boredroom's own address.
#[tauri::command]
fn open_in_browser(app: AppHandle, state: State<AppState>, path: String) -> Result<(), String> {
    let base = base_url(&state.config.lock().unwrap());
    let url = if path.starts_with("http") { path } else { format!("{base}{path}") };
    if !url.starts_with(&base) {
        return Err("Only Boredroom links can be opened.".into());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// Gives the notch keyboard focus so the person can type to Brenda (the window does not take focus on its own).
#[tauri::command]
fn focus_notch(window: WebviewWindow) -> Result<(), String> {
    window.set_focus().map_err(|e| e.to_string())
}

struct SoundMenu(MenuItem<tauri::Wry>);
struct VisibleMenu(MenuItem<tauri::Wry>);

fn visible_label(always: bool) -> &'static str {
    if always { "Tuck Brenda away when idle" } else { "Keep Brenda always visible" }
}

fn sounds_label(muted: bool) -> &'static str {
    if muted { "Turn sounds on" } else { "Turn sounds off" }
}

/// Hold to talk: Option+Space on a Mac, Alt+Space elsewhere.
fn talk_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT), Code::Space)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
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
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory); // no Dock icon: Brenda lives in the notch and the menu bar

            let handle = app.handle().clone();
            let config = load_config(&handle);
            app.manage(voice::Voice::default());
            app.manage(AppState {
                config: Mutex::new(config),
                http: reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().expect("http client"),
            });

            app.manage(island::Island::default());
            app.manage(files::Dropped::default());
            if let Some(window) = app.get_webview_window("notch") {
                let _ = window.set_always_on_top(true);
                let _ = island::place(&window);
                island::start(&handle, window);
            }

            if let Err(e) = app.global_shortcut().register(talk_shortcut()) {
                eprintln!("Brenda: the talk shortcut is taken by another app ({e})");
            }

            let open = MenuItem::with_id(app, "open", "Open Boredroom", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Hide Brenda", true, None::<&str>)?;
            let voice_item = MenuItem::with_id(app, "voice", "Turn voice on", true, None::<&str>)?;
            app.manage(VoiceMenu(voice_item.clone()));
            refresh_voice_menu(&handle);
            let muted = app.state::<AppState>().config.lock().unwrap().muted;
            let sound_item = MenuItem::with_id(app, "sounds", sounds_label(muted), true, None::<&str>)?;
            app.manage(SoundMenu(sound_item.clone()));
            let always = app.state::<AppState>().config.lock().unwrap().always_visible;
            let visible_item = MenuItem::with_id(app, "visible", visible_label(always), true, None::<&str>)?;
            app.manage(VisibleMenu(visible_item.clone()));
            let signout = MenuItem::with_id(app, "signout", "Sign out of this computer", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Brenda", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &toggle, &voice_item, &sound_item, &visible_item, &sep, &signout, &quit])?;
            let toggle_item = toggle.clone();
            TrayIconBuilder::with_id("brenda")
                .icon(app.default_window_icon().cloned().expect("app icon"))
                .tooltip("Brenda")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => {
                        let state = app.state::<AppState>();
                        let c = state.config.lock().unwrap().clone();
                        let path = c.workspace_slug.as_ref().map(|s| format!("/app/{s}")).unwrap_or_else(|| "/app".into());
                        let _ = app.opener().open_url(format!("{}{}", base_url(&c), path), None::<&str>);
                    }
                    "toggle" => {
                        if let Some(w) = app.get_webview_window("notch") {
                            let visible = w.is_visible().unwrap_or(true);
                            let _ = if visible { w.hide() } else { w.show() };
                            let _ = toggle_item.set_text(if visible { "Show Brenda" } else { "Hide Brenda" });
                        }
                    }
                    "voice" => {
                        let on = !voice_on(app);
                        let status = set_voice(app.clone(), on);
                        let _ = app.emit("brenda://voice-status", status);
                    }
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
                            let _ = item.0.set_text(visible_label(c.always_visible));
                        }
                        let _ = app.emit("brenda://always-visible", c.always_visible);
                    }
                    "signout" => {
                        voice::stop_speaking(app);
                        let state = app.state::<AppState>();
                        let mut c = state.config.lock().unwrap();
                        c.token = None;
                        c.workspace_slug = None;
                        c.workspace_name = None;
                        c.display_name = None;
                        save_config(app, &c);
                        let _ = app.emit("brenda://signed-out", ());
                    }
                    "quit" => {
                        voice::stop_speaking(app); // `afplay` and `say` would otherwise finish the sentence on their own
                        app.exit(0)
                    }
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(drag) = event {
                files::on_drag(window.app_handle(), drag, window.scale_factor().unwrap_or(1.0));
            }
        })
        .invoke_handler(tauri::generate_handler![get_config, voice_status, set_voice, speak, stop_speaking, set_base_url, sign_out, api, link_start, link_poll, open_in_browser, focus_notch, island::set_island_rect, island::menu_bar_height, island::debug_log, files::upload_dropped])
        .build(tauri::generate_context!())
        .expect("error while running Brenda")
        .run(|app, event| {
            // However the app ends (Cmd+Q, logging out, the tray's Quit), her voice ends with it: a spawned `afplay` or
            // `say` is not killed with its parent and would finish the reply on its own (review, 7 October 2026).
            if let tauri::RunEvent::Exit = event {
                voice::stop_speaking(app);
            }
        });
}
