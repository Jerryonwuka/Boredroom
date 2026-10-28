//! The Mac's direct actions (owner brief, 12 October 2026: "Direct macOS actions, never clicks: open apps/files/folders/
//! web pages, reveal in Finder; switch/hide/minimise/arrange windows; quit an app (the app's own save prompt protects
//! unsaved work); volume/mute; screenshot to Desktop; copy text; type into the focused field (never pressing
//! Return/Send); Spotlight file search"; helpers-spec C, P.5).
//!
//! What this file promises, and how:
//! - Everything the front desk does to the Mac goes through the `Mac` trait. `RealMac` is AppKit through `msg_send!` on
//!   classes found by name, Accessibility through `ax.rs`, and `osascript`/`networksetup` as fixed argument vectors with
//!   a time limit (no shell, nothing the person or a model wrote is ever part of a command). It is built only in the
//!   command entry points of `front.rs` and `jobs.rs` (a test keeps it so); every test uses `RecordingMac`, so no test
//!   opens, hides, quits, types, changes the volume or Wi-Fi, takes a picture or empties the Trash.
//! - Nothing here clicks. Typing is `ax::insert_text`, and only when that changed nothing, `input::type_into_focus`
//!   (characters only, never Return, Enter or Tab).
//! - Quitting is polite (`terminate`, never `forceTerminate`): the app's own save prompt protects unsaved work.

use std::path::{Path, PathBuf};

use crate::ax::FocusedText;
use crate::look::Bounds;

/// A running app as the front desk sees it.
#[derive(Clone, Debug, PartialEq)]
pub struct RunningApp {
    pub pid: i32,
    pub name: String,
    pub bundle_id: Option<String>,
    pub path: Option<PathBuf>,
    /// An ordinary app (in the Dock), not a helper or a menu-bar extra.
    pub regular: bool,
    pub hidden: bool,
}

/// Every way the front desk touches the Mac (P.5).
pub trait Mac {
    fn own_pid(&self) -> i32;
    fn running_apps(&self) -> Vec<RunningApp>;
    /// The app the person is in (L.1), even when Brenda's notch is in front.
    fn person_front(&self) -> Option<RunningApp>;
    /// Gives the front back to `pid`; whether it came back (L.1).
    fn hand_back(&self, pid: i32) -> bool;
    fn open_path(&mut self, p: &Path) -> bool;
    fn open_url(&mut self, u: &str) -> bool;
    /// `u` in the browser at `app` (owner report, 28 October 2026: "open a new tab in Brave").
    fn open_url_in(&mut self, u: &str, app: &Path) -> bool;
    /// The app macOS opens web pages with.
    fn default_browser(&self) -> Option<PathBuf>;
    /// ⌘T (or ⌘N for a window) to `pid`, only while `pid` is the front app (`input::browser_keys`); whether it went.
    fn browser_keys(&self, pid: i32, window: bool) -> bool;
    fn reveal(&mut self, p: &Path) -> bool;
    fn activate(&self, pid: i32) -> bool;
    fn hide(&self, pid: i32) -> bool;
    #[allow(dead_code)]
    fn unhide(&self, pid: i32) -> bool;
    /// `[NSApp hideOtherApplications:]`: every app but Brenda.
    fn hide_all_others(&self) -> bool;
    /// `[NSApp unhideAllApplications:]`.
    fn show_all(&self) -> bool;
    /// Polite quit (`terminate`).
    fn terminate(&self, pid: i32) -> bool;
    fn is_running(&self, pid: i32) -> bool;
    fn window_frame(&self, pid: i32) -> Option<Bounds>;
    fn set_window_frame(&self, pid: i32, frame: Bounds) -> bool;
    fn minimise(&self, pid: i32) -> bool;
    /// Minimises the Boredroom window (owner request, 24 October 2026).
    fn minimise_own(&self) -> bool {
        false
    }
    /// The visible frame (no menu bar, no Dock) of the display holding `p`.
    fn visible_frame_for(&self, p: (f64, f64)) -> Option<Bounds>;
    fn pointer(&self) -> Option<(f64, f64)>;
    /// (level 0–100, muted).
    fn volume(&self) -> Option<(u8, bool)>;
    fn set_volume(&self, level: u8) -> bool;
    fn set_muted(&self, muted: bool) -> bool;
    /// A PNG of the display holding `at` (Brenda's own windows left out).
    fn screenshot_png(&self, at: (f64, f64)) -> Result<Vec<u8>, String>;
    fn pasteboard_set(&self, text: &str) -> bool;
    fn focused_text(&self) -> Option<FocusedText>;
    /// Some(true) when the text went in through Accessibility.
    fn insert_text(&self, text: &str) -> Option<bool>;
    /// The typing fallback (characters only).
    fn type_keys(&self, text: &str, stopped: &dyn Fn() -> bool) -> bool;
    fn secure_input(&self) -> bool;
    fn wifi(&self, on: bool) -> Result<(), MacRefusal>;
    fn empty_trash(&self) -> Result<(), MacRefusal>;
    fn accessibility(&self) -> bool;
    fn screen_recording(&self) -> bool;
    fn sleep_ms(&self, ms: u64);
}

/// Why the Mac said no to Wi-Fi or the Trash (S.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MacRefusal {
    /// `networksetup` wants an administrator.
    WifiAdmin,
    /// No Wi-Fi device.
    NoWifi,
    /// Finder said no (Automation).
    FinderDenied,
    Failed,
}

// ---- pure helpers ------------------------------------------------------------------------------------------------------

/// The new volume (C `volume`): up or down by 12, clamped; or a level set.
pub fn next_volume(now: u8, change: &str, level: u8) -> u8 {
    match change {
        "up" => now.saturating_add(12).min(100),
        "down" => now.saturating_sub(12),
        _ => level.min(100),
    }
}

/// The Wi-Fi device from `networksetup -listallhardwareports` ("Hardware Port: Wi-Fi" then "Device: en0").
pub fn wifi_device(listing: &str) -> Option<String> {
    let mut lines = listing.lines().map(str::trim);
    while let Some(l) = lines.next() {
        let port = l.strip_prefix("Hardware Port:").map(str::trim);
        if port.is_some_and(|p| p.eq_ignore_ascii_case("Wi-Fi") || p.eq_ignore_ascii_case("AirPort")) {
            let dev = lines.next()?.strip_prefix("Device:")?.trim().to_string();
            return (!dev.is_empty() && dev.chars().all(|c| c.is_ascii_alphanumeric())).then_some(dev);
        }
    }
    None
}

/// `output volume of (get volume settings)` and `output muted of …` as `osascript` prints them ("42, false").
pub fn parse_volume(out: &str) -> Option<(u8, bool)> {
    let mut parts = out.trim().split(',').map(str::trim);
    let level: u8 = parts.next()?.parse::<f64>().ok()?.round().clamp(0.0, 100.0) as u8;
    let muted = parts.next().is_some_and(|m| m == "true");
    Some((level, muted))
}

/// The halves and the whole of a visible frame (C `half`, `arrange`, `fill`).
pub fn half_frame(visible: Bounds, side: &str) -> Bounds {
    let w = (visible.w / 2.0).floor();
    match side {
        "left" => Bounds { x: visible.x, y: visible.y, w, h: visible.h },
        "right" => Bounds { x: visible.x + visible.w - w, y: visible.y, w, h: visible.h },
        _ => visible,
    }
}

/// A screenshot's name on the Desktop: "Screenshot 2026-10-12 at 15.04.05.png" (local time).
pub fn screenshot_name(unix: i64) -> String {
    let (y, m, d, h, mi, s) = crate::fileops::local_parts(unix);
    format!("Screenshot {y:04}-{m:02}-{d:02} at {h:02}.{mi:02}.{s:02}.png")
}

// ---- typing and copying (C `type_text`, `copy_selection`) -------------------------------------------------------------

/// Why typing or copying didn't happen (S.5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TextRefusal {
    NoAccessibility,
    /// Nothing that takes text has the keyboard.
    NoBox,
    /// A password box.
    Secure,
    /// One of the apps she never looks at or works in.
    NeverLook(String),
    /// Brenda herself.
    Own,
    NothingSelected,
    Stopped,
    Failed,
}

fn focus_owner(mac: &dyn Mac, f: &FocusedText) -> Option<RunningApp> {
    let pid = f.pid?;
    mac.running_apps().into_iter().find(|a| a.pid == pid).or(Some(RunningApp { pid, name: String::new(), bundle_id: None, path: None, regular: true, hidden: false }))
}

/// The checks before any typing or copying: Accessibility, a focused element, not Brenda, not a never-look or never-act
/// app (`never` answers the app's name when it is one), not a password box.
fn text_target(mac: &dyn Mac, never: &dyn Fn(&RunningApp) -> Option<String>) -> Result<FocusedText, TextRefusal> {
    if !mac.accessibility() {
        return Err(TextRefusal::NoAccessibility);
    }
    let f = mac.focused_text().ok_or(TextRefusal::NoBox)?;
    if let Some(owner) = focus_owner(mac, &f) {
        if owner.pid == mac.own_pid() || owner.bundle_id.as_deref().is_some_and(|b| b.eq_ignore_ascii_case(crate::look::OWN_BUNDLE_ID)) {
            return Err(TextRefusal::Own);
        }
        if let Some(name) = never(&owner) {
            return Err(TextRefusal::NeverLook(name));
        }
    }
    if f.secure() || mac.secure_input() {
        return Err(TextRefusal::Secure);
    }
    Ok(f)
}

/// "Type this into the box I'm in" (C): line breaks and tabs become spaces (never Return, Enter or Tab); inserted at the
/// caret through Accessibility, or, when that changed nothing, typed as characters in chunks with the stop flag between.
pub fn type_text(mac: &dyn Mac, text: &str, never: &dyn Fn(&RunningApp) -> Option<String>, stopped: &dyn Fn() -> bool) -> Result<(), TextRefusal> {
    let f = text_target(mac, never)?;
    if !f.takes_text() {
        return Err(TextRefusal::NoBox);
    }
    let text = crate::input::front_typing(text);
    if stopped() {
        return Err(TextRefusal::Stopped);
    }
    if mac.insert_text(&text) == Some(true) {
        return Ok(());
    }
    if stopped() {
        return Err(TextRefusal::Stopped);
    }
    if mac.type_keys(&text, stopped) {
        Ok(())
    } else if stopped() {
        Err(TextRefusal::Stopped)
    } else {
        Err(TextRefusal::Failed)
    }
}

/// "Copy that" (C): the focused element's selected text, into the clipboard.
pub fn copy_selection(mac: &dyn Mac, never: &dyn Fn(&RunningApp) -> Option<String>) -> Result<(), TextRefusal> {
    let f = text_target(mac, never)?;
    let sel = f.selected.filter(|s| !s.is_empty()).ok_or(TextRefusal::NothingSelected)?;
    if mac.pasteboard_set(&sel) {
        Ok(())
    } else {
        Err(TextRefusal::Failed)
    }
}

// ---- the real Mac ------------------------------------------------------------------------------------------------------

/// The real Mac. Built only by `front.rs` and `jobs.rs` command entry points.
pub struct RealMac {
    app: tauri::AppHandle,
    opener: crate::open::WorkspaceOpener,
}

impl RealMac {
    pub fn new(app: &tauri::AppHandle) -> Self {
        RealMac { app: app.clone(), opener: crate::open::WorkspaceOpener::new(app) }
    }
}

const SCRIPT_TIME: std::time::Duration = std::time::Duration::from_secs(5);

fn osascript(script: &str) -> Option<String> {
    crate::fileops::run_tool("/usr/bin/osascript", &["-e", script], SCRIPT_TIME).map(|b| String::from_utf8_lossy(&b).to_string())
}

#[cfg(target_os = "macos")]
mod real {
    use super::*;
    use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSString;

    /// Runs `f` on the main thread and waits (2 s at most). Never call from the main thread.
    pub fn on_main<T: Send + 'static>(app: &tauri::AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(objc2::rc::autoreleasepool(|_| f()));
        })
        .ok()?;
        rx.recv_timeout(std::time::Duration::from_secs(2)).ok()
    }

    fn running_of(a: &AnyObject) -> RunningApp {
        unsafe {
            let pid: i32 = msg_send![a, processIdentifier];
            let name: Option<Retained<NSString>> = msg_send![a, localizedName];
            let bundle: Option<Retained<NSString>> = msg_send![a, bundleIdentifier];
            let url: Option<Retained<AnyObject>> = msg_send![a, bundleURL];
            let path: Option<Retained<NSString>> = url.and_then(|u| msg_send![&*u, path]);
            let policy: isize = msg_send![a, activationPolicy];
            let hidden: bool = msg_send![a, isHidden];
            RunningApp {
                pid,
                name: name.map(|s| s.to_string()).unwrap_or_default(),
                bundle_id: bundle.map(|s| s.to_string()),
                path: path.map(|p| PathBuf::from(p.to_string())),
                regular: policy == 0,
                hidden,
            }
        }
    }

    pub fn running_apps(app: &tauri::AppHandle) -> Vec<RunningApp> {
        on_main(app, || unsafe {
            let Some(ws_cls) = AnyClass::get(c"NSWorkspace") else { return vec![] };
            let ws: Option<Retained<AnyObject>> = msg_send![ws_cls, sharedWorkspace];
            let Some(ws) = ws else { return vec![] };
            let apps: Option<Retained<AnyObject>> = msg_send![&*ws, runningApplications];
            let Some(apps) = apps else { return vec![] };
            let n: usize = msg_send![&*apps, count];
            (0..n)
                .filter_map(|i| {
                    let a: Option<Retained<AnyObject>> = msg_send![&*apps, objectAtIndex: i];
                    a.map(|a| running_of(&a))
                })
                .collect()
        })
        .unwrap_or_default()
    }

    /// Sends one no-argument message (hide, unhide, terminate) to a running app; its answer.
    pub fn to_app(app: &tauri::AppHandle, pid: i32, what: &'static str) -> bool {
        on_main(app, move || unsafe {
            let Some(cls) = AnyClass::get(c"NSRunningApplication") else { return false };
            let a: Option<Retained<AnyObject>> = msg_send![cls, runningApplicationWithProcessIdentifier: pid];
            let Some(a) = a else { return false };
            match what {
                "hide" => msg_send![&*a, hide],
                "unhide" => msg_send![&*a, unhide],
                "terminate" => msg_send![&*a, terminate],
                "activate" => msg_send![&*a, activateWithOptions: 0usize],
                "alive" => {
                    let gone: bool = msg_send![&*a, isTerminated];
                    !gone
                }
                _ => false,
            }
        })
        .unwrap_or(false)
    }

    pub fn ns_app(app: &tauri::AppHandle, what: &'static str) -> bool {
        on_main(app, move || unsafe {
            let Some(cls) = AnyClass::get(c"NSApplication") else { return false };
            let a: Option<Retained<AnyObject>> = msg_send![cls, sharedApplication];
            let Some(a) = a else { return false };
            let none: *const AnyObject = std::ptr::null();
            match what {
                "hide_others" => {
                    let _: () = msg_send![&*a, hideOtherApplications: none];
                    true
                }
                "unhide_all" => {
                    let _: () = msg_send![&*a, unhideAllApplications: none];
                    true
                }
                _ => false,
            }
        })
        .unwrap_or(false)
    }

    pub fn pasteboard_set(app: &tauri::AppHandle, text: String) -> bool {
        on_main(app, move || unsafe {
            let Some(cls) = AnyClass::get(c"NSPasteboard") else { return false };
            let pb: Option<Retained<AnyObject>> = msg_send![cls, generalPasteboard];
            let Some(pb) = pb else { return false };
            let _: isize = msg_send![&*pb, clearContents];
            let s = NSString::from_str(&text);
            let ty = NSString::from_str("public.utf8-plain-text");
            msg_send![&*pb, setString: &*s, forType: &*ty]
        })
        .unwrap_or(false)
    }
}

impl Mac for RealMac {
    fn own_pid(&self) -> i32 {
        std::process::id() as i32
    }

    fn running_apps(&self) -> Vec<RunningApp> {
        #[cfg(target_os = "macos")]
        {
            real::running_apps(&self.app)
        }
        #[cfg(not(target_os = "macos"))]
        {
            vec![]
        }
    }

    fn person_front(&self) -> Option<RunningApp> {
        let f = crate::capture::person_front(&self.app)?;
        Some(self.running_apps().into_iter().find(|a| a.pid == f.pid).unwrap_or(RunningApp { pid: f.pid, name: f.name.unwrap_or_default(), bundle_id: f.bundle_id, path: None, regular: true, hidden: false }))
    }

    fn hand_back(&self, pid: i32) -> bool {
        crate::capture::hand_back(&self.app, pid, crate::capture::HAND_BACK_MS)
    }

    fn open_path(&mut self, p: &Path) -> bool {
        use crate::open::Opener;
        self.opener.open_path(p)
    }

    fn open_url(&mut self, u: &str) -> bool {
        use crate::open::Opener;
        self.opener.open_url(u)
    }

    fn open_url_in(&mut self, u: &str, app: &Path) -> bool {
        use crate::open::Opener;
        self.opener.open_url_in(u, app)
    }

    fn default_browser(&self) -> Option<PathBuf> {
        #[cfg(target_os = "macos")]
        return real::on_main(&self.app, crate::open::default_browser_now).flatten();
        #[cfg(not(target_os = "macos"))]
        None
    }

    fn browser_keys(&self, pid: i32, window: bool) -> bool {
        let app = self.app.clone();
        let front_is = move || crate::capture::frontmost(&app).is_some_and(|f| f.pid == pid);
        crate::input::browser_keys(window, &front_is)
    }

    fn reveal(&mut self, p: &Path) -> bool {
        use crate::open::Opener;
        self.opener.reveal(p)
    }

    fn activate(&self, pid: i32) -> bool {
        #[cfg(target_os = "macos")]
        return real::to_app(&self.app, pid, "activate");
        #[cfg(not(target_os = "macos"))]
        false
    }

    fn hide(&self, pid: i32) -> bool {
        #[cfg(target_os = "macos")]
        return real::to_app(&self.app, pid, "hide");
        #[cfg(not(target_os = "macos"))]
        false
    }

    fn unhide(&self, pid: i32) -> bool {
        #[cfg(target_os = "macos")]
        return real::to_app(&self.app, pid, "unhide");
        #[cfg(not(target_os = "macos"))]
        false
    }

    fn hide_all_others(&self) -> bool {
        #[cfg(target_os = "macos")]
        return real::ns_app(&self.app, "hide_others");
        #[cfg(not(target_os = "macos"))]
        false
    }

    fn show_all(&self) -> bool {
        #[cfg(target_os = "macos")]
        return real::ns_app(&self.app, "unhide_all");
        #[cfg(not(target_os = "macos"))]
        false
    }

    fn terminate(&self, pid: i32) -> bool {
        if pid == self.own_pid() {
            return false;
        }
        #[cfg(target_os = "macos")]
        return real::to_app(&self.app, pid, "terminate");
        #[cfg(not(target_os = "macos"))]
        false
    }

    fn is_running(&self, pid: i32) -> bool {
        #[cfg(target_os = "macos")]
        return real::to_app(&self.app, pid, "alive");
        #[cfg(not(target_os = "macos"))]
        false
    }

    fn window_frame(&self, pid: i32) -> Option<Bounds> {
        crate::ax::window_frame(pid)
    }

    fn set_window_frame(&self, pid: i32, frame: Bounds) -> bool {
        crate::ax::set_window_frame(pid, frame)
    }

    fn minimise(&self, pid: i32) -> bool {
        crate::ax::minimise_window(pid)
    }

    fn minimise_own(&self) -> bool {
        crate::dashboard::minimise(&self.app)
    }

    fn visible_frame_for(&self, p: (f64, f64)) -> Option<Bounds> {
        let snap = crate::capture::env_snapshot(&self.app)?;
        let (id, _) = crate::capture::display_under(p)?;
        snap.visible.into_iter().find(|(d, _)| *d == id).map(|(_, b)| b)
    }

    fn pointer(&self) -> Option<(f64, f64)> {
        crate::capture::pointer_top_left()
    }

    fn volume(&self) -> Option<(u8, bool)> {
        parse_volume(&osascript("set s to (get volume settings)\nreturn ((output volume of s) as text) & \", \" & ((output muted of s) as text)")?)
    }

    fn set_volume(&self, level: u8) -> bool {
        osascript(&format!("set volume output volume {}", level.min(100))).is_some()
    }

    fn set_muted(&self, muted: bool) -> bool {
        osascript(if muted { "set volume output muted true" } else { "set volume output muted false" }).is_some()
    }

    fn screenshot_png(&self, at: (f64, f64)) -> Result<Vec<u8>, String> {
        let (id, bounds) = crate::capture::display_under(at).ok_or("I couldn't find that screen.")?;
        crate::capture::screenshot_png(id, bounds)
    }

    fn pasteboard_set(&self, text: &str) -> bool {
        #[cfg(target_os = "macos")]
        return real::pasteboard_set(&self.app, text.to_string());
        #[cfg(not(target_os = "macos"))]
        {
            let _ = text;
            false
        }
    }

    fn focused_text(&self) -> Option<FocusedText> {
        crate::ax::focused_text()
    }

    fn insert_text(&self, text: &str) -> Option<bool> {
        crate::ax::insert_text(text)
    }

    fn type_keys(&self, text: &str, stopped: &dyn Fn() -> bool) -> bool {
        crate::input::type_into_focus(text, stopped)
    }

    fn secure_input(&self) -> bool {
        crate::ax::secure_input()
    }

    /// `networksetup -setairportpower <device> on|off` [UNVERIFIED: no administrator prompt with the default setting].
    fn wifi(&self, on: bool) -> Result<(), MacRefusal> {
        let listing = crate::fileops::run_tool("/usr/sbin/networksetup", &["-listallhardwareports"], SCRIPT_TIME).ok_or(MacRefusal::Failed)?;
        let dev = wifi_device(&String::from_utf8_lossy(&listing)).ok_or(MacRefusal::NoWifi)?;
        let out = crate::fileops::run_tool("/usr/sbin/networksetup", &["-setairportpower", &dev, if on { "on" } else { "off" }], SCRIPT_TIME).ok_or(MacRefusal::WifiAdmin)?;
        let text = String::from_utf8_lossy(&out).to_lowercase();
        if text.contains("admin") || text.contains("not authorized") || text.contains("error") {
            return Err(MacRefusal::WifiAdmin);
        }
        Ok(())
    }

    /// Finder empties the Trash (its own warning may follow; that is macOS's).
    fn empty_trash(&self) -> Result<(), MacRefusal> {
        let out = std::process::Command::new("/usr/bin/osascript")
            .args(["-e", "tell application \"Finder\" to empty trash"])
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|_| MacRefusal::Failed)?;
        if out.status.success() {
            return Ok(());
        }
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("-1743") || err.to_lowercase().contains("not authorized") {
            Err(MacRefusal::FinderDenied)
        } else {
            Err(MacRefusal::Failed)
        }
    }

    fn accessibility(&self) -> bool {
        crate::ax::trusted()
    }

    fn screen_recording(&self) -> bool {
        crate::capture::preflight()
    }

    fn sleep_ms(&self, ms: u64) {
        std::thread::sleep(std::time::Duration::from_millis(ms));
    }
}

/// Every running app (main thread), for the app index without a `RealMac`.
pub fn running_apps(app: &tauri::AppHandle) -> Vec<RunningApp> {
    #[cfg(target_os = "macos")]
    {
        real::running_apps(app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        vec![]
    }
}

// ---- the recording Mac (tests) -------------------------------------------------------------------------------------------

#[cfg(test)]
pub mod testing {
    use super::*;
    use std::cell::{Cell, RefCell};

    /// Records every call; answers what the test set up. Nothing real ever happens.
    pub struct RecordingMac {
        pub calls: RefCell<Vec<String>>,
        pub apps: RefCell<Vec<RunningApp>>,
        pub front: Option<RunningApp>,
        pub frames: RefCell<std::collections::HashMap<i32, Bounds>>,
        pub visible: Bounds,
        pub volume: Cell<(u8, bool)>,
        pub focus: Option<FocusedText>,
        pub insert_works: bool,
        pub secure: bool,
        pub ax: bool,
        pub screen: bool,
        pub open_ok: bool,
        pub quits_ok: bool,
        pub wifi_result: Result<(), MacRefusal>,
        pub trash_result: Result<(), MacRefusal>,
        pub typed: RefCell<Vec<String>>,
        pub slept: Cell<u64>,
        pub default_browser: Option<PathBuf>,
    }

    pub fn app(pid: i32, name: &str, bundle: &str) -> RunningApp {
        RunningApp { pid, name: name.into(), bundle_id: Some(bundle.into()), path: Some(PathBuf::from(format!("/Applications/{name}.app"))), regular: true, hidden: false }
    }

    impl RecordingMac {
        pub fn new() -> Self {
            let figma = app(11, "Figma", "com.figma.Desktop");
            RecordingMac {
                calls: RefCell::new(vec![]),
                apps: RefCell::new(vec![figma.clone(), app(12, "Slack", "com.tinyspeck.slackmacgap"), app(13, "Spotify", "com.spotify.client"), app(1, "Finder", "com.apple.finder"), app(999, "Brenda", crate::look::OWN_BUNDLE_ID)]),
                front: Some(figma),
                frames: RefCell::new(std::collections::HashMap::from([(11, Bounds { x: 100.0, y: 100.0, w: 800.0, h: 600.0 }), (12, Bounds { x: 200.0, y: 200.0, w: 700.0, h: 500.0 })])),
                visible: Bounds { x: 0.0, y: 25.0, w: 1440.0, h: 875.0 },
                volume: Cell::new((50, false)),
                focus: Some(FocusedText { role: "AXTextField".into(), subrole: String::new(), pid: Some(11), selected: Some("hello".into()), settable: true }),
                insert_works: true,
                secure: false,
                ax: true,
                screen: true,
                open_ok: true,
                quits_ok: true,
                wifi_result: Ok(()),
                trash_result: Ok(()),
                typed: RefCell::new(vec![]),
                slept: Cell::new(0),
                default_browser: Some(PathBuf::from("/Applications/Safari.app")),
            }
        }

        fn note(&self, s: String) {
            self.calls.borrow_mut().push(s);
        }

        pub fn calls(&self) -> Vec<String> {
            self.calls.borrow().clone()
        }
    }

    impl Mac for RecordingMac {
        fn own_pid(&self) -> i32 {
            999
        }
        fn running_apps(&self) -> Vec<RunningApp> {
            self.apps.borrow().clone()
        }
        fn person_front(&self) -> Option<RunningApp> {
            self.front.clone()
        }
        fn hand_back(&self, pid: i32) -> bool {
            self.note(format!("hand_back {pid}"));
            true
        }
        fn open_path(&mut self, p: &Path) -> bool {
            self.note(format!("open {}", p.display()));
            self.open_ok
        }
        fn open_url(&mut self, u: &str) -> bool {
            self.note(format!("url {u}"));
            self.open_ok
        }
        fn open_url_in(&mut self, u: &str, app: &Path) -> bool {
            self.note(format!("url {u} in {}", app.display()));
            self.open_ok
        }
        fn default_browser(&self) -> Option<PathBuf> {
            self.default_browser.clone()
        }
        fn browser_keys(&self, pid: i32, window: bool) -> bool {
            self.note(format!("keys cmd+{} {pid}", if window { "n" } else { "t" }));
            self.ax
        }
        fn reveal(&mut self, p: &Path) -> bool {
            self.note(format!("reveal {}", p.display()));
            self.open_ok
        }
        fn activate(&self, pid: i32) -> bool {
            self.note(format!("activate {pid}"));
            true
        }
        fn hide(&self, pid: i32) -> bool {
            self.note(format!("hide {pid}"));
            true
        }
        fn unhide(&self, pid: i32) -> bool {
            self.note(format!("unhide {pid}"));
            true
        }
        fn hide_all_others(&self) -> bool {
            self.note("hide_all".into());
            true
        }
        fn show_all(&self) -> bool {
            self.note("show_all".into());
            true
        }
        fn terminate(&self, pid: i32) -> bool {
            self.note(format!("terminate {pid}"));
            if self.quits_ok {
                self.apps.borrow_mut().retain(|a| a.pid != pid);
            }
            true
        }
        fn is_running(&self, pid: i32) -> bool {
            self.apps.borrow().iter().any(|a| a.pid == pid)
        }
        fn window_frame(&self, pid: i32) -> Option<Bounds> {
            self.frames.borrow().get(&pid).copied()
        }
        fn set_window_frame(&self, pid: i32, frame: Bounds) -> bool {
            self.note(format!("frame {pid} {} {} {} {}", frame.x, frame.y, frame.w, frame.h));
            self.frames.borrow_mut().insert(pid, frame);
            true
        }
        fn minimise(&self, pid: i32) -> bool {
            self.note(format!("minimise {pid}"));
            true
        }
        fn visible_frame_for(&self, _p: (f64, f64)) -> Option<Bounds> {
            Some(self.visible)
        }
        fn pointer(&self) -> Option<(f64, f64)> {
            Some((500.0, 500.0))
        }
        fn volume(&self) -> Option<(u8, bool)> {
            Some(self.volume.get())
        }
        fn set_volume(&self, level: u8) -> bool {
            self.note(format!("volume {level}"));
            let (_, m) = self.volume.get();
            self.volume.set((level, m));
            true
        }
        fn set_muted(&self, muted: bool) -> bool {
            self.note(format!("muted {muted}"));
            let (l, _) = self.volume.get();
            self.volume.set((l, muted));
            true
        }
        fn screenshot_png(&self, _at: (f64, f64)) -> Result<Vec<u8>, String> {
            self.note("screenshot".into());
            if self.screen {
                Ok(b"\x89PNG fake".to_vec())
            } else {
                Err("no".into())
            }
        }
        fn pasteboard_set(&self, text: &str) -> bool {
            self.note(format!("pasteboard {}", text.chars().count()));
            true
        }
        fn focused_text(&self) -> Option<FocusedText> {
            self.focus.clone()
        }
        fn insert_text(&self, text: &str) -> Option<bool> {
            self.note("insert".into());
            if self.insert_works {
                self.typed.borrow_mut().push(text.to_string());
            }
            Some(self.insert_works)
        }
        fn type_keys(&self, text: &str, stopped: &dyn Fn() -> bool) -> bool {
            self.note("type_keys".into());
            if stopped() {
                return false;
            }
            self.typed.borrow_mut().push(crate::input::front_typing(text));
            true
        }
        fn secure_input(&self) -> bool {
            self.secure
        }
        fn wifi(&self, on: bool) -> Result<(), MacRefusal> {
            self.note(format!("wifi {on}"));
            self.wifi_result
        }
        fn empty_trash(&self) -> Result<(), MacRefusal> {
            self.note("empty_trash".into());
            self.trash_result
        }
        fn accessibility(&self) -> bool {
            self.ax
        }
        fn screen_recording(&self) -> bool {
            self.screen
        }
        fn sleep_ms(&self, ms: u64) {
            self.slept.set(self.slept.get() + ms);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volume_steps() {
        assert_eq!(next_volume(50, "up", 0), 62);
        assert_eq!(next_volume(95, "up", 0), 100);
        assert_eq!(next_volume(5, "down", 0), 0);
        assert_eq!(next_volume(50, "set", 30), 30);
        assert_eq!(next_volume(50, "set", 130), 100);
        assert_eq!(parse_volume("42, false"), Some((42, false)));
        assert_eq!(parse_volume("0, true\n"), Some((0, true)));
        assert_eq!(parse_volume("missing value"), None);
    }

    #[test]
    fn wifi_device_from_listing() {
        let listing = "\nHardware Port: Ethernet\nDevice: en1\nEthernet Address: x\n\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: y\n";
        assert_eq!(wifi_device(listing).as_deref(), Some("en0"));
        assert_eq!(wifi_device("Hardware Port: Wi-Fi\nDevice: en0; rm -rf /"), None, "only a plain device name");
        assert_eq!(wifi_device("Hardware Port: Thunderbolt Bridge\nDevice: bridge0"), None);
    }

    #[test]
    fn halves() {
        let v = Bounds { x: 0.0, y: 25.0, w: 1441.0, h: 875.0 };
        assert_eq!(half_frame(v, "left"), Bounds { x: 0.0, y: 25.0, w: 720.0, h: 875.0 });
        assert_eq!(half_frame(v, "right"), Bounds { x: 721.0, y: 25.0, w: 720.0, h: 875.0 });
        assert_eq!(half_frame(v, "fill"), v);
    }

    #[test]
    fn screenshot_names() {
        let n = screenshot_name(1_760_277_845);
        assert!(n.starts_with("Screenshot 2025-10-1") && n.ends_with(".png") && n.contains(" at "), "{n}");
    }

    /// P.5: the real Mac and the real file system are built only in the command entry points.
    #[test]
    fn real_mac_only_in_entry_points() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            let code: String = src.split("#[cfg(test)]").next().unwrap().to_string();
            for built in ["RealMac::new(", "RealFileSys::new("] {
                if code.contains(built) {
                    assert!(name == "front.rs" || name == "jobs.rs", "{name} builds {built}");
                }
            }
        }
    }

    use testing::RecordingMac;

    fn never_none(_: &RunningApp) -> Option<String> {
        None
    }

    fn never_slack(a: &RunningApp) -> Option<String> {
        (a.name == "Slack").then(|| "Slack".to_string())
    }

    /// A password box (by role, subrole or secure input) is refused before anything is typed (C, D).
    #[test]
    fn type_text_secure_refused() {
        let mut m = RecordingMac::new();
        m.focus = Some(FocusedText { role: "AXSecureTextField".into(), pid: Some(11), ..Default::default() });
        assert_eq!(type_text(&m, "hunter2", &never_none, &|| false), Err(TextRefusal::Secure));
        let mut m = RecordingMac::new();
        m.secure = true;
        assert_eq!(type_text(&m, "hunter2", &never_none, &|| false), Err(TextRefusal::Secure));
        assert!(m.typed.borrow().is_empty() && !m.calls().iter().any(|c| c == "insert" || c == "type_keys"));
    }

    /// Never in a never-look or never-act app, never into Brenda herself.
    #[test]
    fn type_text_never_look_refused() {
        let mut m = RecordingMac::new();
        m.focus = Some(FocusedText { role: "AXTextArea".into(), pid: Some(12), ..Default::default() });
        assert_eq!(type_text(&m, "hi", &never_slack, &|| false), Err(TextRefusal::NeverLook("Slack".into())));
        m.focus = Some(FocusedText { role: "AXTextArea".into(), pid: Some(999), ..Default::default() });
        assert_eq!(type_text(&m, "hi", &never_none, &|| false), Err(TextRefusal::Own));
        assert_eq!(copy_selection(&m, &never_none), Err(TextRefusal::Own));
        m.focus = Some(FocusedText { role: "AXButton".into(), pid: Some(11), ..Default::default() });
        assert_eq!(type_text(&m, "hi", &never_none, &|| false), Err(TextRefusal::NoBox));
        m.focus = None;
        assert_eq!(type_text(&m, "hi", &never_none, &|| false), Err(TextRefusal::NoBox));
        let mut m = RecordingMac::new();
        m.ax = false;
        assert_eq!(type_text(&m, "hi", &never_none, &|| false), Err(TextRefusal::NoAccessibility));
    }

    /// Line breaks and tabs become spaces: never Return, Enter or Tab.
    #[test]
    fn type_text_newline_to_space() {
        let m = RecordingMac::new();
        assert_eq!(type_text(&m, "running five\nminutes\tlate", &never_none, &|| false), Ok(()));
        assert_eq!(m.typed.borrow().as_slice(), ["running five minutes late"]);
        assert!(!m.calls().contains(&"type_keys".to_string()), "inserted through Accessibility");
    }

    /// When inserting changed nothing (an Electron box), the characters are typed in chunks, the stop flag between them.
    #[test]
    fn type_text_chunking() {
        let mut m = RecordingMac::new();
        m.insert_works = false;
        assert_eq!(type_text(&m, "Hello, World", &never_none, &|| false), Ok(()));
        assert_eq!(m.calls(), ["insert", "type_keys"]);
        assert_eq!(m.typed.borrow().as_slice(), ["Hello, World"]);
        let long = "x".repeat(45);
        let pieces = crate::input::type_pieces(&crate::input::front_typing(&long));
        assert_eq!(pieces.len(), 3, "chunks of at most 20");
        let stopped = std::cell::Cell::new(false);
        let m = { let mut m = RecordingMac::new(); m.insert_works = false; m };
        stopped.set(true);
        assert_eq!(type_text(&m, "late", &never_none, &|| stopped.get()), Err(TextRefusal::Stopped));
    }

    /// P.7 (ignored; the integrator runs it once on the owner's Mac): a real `NSWorkspace` open of Calculator, then it is
    /// quit politely. Nothing else is opened.
    #[test]
    #[ignore]
    fn open_calculator() {
        let calc = std::path::Path::new("/System/Applications/Calculator.app");
        assert!(calc.exists());
        let probe = crate::open::RealProbe;
        assert_eq!(crate::open::resolve_app_v2(Some(calc), "Calculator", Some("com.apple.calculator"), false, &probe), Ok(()));
        let started = std::time::Instant::now();
        assert!(crate::open::open_now_for_test(calc));
        println!("open issued in {} ms", started.elapsed().as_millis());
        std::thread::sleep(std::time::Duration::from_secs(2));
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
            let cls = AnyClass::get(c"NSRunningApplication").unwrap();
            let id = objc2_foundation::NSString::from_str("com.apple.calculator");
            let apps: Retained<AnyObject> = msg_send![cls, runningApplicationsWithBundleIdentifier: &*id];
            let n: usize = msg_send![&*apps, count];
            println!("Calculator running: {n}");
            for i in 0..n {
                let a: Retained<AnyObject> = msg_send![&*apps, objectAtIndex: i];
                let _: bool = msg_send![&*a, terminate];
            }
        }
    }

    #[test]
    fn copy_needs_a_selection() {
        let mut m = RecordingMac::new();
        assert_eq!(copy_selection(&m, &never_none), Ok(()));
        assert!(m.calls().contains(&"pasteboard 5".to_string()));
        m.focus = Some(FocusedText { role: "AXTextArea".into(), pid: Some(11), selected: Some(String::new()), ..Default::default() });
        assert_eq!(copy_selection(&m, &never_none), Err(TextRefusal::NothingSelected));
    }
}
