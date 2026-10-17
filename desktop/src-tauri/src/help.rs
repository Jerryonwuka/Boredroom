//! One clear setup (owner report, 12 October 2026: "how do I turn on the features so that I can be able to look through
//! my documents and summarise them and maybe open up"; "when I turned this setting on, I stopped seeing my Brenda";
//! companion2-spec A).
//!
//! The notch shows ONE card, "Let Brenda help on this Mac", with three ticks (see my screen, do things, work on my
//! files); its "Turn these on" is the person's own press, and only that turns anything on (`help_setup`, consent 3).
//! Then macOS asks for its own permissions, one at a time, each from a press too: Screen Recording and Accessibility
//! (`look.rs`, `act.rs`), Finder (`help_request_finder`) and the Documents, Desktop and Downloads folders
//! (`help_request_folders`). System Settings opens only at a fixed privacy pane (`help_open_privacy`).
//!
//! Setup is not a task and never does anything else: nothing here acts on the Mac, and a web press, a reply's "Set up"
//! or "Turn it on" and the tray only open the card. Turning things off is always immediate and needs no press. The
//! tray's words (M.3) and the companion's (M.5) are here too.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

use crate::{act, companion, filework, look, ApiError};

/// The privacy panes setup may open, and nothing else (companion2-spec I.2).
pub const PRIVACY_PANES: &[(&str, &str)] = &[
    ("screen", "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"),
    ("accessibility", "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"),
    ("automation", "x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"),
    ("files", "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"),
];

/// The fixed address of a privacy pane.
pub fn privacy_url(pane: &str) -> Option<&'static str> {
    PRIVACY_PANES.iter().find(|(p, _)| *p == pane).map(|(_, u)| *u)
}

/// The folders setup asks macOS about, in order.
pub const SETUP_FOLDERS: &[&str] = &["documents", "desktop", "downloads"];

// ---- the setup press (pure) -------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SetupState {
    pub press: bool,
    pub signed_in: bool,
    pub supported: bool,
    /// Screen help is available in this workspace (the page's last word, fresh).
    pub available: bool,
    /// Doing things and file work are allowed in this workspace.
    pub act_available: bool,
    /// Screen help is on now (consent 2 or 3).
    pub look_on: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SetupError {
    NotAPress,
    SignedOut,
    Unsupported,
    NotAvailable,
    ActNotAvailable,
    NeedsLook,
}

impl SetupError {
    pub fn api(self) -> ApiError {
        let (message, code) = match self {
            SetupError::NotAPress => ("Press the button to turn this on.", "HELP_NOT_A_PRESS"),
            SetupError::SignedOut => ("Sign in first.", "HELP_SIGNED_OUT"),
            SetupError::Unsupported => ("Screen help needs macOS 14 Sonoma or later.", "LOOK_UNSUPPORTED"),
            SetupError::NotAvailable => ("Screen help isn't on in this workspace.", "LOOK_NOT_AVAILABLE"),
            SetupError::ActNotAvailable => ("Doing things on your Mac isn't on in this workspace.", "ACT_NOT_AVAILABLE"),
            SetupError::NeedsLook => ("Seeing your screen needs to be on for that.", "HELP_NEEDS_LOOK"),
        };
        ApiError { status: 0, message: message.into(), code: Some(code.into()) }
    }
}

/// What a press on "Turn these on" turns on (companion2-spec I.2 `help_setup`): only from the person's real press,
/// signed in, on a supported Mac, where the workspace allows it; doing things and file work need seeing the screen
/// (on already, or ticked now). It never turns anything off.
pub fn setup_plan(st: &SetupState, look: bool, mac: bool, files: bool) -> Result<(bool, bool, bool), SetupError> {
    if !st.press {
        return Err(SetupError::NotAPress);
    }
    if !st.signed_in {
        return Err(SetupError::SignedOut);
    }
    if !st.supported {
        return Err(SetupError::Unsupported);
    }
    if !st.available {
        return Err(SetupError::NotAvailable);
    }
    if (mac || files) && !st.act_available {
        return Err(SetupError::ActNotAvailable);
    }
    if (mac || files) && !look && !st.look_on {
        return Err(SetupError::NeedsLook);
    }
    Ok((look, mac, files))
}

/// What a folder probe found: macOS let Brenda read it (granted), refused (denied), or something else (unknown).
pub fn probe_folder(path: &std::path::Path) -> &'static str {
    match std::fs::read_dir(path).and_then(|mut rd| rd.next().transpose().map(|_| ())) {
        Ok(()) => "granted",
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(1) => "denied",
        Err(_) => "unknown",
    }
}

/// Asks macOS about each folder in order (it shows its own question once per folder), over an injectable map so the
/// tests use temp folders only.
pub fn probe_folders(map: &[(&str, PathBuf)]) -> Vec<(String, &'static str)> {
    map.iter().map(|(k, p)| (k.to_string(), probe_folder(p))).collect()
}

/// The folders the page asked about, checked: a subset of Documents, Desktop and Downloads, each once, in setup's order.
pub fn folders_asked(which: &[String]) -> Option<Vec<&'static str>> {
    if which.is_empty() || which.len() > SETUP_FOLDERS.len() || which.iter().any(|w| !SETUP_FOLDERS.contains(&w.as_str())) {
        return None;
    }
    Some(SETUP_FOLDERS.iter().copied().filter(|f| which.iter().any(|w| w == f)).collect())
}

// ---- words (M.3, M.5) -------------------------------------------------------------------------------------------------

/// The companion's status in the tray's form (M.5).
pub fn companion_tray_words(why: &str) -> &'static str {
    match why {
        "setting_off" => "Hidden: switched off",
        "screen_help_off" => "Hidden: seeing your screen is off",
        "signed_out" => "Hidden: signed out",
        "locked" => "Hidden: Mac locked",
        "call" => "Hidden during a call",
        "sharing" => "Hidden: screen may be shared",
        "screenshot_tool" => "Hidden: taking a screenshot",
        "mirrored" => "Hidden: screen mirrored",
        "full_screen" => "Hidden: an app is full screen",
        _ => "By your pointer",
    }
}

// ---- commands ---------------------------------------------------------------------------------------------------------

#[derive(Serialize)]
pub struct HelpStatus {
    pub look: look::LookStatus,
    pub act: act::ActStatus,
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn changed(app: &AppHandle) {
    companion::wake(app);
    crate::refresh_tray(app);
    let _ = app.emit("brenda://look-status", look::status(app));
    let _ = app.emit("brenda://act", act::ActEvent::Status(act::status(app)));
}

/// "Turn these on" (A.1): the person's press turns on what they ticked, with no prompt of any kind; then she greets by
/// the pointer.
#[tauri::command]
pub async fn help_setup(app: AppHandle, look: bool, mac: bool, files: bool) -> Result<HelpStatus, ApiError> {
    let st = {
        let s = look::status(&app);
        let signed_in = app.state::<crate::AppState>().config.lock().unwrap().token.is_some();
        SetupState { press: act::real_press(&app), signed_in, supported: s.supported, available: s.available, act_available: look::act_available(&app), look_on: look::screen_help_on(&app) }
    };
    let (on_look, on_mac, on_files) = setup_plan(&st, look, mac, files).map_err(SetupError::api)?;
    if on_look {
        look::set_on_with(&app, true, 3);
    }
    crate::update_config(&app, |c| {
        if on_mac && !c.use_mac {
            c.use_mac = true;
            c.use_mac_at = Some(now_unix_ms());
        }
        if on_files && !c.file_work {
            c.file_work = true;
            c.file_work_at = Some(now_unix_ms());
        }
    });
    if look::screen_help_on(&app) {
        companion::greet(&app);
    }
    changed(&app);
    Ok(HelpStatus { look: look::status(&app), act: act::status(&app) })
}

fn files_on(app: &AppHandle) -> bool {
    app.state::<crate::AppState>().config.lock().unwrap().file_work
}

fn not_a_press() -> ApiError {
    SetupError::NotAPress.api()
}

fn files_off() -> ApiError {
    ApiError { status: 0, message: "Turn on “Work on my files” first.".into(), code: Some("ACT_FILES_OFF".into()) }
}

/// The Finder step (A.1): one harmless question to Finder, so macOS asks its Automation question now (10 s).
#[tauri::command]
pub async fn help_request_finder(app: AppHandle) -> Result<act::ActStatus, ApiError> {
    if !act::real_press(&app) {
        return Err(not_a_press());
    }
    if !files_on(&app) {
        return Err(files_off());
    }
    let granted = tauri::async_runtime::spawn_blocking(filework::finder_probe).await.unwrap_or(false);
    crate::update_config(&app, |c| c.finder_answer = Some(if granted { "granted" } else { "denied" }.into()));
    changed(&app);
    Ok(act::status(&app))
}

/// The folders step (A.1): each folder in order, read once so macOS asks its question; what it said is kept.
#[tauri::command]
pub async fn help_request_folders(app: AppHandle, which: Vec<String>) -> Result<act::ActStatus, ApiError> {
    if !act::real_press(&app) {
        return Err(not_a_press());
    }
    if !files_on(&app) {
        return Err(files_off());
    }
    let asked = folders_asked(&which).ok_or_else(|| ApiError { status: 0, message: "Those aren't folders I ask about.".into(), code: Some("HELP_FOLDERS".into()) })?;
    let home = filework::home().ok_or_else(|| ApiError { status: 0, message: "I couldn't find your home folder.".into(), code: Some("HELP_FOLDERS".into()) })?;
    let map: Vec<(&str, PathBuf)> = asked.iter().map(|k| (*k, crate::folder::NamedFolder::of(k).map(|f| f.dir(&home)).unwrap_or_default())).collect();
    let found = tauri::async_runtime::spawn_blocking(move || probe_folders(&map)).await.unwrap_or_default();
    crate::update_config(&app, |c| {
        let f = c.folders.get_or_insert_with(Default::default);
        for (k, v) in &found {
            if *v == "unknown" {
                continue;
            }
            let slot = match k.as_str() {
                "documents" => &mut f.documents,
                "desktop" => &mut f.desktop,
                _ => &mut f.downloads,
            };
            *slot = Some(v.to_string());
        }
    });
    changed(&app);
    Ok(act::status(&app))
}

/// System Settings at a fixed privacy pane (the page names the pane, never an address).
#[tauri::command]
pub async fn help_open_privacy(app: AppHandle, pane: String) -> Result<(), ApiError> {
    use tauri_plugin_opener::OpenerExt;
    let url = privacy_url(&pane).ok_or_else(|| ApiError { status: 0, message: "That isn't a setting I open.".into(), code: Some("HELP_PANE".into()) })?;
    if cfg!(target_os = "macos") {
        let _ = app.opener().open_url(url, None::<&str>);
    }
    Ok(())
}

use tauri::Manager;

#[cfg(test)]
mod tests {
    use super::*;

    fn ok_state() -> SetupState {
        SetupState { press: true, signed_in: true, supported: true, available: true, act_available: true, look_on: false }
    }

    /// Section 0.5: setup turns anything on only from the person's real press, and never acts.
    #[test]
    fn setup_needs_a_real_press() {
        let mut st = ok_state();
        st.press = false;
        assert_eq!(setup_plan(&st, true, true, true), Err(SetupError::NotAPress));
        assert_eq!(setup_plan(&ok_state(), true, true, true), Ok((true, true, true)));
        assert_eq!(setup_plan(&ok_state(), false, true, false), Err(SetupError::NeedsLook), "doing things needs seeing the screen");
        let mut on = ok_state();
        on.look_on = true;
        assert_eq!(setup_plan(&on, false, true, true), Ok((false, true, true)), "seeing is on already");
        let mut st = ok_state();
        st.act_available = false;
        assert_eq!(setup_plan(&st, true, false, false), Ok((true, false, false)));
        assert_eq!(setup_plan(&st, true, true, false), Err(SetupError::ActNotAvailable));
        for (f, e) in [(&(|s: &mut SetupState| s.signed_in = false) as &dyn Fn(&mut SetupState), SetupError::SignedOut), (&|s: &mut SetupState| s.supported = false, SetupError::Unsupported), (&|s: &mut SetupState| s.available = false, SetupError::NotAvailable)] {
            let mut st = ok_state();
            f(&mut st);
            assert_eq!(setup_plan(&st, true, false, false), Err(e));
        }
        assert_eq!(SetupError::NeedsLook.api().message, "Seeing your screen needs to be on for that.");
        // Nothing here clicks, types, opens or posts: the file names no executor, opener or event.
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/help.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        for word in ["run_on_mac", "WorkspaceOpener", "CGEvent", "act::asking", "/assistant/act", "act_mode"] {
            assert!(!code.contains(word), "help.rs mentions {word}");
        }
    }

    #[test]
    fn folders_probe_records() {
        let d = crate::folder::tests::scratch("probe");
        std::fs::create_dir_all(d.join("Documents")).unwrap();
        std::fs::write(d.join("Documents/a.txt"), "x").unwrap();
        std::fs::create_dir_all(d.join("Desktop")).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::create_dir_all(d.join("Locked")).unwrap();
            std::fs::set_permissions(d.join("Locked"), std::fs::Permissions::from_mode(0o000)).unwrap();
        }
        let map = vec![("documents", d.join("Documents")), ("desktop", d.join("Desktop")), ("downloads", d.join("Missing"))];
        assert_eq!(probe_folders(&map), vec![("documents".to_string(), "granted"), ("desktop".to_string(), "granted"), ("downloads".to_string(), "unknown")]);
        #[cfg(unix)]
        {
            assert_eq!(probe_folder(&d.join("Locked")), "denied");
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(d.join("Locked"), std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(folders_asked(&["downloads".into(), "documents".into()]), Some(vec!["documents", "downloads"]), "setup's order");
        assert_eq!(folders_asked(&["library".into()]), None);
        assert_eq!(folders_asked(&[]), None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn open_privacy_fixed_urls() {
        assert_eq!(privacy_url("screen"), Some("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"));
        assert_eq!(privacy_url("accessibility"), Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"));
        assert_eq!(privacy_url("automation"), Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"));
        assert_eq!(privacy_url("files"), Some("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"));
        assert_eq!(privacy_url("x-apple.systempreferences:com.apple.preference.security?Privacy_FullDisk"), None);
        assert_eq!(privacy_url("general"), None);
        assert_eq!(PRIVACY_PANES.len(), 4);
    }

    #[test]
    fn companion_words() {
        assert_eq!(companion_tray_words("idle"), "By your pointer");
        assert_eq!(companion_tray_words("typing"), "By your pointer");
        assert_eq!(companion_tray_words("screen_help_off"), "Hidden: seeing your screen is off");
        assert_eq!(companion_tray_words("call"), "Hidden during a call");
        assert_eq!(companion_tray_words("full_screen"), "Hidden: an app is full screen");
    }
}
