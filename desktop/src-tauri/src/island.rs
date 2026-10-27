//! The notch window as a stage (owner decision, 4 October 2026, after Coucou by Louis Raillé, MIT).
//!
//! The window no longer resizes for each card. It is one fixed, transparent panel at the top centre of the screen, and
//! the page draws Brenda's island inside it, animating its size with a spring. So that the empty, transparent part of
//! the panel never swallows a click meant for the app underneath, the window ignores the mouse everywhere except over
//! the island: a small thread reads the cursor about 30 times a second, compares it with the island's rectangle (which
//! the page reports), and switches click-through on or off. The same thread tells the page where the cursor is, so
//! Brenda's eyes can follow it. Until the page has reported a rectangle, the window ignores the mouse entirely.
//!
//! Inside an app (owner request, 17 October 2026: "not stagnant in the app"): a second small thread tells the page
//! whether the front app is full screen (its own Space, or two side by side) or its window covers the screen (maximised
//! or zoomed), as `brenda://covered`; the page then hides the notch completely until the pointer reaches the top edge or
//! the look keys are held. The window is also made to follow the person into full-screen Spaces (see `join_this_space`).

use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow};

use crate::look::Bounds;

/// The panel: wide enough for the widest card plus the island's curved shoulders, tall enough for the longest.
pub const PANEL_W: f64 = 480.0;
pub const PANEL_H: f64 = 440.0;
/// How far around the island still counts as on it, so a moving cursor reaches a button with the mouse already on.
const HIT_MARGIN: f64 = 10.0;
const TICK: Duration = Duration::from_millis(33);
/// How often the covering check runs, and how many checks pass before the same answer is sent again (a page that loaded
/// late still hears it).
const COVER_TICK: Duration = Duration::from_millis(600);
const COVER_REPEAT: u32 = 10;

#[derive(Clone, Copy, Default)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Default)]
pub struct Island {
    rect: Mutex<Rect>,
    ignoring: AtomicBool,
}

#[derive(Serialize, Clone)]
struct Cursor {
    x: f64,
    y: f64,
}

/// On a Mac an ordinary always-on-top window still sits under the menu bar, which left a gap between the top of the
/// screen and Brenda. The window goes above the menu bar, on every Space and over full-screen apps, so the island can
/// start at the very top edge. Coucou's "main menu + 3" (27) is no longer enough: on macOS 26 each app draws its menu
/// titles ("Window", "Help"…) in its own window at the screen-saver level (1000), and they showed through the open card
/// (owner report, 7 October 2026). One above that keeps the island on top of them; it stays click-through outside the
/// island, so nothing under it is blocked.
#[cfg(target_os = "macos")]
const ISLAND_LEVEL: isize = 1000 + 1; // the screen-saver level, where macOS 26 draws each app's menu titles, plus one
/// canJoinAllSpaces (1) | stationary (16) | ignoresCycle (64) | fullScreenAuxiliary (256), as a non-activating panel
/// (overlay.rs: the only kind of window that enters another app's full-screen Space whatever Boredroom's policy).
#[cfg(target_os = "macos")]
const NOTCH: crate::overlay::Want = crate::overlay::Want { level: ISLAND_LEVEL, behaviour: crate::overlay::OVER_FULL_SCREEN };

/// Main thread (lib.rs's setup).
#[cfg(target_os = "macos")]
fn above_menu_bar(window: &WebviewWindow) {
    use objc2::runtime::AnyObject;
    if let Ok(ns) = window.ns_window() {
        let ns = ns as *mut AnyObject;
        if !ns.is_null() {
            unsafe {
                // The panel first: the frame rule below is set on the window's class, which this changes.
                crate::overlay::ensure(ns, NOTCH);
                keep_frames_where_put(ns);
            }
        }
    }
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}
#[cfg(target_os = "macos")]
unsafe impl objc2::encode::Encode for CGPoint {
    const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
}

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGPoint, // a CGSize: width and height, laid out the same way
}

/// AppKit "constrains" every window so it cannot overlap the menu bar, and moved Brenda back below it whatever
/// position she was given. This answers that check for her window class with the frame unchanged, the way notch apps
/// do, so the island can sit flush against the top edge of the screen.
#[cfg(target_os = "macos")]
unsafe fn keep_frames_where_put(ns: *mut objc2::runtime::AnyObject) {
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    unsafe extern "C-unwind" fn unconstrained(_this: *mut AnyObject, _cmd: Sel, frame: CGRect, _screen: *mut AnyObject) -> CGRect {
        frame
    }
    let cls = objc2::ffi::object_getClass(ns) as *mut AnyClass;
    if cls.is_null() {
        return;
    }
    let imp: Imp = std::mem::transmute(unconstrained as unsafe extern "C-unwind" fn(*mut AnyObject, Sel, CGRect, *mut AnyObject) -> CGRect);
    let types = c"{CGRect={CGPoint=dd}{CGSize=dd}}@:{CGRect={CGPoint=dd}{CGSize=dd}}@";
    objc2::ffi::class_replaceMethod(cls, objc2::sel!(constrainFrameRect:toScreen:), imp, types.as_ptr());
}

/// Puts the island back above the menu bar if something lowered it. The window framework re-applies its own
/// "always on top" level (a plain floating level, under the menu bar) when the window is shown or refocused, which
/// silently undid the level set at start; the poll below checks about three times a second, on the main thread.
///
/// It also keeps the island on the Space on screen (`join_this_space`, owner report, 17 October 2026: "inside an app"
/// the notch neither showed on hover nor for the look keys). The cause was the window itself: made from the config
/// before Brenda became a menu-bar app, the window server never let it into full-screen Spaces (it listed it on the two
/// ordinary desktops only), and ordering it in again did not change that; lib.rs now makes it after. This is the safety
/// net: the behaviour put back if anything reset it, and the window ordered in when it is not on the Space showing.
///
/// Since the Boredroom window (owner report, 27 October 2026: "Brenda doesn't show in apps when I open apps in full
/// screen"), the app switches between a menu-bar app and a Dock app, and an ordinary window of a Dock app never enters
/// another app's full-screen Space. The notch is now a non-activating panel, which does under either policy, and this
/// poll (overlay::ensure) also puts back its panel style, level and behaviour, sets the behaviour again after each
/// policy change, and orders it in when it is visible but not on the Space showing.
#[cfg(target_os = "macos")]
fn keep_above_menu_bar(window: &WebviewWindow) {
    crate::overlay::ensure_window(window, NOTCH);
}

/// Moves the window's top-left corner to (x, top) in logical screen coordinates, measured from the top of the main screen.
#[cfg(target_os = "macos")]
fn top_left(window: &WebviewWindow, x: f64, top: f64) {
    use objc2::{msg_send, runtime::AnyObject};
    let Ok(Some(primary)) = window.primary_monitor() else { return };
    let height = primary.size().to_logical::<f64>(primary.scale_factor()).height;
    let w = window.clone();
    let _ = window.run_on_main_thread(move || {
        if let Ok(ns) = w.ns_window() {
            let ns = ns as *mut AnyObject;
            if !ns.is_null() {
                unsafe { let _: () = msg_send![&*ns, setFrameTopLeftPoint: CGPoint { x, y: height - top }]; }
            }
        }
    });
}

/// The menu bar's height on the screen Brenda is on, so the compact bar can be exactly as tall (0 where there is none).
#[tauri::command]
pub fn menu_bar_height(window: WebviewWindow) -> f64 {
    window.current_monitor().ok().flatten().or_else(|| window.primary_monitor().ok().flatten()).map(|m| {
        let scale = m.scale_factor();
        ((m.work_area().position.y - m.position().y) as f64 / scale).max(0.0)
    }).unwrap_or(0.0)
}

/// Makes Brenda a menu-bar app (no Dock icon) at once, on the main thread, so the notch window made next may enter
/// full-screen Spaces (lib.rs). The framework's own call is queued and lands after that window would be made.
pub fn menu_bar_app_now() {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::{class, msg_send, runtime::AnyObject};
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if !ns_app.is_null() {
            // NSApplicationActivationPolicyAccessory
            let _: bool = msg_send![&*ns_app, setActivationPolicy: 1isize];
        }
    }
    crate::overlay::after_policy_change();
}

/// Makes Boredroom an ordinary Mac app (a Dock icon, ⌘Tab, the menu bar) at once, on the main thread, for the Boredroom
/// window (owner request, 24 October 2026). The notch stays the window made at launch while a menu-bar app (see
/// `menu_bar_app_now`); it is never remade. As an ordinary window of a Dock app it no longer entered other apps'
/// full-screen Spaces (owner report, 27 October 2026), so Brenda's windows are non-activating panels and are put right
/// after each policy change (overlay.rs). Main thread only.
pub fn regular_app_now() {
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2::{class, msg_send, runtime::AnyObject};
        let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        if !ns_app.is_null() {
            // NSApplicationActivationPolicyRegular
            let _: bool = msg_send![&*ns_app, setActivationPolicy: 0isize];
            let _: () = msg_send![&*ns_app, activateIgnoringOtherApps: true];
        }
    }
    crate::overlay::after_policy_change();
}

/// Brenda's own windows (the notch and its helpers) stay when the person hides Boredroom (⌘H) and are never listed in
/// the Window menu (owner request, 24 October 2026).
pub fn helper_window_flags(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};
        let w = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(ns) = w.ns_window() {
                let ns = ns as *mut AnyObject;
                if !ns.is_null() {
                    unsafe {
                        let _: () = msg_send![&*ns, setCanHide: false];
                        let _: () = msg_send![&*ns, setExcludedFromWindowsMenu: true];
                    }
                }
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = window;
}

pub fn place(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    above_menu_bar(window);
    helper_window_flags(window);
    window.set_size(LogicalSize::new(PANEL_W, PANEL_H))?;
    if let Some(monitor) = window.current_monitor()?.or(window.primary_monitor()?) {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let origin = monitor.position().to_logical::<f64>(scale);
        window.set_position(LogicalPosition::new(origin.x + (size.width - PANEL_W) / 2.0, origin.y))?;
        let x = origin.x + (size.width - PANEL_W) / 2.0;
        // macOS pushes a window that would overlap the menu bar back below it when it is moved the usual way. Setting
        // the frame's top-left corner directly (Cocoa counts y up from the bottom of the main screen) puts it flush
        // against the top edge.
        #[cfg(target_os = "macos")]
        top_left(window, x, origin.y);

    }
    Ok(())
}

/// The page reports the island's rectangle (window coordinates, logical pixels) whenever it changes size.
#[tauri::command]
pub fn set_island_rect(app: AppHandle, x: f64, y: f64, w: f64, h: f64) {
    *app.state::<Island>().rect.lock().unwrap() = Rect { x, y, w, h };
}

/// The cursor in logical screen coordinates, measured from the top-left of the main screen.
///
/// On a Mac this reads NSEvent's mouse location directly: the windowing library's own `cursor_position` subtracts the
/// point position from the screen's height in pixels, which on a Retina display puts the cursor half a screen too low,
/// so the island never took the mouse (clicks went through it) and the eyes never looked up.
#[cfg(target_os = "macos")]
fn cursor_logical(app: &AppHandle) -> Option<(f64, f64)> {
    use objc2::{class, msg_send};
    let primary = app.primary_monitor().ok().flatten()?;
    let height = primary.size().to_logical::<f64>(primary.scale_factor()).height;
    let p: CGPoint = unsafe { msg_send![class!(NSEvent), mouseLocation] };
    Some((p.x, height - p.y))
}

#[cfg(not(target_os = "macos"))]
fn cursor_logical(app: &AppHandle) -> Option<(f64, f64)> {
    let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    app.cursor_position().ok().map(|p| (p.x / scale, p.y / scale))
}

/// While debugging (BRENDA_DEBUG_CURSOR set), the page reports what it receives here.
#[tauri::command]
pub fn debug_log(msg: String) {
    if std::env::var_os("BRENDA_DEBUG_CURSOR").is_some() {
        eprintln!("[brenda page] {msg}");
    }
}

/// Whether (x, y), in window coordinates, is on the island (with its margin).
fn hit(r: Rect, x: f64, y: f64) -> bool {
    r.w > 0.0 && x >= r.x - HIT_MARGIN && x <= r.x + r.w + HIT_MARGIN && y >= r.y - HIT_MARGIN && y <= r.y + r.h + HIT_MARGIN
}

/// Whether the cursor is over the island now (Brenda Look's "real press" check, owner decisions, 11 October 2026: a
/// look, turning screen help on and the permission prompt only follow a press on Brenda herself).
pub fn cursor_on_island(app: &AppHandle) -> bool {
    cursor_logical(app).is_some_and(|p| point_on_island(app, p))
}

/// Whether a point (logical points from the top-left of the main screen) is on the island: a screen task never clicks
/// Brenda's own island (owner rule, 12 October 2026: a press on Brenda is only ever the person's).
pub fn point_on_island(app: &AppHandle, p: (f64, f64)) -> bool {
    let Some(window) = app.get_webview_window("notch") else { return false };
    if !window.is_visible().unwrap_or(false) {
        return false;
    }
    let (Ok(origin), Ok(scale)) = (window.outer_position(), window.scale_factor()) else { return false };
    let r = *app.state::<Island>().rect.lock().unwrap();
    hit(r, p.0 - origin.x as f64 / scale, p.1 - origin.y as f64 / scale)
}

/// Whether the front app's window covers the notch's display (owner request, 17 October 2026): exactly full screen, or
/// filling what is left of it beside the menu bar and the Dock (maximised or zoomed). Its middle must be on the display.
pub(crate) fn covers(window: Bounds, display: Bounds, visible: Bounds) -> bool {
    let (cx, cy) = (window.x + window.w / 2.0, window.y + window.h / 2.0);
    let on = cx >= display.x && cx < display.x + display.w && cy >= display.y && cy < display.y + display.h;
    on && (crate::guard::is_full_screen(window, display) || (window.w >= visible.w - 2.0 && window.h >= visible.h - 2.0))
}

/// Inside a full-screen or covering app now, on the notch's display: Some(true) or Some(false), or None when it cannot
/// be told (the front app unknown, or the notch itself in front while the person types to her), and the last answer
/// stands. The Boredroom window in front counts as an app like any other (owner request, 24 October 2026).
fn covered_now(app: &AppHandle, window: &WebviewWindow) -> Option<bool> {
    let (Ok(origin), Ok(scale)) = (window.outer_position(), window.scale_factor()) else { return None };
    let top = (origin.x as f64 / scale + PANEL_W / 2.0, origin.y as f64 / scale + 1.0);
    let displays = crate::capture::displays();
    let (id, display) = crate::capture::display_at(top, &displays)?;
    // A full-screen Space: one app full screen, or two side by side (their windows do not cover the display alone).
    if crate::capture::full_screen_space(id) == Some(true) {
        return Some(true);
    }
    let snap = crate::capture::env_snapshot(app)?;
    let front = snap.front?;
    let own = std::process::id() as i32;
    let windows = crate::capture::window_list(false);
    if front.pid == own && !crate::capture::own_dashboard_front(&windows, own, None) {
        return None;
    }
    let visible = snap.visible.iter().find(|(v, _)| *v == id).map(|(_, b)| *b).unwrap_or(display);
    Some(windows.iter().find(|w| w.pid == front.pid && w.layer == 0 && w.alpha > 0.0).is_some_and(|w| covers(w.bounds, display, visible)))
}

/// Tells the page, as `brenda://covered`, whether the notch is inside a full-screen or covering app: at once when that
/// changes, and again every few seconds. Nothing is read while the notch is hidden from the tray.
fn watch_covered(app: AppHandle, window: WebviewWindow) {
    std::thread::spawn(move || {
        let mut last: Option<bool> = None;
        let mut quiet: u32 = 0;
        loop {
            std::thread::sleep(COVER_TICK);
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            let now = covered_now(&app, &window).or(last).unwrap_or(false);
            quiet += 1;
            if Some(now) == last && quiet < COVER_REPEAT {
                continue;
            }
            if last.is_some() && Some(now) != last {
                eprintln!("[brenda] {}", if now { "inside a full-screen or covering app: the notch hides until the top edge or the look keys" } else { "back to an ordinary window: the notch as usual" });
            }
            last = Some(now);
            quiet = 0;
            let _ = window.emit("brenda://covered", now);
        }
    });
}

pub fn start(app: &AppHandle, window: WebviewWindow) {
    watch_covered(app.clone(), window.clone());
    let _ = window.set_ignore_cursor_events(true);
    app.state::<Island>().ignoring.store(true, Ordering::Relaxed);
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = (f64::MIN, f64::MIN);
        let mut ticks: u32 = 0;
        loop {
            std::thread::sleep(TICK);
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            ticks = ticks.wrapping_add(1);
            #[cfg(target_os = "macos")]
            // About three times a second: the level, and the Space on screen (a full-screen app's included).
            if ticks % 10 == 0 {
                keep_above_menu_bar(&window);
            }
            let (Some((cx, cy)), Ok(origin), Ok(scale)) = (cursor_logical(&app), window.outer_position(), window.scale_factor()) else { continue };
            let x = cx - origin.x as f64 / scale;
            let y = cy - origin.y as f64 / scale;
            if (x - last.0).abs() < 0.5 && (y - last.1).abs() < 0.5 {
                continue;
            }
            last = (x, y);
            let state = app.state::<Island>();
            let r = *state.rect.lock().unwrap();
            let on = hit(r, x, y);
            if std::env::var_os("BRENDA_DEBUG_CURSOR").is_some() && y < 120.0 {
                eprintln!("[brenda] cursor {x:.0},{y:.0} island {:.0},{:.0} {:.0}x{:.0} on={on} ignoring={}", r.x, r.y, r.w, r.h, state.ignoring.load(Ordering::Relaxed));
            }
            if state.ignoring.load(Ordering::Relaxed) == on {
                state.ignoring.store(!on, Ordering::Relaxed);
                let _ = window.set_ignore_cursor_events(!on);
            }
            let _ = window.emit("brenda://cursor", Cursor { x, y });
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const D: Bounds = Bounds { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 };
    /// Below a 30-point menu bar and beside a 64-point Dock.
    const V: Bounds = Bounds { x: 0.0, y: 30.0, w: 1440.0, h: 806.0 };

    #[test]
    fn full_screen_and_zoomed_windows_cover_the_display() {
        assert!(covers(D, D, V));
        assert!(covers(Bounds { x: 0.0, y: 30.0, w: 1440.0, h: 806.0 }, D, V)); // zoomed
        assert!(covers(Bounds { x: 0.0, y: 30.0, w: 1440.0, h: 870.0 }, D, V)); // filled past the Dock
    }

    #[test]
    fn ordinary_windows_do_not() {
        assert!(!covers(Bounds { x: 320.0, y: 80.0, w: 800.0, h: 642.0 }, D, V));
        assert!(!covers(Bounds { x: 3.0, y: 30.0, w: 1033.0, h: 800.0 }, D, V));
        // Full width, half height (tiled to the top half).
        assert!(!covers(Bounds { x: 0.0, y: 30.0, w: 1440.0, h: 403.0 }, D, V));
    }

    #[test]
    fn a_window_on_another_display_does_not() {
        assert!(!covers(Bounds { x: 1440.0, y: -180.0, w: 1920.0, h: 1080.0 }, D, V));
    }
}
