//! The timer card on the desktop (owner request, 14 November 2026: "a floating card that lives on your desktop when you're
//! working on a task … so that you don't forget that you have a task. So even though Boredroom is minimised, you can
//! still see it").
//!
//! While a task timer runs or is paused, a small card floats over the person's other windows with the task's name, its
//! clock, Pause or Resume, and Stop. It can be dragged anywhere and stays where it was put (the place is kept in the
//! app's config, on this Mac). It goes when the timer stops. Its × hides it until the next timer; the tray turns it off
//! for good. It is the person's own: nothing about it is sent to Boredroom.
//!
//! The notch owns the timer. It already polls Boredroom and already pauses, resumes and stops, so the card adds no
//! call of its own:
//!   - the notch tells Rust what the timer is after every poll and every press (`timer_card_set`), and polls at once
//!     when the person leaves the Boredroom window (`look_again`), so a task started there shows as they turn away;
//!   - Rust shows or hides the window and hands the page the view (`TimerCard.apply`, timer-card.js);
//!   - a press on the card comes back as one fixed word (`timer_card_press`), which Rust passes to the notch
//!     (`brenda://timer-card`), and the notch does what its own button does.
//!
//! The rule that no page showing model text can press Yes (lib.rs, build.rs) holds: the card's window has its own
//! capability (capabilities/timer-card.json) with this one command and window dragging, nothing else. A task's name may
//! be Brenda's words or someone else's; the most a press here can do is pause, resume or stop the person's own timer,
//! open the task's page, or hide the card.

use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

pub const LABEL: &str = "timer-card";
/// The window, in points: the card and 6 points of room for its shadow on each side (timer-card.css).
pub const WIDTH: f64 = 296.0;
pub const HEIGHT: f64 = 92.0;
/// Where it first appears: the top right of the main screen, clear of the menu bar.
const EDGE: f64 = 18.0;
const TOP: f64 = 56.0;
/// NSFloatingWindowLevel: over ordinary windows, under menus, the notch and Brenda by the pointer.
pub const LEVEL: isize = 3;
#[cfg(target_os = "macos")]
const WANT: crate::overlay::Want = crate::overlay::Want { level: LEVEL, behaviour: crate::overlay::OVER_FULL_SCREEN };

/// The words the card may send. "ready" and "hide" are answered here; the rest are the notch's to do.
pub const PRESSES: &[&str] = &["ready", "open", "pause", "resume", "stop", "hide"];
pub const STATES: &[&str] = &["running", "paused", "interrupted"];
const TITLE_MAX: usize = 120;

/// The timer as the notch passes it on.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewIn {
    id: String,
    #[serde(default)]
    title: String,
    state: String,
    elapsed: f64,
    #[serde(default)]
    estimate_minutes: Option<f64>,
}

/// The timer as the card's page gets it (timer-card.js).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    t: &'static str,
    id: String,
    title: String,
    state: String,
    elapsed: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    estimate_minutes: Option<f64>,
}

/// A view worth showing, or None: a session id, a state the card knows, a clock that is a number.
pub fn view_of(v: ViewIn) -> Option<View> {
    let id_ok = (8..=64).contains(&v.id.len()) && v.id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-');
    if !id_ok || !STATES.contains(&v.state.as_str()) || !v.elapsed.is_finite() {
        return None;
    }
    let title: String = v.title.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    let title: String = title.chars().take(TITLE_MAX).collect();
    let estimate_minutes = v.estimate_minutes.filter(|m| m.is_finite() && *m > 0.0).map(|m| m.min(1440.0));
    Some(View { t: "timer", id: v.id, title, state: v.state, elapsed: v.elapsed.clamp(0.0, 99.0 * 3600.0) as u64, estimate_minutes })
}

/// Whether the card is on screen: switched on, a timer there, and not hidden for this very timer.
pub fn shows(enabled: bool, view: Option<&View>, hidden_for: Option<&str>) -> bool {
    match view {
        Some(v) => enabled && hidden_for != Some(v.id.as_str()),
        None => false,
    }
}

/// A screen, in physical pixels, with its scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Screen {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    pub scale: f64,
}

/// Where the card's top-left corner goes (physical pixels). The place the person left it, while its middle is still
/// on some screen (a display unplugged, a resolution changed: back to the start); otherwise the top right of the main
/// screen.
pub fn place(saved: Option<(i32, i32)>, screens: &[Screen], main: usize) -> Option<(i32, i32)> {
    if let Some((x, y)) = saved {
        let on = screens.iter().any(|s| {
            let (cx, cy) = (x as f64 + WIDTH * s.scale / 2.0, y as f64 + HEIGHT * s.scale / 2.0);
            cx >= s.x as f64 && cx < s.x as f64 + s.w as f64 && cy >= s.y as f64 && cy < s.y as f64 + s.h as f64
        });
        if on {
            return Some((x, y));
        }
    }
    let s = screens.get(main).or_else(|| screens.first())?;
    Some((s.x + s.w as i32 - ((WIDTH + EDGE) * s.scale).round() as i32, s.y + (TOP * s.scale).round() as i32))
}

pub fn menu_label(on: bool) -> &'static str {
    if on { "Turn the timer card off" } else { "Turn the timer card on" }
}

#[derive(Default)]
pub struct TimerCard {
    view: Mutex<Option<View>>,
    /// The session whose card the person closed with ×: hidden until another timer starts.
    hidden_for: Mutex<Option<String>>,
    /// Where the person last dropped the card, waiting to be written to the config.
    moved: Mutex<Option<(i32, i32)>>,
    saving: AtomicBool,
    /// Rust is placing the window itself: that move is not the person's.
    placing: AtomicBool,
}

pub fn enabled(app: &AppHandle) -> bool {
    app.state::<crate::AppState>().config.lock().unwrap().timer_card.unwrap_or(true)
}

/// The tray's switch. Turning it on brings back a card that was closed with ×.
pub fn toggle(app: &AppHandle) -> bool {
    let on = !enabled(app);
    crate::update_config(app, |c| c.timer_card = Some(on));
    if on {
        *app.state::<TimerCard>().hidden_for.lock().unwrap() = None;
    }
    sync(app);
    on
}

/// Signing out, from the page or the tray: no timer to show.
pub fn clear(app: &AppHandle) {
    let state = app.state::<TimerCard>();
    *state.view.lock().unwrap() = None;
    *state.hidden_for.lock().unwrap() = None;
    sync(app);
}

/// The notch's word on the timer, after every poll and every press: the timer, or none.
#[tauri::command]
pub fn timer_card_set(app: AppHandle, view: Option<ViewIn>) {
    let state = app.state::<TimerCard>();
    let next = view.and_then(view_of);
    {
        let mut hidden = state.hidden_for.lock().unwrap();
        // A different timer (or none): the × was for the one before.
        if hidden.as_deref() != next.as_ref().map(|v| v.id.as_str()) {
            *hidden = None;
        }
    }
    *state.view.lock().unwrap() = next;
    sync(&app);
}

/// A press on the card. Only the card's own window, only the six words.
#[tauri::command]
pub fn timer_card_press(app: AppHandle, window: WebviewWindow, action: String) -> Result<(), String> {
    if window.label() != LABEL || !PRESSES.contains(&action.as_str()) {
        return Err("Not something the timer card can do.".into());
    }
    match action.as_str() {
        "ready" => sync(&app),
        "hide" => {
            let state = app.state::<TimerCard>();
            let id = state.view.lock().unwrap().as_ref().map(|v| v.id.clone());
            *state.hidden_for.lock().unwrap() = id;
            sync(&app);
        }
        word => {
            let _ = app.emit_to("notch", "brenda://timer-card", word);
        }
    }
    Ok(())
}

/// The Boredroom window was left or closed: the notch asks Boredroom for the timer now, since a task started or
/// stopped in that window is otherwise seen only at the next poll (up to 20 seconds later).
pub fn look_again(app: &AppHandle) {
    let _ = app.emit_to("notch", "brenda://timer-check", ());
}

/// Puts the window in step with the state: shown with the timer, or hidden.
fn sync(app: &AppHandle) {
    let state = app.state::<TimerCard>();
    let view = state.view.lock().unwrap().clone();
    let hidden = state.hidden_for.lock().unwrap().clone();
    if !shows(enabled(app), view.as_ref(), hidden.as_deref()) {
        if let Some(w) = app.get_webview_window(LABEL) {
            let _ = w.eval("window.TimerCard&&TimerCard.apply({t:'clear'})");
            let _ = w.hide();
        }
        return;
    }
    let (Some(view), Some(w)) = (view, window(app)) else { return };
    if let Ok(json) = serde_json::to_string(&view) {
        let _ = w.eval(format!("window.TimerCard&&TimerCard.apply({json})"));
    }
    if !w.is_visible().unwrap_or(false) {
        front(&w);
    }
}

/// The card's window, made the first time a timer runs: no title bar, see-through round the card, over every Space,
/// never the key window (it has nothing to type into, so the person's own app keeps the keyboard).
fn window(app: &AppHandle) -> Option<WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Some(w);
    }
    let w = tauri::WebviewWindowBuilder::new(app, LABEL, tauri::WebviewUrl::App("timer-card.html".into()))
        .title("Task timer")
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(false)
        .accept_first_mouse(true)
        .visible(false)
        .resizable(false)
        .visible_on_all_workspaces(true)
        .disable_drag_drop_handler()
        .inner_size(WIDTH, HEIGHT)
        .build()
        .ok()?;
    crate::island::helper_window_flags(&w);
    #[cfg(target_os = "macos")]
    crate::overlay::ensure_window(&w, WANT);

    let state = app.state::<TimerCard>();
    let saved = app.state::<crate::AppState>().config.lock().unwrap().timer_card_at;
    let screens: Vec<Screen> = w.available_monitors().unwrap_or_default().iter().map(|m| Screen { x: m.position().x, y: m.position().y, w: m.size().width, h: m.size().height, scale: m.scale_factor() }).collect();
    let main = w.primary_monitor().ok().flatten().and_then(|p| screens.iter().position(|s| s.x == p.position().x && s.y == p.position().y)).unwrap_or(0);
    if let Some((x, y)) = place(saved, &screens, main) {
        state.placing.store(true, Ordering::SeqCst);
        let _ = w.set_position(tauri::PhysicalPosition::new(x, y));
    }
    // Where the person drops it is where it stays, on this Mac.
    let app2 = app.clone();
    w.on_window_event(move |e| {
        if let tauri::WindowEvent::Moved(p) = e {
            let state = app2.state::<TimerCard>();
            if state.placing.swap(false, Ordering::SeqCst) {
                return;
            }
            *state.moved.lock().unwrap() = Some((p.x, p.y));
            // A drag is many moves: the last one is written, half a second after the first.
            if !state.saving.swap(true, Ordering::SeqCst) {
                let app3 = app2.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let state = app3.state::<TimerCard>();
                    state.saving.store(false, Ordering::SeqCst);
                    let at = state.moved.lock().unwrap().take();
                    if let Some(at) = at {
                        crate::update_config(&app3, |c| c.timer_card_at = Some(at));
                    }
                });
            }
        }
    });
    Some(w)
}

/// Shows the card without taking the keyboard or bringing Boredroom forward.
fn front(w: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, runtime::AnyObject};
        let w2 = w.clone();
        let _ = w.run_on_main_thread(move || {
            if let Ok(p) = w2.ns_window() {
                let p = p as *mut AnyObject;
                if !p.is_null() {
                    unsafe {
                        crate::overlay::ensure(p, WANT);
                        let _: () = msg_send![&*p, orderFrontRegardless];
                    }
                }
            }
        });
    }
    #[cfg(not(target_os = "macos"))]
    let _ = w.show();
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn input(v: serde_json::Value) -> ViewIn {
        serde_json::from_value(v).unwrap()
    }
    const ID: &str = "0b6f1c1e-52a4-4a0e-9b7c-6f6f2a1d9c11";

    #[test]
    fn a_timer_becomes_a_view_and_anything_else_does_not() {
        let v = view_of(input(json!({ "id": ID, "title": "  Write the\npartner FAQ ", "state": "running", "elapsed": 3725.9, "estimateMinutes": 90 }))).unwrap();
        assert_eq!(serde_json::to_value(&v).unwrap(), json!({ "t": "timer", "id": ID, "title": "Write the partner FAQ", "state": "running", "elapsed": 3725, "estimateMinutes": 90.0 }));
        let plain = view_of(input(json!({ "id": ID, "state": "paused", "elapsed": 0 }))).unwrap();
        assert_eq!(serde_json::to_value(&plain).unwrap(), json!({ "t": "timer", "id": ID, "title": "", "state": "paused", "elapsed": 0 }));
        assert!(view_of(input(json!({ "id": ID, "state": "stopped", "elapsed": 1 }))).is_none(), "a state the card does not know");
        assert!(view_of(input(json!({ "id": "x');alert(1)//", "state": "running", "elapsed": 1 }))).is_none(), "not a session id");
        assert!(view_of(input(json!({ "id": ID, "state": "running", "elapsed": -5 }))).unwrap().elapsed == 0);
        assert_eq!(view_of(input(json!({ "id": ID, "title": "x".repeat(500), "state": "running", "elapsed": 1 }))).unwrap().title.chars().count(), TITLE_MAX);
        assert!(view_of(input(json!({ "id": ID, "state": "running", "elapsed": 1, "estimateMinutes": 0 }))).unwrap().estimate_minutes.is_none());
    }

    /// What reaches the page is JSON inside a script: a task's name cannot end the call or start another.
    #[test]
    fn a_title_cannot_leave_its_string() {
        let v = view_of(input(json!({ "id": ID, "title": "\"});alert(1);({\"a\":\"</script>", "state": "running", "elapsed": 1 }))).unwrap();
        let js = serde_json::to_string(&v).unwrap();
        let back: serde_json::Value = serde_json::from_str(&js).unwrap();
        assert_eq!(back["title"], "\"});alert(1);({\"a\":\"</script>");
        assert!(js.contains("\\\"});alert"), "the quote is escaped: {js}");
    }

    #[test]
    fn the_card_shows_only_with_a_timer_switched_on_and_not_closed() {
        let v = view_of(input(json!({ "id": ID, "state": "running", "elapsed": 1 }))).unwrap();
        assert!(shows(true, Some(&v), None));
        assert!(!shows(false, Some(&v), None), "switched off in the tray");
        assert!(!shows(true, None, None), "no timer");
        assert!(!shows(true, Some(&v), Some(ID)), "closed with × for this timer");
        assert!(shows(true, Some(&v), Some("another-session-id")), "the × was for the timer before");
    }

    #[test]
    fn the_card_stays_where_it_was_put_while_that_is_on_a_screen() {
        let main = Screen { x: 0, y: 0, w: 3024, h: 1964, scale: 2.0 };
        let side = Screen { x: 3024, y: 0, w: 1920, h: 1080, scale: 1.0 };
        // The first time: the top right of the main screen, clear of the menu bar.
        assert_eq!(place(None, &[main, side], 0), Some((3024 - 628, 112)));
        assert_eq!(place(None, &[main, side], 1), Some((3024 + 1920 - 314, 56)));
        // Where it was left, on either screen.
        assert_eq!(place(Some((400, 900)), &[main, side], 0), Some((400, 900)));
        assert_eq!(place(Some((3500, 600)), &[main, side], 0), Some((3500, 600)));
        // The second screen is gone: back to the start, not off in the dark.
        assert_eq!(place(Some((3500, 600)), &[main], 0), Some((3024 - 628, 112)));
        // Dragged mostly off an edge: its middle is off every screen.
        assert_eq!(place(Some((-400, 300)), &[main], 0), Some((3024 - 628, 112)));
        assert_eq!(place(None, &[], 0), None);
    }

    #[test]
    fn the_words_and_the_tray() {
        assert_eq!(PRESSES, &["ready", "open", "pause", "resume", "stop", "hide"]);
        assert_eq!(menu_label(true), "Turn the timer card off");
        assert_eq!(menu_label(false), "Turn the timer card on");
        assert!(LEVEL < crate::companion::LEVEL, "under Brenda by the pointer, and so under menus");
    }

    /// The card's own capability: its window alone, one command and dragging, nothing else.
    #[test]
    fn the_card_can_call_one_command() {
        let cap: serde_json::Value = serde_json::from_str(include_str!("../capabilities/timer-card.json")).unwrap();
        assert_eq!(cap["windows"], json!([LABEL]));
        assert_eq!(cap["permissions"], json!(["allow-timer-card-press", "core:window:allow-start-dragging"]));
        let page = include_str!("../../src/timer-card.js");
        assert_eq!(page.matches("invoke(").count(), 1);
        assert!(page.contains("invoke(\"timer_card_press\""));
        assert!(!page.contains("listen(") && !page.contains("fetch(") && !page.contains("innerHTML"));
    }
}
