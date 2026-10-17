//! Brenda Look: the Mac's side of the pictures (owner decisions, 11 October 2026; the display capture, owner request,
//! 12 October 2026: "it must see the desktop and anything under the pointer"; the logic is in `look.rs`).
//!
//! Everything here touches the system: the modifier state (read, never intercepted: no event tap, so no Input
//! Monitoring or Accessibility permission), whether the screen is locked, the frontmost app and the on-screen window
//! list (owners and sizes; window titles are never read), the displays, the Screen Recording permission, and
//! ScreenCaptureKit's pictures of ONE display (macOS 14+, weak-linked in build.rs, never touched before `supported()`).
//!
//! What a picture holds (companion-spec B.2): the whole display the pointer is on, desktop and menu bar included, with
//! never-look apps and Brenda's own windows left out by ScreenCaptureKit's own content filter. Where a never-look app's
//! window would have shown, the picture is hatched grey (no text), so the model knows something is hidden and never
//! guesses. Two pictures go to Boredroom: the screen scaled to a long edge of 1,568 pixels and a sharp 448-point
//! close-up round the pointer, the pointer ringed on both. A screen task's step pictures (B.7.3) are the same display,
//! same exclusions, at 1,280 pixels. Pictures stay in memory: the bitmaps we own are zeroed before they are freed, and
//! nothing is written to disk, the clipboard or a log.
//!
//! Elsewhere (Windows, Linux) every function says "not supported".
//!
//! The own-window fix (owner brief, 12 October 2026: "Open Figma" failed because every click was refused as Brenda's
//! own window; helpers-spec L.1): `person_front` is the app the person is in even when Brenda's notch is frontmost (the
//! first ordinary window in front-to-back order that isn't Brenda's or the system's), and `hand_back` gives the front
//! back to it synchronously (`yieldActivationToApplication:` then `activateFromApplication:options:`, polling until it
//! is really in front, 600 ms at most) instead of `activateWithOptions:` and a fixed sleep. `screenshot_png` is the
//! front desk's "Take a screenshot": the display at full resolution, Brenda's own windows left out, nothing hatched, a
//! PNG that goes only to the person's Desktop (Brenda never reads it).

use crate::look::{wipe, Bounds, Point};

// ---- the person's app (L.1, pure) ------------------------------------------------------------------------------------

/// Window owners that are never "the app the person is in" (L.1): the Dock, the window server and the system's own
/// furniture.
pub const SYSTEM_OWNERS: &[&str] = &[
    "Dock",
    "WindowServer",
    "SystemUIServer",
    "Control Centre",
    "Control Center",
    "Notification Centre",
    "Notification Center",
    "Spotlight",
    "Window Manager",
    "loginwindow",
    "Brenda",
];

/// The owner of the first on-screen, visible (alpha above 0), ordinary (layer 0) window in front-to-back order that is
/// neither Brenda's nor the system's: the app the person was in when Brenda's notch came to the front.
pub fn first_person_window(list: &[crate::look::WindowInfo], own_pid: i32) -> Option<i32> {
    list.iter()
        .find(|w| w.layer == 0 && w.alpha > 0.0 && w.pid != own_pid && w.pid > 0 && w.bounds.w > 1.0 && w.bounds.h > 1.0 && !SYSTEM_OWNERS.iter().any(|s| s.eq_ignore_ascii_case(w.owner_name.trim())))
        .map(|w| w.pid)
}

/// How long `hand_back` waits for the app to be in front (L.1).
pub const HAND_BACK_MS: u64 = 600;

/// The person's app as `focus_notch` saw it just before the notch took the keyboard (L.1 step 3).
static NOTED_FRONT: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);

pub fn note_person_front(pid: i32) {
    if pid > 0 && pid != std::process::id() as i32 {
        NOTED_FRONT.store(pid, std::sync::atomic::Ordering::SeqCst);
    }
}

pub fn noted_person_front() -> Option<i32> {
    Some(NOTED_FRONT.load(std::sync::atomic::Ordering::SeqCst)).filter(|p| *p > 0)
}

// ---- sizes (pure) ----------------------------------------------------------------------------------------------------

/// The screen picture's long edge (B.2 step 9): never enlarged.
pub const SCREEN_LONG_EDGE: u32 = 1_568;
/// The close-up: a square this many points round the pointer, at native pixels.
pub const CROP_PT: f64 = 448.0;
/// A screen task's screenshot (B.7.3).
pub const ACT_SHOT_LONG_EDGE: u32 = 1_280;
pub const SCREEN_MAX_BYTES: usize = 1_800_000;
pub const CROP_MAX_BYTES: usize = 700_000;
pub const ACT_SHOT_MAX_BYTES: usize = 160_000;
pub const SCREEN_QUALITIES: [f64; 3] = [0.8, 0.65, 0.5];
pub const SCREEN_RETRY: f64 = 0.85;
pub const CROP_QUALITIES: [f64; 2] = [0.85, 0.7];
pub const ACT_QUALITIES: [f64; 2] = [0.65, 0.5];
pub const ACT_RETRY: f64 = 0.9;
/// Hatching over hidden apps: #8A8A8A with 2-point diagonal lines of #6F6F6F every 10 points.
pub const HATCH_FILL: f64 = 0x8A as f64 / 255.0;
pub const HATCH_LINE: f64 = 0x6F as f64 / 255.0;
pub const HATCH_STEP_PT: f64 = 10.0;
pub const HATCH_WIDTH_PT: f64 = 2.0;
/// At most this many hidden apps are named in a request.
pub const MAX_HIDDEN: usize = 20;
/// The outline flashes round the captured display, inset this much, for this long (B.2 step 12).
pub const OUTLINE_INSET: f64 = 4.0;
pub const OUTLINE_MS: u64 = 700;
/// The pointer ring: phase 1's radius per point of picture, never under 10 pixels.
pub const RING_MIN_PX: f64 = 10.0;

/// `w` × `h` scaled so its long edge is at most `long`, aspect kept, never enlarged, each edge at least 1.
pub fn fit_long_edge(w: u32, h: u32, long: u32) -> (u32, u32) {
    let m = w.max(h).max(1) as f64;
    let s = 1f64.min(long as f64 / m);
    (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
}

/// The close-up square (global points): `size` points centred on the pointer, shifted to stay inside the display, and
/// never larger than it.
pub fn crop_square(p: (f64, f64), display: Bounds, size: f64) -> Bounds {
    let w = size.min(display.w);
    let h = size.min(display.h);
    let x = (p.0 - w / 2.0).clamp(display.x, display.x + display.w - w);
    let y = (p.1 - h / 2.0).clamp(display.y, display.y + display.h - h);
    Bounds { x, y, w, h }
}

/// The pointer (global points) in a picture of `area`, in that picture's pixels, clamped inside it.
pub fn map_pointer_display(p: (f64, f64), area: Bounds, pic_w: u32, pic_h: u32) -> Point {
    let x = ((p.0 - area.x) * pic_w as f64 / area.w).round().clamp(0.0, pic_w.saturating_sub(1) as f64);
    let y = ((p.1 - area.y) * pic_h as f64 / area.h).round().clamp(0.0, pic_h.saturating_sub(1) as f64);
    Point { x: x as u32, y: y as u32 }
}

pub fn intersect(a: Bounds, b: Bounds) -> Option<Bounds> {
    let x0 = a.x.max(b.x);
    let y0 = a.y.max(b.y);
    let x1 = (a.x + a.w).min(b.x + b.w);
    let y1 = (a.y + a.h).min(b.y + b.h);
    (x1 > x0 && y1 > y0).then(|| Bounds { x: x0, y: y0, w: x1 - x0, h: y1 - y0 })
}

/// `r` minus `cut`: up to four rectangles (above, below, left, right).
pub fn subtract(r: Bounds, cut: Bounds) -> Vec<Bounds> {
    let Some(i) = intersect(r, cut) else { return vec![r] };
    let mut out = Vec::with_capacity(4);
    if i.y > r.y {
        out.push(Bounds { x: r.x, y: r.y, w: r.w, h: i.y - r.y });
    }
    if i.y + i.h < r.y + r.h {
        out.push(Bounds { x: r.x, y: i.y + i.h, w: r.w, h: r.y + r.h - (i.y + i.h) });
    }
    if i.x > r.x {
        out.push(Bounds { x: r.x, y: i.y, w: i.x - r.x, h: i.h });
    }
    if i.x + i.w < r.x + r.w {
        out.push(Bounds { x: i.x + i.w, y: i.y, w: r.x + r.w - (i.x + i.w), h: i.h });
    }
    out
}

/// What is visible of the hidden apps' windows: each minus every window in front of it (B.2 step 8).
pub fn visible_regions(excluded: &[Bounds], in_front: &[Bounds]) -> Vec<Bounds> {
    let mut out = Vec::new();
    for e in excluded {
        let mut parts = vec![*e];
        for f in in_front {
            parts = parts.into_iter().flat_map(|p| subtract(p, *f)).collect();
        }
        out.extend(parts.into_iter().filter(|p| p.w >= 0.5 && p.h >= 0.5));
    }
    out
}

/// A rectangle in global points as pixels of a picture of `area` (top-left origin), clipped to the picture.
pub fn to_pixels(r: Bounds, area: Bounds, pic_w: u32, pic_h: u32) -> Option<Bounds> {
    let r = intersect(r, area)?;
    let sx = pic_w as f64 / area.w;
    let sy = pic_h as f64 / area.h;
    Some(Bounds { x: (r.x - area.x) * sx, y: (r.y - area.y) * sy, w: r.w * sx, h: r.h * sy })
}

/// The display a global point is on.
pub fn display_at(p: (f64, f64), displays: &[(u32, Bounds)]) -> Option<(u32, Bounds)> {
    displays.iter().copied().find(|(_, b)| p.0 >= b.x && p.1 >= b.y && p.0 < b.x + b.w && p.1 < b.y + b.h)
}

/// What a look's pictures show, for pointing (B.5) and for the request.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LookGeometry {
    pub display_id: u32,
    /// The display, global top-left points.
    pub display: Bounds,
    /// Native pixels per point.
    pub scale: f64,
    pub screen_w: u32,
    pub screen_h: u32,
    pub crop: Option<CropGeom>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CropGeom {
    /// The close-up's square, global points.
    pub area: Bounds,
    pub w: u32,
    pub h: u32,
}

/// One composed picture, JPEG, with the pointer in its pixels. Wiped when dropped.
pub struct Pic {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub pointer: Option<Point>,
}

impl Drop for Pic {
    fn drop(&mut self) {
        wipe(&mut self.jpeg);
    }
}

impl Pic {
    /// A copy for the held pictures (60 s follow-ups); the copy wipes itself too.
    pub fn duplicate(&self) -> Pic {
        Pic { jpeg: self.jpeg.clone(), width: self.width, height: self.height, pointer: self.pointer }
    }
}

/// A look's pictures.
pub struct DisplayShot {
    pub screen: Pic,
    pub crop: Option<Pic>,
    pub geometry: LookGeometry,
    /// The distinct names of the hatched apps (≤ 20).
    pub hidden: Vec<String>,
    /// The preview card's picture (only with "Show me the picture first" on), as a `data:` URL.
    pub preview: Option<String>,
}

/// How a running app is treated in a picture.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Exclude {
    No,
    /// Brenda's own windows: left out, not hatched (what is behind them is real).
    Own,
    /// A never-look app: left out and hatched; the name goes in `hidden`.
    Hidden(String),
}

/// A running app as the exclusion rule sees it.
pub struct AppMeta<'a> {
    pub pid: i32,
    pub bundle_id: Option<&'a str>,
    pub name: &'a str,
}

/// The frontmost app, read on the main thread.
#[derive(Clone, Debug)]
pub struct FrontApp {
    pub pid: i32,
    pub bundle_id: Option<String>,
    pub name: Option<String>,
}

/// What the companion's thread reads from AppKit once a second, on the main thread.
#[derive(Clone, Debug, Default)]
pub struct EnvSnapshot {
    pub front: Option<FrontApp>,
    pub running: Vec<String>,
    pub reduce_motion: bool,
    /// Each display's visible frame (without the menu bar and the Dock), global top-left points.
    pub visible: Vec<(u32, Bounds)>,
}

#[cfg(target_os = "macos")]
pub use mac::*;

#[cfg(not(target_os = "macos"))]
pub use other::*;

#[cfg(not(target_os = "macos"))]
mod other {
    use super::*;
    use tauri::AppHandle;

    pub fn supported() -> bool {
        false
    }
    pub fn preflight() -> bool {
        false
    }
    pub fn request() -> bool {
        false
    }
    pub fn modifier_flags() -> u64 {
        0
    }
    pub fn seconds_since_key_down() -> Option<f64> {
        None
    }
    pub fn seconds_since_mouse_down() -> Option<f64> {
        None
    }
    pub fn mouse_button_held() -> bool {
        false
    }
    pub fn screen_locked() -> bool {
        true
    }
    pub fn frontmost(_app: &AppHandle) -> Option<FrontApp> {
        None
    }
    pub fn app_of_pid(_app: &AppHandle, _pid: i32) -> Option<FrontApp> {
        None
    }
    pub fn person_front(_app: &AppHandle) -> Option<FrontApp> {
        None
    }
    pub fn hand_back(_app: &AppHandle, _pid: i32, _timeout_ms: u64) -> bool {
        false
    }
    pub fn screenshot_png(_id: u32, _bounds: Bounds) -> Result<Vec<u8>, String> {
        Err("Only on a Mac.".into())
    }
    pub fn env_snapshot(_app: &AppHandle) -> Option<EnvSnapshot> {
        None
    }
    pub fn window_list(_include_desktop: bool) -> Vec<crate::look::WindowInfo> {
        Vec::new()
    }
    pub fn pointer_top_left() -> Option<(f64, f64)> {
        None
    }
    pub fn displays() -> Vec<(u32, Bounds)> {
        Vec::new()
    }
    pub fn display_under(_p: (f64, f64)) -> Option<(u32, Bounds)> {
        None
    }
    pub fn display_mirrored_or_captured(_id: u32) -> bool {
        false
    }
    pub fn capture_display(
        _id: u32,
        _bounds: Bounds,
        _exclude: &dyn Fn(&AppMeta) -> Exclude,
        _pointer: Option<(f64, f64)>,
        _with_crop: bool,
        _preview: bool,
    ) -> Result<DisplayShot, String> {
        Err("Screen help is only on a Mac.".into())
    }
    pub fn act_screenshot(_id: u32, _bounds: Bounds, _exclude: &dyn Fn(&AppMeta) -> Exclude) -> Result<crate::input::Image, String> {
        Err("Only on a Mac.".into())
    }
    pub fn act_zoom(_id: u32, _bounds: Bounds, _region: Bounds, _fit: (u32, u32), _exclude: &dyn Fn(&AppMeta) -> Exclude) -> Result<crate::input::Image, String> {
        Err("Only on a Mac.".into())
    }
    pub fn image_file_to_jpeg(_bytes: &[u8], _long: u32, _max: usize) -> Option<(Vec<u8>, u32, u32)> {
        None
    }
    pub fn flash_outline(_app: &AppHandle, _frame: Bounds) {}
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use crate::look::{self, WindowInfo};
    use block2::RcBlock;
    use objc2::{
        msg_send,
        rc::{autoreleasepool, Retained},
        runtime::{AnyClass, AnyObject},
        sel, AllocAnyThread,
    };
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSEvent, NSImageCompressionFactor, NSRunningApplication, NSWorkspace};
    use objc2_core_foundation::{CFRetained, CGPoint, CGRect, CGSize};
    use objc2_core_graphics::{
        kCGColorSpaceSRGB, CGBitmapContextCreate, CGBitmapContextCreateImage, CGColorSpace, CGContext, CGDisplayBounds,
        CGDisplayIsInMirrorSet, CGDisplayMirrorsDisplay, CGEventSource, CGEventSourceStateID, CGEventType, CGGetActiveDisplayList, CGGetDisplaysWithPoint,
        CGImage, CGImageAlphaInfo, CGInterpolationQuality, CGMainDisplayID, CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess,
        CGSessionCopyCurrentDictionary, CGWindowListCopyWindowInfo, CGWindowListOption,
    };
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSOperatingSystemVersion, NSProcessInfo, NSString};
    use objc2_screen_capture_kit::{SCCaptureResolutionType, SCContentFilter, SCDisplay, SCRunningApplication, SCScreenshotManager, SCShareableContent, SCStreamConfiguration};
    use std::{ptr::NonNull, sync::mpsc, time::Duration};
    use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

    /// The content list and the capture each get this long.
    const SC_TIMEOUT: Duration = Duration::from_secs(3);

    /// ObjC and CF objects handed across threads by ScreenCaptureKit's completion handlers. They are only ever used
    /// by one thread at a time (the handler sends, the waiting thread receives).
    struct Handoff<T>(T);
    unsafe impl<T> Send for Handoff<T> {}

    // ---- version and permission ----------------------------------------------------------------------------------

    /// macOS 14 or later, and ScreenCaptureKit's screenshot class present. Nothing touches ScreenCaptureKit before
    /// this says yes.
    pub fn supported() -> bool {
        let v = NSOperatingSystemVersion { majorVersion: 14, minorVersion: 0, patchVersion: 0 };
        NSProcessInfo::processInfo().isOperatingSystemAtLeastVersion(v) && AnyClass::get(c"SCScreenshotManager").is_some()
    }

    /// The Screen Recording permission, without asking (never shows a prompt).
    pub fn preflight() -> bool {
        CGPreflightScreenCaptureAccess()
    }

    /// Shows the system's Screen Recording prompt (macOS shows it once; later it only opens nothing).
    pub fn request() -> bool {
        CGRequestScreenCaptureAccess()
    }

    // ---- the keys (read only) ------------------------------------------------------------------------------------

    /// The modifier keys down now, as the combined session state sees them. Reading this needs no permission.
    pub fn modifier_flags() -> u64 {
        CGEventSource::flags_state(CGEventSourceStateID::CombinedSessionState).0
    }

    pub fn seconds_since_key_down() -> Option<f64> {
        Some(CGEventSource::seconds_since_last_event_type(CGEventSourceStateID::HIDSystemState, CGEventType::KeyDown))
    }

    pub fn seconds_since_mouse_down() -> Option<f64> {
        Some(CGEventSource::seconds_since_last_event_type(CGEventSourceStateID::HIDSystemState, CGEventType::LeftMouseDown))
    }

    /// A mouse button is down right now (no permission needed): a held click opens menus and drags, so the companion
    /// steps aside (review, 12 October 2026).
    pub fn mouse_button_held() -> bool {
        use objc2_core_graphics::CGMouseButton;
        [CGMouseButton::Left, CGMouseButton::Right].into_iter().any(|b| CGEventSource::button_state(CGEventSourceStateID::CombinedSessionState, b))
    }

    unsafe fn object_for(dict: &AnyObject, key: &str) -> Option<Retained<AnyObject>> {
        let k = NSString::from_str(key);
        msg_send![dict, objectForKey: &*k]
    }

    fn number(o: &AnyObject) -> Option<&NSNumber> {
        o.downcast_ref::<NSNumber>()
    }

    /// Locked: the screen is locked, or this session is not the one at the console (fast user switching).
    pub fn screen_locked() -> bool {
        autoreleasepool(|_| {
            let Some(dict) = CGSessionCopyCurrentDictionary() else { return true };
            let d: &AnyObject = unsafe { &*(CFRetained::as_ptr(&dict).as_ptr() as *const AnyObject) };
            let flag = |key: &str| unsafe { object_for(d, key) }.and_then(|o| number(&o).map(|n| n.boolValue()));
            flag("CGSSessionScreenIsLocked").unwrap_or(false) || flag("kCGSSessionOnConsoleKey") == Some(false)
        })
    }

    // ---- apps ----------------------------------------------------------------------------------------------------

    fn front_of(a: &NSRunningApplication) -> FrontApp {
        FrontApp { pid: a.processIdentifier(), bundle_id: a.bundleIdentifier().map(|s| s.to_string()), name: a.localizedName().map(|s| s.to_string()) }
    }

    /// Runs `f` on the main thread and waits (1 s at most). Never call this from the main thread.
    fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        let (tx, rx) = mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(autoreleasepool(|_| f()));
        })
        .ok()?;
        rx.recv_timeout(Duration::from_secs(1)).ok()
    }

    /// The frontmost app, read on the main thread (1 s at most). Never call this from the main thread.
    pub fn frontmost(app: &AppHandle) -> Option<FrontApp> {
        on_main(app, || NSWorkspace::sharedWorkspace().frontmostApplication().map(|a| front_of(&a))).flatten()
    }

    /// A running app by its process id (main thread).
    pub fn app_of_pid(app: &AppHandle, pid: i32) -> Option<FrontApp> {
        on_main(app, move || NSRunningApplication::runningApplicationWithProcessIdentifier(pid).map(|a| front_of(&a))).flatten()
    }

    /// The app the person is in (L.1 step 1): the frontmost app when it is not Brenda; otherwise the owner of the first
    /// ordinary window in front of everything else that isn't Brenda's or the system's. Never call from the main thread.
    pub fn person_front(app: &AppHandle) -> Option<FrontApp> {
        let own = std::process::id() as i32;
        let front = frontmost(app);
        if let Some(f) = front.as_ref().filter(|f| f.pid != own) {
            return Some(f.clone());
        }
        let pid = first_person_window(&window_list(false), own).or_else(noted_person_front)?;
        app_of_pid(app, pid)
    }

    /// Gives the front back to `pid` (L.1 step 2), synchronously: the AppKit calls on the main thread
    /// (`yieldActivationToApplication:` then `activateFromApplication:options:`, macOS 14+; `activateWithOptions:` when
    /// either is missing), then `frontmostApplication` polled every 20 ms until it is `pid` or `timeout_ms` passed.
    /// Whether it is in front. Never call from the main thread. [UNVERIFIED: `yieldActivationToApplication:` from an
    /// accessory app]
    pub fn hand_back(app: &AppHandle, pid: i32, timeout_ms: u64) -> bool {
        if pid <= 0 || pid == std::process::id() as i32 {
            return false;
        }
        let asked = on_main(app, move || {
            let Some(target) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) else { return false };
            unsafe {
                let me = NSRunningApplication::currentApplication();
                let app_cls = AnyClass::get(c"NSApplication");
                let ns_app: Option<Retained<AnyObject>> = app_cls.and_then(|c| msg_send![c, sharedApplication]);
                let can_yield = ns_app.as_ref().is_some_and(|a| msg_send![&**a, respondsToSelector: sel!(yieldActivationToApplication:)]);
                let can_from: bool = msg_send![&*target, respondsToSelector: sel!(activateFromApplication:options:)];
                if let (true, true, Some(a)) = (can_yield, can_from, ns_app.as_ref()) {
                    let _: () = msg_send![&**a, yieldActivationToApplication: &*target];
                    let ok: bool = msg_send![&*target, activateFromApplication: &*me, options: 0usize];
                    if ok {
                        return true;
                    }
                }
                msg_send![&*target, activateWithOptions: 0usize]
            }
        })
        .unwrap_or(false);
        if !asked {
            return false;
        }
        let until = std::time::Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            if frontmost(app).is_some_and(|f| f.pid == pid) {
                return true;
            }
            if std::time::Instant::now() >= until {
                return false;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// The front app, the running apps' bundle ids, Reduce Motion and the displays' visible frames (main thread).
    pub fn env_snapshot(app: &AppHandle) -> Option<EnvSnapshot> {
        let main_h = main_height();
        on_main(app, move || {
            let ws = NSWorkspace::sharedWorkspace();
            let front = ws.frontmostApplication().map(|a| front_of(&a));
            let apps = ws.runningApplications();
            let running = apps.iter().filter_map(|a| a.bundleIdentifier().map(|s| s.to_string())).collect();
            let reduce_motion: bool = unsafe { msg_send![&*ws, accessibilityDisplayShouldReduceMotion] };
            let mut visible = Vec::new();
            if let Some(cls) = AnyClass::get(c"NSScreen") {
                let screens: Option<Retained<NSArray<AnyObject>>> = unsafe { msg_send![cls, screens] };
                for s in screens.iter().flat_map(|a| a.iter()) {
                    let r: NSRectC = unsafe { msg_send![&*s, visibleFrame] };
                    let desc: Option<Retained<AnyObject>> = unsafe { msg_send![&*s, deviceDescription] };
                    let id = desc.and_then(|d| unsafe { object_for(&d, "NSScreenNumber") }).and_then(|n| number(&n).map(|n| n.unsignedIntValue()));
                    if let Some(id) = id {
                        visible.push((id, Bounds { x: r.origin.x, y: main_h - (r.origin.y + r.size.y), w: r.size.x, h: r.size.y }));
                    }
                }
            }
            EnvSnapshot { front, running, reduce_motion, visible }
        })
    }

    // ---- windows and displays ------------------------------------------------------------------------------------

    /// The on-screen windows, front to back: number, owner, layer, alpha, bounds and owner name. Titles are never read.
    /// With `include_desktop`, the desktop's own windows (the picture and the icons) are listed too.
    pub fn window_list(include_desktop: bool) -> Vec<WindowInfo> {
        autoreleasepool(|_| {
            let mut options = CGWindowListOption::OptionOnScreenOnly;
            if !include_desktop {
                options |= CGWindowListOption::ExcludeDesktopElements;
            }
            let Some(list) = CGWindowListCopyWindowInfo(options, 0) else { return Vec::new() };
            // A CFArray of CFDictionaries is toll-free bridged to NSArray of NSDictionary.
            let arr: &AnyObject = unsafe { &*(CFRetained::as_ptr(&list).as_ptr() as *const AnyObject) };
            let count: usize = unsafe { msg_send![arr, count] };
            let mut out = Vec::with_capacity(count);
            for i in 0..count {
                let d: Retained<AnyObject> = unsafe { msg_send![arr, objectAtIndex: i] };
                let num = |key: &str| unsafe { object_for(&d, key) }.and_then(|o| number(&o).map(|n| n.doubleValue()));
                let Some(bounds) = (unsafe { object_for(&d, "kCGWindowBounds") }) else { continue };
                let b = |key: &str| unsafe { object_for(&bounds, key) }.and_then(|o| number(&o).map(|n| n.doubleValue())).unwrap_or(0.0);
                let owner_name = unsafe { object_for(&d, "kCGWindowOwnerName") }.and_then(|o| o.downcast_ref::<NSString>().map(|s| s.to_string())).unwrap_or_default();
                let (Some(id), Some(pid)) = (num("kCGWindowNumber"), num("kCGWindowOwnerPID")) else { continue };
                out.push(WindowInfo {
                    id: id as u32,
                    pid: pid as i32,
                    layer: num("kCGWindowLayer").unwrap_or(0.0) as i64,
                    alpha: num("kCGWindowAlpha").unwrap_or(1.0),
                    bounds: Bounds { x: b("X"), y: b("Y"), w: b("Width"), h: b("Height") },
                    owner_name,
                });
            }
            out
        })
    }

    /// The height of the main display in points (Cocoa's y runs up from its bottom edge).
    pub(crate) fn main_height() -> f64 {
        CGDisplayBounds(CGMainDisplayID()).size.height
    }

    /// The pointer in top-left global points (as `island.rs` reads it).
    pub fn pointer_top_left() -> Option<(f64, f64)> {
        let p = NSEvent::mouseLocation();
        let h = main_height();
        (h > 0.0).then(|| look::cocoa_to_top_left(p.x, p.y, h))
    }

    fn bounds_of(id: u32) -> Bounds {
        let r = CGDisplayBounds(id);
        Bounds { x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height }
    }

    /// The active displays and their bounds (global top-left points).
    pub fn displays() -> Vec<(u32, Bounds)> {
        let mut ids = [0u32; 16];
        let mut n = 0u32;
        let err = unsafe { CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut n) };
        if err.0 != 0 {
            return Vec::new();
        }
        ids[..n as usize].iter().map(|&id| (id, bounds_of(id))).collect()
    }

    /// The display under a global point.
    pub fn display_under(p: (f64, f64)) -> Option<(u32, Bounds)> {
        let mut id = 0u32;
        let mut n = 0u32;
        let err = unsafe { CGGetDisplaysWithPoint(CGPoint { x: p.0, y: p.1 }, 1, &mut id, &mut n) };
        (err.0 == 0 && n > 0).then(|| (id, bounds_of(id)))
    }

    /// The display is mirrored (the companion hides, B.4.6). `CGDisplayIsCaptured` is deprecated ("no longer
    /// supported") in the macOS 26 SDK, so a captured display is not detected (12 October 2026).
    pub fn display_mirrored_or_captured(id: u32) -> bool {
        CGDisplayIsInMirrorSet(id) || CGDisplayMirrorsDisplay(id) != 0
    }

    // ---- ScreenCaptureKit ----------------------------------------------------------------------------------------

    fn content() -> Result<Retained<SCShareableContent>, String> {
        let failed = || "I couldn't take the picture.".to_string();
        let (tx, rx) = mpsc::channel::<Handoff<Option<Retained<SCShareableContent>>>>();
        let handler = RcBlock::new(move |content: *mut SCShareableContent, _error: *mut objc2_foundation::NSError| {
            let content = unsafe { Retained::retain(content) };
            let _ = tx.send(Handoff(content));
        });
        // `false`: the desktop and its icons are part of the picture (owner request, 12 October 2026).
        unsafe { SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(false, true, &handler) };
        let Ok(Handoff(content)) = rx.recv_timeout(SC_TIMEOUT) else { return Err(failed()) };
        content.ok_or_else(failed)
    }

    /// One native picture of the display (or of `source`, display-relative points), the excluded apps left out, plus
    /// the hatched regions (global points) and the hidden apps' names.
    struct Native {
        image: CFRetained<CGImage>,
        scale: f64,
        hatch: Vec<Bounds>,
        hidden: Vec<String>,
    }

    fn capture_native(id: u32, bounds: Bounds, exclude: &dyn Fn(&AppMeta) -> Exclude, source: Option<Bounds>) -> Result<Native, String> {
        let failed = || "I couldn't take the picture.".to_string();
        if !preflight() {
            return Err(failed());
        }
        let content = content()?;
        autoreleasepool(|_| {
            let displays = unsafe { content.displays() };
            let display: Retained<SCDisplay> = displays.iter().find(|d| unsafe { d.displayID() } == id).ok_or_else(failed)?;
            let mut excluded: Vec<Retained<SCRunningApplication>> = Vec::new();
            let mut hidden_pids: Vec<i32> = Vec::new();
            let mut excluded_pids: Vec<i32> = Vec::new();
            let mut hidden: Vec<String> = Vec::new();
            for a in unsafe { content.applications() }.iter() {
                let (pid, bundle, name) = unsafe { (a.processID(), a.bundleIdentifier().to_string(), a.applicationName().to_string()) };
                let meta = AppMeta { pid, bundle_id: Some(bundle.as_str()).filter(|b| !b.is_empty()), name: &name };
                match exclude(&meta) {
                    Exclude::No => {}
                    Exclude::Own => {
                        excluded_pids.push(pid);
                        excluded.push(a.clone());
                    }
                    Exclude::Hidden(n) => {
                        excluded_pids.push(pid);
                        hidden_pids.push(pid);
                        excluded.push(a.clone());
                        if !hidden.contains(&n) && hidden.len() < MAX_HIDDEN {
                            hidden.push(n);
                        }
                    }
                }
            }
            let apps = NSArray::from_retained_slice(&excluded);
            let none = NSArray::new();
            let filter = unsafe { SCContentFilter::initWithDisplay_excludingApplications_exceptingWindows(SCContentFilter::alloc(), &display, &apps, &none) };
            let responds: bool = unsafe { msg_send![&*filter, respondsToSelector: sel!(setIncludeMenuBar:)] };
            if responds {
                unsafe { filter.setIncludeMenuBar(true) };
            }
            let mut scale = unsafe { filter.pointPixelScale() } as f64;
            if !(scale.is_finite() && scale >= 1.0) {
                scale = if unsafe { display.width() } as f64 > bounds.w + 1.0 { 2.0 } else { 1.0 };
            }
            let area = source.unwrap_or(Bounds { x: 0.0, y: 0.0, w: bounds.w, h: bounds.h });
            let config = unsafe { SCStreamConfiguration::new() };
            unsafe {
                config.setWidth((area.w * scale).round().max(1.0) as usize);
                config.setHeight((area.h * scale).round().max(1.0) as usize);
                if source.is_some() {
                    config.setSourceRect(CGRect { origin: CGPoint { x: area.x, y: area.y }, size: CGSize { width: area.w, height: area.h } });
                }
                config.setShowsCursor(false);
                config.setCapturesAudio(false);
                config.setCaptureResolution(SCCaptureResolutionType::Best);
                config.setIgnoreShadowsDisplay(true);
            }
            let (tx, rx) = mpsc::channel::<Handoff<Option<CFRetained<CGImage>>>>();
            let handler = RcBlock::new(move |image: *mut CGImage, _error: *mut objc2_foundation::NSError| {
                // Retained here: the image is only guaranteed for the handler's duration.
                let image = NonNull::new(image).map(|p| unsafe { CFRetained::retain(p) });
                let _ = tx.send(Handoff(image));
            });
            unsafe { SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(&filter, &config, Some(&handler)) };
            let Ok(Handoff(image)) = rx.recv_timeout(SC_TIMEOUT) else { return Err(failed()) };
            let image = image.ok_or_else(failed)?;
            // Hatching: the hidden apps' windows, minus every window of a shown app in front of them.
            let mut hatch = Vec::new();
            if !hidden_pids.is_empty() {
                let list = window_list(true);
                for (i, w) in list.iter().enumerate() {
                    if !hidden_pids.contains(&w.pid) || w.alpha <= 0.0 {
                        continue;
                    }
                    let Some(on_display) = intersect(w.bounds, bounds) else { continue };
                    let in_front: Vec<Bounds> = list[..i].iter().filter(|f| !excluded_pids.contains(&f.pid) && f.alpha > 0.0).map(|f| f.bounds).collect();
                    hatch.extend(visible_regions(&[on_display], &in_front));
                }
            }
            Ok(Native { image, scale, hatch, hidden })
        })
    }

    /// A bitmap we own, drawn into by CoreGraphics; zeroed when dropped (after the image and the context that use it).
    struct Canvas {
        image: Option<CFRetained<CGImage>>,
        ctx: Option<CFRetained<CGContext>>,
        buf: Vec<u8>,
    }

    impl Drop for Canvas {
        fn drop(&mut self) {
            self.image = None;
            self.ctx = None;
            wipe(&mut self.buf);
        }
    }

    fn rect(x: f64, y: f64, w: f64, h: f64) -> CGRect {
        CGRect { origin: CGPoint { x, y }, size: CGSize { width: w, height: h } }
    }

    /// Draws `src` into a new `w` × `h` sRGB bitmap (white behind), the hatching over `hatch` (picture pixels, top-left
    /// origin; `px_per_pt` sizes its lines), then the ring at `pointer` with radius 15 × `ring_scale` (at least 10).
    fn compose(src: &CGImage, w: u32, h: u32, pointer: Option<Point>, ring_scale: f64, hatch: &[Bounds], px_per_pt: f64) -> Option<Canvas> {
        let (w, h) = (w as usize, h as usize);
        let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))?;
        let mut canvas = Canvas { image: None, ctx: None, buf: vec![0u8; w * h * 4] };
        let ctx = unsafe { CGBitmapContextCreate(canvas.buf.as_mut_ptr().cast(), w, h, 8, w * 4, Some(&space), CGImageAlphaInfo::NoneSkipLast.0) }?;
        let c = Some(&*ctx);
        let (wf, hf) = (w as f64, h as f64);
        CGContext::set_rgb_fill_color(c, 1.0, 1.0, 1.0, 1.0);
        CGContext::fill_rect(c, rect(0.0, 0.0, wf, hf));
        CGContext::set_interpolation_quality(c, CGInterpolationQuality::High);
        CGContext::draw_image(c, rect(0.0, 0.0, wf, hf), Some(src));
        for r in hatch {
            // CoreGraphics counts y up from the bottom.
            let cg = rect(r.x, hf - (r.y + r.h), r.w, r.h);
            CGContext::save_g_state(c);
            CGContext::clip_to_rect(c, cg);
            CGContext::set_rgb_fill_color(c, HATCH_FILL, HATCH_FILL, HATCH_FILL, 1.0);
            CGContext::fill_rect(c, cg);
            CGContext::set_rgb_stroke_color(c, HATCH_LINE, HATCH_LINE, HATCH_LINE, 1.0);
            CGContext::set_line_width(c, (HATCH_WIDTH_PT * px_per_pt).max(1.0));
            let step = (HATCH_STEP_PT * px_per_pt).max(4.0);
            let mut d = -cg.size.height;
            while d < cg.size.width {
                CGContext::move_to_point(c, cg.origin.x + d, cg.origin.y);
                CGContext::add_line_to_point(c, cg.origin.x + d + cg.size.height, cg.origin.y + cg.size.height);
                d += step;
            }
            CGContext::stroke_path(c);
            CGContext::restore_g_state(c);
        }
        if let Some(p) = pointer {
            let (cx, cy) = (p.x as f64 + 0.5, hf - p.y as f64 - 0.5);
            let r = (look::MARKER_RADIUS * ring_scale).max(RING_MIN_PX);
            let k = r / look::MARKER_RADIUS;
            let ring = rect(cx - r, cy - r, 2.0 * r, 2.0 * r);
            CGContext::set_rgb_stroke_color(c, 1.0, 1.0, 1.0, 1.0);
            CGContext::set_line_width(c, look::MARKER_WHITE_WIDTH * k.max(0.5));
            CGContext::stroke_ellipse_in_rect(c, ring);
            let (or, og, ob) = look::MARKER_ORANGE;
            CGContext::set_rgb_stroke_color(c, or, og, ob, 1.0);
            CGContext::set_line_width(c, look::MARKER_ORANGE_WIDTH * k.max(0.5));
            CGContext::stroke_ellipse_in_rect(c, ring);
        }
        canvas.image = Some(CGBitmapContextCreateImage(c)?);
        canvas.ctx = Some(ctx);
        Some(canvas)
    }

    /// The image as JPEG at quality `q`, copied into a buffer we own.
    fn jpeg(image: &CGImage, q: f64) -> Option<Vec<u8>> {
        autoreleasepool(|_| {
            let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), image);
            let factor = NSNumber::new_f64(q);
            let key = unsafe { NSImageCompressionFactor };
            let props = NSDictionary::<objc2_app_kit::NSBitmapImageRepPropertyKey, AnyObject>::from_slices(&[key], &[&*factor as &AnyObject]);
            let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::JPEG, &props) }?;
            Some(data.to_vec())
        })
    }

    /// Composes `src` (a picture of `area`, global points) at `w` × `h` and encodes it under `max` bytes: each of
    /// `qualities`, then the size × `retry` and again (8 rounds at most).
    #[allow(clippy::too_many_arguments)]
    fn encode(src: &CGImage, area: Bounds, w: u32, h: u32, pointer: Option<(f64, f64)>, hatch: &[Bounds], qualities: &[f64], retry: f64, max: usize) -> Result<Pic, String> {
        let (mut w, mut h) = (w, h);
        for _ in 0..8 {
            let px_per_pt = w as f64 / area.w;
            let pt = pointer.map(|p| map_pointer_display(p, area, w, h));
            let hatch_px: Vec<Bounds> = hatch.iter().filter_map(|r| to_pixels(*r, area, w, h)).collect();
            let canvas = compose(src, w, h, pt, px_per_pt, &hatch_px, px_per_pt).ok_or("I couldn't take the picture.")?;
            let image = canvas.image.as_ref().expect("composed");
            for q in qualities {
                let mut bytes = jpeg(image, *q).ok_or("I couldn't take the picture.")?;
                if bytes.len() <= max {
                    return Ok(Pic { jpeg: bytes, width: w, height: h, pointer: pt });
                }
                wipe(&mut bytes);
            }
            drop(canvas);
            w = ((w as f64 * retry).floor() as u32).max(16);
            h = ((h as f64 * retry).floor() as u32).max(16);
        }
        Err("That screen is too big to send.".into())
    }

    /// The look's pictures (B.2 steps 2–11): the display under the pointer, its two pictures and, with "Show me the
    /// picture first" on, the preview.
    pub fn capture_display(id: u32, bounds: Bounds, exclude: &dyn Fn(&AppMeta) -> Exclude, pointer: Option<(f64, f64)>, with_crop: bool, preview: bool) -> Result<DisplayShot, String> {
        if bounds.w < 1.0 || bounds.h < 1.0 {
            return Err("I couldn't take the picture.".into());
        }
        let native = capture_native(id, bounds, exclude, None)?;
        let nw = CGImage::width(Some(&native.image)) as u32;
        let nh = CGImage::height(Some(&native.image)) as u32;
        let (sw, sh) = fit_long_edge(nw, nh, SCREEN_LONG_EDGE);
        let screen = encode(&native.image, bounds, sw, sh, pointer, &native.hatch, &SCREEN_QUALITIES, SCREEN_RETRY, SCREEN_MAX_BYTES)?;
        let mut crop = None;
        let mut crop_geom = None;
        if let (true, Some(p)) = (with_crop, pointer) {
            let area = crop_square(p, bounds, CROP_PT);
            let px = rect((area.x - bounds.x) * nw as f64 / bounds.w, (area.y - bounds.y) * nh as f64 / bounds.h, area.w * nw as f64 / bounds.w, area.h * nh as f64 / bounds.h);
            if let Some(part) = CGImage::with_image_in_rect(Some(&native.image), px) {
                let (cw, ch) = (CGImage::width(Some(&part)) as u32, CGImage::height(Some(&part)) as u32);
                let pic = encode(&part, area, cw, ch, pointer, &native.hatch, &CROP_QUALITIES, SCREEN_RETRY, CROP_MAX_BYTES)?;
                crop_geom = Some(CropGeom { area, w: pic.width, h: pic.height });
                crop = Some(pic);
            }
        }
        let preview = if preview { preview_of_jpeg(&screen) } else { None };
        let geometry = LookGeometry { display_id: id, display: bounds, scale: native.scale, screen_w: screen.width, screen_h: screen.height, crop: crop_geom };
        Ok(DisplayShot { screen, crop, geometry, hidden: native.hidden, preview })
    }

    /// A screen task's screenshot (B.7.3): the task's display, the same exclusions and hatching, 1,280 pixels.
    pub fn act_screenshot(id: u32, bounds: Bounds, exclude: &dyn Fn(&AppMeta) -> Exclude) -> Result<crate::input::Image, String> {
        let native = capture_native(id, bounds, exclude, None)?;
        let nw = CGImage::width(Some(&native.image)) as u32;
        let nh = CGImage::height(Some(&native.image)) as u32;
        let (w, h) = fit_long_edge(nw, nh, ACT_SHOT_LONG_EDGE);
        let mut pic = encode(&native.image, bounds, w, h, None, &native.hatch, &ACT_QUALITIES, ACT_RETRY, ACT_SHOT_MAX_BYTES)?;
        Ok(crate::input::Image { jpeg: std::mem::take(&mut pic.jpeg), width: pic.width, height: pic.height })
    }

    /// `zoom` (B.7.3): `region` (global points) at native pixels, fitted within `fit` (the step screenshot's size).
    pub fn act_zoom(id: u32, bounds: Bounds, region: Bounds, fit: (u32, u32), exclude: &dyn Fn(&AppMeta) -> Exclude) -> Result<crate::input::Image, String> {
        let region = intersect(region, bounds).ok_or("Not executed: that region is off the screen.")?;
        let rel = Bounds { x: region.x - bounds.x, y: region.y - bounds.y, w: region.w, h: region.h };
        let native = capture_native(id, bounds, exclude, Some(rel))?;
        let nw = CGImage::width(Some(&native.image)) as u32;
        let nh = CGImage::height(Some(&native.image)) as u32;
        let s = 1f64.min(fit.0 as f64 / nw.max(1) as f64).min(fit.1 as f64 / nh.max(1) as f64);
        let (w, h) = (((nw as f64 * s).round() as u32).max(1), ((nh as f64 * s).round() as u32).max(1));
        let mut pic = encode(&native.image, region, w, h, None, &native.hatch, &ACT_QUALITIES, ACT_RETRY, ACT_SHOT_MAX_BYTES)?;
        Ok(crate::input::Image { jpeg: std::mem::take(&mut pic.jpeg), width: pic.width, height: pic.height })
    }

    /// "Take a screenshot" (helpers-spec C): the display at full resolution, Brenda's own windows left out (only hers:
    /// the person asked for a picture of their own screen), nothing hatched, as a PNG. It goes only to their Desktop.
    pub fn screenshot_png(id: u32, bounds: Bounds) -> Result<Vec<u8>, String> {
        let own = std::process::id() as i32;
        let exclude = move |m: &AppMeta| if m.pid == own || m.bundle_id.is_some_and(|b| b.eq_ignore_ascii_case(look::OWN_BUNDLE_ID)) { Exclude::Own } else { Exclude::No };
        let native = capture_native(id, bounds, &exclude, None)?;
        autoreleasepool(|_| {
            let rep = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &native.image);
            let props = NSDictionary::<objc2_app_kit::NSBitmapImageRepPropertyKey, AnyObject>::new();
            let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &props) }.ok_or("I couldn't take the screenshot.")?;
            Ok(data.to_vec())
        })
    }

    /// A picture file (PNG, JPEG, HEIC, WebP, GIF) fitted to `long` pixels and re-encoded as a JPEG under `max` bytes
    /// (file work, B.9.2). Decoded by AppKit; nothing is written anywhere.
    pub fn image_file_to_jpeg(bytes: &[u8], long: u32, max: usize) -> Option<(Vec<u8>, u32, u32)> {
        autoreleasepool(|_| {
            let data = objc2_foundation::NSData::with_bytes(bytes);
            let rep: Option<Retained<NSBitmapImageRep>> = unsafe { msg_send![<NSBitmapImageRep as objc2::ClassType>::class(), imageRepWithData: &*data] };
            let rep = rep?;
            let cg: Option<NonNull<CGImage>> = unsafe { msg_send![&*rep, CGImage] };
            let cg = unsafe { CFRetained::retain(cg?) };
            let (nw, nh) = (CGImage::width(Some(&cg)) as u32, CGImage::height(Some(&cg)) as u32);
            let (w, h) = fit_long_edge(nw, nh, long);
            let area = Bounds { x: 0.0, y: 0.0, w: nw as f64, h: nh as f64 };
            let mut pic = encode(&cg, area, w, h, None, &[], &SCREEN_QUALITIES, SCREEN_RETRY, max).ok()?;
            Some((std::mem::take(&mut pic.jpeg), pic.width, pic.height))
        })
    }

    /// The screen picture fitted to 720 × 440, JPEG 0.7, as a `data:` URL for the preview card (only with "Show me the
    /// picture first" on).
    fn preview_of_jpeg(screen: &Pic) -> Option<String> {
        autoreleasepool(|_| {
            let data = objc2_foundation::NSData::with_bytes(&screen.jpeg);
            let rep: Option<Retained<NSBitmapImageRep>> = unsafe { msg_send![<NSBitmapImageRep as objc2::ClassType>::class(), imageRepWithData: &*data] };
            let cg: Option<NonNull<CGImage>> = unsafe { msg_send![&*rep?, CGImage] };
            let cg = unsafe { CFRetained::retain(cg?) };
            preview_of(&cg, screen.width, screen.height)
        })
    }

    fn preview_of(image: &CGImage, w: u32, h: u32) -> Option<String> {
        use base64::Engine;
        let (pw, ph) = look::fit_within(w, h, look::PREVIEW_W, look::PREVIEW_H);
        let canvas = compose(image, pw, ph, None, 1.0, &[], 1.0)?;
        let mut bytes = jpeg(canvas.image.as_ref()?, look::PREVIEW_QUALITY)?;
        let url = format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes));
        wipe(&mut bytes);
        Some(url)
    }

    #[cfg(test)]
    pub mod test_hooks {
        use super::*;

        pub struct Composed(Canvas);

        /// A flat grey picture, standing in for a captured display.
        pub fn grey_image(w: usize, h: usize) -> CFRetained<CGImage> {
            let space = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB })).unwrap();
            let mut buf = vec![128u8; w * h * 4];
            let ctx = unsafe { CGBitmapContextCreate(buf.as_mut_ptr().cast(), w, h, 8, w * 4, Some(&space), CGImageAlphaInfo::NoneSkipLast.0) }.unwrap();
            let image = CGBitmapContextCreateImage(Some(&ctx)).unwrap();
            // Copy-on-write: draw into a fresh context so the image no longer needs `buf`.
            let copy = compose(&image, w as u32, h as u32, None, 1.0, &[], 1.0).unwrap();
            drop(image);
            drop(ctx);
            drop(buf);
            let mut copy = copy;
            copy.image.take().unwrap()
        }

        pub fn compose_for_test(src: &CGImage, w: u32, h: u32, pointer: Option<Point>, hatch: &[Bounds]) -> Composed {
            Composed(compose(src, w, h, pointer, 1.0, hatch, 1.0).unwrap())
        }

        pub fn pixel(c: &Composed, w: usize, x: usize, y: usize) -> (u8, u8, u8) {
            let i = (y * w + x) * 4;
            (c.0.buf[i], c.0.buf[i + 1], c.0.buf[i + 2])
        }

        pub fn jpeg_for_test(c: &Composed, q: f64) -> Vec<u8> {
            jpeg(c.0.image.as_ref().unwrap(), q).unwrap()
        }

        pub fn preview_for_test(c: &Composed, w: u32, h: u32) -> String {
            preview_of(c.0.image.as_ref().unwrap(), w, h).unwrap()
        }

        pub fn encode_for_test(src: &CGImage, area: Bounds, w: u32, h: u32, max: usize) -> Result<(u32, u32, usize), String> {
            encode(src, area, w, h, None, &[], &ACT_QUALITIES, ACT_RETRY, max).map(|p| (p.width, p.height, p.jpeg.len()))
        }
    }

    // ---- the outline ---------------------------------------------------------------------------------------------

    #[repr(C)]
    #[derive(Clone, Copy)]
    pub(crate) struct NSPointC {
        pub x: f64,
        pub y: f64,
    }
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub(crate) struct NSRectC {
        pub origin: NSPointC,
        pub size: NSPointC,
    }
    unsafe impl objc2::encode::Encode for NSPointC {
        const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]);
    }
    unsafe impl objc2::encode::Encode for NSRectC {
        const ENCODING: objc2::encode::Encoding = objc2::encode::Encoding::Struct(
            "CGRect",
            &[
                objc2::encode::Encoding::Struct("CGPoint", &[f64::ENCODING, f64::ENCODING]),
                objc2::encode::Encoding::Struct("CGSize", &[f64::ENCODING, f64::ENCODING]),
            ],
        );
    }

    /// A Cocoa frame (bottom-left origin) for a rectangle in global top-left points.
    pub(crate) fn cocoa_frame(r: Bounds) -> NSRectC {
        let h = main_height();
        NSRectC { origin: NSPointC { x: r.x, y: h - (r.y + r.h) }, size: NSPointC { x: r.w, y: r.h } }
    }

    const OUTLINE: &str = "look-outline";
    /// Under the island (1001), over ordinary windows and each app's menu titles' level.
    const OUTLINE_LEVEL: isize = 1000;
    /// canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary, as the island.
    const OUTLINE_BEHAVIOUR: usize = 1 | 16 | 64 | 256;
    const FLASH: &str = "document.documentElement.classList.remove(\"flash\");void document.documentElement.offsetWidth;document.documentElement.classList.add(\"flash\");";

    /// The soft outline round the captured display (B.2 step 12): a click-through, unfocusable, content-protected window
    /// over the display, inset 4 points, shown for 700 ms. Created on the first look and reused. It makes no IPC calls.
    pub fn flash_outline(app: &AppHandle, frame: Bounds) {
        let window = match app.get_webview_window(OUTLINE) {
            Some(w) => w,
            None => {
                let built = WebviewWindowBuilder::new(app, OUTLINE, WebviewUrl::App("outline.html".into()))
                    .title("Brenda is looking")
                    .transparent(true)
                    .decorations(false)
                    .shadow(false)
                    .always_on_top(true)
                    .skip_taskbar(true)
                    .focused(false)
                    .focusable(false)
                    .visible(false)
                    .resizable(false)
                    .visible_on_all_workspaces(true)
                    .content_protected(true)
                    .disable_drag_drop_handler()
                    .build();
                match built {
                    Ok(w) => {
                        let _ = w.set_ignore_cursor_events(true);
                        // The first time, give outline.html a moment to load, or the first flash has no ring to show.
                        std::thread::sleep(Duration::from_millis(250));
                        w
                    }
                    Err(_) => return,
                }
            }
        };
        let inset = Bounds { x: frame.x + OUTLINE_INSET, y: frame.y + OUTLINE_INSET, w: (frame.w - 2.0 * OUTLINE_INSET).max(1.0), h: (frame.h - 2.0 * OUTLINE_INSET).max(1.0) };
        let r = cocoa_frame(inset);
        let w = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(ns) = w.ns_window() {
                let ns = ns as *mut AnyObject;
                if !ns.is_null() {
                    unsafe {
                        let _: () = msg_send![&*ns, setLevel: OUTLINE_LEVEL];
                        let _: () = msg_send![&*ns, setCollectionBehavior: OUTLINE_BEHAVIOUR];
                        let _: () = msg_send![&*ns, setFrame: r, display: true];
                        let _: () = msg_send![&*ns, orderFrontRegardless];
                    }
                }
            }
        });
        let _ = window.eval(FLASH);
        let w = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(OUTLINE_MS));
            let w2 = w.clone();
            let _ = w.run_on_main_thread(move || {
                if let Ok(ns) = w2.ns_window() {
                    let ns = ns as *mut AnyObject;
                    if !ns.is_null() {
                        unsafe {
                            let _: () = msg_send![&*ns, orderOut: std::ptr::null::<AnyObject>()];
                        }
                    }
                }
            });
        });
    }
}

#[cfg(test)]
mod pure_tests {
    use super::*;

    fn win(pid: i32, owner: &str, layer: i64, alpha: f64) -> crate::look::WindowInfo {
        crate::look::WindowInfo { id: pid as u32, pid, layer, alpha, bounds: Bounds { x: 0.0, y: 0.0, w: 800.0, h: 600.0 }, owner_name: owner.into() }
    }

    /// L.1 (ignored; the integrator's Mac): which app `person_front` would hand the front back to, from the real window
    /// list. Reads only window owners; touches nothing.
    #[test]
    #[ignore]
    fn hand_back_live() {
        let list = window_list(false);
        let own = std::process::id() as i32;
        let pid = first_person_window(&list, own);
        let owner = pid.and_then(|p| list.iter().find(|w| w.pid == p)).map(|w| w.owner_name.clone());
        println!("the person's app: {pid:?} {owner:?} ({} windows on screen)", list.len());
        assert!(pid.is_some_and(|p| p != own));
    }

    /// L.1: the person's app is the first ordinary window that isn't Brenda's or the system's.
    #[test]
    fn first_person_window_skips_brenda_and_system() {
        let own = 500;
        let list = vec![
            win(own, "Brenda", 0, 1.0),
            win(1, "Dock", 20, 1.0),
            win(2, "Window Server", 25, 1.0),
            win(3, "SystemUIServer", 0, 1.0),
            win(4, "Control Centre", 0, 1.0),
            win(5, "Figma", 0, 0.0),
            win(6, "Figma", 0, 1.0),
            win(7, "Slack", 0, 1.0),
        ];
        assert_eq!(first_person_window(&list, own), Some(6), "invisible windows and other layers are skipped too");
        assert_eq!(first_person_window(&[win(own, "Brenda", 0, 1.0), win(1, "Dock", 0, 1.0)], own), None);
        let mut tiny = win(8, "Zoom", 0, 1.0);
        tiny.bounds.w = 1.0;
        assert_eq!(first_person_window(&[tiny, win(9, "Notes", 0, 1.0)], own), Some(9));
    }

    fn b(x: f64, y: f64, w: f64, h: f64) -> Bounds {
        Bounds { x, y, w, h }
    }

    fn patches(w: u32, h: u32) -> u32 {
        w.div_ceil(28) * h.div_ceil(28)
    }

    /// Screen and close-up sizes over a grid of displays at 1× and 2× (B.13 `capture::sizes`).
    #[test]
    fn sizes() {
        assert_eq!(fit_long_edge(3024, 1964, SCREEN_LONG_EDGE), (1568, 1018));
        assert_eq!(fit_long_edge(1024, 768, SCREEN_LONG_EDGE), (1024, 768), "never enlarged");
        assert_eq!(fit_long_edge(3024, 1964, ACT_SHOT_LONG_EDGE), (1280, 831));
        for scale in [1.0, 2.0] {
            for (w, h) in [(1280.0, 800.0), (1440.0, 900.0), (1512.0, 982.0), (1728.0, 1117.0), (1920.0, 1080.0), (2560.0, 1440.0), (3008.0, 1692.0), (1080.0, 1920.0)] {
                let (nw, nh) = ((w * scale) as u32, (h * scale) as u32);
                let (sw, sh) = fit_long_edge(nw, nh, SCREEN_LONG_EDGE);
                assert!(sw.max(sh) <= SCREEN_LONG_EDGE);
                assert!(((sw as f64 / sh as f64) - w / h).abs() < 0.01, "{w}x{h}");
                assert!(patches(sw, sh) <= 4_784, "{w}x{h}@{scale}: {}", patches(sw, sh));
                let crop = crop_square((w / 2.0, h / 2.0), b(0.0, 0.0, w, h), CROP_PT);
                let (cw, ch) = ((crop.w * scale) as u32, (crop.h * scale) as u32);
                assert_eq!((cw, ch), ((448.0 * scale) as u32, (448.0 * scale) as u32));
                assert!(patches(cw, ch) <= 4_784);
                let (aw, ah) = fit_long_edge(nw, nh, ACT_SHOT_LONG_EDGE);
                assert!(aw.max(ah) <= ACT_SHOT_LONG_EDGE);
            }
        }
    }

    #[test]
    fn crop_stays_inside() {
        let d = b(0.0, 0.0, 1512.0, 982.0);
        assert_eq!(crop_square((756.0, 491.0), d, 448.0), b(532.0, 267.0, 448.0, 448.0));
        assert_eq!(crop_square((5.0, 5.0), d, 448.0), b(0.0, 0.0, 448.0, 448.0), "top-left corner");
        assert_eq!(crop_square((1510.0, 980.0), d, 448.0), b(1064.0, 534.0, 448.0, 448.0), "bottom-right corner");
        // A secondary display to the left, above the main one.
        let left = b(-1920.0, -300.0, 1920.0, 1080.0);
        assert_eq!(crop_square((-1919.0, -299.0), left, 448.0), b(-1920.0, -300.0, 448.0, 448.0));
        // A display smaller than the square.
        assert_eq!(crop_square((100.0, 100.0), b(0.0, 0.0, 300.0, 200.0), 448.0), b(0.0, 0.0, 300.0, 200.0));
    }

    #[test]
    fn visible_regions_subtract_what_is_in_front() {
        let e = b(0.0, 0.0, 100.0, 100.0);
        assert_eq!(visible_regions(&[e], &[]), vec![e]);
        assert!(visible_regions(&[e], &[b(-10.0, -10.0, 200.0, 200.0)]).is_empty(), "fully covered");
        let parts = visible_regions(&[e], &[b(25.0, 25.0, 50.0, 50.0)]);
        let area: f64 = parts.iter().map(|p| p.w * p.h).sum();
        assert!((area - (10_000.0 - 2_500.0)).abs() < 1e-6, "a hole in the middle");
        for p in &parts {
            assert!(intersect(*p, b(25.0, 25.0, 50.0, 50.0)).is_none());
        }
        let parts = visible_regions(&[e], &[b(50.0, 0.0, 100.0, 100.0)]);
        assert_eq!(parts, vec![b(0.0, 0.0, 50.0, 100.0)], "the right half covered");
        let parts = visible_regions(&[e], &[b(0.0, 0.0, 100.0, 40.0), b(0.0, 60.0, 100.0, 40.0)]);
        assert_eq!(parts, vec![b(0.0, 40.0, 100.0, 20.0)], "two in front");
        assert_eq!(visible_regions(&[e], &[b(200.0, 200.0, 10.0, 10.0)]), vec![e], "elsewhere");
        assert_eq!(subtract(e, b(0.0, 0.0, 100.0, 100.0)), Vec::<Bounds>::new());
    }

    #[test]
    fn map_pointer_display_clamps_inside() {
        let d = b(0.0, 0.0, 1512.0, 982.0);
        assert_eq!(map_pointer_display((756.0, 491.0), d, 1568, 1018), Point { x: 784, y: 509 });
        assert_eq!(map_pointer_display((1512.0, 982.0), d, 1568, 1018), Point { x: 1567, y: 1017 }, "the far edge is clamped");
        assert_eq!(map_pointer_display((-3.0, -1.0), d, 1568, 1018), Point { x: 0, y: 0 });
        let left = b(-1920.0, -300.0, 1920.0, 1080.0);
        assert_eq!(map_pointer_display((-960.0, 240.0), left, 1568, 882), Point { x: 784, y: 441 });
        assert_eq!(to_pixels(b(-1920.0, -300.0, 960.0, 540.0), left, 1568, 882), Some(b(0.0, 0.0, 784.0, 441.0)));
        assert_eq!(to_pixels(b(5000.0, 0.0, 10.0, 10.0), left, 1568, 882), None);
        assert_eq!(display_at((-5.0, 10.0), &[(1, b(0.0, 0.0, 1512.0, 982.0)), (2, left)]), Some((2, left)));
        assert_eq!(display_at((3000.0, 10.0), &[(1, b(0.0, 0.0, 1512.0, 982.0))]), None);
    }
}

/// The drawing and encoding half of the capture, on a picture made here (no Screen Recording, no ScreenCaptureKit).
#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::mac::test_hooks::*;
    use crate::look::{Bounds, Point};

    #[test]
    fn the_marker_is_drawn_at_the_pointer_and_the_jpeg_is_a_jpeg() {
        let src = grey_image(200, 100);
        let canvas = compose_for_test(&src, 200, 100, Some(Point { x: 100, y: 50 }), &[]);
        let px = |x: usize, y: usize| pixel(&canvas, 200, x, y);
        // On the orange ring, 15 px right of the pointer (memory rows run top to bottom).
        let (r, g, b) = px(115, 50);
        assert!(r > 200 && (50..170).contains(&g) && b < 90, "ring pixel {r},{g},{b}");
        // The thing under the pointer stays visible: no fill.
        assert_eq!(px(100, 50), (128, 128, 128));
        // Far from the pointer: untouched.
        assert_eq!(px(10, 10), (128, 128, 128));
        let jpeg = jpeg_for_test(&canvas, 0.8);
        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF]);
        let url = preview_for_test(&canvas, 200, 100);
        assert!(url.starts_with("data:image/jpeg;base64,/9j/"));
    }

    #[test]
    fn hidden_apps_are_hatched_grey() {
        let src = grey_image(100, 100);
        let canvas = compose_for_test(&src, 100, 100, None, &[Bounds { x: 0.0, y: 0.0, w: 50.0, h: 100.0 }]);
        let mut fill = 0;
        let mut line = 0;
        for y in 0..100 {
            for x in 0..50 {
                match pixel(&canvas, 100, x, y) {
                    (0x8A, 0x8A, 0x8A) => fill += 1,
                    (r, _, _) if r < 0x8A => line += 1,
                    _ => {}
                }
            }
        }
        assert!(fill > 2_000 && line > 200, "fill {fill}, lines {line}");
        assert_eq!(pixel(&canvas, 100, 75, 50), (128, 128, 128), "outside the region: untouched");
    }

    #[test]
    fn step_screenshots_fit_160_kb() {
        let src = grey_image(640, 400);
        let (w, h, n) = encode_for_test(&src, Bounds { x: 0.0, y: 0.0, w: 640.0, h: 400.0 }, 640, 400, 160_000).unwrap();
        assert_eq!((w, h), (640, 400));
        assert!(n <= 160_000);
        assert!(encode_for_test(&src, Bounds { x: 0.0, y: 0.0, w: 640.0, h: 400.0 }, 640, 400, 10).is_err(), "never sent over the cap");
    }

    /// Reads (never asks, never captures): run by hand with `cargo test --lib -- --ignored system_reads`. Prints only
    /// counts and yes/no, never an app's name.
    #[test]
    #[ignore]
    fn system_reads() {
        use super::mac::*;
        let windows = window_list(true);
        println!(
            "supported={} preflight={} locked={} flags={:#x} key_age={:?} mouse_age={:?} windows={} pointer={} displays={}",
            supported(),
            preflight(),
            screen_locked(),
            modifier_flags(),
            seconds_since_key_down().map(|s| s.is_finite() && s < 1e6),
            seconds_since_mouse_down().map(|s| s.is_finite() && s < 1e6),
            windows.len(),
            pointer_top_left().is_some(),
            displays().len()
        );
    }

    #[test]
    fn no_pointer_no_marker() {
        let src = grey_image(64, 64);
        let canvas = compose_for_test(&src, 64, 64, None, &[]);
        for (x, y) in [(32, 32), (47, 32), (0, 0), (63, 63)] {
            assert_eq!(pixel(&canvas, 64, x, y), (128, 128, 128));
        }
    }
}
