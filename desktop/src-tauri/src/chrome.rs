//! The Boredroom window's Mac chrome (owner request, 26 October 2026: the Mac app shell, "make it look a little different
//! from the web app like WhatsApp desktop vs web", "make the side bar float on the app").
//!
//! The window has no title bar of its own (title bar style Overlay, title hidden): the page fills it, over macOS's
//! sidebar vibrancy, and the web app draws a floating sidebar whose top row is where the traffic lights sit
//! (`TRAFFIC_LIGHTS`). The page's CSS is in the web repo (globals.css, "Boredroom for Mac's window").
//!
//! Security (non-negotiable, unchanged): the window still has NO IPC. Nothing here lets the page call the app. Instead the
//! app *asks* the page, twice a second while the window shows and after each page load, by running a fixed script
//! (`PROBE_JS`) in WebKit's isolated client world (the page's own scripts can't reach or tamper with it): which theme
//! it shows, and where the parts that move the window are (`[data-shell-drag]`, less what is clickable in them). The
//! answer is only numbers and a word, read defensively (`parse`); the worst a page could do with it is make its own
//! top bar move the window or not.
//!
//! - **Moving the window:** a transparent native view lies over the web view. Its `hitTest:` claims a point only inside
//!   a reported drag zone (the window's margins, the sidebar's top row, the empty parts of the top bar), and its
//!   `mouseDown:` hands the drag to macOS (`performWindowDragWithEvent:`); a double click does what System Settings says
//!   (zoom, minimise or nothing). Everywhere else the point falls through to the page. A page that reports nothing (the
//!   sign-in, the offline page) gets the top 40 points; while a dialog, menu or the assistant's panel is open, none.
//! - **Light and dark:** the window's appearance follows the page's theme (so the vibrancy and the traffic lights
//!   match), and is remembered for the next opening (`dashboard.json`'s `theme`).

use serde_json::Value;
use std::sync::atomic::{AtomicPtr, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, WebviewWindow};

/// Where the traffic lights go, in points from the window's top-left: 12 points into the floating sidebar (8 points from
/// the window's edge), centred in its 44-point top row (tao insets them; on macOS 26 their centre is 2 points above `y`).
pub const TRAFFIC_LIGHTS: (f64, f64) = (20.0, 32.0);
/// What moves the window when the page reports nothing: its top strip, where the traffic lights are.
pub const FALLBACK_STRIP: f64 = 40.0;
/// How often the page is asked, while the window shows.
const PROBE_EVERY: Duration = Duration::from_millis(500);
/// At most this many zones are kept from one answer (the probe sends no more than 200).
const MAX_ZONES: usize = 240;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Theme {
    Light,
    Dark,
}

impl Theme {
    pub fn word(self) -> &'static str {
        match self {
            Theme::Light => "light",
            Theme::Dark => "dark",
        }
    }
    pub fn from_word(w: &str) -> Option<Theme> {
        match w {
            "light" => Some(Theme::Light),
            "dark" => Some(Theme::Dark),
            _ => None,
        }
    }
    pub fn tauri(self) -> tauri::Theme {
        match self {
            Theme::Light => tauri::Theme::Light,
            Theme::Dark => tauri::Theme::Dark,
        }
    }
}

/// A rectangle of the page in CSS pixels, top-left origin. Later zones win over earlier ones (painter's order).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Zone {
    pub drag: bool,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Zone {
    fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x < self.x + self.w && y >= self.y && y < self.y + self.h
    }
}

/// What the page said.
#[derive(Clone, Debug, PartialEq)]
pub struct PageState {
    pub theme: Option<Theme>,
    pub zones: Vec<Zone>,
    /// A dialog, menu or the assistant's panel is open: nothing moves the window.
    pub modal: bool,
}

/// The fixed script the app runs in the page's isolated world. It returns a short JSON string; it never calls anything.
pub const PROBE_JS: &str = r#"(() => {
  const d = document, h = d.documentElement, W = innerWidth, H = innerHeight;
  const out = { t: h.dataset.theme === "light" ? "light" : h.dataset.theme === "dark" ? "dark" : "", m: 0, z: [] };
  const r = (el, k) => { const b = el.getBoundingClientRect(); if (b.width > 0 && b.height > 0 && out.z.length < 200) out.z.push([k, b.left, b.top, b.width, b.height]); };
  const ACT = "a[href], button, input, select, textarea, summary, label, [role=button], [role=tab], [role=link], [role=menuitem], [role=switch], [role=combobox], [tabindex]:not([tabindex='-1']), [contenteditable='true'], [contenteditable='']";
  let modal = !!d.querySelector("dialog[open], [aria-modal='true']");
  try { modal = modal || !!d.querySelector(":popover-open"); } catch (e) {}
  const drawer = d.getElementById("assistant-drawer");
  if (drawer && !drawer.inert) modal = true;
  if (modal) { out.m = 1; return JSON.stringify(out); }
  if (h.dataset.shell === "mac" && d.querySelector("[data-app-shell]")) {
    out.z.push([1, 0, 0, W, H]);
    for (const el of d.querySelectorAll("[data-app-sidebar], [data-app-main], [data-shell-banners]")) r(el, 0);
    for (const zone of d.querySelectorAll("[data-shell-drag]")) { r(zone, 1); for (const el of zone.querySelectorAll(ACT)) r(el, 0); }
  } else {
    out.z.push([1, 0, 0, W, 40]);
    for (const el of d.querySelectorAll(ACT)) { const b = el.getBoundingClientRect(); if (b.top < 40 && b.bottom > 0) r(el, 0); }
  }
  return JSON.stringify(out);
})()"#;

fn num(v: &Value) -> Option<f64> {
    let n = v.as_f64()?;
    n.is_finite().then(|| n.clamp(-100_000.0, 100_000.0))
}

/// Reads the probe's answer. Anything malformed is dropped (a bad zone, or the whole answer when it isn't the shape).
/// Pure (tested).
pub fn parse(s: &str) -> Option<PageState> {
    if s.len() > 64 * 1024 {
        return None;
    }
    let v: Value = serde_json::from_str(s).ok()?;
    let theme = v.get("t").and_then(|t| t.as_str()).and_then(Theme::from_word);
    let modal = v.get("m").and_then(|m| m.as_i64()) == Some(1);
    let zones = v
        .get("z")?
        .as_array()?
        .iter()
        .take(MAX_ZONES)
        .filter_map(|z| {
            let a = z.as_array()?;
            if a.len() != 5 {
                return None;
            }
            let (x, y, w, h) = (num(&a[1])?, num(&a[2])?, num(&a[3])?, num(&a[4])?);
            if w <= 0.0 || h <= 0.0 {
                return None;
            }
            Some(Zone { drag: a[0].as_i64()? == 1, x, y, w, h })
        })
        .collect();
    Some(PageState { theme, zones, modal })
}

/// Whether a point (CSS pixels) moves the window: the last zone containing it decides; none means no. Pure (tested).
pub fn hit(zones: &[Zone], x: f64, y: f64) -> bool {
    zones.iter().rev().find(|z| z.contains(x, y)).is_some_and(|z| z.drag)
}

/// The zones before the page has answered: the top strip.
pub fn fallback(width: f64) -> Vec<Zone> {
    vec![Zone { drag: true, x: 0.0, y: 0.0, w: width.max(1.0), h: FALLBACK_STRIP }]
}

/// What a double click on a part that moves the window does (System Settings › Desktop & Dock, "Double-click a
/// window's title bar to"). Pure (tested).
#[derive(Debug, PartialEq, Eq)]
pub enum DoubleClick {
    Zoom,
    Minimise,
    Nothing,
}

pub fn double_click(pref: Option<&str>) -> DoubleClick {
    match pref {
        Some("Minimize") => DoubleClick::Minimise,
        Some("None") | Some("Nothing") => DoubleClick::Nothing,
        _ => DoubleClick::Zoom,
    }
}

/// The window's current zones and zoom (CSS pixels × zoom = points). Read on the main thread by the drag view.
struct Zones {
    zones: Vec<Zone>,
    zoom: f64,
    theme: Option<Theme>,
}

static ZONES: Mutex<Option<Zones>> = Mutex::new(None);
/// The web view under the drag view (scroll wheel events over a drag zone are handed back to it).
static WEB_VIEW: AtomicPtr<std::ffi::c_void> = AtomicPtr::new(std::ptr::null_mut());
/// The probe loop of the current window (a reopened window starts a new one; the old one stops).
static GEN: AtomicU64 = AtomicU64::new(0);

fn hit_now(px: f64, py: f64) -> bool {
    let g = ZONES.lock().unwrap();
    match g.as_ref() {
        Some(z) => {
            let zoom = if z.zoom.is_finite() && z.zoom > 0.0 { z.zoom } else { 1.0 };
            hit(&z.zones, px / zoom, py / zoom)
        }
        None => py < FALLBACK_STRIP,
    }
}

/// The window's theme as last seen (to open it in the same one).
pub fn remembered(app: &AppHandle) -> Option<Theme> {
    crate::dashboard::read(app).theme.as_deref().and_then(Theme::from_word)
}

/// Sets the window up once it is made: the drag view over the page, then the probe loop.
pub fn install(app: &AppHandle, w: &WebviewWindow) {
    *ZONES.lock().unwrap() = None;
    #[cfg(target_os = "macos")]
    {
        let _ = w.with_webview(|pw| unsafe { macos::add_drag_view(pw.inner()) });
    }
    let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(PROBE_EVERY).await;
            if GEN.load(Ordering::SeqCst) != gen {
                break;
            }
            let Some(w) = crate::dashboard::window(&app) else {
                WEB_VIEW.store(std::ptr::null_mut(), Ordering::SeqCst);
                break;
            };
            if w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false) {
                probe(&app, &w);
            }
        }
    });
}

/// Asks the page now (also after every finished page load).
pub fn probe(app: &AppHandle, w: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let app = app.clone();
        let _ = w.with_webview(move |pw| unsafe { macos::evaluate(pw.inner(), PROBE_JS, move |s| apply(&app, s)) });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, w);
    }
}

/// Takes the page's answer in (main thread).
fn apply(app: &AppHandle, answer: Option<String>) {
    let zoom = crate::dashboard::read(app).zoom;
    let state = answer.as_deref().and_then(parse);
    let theme = state.as_ref().and_then(|s| s.theme);
    let changed = {
        let mut g = ZONES.lock().unwrap();
        let before = g.as_ref().and_then(|z| z.theme);
        let zones = match &state {
            Some(s) if s.modal => Vec::new(),
            Some(s) => s.zones.clone(),
            None => crate::dashboard::window(app).and_then(|w| w.inner_size().ok().map(|s| s.width as f64 / w.scale_factor().unwrap_or(1.0))).map(fallback).unwrap_or_default(),
        };
        *g = Some(Zones { zones, zoom, theme: theme.or(before) });
        theme.is_some() && theme != before
    };
    if let (true, Some(t)) = (changed, theme) {
        if let Some(w) = crate::dashboard::window(app) {
            let _ = w.set_theme(Some(t.tauri()));
        }
        if crate::dashboard::read(app).theme.as_deref() != Some(t.word()) {
            crate::dashboard::update(app, |f| f.theme = Some(t.word().into()));
        }
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use block2::RcBlock;
    use objc2::rc::{Allocated, Retained};
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel};
    use objc2::{class, msg_send, sel};
    use objc2_foundation::{NSPoint, NSRect, NSString};
    use std::sync::OnceLock;

    extern "C-unwind" fn is_flipped(_this: &AnyObject, _sel: Sel) -> Bool {
        Bool::YES
    }

    extern "C-unwind" fn accepts_first_mouse(_this: &AnyObject, _sel: Sel, _event: *mut AnyObject) -> Bool {
        Bool::YES
    }

    extern "C-unwind" fn hit_test(this: &AnyObject, _sel: Sel, p: NSPoint) -> *mut AnyObject {
        unsafe {
            let sup: *mut AnyObject = msg_send![this, superview];
            let local: NSPoint = msg_send![this, convertPoint: p, fromView: sup];
            let b: NSRect = msg_send![this, bounds];
            if local.x < 0.0 || local.y < 0.0 || local.x > b.size.width || local.y > b.size.height {
                return std::ptr::null_mut();
            }
            if hit_now(local.x, local.y) {
                this as *const AnyObject as *mut AnyObject
            } else {
                std::ptr::null_mut()
            }
        }
    }

    extern "C-unwind" fn mouse_down(this: &AnyObject, _sel: Sel, event: *mut AnyObject) {
        unsafe {
            let win: *mut AnyObject = msg_send![this, window];
            if win.is_null() || event.is_null() {
                return;
            }
            let clicks: isize = msg_send![&*event, clickCount];
            if clicks >= 2 {
                let defaults: *mut AnyObject = msg_send![class!(NSUserDefaults), standardUserDefaults];
                let key = NSString::from_str("AppleActionOnDoubleClick");
                let pref: Option<Retained<NSString>> = if defaults.is_null() { None } else { msg_send![&*defaults, stringForKey: &*key] };
                let pref = pref.map(|p| p.to_string());
                let nil: *mut AnyObject = std::ptr::null_mut();
                match double_click(pref.as_deref()) {
                    DoubleClick::Zoom => {
                        let _: () = msg_send![&*win, zoom: nil];
                    }
                    DoubleClick::Minimise => {
                        let _: () = msg_send![&*win, miniaturize: nil];
                    }
                    DoubleClick::Nothing => {}
                }
            } else {
                let _: () = msg_send![&*win, performWindowDragWithEvent: &*event];
            }
        }
    }

    extern "C-unwind" fn scroll_wheel(_this: &AnyObject, _sel: Sel, event: *mut AnyObject) {
        let wk = WEB_VIEW.load(Ordering::SeqCst) as *mut AnyObject;
        if !wk.is_null() && !event.is_null() {
            unsafe {
                let _: () = msg_send![&*wk, scrollWheel: &*event];
            }
        }
    }

    fn drag_class() -> &'static AnyClass {
        static CLS: OnceLock<&'static AnyClass> = OnceLock::new();
        CLS.get_or_init(|| {
            let mut b = ClassBuilder::new(c"BoredroomWindowDragView", class!(NSView)).expect("the drag view class is made once");
            unsafe {
                b.add_method(sel!(isFlipped), is_flipped as extern "C-unwind" fn(_, _) -> _);
                b.add_method(sel!(acceptsFirstMouse:), accepts_first_mouse as extern "C-unwind" fn(_, _, _) -> _);
                b.add_method(sel!(hitTest:), hit_test as extern "C-unwind" fn(_, _, _) -> _);
                b.add_method(sel!(mouseDown:), mouse_down as extern "C-unwind" fn(_, _, _));
                b.add_method(sel!(scrollWheel:), scroll_wheel as extern "C-unwind" fn(_, _, _));
            }
            b.register()
        })
    }

    #[cfg(test)]
    pub fn drag_class_for_tests() -> &'static AnyClass {
        drag_class()
    }

    /// Lays the drag view over the web view, the same size, resizing with it. Main thread.
    pub unsafe fn add_drag_view(web_view: *mut std::ffi::c_void) {
        let wk = web_view as *mut AnyObject;
        if wk.is_null() {
            return;
        }
        let sup: *mut AnyObject = msg_send![&*wk, superview];
        if sup.is_null() {
            return;
        }
        WEB_VIEW.store(web_view, Ordering::SeqCst);
        let frame: NSRect = msg_send![&*wk, frame];
        let alloc: Allocated<AnyObject> = msg_send![drag_class(), alloc];
        let view: Option<Retained<AnyObject>> = msg_send![alloc, initWithFrame: frame];
        let Some(view) = view else { return };
        // NSViewWidthSizable | NSViewHeightSizable
        let _: () = msg_send![&*view, setAutoresizingMask: 18usize];
        // NSWindowAbove
        let _: () = msg_send![&*sup, addSubview: &*view, positioned: 1isize, relativeTo: &*wk];
    }

    /// Runs `js` in WebKit's isolated client world and hands back the string it returned (or None). Main thread.
    pub unsafe fn evaluate(web_view: *mut std::ffi::c_void, js: &str, done: impl FnOnce(Option<String>) + 'static) {
        let wk = web_view as *mut AnyObject;
        if wk.is_null() {
            return done(None);
        }
        let Some(world_class) = AnyClass::get(c"WKContentWorld") else { return done(None) };
        let world: *mut AnyObject = msg_send![world_class, defaultClientWorld];
        if world.is_null() {
            return done(None);
        }
        let script = NSString::from_str(js);
        let cell = std::cell::RefCell::new(Some(done));
        let block = RcBlock::new(move |result: *mut AnyObject, _error: *mut AnyObject| {
            let Some(done) = cell.borrow_mut().take() else { return };
            let text = if result.is_null() {
                None
            } else {
                let is_string: bool = msg_send![&*result, isKindOfClass: class!(NSString)];
                is_string.then(|| (*(result as *const NSString)).to_string())
            };
            done(text);
        });
        let frame: *mut AnyObject = std::ptr::null_mut();
        let _: () = msg_send![&*wk, evaluateJavaScript: &*script, inFrame: frame, inContentWorld: &*world, completionHandler: &*block];
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_answer_is_read_defensively() {
        let s = parse(r#"{"t":"light","m":0,"z":[[1,0,0,1440,900],[0,8,8,240,884],[1,8,8,240,44],[0,300,10,32,32],[1,"x",0,1,1],[1,0,0,-5,4],[1,0,0,null,4],[2,0,0,1]]}"#).unwrap();
        assert_eq!(s.theme, Some(Theme::Light));
        assert!(!s.modal);
        assert_eq!(s.zones.len(), 4, "the malformed zones are dropped");
        assert_eq!(parse(r#"{"t":"blue","z":[]}"#).unwrap().theme, None);
        assert!(parse("not json").is_none());
        assert!(parse(r#"{"t":"dark"}"#).is_none(), "no zones: not the shape");
        assert!(parse(&format!(r#"{{"t":"dark","z":[],"pad":"{}"}}"#, "x".repeat(70_000))).is_none(), "too long");
        let many = format!(r#"{{"t":"dark","z":[{}]}}"#, vec!["[1,0,0,1,1]"; 1000].join(","));
        assert_eq!(parse(&many).unwrap().zones.len(), MAX_ZONES);
        assert!(parse(r#"{"t":"dark","m":1,"z":[]}"#).unwrap().modal);
    }

    #[test]
    fn the_last_zone_decides() {
        let s = parse(r#"{"t":"dark","z":[[1,0,0,1440,900],[0,8,8,240,884],[0,256,8,1176,884],[1,8,8,240,44],[1,256,8,1176,44],[0,300,14,32,32]]}"#).unwrap();
        assert!(hit(&s.zones, 4.0, 400.0), "the margin between the window's edge and the sidebar");
        assert!(hit(&s.zones, 100.0, 30.0), "the sidebar's top row (the traffic lights' row)");
        assert!(!hit(&s.zones, 100.0, 300.0), "the sidebar's links");
        assert!(hit(&s.zones, 800.0, 30.0), "the empty top bar");
        assert!(!hit(&s.zones, 310.0, 20.0), "a button in the top bar");
        assert!(!hit(&s.zones, 800.0, 400.0), "the page");
        assert!(!hit(&[], 10.0, 10.0));
        assert!(hit(&fallback(1280.0), 600.0, 20.0) && !hit(&fallback(1280.0), 600.0, 60.0));
    }

    #[test]
    fn double_clicks_follow_system_settings() {
        assert_eq!(double_click(None), DoubleClick::Zoom);
        assert_eq!(double_click(Some("Maximize")), DoubleClick::Zoom);
        assert_eq!(double_click(Some("Minimize")), DoubleClick::Minimise);
        assert_eq!(double_click(Some("None")), DoubleClick::Nothing);
    }

    #[test]
    fn the_probe_only_reads() {
        // It returns a string and calls nothing in the app: no Tauri globals, no message handlers, no network, no writes.
        for bad in ["__TAURI", "invoke", "webkit.messageHandlers", "postMessage", "fetch(", "XMLHttpRequest", "localStorage", "document.cookie", "location", ".click(", "innerHTML", "setAttribute", "dataset.theme = ", "dataset.shell = "] {
            assert!(!PROBE_JS.contains(bad), "{bad}");
        }
        assert!(PROBE_JS.contains("JSON.stringify(out)"));
    }

    #[test]
    fn the_window_still_has_no_ipc() {
        // The chrome only asks the page (an isolated-world script) and lays a native view over it: no message handlers,
        // no scripts injected at load, no commands (the capability files are checked in lib.rs's tests).
        for src in [include_str!("chrome.rs"), include_str!("dashboard.rs")] {
            let code = src.split("#[cfg(test)]\nmod tests").next().unwrap();
            let code: String = code.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
            for bad in ["addScriptMessageHandler", "initialization_script", "invoke_handler", "with_ipc", "ipc::"] {
                assert!(!code.contains(bad), "{bad}");
            }
        }
    }

    /// The drag view's class registers (its method types match NSView's) and claims only the drag zones.
    #[cfg(target_os = "macos")]
    #[test]
    fn the_drag_view_claims_only_drag_zones() {
        use objc2::rc::{Allocated, Retained};
        use objc2::runtime::AnyObject;
        use objc2::msg_send;
        use objc2_foundation::{NSPoint, NSRect, NSSize};
        let s = parse(r#"{"t":"dark","z":[[1,0,0,1000,800],[0,8,8,240,784],[1,8,8,240,44],[0,40,10,30,30]]}"#).unwrap();
        *ZONES.lock().unwrap() = Some(Zones { zones: s.zones, zoom: 1.0, theme: None });
        unsafe {
            let alloc: Allocated<AnyObject> = msg_send![macos::drag_class_for_tests(), alloc];
            let frame = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(1000.0, 800.0));
            let view: Option<Retained<AnyObject>> = msg_send![alloc, initWithFrame: frame];
            let view = view.unwrap();
            let flipped: bool = msg_send![&*view, isFlipped];
            assert!(flipped);
            // In a plain (unflipped) superview, as over the web view: AppKit passes points in the superview's coordinates.
            let parent_alloc: Allocated<AnyObject> = msg_send![objc2::class!(NSView), alloc];
            let parent: Option<Retained<AnyObject>> = msg_send![parent_alloc, initWithFrame: frame];
            let parent = parent.unwrap();
            let _: () = msg_send![&*parent, addSubview: &*view];
            let at = |x: f64, y: f64| -> bool {
                let r: *mut AnyObject = msg_send![&*view, hitTest: NSPoint::new(x, 800.0 - y)];
                !r.is_null()
            };
            assert!(at(100.0, 30.0), "the sidebar's top row");
            assert!(!at(50.0, 20.0), "a control in it");
            assert!(!at(100.0, 300.0), "the sidebar's links");
            assert!(at(4.0, 400.0), "the margin");
            assert!(!at(1200.0, 30.0), "outside the view");
        }
        *ZONES.lock().unwrap() = None;
    }

    #[test]
    fn themes() {
        assert_eq!(Theme::from_word("dark"), Some(Theme::Dark));
        assert_eq!(Theme::from_word(Theme::Light.word()), Some(Theme::Light));
        assert_eq!(Theme::from_word("system"), None);
    }
}
