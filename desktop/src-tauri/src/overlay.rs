//! Brenda's floating windows over other apps' full-screen Spaces (owner report, 27 October 2026: "Brenda doesn't show in
//! apps when I open apps in full screen").
//!
//! The notch, Brenda by the pointer, her ring and the look outline must show over any app, a full-screen one included.
//! macOS lets an ordinary window (an NSWindow, which is what the window framework makes) into another app's full-screen
//! Space only while its app is a menu-bar app (Accessory), and only if it was made while it was one (island.rs, 17 October
//! 2026). Since Boredroom's own window arrived (24 October 2026), the app becomes an ordinary Dock app (Regular) while
//! that window is open and goes back 1.5 s after it closes, and the pointer windows can be made while it is one; then
//! none of them could enter a full-screen Space, whatever their collection behaviour. A non-activating panel can, under
//! either policy (it is how Spotlight-style panels float over full-screen apps), so each of these windows is turned into
//! one here: its class swapped for an NSPanel subclass carrying the framework's own methods and fields (both classes
//! add nothing to NSWindow's layout, so the object stays valid), the non-activating style set, and activation prevented
//! the way an NSPanel made non-activating from the start has it.
//!
//! `ensure` also puts back the level and the collection behaviour whenever something reset them (the framework re-applies
//! its own floating level when a window is shown), and, after each change of activation policy, sets the behaviour again
//! and orders a visible window in, so the window server re-reads it. One helper for every Brenda window; the decision of
//! what to fix is pure (`fixes`, tested).

/// NSWindowStyleMaskNonactivatingPanel.
pub const NONACTIVATING_PANEL: usize = 1 << 7;

/// NSWindowCollectionBehavior flags.
pub const CAN_JOIN_ALL_SPACES: usize = 1 << 0;
pub const MOVE_TO_ACTIVE_SPACE: usize = 1 << 1;
pub const MANAGED: usize = 1 << 2;
#[allow(dead_code)] // named for the tests
pub const TRANSIENT: usize = 1 << 3;
pub const STATIONARY: usize = 1 << 4;
pub const IGNORES_CYCLE: usize = 1 << 6;
pub const FULL_SCREEN_PRIMARY: usize = 1 << 7;
pub const FULL_SCREEN_AUXILIARY: usize = 1 << 8;

/// Every Space, a full-screen app's included; still while Spaces move; out of ⌘` cycling.
pub const OVER_FULL_SCREEN: usize = CAN_JOIN_ALL_SPACES | STATIONARY | IGNORES_CYCLE | FULL_SCREEN_AUXILIARY;

/// What a Brenda window should be: its level and its collection behaviour.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Want {
    pub level: isize,
    pub behaviour: usize,
}

/// What a window is now.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Now {
    pub panel: bool,
    pub style: usize,
    pub level: isize,
    pub behaviour: usize,
    pub visible: bool,
    pub on_active_space: bool,
}

/// What to put right.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Fix {
    /// Swap the window's class for the panel class.
    pub panel: bool,
    /// Add the non-activating style (and prevent activation).
    pub style: bool,
    pub level: bool,
    pub behaviour: bool,
    /// orderFrontRegardless: a visible window not on the Space showing, or any visible one after a policy change.
    pub order_front: bool,
}

/// Whether a collection behaviour lets a window float over every Space, full-screen ones included, without being moved
/// or managed like an app window. Pure (tested).
pub fn joins_full_screen(behaviour: usize) -> bool {
    let need = CAN_JOIN_ALL_SPACES | FULL_SCREEN_AUXILIARY;
    let never = MOVE_TO_ACTIVE_SPACE | MANAGED | FULL_SCREEN_PRIMARY;
    behaviour & need == need && behaviour & never == 0
}

/// What `ensure` changes on a window. `policy_changed`: the activation policy changed since this window was last seen,
/// so the behaviour is set again and a visible window ordered in even when they look right. Pure (tested).
pub fn fixes(want: Want, now: Now, policy_changed: bool) -> Fix {
    Fix {
        panel: !now.panel,
        style: !now.panel || now.style & NONACTIVATING_PANEL == 0,
        level: now.level != want.level,
        behaviour: policy_changed || now.behaviour != want.behaviour,
        order_front: now.visible && (policy_changed || !now.on_active_space),
    }
}

#[cfg(target_os = "macos")]
pub use mac::{after_policy_change, ensure, ensure_window};

#[cfg(not(target_os = "macos"))]
pub fn after_policy_change() {}
#[cfg(not(target_os = "macos"))]
pub fn ensure_window(_window: &tauri::WebviewWindow, _want: Want) {}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::ffi;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{class, msg_send, sel};
    use std::ffi::{c_char, CStr};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};

    /// The framework's window class, the only one converted (anything else is left an ordinary window).
    const TAO_WINDOW: &CStr = c"TaoWindow";
    const PANEL_CLASS: &CStr = c"BrendaPanel";

    /// Bumped by every change of activation policy.
    static POLICY_GEN: AtomicU64 = AtomicU64::new(0);
    /// The windows seen: (NSWindow pointer, what it should be, the policy generation it was last put right under).
    /// Pointers are only used after being found in NSApp's window list.
    static SEEN: Mutex<Vec<(usize, Want, u64)>> = Mutex::new(Vec::new());
    /// The panel class, made once (0 when it could not be made safely).
    static PANEL: OnceLock<usize> = OnceLock::new();

    /// Size and log2 alignment of an ivar from its type encoding; None for anything unexpected.
    fn ivar_layout(enc: &[u8]) -> Option<(usize, u8)> {
        match enc.first()? {
            b'c' | b'C' | b'B' => Some((1, 0)),
            b's' | b'S' => Some((2, 1)),
            b'i' | b'I' | b'f' => Some((4, 2)),
            b'q' | b'Q' | b'l' | b'L' | b'd' | b'^' | b'@' | b'#' | b':' | b'*' => Some((8, 3)),
            _ => None,
        }
    }

    /// An NSPanel subclass with the framework window class's own fields and methods (main thread).
    unsafe fn panel_class(base: *const AnyClass) -> Option<*const AnyClass> {
        let made = *PANEL.get_or_init(|| unsafe { make_panel_class(base) }.map(|c| c as usize).unwrap_or(0));
        (made != 0).then_some(made as *const AnyClass)
    }

    unsafe fn make_panel_class(base: *const AnyClass) -> Option<*const AnyClass> {
        let existing = ffi::objc_lookUpClass(PANEL_CLASS.as_ptr());
        if !existing.is_null() {
            return Some(existing);
        }
        let panel = class!(NSPanel) as *const AnyClass;
        let base_super = ffi::class_getSuperclass(base);
        // The swap is only sound when NSPanel lays out exactly like the class the framework built on (NSWindow).
        if base_super.is_null() || ffi::class_getInstanceSize(panel) != ffi::class_getInstanceSize(base_super) {
            eprintln!("[brenda] the panel class differs from the window class here; Brenda's windows stay ordinary windows");
            return None;
        }
        let cls = ffi::objc_allocateClassPair(panel, PANEL_CLASS.as_ptr(), 0);
        if cls.is_null() {
            return None;
        }
        let mut n: std::ffi::c_uint = 0;
        let ivars = ffi::class_copyIvarList(base, &mut n);
        let mut names: Vec<*const c_char> = Vec::new();
        let mut ok = true;
        for i in 0..n as usize {
            let iv = *ivars.add(i);
            let (name, enc) = (ffi::ivar_getName(iv), ffi::ivar_getTypeEncoding(iv));
            if name.is_null() || enc.is_null() {
                ok = false;
                break;
            }
            let Some((size, align)) = ivar_layout(CStr::from_ptr(enc).to_bytes()) else {
                ok = false;
                break;
            };
            if !ffi::class_addIvar(cls, name, size, align, enc).as_bool() {
                ok = false;
                break;
            }
            names.push(name);
        }
        if !ivars.is_null() {
            ffi::free(ivars as *mut _);
        }
        if !ok {
            ffi::objc_disposeClassPair(cls);
            return None;
        }
        let methods = ffi::class_copyMethodList(base, &mut n);
        for i in 0..n as usize {
            let m = *methods.add(i);
            if let (Some(name), Some(imp)) = (ffi::method_getName(m), ffi::method_getImplementation(m)) {
                ffi::class_addMethod(cls, name, imp, ffi::method_getTypeEncoding(m));
            }
        }
        if !methods.is_null() {
            ffi::free(methods as *mut _);
        }
        ffi::objc_registerClassPair(cls);
        // The fields must sit where the framework's code reads them.
        let same_size = ffi::class_getInstanceSize(cls) == ffi::class_getInstanceSize(base);
        let same_offsets = names.iter().all(|&name| {
            let (a, b) = (ffi::class_getInstanceVariable(cls, name), ffi::class_getInstanceVariable(base, name));
            !a.is_null() && !b.is_null() && ffi::ivar_getOffset(a) == ffi::ivar_getOffset(b)
        });
        if !(same_size && same_offsets) {
            eprintln!("[brenda] the panel class did not line up with the window class; Brenda's windows stay ordinary windows");
            return None;
        }
        Some(cls)
    }

    unsafe fn is_panel(ns: &AnyObject) -> bool {
        let cls = ffi::object_getClass(ns);
        PANEL.get().is_some_and(|&p| p != 0 && cls as usize == p)
    }

    /// Turns a framework window into a non-activating panel (main thread). False when it was left as it is.
    unsafe fn make_panel(ns: *mut AnyObject) -> bool {
        let cls = ffi::object_getClass(ns);
        if cls.is_null() || CStr::from_ptr(ffi::class_getName(cls)) != TAO_WINDOW {
            return false;
        }
        let Some(panel) = panel_class(cls) else { return false };
        ffi::object_setClass(ns, panel);
        true
    }

    unsafe fn now(ns: &AnyObject) -> Now {
        Now {
            panel: is_panel(ns),
            style: msg_send![ns, styleMask],
            level: msg_send![ns, level],
            behaviour: msg_send![ns, collectionBehavior],
            visible: msg_send![ns, isVisible],
            on_active_space: msg_send![ns, isOnActiveSpace],
        }
    }

    /// Makes the window what Brenda's windows must be, and records it for the next policy change (main thread only).
    pub unsafe fn ensure(ns: *mut AnyObject, want: Want) {
        if ns.is_null() {
            return;
        }
        debug_assert!(joins_full_screen(want.behaviour), "a Brenda window must float over full-screen Spaces");
        let gen = POLICY_GEN.load(Ordering::SeqCst);
        let key = ns as usize;
        let policy_changed = {
            let mut seen = SEEN.lock().unwrap();
            match seen.iter_mut().find(|(p, _, _)| *p == key) {
                Some(entry) => {
                    let changed = entry.2 != gen;
                    *entry = (key, want, gen);
                    changed
                }
                None => {
                    seen.push((key, want, gen));
                    false
                }
            }
        };
        let fix = fixes(want, now(&*ns), policy_changed);
        if fix.panel {
            make_panel(ns); // when it cannot be, it stays an ordinary window: the level and behaviour still apply
        }
        let ns_ref = &*ns;
        if fix.style && is_panel(ns_ref) {
            let style: usize = msg_send![ns_ref, styleMask];
            let _: () = msg_send![ns_ref, setStyleMask: style | NONACTIVATING_PANEL];
            // An NSPanel made non-activating from the start also prevents activation; one given the style later does
            // not (checked on macOS 26), so it is set the same way. Private, so only when it is there.
            let prevent = sel!(_setPreventsActivation:);
            let responds: bool = msg_send![ns_ref, respondsToSelector: prevent];
            if responds {
                let _: () = msg_send![ns_ref, _setPreventsActivation: Bool::YES];
            }
            let _: () = msg_send![ns_ref, setHidesOnDeactivate: false];
            let _: () = msg_send![ns_ref, setBecomesKeyOnlyIfNeeded: false];
        }
        if fix.level {
            let _: () = msg_send![ns_ref, setLevel: want.level];
        }
        if fix.behaviour {
            let _: () = msg_send![ns_ref, setCollectionBehavior: want.behaviour];
        }
        if fix.order_front {
            let _: () = msg_send![ns_ref, orderFrontRegardless];
        }
    }

    /// `ensure` for a window, on the main thread.
    pub fn ensure_window(window: &tauri::WebviewWindow, want: Want) {
        let w = window.clone();
        let _ = window.run_on_main_thread(move || {
            if let Ok(ns) = w.ns_window() {
                unsafe { ensure(ns as *mut AnyObject, want) };
            }
        });
    }

    /// After every change of activation policy (main thread): every Brenda window still open has its behaviour set again
    /// and, when visible, is ordered in, so it keeps entering full-screen Spaces whatever the policy now is.
    pub fn after_policy_change() {
        POLICY_GEN.fetch_add(1, Ordering::SeqCst);
        unsafe {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            if ns_app.is_null() {
                return;
            }
            let windows: *mut AnyObject = msg_send![&*ns_app, windows];
            if windows.is_null() {
                return;
            }
            let count: usize = msg_send![&*windows, count];
            let open: Vec<usize> = (0..count)
                .map(|i| {
                    let w: *mut AnyObject = msg_send![&*windows, objectAtIndex: i];
                    w as usize
                })
                .collect();
            let todo: Vec<(usize, Want)> = {
                let mut seen = SEEN.lock().unwrap();
                seen.retain(|(p, _, _)| open.contains(p)); // closed windows are forgotten
                seen.iter().map(|(p, w, _)| (*p, *w)).collect()
            };
            for (p, want) in todo {
                ensure(p as *mut AnyObject, want);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTCH: Want = Want { level: 1001, behaviour: OVER_FULL_SCREEN };

    fn right() -> Now {
        Now { panel: true, style: NONACTIVATING_PANEL, level: 1001, behaviour: OVER_FULL_SCREEN, visible: true, on_active_space: true }
    }

    #[test]
    fn the_behaviour_floats_over_full_screen_apps() {
        assert!(joins_full_screen(OVER_FULL_SCREEN));
        assert_eq!(OVER_FULL_SCREEN, 1 | 16 | 64 | 256); // the value island.rs, companion.rs and capture.rs have used
        assert!(joins_full_screen(crate::companion::BEHAVIOUR));
        // Without the auxiliary flag, or moved to the active Space, or managed like an app window, it does not.
        assert!(!joins_full_screen(CAN_JOIN_ALL_SPACES | STATIONARY));
        assert!(!joins_full_screen(OVER_FULL_SCREEN | MOVE_TO_ACTIVE_SPACE));
        assert!(!joins_full_screen(OVER_FULL_SCREEN | MANAGED));
        assert!(!joins_full_screen(OVER_FULL_SCREEN | FULL_SCREEN_PRIMARY));
        assert!(!joins_full_screen(FULL_SCREEN_AUXILIARY));
        // Transient instead of stationary is still allowed.
        assert!(joins_full_screen(CAN_JOIN_ALL_SPACES | TRANSIENT | FULL_SCREEN_AUXILIARY));
    }

    #[test]
    fn a_window_already_right_is_left_alone() {
        assert_eq!(fixes(NOTCH, right(), false), Fix::default());
    }

    #[test]
    fn a_fresh_framework_window_becomes_a_non_activating_panel() {
        // As the framework makes it: an NSWindow at the floating level, joining all Spaces only.
        let fresh = Now { panel: false, style: 0, level: 3, behaviour: CAN_JOIN_ALL_SPACES, visible: false, on_active_space: false };
        let f = fixes(NOTCH, fresh, false);
        assert!(f.panel && f.style && f.level && f.behaviour);
        assert!(!f.order_front, "a hidden window is not ordered in");
    }

    #[test]
    fn a_lost_style_or_level_or_behaviour_is_put_back() {
        assert_eq!(fixes(NOTCH, Now { style: 0, ..right() }, false), Fix { style: true, ..Fix::default() });
        // The framework's set_always_on_top / show re-applies the floating level (3).
        assert_eq!(fixes(NOTCH, Now { level: 3, ..right() }, false), Fix { level: true, ..Fix::default() });
        // The framework's set_visible_on_all_workspaces keeps other bits but can drop ours.
        assert_eq!(fixes(NOTCH, Now { behaviour: CAN_JOIN_ALL_SPACES, ..right() }, false), Fix { behaviour: true, ..Fix::default() });
    }

    #[test]
    fn a_visible_window_off_the_space_showing_is_ordered_in() {
        assert_eq!(fixes(NOTCH, Now { on_active_space: false, ..right() }, false), Fix { order_front: true, ..Fix::default() });
        assert_eq!(fixes(NOTCH, Now { on_active_space: false, visible: false, ..right() }, false), Fix::default());
    }

    #[test]
    fn after_a_policy_change_the_behaviour_is_set_again_and_a_visible_window_ordered_in() {
        assert_eq!(fixes(NOTCH, right(), true), Fix { behaviour: true, order_front: true, ..Fix::default() });
        assert_eq!(fixes(NOTCH, Now { visible: false, ..right() }, true), Fix { behaviour: true, ..Fix::default() });
    }
}
