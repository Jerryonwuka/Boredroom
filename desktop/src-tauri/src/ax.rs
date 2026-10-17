//! Accessibility, read only (owner rule, 12 October 2026; companion-spec B.5, B.7.5, B.8, B.9.1).
//!
//! Used only when the person turned on "Let Brenda use my Mac" (and macOS granted Brenda Accessibility), and only to
//! read: the control under a point (role, title and description, for the outward check and to snap a pointing ring to
//! a control), the focused element (its role, title and description, whether it is in a web page, and which process
//! owns it: the keyboard's owner is checked before every key, review 12 October 2026), the front browser page's address
//! (banking and payment pages), the front document's file and a file under the pointer (file work). An element's value
//! (what is typed in it) is never read. Every call has a 0.25 s messaging timeout; an unanswered call is "no
//! information", which the outward check treats as "ask first".
//!
//! The one thing it writes: during a screen task, `AXManualAccessibility` (Electron) and `AXEnhancedUserInterface`
//! (Chromium) on the front app, so those apps show their web tree and their Send buttons can be read (review, 12 October
//! 2026); `AXEnhancedUserInterface` is set back to false on the apps Brenda changed when the task ends.
//!
//! The front desk (owner brief, 12 October 2026; helpers-spec C, P.1), only for a request the person made: the focused
//! text element's role, subrole, owner and whether its text can be set (`focused_text`), its selected text for "copy
//! that" (the one time a selection is read, and only into the clipboard), inserting text at the caret ("type this here",
//! `insert_text`, checked by the element's character COUNT, never its value), and the front window's frame for "side
//! by side", "fill the screen" and "minimise" (`window_frame`, `set_window_frame`, `minimise_window`).
//!
//! Plain `extern "C"` bindings to ApplicationServices (no extra crate: `objc2-application-services` is not cached,
//! 12 October 2026), plus Carbon's `IsSecureEventInputEnabled` (true while a password field has the keyboard).

use crate::guard::{AxBrief, Focus};
use crate::look::Bounds;
use std::path::PathBuf;

#[cfg(target_os = "macos")]
pub use mac::*;

#[cfg(not(target_os = "macos"))]
pub use other::*;

/// How many parents a file lookup under the pointer climbs (B.9.1).
pub const FILE_PARENTS: usize = 3;
/// How far up a focused element is searched for its web page.
pub const WEB_AREA_DEPTH: usize = 16;

/// A file URL's path ("file:///Users/a/Q3%20report.pdf" → /Users/a/Q3 report.pdf).
pub fn file_url_path(url: &str) -> Option<PathBuf> {
    let u = reqwest::Url::parse(url.trim()).ok()?;
    if u.scheme() != "file" {
        return None;
    }
    u.to_file_path().ok()
}

#[cfg(not(target_os = "macos"))]
mod other {
    use super::*;
    pub fn trusted() -> bool {
        false
    }
    pub fn request_trust() -> bool {
        false
    }
    pub fn elements_at(_p: (f64, f64)) -> Option<Vec<AxBrief>> {
        None
    }
    pub fn frame_at(_p: (f64, f64)) -> Option<Bounds> {
        None
    }
    pub fn focused() -> Option<Focus> {
        None
    }
    pub fn enable_web_tree(_pid: i32) -> bool {
        false
    }
    pub fn restore_web_tree(_pid: i32) {}
    pub fn page_url(_pid: i32) -> Option<String> {
        None
    }
    pub fn front_document(_pid: i32) -> Option<PathBuf> {
        None
    }
    pub fn file_at(_p: (f64, f64)) -> Option<PathBuf> {
        None
    }
    pub fn secure_input() -> bool {
        false
    }
    pub fn focused_text() -> Option<FocusedText> {
        None
    }
    pub fn insert_text(_text: &str) -> Option<bool> {
        None
    }
    pub fn window_frame(_pid: i32) -> Option<Bounds> {
        None
    }
    pub fn set_window_frame(_pid: i32, _frame: Bounds) -> bool {
        false
    }
    pub fn minimise_window(_pid: i32) -> bool {
        false
    }
}

/// The focused element as the front desk checks it before copying or typing (helpers-spec C).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct FocusedText {
    pub role: String,
    pub subrole: String,
    pub pid: Option<i32>,
    /// `kAXSelectedTextAttribute`, read only for "copy that".
    pub selected: Option<String>,
    /// The element's value can be set (a text box of some other kind).
    pub settable: bool,
}

/// The roles text can be typed into.
pub const TEXT_INPUT_ROLES: &[&str] = &["AXTextField", "AXTextArea", "AXComboBox", "AXSearchField"];

impl FocusedText {
    /// A password box (its role or subrole says so).
    pub fn secure(&self) -> bool {
        self.role == "AXSecureTextField" || self.subrole == "AXSecureTextField"
    }

    /// Something text can be typed into.
    pub fn takes_text(&self) -> bool {
        TEXT_INPUT_ROLES.contains(&self.role.as_str()) || self.settable
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::{msg_send, rc::autoreleasepool, runtime::AnyObject};
    use objc2_foundation::{NSDictionary, NSNumber, NSString};
    use std::ffi::c_void;

    type CFTypeRef = *const c_void;
    type AXUIElementRef = *const c_void;

    const AX_SUCCESS: i32 = 0;
    const AX_VALUE_CGPOINT: u32 = 1;
    const AX_VALUE_CGSIZE: u32 = 2;
    const TIMEOUT_S: f32 = 0.25;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
        fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> u8;
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyElementAtPosition(application: AXUIElementRef, x: f32, y: f32, element: *mut AXUIElementRef) -> i32;
        fn AXUIElementCopyAttributeValue(element: AXUIElementRef, attribute: CFTypeRef, value: *mut CFTypeRef) -> i32;
        fn AXUIElementSetMessagingTimeout(element: AXUIElementRef, timeout_seconds: f32) -> i32;
        fn AXUIElementSetAttributeValue(element: AXUIElementRef, attribute: CFTypeRef, value: CFTypeRef) -> i32;
        fn AXUIElementGetPid(element: AXUIElementRef, pid: *mut i32) -> i32;
        fn AXValueGetValue(value: CFTypeRef, the_type: u32, value_ptr: *mut c_void) -> u8;
        fn AXValueCreate(the_type: u32, value_ptr: *const c_void) -> CFTypeRef;
        fn AXUIElementIsAttributeSettable(element: AXUIElementRef, attribute: CFTypeRef, settable: *mut u8) -> i32;
        fn AXValueGetTypeID() -> usize;
        static kAXTrustedCheckOptionPrompt: CFTypeRef;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: CFTypeRef);
        fn CFGetTypeID(cf: CFTypeRef) -> usize;
        fn CFStringGetTypeID() -> usize;
        fn CFURLGetTypeID() -> usize;
        fn CFBooleanGetTypeID() -> usize;
        fn CFBooleanGetValue(boolean: CFTypeRef) -> u8;
        fn CFNumberGetTypeID() -> usize;
        static kCFBooleanTrue: CFTypeRef;
        static kCFBooleanFalse: CFTypeRef;
    }

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }

    /// An owned Core Foundation reference, released when dropped.
    struct Cf(CFTypeRef);
    impl Drop for Cf {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    #[repr(C)]
    #[derive(Default)]
    struct Pair {
        a: f64,
        b: f64,
    }

    pub fn trusted() -> bool {
        unsafe { AXIsProcessTrusted() != 0 }
    }

    /// The system's own prompt ("Brenda would like to control this computer using accessibility features"), which
    /// opens System Settings. Only from the person's press (B.8).
    pub fn request_trust() -> bool {
        autoreleasepool(|_| unsafe {
            let key: &NSString = &*(kAXTrustedCheckOptionPrompt as *const NSString);
            let yes = NSNumber::new_bool(true);
            let dict = NSDictionary::<NSString, AnyObject>::from_slices(&[key], &[&*yes as &AnyObject]);
            AXIsProcessTrustedWithOptions(&*dict as *const NSDictionary<NSString, AnyObject> as CFTypeRef) != 0
        })
    }

    fn system_wide() -> Option<Cf> {
        let sys = unsafe { AXUIElementCreateSystemWide() };
        if sys.is_null() {
            return None;
        }
        unsafe { AXUIElementSetMessagingTimeout(sys, TIMEOUT_S) };
        Some(Cf(sys))
    }

    fn application(pid: i32) -> Option<Cf> {
        let app = unsafe { AXUIElementCreateApplication(pid) };
        if app.is_null() {
            return None;
        }
        unsafe { AXUIElementSetMessagingTimeout(app, TIMEOUT_S) };
        Some(Cf(app))
    }

    fn attr(el: &Cf, name: &str) -> Option<Cf> {
        let key = NSString::from_str(name);
        let mut out: CFTypeRef = std::ptr::null();
        let err = unsafe { AXUIElementCopyAttributeValue(el.0, &*key as *const NSString as CFTypeRef, &mut out) };
        (err == AX_SUCCESS && !out.is_null()).then(|| Cf(out))
    }

    fn string_of(v: &Cf) -> Option<String> {
        unsafe {
            let t = CFGetTypeID(v.0);
            if t == CFStringGetTypeID() {
                let s: &NSString = &*(v.0 as *const NSString);
                return Some(s.to_string());
            }
            if t == CFURLGetTypeID() {
                let o: &AnyObject = &*(v.0 as *const AnyObject);
                let s: Option<objc2::rc::Retained<NSString>> = msg_send![o, absoluteString];
                return s.map(|s| s.to_string());
            }
        }
        None
    }

    fn string_attr(el: &Cf, name: &str) -> Option<String> {
        attr(el, name).and_then(|v| string_of(&v)).filter(|s| !s.is_empty())
    }

    fn pair_attr(el: &Cf, name: &str, ty: u32) -> Option<(f64, f64)> {
        let v = attr(el, name)?;
        unsafe {
            if CFGetTypeID(v.0) != AXValueGetTypeID() {
                return None;
            }
            let mut p = Pair::default();
            (AXValueGetValue(v.0, ty, &mut p as *mut Pair as *mut c_void) != 0).then_some((p.a, p.b))
        }
    }

    fn element_at(p: (f64, f64)) -> Option<Cf> {
        if !trusted() {
            return None;
        }
        let sys = system_wide()?;
        let mut el: AXUIElementRef = std::ptr::null();
        let err = unsafe { AXUIElementCopyElementAtPosition(sys.0, p.0 as f32, p.1 as f32, &mut el) };
        (err == AX_SUCCESS && !el.is_null()).then(|| Cf(el))
    }

    fn brief(el: &Cf) -> AxBrief {
        AxBrief {
            role: string_attr(el, "AXRole").unwrap_or_default(),
            title: string_attr(el, "AXTitle").unwrap_or_default(),
            description: string_attr(el, "AXDescription").unwrap_or_default(),
        }
    }

    pub fn elements_at(p: (f64, f64)) -> Option<Vec<AxBrief>> {
        autoreleasepool(|_| {
            let mut el = element_at(p)?;
            let mut out = vec![brief(&el)];
            for _ in 0..2 {
                let Some(parent) = attr(&el, "AXParent") else { break };
                out.push(brief(&parent));
                el = parent;
            }
            Some(out)
        })
    }

    pub fn frame_at(p: (f64, f64)) -> Option<Bounds> {
        autoreleasepool(|_| {
            let el = element_at(p)?;
            let (x, y) = pair_attr(&el, "AXPosition", AX_VALUE_CGPOINT)?;
            let (w, h) = pair_attr(&el, "AXSize", AX_VALUE_CGSIZE)?;
            Some(Bounds { x, y, w, h })
        })
    }

    pub fn focused() -> Option<Focus> {
        if !trusted() {
            return None;
        }
        autoreleasepool(|_| {
            let sys = system_wide()?;
            let mut el = attr(&sys, "AXFocusedUIElement")?;
            let brief = brief(&el);
            let mut pid: i32 = 0;
            let pid = (unsafe { AXUIElementGetPid(el.0, &mut pid) } == AX_SUCCESS && pid > 0).then_some(pid);
            let mut web = false;
            for _ in 0..WEB_AREA_DEPTH {
                let Some(parent) = attr(&el, "AXParent") else { break };
                if string_attr(&parent, "AXRole").as_deref() == Some("AXWebArea") {
                    web = true;
                    break;
                }
                el = parent;
            }
            Some(Focus { el: brief, in_web: web, pid })
        })
    }

    fn bool_attr(el: &Cf, name: &str) -> Option<bool> {
        let v = attr(el, name)?;
        unsafe { (CFGetTypeID(v.0) == CFBooleanGetTypeID()).then(|| CFBooleanGetValue(v.0) != 0) }
    }

    fn set_bool(el: &Cf, name: &str, on: bool) -> bool {
        let key = NSString::from_str(name);
        let v = unsafe { if on { kCFBooleanTrue } else { kCFBooleanFalse } };
        unsafe { AXUIElementSetAttributeValue(el.0, &*key as *const NSString as CFTypeRef, v) == AX_SUCCESS }
    }

    /// Asks an Electron or Chromium app to show its web tree (review, 12 October 2026): `AXManualAccessibility`
    /// (Electron; harmless elsewhere, an unknown attribute is refused) and `AXEnhancedUserInterface` (Chromium). True when
    /// Brenda turned `AXEnhancedUserInterface` on here, so the task's end turns it off again (`restore_web_tree`).
    pub fn enable_web_tree(pid: i32) -> bool {
        if !trusted() || pid <= 0 {
            return false;
        }
        autoreleasepool(|_| {
            let Some(app) = application(pid) else { return false };
            let _ = set_bool(&app, "AXManualAccessibility", true);
            if bool_attr(&app, "AXEnhancedUserInterface") == Some(true) {
                return false;
            }
            set_bool(&app, "AXEnhancedUserInterface", true)
        })
    }

    /// Puts `AXEnhancedUserInterface` back to false on an app Brenda turned it on for.
    pub fn restore_web_tree(pid: i32) {
        if pid <= 0 {
            return;
        }
        autoreleasepool(|_| {
            if let Some(app) = application(pid) {
                let _ = set_bool(&app, "AXEnhancedUserInterface", false);
            }
        });
    }

    pub fn page_url(pid: i32) -> Option<String> {
        if !trusted() {
            return None;
        }
        autoreleasepool(|_| {
            let app = application(pid)?;
            if let Some(mut el) = attr(&app, "AXFocusedUIElement") {
                for _ in 0..WEB_AREA_DEPTH {
                    if string_attr(&el, "AXRole").as_deref() == Some("AXWebArea") {
                        if let Some(u) = string_attr(&el, "AXURL") {
                            return Some(u);
                        }
                        break;
                    }
                    let Some(parent) = attr(&el, "AXParent") else { break };
                    el = parent;
                }
            }
            let win = attr(&app, "AXFocusedWindow")?;
            string_attr(&win, "AXDocument").filter(|d| d.starts_with("http://") || d.starts_with("https://"))
        })
    }

    pub fn front_document(pid: i32) -> Option<PathBuf> {
        if !trusted() {
            return None;
        }
        autoreleasepool(|_| {
            let app = application(pid)?;
            let win = attr(&app, "AXFocusedWindow")?;
            string_attr(&win, "AXDocument").and_then(|d| file_url_path(&d))
        })
    }

    /// A file named by the element under the pointer or one of its three parents (`AXURL` as a file URL, or an absolute
    /// `AXFilename`). [UNVERIFIED for Finder rows, 12 October 2026]
    pub fn file_at(p: (f64, f64)) -> Option<PathBuf> {
        autoreleasepool(|_| {
            let mut el = element_at(p)?;
            for i in 0..=FILE_PARENTS {
                if let Some(path) = string_attr(&el, "AXURL").and_then(|u| file_url_path(&u)) {
                    return Some(path);
                }
                if let Some(name) = string_attr(&el, "AXFilename").filter(|n| n.starts_with('/')) {
                    return Some(PathBuf::from(name));
                }
                if i == FILE_PARENTS {
                    break;
                }
                let Some(parent) = attr(&el, "AXParent") else { break };
                el = parent;
            }
            None
        })
    }

    pub fn secure_input() -> bool {
        unsafe { IsSecureEventInputEnabled() != 0 }
    }

    fn settable(el: &Cf, name: &str) -> bool {
        let key = NSString::from_str(name);
        let mut out: u8 = 0;
        unsafe { AXUIElementIsAttributeSettable(el.0, &*key as *const NSString as CFTypeRef, &mut out) == AX_SUCCESS && out != 0 }
    }

    fn number_attr(el: &Cf, name: &str) -> Option<i64> {
        let v = attr(el, name)?;
        unsafe {
            if CFGetTypeID(v.0) != CFNumberGetTypeID() {
                return None;
            }
            let n: &NSNumber = &*(v.0 as *const NSNumber);
            Some(n.longLongValue())
        }
    }

    fn focused_element() -> Option<Cf> {
        if !trusted() {
            return None;
        }
        let sys = system_wide()?;
        attr(&sys, "AXFocusedUIElement")
    }

    /// The focused element: role, subrole, owner, selected text, and whether its text can be set.
    pub fn focused_text() -> Option<FocusedText> {
        autoreleasepool(|_| {
            let el = focused_element()?;
            let mut pid: i32 = 0;
            let pid = (unsafe { AXUIElementGetPid(el.0, &mut pid) } == AX_SUCCESS && pid > 0).then_some(pid);
            Some(FocusedText {
                role: string_attr(&el, "AXRole").unwrap_or_default(),
                subrole: string_attr(&el, "AXSubrole").unwrap_or_default(),
                pid,
                selected: string_attr(&el, "AXSelectedText"),
                settable: settable(&el, "AXValue") || settable(&el, "AXSelectedText"),
            })
        })
    }

    /// Inserts `text` at the caret of the focused element (`kAXSelectedTextAttribute`). Some(true) when its character
    /// count changed (the value itself is never read), Some(false) when nothing changed, None when it can't be asked.
    pub fn insert_text(text: &str) -> Option<bool> {
        autoreleasepool(|_| {
            let el = focused_element()?;
            let before = number_attr(&el, "AXNumberOfCharacters");
            let key = NSString::from_str("AXSelectedText");
            let value = NSString::from_str(text);
            let err = unsafe { AXUIElementSetAttributeValue(el.0, &*key as *const NSString as CFTypeRef, &*value as *const NSString as CFTypeRef) };
            if err != AX_SUCCESS {
                return Some(false);
            }
            let after = number_attr(&el, "AXNumberOfCharacters");
            Some(match (before, after) {
                (Some(b), Some(a)) => a != b || text.is_empty(),
                // Without a count the set's success is all there is.
                _ => true,
            })
        })
    }

    fn front_window(pid: i32) -> Option<Cf> {
        if !trusted() || pid <= 0 {
            return None;
        }
        let app = application(pid)?;
        attr(&app, "AXFocusedWindow").or_else(|| attr(&app, "AXMainWindow"))
    }

    /// The app's front window (focused, else main), global top-left points.
    pub fn window_frame(pid: i32) -> Option<Bounds> {
        autoreleasepool(|_| {
            let w = front_window(pid)?;
            let (x, y) = pair_attr(&w, "AXPosition", AX_VALUE_CGPOINT)?;
            let (wd, h) = pair_attr(&w, "AXSize", AX_VALUE_CGSIZE)?;
            Some(Bounds { x, y, w: wd, h })
        })
    }

    fn set_pair(el: &Cf, name: &str, ty: u32, a: f64, b: f64) -> bool {
        let p = Pair { a, b };
        let v = unsafe { AXValueCreate(ty, &p as *const Pair as *const c_void) };
        if v.is_null() {
            return false;
        }
        let v = Cf(v);
        let key = NSString::from_str(name);
        unsafe { AXUIElementSetAttributeValue(el.0, &*key as *const NSString as CFTypeRef, v.0) == AX_SUCCESS }
    }

    /// Moves and sizes the app's front window (never into a full-screen Space).
    pub fn set_window_frame(pid: i32, frame: Bounds) -> bool {
        autoreleasepool(|_| {
            let Some(w) = front_window(pid) else { return false };
            // Position first, then size, then position again (a window clamped by the old position settles).
            let a = set_pair(&w, "AXPosition", AX_VALUE_CGPOINT, frame.x, frame.y);
            let b = set_pair(&w, "AXSize", AX_VALUE_CGSIZE, frame.w, frame.h);
            let c = set_pair(&w, "AXPosition", AX_VALUE_CGPOINT, frame.x, frame.y);
            a || b || c
        })
    }

    /// Minimises the app's front window (`AXMinimized`).
    pub fn minimise_window(pid: i32) -> bool {
        autoreleasepool(|_| {
            let Some(w) = front_window(pid) else { return false };
            set_bool(&w, "AXMinimized", true)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn focused_text_kinds() {
        let f = |role: &str, subrole: &str, settable: bool| FocusedText { role: role.into(), subrole: subrole.into(), pid: Some(1), selected: None, settable };
        assert!(f("AXTextField", "", false).takes_text() && !f("AXTextField", "", false).secure());
        assert!(f("AXTextField", "AXSecureTextField", false).secure());
        assert!(f("AXSecureTextField", "", false).secure());
        assert!(f("AXGroup", "", true).takes_text(), "an element whose value can be set");
        assert!(!f("AXButton", "", false).takes_text());
    }

    #[test]
    fn file_urls_become_paths() {
        assert_eq!(file_url_path("file:///Users/a/Q3%20report.pdf"), Some(PathBuf::from("/Users/a/Q3 report.pdf")));
        assert_eq!(file_url_path("https://example.com/a.pdf"), None);
        assert_eq!(file_url_path("not a url"), None);
    }

    /// Reads (never asks, never acts): `cargo test --lib -- --ignored ax_reads`. Prints only yes/no.
    #[test]
    #[ignore]
    fn ax_reads() {
        println!("trusted={} secure_input={} focused={}", trusted(), secure_input(), focused().is_some());
    }
}
