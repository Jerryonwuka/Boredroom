//! Brenda for Boredroom, the desktop notch (owner decision, 3 October 2026).
//!
//! The Rust side is deliberately small. It keeps the sign-in (Boredroom's address, the desktop session token and the
//! workspace) in the app's config folder, makes every HTTP call to Boredroom so the token never sits in the web view's
//! storage, places the window as a notch at the top centre of the screen, and puts Brenda in the tray. Everything the
//! person sees is in `src/` (plain HTML, CSS and JavaScript).
//!
//! The computer is only ever acted on by opening a Boredroom link in the browser. No files, keyboard, screen or
//! microphone access in this version.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State, WebviewWindow,
};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_BASE_URL: &str = "https://boredroom.cc";

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    base_url: Option<String>,
    token: Option<String>,
    workspace_slug: Option<String>,
    workspace_name: Option<String>,
    display_name: Option<String>,
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
}

struct AppState {
    config: Mutex<Config>,
    http: reqwest::Client,
}

#[derive(Serialize)]
struct ApiError {
    status: u16,
    message: String,
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
        return Err(ApiError { status: 400, message: "Only Boredroom API paths are allowed.".into() });
    }
    let url = format!("{base}{path}");
    let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| ApiError { status: 400, message: "Unknown method.".into() })?;
    let mut req = state.http.request(m, &url).header("accept", "application/json").header("user-agent", format!("Brenda desktop/{} ({})", env!("CARGO_PKG_VERSION"), std::env::consts::OS));
    if with_token {
        if let Some(t) = token {
            req = req.bearer_auth(t);
        } else {
            return Err(ApiError { status: 401, message: "Not signed in.".into() });
        }
    }
    if let Some(b) = body {
        req = req.json(&b);
    }
    let res = req.send().await.map_err(|e| ApiError { status: 0, message: format!("Cannot reach Boredroom: {e}") })?;
    let status = res.status().as_u16();
    let value: Value = res.json().await.unwrap_or(Value::Null);
    if status >= 400 {
        let message = value.get("message").and_then(|m| m.as_str()).unwrap_or("Request failed.").to_string();
        return Err(ApiError { status, message });
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

/// The notch: top centre of the screen the window is on, at the size the page asks for.
#[tauri::command]
fn set_notch_size(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    place(&window, width, height).map_err(|e| e.to_string())
}

fn place(window: &WebviewWindow, width: f64, height: f64) -> tauri::Result<()> {
    window.set_size(LogicalSize::new(width, height))?;
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let origin = monitor.position().to_logical::<f64>(scale);
        window.set_position(LogicalPosition::new(origin.x + (size.width - width) / 2.0, origin.y))?;
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory); // no Dock icon: Brenda lives in the notch and the menu bar

            let handle = app.handle().clone();
            let config = load_config(&handle);
            app.manage(AppState {
                config: Mutex::new(config),
                http: reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build().expect("http client"),
            });

            if let Some(window) = app.get_webview_window("notch") {
                let _ = place(&window, 220.0, 44.0);
                let _ = window.set_always_on_top(true);
            }

            let open = MenuItem::with_id(app, "open", "Open Boredroom", true, None::<&str>)?;
            let toggle = MenuItem::with_id(app, "toggle", "Hide Brenda", true, None::<&str>)?;
            let signout = MenuItem::with_id(app, "signout", "Sign out of this computer", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Brenda", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(app, &[&open, &toggle, &sep, &signout, &quit])?;
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
                        let path = c.workspace_slug.map(|s| format!("/app/{s}")).unwrap_or_else(|| "/app".into());
                        let _ = app.opener().open_url(format!("{}{}", base_url(&c), path), None::<&str>);
                    }
                    "toggle" => {
                        if let Some(w) = app.get_webview_window("notch") {
                            let visible = w.is_visible().unwrap_or(true);
                            let _ = if visible { w.hide() } else { w.show() };
                            let _ = toggle_item.set_text(if visible { "Show Brenda" } else { "Hide Brenda" });
                        }
                    }
                    "signout" => {
                        let state = app.state::<AppState>();
                        let mut c = state.config.lock().unwrap();
                        c.token = None;
                        c.workspace_slug = None;
                        c.workspace_name = None;
                        c.display_name = None;
                        save_config(app, &c);
                        let _ = app.emit("brenda://signed-out", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_config, set_base_url, sign_out, api, link_start, link_poll, open_in_browser, set_notch_size])
        .run(tauri::generate_context!())
        .expect("error while running Brenda");
}
