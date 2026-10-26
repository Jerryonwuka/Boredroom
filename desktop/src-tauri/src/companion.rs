//! Brenda by your pointer (owner request, 12 October 2026: "Clicky's companion cursor that follows you around, in the
//! colour of your Brenda"; companion-spec A.4, A.5, B.4).
//!
//! A small Brenda, the person's own assistant's face, follows the pointer with a gentle spring, 30 points right of and
//! below it so she never covers what it points at. She listens, thinks, speaks, points (flies to a thing on screen and
//! a ring is drawn round it), asks (while she waits for a yes) and does (only after a yes). She is two small windows,
//! never a full-screen overlay (Clicky's regressions came from those): the follower (320 × 112 points) and a ring sized
//! to its target. Both are click-through, unfocusable, content-protected (left out of every capture, Brenda's own
//! included), on every Space, and make no IPC calls (the app's ACL gives them no command, B.1).
//!
//! The pointer is read by polling (`NSEvent.mouseLocation`), never an event tap: no Input Monitoring. The thread runs
//! at 60 Hz only while she moves (the spring stepped by the time that really passed), 15 Hz while she is shown and
//! still or hidden for a moment by typing, stillness or a held button (so she is back within 70 ms of the pointer
//! moving), 4 Hz while something else hides her, and parks while she is off; every wait wakes at once when a look, a
//! task or a pointing begins. What the screen is like (displays, full screen, sharing, the screenshot tool, the lock) is
//! read once a second by a second, low-priority thread that the follow loop only reads, never waits for, and that
//! sleeps while she is parked (review, 12 October 2026: the read waited on the main thread inside the 60 Hz loop and
//! went on while she was off). Neither thread captures, calls Accessibility or touches the network.
//!
//! She sits below menus (review, 12 October 2026): her windows are at level 100, under pop-up and context menus (101)
//! and the island, over ordinary windows and the Dock; and she steps aside while a mouse button is held.
//!
//! Rust drives the pages only through `window.eval("window.Companion&&Companion.apply(<json>)")` with typed messages
//! (`bridge_script`); no other string ever goes into script.
//!
//! Phase 3 (owner report and requests, 12 October 2026): "when I turned this setting on, I stopped seeing my Brenda"
//! (companion2-spec F): she shows whenever screen help is on and "Show {name} by my pointer" is on (consent 2 or 3),
//! except the hiding rules above, and the tray and the settings card say which rule hides her (`status`, and a
//! `brenda://companion` event when a lasting reason changes, at most once a second). After setup turns screen help on
//! she greets by the pointer for three seconds (`greet`). "Some of the highlighted items have very wiggly lines, I
//! don't like that" (companion2-spec E): the ring is a clean rounded rectangle or ellipse in her coat colour, drawn in
//! one 250 ms stroke (`ring.js`); Rust sends the colour (`face.mid`) and the glow (`face.edge`).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::VecDeque,
    sync::{Condvar, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

use crate::look::Bounds;

// ---- the contract with companion.js (B.4.1) -------------------------------------------------------------------------

pub const WIN_W: f64 = 320.0;
pub const WIN_H: f64 = 112.0;
/// The face box is 26 × 26 at inset 16: its centre in the window, and with each flip.
pub const FACE: (f64, f64) = (29.0, 29.0);
pub const FACE_FLIP_X: f64 = 291.0;
pub const FACE_FLIP_Y: f64 = 83.0;
/// Her centre sits this far right of and below the pointer's hotspot.
pub const OFFSET: (f64, f64) = (30.0, 30.0);
/// Always this far inside the display's visible frame.
pub const MARGIN: f64 = 8.0;
pub const STIFFNESS: f64 = 320.0;
pub const DAMPING: f64 = 29.0;
pub const DT: f64 = 1.0 / 60.0;
/// She fades after this long still, over this long; she comes back when the pointer moves more than `WAKE_MOVE`.
pub const STILL_MS: u64 = 3_000;
pub const FADE_MS: u64 = 400;
pub const WAKE_MOVE: f64 = 2.0;
/// A key in the last this-many ms hides her while idle.
pub const TYPING_MS: u64 = 500;
/// An exchange (a look) ends at most this long after it began, so she can never stick on screen.
pub const EXCHANGE_MAX: Duration = Duration::from_secs(60);
pub const EXCHANGE_TAIL: Duration = Duration::from_secs(1);
/// Pointing (A.5): the ring's room round the target, the label's room, the hold.
pub const RING_PAD: f64 = 6.0;
pub const RING_ROOM: f64 = 16.0;
pub const LABEL_ROOM: f64 = 40.0;
/// The clean ring's one stroke (owner request, 12 October 2026: no wobble).
pub const RING_DRAW_MS: u64 = 250;
pub const RING_HOLD_MS: u64 = 2_500;
pub const RING_CLEAR_MS: u64 = 300;
pub const MAX_POINTS: usize = 3;
/// A control this small or smaller gets an ellipse; bigger, a rounded rectangle.
pub const CIRCLE_MAX: f64 = 56.0;
/// Close the ring window after this long unused.
pub const RING_IDLE: Duration = Duration::from_secs(30);
pub const MAX_LEVELS_PER_S: f64 = 30.0;
/// Under pop-up and context menus (NSPopUpMenuWindowLevel, 101) and the island (1001), over ordinary windows, floating
/// panels and the Dock (review, 12 October 2026: at 1000 she covered the first item of a right-click menu);
/// canJoinAllSpaces | stationary | ignoresCycle | fullScreenAuxiliary.
pub const LEVEL: isize = 100;
pub const BEHAVIOUR: usize = 1 | 16 | 64 | 256;

pub const FOLLOWER: &str = "companion";
pub const RING: &str = "companion-ring";

// ---- placement and motion (pure) ------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct Flip {
    pub x: bool,
    pub y: bool,
}

/// The face's centre in the window for a flip.
pub fn face_point(f: Flip) -> (f64, f64) {
    (if f.x { FACE_FLIP_X } else { FACE.0 }, if f.y { FACE_FLIP_Y } else { FACE.1 })
}

/// Where her face's centre goes for a pointer (global top-left points) on a display's visible frame, and which way the
/// window flips (A.4 "Where"): right of and below the pointer, the other side near the right or bottom edge, always 8
/// points inside.
pub fn place(pointer: (f64, f64), visible: Bounds) -> ((f64, f64), Flip) {
    let right = visible.x + visible.w - MARGIN;
    let bottom = visible.y + visible.h - MARGIN;
    let mut flip = Flip::default();
    let mut c = (pointer.0 + OFFSET.0, pointer.1 + OFFSET.1);
    if c.0 - FACE.0 + WIN_W > right {
        flip.x = true;
        c.0 = pointer.0 - OFFSET.0;
    }
    if c.1 - FACE.1 + WIN_H > bottom {
        flip.y = true;
        c.1 = pointer.1 - OFFSET.1;
    }
    let fp = face_point(flip);
    let ox = (c.0 - fp.0).clamp(visible.x + MARGIN, (right - WIN_W).max(visible.x + MARGIN));
    let oy = (c.1 - fp.1).clamp(visible.y + MARGIN, (bottom - WIN_H).max(visible.y + MARGIN));
    ((ox + fp.0, oy + fp.1), flip)
}

/// The window's top-left for a face centre.
pub fn window_origin(centre: (f64, f64), flip: Flip) -> (f64, f64) {
    let fp = face_point(flip);
    (centre.0 - fp.0, centre.1 - fp.1)
}

/// One axis of the spring.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Spring {
    pub x: f64,
    pub v: f64,
}

impl Spring {
    /// Semi-implicit Euler: v += (k·(target − x) − c·v)·dt; x += v·dt.
    pub fn step(&mut self, target: f64, dt: f64) {
        self.v += (STIFFNESS * (target - self.x) - DAMPING * self.v) * dt;
        self.x += self.v * dt;
    }
    pub fn settled(&self, target: f64) -> bool {
        (target - self.x).abs() < 0.25 && self.v.abs() < 0.5
    }
}

/// A flight from one face centre to another (A.5 step 2): a quadratic Bézier with its control point lifted by
/// min(0.2 × distance, 80) points, clamp(distance / 800, 0.6, 1.4) s, smoothstep easing. Reduced motion: she fades out
/// where she is and in at the target (150 ms each), no path.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Flight {
    pub from: (f64, f64),
    pub to: (f64, f64),
    pub ctrl: (f64, f64),
    pub ms: u64,
    pub reduced: bool,
}

impl Flight {
    pub fn new(from: (f64, f64), to: (f64, f64), reduced: bool) -> Flight {
        let d = ((to.0 - from.0).powi(2) + (to.1 - from.1).powi(2)).sqrt();
        let lift = (0.2 * d).min(80.0);
        let ctrl = ((from.0 + to.0) / 2.0, (from.1 + to.1) / 2.0 - lift);
        let ms = if reduced { 300 } else { ((d / 800.0).clamp(0.6, 1.4) * 1000.0).round() as u64 };
        Flight { from, to, ctrl, ms, reduced }
    }

    pub fn ease(t: f64) -> f64 {
        let t = t.clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    }

    pub fn point_at(&self, elapsed_ms: u64) -> (f64, f64) {
        if self.reduced {
            return if elapsed_ms < self.ms / 2 { self.from } else { self.to };
        }
        let s = Self::ease(elapsed_ms as f64 / self.ms.max(1) as f64);
        let u = 1.0 - s;
        (u * u * self.from.0 + 2.0 * u * s * self.ctrl.0 + s * s * self.to.0, u * u * self.from.1 + 2.0 * u * s * self.ctrl.1 + s * s * self.to.1)
    }
}

/// Where she lands beside a target (A.5 step 2): just outside the ring's lower right, 8 points beyond it; on the left
/// when that would leave the display; always 20 points inside.
pub fn landing(target: Bounds, display: Bounds) -> (f64, f64) {
    let ring = grow(target, RING_PAD);
    let face_r = 13.0;
    let mut x = ring.x + ring.w + MARGIN + face_r;
    let y = ring.y + ring.h + MARGIN + face_r;
    if x > display.x + display.w - 20.0 {
        x = ring.x - MARGIN - face_r;
    }
    (x.clamp(display.x + 20.0, display.x + display.w - 20.0), y.clamp(display.y + 20.0, display.y + display.h - 20.0))
}

pub fn grow(r: Bounds, by: f64) -> Bounds {
    Bounds { x: r.x - by, y: r.y - by, w: r.w + 2.0 * by, h: r.h + 2.0 * by }
}

/// The ring window for a target: grown by 6 points plus 16 of room each side, and 40 more for the label (below it, or
/// above it at the bottom of the display).
pub fn ring_frame(target: Bounds, display: Bounds) -> (Bounds, bool) {
    let r = grow(target, RING_PAD + RING_ROOM);
    let above = r.y + r.h + LABEL_ROOM > display.y + display.h;
    if above {
        (Bounds { x: r.x, y: r.y - LABEL_ROOM, w: r.w, h: r.h + LABEL_ROOM }, true)
    } else {
        (Bounds { x: r.x, y: r.y, w: r.w, h: r.h + LABEL_ROOM }, false)
    }
}

/// The pointing sequence's timeline (B.4.5), in ms from the start of the flight out.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Timeline {
    pub ring_at: u64,
    pub landed_at: u64,
    pub clear_at: u64,
    pub back_at: u64,
}

pub fn timeline(out_ms: u64) -> Timeline {
    let ring_at = out_ms * 8 / 10;
    let clear_at = ring_at + RING_DRAW_MS + RING_HOLD_MS;
    Timeline { ring_at, landed_at: out_ms, clear_at, back_at: clear_at + RING_CLEAR_MS }
}

// ---- visibility (pure) ----------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Inputs {
    pub setting_on: bool,
    pub exchange: bool,
    /// A task is asking, doing or paused.
    pub act_live: bool,
    pub key_age_ms: Option<u64>,
    /// The pointer moved more than 2 points since the last key went down.
    pub moved_since_typing: bool,
    pub still_ms: u64,
    pub front_fullscreen: bool,
    pub call_live: bool,
    pub sharing: bool,
    pub screenshot_tool: bool,
    pub mirrored_or_captured: bool,
    pub locked: bool,
    pub screen_help_on: bool,
    pub signed_in: bool,
    /// A mouse button is held (a menu opening, a drag): she steps aside while idle.
    pub button_held: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Vis {
    pub shown: bool,
    pub reason: &'static str,
}

/// Whether she is shown (A.4 "When she hides", in its order).
pub fn visibility(i: &Inputs) -> Vis {
    let hide = |reason| Vis { shown: false, reason };
    if !i.signed_in {
        return hide("signed_out");
    }
    if !i.screen_help_on {
        return hide("screen_help_off");
    }
    if i.locked {
        return hide("locked");
    }
    if i.call_live {
        return hide("call");
    }
    if i.sharing {
        return hide("sharing");
    }
    if i.act_live {
        return Vis { shown: true, reason: "act" };
    }
    if i.mirrored_or_captured {
        return hide("mirrored");
    }
    if i.screenshot_tool {
        return hide("screenshot_tool");
    }
    if i.exchange {
        return Vis { shown: true, reason: "exchange" };
    }
    if !i.setting_on {
        return hide("setting_off");
    }
    if i.button_held {
        return hide("pressing");
    }
    if i.key_age_ms.is_some_and(|a| a < TYPING_MS) || !i.moved_since_typing {
        return hide("typing");
    }
    if i.front_fullscreen {
        return hide("full_screen");
    }
    if i.still_ms >= STILL_MS {
        return hide("still");
    }
    Vis { shown: true, reason: "idle" }
}

/// Screen help as the companion reads it: on, under consent 2 or 3 (companion2-spec F: setup's consent 3 counts).
pub fn screen_help_of(on: bool, consent: u32) -> bool {
    on && consent >= 2
}

/// Whether the follower window is kept: signed in, screen help on, and the setting on (or a task, an exchange, or one
/// just ended).
pub fn keep_follower(signed_in: bool, screen_help: bool, setting: bool, act: bool, exchange_live: bool, recently_closed: bool) -> bool {
    signed_in && screen_help && (setting || act || exchange_live || recently_closed)
}

/// The reasons that hide her only for a moment (typing, keeping still, a held button) read as shown; the others are
/// lasting and are named in the tray and the settings card (companion2-spec F).
pub fn shown_for(reason: &str) -> bool {
    matches!(reason, "idle" | "exchange" | "act" | "typing" | "still" | "pressing")
}

/// What the tray, the settings card and the Mac state say about her.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct CompanionStatus {
    /// "Show {name} by my pointer".
    pub on: bool,
    pub shown: bool,
    pub why: &'static str,
}

impl CompanionStatus {
    pub fn of(on: bool, vis: Vis) -> Self {
        CompanionStatus { on, shown: shown_for(vis.reason), why: vis.reason }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rate {
    Hz60,
    Hz15,
    Hz4,
    Parked,
}

impl Rate {
    pub fn period(self) -> Duration {
        match self {
            Rate::Hz60 => Duration::from_micros(16_667),
            Rate::Hz15 => Duration::from_micros(66_667),
            Rate::Hz4 => Duration::from_millis(250),
            Rate::Parked => Duration::from_secs(2),
        }
    }
}

/// How often the thread runs (B.4.3).
pub fn rate(vis: Vis, moving: bool) -> Rate {
    if vis.shown {
        return if moving { Rate::Hz60 } else { Rate::Hz15 };
    }
    match vis.reason {
        // Hidden for a moment: polled at 15 Hz (no window work), so she comes back as soon as the pointer moves.
        "typing" | "still" | "pressing" => Rate::Hz15,
        "full_screen" | "mirrored" | "screenshot_tool" | "call" | "sharing" | "locked" => Rate::Hz4,
        _ => Rate::Parked,
    }
}

// ---- the bridge -----------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum State {
    #[default]
    Idle,
    Listening,
    Thinking,
    Speaking,
    Pointing,
    Asking,
    Doing,
    Paused,
    Done,
    Sad,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct FaceColours {
    pub hi: String,
    pub mid: String,
    pub edge: String,
}

/// The person's assistant as the page sends it (`companion_set_look`).
#[derive(Clone, Debug, Deserialize, Default)]
pub struct LookIn {
    #[serde(default)]
    pub colour: Option<String>,
    #[serde(default)]
    pub face: Option<Value>,
    #[serde(default)]
    pub visor: Option<String>,
    #[serde(default)]
    pub eyes: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct AssistantLook {
    pub colour: String,
    pub face: FaceColours,
    pub visor: String,
    pub eyes: String,
    pub name: String,
}

pub const NAME_MAX: usize = 24;

fn hex(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl AssistantLook {
    pub fn brenda() -> Self {
        AssistantLook {
            colour: "white".into(),
            face: FaceColours { hi: "#ffffff".into(), mid: "#ececf0".into(), edge: "#c9cad1".into() },
            visor: "bean".into(),
            eyes: "pill".into(),
            name: "Brenda".into(),
        }
    }

    /// Validated like the page's `assistantOf`: anything missing or unexpected is Brenda's.
    pub fn of(l: &LookIn) -> Self {
        let b = Self::brenda();
        let name: String = l.name.as_deref().unwrap_or("").split_whitespace().collect::<Vec<_>>().join(" ").chars().take(NAME_MAX).collect::<String>().trim().to_string();
        let colour = l.colour.clone().filter(|c| (1..=16).contains(&c.len()) && c.chars().all(|ch| ch.is_ascii_lowercase()));
        let face = l.face.as_ref().and_then(|f| {
            let get = |k: &str| f.get(k).and_then(|v| v.as_str()).filter(|s| hex(s)).map(String::from);
            Some(FaceColours { hi: get("hi")?, mid: get("mid")?, edge: get("edge")? })
        });
        AssistantLook {
            colour: colour.unwrap_or(b.colour),
            face: face.unwrap_or(b.face),
            visor: l.visor.clone().filter(|v| ["bean", "band", "screen"].contains(&v.as_str())).unwrap_or(b.visor),
            eyes: l.eyes.clone().filter(|v| ["pill", "round", "square"].contains(&v.as_str())).unwrap_or(b.eyes),
            name: if name.is_empty() { b.name } else { name },
        }
    }
}

/// Messages to `Companion.apply` (B.4.2), camelCase.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Msg {
    Look {
        colour: String,
        face: FaceColours,
        visor: String,
        eyes: String,
        name: String,
    },
    State {
        state: State,
        text: String,
        sub: String,
        hint: String,
        flip: Flip,
    },
    Level {
        v: f64,
    },
    Flight {
        ms: u64,
        dx: f64,
        dy: f64,
    },
    Badge {
        on: bool,
    },
    Motion {
        reduce: bool,
    },
    Fade {
        visible: bool,
    },
}

/// Messages to `Ring.apply`.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum RingMsg {
    #[serde(rename_all = "camelCase")]
    Ring {
        w: f64,
        h: f64,
        shape: &'static str,
        label: String,
        seed: u32,
        label_at: &'static str,
        draw: bool,
        /// Her coat colour and its glow (`face.mid`, `face.edge`); the page draws orange without them.
        #[serde(skip_serializing_if = "Option::is_none")]
        colour: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        glow: Option<String>,
    },
    Tap,
    Clear,
}

/// The ring's colour and glow: her coat's `face.mid` and `face.edge` once the page has said who she is (companion2-spec
/// E); none before, and the page draws orange.
pub fn ring_colours(look: Option<&AssistantLook>) -> (Option<String>, Option<String>) {
    match look {
        Some(l) if hex(&l.face.mid) && hex(&l.face.edge) => (Some(l.face.mid.to_ascii_lowercase()), Some(l.face.edge.to_ascii_lowercase())),
        _ => (None, None),
    }
}

/// Cuts a string to `n` characters, control characters taken out.
pub fn clip(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(n).collect()
}

/// The one way script reaches the companion's pages: `window.<Target>&&<Target>.apply(<json>)`, the JSON from serde
/// with U+2028 and U+2029 escaped (they end a line in older JavaScript).
pub fn bridge_script<T: Serialize>(target: &str, msg: &T) -> String {
    debug_assert!(target == "Companion" || target == "Ring");
    let json = serde_json::to_string(msg).unwrap_or_else(|_| "{}".into()).replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029");
    format!("window.{target}&&{target}.apply({json})")
}

// ---- the runtime ----------------------------------------------------------------------------------------------------

/// What the act state shows by her (asking, doing, paused); None when no task is live.
#[derive(Clone, Debug, PartialEq)]
pub struct ActView {
    pub state: State,
    pub text: String,
    pub sub: String,
    pub hint: String,
}

struct Pointing {
    rect: Bounds,
    label: String,
    display: Bounds,
    started: Instant,
    out: Flight,
    back: Option<Flight>,
    back_started: Option<Instant>,
    ring_shown: bool,
    cleared: bool,
    seed: u32,
}

struct Exchange {
    started: Instant,
    open: u32,
    last: Instant,
}

#[derive(Default)]
struct Inner {
    look: Option<AssistantLook>,
    state: State,
    text: String,
    sub: String,
    hint: String,
    /// A brief state (done, sad) and when it ends.
    brief_until: Option<Instant>,
    act: Option<ActView>,
    exchange: Option<Exchange>,
    speaking: bool,
    synthetic: bool,
    level: Option<f64>,
    badge: bool,
    points: VecDeque<(Bounds, String, Bounds)>,
    pointing: Option<Pointing>,
    taps: VecDeque<(f64, f64)>,
    dirty: bool,
    seeds: u32,
    /// The follow loop's last visibility (companion2-spec F).
    vis: Option<Vis>,
    /// The lasting reason last told to the tray and the page, and when.
    told: Option<(&'static str, Instant)>,
}

#[derive(Default)]
pub struct Companion {
    inner: Mutex<Inner>,
    wake: Condvar,
}

fn with<R>(app: &AppHandle, f: impl FnOnce(&mut Inner) -> R) -> Option<R> {
    let c = app.try_state::<Companion>()?;
    let r = f(&mut c.inner.lock().unwrap());
    c.wake.notify_all();
    Some(r)
}

/// The person's assistant's look (`companion_set_look`).
pub fn set_look(app: &AppHandle, look: &LookIn) {
    let l = AssistantLook::of(look);
    with(app, |i| {
        if i.look.as_ref() != Some(&l) {
            i.look = Some(l);
            i.dirty = true;
        }
    });
}

/// The assistant's name for the tray's words ("Show {name} by my pointer"); Brenda until the page says.
pub fn name(app: &AppHandle) -> String {
    with(app, |i| i.look.as_ref().map(|l| l.name.clone())).flatten().unwrap_or_else(|| "Brenda".into())
}

/// Whether she is by the pointer now, and why not (companion2-spec F). Before the follow loop has run, read from the
/// settings.
pub fn status(app: &AppHandle) -> CompanionStatus {
    let (signed_in, screen_help, setting) = {
        let st = app.state::<crate::AppState>();
        let c = st.config.lock().unwrap();
        (c.token.is_some(), screen_help_of(c.screen_help, c.screen_help_consent), c.companion != Some(false))
    };
    // Read without waking the follow loop (the tray and the look status ask often).
    let seen = app.try_state::<Companion>().and_then(|c| c.inner.lock().unwrap().vis);
    let vis = seen.unwrap_or(Vis {
        shown: signed_in && screen_help && setting,
        reason: if !signed_in {
            "signed_out"
        } else if !screen_help {
            "screen_help_off"
        } else if !setting {
            "setting_off"
        } else {
            "idle"
        },
    });
    CompanionStatus::of(setting, vis)
}

/// After setup turns screen help on (or finds it on), she shows by the pointer for three seconds in her done state (a
/// hop), whatever keeping still or typing would say: an exchange of three seconds (companion2-spec F).
pub fn greet(app: &AppHandle) {
    with(app, |i| {
        let now = Instant::now();
        // The exchange ends a second after `last`: three seconds in all.
        i.exchange = Some(Exchange { started: now, open: 0, last: now + Duration::from_secs(2) });
        set_brief_locked(i, State::Done, 3_000);
    });
}

/// A look began (Start): she listens by the pointer; any flight is cancelled.
pub fn exchange_begin(app: &AppHandle) {
    with(app, |i| {
        i.exchange = Some(Exchange { started: Instant::now(), open: 1, last: Instant::now() });
        cancel_pointing_locked(i);
        set_state_locked(i, State::Listening, "", "", "");
    });
}

/// The exchange's answer arrived (or it failed): it ends 1 s after the last of this, speech and pointing.
pub fn exchange_answered(app: &AppHandle) {
    with(app, |i| {
        if let Some(e) = i.exchange.as_mut() {
            e.open = e.open.saturating_sub(1);
            e.last = Instant::now();
        }
        if matches!(i.state, State::Listening | State::Thinking) {
            set_state_locked(i, State::Idle, "", "", "");
        }
    });
}

/// The exchange ended at once (refused, cancelled, nothing heard).
pub fn exchange_end(app: &AppHandle, sad: bool) {
    with(app, |i| {
        i.exchange = None;
        cancel_pointing_locked(i);
        if sad {
            set_brief_locked(i, State::Sad, 1_500);
        } else {
            set_state_locked(i, State::Idle, "", "", "");
        }
    });
}

pub fn set_state(app: &AppHandle, state: State) {
    with(app, |i| set_state_locked(i, state, "", "", ""));
}

fn set_state_locked(i: &mut Inner, state: State, text: &str, sub: &str, hint: &str) {
    i.state = state;
    i.text = clip(text, 200);
    i.sub = clip(sub, 120);
    i.hint = clip(hint, 120);
    i.brief_until = None;
    i.dirty = true;
}

fn set_brief_locked(i: &mut Inner, state: State, ms: u64) {
    set_state_locked(i, state, "", "", "");
    i.brief_until = Some(Instant::now() + Duration::from_millis(ms));
}

/// The task's state by her: asking, doing (with the latest step note), paused; None when it ends (`done` or `sad` for
/// a moment, then idle).
pub fn set_act(app: &AppHandle, view: Option<ActView>, ended: Option<bool>) {
    with(app, |i| {
        if view.is_some() {
            cancel_pointing_locked(i);
        }
        i.act = view.clone();
        match (view, ended) {
            (Some(v), _) => set_state_locked(i, v.state, &v.text, &v.sub, &v.hint),
            (None, Some(true)) => set_brief_locked(i, State::Done, 1_200),
            (None, Some(false)) => set_brief_locked(i, State::Sad, 1_500),
            (None, None) => set_state_locked(i, State::Idle, "", "", ""),
        }
    });
}

/// The microphone's or her voice's level, 0–1.
pub fn level(app: &AppHandle, v: f64) {
    with(app, |i| i.level = Some(v.clamp(0.0, 1.0)));
}

/// She is speaking (her computer voice from Rust, or the page's natural voice with a synthetic 5 Hz pulse).
pub fn speaking(app: &AppHandle, on: bool, synthetic: bool) {
    with(app, |i| {
        i.speaking = on;
        i.synthetic = on && synthetic;
        if let Some(e) = i.exchange.as_mut() {
            e.last = Instant::now();
        }
        if on && i.act.is_none() && i.pointing.is_none() {
            set_state_locked(i, State::Speaking, "", "", "");
        } else if !on && i.state == State::Speaking {
            set_state_locked(i, State::Idle, "", "", "");
        }
    });
}

/// A file job runs: the small orange dot by her.
pub fn badge(app: &AppHandle, on: bool) {
    with(app, |i| {
        i.badge = on;
        i.dirty = true;
    });
}

/// Point at a rectangle (global points) on a display (A.5), queued up to three per answer. Never while a task asks or
/// runs.
pub fn point(app: &AppHandle, rect: Bounds, label: &str, display: Bounds) {
    with(app, |i| {
        if i.act.is_some() || i.points.len() >= MAX_POINTS {
            return;
        }
        i.points.push_back((rect, clip(label, 24), display));
        if let Some(e) = i.exchange.as_mut() {
            e.last = Instant::now();
        }
    });
}

/// The ripple before a click while doing.
pub fn tap(app: &AppHandle, p: (f64, f64)) {
    with(app, |i| i.taps.push_back(p));
}

fn cancel_pointing_locked(i: &mut Inner) {
    i.points.clear();
    if i.pointing.take().is_some() {
        i.dirty = true;
    }
}

/// A new hold, a proposal, a task, a call or a lock: the ring goes and she snaps back.
pub fn cancel_pointing(app: &AppHandle) {
    with(app, cancel_pointing_locked);
}

/// Settings changed (the tray, screen help, sign-in): the thread looks again now.
pub fn wake(app: &AppHandle) {
    with(app, |i| i.dirty = true);
}

pub fn start(app: &AppHandle) {
    app.manage(Companion::default());
    let app = app.clone();
    let _ = std::thread::Builder::new().name("brenda-companion".into()).spawn(move || run(app));
}

#[cfg(not(target_os = "macos"))]
fn run(_app: AppHandle) {}

#[cfg(target_os = "macos")]
fn run(app: AppHandle) {
    mac::run(app)
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use crate::capture::{self, cocoa_frame, NSPointC};
    use crate::{guard, look, AppState};
    use objc2::{msg_send, runtime::AnyObject};
    use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

    fn build(app: &AppHandle, label: &str, page: &str) -> Option<WebviewWindow> {
        if let Some(w) = app.get_webview_window(label) {
            return Some(w);
        }
        let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App(page.into()))
            .title("Brenda")
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
            .inner_size(WIN_W, WIN_H)
            .build()
            .ok()?;
        let _ = w.set_ignore_cursor_events(true);
        crate::island::helper_window_flags(&w);
        std::thread::sleep(Duration::from_millis(300)); // the page loads before the first message
        Some(w)
    }

    fn ns(w: &WebviewWindow, f: impl FnOnce(&AnyObject) + Send + 'static) {
        let w2 = w.clone();
        let _ = w.run_on_main_thread(move || {
            if let Ok(p) = w2.ns_window() {
                let p = p as *mut AnyObject;
                if !p.is_null() {
                    f(unsafe { &*p });
                }
            }
        });
    }

    fn set_frame(w: &WebviewWindow, r: Bounds, show: bool) {
        let f = cocoa_frame(r);
        ns(w, move |n| unsafe {
            let _: () = msg_send![n, setLevel: LEVEL];
            let _: () = msg_send![n, setCollectionBehavior: BEHAVIOUR];
            let _: () = msg_send![n, setFrame: f, display: true];
            if show {
                let _: () = msg_send![n, orderFrontRegardless];
            }
        });
    }

    fn move_to(w: &WebviewWindow, origin: (f64, f64)) {
        let f = cocoa_frame(Bounds { x: origin.0, y: origin.1, w: WIN_W, h: WIN_H });
        let o = NSPointC { x: f.origin.x, y: f.origin.y };
        ns(w, move |n| unsafe {
            let _: () = msg_send![n, setFrameOrigin: o];
        });
    }

    /// The window framework re-applies its own "always on top" level when a window is shown; put hers back (island.rs).
    fn assert_level(w: &WebviewWindow) {
        ns(w, |n| unsafe {
            let level: isize = msg_send![n, level];
            if level != LEVEL {
                let _: () = msg_send![n, setLevel: LEVEL];
                let _: () = msg_send![n, setCollectionBehavior: BEHAVIOUR];
            }
        });
    }

    fn order_out(w: &WebviewWindow) {
        ns(w, |n| unsafe {
            let _: () = msg_send![n, orderOut: std::ptr::null::<AnyObject>()];
        });
    }

    fn send<T: Serialize>(w: &WebviewWindow, target: &str, msg: &T) {
        let _ = w.eval(bridge_script(target, msg));
    }

    #[derive(Clone, Default)]
    struct Env {
        displays: Vec<(u32, Bounds)>,
        visible: Vec<(u32, Bounds)>,
        fullscreen: bool,
        sharing: bool,
        screenshot_tool: bool,
        locked: bool,
        reduce: bool,
        at: Option<Instant>,
    }

    fn refresh(app: &AppHandle, env: &mut Env) {
        env.displays = capture::displays();
        env.locked = capture::screen_locked();
        if let Some(s) = capture::env_snapshot(app) {
            env.visible = s.visible;
            env.reduce = s.reduce_motion;
            env.screenshot_tool = guard::screenshot_tool_running(&s.running);
            let windows = capture::window_list(false);
            let owners: Vec<String> = windows.iter().map(|w| w.owner_name.clone()).collect();
            env.sharing = guard::sharing_suspected(&s.running, &owners);
            env.fullscreen = s.front.as_ref().is_some_and(|f| {
                windows.iter().find(|w| w.pid == f.pid && w.layer == 0 && w.alpha > 0.0).is_some_and(|w| {
                    let c = (w.bounds.x + w.bounds.w / 2.0, w.bounds.y + w.bounds.h / 2.0);
                    capture::display_at(c, &env.displays).is_some_and(|(_, d)| guard::is_full_screen(w.bounds, d))
                })
            });
        }
        env.at = Some(Instant::now());
    }

    /// What the screen is like, read once a second off the follow loop (review, 12 October 2026). `active`: the follow
    /// loop is not parked (nothing is read while she is off).
    struct Shared {
        env: Mutex<Env>,
        active: std::sync::atomic::AtomicBool,
    }

    fn reader(app: AppHandle, shared: std::sync::Arc<Shared>) {
        use std::sync::atomic::Ordering;
        loop {
            if app.try_state::<Companion>().is_none() {
                return;
            }
            let (signed_in, screen_help) = {
                let st = app.state::<AppState>();
                let cfg = st.config.lock().unwrap();
                (cfg.token.is_some(), screen_help_of(cfg.screen_help, cfg.screen_help_consent))
            };
            let due = shared.env.lock().unwrap().at.is_none_or(|t| t.elapsed() >= Duration::from_secs(1));
            if due && signed_in && screen_help && shared.active.load(Ordering::SeqCst) {
                let mut fresh = shared.env.lock().unwrap().clone();
                refresh(&app, &mut fresh);
                *shared.env.lock().unwrap() = fresh;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    }

    pub(super) fn run(app: AppHandle) {
        use std::sync::atomic::Ordering;
        let shared = std::sync::Arc::new(Shared { env: Mutex::new(Env::default()), active: std::sync::atomic::AtomicBool::new(true) });
        {
            let (app2, shared2) = (app.clone(), shared.clone());
            let _ = std::thread::Builder::new().name("brenda-companion-env".into()).spawn(move || {
                // Low priority: this thread only reads what the screen is like.
                unsafe { libc_nice() };
                reader(app2, shared2)
            });
        }
        let mut env;
        let mut last_tick = Instant::now();
        let mut follower: Option<WebviewWindow> = None;
        let mut ring: Option<WebviewWindow> = None;
        let mut ring_used = Instant::now();
        let mut ring_hide_at: Option<Instant> = None;
        let mut ring_visible = false;
        let mut asserted = Instant::now();
        let (mut sx, mut sy) = (Spring::default(), Spring::default());
        let mut placed = false;
        let mut shown = false;
        let mut fade_out_at: Option<Instant> = None;
        let mut last_pointer = (f64::NAN, f64::NAN);
        let mut last_move = Instant::now();
        let mut key_pointer: Option<(f64, f64)> = None;
        let mut last_flip = Flip::default();
        let mut last_state_sent: Option<(State, String, String, String, Flip)> = None;
        let mut look_sent = false;
        let mut badge_sent: Option<bool> = None;
        let mut reduce_sent: Option<bool> = None;
        let mut level_at = Instant::now();
        let mut exchange_closed_at: Option<Instant> = None;
        let pulse0 = Instant::now();
        loop {
            let Some(c) = app.try_state::<Companion>() else { return };
            let (signed_in, screen_help, setting) = {
                let st = app.state::<AppState>();
                let cfg = st.config.lock().unwrap();
                (cfg.token.is_some(), screen_help_of(cfg.screen_help, cfg.screen_help_consent), cfg.companion != Some(false))
            };
            let call_live = look::call_live(&app);
            let pointer = capture::pointer_top_left();
            env = shared.env.lock().unwrap().clone();
            let button_held = capture::mouse_button_held();
            if env.sharing {
                // A share starting stops a screen task (B.6.5).
                crate::act::watch(&app, false, false, true);
            }
            let key_age = capture::seconds_since_key_down().and_then(look::age_ms);
            if let Some(p) = pointer {
                let moved = !last_pointer.0.is_finite() || ((p.0 - last_pointer.0).powi(2) + (p.1 - last_pointer.1).powi(2)).sqrt() > WAKE_MOVE;
                if moved {
                    last_pointer = p;
                    last_move = Instant::now();
                }
                if key_age.is_some_and(|a| a < TYPING_MS) {
                    key_pointer = Some(p);
                }
            }
            let moved_since_typing = match (key_pointer, pointer) {
                (Some(k), Some(p)) => ((p.0 - k.0).powi(2) + (p.1 - k.1).powi(2)).sqrt() > WAKE_MOVE,
                _ => true,
            };
            if moved_since_typing {
                key_pointer = None;
            }
            let display = pointer.and_then(|p| capture::display_at(p, &env.displays));
            let mirrored = display.is_some_and(|(id, _)| capture::display_mirrored_or_captured(id));

            // Windows are built before the lock is taken: building one waits for the main thread, which may itself be
            // waiting for this lock (a command, the talk keys), so nothing here ever waits on the main thread while
            // holding it.
            let need_ring = {
                let g = c.inner.lock().unwrap();
                ring.is_none() && (g.pointing.is_some() || !g.points.is_empty() || !g.taps.is_empty())
            };
            if need_ring {
                ring = build(&app, RING, "ring.html");
                ring_used = Instant::now();
            }

            // The shared state, under the lock only as long as it takes to read and update it.
            let mut g = c.inner.lock().unwrap();
            let now = Instant::now();
            if g.brief_until.is_some_and(|t| now >= t) {
                g.brief_until = None;
                g.state = State::Idle;
                g.dirty = true;
            }
            let exchange_live = match g.exchange.as_ref() {
                None => false,
                Some(e) => {
                    let pointing = g.pointing.is_some() || !g.points.is_empty();
                    let ended = e.started.elapsed() > EXCHANGE_MAX || (e.open == 0 && !g.speaking && !pointing && e.last.elapsed() > EXCHANGE_TAIL);
                    !ended
                }
            };
            if !exchange_live && g.exchange.is_some() {
                g.exchange = None;
                exchange_closed_at = Some(now);
                if matches!(g.state, State::Listening | State::Thinking | State::Speaking | State::Pointing) {
                    g.state = State::Idle;
                    g.dirty = true;
                }
            }
            if call_live || env.locked || env.sharing {
                if g.pointing.is_some() || !g.points.is_empty() {
                    g.points.clear();
                    g.pointing = None;
                    g.dirty = true;
                }
            }
            let vis = visibility(&Inputs {
                setting_on: setting,
                exchange: exchange_live || g.pointing.is_some(),
                act_live: g.act.is_some(),
                key_age_ms: key_age,
                moved_since_typing,
                still_ms: last_move.elapsed().as_millis() as u64,
                front_fullscreen: env.fullscreen,
                call_live,
                sharing: env.sharing,
                screenshot_tool: env.screenshot_tool,
                mirrored_or_captured: mirrored,
                locked: env.locked,
                screen_help_on: screen_help,
                signed_in,
                button_held,
            });

            // Windows: the follower exists while she may be shown; it is closed when she is off (or 30 s after an
            // exchange with the setting off), so no idle webview sits over the screen.
            // A lasting reason that changed is told to the tray and the page (companion2-spec F), at most once a second,
            // off this lock (the tray reads the companion's name).
            g.vis = Some(vis);
            let lasting = if shown_for(vis.reason) { "shown" } else { vis.reason };
            if g.told.is_none_or(|(r, at)| r != lasting && at.elapsed() >= Duration::from_secs(1)) {
                g.told = Some((lasting, now));
                let (app2, st) = (app.clone(), CompanionStatus::of(setting, vis));
                std::thread::spawn(move || {
                    crate::refresh_tray(&app2);
                    let _ = app2.emit("brenda://companion", &st);
                });
            }
            let keep = keep_follower(signed_in, screen_help, setting, g.act.is_some(), exchange_live, exchange_closed_at.is_some_and(|t| t.elapsed() < Duration::from_secs(30)));
            if !keep {
                if let Some(w) = follower.take() {
                    let _ = w.close();
                    shown = false;
                    look_sent = false;
                    badge_sent = None;
                    reduce_sent = None;
                    last_state_sent = None;
                }
            }
            if vis.shown && follower.is_none() && keep {
                drop(g);
                follower = build(&app, FOLLOWER, "companion.html");
                g = c.inner.lock().unwrap();
                placed = false;
                look_sent = false;
                badge_sent = None;
                reduce_sent = None;
                last_state_sent = None;
            }

            // Pointing: start the next one, run the current one.
            if g.pointing.is_none() && g.act.is_none() {
                if let Some((rect, label, disp)) = g.points.pop_front() {
                    let from = (sx.x, sy.x);
                    let to = landing(rect, disp);
                    g.seeds = g.seeds.wrapping_add(1);
                    let seed = g.seeds.wrapping_mul(2_654_435_761);
                    g.pointing = Some(Pointing { rect, label, display: disp, started: now, out: Flight::new(from, to, env.reduce), back: None, back_started: None, ring_shown: false, cleared: false, seed });
                    g.state = State::Pointing;
                    g.dirty = true;
                    if let Some(f) = follower.as_ref() {
                        let fl = g.pointing.as_ref().unwrap().out;
                        send(f, "Companion", &Msg::Flight { ms: fl.ms, dx: fl.to.0 - fl.from.0, dy: fl.to.1 - fl.from.1 });
                    }
                }
            }
            let mut centre_override: Option<(f64, f64)> = None;
            let mut pointing_done = false;
            let g_look = g.look.clone();
            if let Some(pt) = g.pointing.as_mut() {
                let t = pt.started.elapsed().as_millis() as u64;
                let tl = timeline(pt.out.ms);
                if t < tl.landed_at {
                    centre_override = Some(pt.out.point_at(t));
                } else if t < tl.back_at {
                    centre_override = Some(pt.out.to);
                }
                if t >= tl.ring_at && !pt.ring_shown {
                    pt.ring_shown = true;
                    if let Some(r) = ring.as_ref() {
                        ring_visible = true;
                        let (frame, above) = ring_frame(pt.rect, pt.display);
                        set_frame(r, frame, true);
                        let shape = if pt.rect.w.max(pt.rect.h) <= CIRCLE_MAX { "circle" } else { "box" };
                        let (colour, glow) = ring_colours(g_look.as_ref());
                        send(r, "Ring", &RingMsg::Ring { w: frame.w, h: frame.h, shape, label: pt.label.clone(), seed: pt.seed, label_at: if above { "above" } else { "below" }, draw: !env.reduce, colour, glow });
                        ring_used = now;
                        ring_hide_at = None;
                    }
                }
                if t >= tl.clear_at && !pt.cleared {
                    pt.cleared = true;
                    if let Some(r) = ring.as_ref() {
                        send(r, "Ring", &RingMsg::Clear);
                        ring_hide_at = Some(now + Duration::from_millis(RING_CLEAR_MS));
                    }
                }
                if t >= tl.back_at {
                    let home = pointer.map(|p| place(p, visible_for(&env, p)).0).unwrap_or(pt.out.from);
                    if pt.back.is_none() {
                        pt.back = Some(Flight::new(pt.out.to, home, env.reduce));
                        pt.back_started = Some(now);
                    }
                    let back = pt.back.unwrap();
                    let bt = pt.back_started.unwrap().elapsed().as_millis() as u64;
                    if bt < back.ms {
                        let mut b = back;
                        b.to = home;
                        centre_override = Some(b.point_at(bt));
                    } else {
                        pointing_done = true;
                    }
                }
            }
            if pointing_done {
                g.pointing = None;
                if g.state == State::Pointing {
                    g.state = if g.speaking { State::Speaking } else { State::Idle };
                    g.dirty = true;
                }
                if let Some(e) = g.exchange.as_mut() {
                    e.last = now;
                }
                // The spring carries on from where the flight left her.
                placed = true;
            }
            let taps: Vec<(f64, f64)> = g.taps.drain(..).collect();

            // Follow the pointer, the spring stepped by the time that really passed (at most two frames' worth).
            let dt = last_tick.elapsed().as_secs_f64().clamp(0.0, 2.0 * DT);
            last_tick = Instant::now();
            let mut moving = false;
            if let (Some(f), Some(p)) = (follower.as_ref(), pointer) {
                let (target, flip) = place(p, visible_for(&env, p));
                if flip != last_flip {
                    last_flip = flip;
                    g.dirty = true;
                }
                let centre = if let Some(o) = centre_override {
                    sx = Spring { x: o.0, v: 0.0 };
                    sy = Spring { x: o.1, v: 0.0 };
                    moving = true;
                    o
                } else if !placed || env.reduce || !shown {
                    placed = true;
                    sx = Spring { x: target.0, v: 0.0 };
                    sy = Spring { x: target.1, v: 0.0 };
                    target
                } else {
                    sx.step(target.0, dt);
                    sy.step(target.1, dt);
                    moving = !(sx.settled(target.0) && sy.settled(target.1));
                    if !moving {
                        sx = Spring { x: target.0, v: 0.0 };
                        sy = Spring { x: target.1, v: 0.0 };
                    }
                    (sx.x, sy.x)
                };
                if vis.shown {
                    move_to(f, window_origin(centre, flip));
                }
            }
            moving |= last_move.elapsed() < Duration::from_millis(250);

            // Show, fade, hide.
            if let Some(f) = follower.as_ref() {
                if vis.shown && !shown {
                    shown = true;
                    fade_out_at = None;
                    let origin = window_origin((sx.x, sy.x), last_flip);
                    set_frame(f, Bounds { x: origin.0, y: origin.1, w: WIN_W, h: WIN_H }, true);
                    send(f, "Companion", &Msg::Fade { visible: true });
                } else if !vis.shown && shown {
                    shown = false;
                    send(f, "Companion", &Msg::Fade { visible: false });
                    let ms = if vis.reason == "still" { FADE_MS } else { 0 };
                    fade_out_at = Some(now + Duration::from_millis(ms));
                }
                if shown && asserted.elapsed() >= Duration::from_secs(1) {
                    asserted = now;
                    assert_level(f);
                }
                if fade_out_at.is_some_and(|t| now >= t) {
                    fade_out_at = None;
                    order_out(f);
                }
                if !look_sent {
                    if let Some(l) = g.look.clone() {
                        send(f, "Companion", &Msg::Look { colour: l.colour, face: l.face, visor: l.visor, eyes: l.eyes, name: l.name });
                        look_sent = true;
                    }
                }
                if g.dirty {
                    if let Some(l) = g.look.clone() {
                        send(f, "Companion", &Msg::Look { colour: l.colour, face: l.face, visor: l.visor, eyes: l.eyes, name: l.name });
                    }
                }
                if reduce_sent != Some(env.reduce) {
                    reduce_sent = Some(env.reduce);
                    send(f, "Companion", &Msg::Motion { reduce: env.reduce });
                }
                if badge_sent != Some(g.badge) {
                    badge_sent = Some(g.badge);
                    send(f, "Companion", &Msg::Badge { on: g.badge });
                }
                let st = (g.state, g.text.clone(), g.sub.clone(), g.hint.clone(), last_flip);
                if last_state_sent.as_ref() != Some(&st) {
                    send(f, "Companion", &Msg::State { state: st.0, text: st.1.clone(), sub: st.2.clone(), hint: st.3.clone(), flip: st.4 });
                    last_state_sent = Some(st);
                }
                if level_at.elapsed().as_secs_f64() >= 1.0 / MAX_LEVELS_PER_S {
                    let v = if g.synthetic {
                        Some(0.5 + 0.5 * (pulse0.elapsed().as_secs_f64() * 5.0 * std::f64::consts::TAU).sin())
                    } else {
                        g.level.take()
                    };
                    if let Some(v) = v {
                        send(f, "Companion", &Msg::Level { v });
                        level_at = now;
                    }
                }
            }
            g.dirty = false;

            // The ring: taps while doing, hiding after a clear or a cancel, closing when unused.
            for p in taps {
                if g.pointing.is_some() {
                    continue;
                }
                if let Some(r) = ring.as_ref() {
                    ring_visible = true;
                    set_frame(r, Bounds { x: p.0 - 24.0, y: p.1 - 24.0, w: 48.0, h: 48.0 }, true);
                    send(r, "Ring", &RingMsg::Tap);
                    ring_used = now;
                    ring_hide_at = Some(now + Duration::from_millis(300));
                }
            }
            if g.pointing.is_none() && ring_hide_at.is_none() && ring_used.elapsed() > Duration::from_millis(500) {
                if let Some(r) = ring.as_ref().filter(|_| ring_visible) {
                    ring_visible = false;
                    send(r, "Ring", &RingMsg::Clear);
                    order_out(r);
                }
            }
            if ring_hide_at.is_some_and(|t| now >= t) {
                ring_hide_at = None;
                if let Some(r) = ring.as_ref() {
                    ring_visible = false;
                    order_out(r);
                }
            }
            if ring.is_some() && g.pointing.is_none() && ring_used.elapsed() > RING_IDLE {
                if let Some(r) = ring.take() {
                    ring_visible = false;
                    let _ = r.close();
                }
            }
            let parked = rate(vis, moving) == Rate::Parked && follower.is_none() && g.pointing.is_none();
            shared.active.store(!parked, Ordering::SeqCst);
            let period = if g.pointing.is_some() { Rate::Hz60.period() } else { rate(vis, moving).period() };
            // Always a wait that a look, a task or a pointing ends at once (review, 12 October 2026: a plain sleep missed
            // those wakes, so she showed "listening" up to 2 s late).
            let _ = c.wake.wait_timeout(g, period).unwrap();
        }
    }

    /// Lowers the calling thread's priority (the environment reader).
    unsafe fn libc_nice() {
        extern "C" {
            fn setpriority(which: i32, who: u32, prio: i32) -> i32;
        }
        // PRIO_DARWIN_THREAD (3) with PRIO_DARWIN_BG (0x1000): this thread only, in the background band.
        let _ = setpriority(3, 0, 0x1000);
    }

    /// The visible frame of the display the pointer is on (the whole display when AppKit has not said).
    fn visible_for(env: &Env, p: (f64, f64)) -> Bounds {
        let d = capture::display_at(p, &env.displays);
        d.and_then(|(id, _)| env.visible.iter().find(|(v, _)| *v == id).map(|(_, b)| *b))
            .or(d.map(|(_, b)| b))
            .unwrap_or(Bounds { x: 0.0, y: 0.0, w: 1440.0, h: 900.0 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn b(x: f64, y: f64, w: f64, h: f64) -> Bounds {
        Bounds { x, y, w, h }
    }

    #[test]
    fn spring() {
        let mut s = Spring::default();
        let mut peak: f64 = 0.0;
        let mut settled_at = None;
        for n in 0..240 {
            s.step(100.0, DT);
            peak = peak.max(s.x);
            if settled_at.is_none() && s.settled(100.0) {
                settled_at = Some(n);
            }
        }
        assert!(peak <= 105.0, "overshoot {peak}");
        assert!((s.x - 100.0).abs() < 0.01);
        let at = settled_at.unwrap();
        assert!((10..60).contains(&at), "settles in about a quarter to half a second ({at} ticks)");
        // Reduced motion: no spring, she is placed (the thread snaps; nothing to integrate).
        let ((cx, cy), _) = place((500.0, 400.0), b(0.0, 0.0, 1512.0, 949.0));
        assert_eq!((cx, cy), (530.0, 430.0));
    }

    #[test]
    fn placement_and_flips() {
        let vis = b(0.0, 25.0, 1512.0, 900.0);
        let (c, f) = place((500.0, 400.0), vis);
        assert_eq!((c, f), ((530.0, 430.0), Flip::default()));
        assert_eq!(window_origin(c, f), (501.0, 401.0));
        // Near the right edge: she moves to the left of the pointer.
        let (c, f) = place((1400.0, 400.0), vis);
        assert!(f.x && !f.y);
        assert_eq!(c, (1370.0, 430.0));
        assert!(window_origin(c, f).0 + WIN_W <= vis.x + vis.w - MARGIN + 1e-9);
        // Near the bottom: above the pointer.
        let (c, f) = place((500.0, 900.0), vis);
        assert!(f.y);
        assert_eq!(c.1, 870.0);
        assert!(window_origin(c, f).1 + WIN_H <= vis.y + vis.h - MARGIN + 1e-9);
        // Top-left corner: always 8 points inside.
        let (c, f) = place((-20.0, 0.0), vis);
        let o = window_origin(c, f);
        assert!(o.0 >= MARGIN && o.1 >= vis.y + MARGIN);
        // The face constants are companion.js's.
        assert_eq!(face_point(Flip { x: true, y: true }), (291.0, 83.0));
    }

    #[test]
    fn flight() {
        let f = Flight::new((0.0, 0.0), (400.0, 0.0), false);
        assert_eq!(f.ms, 600, "short flights take 0.6 s at least");
        assert_eq!(f.ctrl, (200.0, -80.0), "lift min(0.2 d, 80)");
        assert_eq!(Flight::new((0.0, 0.0), (2000.0, 0.0), false).ms, 1400, "long flights 1.4 s at most");
        assert_eq!(Flight::new((0.0, 0.0), (1000.0, 0.0), false).ms, 1250);
        assert_eq!(Flight::new((0.0, 0.0), (100.0, 0.0), false).ctrl, (50.0, -20.0));
        assert_eq!(f.point_at(0), (0.0, 0.0));
        assert_eq!(f.point_at(600), (400.0, 0.0));
        assert_eq!(f.point_at(5000), (400.0, 0.0));
        let mid = f.point_at(300);
        assert!((mid.0 - 200.0).abs() < 1e-9 && mid.1 < 0.0, "lifted mid-flight");
        assert_eq!(Flight::ease(0.0), 0.0);
        assert_eq!(Flight::ease(1.0), 1.0);
        assert_eq!(Flight::ease(0.5), 0.5);
        let r = Flight::new((0.0, 0.0), (400.0, 0.0), true);
        assert_eq!(r.point_at(100), (0.0, 0.0), "reduced: fades where she is");
        assert_eq!(r.point_at(200), (400.0, 0.0), "then appears at the target");
    }

    #[test]
    fn landing_beside_the_target() {
        let d = b(0.0, 0.0, 1512.0, 982.0);
        let t = b(100.0, 100.0, 40.0, 20.0);
        assert_eq!(landing(t, d), (100.0 + 40.0 + 6.0 + 8.0 + 13.0, 100.0 + 20.0 + 6.0 + 8.0 + 13.0));
        // At the right edge: on the left.
        let t = b(1480.0, 100.0, 30.0, 20.0);
        assert_eq!(landing(t, d).0, 1480.0 - 6.0 - 8.0 - 13.0);
        // At the bottom: clamped 20 points inside.
        let t = b(100.0, 970.0, 30.0, 10.0);
        assert_eq!(landing(t, d).1, 962.0);
        let (frame, above) = ring_frame(b(100.0, 100.0, 40.0, 20.0), d);
        assert!(!above);
        assert_eq!(frame, b(78.0, 78.0, 84.0, 64.0 + LABEL_ROOM));
        let (_, above) = ring_frame(b(100.0, 950.0, 40.0, 20.0), d);
        assert!(above, "the label goes above at the bottom");
    }

    #[test]
    fn pointing_timeline() {
        let t = timeline(1000);
        assert_eq!(t, Timeline { ring_at: 800, landed_at: 1000, clear_at: 800 + 250 + 2500, back_at: 800 + 250 + 2500 + 300 });
        assert_eq!((RING_DRAW_MS, RING_CLEAR_MS), (250, 300), "the clean ring's one quick stroke (owner request, 12 October 2026)");
    }

    fn base() -> Inputs {
        Inputs { setting_on: true, moved_since_typing: true, screen_help_on: true, signed_in: true, ..Default::default() }
    }

    #[test]
    fn visibility_truth_table() {
        let v = |f: &dyn Fn(&mut Inputs)| {
            let mut i = base();
            f(&mut i);
            visibility(&i)
        };
        assert_eq!(v(&|_| {}), Vis { shown: true, reason: "idle" });
        assert_eq!(v(&|i| i.setting_on = false), Vis { shown: false, reason: "setting_off" });
        assert_eq!(v(&|i| { i.setting_on = false; i.exchange = true }).shown, true, "a look shows her with the setting off");
        assert_eq!(v(&|i| i.key_age_ms = Some(100)).reason, "typing");
        assert_eq!(v(&|i| i.moved_since_typing = false).reason, "typing");
        assert_eq!(v(&|i| { i.key_age_ms = Some(100); i.exchange = true }).shown, true, "typing hides her only while idle");
        assert_eq!(v(&|i| i.front_fullscreen = true).reason, "full_screen");
        assert_eq!(v(&|i| { i.front_fullscreen = true; i.act_live = true }).shown, true);
        assert_eq!(v(&|i| i.still_ms = 3_000).reason, "still");
        assert_eq!(v(&|i| i.still_ms = 2_999).shown, true);
        let cases: [(&dyn Fn(&mut Inputs), &str); 3] = [(&|i| i.call_live = true, "call"), (&|i| i.sharing = true, "sharing"), (&|i| i.locked = true, "locked")];
        for (f, reason) in cases {
            let r = v(&|i: &mut Inputs| {
                f(i);
                i.act_live = true;
                i.exchange = true;
            });
            assert_eq!(r, Vis { shown: false, reason }, "a call, a share or a lock hides her even while she works");
        }
        assert_eq!(v(&|i| i.screenshot_tool = true).reason, "screenshot_tool");
        assert_eq!(v(&|i| { i.screenshot_tool = true; i.act_live = true }).shown, true);
        assert_eq!(v(&|i| i.mirrored_or_captured = true).reason, "mirrored");
        assert_eq!(v(&|i| { i.screen_help_on = false; i.act_live = true }).reason, "screen_help_off");
        assert_eq!(v(&|i| i.signed_in = false).reason, "signed_out");
        assert_eq!(v(&|i| { i.setting_on = false; i.act_live = true }).shown, true, "asking and doing show her whatever the setting");
        assert_eq!(v(&|i| i.button_held = true).reason, "pressing", "a held button (a menu, a drag) hides her while idle");
        assert_eq!(v(&|i| { i.button_held = true; i.act_live = true }).shown, true, "her own clicks while doing");
        assert!(LEVEL < 101, "below pop-up and context menus");
    }

    #[test]
    fn rates() {
        assert_eq!(rate(Vis { shown: true, reason: "idle" }, true), Rate::Hz60);
        assert_eq!(rate(Vis { shown: true, reason: "idle" }, false), Rate::Hz15);
        assert_eq!(rate(Vis { shown: false, reason: "still" }, false), Rate::Hz15, "back within 70 ms (review, 12 October 2026)");
        assert_eq!(rate(Vis { shown: false, reason: "typing" }, false), Rate::Hz15);
        assert_eq!(rate(Vis { shown: false, reason: "pressing" }, false), Rate::Hz15);
        assert_eq!(rate(Vis { shown: false, reason: "full_screen" }, false), Rate::Hz4);
        assert_eq!(rate(Vis { shown: false, reason: "setting_off" }, false), Rate::Parked);
        assert_eq!(rate(Vis { shown: false, reason: "screen_help_off" }, false), Rate::Parked);
    }

    #[test]
    fn bridge_json() {
        let s = bridge_script("Companion", &Msg::State { state: State::Asking, text: "I'll rename \u{2028}\"these\"</script>".into(), sub: String::new(), hint: String::new(), flip: Flip { x: true, y: false } });
        assert!(s.starts_with("window.Companion&&Companion.apply({"));
        assert!(s.contains("\\u2028") && !s.contains('\u{2028}'));
        assert!(s.contains("\\\"these\\\""));
        let json = &s["window.Companion&&Companion.apply(".len()..s.len() - 1];
        let v: Value = serde_json::from_str(json).unwrap();
        assert_eq!(v["t"], "state");
        assert_eq!(v["state"], "asking");
        assert_eq!(v["flip"], json!({ "x": true, "y": false }));
        let v = serde_json::to_value(RingMsg::Ring { w: 84.0, h: 104.0, shape: "circle", label: "Export".into(), seed: 7, label_at: "below", draw: true, colour: None, glow: None }).unwrap();
        assert_eq!(v, json!({ "t": "ring", "w": 84.0, "h": 104.0, "shape": "circle", "label": "Export", "seed": 7, "labelAt": "below", "draw": true }), "today's message, which the page draws in orange");
        assert_eq!(serde_json::to_value(RingMsg::Tap).unwrap(), json!({ "t": "tap" }));
        assert_eq!(serde_json::to_value(Msg::Flight { ms: 600, dx: 1.0, dy: -2.0 }).unwrap(), json!({ "t": "flight", "ms": 600, "dx": 1.0, "dy": -2.0 }));
        assert_eq!(serde_json::to_value(Msg::Motion { reduce: true }).unwrap(), json!({ "t": "motion", "reduce": true }));
        assert!(bridge_script("Ring", &RingMsg::Clear).starts_with("window.Ring&&Ring.apply("));
    }

    /// Companion2-spec E: the ring message carries her coat colour and glow once she is known.
    #[test]
    fn ring_message_has_colour() {
        let max = AssistantLook::of(&LookIn { colour: Some("violet".into()), face: Some(json!({ "hi": "#ffeeff", "mid": "#CC99FF", "edge": "#7744aa" })), ..Default::default() });
        let (colour, glow) = ring_colours(Some(&max));
        assert_eq!((colour.as_deref(), glow.as_deref()), (Some("#cc99ff"), Some("#7744aa")));
        let v = serde_json::to_value(RingMsg::Ring { w: 84.0, h: 104.0, shape: "box", label: "Export".into(), seed: 0, label_at: "above", draw: false, colour, glow }).unwrap();
        assert_eq!(v["colour"], "#cc99ff");
        assert_eq!(v["glow"], "#7744aa");
        assert_eq!(v["draw"], false, "reduced motion: drawn at once");
        assert_eq!(ring_colours(None), (None, None), "not known yet: the page's orange");
        let b = AssistantLook::brenda();
        assert_eq!(ring_colours(Some(&b)).0.as_deref(), Some("#ececf0"));
    }

    /// Companion2-spec F: shown whenever screen help (consent 2 or 3) and the setting are on and the pointer moves; the
    /// follower is kept; the lasting reasons are named.
    #[test]
    fn shown_with_screen_help_on_consent_3() {
        for consent in [2, 3] {
            let on = screen_help_of(true, consent);
            assert!(on, "consent {consent} counts");
            let mut i = base();
            i.screen_help_on = on;
            i.still_ms = 0;
            assert_eq!(visibility(&i), Vis { shown: true, reason: "idle" }, "consent {consent}");
            assert!(keep_follower(true, on, true, false, false, false));
        }
        assert!(!screen_help_of(true, 1), "a phase 1 opt-in sees the update first");
        assert!(!screen_help_of(false, 3));
        assert!(!keep_follower(true, false, true, true, true, true), "screen help off: no follower");
        assert!(!keep_follower(true, true, false, false, false, false), "the setting off and nothing going on");
        assert!(keep_follower(true, true, false, false, true, false), "a look shows her with the setting off");
    }

    #[test]
    fn status_words() {
        for r in ["idle", "exchange", "act", "typing", "still", "pressing"] {
            assert!(shown_for(r), "{r} is only for a moment");
        }
        for r in ["setting_off", "screen_help_off", "signed_out", "locked", "call", "sharing", "screenshot_tool", "mirrored", "full_screen"] {
            assert!(!shown_for(r), "{r} lasts");
            assert_eq!(CompanionStatus::of(true, Vis { shown: false, reason: r }), CompanionStatus { on: true, shown: false, why: r });
        }
        assert_eq!(serde_json::to_value(CompanionStatus { on: true, shown: true, why: "idle" }).unwrap(), json!({ "on": true, "shown": true, "why": "idle" }));
    }

    #[test]
    fn looks_are_validated_like_the_page() {
        let l = AssistantLook::of(&LookIn {
            colour: Some("violet".into()),
            face: Some(json!({ "hi": "#ffeeff", "mid": "#cc99ff", "edge": "#7744aa" })),
            visor: Some("band".into()),
            eyes: Some("round".into()),
            name: Some("  Max   the   Great  ".into()),
        });
        assert_eq!(l.colour, "violet");
        assert_eq!(l.face.mid, "#cc99ff");
        assert_eq!((l.visor.as_str(), l.eyes.as_str(), l.name.as_str()), ("band", "round", "Max the Great"));
        let bad = AssistantLook::of(&LookIn {
            colour: Some("red; background:url(x)".into()),
            face: Some(json!({ "hi": "red", "mid": "#cc99ff", "edge": "#7744aa" })),
            visor: Some("helmet".into()),
            eyes: Some("<b>".into()),
            name: Some("x".repeat(40)),
        });
        assert_eq!(bad.colour, "white");
        assert_eq!(bad.face, AssistantLook::brenda().face, "one bad shade: Brenda's three");
        assert_eq!((bad.visor.as_str(), bad.eyes.as_str()), ("bean", "pill"));
        assert_eq!(bad.name.chars().count(), 24);
        assert_eq!(AssistantLook::of(&LookIn::default()), AssistantLook::brenda());
        assert_eq!(clip("a\u{0007}b\nc", 2), "ab");
    }
}
