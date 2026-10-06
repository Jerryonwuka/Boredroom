//! The notch window as a stage (owner decision, 4 October 2026, after Coucou by Louis Raillé, MIT).
//!
//! The window no longer resizes for each card. It is one fixed, transparent panel at the top centre of the screen, and
//! the page draws Brenda's island inside it, animating its size with a spring. So that the empty, transparent part of
//! the panel never swallows a click meant for the app underneath, the window ignores the mouse everywhere except over
//! the island: a small thread reads the cursor about 30 times a second, compares it with the island's rectangle (which
//! the page reports), and switches click-through on or off. The same thread tells the page where the cursor is, so
//! Brenda's eyes can follow it. Until the page has reported a rectangle, the window ignores the mouse entirely.

use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewWindow};

/// The panel: wide enough for the widest card plus the island's curved shoulders, tall enough for the longest.
pub const PANEL_W: f64 = 480.0;
pub const PANEL_H: f64 = 440.0;
/// How far around the island still counts as on it, so a moving cursor reaches a button with the mouse already on.
const HIT_MARGIN: f64 = 10.0;
const TICK: Duration = Duration::from_millis(33);

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
/// screen and Brenda. Like Coucou's panel, the window goes just above the menu bar's level (main menu + 3), on every
/// Space and over full-screen apps, so the island can start at the very top edge.
#[cfg(target_os = "macos")]
fn above_menu_bar(window: &WebviewWindow) {
    use objc2::{msg_send, runtime::AnyObject};
    const MAIN_MENU_LEVEL: isize = 24;
    // canJoinAllSpaces (1) | stationary (16) | ignoresCycle (64) | fullScreenAuxiliary (256)
    const BEHAVIOUR: usize = 1 | 16 | 64 | 256;
    if let Ok(ns) = window.ns_window() {
        let ns = ns as *mut AnyObject;
        if !ns.is_null() {
            unsafe {
                let _: () = msg_send![&*ns, setLevel: MAIN_MENU_LEVEL + 3];
                let _: () = msg_send![&*ns, setCollectionBehavior: BEHAVIOUR];
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

pub fn place(window: &WebviewWindow) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    above_menu_bar(window);
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

pub fn start(app: &AppHandle, window: WebviewWindow) {
    let _ = window.set_ignore_cursor_events(true);
    app.state::<Island>().ignoring.store(true, Ordering::Relaxed);
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last = (f64::MIN, f64::MIN);
        loop {
            std::thread::sleep(TICK);
            if !window.is_visible().unwrap_or(false) {
                continue;
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
            let on = r.w > 0.0 && x >= r.x - HIT_MARGIN && x <= r.x + r.w + HIT_MARGIN && y >= r.y - HIT_MARGIN && y <= r.y + r.h + HIT_MARGIN;
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
