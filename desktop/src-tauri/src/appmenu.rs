//! Boredroom's Mac menus, quitting and alerts (owner request, 24 October 2026).
//!
//! The menu bar shows while the Boredroom window is open (the app is an ordinary Mac app then): Boredroom (About,
//! Settings…, the assistant's settings on this Mac, Check for Updates…, Services, Hide, Quit), Edit (which also serves the
//! notch's ask box, as the default menu did), View, Window and Help. With the window closed the key equivalents still
//! work (⌘C, ⌘V in the notch). Every custom id starts with `app.`: the tray's menu listener is global and receives them
//! too, and the tray's own ids never start so.
//!
//! The Mac app shell (owner request, 26 October 2026): File › New To-do (⌘N) and a Go menu, ⌘1–⌘9 for the workspace's
//! main sections (dashboard::SECTIONS), moving the window's page without reloading it (dashboard::go).

use std::sync::Mutex;
use tauri::{
    menu::{AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Manager, Wry,
};

/// Every custom app-menu id (a test checks they're unique and that no tray id looks like one).
#[cfg(test)]
pub const IDS: &[&str] = &[
    "app.settings",
    "app.mac",
    "app.updates",
    "app.quit",
    "app.reload",
    "app.zoom0",
    "app.zoomin",
    "app.zoomout",
    "app.back",
    "app.forward",
    "app.fullscreen",
    "app.minimise",
    "app.zoom",
    "app.close",
    "app.show",
    "app.help",
    "app.new_todo",
    "app.go1",
    "app.go2",
    "app.go3",
    "app.go4",
    "app.go5",
    "app.go6",
    "app.go7",
    "app.go8",
    "app.go9",
];

const HELP_URL: &str = "https://www.boredroom.cc/download#faq";

/// The menu item that carries the assistant's name.
pub struct AppMenu {
    mac: MenuItem<Wry>,
    /// Go › the assistant's page (⌘1), named after the assistant.
    home: MenuItem<Wry>,
}

pub fn mac_label(name: &str) -> String {
    format!("{name} on this Mac…")
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let about = PredefinedMenuItem::about(
        app,
        Some("About Boredroom"),
        Some(AboutMetadata {
            name: Some("Boredroom".into()),
            version: Some(env!("CARGO_PKG_VERSION").into()),
            copyright: Some("© 2026 Boredroom".into()),
            icon: app.default_window_icon().cloned(),
            ..Default::default()
        }),
    )?;
    let settings = MenuItem::with_id(app, "app.settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let mac = MenuItem::with_id(app, "app.mac", mac_label("Brenda"), true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "app.updates", "Check for Updates…", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "app.quit", "Quit Boredroom", true, Some("CmdOrCtrl+Q"))?;
    let sep = || PredefinedMenuItem::separator(app);
    let boredroom = Submenu::with_items(
        app,
        "Boredroom",
        true,
        &[
            &about,
            &sep()?,
            &settings,
            &mac,
            &updates,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, Some("Hide Boredroom"))?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &quit,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let item = |id: &str, text: &str, acc: Option<&str>| MenuItem::with_id(app, id, text, true, acc);
    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &item("app.reload", "Reload Page", Some("CmdOrCtrl+R"))?,
            &sep()?,
            &item("app.zoom0", "Actual Size", Some("CmdOrCtrl+0"))?,
            &item("app.zoomin", "Zoom In", Some("CmdOrCtrl+="))?,
            &item("app.zoomout", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &sep()?,
            &item("app.back", "Back", Some("CmdOrCtrl+["))?,
            &item("app.forward", "Forward", Some("CmdOrCtrl+]"))?,
            &sep()?,
            &item("app.fullscreen", "Enter Full Screen", Some("Ctrl+Cmd+F"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &item("app.minimise", "Minimise", Some("CmdOrCtrl+M"))?,
            &item("app.zoom", "Zoom", None)?,
            &item("app.close", "Close Window", Some("CmdOrCtrl+W"))?,
            &sep()?,
            &item("app.show", "Boredroom", None)?,
            &PredefinedMenuItem::bring_all_to_front(app, None)?,
        ],
    )?;
    let help = Submenu::with_items(app, "Help", true, &[&item("app.help", "Boredroom for Mac Help", None)?])?;
    let file = Submenu::with_items(app, "File", true, &[&item("app.new_todo", "New To-do", Some("CmdOrCtrl+N"))?])?;
    let label = |i: usize| crate::dashboard::SECTIONS[i].1;
    let home = item("app.go1", "Brenda", Some("CmdOrCtrl+1"))?;
    let go = Submenu::with_items(
        app,
        "Go",
        true,
        &[
            &home,
            &item("app.go2", label(1), Some("CmdOrCtrl+2"))?,
            &item("app.go3", label(2), Some("CmdOrCtrl+3"))?,
            &item("app.go4", label(3), Some("CmdOrCtrl+4"))?,
            &item("app.go5", label(4), Some("CmdOrCtrl+5"))?,
            &item("app.go6", label(5), Some("CmdOrCtrl+6"))?,
            &item("app.go7", label(6), Some("CmdOrCtrl+7"))?,
            &item("app.go8", label(7), Some("CmdOrCtrl+8"))?,
            &item("app.go9", label(8), Some("CmdOrCtrl+9"))?,
        ],
    )?;
    app.manage(AppMenu { mac, home });
    Menu::with_items(app, &[&boredroom, &file, &edit, &view, &go, &window, &help])
}

/// The assistant's name changed (the tray refreshes at the same moments).
pub fn refresh(app: &AppHandle) {
    if let Some(m) = app.try_state::<AppMenu>() {
        let name = crate::companion::name(app);
        let _ = m.mac.set_text(mac_label(&name));
        let _ = m.home.set_text(name);
    }
}

pub fn on_event(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    if !id.starts_with("app.") {
        return;
    }
    match id {
        "app.settings" => {
            let slug = app.state::<crate::AppState>().config.lock().unwrap().workspace_slug.clone();
            let path = slug.map(|s| format!("/app/{}/settings", crate::webauth::enc(&s))).unwrap_or_else(|| "/app".into());
            crate::dashboard::open(app, Some(&path));
        }
        "app.mac" => crate::open_mac_settings(app),
        "app.updates" => crate::updater::check_now(app),
        "app.quit" => quit(app),
        "app.show" => crate::dashboard::open(app, None),
        "app.help" => crate::dashboard::open_external(app, HELP_URL),
        "app.new_todo" => crate::dashboard::go(app, "todos?add=1"),
        go if go.starts_with("app.go") => {
            if let Some(i) = go_index(go) {
                crate::dashboard::go(app, crate::dashboard::SECTIONS[i].0);
            }
        }
        other => crate::dashboard::view_action(app, other),
    }
}

/// `app.go1`…`app.go9` → the section's index. Pure (tested).
pub fn go_index(id: &str) -> Option<usize> {
    let n: usize = id.strip_prefix("app.go")?.parse().ok()?;
    (1..=crate::dashboard::SECTIONS.len()).contains(&n).then(|| n - 1)
}

// ---- quitting ---------------------------------------------------------------------------------------------------------

/// What Quit asks first (pure, tested).
#[derive(Debug, PartialEq)]
pub enum QuitAsk {
    Now,
    /// A call or a task: always asked.
    Busy(String),
    /// The first time while the window is open: what quitting also stops.
    Explain,
}

pub fn quit_ask(on_call: bool, task: bool, window_open: bool, asked_before: bool, name: &str) -> QuitAsk {
    if on_call {
        QuitAsk::Busy("You're on a call. Quitting leaves it.".into())
    } else if task {
        QuitAsk::Busy(format!("{name} is doing a task for you. Quitting stops it."))
    } else if window_open && !asked_before {
        QuitAsk::Explain
    } else {
        QuitAsk::Now
    }
}

/// Quit Boredroom (⌘Q, the menu and the tray): the notch quits too, so it asks first when that matters.
pub fn quit(app: &AppHandle) {
    let name = crate::companion::name(app);
    let ask = quit_ask(crate::dashboard::on_call(app), crate::act::live(app) || crate::jobs::live_id(app).is_some(), crate::dashboard::exists(app), crate::dashboard::read(app).quit_asked, &name);
    let app2 = app.clone();
    match ask {
        QuitAsk::Now => quit_now(app),
        QuitAsk::Busy(why) => alert(app, Alert { title: "Quit Boredroom?".into(), message: why, buttons: vec!["Quit".into(), "Cancel".into()], destructive: Some(0), suppress: false }, move |i, _| {
            if i == 0 {
                quit_now(&app2);
            }
        }),
        QuitAsk::Explain => alert(
            app,
            Alert {
                title: "Quit Boredroom?".into(),
                message: format!("{name} in your notch stops too, so calls and reminders won't show until you open Boredroom again. To close just this window, press ⌘W."),
                buttons: vec!["Quit".into(), "Close Window".into(), "Cancel".into()],
                destructive: None,
                suppress: true,
            },
            move |i, dont_ask| {
                if dont_ask && i < 2 {
                    crate::dashboard::update(&app2, |f| f.quit_asked = true);
                }
                match i {
                    0 => quit_now(&app2),
                    1 => crate::dashboard::close(&app2),
                    _ => {}
                }
            },
        ),
    }
}

/// Everything stops, then the app (the tray's quit path).
pub fn quit_now(app: &AppHandle) {
    crate::act::stop(app, "quit");
    crate::jobs::stop(app, "quit");
    crate::voice::stop_speaking(app); // `afplay` and `say` would otherwise finish the sentence on their own
    app.exit(0)
}

// ---- alerts ----------------------------------------------------------------------------------------------------------

pub struct Alert {
    pub title: String,
    pub message: String,
    pub buttons: Vec<String>,
    /// The button drawn as destructive (red).
    pub destructive: Option<usize>,
    /// Shows "Don't ask again".
    pub suppress: bool,
}

impl Alert {
    pub fn info(title: &str, message: &str) -> Alert {
        Alert { title: title.into(), message: message.into(), buttons: vec!["OK".into()], destructive: None, suppress: false }
    }
}

type Done = Box<dyn FnOnce(usize, bool) + Send + 'static>;

/// An NSAlert: a sheet on the Boredroom window when it is showing, else app-modal. `done(button index, don't ask again)`
/// runs on the main thread.
pub fn alert(app: &AppHandle, a: Alert, done: impl FnOnce(usize, bool) + Send + 'static) {
    let app2 = app.clone();
    let done: Done = Box::new(done);
    let _ = app.run_on_main_thread(move || show(&app2, a, done));
}

#[cfg(target_os = "macos")]
fn show(app: &AppHandle, a: Alert, done: Done) {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject, sel};
    use objc2_foundation::NSString;
    unsafe {
        let alert: Option<Retained<AnyObject>> = msg_send![class!(NSAlert), new];
        let Some(alert) = alert else { return done(a.buttons.len(), false) };
        let t = NSString::from_str(&a.title);
        let m = NSString::from_str(&a.message);
        let _: () = msg_send![&*alert, setMessageText: &*t];
        let _: () = msg_send![&*alert, setInformativeText: &*m];
        for (i, b) in a.buttons.iter().enumerate() {
            let s = NSString::from_str(b);
            let btn: *mut AnyObject = msg_send![&*alert, addButtonWithTitle: &*s];
            if a.destructive == Some(i) && !btn.is_null() {
                let can: bool = msg_send![&*btn, respondsToSelector: sel!(setHasDestructiveAction:)];
                if can {
                    let _: () = msg_send![&*btn, setHasDestructiveAction: true];
                }
            }
        }
        if a.suppress {
            let _: () = msg_send![&*alert, setShowsSuppressionButton: true];
            let sb: *mut AnyObject = msg_send![&*alert, suppressionButton];
            if !sb.is_null() {
                let s = NSString::from_str("Don't ask again");
                let _: () = msg_send![&*sb, setTitle: &*s];
            }
        }
        let suppressed = |alert: &AnyObject| -> bool {
            let sb: *mut AnyObject = msg_send![alert, suppressionButton];
            if sb.is_null() {
                return false;
            }
            let state: isize = msg_send![&*sb, state];
            state == 1
        };
        let sheet_on = crate::dashboard::window(app).filter(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false)).and_then(|w| w.ns_window().ok()).filter(|p| !p.is_null());
        // NSAlertFirstButtonReturn is 1000.
        let index = |resp: isize| if resp >= 1000 { (resp - 1000) as usize } else { usize::MAX };
        if let Some(ns_window) = sheet_on {
            let cell = Mutex::new(Some(done));
            let keep = alert.clone();
            let block = block2::RcBlock::new(move |resp: isize| {
                if let Some(d) = cell.lock().unwrap().take() {
                    d(index(resp), suppressed(&keep));
                }
            });
            let _: () = msg_send![&*alert, beginSheetModalForWindow: ns_window as *mut AnyObject, completionHandler: &*block];
        } else {
            let ns_app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            if !ns_app.is_null() {
                let _: () = msg_send![&*ns_app, activateIgnoringOtherApps: true];
            }
            let resp: isize = msg_send![&*alert, runModal];
            done(index(resp), suppressed(&alert));
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn show(_app: &AppHandle, a: Alert, done: Done) {
    done(a.buttons.len(), false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_prefixed() {
        let mut seen = std::collections::HashSet::new();
        for id in IDS {
            assert!(id.starts_with("app."), "{id}");
            assert!(seen.insert(*id), "{id} twice");
        }
        // Every id in build() is listed, and the tray's own ids never look like the menu's.
        let src = include_str!("appmenu.rs");
        let build = src.split("pub fn build(").nth(1).unwrap().split("pub fn refresh(").next().unwrap();
        let mut rest = build;
        let mut found = 0;
        while let Some(i) = rest.find("\"app.") {
            let tail = &rest[i + 1..];
            let id = &tail[..tail.find('"').unwrap()];
            assert!(IDS.contains(&id), "{id} is not in IDS");
            found += 1;
            rest = &tail[id.len()..];
        }
        assert_eq!(found, IDS.len(), "every id is in the menu");
        let lib = include_str!("lib.rs");
        let tray = lib.split("fn tray_menu_event(").nth(1).unwrap().split("pub fn run()").next().unwrap();
        assert!(!tray.contains("\"app."), "a tray id starts with app.");
        let setup = lib.split("pub fn run()").nth(1).unwrap();
        for chunk in setup.split("MenuItem::with_id(app, \"").skip(1).chain(setup.split("CheckMenuItem::with_id(app, \"").skip(1)) {
            assert!(!chunk.starts_with("app."), "a tray id starts with app.");
        }
    }

    #[test]
    fn quitting_asks_when_it_matters() {
        assert_eq!(quit_ask(false, false, false, false, "Brenda"), QuitAsk::Now);
        assert_eq!(quit_ask(false, false, true, true, "Brenda"), QuitAsk::Now);
        assert_eq!(quit_ask(false, false, true, false, "Brenda"), QuitAsk::Explain);
        assert_eq!(quit_ask(true, false, false, true, "Brenda"), QuitAsk::Busy("You're on a call. Quitting leaves it.".into()));
        assert_eq!(quit_ask(false, true, true, true, "Max"), QuitAsk::Busy("Max is doing a task for you. Quitting stops it.".into()));
    }

    #[test]
    fn go_ids() {
        assert_eq!(go_index("app.go1"), Some(0));
        assert_eq!(go_index("app.go9"), Some(8));
        assert_eq!(go_index("app.go0"), None);
        assert_eq!(go_index("app.go10"), None);
        assert_eq!(go_index("app.goX"), None);
    }

    #[test]
    fn the_mac_item_uses_the_name() {
        assert_eq!(mac_label("Max"), "Max on this Mac…");
    }
}
