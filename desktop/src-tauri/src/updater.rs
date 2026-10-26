//! Updates (owner request, 24 October 2026): Boredroom keeps itself up to date, quietly.
//!
//! About a minute after it starts, and then once a day, it asks the release feed (`plugins.updater.endpoints` in
//! tauri.conf.json: `latest.json` on the public releases repo) whether there is a newer Boredroom. If there is, it
//! downloads it in the background; the updater plugin checks its minisign signature against the public key in
//! tauri.conf.json (and the version the signature was made for) before the bytes are kept. Nothing else happens until
//! the person chooses "Restart to update" in the menu bar or on the notch's card: only then is the app replaced and
//! restarted. It never restarts by itself, and a failed check or download is only logged. Boredroom › Check for Updates…
//! asks at once and says what it found (`check_now`).
//!
//! Never in a development build (`tauri dev`), unless `BRENDA_UPDATER_DEV=1`; never while it runs from the disk image
//! or from where macOS put it to check it (App Translocation), since it couldn't replace itself there.

use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime},
};
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem, PredefinedMenuItem},
    AppHandle, Emitter, Manager, Wry,
};
use tauri_plugin_updater::{Update, UpdaterExt};

/// No network for the first minute: it doesn't compete with linking or loading the speech model.
const FIRST_CHECK: Duration = Duration::from_secs(60);
/// The clock is looked at every hour, so a Mac that slept through the day still checks soon after it wakes.
const TICK: Duration = Duration::from_secs(60 * 60);
const EVERY: Duration = Duration::from_secs(24 * 60 * 60);
/// A check that failed (offline, the feed not there yet) is tried again an hour later rather than the next day.
const RETRY: Duration = Duration::from_secs(60 * 60);

pub const EVENT: &str = "brenda://update";

/// What is downloaded and waiting for the person's click.
#[derive(Default)]
pub struct Updates {
    ready: Mutex<Option<(Update, Vec<u8>)>>,
    next_check: Mutex<Option<SystemTime>>,
    installing: AtomicBool,
    fetching: AtomicBool,
}

/// The tray's "Restart to update" item and its separator: made at start, added to the menu only once an update is ready.
pub struct UpdateMenu {
    pub menu: Menu<Wry>,
    pub item: MenuItem<Wry>,
    pub sep: PredefinedMenuItem<Wry>,
    pub shown: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub notes: Option<String>,
}

#[derive(Clone, Serialize)]
struct UpdateError {
    error: &'static str,
}

const INSTALL_FAILED: &str = "Couldn't update. Download Boredroom again from boredroom.cc/download.";

fn enabled() -> bool {
    !cfg!(debug_assertions) || std::env::var("BRENDA_UPDATER_DEV").as_deref() == Ok("1")
}

/// Why this copy can't replace itself, from where it runs: the disk image, or App Translocation (opened from Downloads
/// without being moved to Applications first).
pub fn install_path_problem(exe: &str) -> Option<&'static str> {
    if exe.contains("/AppTranslocation/") {
        Some("Boredroom is running from a temporary place macOS chose; move it to Applications to get updates")
    } else if exe.starts_with("/Volumes/") {
        Some("Boredroom is running from the disk image; drag it to Applications to get updates")
    } else {
        None
    }
}

fn due(next: Option<SystemTime>, now: SystemTime) -> bool {
    next.is_none_or(|n| now >= n)
}

/// Starts the quiet checks (from `run()`'s setup, after the tray is built).
pub fn start(app: &AppHandle) {
    if !enabled() {
        return;
    }
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    if let Some(why) = install_path_problem(&exe) {
        eprintln!("Boredroom: updates are off: {why}");
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        loop {
            let now = SystemTime::now();
            let next = *app.state::<Updates>().next_check.lock().unwrap();
            if due(next, now) {
                let wait = match check(&app).await {
                    Ok(()) => EVERY,
                    Err(e) => {
                        eprintln!("Boredroom: update check: {e}");
                        RETRY
                    }
                };
                *app.state::<Updates>().next_check.lock().unwrap() = Some(SystemTime::now() + wait);
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

async fn check(app: &AppHandle) -> Result<(), String> {
    if app.state::<Updates>().ready.lock().unwrap().is_some() {
        return Ok(()); // one is already waiting for the person's click
    }
    let Some(update) = find(app).await? else {
        return Ok(());
    };
    fetch(app, update).await
}

/// Asks the feed whether there is a newer version.
async fn find(app: &AppHandle) -> Result<Option<Update>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    updater.check().await.map_err(|e| e.to_string())
}

/// Downloads an update in the background and offers it.
async fn fetch(app: &AppHandle, update: Update) -> Result<(), String> {
    if app.state::<Updates>().installing.load(Ordering::SeqCst) || app.state::<Updates>().fetching.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    // `download` checks the signature before it returns the bytes; `install` checks it again.
    let bytes = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string());
    app.state::<Updates>().fetching.store(false, Ordering::SeqCst);
    let bytes = bytes?;
    let info = UpdateInfo { version: update.version.clone(), notes: update.body.clone() };
    *app.state::<Updates>().ready.lock().unwrap() = Some((update, bytes));
    show_in_tray(app, &info.version);
    let _ = app.emit_to("notch", EVENT, &info);
    Ok(())
}

fn show_in_tray(app: &AppHandle, version: &str) {
    let Some(m) = app.try_state::<UpdateMenu>() else { return };
    let _ = m.item.set_text(format!("Restart to update to Boredroom {version}"));
    let _ = m.item.set_enabled(true);
    if !m.shown.swap(true, Ordering::SeqCst) {
        let items: [&dyn IsMenuItem<Wry>; 2] = [&m.item, &m.sep];
        if m.menu.insert_items(&items, 0).is_err() {
            m.shown.store(false, Ordering::SeqCst);
        }
    }
}

/// What is downloaded and ready, for the notch when it loads.
pub fn ready(app: &AppHandle) -> Option<UpdateInfo> {
    let s = app.try_state::<Updates>()?;
    let r = s.ready.lock().unwrap();
    r.as_ref().map(|(u, _)| UpdateInfo { version: u.version.clone(), notes: u.body.clone() })
}

/// The person chose "Restart to update" (the tray, the notch or the menu): stop what the assistant is doing, replace the
/// app, restart (the window opens again if it was open).
pub fn install(app: &AppHandle) {
    let Some(s) = app.try_state::<Updates>() else { return };
    if s.installing.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some((update, bytes)) = s.ready.lock().unwrap().take() else {
        s.installing.store(false, Ordering::SeqCst);
        return;
    };
    crate::act::stop(app, "update");
    crate::jobs::stop(app, "update");
    crate::voice::stop_speaking(app);
    if let Some(m) = app.try_state::<UpdateMenu>() {
        let _ = m.item.set_text("Updating Boredroom…");
        let _ = m.item.set_enabled(false);
    }
    let app = app.clone();
    // Replacing the bundle can ask for an administrator's password (an Applications folder the person can't write to),
    // so it runs off the main thread.
    tauri::async_runtime::spawn_blocking(move || match update.install(&bytes) {
        Ok(()) => {
            crate::dashboard::note_restart(&app);
            app.request_restart()
        }
        Err(e) => {
            eprintln!("Boredroom: update install: {e}");
            let version = update.version.clone();
            let s = app.state::<Updates>();
            *s.ready.lock().unwrap() = Some((update, bytes));
            s.installing.store(false, Ordering::SeqCst);
            show_in_tray(&app, &version);
            let _ = app.emit_to("notch", EVENT, UpdateError { error: INSTALL_FAILED });
        }
    });
}

/// What Check for Updates… says (pure, tested).
#[derive(Debug, PartialEq)]
pub enum Outcome {
    Dev,
    WrongPlace,
    Ready(String),
    Downloading(String),
    UpToDate(String),
    Failed,
}

/// The state a manual check found.
pub struct ManualState<'a> {
    pub enabled: bool,
    pub path_problem: bool,
    pub ready: Option<&'a str>,
    /// The feed's answer: Ok(Some(newer version)), Ok(None) for none newer, Err for a failed check. Unused when the
    /// answer comes before the feed is asked.
    pub found: Result<Option<&'a str>, ()>,
}

pub fn manual_check_outcome(s: ManualState) -> Outcome {
    if !s.enabled {
        return Outcome::Dev;
    }
    if s.path_problem {
        return Outcome::WrongPlace;
    }
    if let Some(v) = s.ready {
        return Outcome::Ready(v.into());
    }
    match s.found {
        Ok(Some(v)) => Outcome::Downloading(v.into()),
        Ok(None) => Outcome::UpToDate(env!("CARGO_PKG_VERSION").into()),
        Err(()) => Outcome::Failed,
    }
}

/// The alert for an outcome: (title, message, buttons).
pub fn outcome_words(o: &Outcome, name: &str) -> (String, String, Vec<String>) {
    let ok = vec!["OK".to_string()];
    match o {
        Outcome::Dev => ("Updates are off in development builds.".into(), String::new(), ok),
        Outcome::WrongPlace => ("Move Boredroom to Applications to get updates.".into(), String::new(), ok),
        Outcome::Ready(v) => (format!("Boredroom {v} is ready"), format!("Restart Boredroom to update. Anything {name} is doing now stops."), vec!["Restart to Update".into(), "Later".into()]),
        Outcome::Downloading(v) => (format!("Downloading Boredroom {v}"), "You'll see Restart to update in the menu bar when it's ready.".into(), ok),
        Outcome::UpToDate(v) => ("You're up to date".into(), format!("Boredroom {v} is the latest version."), ok),
        Outcome::Failed => ("Couldn't check for updates".into(), "Check your internet connection and try again.".into(), ok),
    }
}

fn say(app: &AppHandle, o: Outcome) {
    let (title, message, buttons) = outcome_words(&o, &crate::companion::name(app));
    let ready = matches!(o, Outcome::Ready(_));
    let app2 = app.clone();
    crate::appmenu::alert(app, crate::appmenu::Alert { title, message, buttons, destructive: None, suppress: false }, move |i, _| {
        if ready && i == 0 {
            install(&app2);
        }
    });
}

/// Boredroom › Check for Updates… (the person's own press): asks the feed now and says what it found.
pub fn check_now(app: &AppHandle) {
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default();
    let ready = self::ready(app).map(|u| u.version);
    let before = ManualState { enabled: enabled(), path_problem: install_path_problem(&exe).is_some(), ready: ready.as_deref(), found: Err(()) };
    if !before.enabled || before.path_problem || before.ready.is_some() {
        return say(app, manual_check_outcome(before));
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let found = find(&app).await;
        let version = found.as_ref().ok().and_then(|u| u.as_ref().map(|u| u.version.clone()));
        let o = manual_check_outcome(ManualState { enabled: true, path_problem: false, ready: None, found: found.as_ref().map(|_| version.as_deref()).map_err(|_| ()) });
        say(&app, o);
        if let Ok(Some(update)) = found {
            *app.state::<Updates>().next_check.lock().unwrap() = Some(SystemTime::now() + EVERY);
            if let Err(e) = fetch(&app, update).await {
                eprintln!("Boredroom: update download: {e}");
            }
        }
    });
}

#[tauri::command]
pub fn update_status(app: AppHandle) -> Option<UpdateInfo> {
    ready(&app)
}

#[tauri::command]
pub fn update_install(app: AppHandle) {
    install(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_copy_that_can_replace_itself_updates() {
        assert!(install_path_problem("/Applications/Boredroom.app/Contents/MacOS/brenda-desktop").is_none());
        assert!(install_path_problem("/Users/a/Applications/Boredroom.app/Contents/MacOS/brenda-desktop").is_none());
        assert!(install_path_problem("/Volumes/Boredroom/Boredroom.app/Contents/MacOS/brenda-desktop").is_some());
        assert!(install_path_problem("/private/var/folders/x/T/AppTranslocation/1234/d/Boredroom.app/Contents/MacOS/brenda-desktop").is_some());
    }

    #[test]
    fn checks_once_a_day() {
        let t = SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
        assert!(due(None, t));
        assert!(!due(Some(t + EVERY), t + TICK));
        assert!(due(Some(t + EVERY), t + EVERY));
        assert!(due(Some(t), t + RETRY));
    }

    #[test]
    fn check_for_updates_says_what_it_found() {
        let st = |enabled, path_problem, ready, found| manual_check_outcome(ManualState { enabled, path_problem, ready, found });
        assert_eq!(st(false, false, None, Err(())), Outcome::Dev);
        assert_eq!(st(true, true, None, Err(())), Outcome::WrongPlace);
        assert_eq!(st(true, false, Some("0.3.0"), Err(())), Outcome::Ready("0.3.0".into()));
        assert_eq!(st(true, false, None, Ok(Some("0.3.0"))), Outcome::Downloading("0.3.0".into()));
        assert_eq!(st(true, false, None, Ok(None)), Outcome::UpToDate("0.2.0".into()));
        assert_eq!(st(true, false, None, Err(())), Outcome::Failed);
        let (t, m, b) = outcome_words(&Outcome::Ready("0.3.0".into()), "Max");
        assert_eq!((t.as_str(), m.as_str()), ("Boredroom 0.3.0 is ready", "Restart Boredroom to update. Anything Max is doing now stops."));
        assert_eq!(b, vec!["Restart to Update".to_string(), "Later".to_string()]);
        assert_eq!(outcome_words(&Outcome::UpToDate("0.2.0".into()), "Brenda").1, "Boredroom 0.2.0 is the latest version.");
        assert_eq!(INSTALL_FAILED, "Couldn't update. Download Boredroom again from boredroom.cc/download.");
    }

    #[test]
    fn the_config_carries_a_signed_feed() {
        let conf: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let u = &conf["plugins"]["updater"];
        assert!(u["pubkey"].as_str().is_some_and(|k| k.len() > 100), "the updater's public key is in tauri.conf.json");
        assert_eq!(u["requireSignedVersion"], serde_json::json!(true));
        let endpoints = u["endpoints"].as_array().unwrap();
        assert!(!endpoints.is_empty());
        for e in endpoints {
            assert!(e.as_str().unwrap().starts_with("https://"), "the feed is fetched over https");
        }
        assert_eq!(conf["bundle"]["createUpdaterArtifacts"], serde_json::json!(true));
    }
}
