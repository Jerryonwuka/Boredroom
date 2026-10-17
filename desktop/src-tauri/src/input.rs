//! Brenda's hands: the mouse and keyboard events of a screen task (owner rule, 12 October 2026: "Brenda cannot take any
//! action except I explicitly give an instruction … Brenda should confirm, do you want me to do this? And then I'll say,
//! yes"). This reverses phase 1's "Brenda points, she never clicks or types" (11 October 2026) by the owner's request of
//! 12 October 2026, and only under that rule (companion-spec section 0, B.7).
//!
//! What this file promises, and how:
//! - Events are posted ONLY by `execute`, ONLY for actions the server returned for the current step of a task the
//!   person asked for and said yes to (`act.rs` builds `ApprovedAction`s from that response and nothing else). The
//!   macOS poster (`CgPoster`) is private to this file and is reached only through `run_on_mac`, which calls
//!   `execute`; the poster is called in exactly two places, both inside the executor (posting, and letting go of a
//!   button or key she holds), and nowhere else in the crate (a test greps the sources).
//! - The stop flag is checked before every single event, and between typing chunks of at most 20 characters. After it
//!   is set nothing new is posted; the only events that still go are the releases of a mouse button or key Brenda
//!   herself is holding down at that moment, so nothing is left stuck down.
//! - Before every action, in order: the stop flag; a short settle after anything that can move the keyboard (a click, a
//!   key, typing); interference (the person moved the pointer, typed, or another app came to the front: she pauses and
//!   asks); where (never Brenda's own windows, never `FIXED_NO_ACT` or the never-look lists; fails closed when the front
//!   app is unknown); never opening an installer, a disk image, a script, a link file, an app from outside the
//!   Applications folders or one from the internet never opened before (by double-click or ⌘O in Finder;
//!   `guard::never_open`), nor an app on the never-look or never-act lists (from the Dock too); ordinary apps, documents
//!   and folders do open (owner request, 12 October 2026: "open an app on my desktop", reversing the review's blanket
//!   "never opens apps");
//!   payment pages in browsers (fails closed likewise); outward steps (a click on Send, Delete, Pay…; Return or Space on
//!   a focused button; Return in a text field; Backspace on a selected item; a drop into the Trash or another app; ⌘Q…)
//!   only with this turn's own recorded yes to a step of that kind, and only one; what the classifier cannot read asks
//!   too; and the secure-input check before any typing (never into a password field).
//! - Before every key, every piece of typing and every press of a button, the front app AND the process that owns the
//!   keyboard are checked again (review, 12 October 2026: Spotlight, a launcher or Terminal can take the keyboard in the
//!   middle of an action), and the action stops there if either is somewhere she never works.
//! - Every event comes from a private event source, carries its flags explicitly (never a FlagsChanged event, so the
//!   person's modifiers and Brenda's never mix) and is tagged `EVENT_TAG` ("BRND").
//!
//! - Brenda's own window in FRONT is not a refusal but a pause (owner brief, 12 October 2026: "Open Figma" failed
//!   because every click was refused as her own window; helpers-spec L.1): `check_where` and `check_keyboard` answer it
//!   with `Fail::Pause(Why::OwnFront)`, the executor returns `Flow::Paused`, and the person's Carry on resumes once the
//!   front is handed back. A point ON her island is still refused (`NOT_EXECUTED_OWN`).
//! - The front desk's "type this into the box I'm in" (helpers-spec C) uses `type_into_focus` only when inserting the
//!   text through Accessibility changed nothing: Unicode characters in chunks of at most 20, the stop flag before each,
//!   never Return, Enter or Tab (line breaks and tabs became spaces before it is called).
//!
//! Tests use `RecordingPoster` and a mocked `Env`; no test ever posts a real event (companion-spec hard rules).

use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};

use crate::guard::{self, AxBrief};
use crate::look::{wipe, Bounds};

/// `kCGEventSourceUserData` on every event Brenda posts: "BRND".
pub const EVENT_TAG: i64 = 0x4252_4E44;

/// At most this many UTF-16 units per typing event (apps read no more from one event).
pub const TYPE_CHUNK_UNITS: usize = 20;
pub const TYPE_MAX_PER_ACTION: usize = 2_000;
pub const TYPE_MAX_PER_TASK: usize = 20_000;
pub const SCROLL_MAX: u32 = 20;
pub const WAIT_MAX_MS: u64 = 10_000;
pub const REPEAT_MAX: u32 = 100;
/// The pointer may be this far outside the screenshot (in its pixels) and still count as on it (Clicky #128).
pub const OFF_SCREEN_SLACK: f64 = 8.0;
/// The pointer moving more than this (points) since Brenda's last move means the person moved it.
pub const MOVED_POINTS: f64 = 4.0;
/// A key-down later than Brenda's last event by more than this (ms) is the person typing.
pub const TYPED_GRACE_MS: u64 = 50;

pub const NOT_EXECUTED_EARLIER: &str = "Not executed: an earlier computer action in this turn failed.";
pub const NOT_EXECUTED_OFF_SCREEN: &str = "Not executed: that point is off the screen.";
pub const NOT_EXECUTED_SECURE: &str = "Not executed: a password field has the keyboard, and I never type into those.";
pub const NOT_EXECUTED_OWN: &str = "Not executed: that's Brenda's own window.";
pub const NOT_EXECUTED_PAYMENT: &str = "Not executed: this looks like a banking or payment page, and I never work on those.";
pub const NOT_EXECUTED_FRONT_UNKNOWN: &str = "Not executed: I couldn't tell which app is in front, so I didn't do that.";
pub const NOT_EXECUTED_UNKNOWN: &str = "Not executed: I can't tell what this does. Call ask_before first, naming exactly this step.";
pub const NOT_EXECUTED_RUNS: &str = "Not executed: that's an installer, a script or a link file, and I never open those. Call cannot_continue.";
pub const NOT_EXECUTED_NEW_APP: &str = "Not executed: that app came from the internet and hasn't been opened before, so I don't open it. Call cannot_continue.";
pub const NOT_EXECUTED_OUTSIDE_APP: &str = "Not executed: I only open apps from your Applications folders. Call cannot_continue.";
/// After a click, a key or typing, she waits this long for the front app and the keyboard to settle before the next
/// action (review, 12 October 2026).
pub const SETTLE_MS: u64 = 150;

/// When Brenda last posted an event (unix ms; 0 = never). Real presses within 1.5 s of one are not trusted (B.6.3).
static LAST_POST_UNIX_MS: AtomicU64 = AtomicU64::new(0);

fn unix_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Seconds since Brenda last posted an event, or None if she never has.
pub fn seconds_since_post() -> Option<f64> {
    let at = LAST_POST_UNIX_MS.load(Ordering::SeqCst);
    (at > 0).then(|| unix_ms().saturating_sub(at) as f64 / 1000.0)
}

// ---- events ----------------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Button {
    Left,
    Right,
    Middle,
}

/// One synthesised event, in global top-left points.
#[derive(Clone, Debug, PartialEq)]
pub enum Synth {
    Move { x: f64, y: f64, flags: u64 },
    Down { button: Button, x: f64, y: f64, clicks: i64, flags: u64 },
    Up { button: Button, x: f64, y: f64, clicks: i64, flags: u64 },
    Drag { x: f64, y: f64, flags: u64 },
    /// One line: `dy` +1 up / −1 down (wheel 1), `dx` +1 left / −1 right (wheel 2).
    Scroll { dy: i32, dx: i32, flags: u64 },
    Key { code: u16, down: bool, flags: u64 },
    /// Typed characters (keycode 0 with a Unicode string, down then up).
    Text { units: Vec<u16> },
}

impl Synth {
    /// The release of something Brenda holds down: the one kind of event still posted after Stop.
    pub fn is_release(&self) -> bool {
        matches!(self, Synth::Up { .. } | Synth::Key { down: false, .. })
    }
}

/// Posts events. `CgPoster` on a Mac; `RecordingPoster` in tests.
pub(crate) trait EventPoster {
    fn post(&mut self, e: &Synth) -> Result<(), String>;
}

// ---- keys ------------------------------------------------------------------------------------------------------------

pub use guard::{MOD_COMMAND, MOD_CONTROL, MOD_OPTION, MOD_SHIFT};

/// US ANSI virtual key codes (`kVK_*`), by the names the computer tool uses (xdotool's) and their characters.
const KEYS: &[(&str, u16)] = &[
    ("a", 0), ("s", 1), ("d", 2), ("f", 3), ("h", 4), ("g", 5), ("z", 6), ("x", 7), ("c", 8), ("v", 9), ("b", 11), ("q", 12), ("w", 13), ("e", 14),
    ("r", 15), ("y", 16), ("t", 17), ("1", 18), ("2", 19), ("3", 20), ("4", 21), ("6", 22), ("5", 23), ("=", 24), ("equal", 24), ("9", 25), ("7", 26),
    ("-", 27), ("minus", 27), ("8", 28), ("0", 29), ("]", 30), ("bracketright", 30), ("o", 31), ("u", 32), ("[", 33), ("bracketleft", 33), ("i", 34),
    ("p", 35), ("return", 36), ("enter", 36), ("l", 37), ("j", 38), ("'", 39), ("apostrophe", 39), ("k", 40), (";", 41), ("semicolon", 41), ("\\", 42),
    ("backslash", 42), (",", 43), ("comma", 43), ("/", 44), ("slash", 44), ("n", 45), ("m", 46), (".", 47), ("period", 47), ("tab", 48), ("space", 49),
    (" ", 49), ("`", 50), ("grave", 50), ("backspace", 51), ("escape", 53), ("esc", 53), ("kp_enter", 76), ("f5", 96), ("f6", 97), ("f7", 98),
    ("f3", 99), ("f8", 100), ("f9", 101), ("f11", 103), ("f10", 109), ("f12", 111), ("home", 115), ("page_up", 116), ("pageup", 116), ("prior", 116),
    ("delete", 117), ("f4", 118), ("end", 119), ("f2", 120), ("page_down", 121), ("pagedown", 121), ("next", 121), ("f1", 122), ("left", 123),
    ("right", 124), ("down", 125), ("up", 126),
];

/// Keys whose press types a character (secure input refuses them; arrows, Return, Tab and F-keys type nothing).
fn types_a_character(code: u16) -> bool {
    !matches!(code, 36 | 48 | 51 | 53 | 76 | 96..=103 | 109 | 111 | 115..=126)
}

/// One key with its modifiers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Combo {
    pub code: u16,
    pub flags: u64,
}

impl Combo {
    pub fn types_character(&self) -> bool {
        types_a_character(self.code) && self.flags & (MOD_COMMAND | MOD_CONTROL) == 0
    }
}

fn modifier(name: &str) -> Option<u64> {
    match name {
        "shift" => Some(MOD_SHIFT),
        "ctrl" | "control" => Some(MOD_CONTROL),
        "alt" | "option" | "opt" => Some(MOD_OPTION),
        "cmd" | "command" | "super" | "meta" | "win" => Some(MOD_COMMAND),
        _ => None,
    }
}

/// The modifiers in a click's or scroll's `text` ("shift", "cmd+shift"…).
pub fn parse_modifiers(text: &str) -> Result<u64, String> {
    let mut flags = 0;
    for part in text.split('+').map(|p| p.trim().to_lowercase()).filter(|p| !p.is_empty()) {
        flags |= modifier(&part).ok_or_else(|| format!("Not executed: \"{part}\" isn't a modifier key."))?;
    }
    Ok(flags)
}

/// One combo ("cmd+shift+s", "Return", "Page_Down", "A" = shift+a).
pub fn parse_combo(text: &str) -> Result<Combo, String> {
    let parts: Vec<&str> = text.split('+').map(str::trim).collect();
    if parts.iter().any(|p| p.is_empty()) && text.trim() != "+" {
        return Err(format!("Not executed: I can't read the key \"{text}\"."));
    }
    let (last, mods) = parts.split_last().ok_or_else(|| "Not executed: no key given.".to_string())?;
    let mut flags = 0;
    for m in mods {
        flags |= modifier(&m.to_lowercase()).ok_or_else(|| format!("Not executed: \"{m}\" isn't a modifier key."))?;
    }
    let mut name = last.to_string();
    if name.chars().count() == 1 && name.chars().next().is_some_and(|c| c.is_ascii_uppercase()) {
        flags |= MOD_SHIFT;
        name = name.to_lowercase();
    }
    let lower = name.to_lowercase();
    if modifier(&lower).is_some() {
        return Err(format!("Not executed: \"{name}\" is a modifier on its own; give a key."));
    }
    let code = KEYS.iter().find(|(n, _)| *n == lower).map(|(_, c)| *c).ok_or_else(|| format!("Not executed: I don't know the key \"{name}\"."))?;
    Ok(Combo { code, flags })
}

/// A `key` action's text: one or more combos separated by spaces ("ctrl+a ctrl+c"); ≤ 64 characters.
pub fn parse_keys(text: &str) -> Result<Vec<Combo>, String> {
    if text.chars().count() > 64 {
        return Err("Not executed: that key text is too long.".into());
    }
    let t = text.trim();
    if t == "space" || t == " " {
        return Ok(vec![Combo { code: 49, flags: 0 }]);
    }
    let combos: Result<Vec<Combo>, String> = t.split_whitespace().map(parse_combo).collect();
    let combos = combos?;
    if combos.is_empty() {
        return Err("Not executed: no key given.".into());
    }
    Ok(combos)
}

// ---- typing ----------------------------------------------------------------------------------------------------------

/// A piece of typing: a run of characters (≤ 20 UTF-16 units, never splitting a character, an emoji or a letter from its
/// accents) or a Return.
#[derive(Clone, Debug, PartialEq)]
pub enum TypePiece {
    Units(Vec<u16>),
    Return,
}

pub fn type_pieces(text: &str) -> Vec<TypePiece> {
    use unicode_segmentation::UnicodeSegmentation;
    let mut out = Vec::new();
    let mut cur: Vec<u16> = Vec::new();
    for g in text.graphemes(true) {
        if g == "\n" || g == "\r\n" || g == "\r" {
            if !cur.is_empty() {
                out.push(TypePiece::Units(std::mem::take(&mut cur)));
            }
            out.push(TypePiece::Return);
            continue;
        }
        let units: Vec<u16> = g.encode_utf16().collect();
        if !cur.is_empty() && cur.len() + units.len() > TYPE_CHUNK_UNITS {
            out.push(TypePiece::Units(std::mem::take(&mut cur)));
        }
        cur.extend(units);
    }
    if !cur.is_empty() {
        out.push(TypePiece::Units(cur));
    }
    out
}

// ---- geometry --------------------------------------------------------------------------------------------------------

/// The task's screenshot: the display it shows (global top-left points) and its size in pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ShotGeom {
    pub display: Bounds,
    pub w: u32,
    pub h: u32,
}

/// Screenshot pixels to global points: up to 8 pixels outside counts as the edge, further is off the screen.
pub fn shot_to_global(g: &ShotGeom, x: f64, y: f64) -> Option<(f64, f64)> {
    let (w, h) = (g.w as f64, g.h as f64);
    if !x.is_finite() || !y.is_finite() || w <= 0.0 || h <= 0.0 {
        return None;
    }
    if x < -OFF_SCREEN_SLACK || y < -OFF_SCREEN_SLACK || x > w + OFF_SCREEN_SLACK || y > h + OFF_SCREEN_SLACK {
        return None;
    }
    let x = x.clamp(0.0, w - 1.0);
    let y = y.clamp(0.0, h - 1.0);
    Some((g.display.x + x * g.display.w / w, g.display.y + y * g.display.h / h))
}

/// Global points to screenshot pixels (for `cursor_position`), clamped inside.
pub fn global_to_shot(g: &ShotGeom, gx: f64, gy: f64) -> (i64, i64) {
    let x = ((gx - g.display.x) * g.w as f64 / g.display.w).round();
    let y = ((gy - g.display.y) * g.h as f64 / g.display.h).round();
    (x.clamp(0.0, g.w.saturating_sub(1) as f64) as i64, y.clamp(0.0, g.h.saturating_sub(1) as f64) as i64)
}

// ---- the world the executor sees -------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct AppInfo {
    pub pid: i32,
    pub name: String,
    pub bundle_id: Option<String>,
}

/// A picture for the model (wiped when dropped).
pub struct Image {
    pub jpeg: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

impl Drop for Image {
    fn drop(&mut self) {
        wipe(&mut self.jpeg);
    }
}

impl std::fmt::Debug for Image {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Image({}x{}, {} bytes)", self.width, self.height, self.jpeg.len())
    }
}

/// What the executor needs from the Mac, so the tests can stand in for it.
pub trait Env {
    /// The task's stop flag.
    fn stopped(&self) -> bool;
    /// Sleeps up to `ms`, waking early on Stop; false when stopped.
    fn sleep(&mut self, ms: u64) -> bool;
    fn now_ms(&self) -> u64;
    fn pointer(&self) -> Option<(f64, f64)>;
    /// How long ago (ms) a key last went down on the keyboard, when the system says.
    fn key_down_age_ms(&self) -> Option<u64>;
    fn front(&self) -> Option<AppInfo>;
    /// The owner of the topmost window at a global point.
    fn owner_at(&self, p: (f64, f64)) -> Option<AppInfo>;
    /// The app's name when Brenda never works in it (`guard::no_act` with the never-look rules).
    fn forbidden(&self, app: &AppInfo) -> Option<String>;
    fn is_own(&self, app: &AppInfo) -> bool;
    /// The element under a point and up to two parents (role, title, description; never values).
    fn elements_at(&self, p: (f64, f64)) -> Option<Vec<AxBrief>>;
    /// The element with the keyboard: role, title, description, inside a web page, its process.
    fn focused(&self) -> Option<guard::Focus>;
    /// The app that owns the keyboard (the focused element's process), which can differ from the front app (Spotlight,
    /// a launcher, a password manager's panel).
    fn app_of(&self, pid: i32) -> Option<AppInfo>;
    /// The file under a point, when Accessibility names one.
    fn file_at(&self, p: (f64, f64)) -> Option<std::path::PathBuf>;
    /// What is selected in Finder (⌘O, ⌘↓ open it).
    fn finder_selection(&self) -> Vec<std::path::PathBuf>;
    /// The front browser window's page address.
    fn page_url(&self) -> Option<String>;
    fn secure_input(&self) -> bool;
    fn screenshot(&mut self) -> Result<Image, String>;
    /// A region of the screenshot (its pixels) at native resolution, fitted to the screenshot's size.
    fn zoom(&mut self, region: [f64; 4]) -> Result<Image, String>;
    /// The companion's ripple before a click (B.4.2 `tap`).
    fn tap(&mut self, _p: (f64, f64)) {}
    /// The home folder (its own Applications folder counts as one), for `guard::never_open`.
    fn home(&self) -> Option<std::path::PathBuf> {
        None
    }
    /// An app's `com.apple.quarantine` attribute.
    fn quarantine(&self, _p: &std::path::Path) -> Option<String> {
        None
    }
    /// A regular file with an execute bit.
    fn exec_file(&self, _p: &std::path::Path) -> bool {
        false
    }
    /// An app bundle's identifier (for the never-act lists).
    fn bundle_id_of(&self, _p: &std::path::Path) -> Option<String> {
        None
    }
    /// The app that opens a file by default (review, 12 October 2026).
    fn handler_of(&self, _p: &std::path::Path) -> Option<AppInfo> {
        None
    }
}

/// The executor's Mac as `guard::never_open` reads it.
struct EnvProbe<'a>(&'a dyn Env);

impl guard::OpenProbe for EnvProbe<'_> {
    fn home(&self) -> Option<std::path::PathBuf> {
        self.0.home()
    }
    fn quarantine(&self, p: &std::path::Path) -> Option<String> {
        self.0.quarantine(p)
    }
    fn exec_file(&self, p: &std::path::Path) -> bool {
        self.0.exec_file(p)
    }
    fn handler(&self, p: &std::path::Path) -> Option<crate::look::AppId> {
        self.0.handler_of(p).map(|a| crate::look::AppId { bundle_id: a.bundle_id, names: vec![a.name] })
    }
}

/// Opening `path` (a double-click, ⌘O): refused for what `guard::never_open` refuses, and for an app on the never-look
/// or never-act lists (owner request, 12 October 2026).
fn open_refusal(env: &dyn Env, path: &std::path::Path) -> Option<String> {
    match guard::never_open(path, &EnvProbe(env)) {
        Some(guard::NeverOpen::Runs) => return Some(NOT_EXECUTED_RUNS.into()),
        Some(guard::NeverOpen::NewApp) => return Some(NOT_EXECUTED_NEW_APP.into()),
        Some(guard::NeverOpen::OutsideApp) => return Some(NOT_EXECUTED_OUTSIDE_APP.into()),
        None => {}
    }
    if path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("app")) {
        let name = path.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let item = AppInfo { pid: -1, name: name.clone(), bundle_id: env.bundle_id_of(path) };
        if let Some(n) = env.forbidden(&item) {
            return Some(format!("Not executed: I never work in {n}. Call cannot_continue."));
        }
        return None;
    }
    // A document: the app that opens it must be one Brenda works in (review, 12 October 2026: a certificate opens
    // Keychain Access, a workflow Alfred, a disk image DiskImageMounter). A file no app opens opens nothing.
    if let Some(h) = env.handler_of(path) {
        let refused = env.forbidden(&h).or_else(|| guard::handler_refused(&crate::look::AppId { bundle_id: h.bundle_id.clone(), names: vec![h.name.clone()] }, &[]));
        if let Some(n) = refused {
            return Some(format!("Not executed: that opens in {n}, and I never work there. Call cannot_continue."));
        }
    }
    None
}

/// An action the server returned for the current step of the current task (B.7.2). Built only by `act.rs` from that
/// response.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct ApprovedAction {
    pub id: String,
    #[serde(rename = "name")]
    pub member: String,
    #[serde(default)]
    pub input: Value,
}

/// One action's result, as the step request sends it (D.7.3).
#[derive(Debug)]
pub struct StepResult {
    pub id: String,
    pub name: String,
    pub outcome: Result<Out, String>,
}

#[derive(Debug)]
pub enum Out {
    Text(String),
    Image(Image),
}

impl Serialize for StepResult {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(None)?;
        m.serialize_entry("id", &self.id)?;
        m.serialize_entry("name", &self.name)?;
        match &self.outcome {
            Ok(Out::Text(t)) => {
                m.serialize_entry("ok", &true)?;
                m.serialize_entry("text", t)?;
            }
            Ok(Out::Image(img)) => {
                m.serialize_entry("ok", &true)?;
                m.serialize_entry("image", &ImageJson(img))?;
            }
            Err(e) => {
                m.serialize_entry("ok", &false)?;
                m.serialize_entry("error", e)?;
            }
        }
        m.end()
    }
}

/// `{mediaType, data, width, height}`, the base64 written and then wiped.
pub struct ImageJson<'a>(pub &'a Image);

impl Serialize for ImageJson<'_> {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use base64::Engine;
        use serde::ser::SerializeMap;
        let mut data = base64::engine::general_purpose::STANDARD.encode(&self.0.jpeg);
        let mut m = s.serialize_map(Some(4))?;
        m.serialize_entry("mediaType", "image/jpeg")?;
        let r = m.serialize_entry("data", &data);
        // SAFETY: zero bytes are valid UTF-8.
        unsafe { data.as_bytes_mut().fill(0) };
        r?;
        m.serialize_entry("width", &self.0.width)?;
        m.serialize_entry("height", &self.0.height)?;
        m.end()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Why {
    Moved,
    Typed,
    Focus,
    /// Brenda's own window is in front and the front couldn't be handed back (L.1).
    #[serde(rename = "own_front")]
    OwnFront,
    /// The Mac operator pauses (owner brief, 12 October 2026: "Mac jobs pause when the Mac sleeps and resume"; G.6):
    /// the screen locked, the Mac slept, a Boredroom call started, or the screen may be shared.
    Locked,
    Sleep,
    Call,
    Share,
}

/// How a run of actions ended.
#[derive(Debug, PartialEq, Eq)]
pub enum Flow {
    /// Every action has a result.
    Done,
    /// Interference: paused before action `at` (resume from there after the person's Carry on).
    Paused { why: Why, at: usize },
    /// The stop flag was set before or during action `at`.
    Stopped { at: usize },
}

/// What the executor remembers across actions and turns of one task.
#[derive(Clone, Debug)]
pub struct ExecState {
    pub geom: ShotGeom,
    /// When the person said yes (or pressed Carry on): key-downs before this are not interference.
    pub since_ms: u64,
    /// Where the pointer was at the yes (or Carry on).
    pub baseline_pointer: Option<(f64, f64)>,
    pub last_post_ms: Option<u64>,
    pub last_post_point: Option<(f64, f64)>,
    pub last_front_pid: Option<i32>,
    /// The previous action was a click or a key, which may bring another app forward.
    pub focus_may_change: bool,
    pub typed_total: usize,
    /// Something was posted since the last screenshot (a screenshot then waits 300 ms for the screen to settle).
    pub posted_since_shot: bool,
    /// Where `left_mouse_down` pressed, and the app under it (a drag's source).
    pub pressed: Option<((f64, f64), Option<i32>)>,
}

impl ExecState {
    pub fn new(geom: ShotGeom, now_ms: u64, pointer: Option<(f64, f64)>, front_pid: Option<i32>) -> Self {
        ExecState {
            geom,
            since_ms: now_ms,
            baseline_pointer: pointer,
            last_post_ms: None,
            last_post_point: None,
            last_front_pid: front_pid,
            focus_may_change: false,
            typed_total: 0,
            posted_since_shot: false,
            pressed: None,
        }
    }

    /// Carry on after a pause: where the pointer is now becomes the baseline.
    pub fn resume(&mut self, now_ms: u64, pointer: Option<(f64, f64)>, front_pid: Option<i32>) {
        self.since_ms = now_ms;
        self.baseline_pointer = pointer;
        self.last_post_point = None;
        self.last_post_ms = None;
        self.last_front_pid = front_pid;
        self.focus_may_change = false;
    }
}

/// Pure interference check (B.7.6).
pub fn interference(st: &ExecState, now_ms: u64, pointer: Option<(f64, f64)>, key_age_ms: Option<u64>, front_pid: Option<i32>) -> Option<Why> {
    let reference = st.last_post_point.or(st.baseline_pointer);
    if let (Some(p), Some(r)) = (pointer, reference) {
        if ((p.0 - r.0).powi(2) + (p.1 - r.1).powi(2)).sqrt() > MOVED_POINTS {
            return Some(Why::Moved);
        }
    }
    if let Some(age) = key_age_ms {
        let key_at = now_ms.saturating_sub(age);
        let after = st.last_post_ms.unwrap_or(0).max(st.since_ms);
        if age < 1_000_000 && key_at > after + TYPED_GRACE_MS {
            return Some(Why::Typed);
        }
    }
    if let (Some(now), Some(before)) = (front_pid, st.last_front_pid) {
        if now != before && !st.focus_may_change {
            return Some(Why::Focus);
        }
    }
    None
}

// ---- the executor ----------------------------------------------------------------------------------------------------

enum Fail {
    Stop,
    Msg(String),
    /// Not a refusal: the action waits for the person (L.1, Brenda's own window in front).
    Pause(Why),
}

impl From<String> for Fail {
    fn from(s: String) -> Self {
        Fail::Msg(s)
    }
}

struct Ctx<'a> {
    env: &'a mut dyn Env,
    poster: &'a mut dyn EventPoster,
    st: &'a mut ExecState,
    /// Buttons and keys Brenda holds down right now (released even after Stop).
    held: Vec<Synth>,
}

impl Ctx<'_> {
    /// The ONLY place an event is posted.
    fn emit(&mut self, e: Synth) -> Result<(), Fail> {
        if self.env.stopped() && !e.is_release() {
            self.release_all();
            return Err(Fail::Stop);
        }
        // Who gets this event, checked again right before it goes (review, 12 October 2026).
        let checked = match &e {
            Synth::Key { down: true, .. } | Synth::Text { .. } => self.check_keyboard(),
            Synth::Down { x, y, .. } => self.check_where(Some((*x, *y))),
            _ => Ok(()),
        };
        if let Err(f) = checked {
            self.release_all();
            return Err(f);
        }
        self.poster.post(&e).map_err(Fail::Msg)?;
        let now = self.env.now_ms();
        self.st.last_post_ms = Some(now);
        self.st.posted_since_shot = true;
        LAST_POST_UNIX_MS.store(unix_ms(), Ordering::SeqCst);
        match &e {
            Synth::Move { x, y, .. } | Synth::Drag { x, y, .. } | Synth::Down { x, y, .. } | Synth::Up { x, y, .. } => self.st.last_post_point = Some((*x, *y)),
            _ => {}
        }
        match &e {
            Synth::Down { button, x, y, clicks, flags } => self.held.push(Synth::Up { button: *button, x: *x, y: *y, clicks: *clicks, flags: *flags }),
            Synth::Key { code, down: true, flags } => self.held.push(Synth::Key { code: *code, down: false, flags: *flags }),
            Synth::Up { button, .. } => self.held.retain(|h| !matches!(h, Synth::Up { button: b, .. } if b == button)),
            Synth::Key { code, down: false, .. } => self.held.retain(|h| !matches!(h, Synth::Key { code: c, .. } if c == code)),
            _ => {}
        }
        Ok(())
    }

    /// Lets go of everything Brenda holds (after Stop or a failure).
    fn release_all(&mut self) {
        while let Some(r) = self.held.pop() {
            let _ = self.poster.post(&r);
        }
    }

    fn pause(&mut self, ms: u64) -> Result<(), Fail> {
        if self.env.sleep(ms) {
            Ok(())
        } else {
            self.release_all();
            Err(Fail::Stop)
        }
    }

    fn point(&self, input: &Value, key: &str) -> Result<Option<(f64, f64)>, Fail> {
        let Some(v) = input.get(key) else { return Ok(None) };
        if v.is_null() {
            return Ok(None);
        }
        let arr = v.as_array().filter(|a| a.len() == 2).ok_or_else(|| Fail::Msg(format!("Not executed: {key} must be [x, y].")))?;
        let (Some(x), Some(y)) = (arr[0].as_f64(), arr[1].as_f64()) else { return Err(Fail::Msg(format!("Not executed: {key} must be [x, y]."))) };
        shot_to_global(&self.st.geom, x, y).map(Some).ok_or_else(|| Fail::Msg(NOT_EXECUTED_OFF_SCREEN.into()))
    }

    fn here(&self) -> (f64, f64) {
        self.env.pointer().or(self.st.last_post_point).unwrap_or((self.st.geom.display.x, self.st.geom.display.y))
    }

    /// Where (B.7.5 step 3) and payment pages (step 4). `target`: the point acted on, if any.
    fn check_where(&self, target: Option<(f64, f64)>) -> Result<(), Fail> {
        let front = self.env.front().ok_or_else(|| Fail::Msg(NOT_EXECUTED_FRONT_UNKNOWN.into()))?;
        // Brenda in front: a pause until the person's app is back (L.1), never a refusal.
        if self.env.is_own(&front) {
            return Err(Fail::Pause(Why::OwnFront));
        }
        let mut apps = vec![front.clone()];
        if let Some(p) = target {
            if let Some(owner) = self.env.owner_at(p) {
                apps.push(owner);
            }
        }
        for a in &apps {
            // A point on her own island is still refused.
            if self.env.is_own(a) {
                return Err(Fail::Msg(NOT_EXECUTED_OWN.into()));
            }
            if let Some(name) = self.env.forbidden(a) {
                return Err(Fail::Msg(format!("Not executed: I never work in {name}. Call cannot_continue.")));
            }
        }
        if guard::is_browser(front.bundle_id.as_deref()) {
            if let Some(url) = self.env.page_url() {
                if guard::payment_page(&url) {
                    return Err(Fail::Msg(NOT_EXECUTED_PAYMENT.into()));
                }
            }
        }
        Ok(())
    }

    /// The front app and the keyboard's owner, before a key or typing goes: never Brenda's own, never where she never
    /// works (review, 12 October 2026).
    fn check_keyboard(&self) -> Result<(), Fail> {
        let front = self.env.front().ok_or_else(|| Fail::Msg(NOT_EXECUTED_FRONT_UNKNOWN.into()))?;
        if self.env.is_own(&front) {
            return Err(Fail::Pause(Why::OwnFront));
        }
        let mut apps = vec![front];
        if let Some(owner) = self.env.focused().and_then(|f| f.pid).filter(|p| *p != apps[0].pid).and_then(|p| self.env.app_of(p)) {
            apps.push(owner);
        }
        for a in &apps {
            if self.env.is_own(a) {
                return Err(Fail::Pause(Why::OwnFront));
            }
            if let Some(name) = self.env.forbidden(a) {
                return Err(Fail::Msg(format!("Not executed: I never work in {name}. Call cannot_continue.")));
            }
        }
        Ok(())
    }

    /// An outward (or unreadable) step: allowed only with this turn's yes to an asked step of the same kind, once.
    fn outward(class: guard::Class, approved: Option<&str>, used: &mut bool) -> Result<(), Fail> {
        let verb = match &class {
            guard::Class::Safe => return Ok(()),
            guard::Class::Outward(v) => Some(v.as_str()),
            guard::Class::Unknown => None,
        };
        match approved {
            Some(kind) if !*used && guard::kind_allows(kind, verb) => {
                *used = true;
                Ok(())
            }
            _ => Err(Fail::Msg(match verb {
                Some(v) => format!("Not executed: this step would {v}. Call ask_before first, naming exactly this step."),
                None => NOT_EXECUTED_UNKNOWN.into(),
            })),
        }
    }

    fn front_bundle(&self) -> (Option<String>, bool) {
        let b = self.env.front().and_then(|f| f.bundle_id);
        let browser = guard::is_browser(b.as_deref());
        (b, browser)
    }

    /// A click: the control under it (no answer at all asks first), and never opening what `open_refusal` refuses.
    fn click_class(&self, at: (f64, f64), count: i64) -> Result<guard::Class, Fail> {
        let Some(chain) = self.env.elements_at(at) else { return Ok(guard::Class::Unknown) };
        if let Some(name) = guard::dock_item_name(&chain) {
            let item = AppInfo { pid: -1, name: name.clone(), bundle_id: None };
            if self.env.forbidden(&item).is_some() {
                return Err(Fail::Msg(format!("Not executed: I never work in {name}. Call cannot_continue.")));
            }
        }
        if count >= 2 {
            if let Some(m) = self.env.file_at(at).and_then(|p| open_refusal(&*self.env, &p)) {
                return Err(Fail::Msg(m));
            }
        }
        Ok(guard::outward_click(&chain).map(guard::Class::Outward).unwrap_or(guard::Class::Safe))
    }

    fn key_class(&self, c: &Combo) -> Result<guard::Class, Fail> {
        let (bundle, browser) = self.front_bundle();
        // ⌘O and ⌘↓ open what is selected in Finder.
        if bundle.as_deref() == Some("com.apple.finder") && c.flags & MOD_COMMAND != 0 && (c.code == guard::KEY_O || c.code == guard::KEY_DOWN) {
            if let Some(m) = self.env.finder_selection().iter().find_map(|p| open_refusal(&*self.env, p)) {
                return Err(Fail::Msg(m));
            }
        }
        Ok(guard::classify_key(c.code, c.flags, self.env.focused().as_ref(), bundle.as_deref(), browser))
    }

    /// A drop (a drag let go): into the Trash deletes; into another app shares; where it lands unreadable asks first.
    fn drop_class(&self, from_pid: Option<i32>, to: (f64, f64)) -> guard::Class {
        let Some(chain) = self.env.elements_at(to) else { return guard::Class::Unknown };
        if guard::is_trash(&chain) {
            return guard::Class::Outward("delete".into());
        }
        match (from_pid, self.env.owner_at(to).map(|o| o.pid)) {
            (Some(a), Some(b)) if a == b => guard::Class::Safe,
            (Some(_), Some(_)) => guard::Class::Outward("share".into()),
            _ => guard::Class::Unknown,
        }
    }

    fn click(&mut self, button: Button, at: (f64, f64), count: i64, flags: u64) -> Result<(), Fail> {
        self.emit(Synth::Move { x: at.0, y: at.1, flags })?;
        self.env.tap(at);
        self.pause(30)?;
        for n in 1..=count {
            if n > 1 {
                self.pause(80)?;
            }
            self.emit(Synth::Down { button, x: at.0, y: at.1, clicks: n, flags })?;
            self.pause(40)?;
            self.emit(Synth::Up { button, x: at.0, y: at.1, clicks: n, flags })?;
        }
        Ok(())
    }

    fn key(&mut self, c: Combo) -> Result<(), Fail> {
        self.emit(Synth::Key { code: c.code, down: true, flags: c.flags })?;
        self.pause(8)?;
        self.emit(Synth::Key { code: c.code, down: false, flags: c.flags })?;
        Ok(())
    }

    fn run_one(&mut self, a: &ApprovedAction, approved: Option<&str>, used: &mut bool) -> Result<Out, Fail> {
        let input = &a.input;
        let text_mods = || -> Result<u64, Fail> { Ok(parse_modifiers(input.get("text").and_then(|t| t.as_str()).unwrap_or(""))?) };
        match a.member.as_str() {
            "screenshot" => {
                if self.st.posted_since_shot {
                    self.pause(300)?;
                }
                let img = self.env.screenshot()?;
                self.st.posted_since_shot = false;
                Ok(Out::Image(img))
            }
            "zoom" => {
                let r = input.get("region").and_then(|r| r.as_array()).filter(|r| r.len() == 4).ok_or_else(|| Fail::Msg("Not executed: region must be [x0, y0, x1, y1].".into()))?;
                let v: Vec<f64> = r.iter().filter_map(|n| n.as_f64()).collect();
                if v.len() != 4 || v[2] <= v[0] || v[3] <= v[1] {
                    return Err(Fail::Msg("Not executed: region must be [x0, y0, x1, y1].".into()));
                }
                if shot_to_global(&self.st.geom, v[0], v[1]).is_none() || shot_to_global(&self.st.geom, v[2], v[3]).is_none() {
                    return Err(Fail::Msg(NOT_EXECUTED_OFF_SCREEN.into()));
                }
                if self.st.posted_since_shot {
                    self.pause(300)?;
                }
                Ok(Out::Image(self.env.zoom([v[0], v[1], v[2], v[3]])?))
            }
            "cursor_position" => {
                let p = self.here();
                let (x, y) = global_to_shot(&self.st.geom, p.0, p.1);
                Ok(Out::Text(format!("x={x}, y={y}")))
            }
            "left_click" | "right_click" | "middle_click" | "double_click" | "triple_click" => {
                let at = self.point(input, "coordinate")?.unwrap_or_else(|| self.here());
                let flags = text_mods()?;
                self.check_where(Some(at))?;
                let (button, count) = match a.member.as_str() {
                    "right_click" => (Button::Right, 1),
                    "middle_click" => (Button::Middle, 1),
                    "double_click" => (Button::Left, 2),
                    "triple_click" => (Button::Left, 3),
                    _ => (Button::Left, 1),
                };
                // A right-click only opens a menu; every other press is read first.
                if button != Button::Right {
                    let class = self.click_class(at, count)?;
                    Self::outward(class, approved, used)?;
                }
                self.click(button, at, count, flags)?;
                self.st.focus_may_change = true;
                Ok(Out::Text("OK".into()))
            }
            "left_click_drag" => {
                let from = self.point(input, "start_coordinate")?.ok_or_else(|| Fail::Msg("Not executed: start_coordinate is needed.".into()))?;
                let to = self.point(input, "coordinate")?.ok_or_else(|| Fail::Msg("Not executed: coordinate is needed.".into()))?;
                let flags = text_mods()?;
                self.check_where(Some(from))?;
                self.check_where(Some(to))?;
                let source = self.env.owner_at(from).map(|o| o.pid);
                Self::outward(self.drop_class(source, to), approved, used)?;
                self.emit(Synth::Move { x: from.0, y: from.1, flags })?;
                self.pause(30)?;
                self.emit(Synth::Down { button: Button::Left, x: from.0, y: from.1, clicks: 1, flags })?;
                for i in 1..=12 {
                    self.pause(8)?;
                    let t = i as f64 / 12.0;
                    self.emit(Synth::Drag { x: from.0 + (to.0 - from.0) * t, y: from.1 + (to.1 - from.1) * t, flags })?;
                }
                self.emit(Synth::Up { button: Button::Left, x: to.0, y: to.1, clicks: 1, flags })?;
                self.st.focus_may_change = true;
                Ok(Out::Text("OK".into()))
            }
            "mouse_move" => {
                let at = self.point(input, "coordinate")?.ok_or_else(|| Fail::Msg("Not executed: coordinate is needed.".into()))?;
                self.check_where(Some(at))?;
                self.emit(Synth::Move { x: at.0, y: at.1, flags: 0 })?;
                Ok(Out::Text("OK".into()))
            }
            "left_mouse_down" | "left_mouse_up" => {
                let at = self.here();
                self.check_where(Some(at))?;
                if a.member == "left_mouse_down" {
                    let class = self.click_class(at, 1)?;
                    Self::outward(class, approved, used)?;
                    self.emit(Synth::Down { button: Button::Left, x: at.0, y: at.1, clicks: 1, flags: 0 })?;
                    self.st.pressed = Some((at, self.env.owner_at(at).map(|o| o.pid)));
                } else {
                    // Letting go somewhere else is a drop (review, 12 October 2026).
                    if let Some((down_at, from)) = self.st.pressed {
                        if ((at.0 - down_at.0).powi(2) + (at.1 - down_at.1).powi(2)).sqrt() > MOVED_POINTS {
                            Self::outward(self.drop_class(from, at), approved, used)?;
                        }
                    }
                    self.emit(Synth::Up { button: Button::Left, x: at.0, y: at.1, clicks: 1, flags: 0 })?;
                    self.st.pressed = None;
                }
                self.st.focus_may_change = true;
                Ok(Out::Text("OK".into()))
            }
            "scroll" => {
                let at = self.point(input, "coordinate")?;
                let flags = text_mods()?;
                let dir = input.get("scroll_direction").and_then(|d| d.as_str()).unwrap_or("");
                let amount = input.get("scroll_amount").and_then(|n| n.as_u64()).unwrap_or(1).clamp(1, SCROLL_MAX as u64) as u32;
                let (dy, dx) = match dir {
                    "up" => (1, 0),
                    "down" => (-1, 0),
                    "left" => (0, 1),
                    "right" => (0, -1),
                    _ => return Err(Fail::Msg("Not executed: scroll_direction must be up, down, left or right.".into())),
                };
                self.check_where(Some(at.unwrap_or_else(|| self.here())))?;
                if let Some(p) = at {
                    self.emit(Synth::Move { x: p.0, y: p.1, flags })?;
                    self.pause(30)?;
                }
                for i in 0..amount {
                    if i > 0 {
                        self.pause(16)?;
                    }
                    self.emit(Synth::Scroll { dy, dx, flags })?;
                }
                Ok(Out::Text("OK".into()))
            }
            "type" => {
                let text = input.get("text").and_then(|t| t.as_str()).ok_or_else(|| Fail::Msg("Not executed: text is needed.".into()))?;
                let n = text.chars().count();
                if n > TYPE_MAX_PER_ACTION {
                    return Err(Fail::Msg("Not executed: that's too much to type in one go (2,000 characters at most).".into()));
                }
                if self.st.typed_total + n > TYPE_MAX_PER_TASK {
                    return Err(Fail::Msg("Not executed: that's more typing than one task allows.".into()));
                }
                self.check_where(None)?;
                self.check_keyboard()?;
                let pieces = type_pieces(text);
                let (bundle, browser) = self.front_bundle();
                Self::outward(guard::classify_typing(text, self.env.focused().as_ref(), bundle.as_deref(), browser), approved, used)?;
                if self.env.secure_input() {
                    return Err(Fail::Msg(NOT_EXECUTED_SECURE.into()));
                }
                for (i, p) in pieces.into_iter().enumerate() {
                    if i > 0 {
                        self.pause(8)?;
                    }
                    match p {
                        TypePiece::Units(units) => self.emit(Synth::Text { units })?,
                        TypePiece::Return => self.key(Combo { code: guard::KEY_RETURN, flags: 0 })?,
                    }
                }
                self.st.typed_total += n;
                self.st.focus_may_change = true;
                Ok(Out::Text("OK".into()))
            }
            "key" => {
                let text = input.get("text").and_then(|t| t.as_str()).ok_or_else(|| Fail::Msg("Not executed: text is needed.".into()))?;
                let combos = parse_keys(text)?;
                let repeat = input.get("repeat").and_then(|r| r.as_u64()).unwrap_or(1).clamp(1, REPEAT_MAX as u64);
                self.check_where(None)?;
                self.check_keyboard()?;
                for c in &combos {
                    let class = self.key_class(c)?;
                    Self::outward(class, approved, used)?;
                }
                if combos.iter().any(|c| c.types_character()) && self.env.secure_input() {
                    return Err(Fail::Msg(NOT_EXECUTED_SECURE.into()));
                }
                for r in 0..repeat {
                    for (i, c) in combos.iter().enumerate() {
                        if r > 0 || i > 0 {
                            self.pause(16)?;
                        }
                        self.key(*c)?;
                    }
                }
                self.st.focus_may_change = true;
                Ok(Out::Text("OK".into()))
            }
            "hold_key" => {
                let text = input.get("text").and_then(|t| t.as_str()).ok_or_else(|| Fail::Msg("Not executed: text is needed.".into()))?;
                let c = parse_combo(text.trim())?;
                let ms = (input.get("duration").and_then(|d| d.as_f64()).unwrap_or(0.5).clamp(0.0, 10.0) * 1000.0) as u64;
                self.check_where(None)?;
                self.check_keyboard()?;
                let class = self.key_class(&c)?;
                Self::outward(class, approved, used)?;
                if c.types_character() && self.env.secure_input() {
                    return Err(Fail::Msg(NOT_EXECUTED_SECURE.into()));
                }
                self.emit(Synth::Key { code: c.code, down: true, flags: c.flags })?;
                self.pause(ms)?;
                self.emit(Synth::Key { code: c.code, down: false, flags: c.flags })?;
                self.st.focus_may_change = true;
                Ok(Out::Text("OK".into()))
            }
            "wait" => {
                let ms = (input.get("duration").and_then(|d| d.as_f64()).unwrap_or(1.0).clamp(0.0, 10.0) * 1000.0) as u64;
                self.pause(ms.min(WAIT_MAX_MS))?;
                Ok(Out::Text("OK".into()))
            }
            other => Err(Fail::Msg(format!("Not executed: I don't know the action \"{other}\"."))),
        }
    }
}

/// Runs the server's approved actions in order (B.7.3–B.7.6), from `from`, appending one result per action to
/// `results`. `approved_outward`: the kind of the asked step the person said yes to in this turn (send, delete…), which
/// covers one outward step of that kind; `used` records that it was spent. The first failure is the action's error;
/// every later action gets `NOT_EXECUTED_EARLIER`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn execute(
    env: &mut dyn Env,
    poster: &mut dyn EventPoster,
    st: &mut ExecState,
    actions: &[ApprovedAction],
    approved_outward: Option<&str>,
    used: &mut bool,
    from: usize,
    results: &mut Vec<StepResult>,
) -> Flow {
    let mut ctx = Ctx { env, poster, st, held: Vec::new() };
    let mut failed = results.iter().any(|r| r.outcome.is_err());
    for (i, a) in actions.iter().enumerate().skip(from) {
        if ctx.env.stopped() {
            return Flow::Stopped { at: i };
        }
        if failed {
            results.push(StepResult { id: a.id.clone(), name: a.member.clone(), outcome: Err(NOT_EXECUTED_EARLIER.into()) });
            continue;
        }
        // After anything that can move the keyboard, let the front app settle before the next action is checked.
        if ctx.st.focus_may_change {
            if !ctx.env.sleep(SETTLE_MS) {
                return Flow::Stopped { at: i };
            }
        }
        let now = ctx.env.now_ms();
        let front = ctx.env.front();
        if let Some(why) = interference(ctx.st, now, ctx.env.pointer(), ctx.env.key_down_age_ms(), front.as_ref().map(|f| f.pid)) {
            return Flow::Paused { why, at: i };
        }
        ctx.st.focus_may_change = false;
        match ctx.run_one(a, approved_outward, used) {
            Ok(out) => results.push(StepResult { id: a.id.clone(), name: a.member.clone(), outcome: Ok(out) }),
            Err(Fail::Stop) => return Flow::Stopped { at: i },
            Err(Fail::Pause(why)) => {
                ctx.release_all();
                return Flow::Paused { why, at: i };
            }
            Err(Fail::Msg(m)) => {
                ctx.release_all();
                failed = true;
                results.push(StepResult { id: a.id.clone(), name: a.member.clone(), outcome: Err(m) });
            }
        }
        ctx.st.last_front_pid = ctx.env.front().map(|f| f.pid).or(ctx.st.last_front_pid);
    }
    Flow::Done
}

/// Runs approved actions with the Mac's real event poster: the only way `CgPoster` is used.
#[allow(clippy::too_many_arguments)]
pub fn run_on_mac(env: &mut dyn Env, st: &mut ExecState, actions: &[ApprovedAction], approved_outward: Option<&str>, used: &mut bool, from: usize, results: &mut Vec<StepResult>) -> Flow {
    #[cfg(target_os = "macos")]
    {
        match mac::CgPoster::new() {
            Some(mut poster) => execute(env, &mut poster, st, actions, approved_outward, used, from, results),
            None => {
                for a in actions.iter().skip(from) {
                    results.push(StepResult { id: a.id.clone(), name: a.member.clone(), outcome: Err("Not executed: the Mac wouldn't let me use the keyboard and mouse.".into()) });
                }
                Flow::Done
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (env, st, approved_outward, used);
        for a in actions.iter().skip(from) {
            results.push(StepResult { id: a.id.clone(), name: a.member.clone(), outcome: Err("Not executed: only on a Mac.".into()) });
        }
        Flow::Done
    }
}

/// Line breaks and tabs as spaces: the front desk's typing never presses Return, Enter or Tab (helpers-spec C).
pub fn front_typing(text: &str) -> String {
    text.chars().map(|c| if c == '\n' || c == '\r' || c == '\t' || c == '\u{2028}' || c == '\u{2029}' { ' ' } else { c }).collect()
}

/// The front desk's typing fallback (helpers-spec C, `type_text`): `text` as Unicode characters into whatever has the
/// keyboard, in chunks of at most 20 UTF-16 units (never splitting a character), the stop flag before each chunk and
/// 8 ms between them. Never Return, Enter or Tab: the text passes `front_typing` first. Whether every chunk went.
pub fn type_into_focus(text: &str, stopped: &dyn Fn() -> bool) -> bool {
    let text = front_typing(text);
    let pieces: Vec<Vec<u16>> = type_pieces(&text).into_iter().filter_map(|p| if let TypePiece::Units(u) = p { Some(u) } else { None }).collect();
    #[cfg(target_os = "macos")]
    {
        let Some(mut poster) = mac::CgPoster::new() else { return false };
        for (i, units) in pieces.into_iter().enumerate() {
            if stopped() {
                return false;
            }
            if i > 0 {
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
            if poster.post(&Synth::Text { units }).is_err() {
                return false;
            }
            LAST_POST_UNIX_MS.store(unix_ms(), Ordering::SeqCst);
        }
        true
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (pieces, stopped);
        false
    }
}

/// Puts the pointer back where it was at the yes (B.7.7). A warp, not an event: nothing is clicked or typed.
pub fn restore_pointer(to: (f64, f64)) {
    #[cfg(target_os = "macos")]
    mac::warp(to);
    #[cfg(not(target_os = "macos"))]
    let _ = to;
}

#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2_core_foundation::{CFRetained, CGPoint};
    use objc2_core_graphics::{
        CGEvent, CGEventField, CGEventFlags, CGEventSource, CGEventSourceStateID, CGEventTapLocation, CGEventType,
        CGMouseButton, CGScrollEventUnit, CGWarpMouseCursorPosition,
    };

    /// Posts at the HID event tap from a private source, every event tagged and its flags set explicitly.
    pub(super) struct CgPoster {
        source: CFRetained<CGEventSource>,
    }

    impl CgPoster {
        pub(super) fn new() -> Option<Self> {
            CGEventSource::new(CGEventSourceStateID::Private).map(|source| CgPoster { source })
        }

        fn finish(&self, ev: &CGEvent, flags: u64) {
            CGEvent::set_flags(Some(ev), CGEventFlags(flags));
            CGEvent::set_integer_value_field(Some(ev), CGEventField::EventSourceUserData, EVENT_TAG);
            CGEvent::post(CGEventTapLocation::HIDEventTap, Some(ev));
        }

        fn mouse(&self, ty: CGEventType, x: f64, y: f64, button: Button, clicks: i64, flags: u64) -> Result<(), String> {
            let b = match button {
                Button::Left => CGMouseButton::Left,
                Button::Right => CGMouseButton::Right,
                Button::Middle => CGMouseButton::Center,
            };
            let ev = CGEvent::new_mouse_event(Some(&self.source), ty, CGPoint { x, y }, b).ok_or("Couldn't make a mouse event.")?;
            if clicks > 0 {
                CGEvent::set_integer_value_field(Some(&ev), CGEventField::MouseEventClickState, clicks);
            }
            self.finish(&ev, flags);
            Ok(())
        }
    }

    impl EventPoster for CgPoster {
        fn post(&mut self, e: &Synth) -> Result<(), String> {
            match e {
                Synth::Move { x, y, flags } => self.mouse(CGEventType::MouseMoved, *x, *y, Button::Left, 0, *flags),
                Synth::Drag { x, y, flags } => self.mouse(CGEventType::LeftMouseDragged, *x, *y, Button::Left, 1, *flags),
                Synth::Down { button, x, y, clicks, flags } => {
                    let ty = match button {
                        Button::Left => CGEventType::LeftMouseDown,
                        Button::Right => CGEventType::RightMouseDown,
                        Button::Middle => CGEventType::OtherMouseDown,
                    };
                    self.mouse(ty, *x, *y, *button, *clicks, *flags)
                }
                Synth::Up { button, x, y, clicks, flags } => {
                    let ty = match button {
                        Button::Left => CGEventType::LeftMouseUp,
                        Button::Right => CGEventType::RightMouseUp,
                        Button::Middle => CGEventType::OtherMouseUp,
                    };
                    self.mouse(ty, *x, *y, *button, *clicks, *flags)
                }
                Synth::Scroll { dy, dx, flags } => {
                    let ev = CGEvent::new_scroll_wheel_event2(Some(&self.source), CGScrollEventUnit::Line, 2, *dy, *dx, 0).ok_or("Couldn't make a scroll event.")?;
                    self.finish(&ev, *flags);
                    Ok(())
                }
                Synth::Key { code, down, flags } => {
                    let ev = CGEvent::new_keyboard_event(Some(&self.source), *code, *down).ok_or("Couldn't make a key event.")?;
                    self.finish(&ev, *flags);
                    Ok(())
                }
                Synth::Text { units } => {
                    for down in [true, false] {
                        let ev = CGEvent::new_keyboard_event(Some(&self.source), 0, down).ok_or("Couldn't make a key event.")?;
                        // SAFETY: `units` outlives the call and its length is passed with it.
                        unsafe { CGEvent::keyboard_set_unicode_string(Some(&ev), units.len() as _, units.as_ptr()) };
                        self.finish(&ev, 0);
                    }
                    Ok(())
                }
            }
        }
    }

    pub(super) fn warp(to: (f64, f64)) {
        let _ = CGWarpMouseCursorPosition(CGPoint { x: to.0, y: to.1 });
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::Cell;

    /// Records events instead of posting them. `stop_after`: the stop flag goes up after that many events.
    pub struct RecordingPoster {
        pub events: Vec<Synth>,
        pub stop_after: Option<usize>,
        pub stop: std::rc::Rc<Cell<bool>>,
        /// The mock pointer, moved by her mouse events as the real one would be.
        pub pointer: Option<std::rc::Rc<Cell<Option<(f64, f64)>>>>,
        /// Counts the events posted (for `MockEnv::front_after`).
        pub count: std::rc::Rc<Cell<usize>>,
    }

    impl RecordingPoster {
        pub fn new(stop: std::rc::Rc<Cell<bool>>) -> Self {
            RecordingPoster { events: vec![], stop_after: None, stop, pointer: None, count: std::rc::Rc::new(Cell::new(0)) }
        }
    }

    impl EventPoster for RecordingPoster {
        fn post(&mut self, e: &Synth) -> Result<(), String> {
            self.events.push(e.clone());
            self.count.set(self.events.len());
            if let (Some(p), Synth::Move { x, y, .. } | Synth::Drag { x, y, .. } | Synth::Down { x, y, .. } | Synth::Up { x, y, .. }) = (&self.pointer, e) {
                p.set(Some((*x, *y)));
            }
            if self.stop_after.is_some_and(|n| self.events.len() >= n) {
                self.stop.set(true);
            }
            Ok(())
        }
    }

    pub struct MockEnv {
        pub stop: std::rc::Rc<Cell<bool>>,
        pub now: Cell<u64>,
        pub pointer: std::rc::Rc<Cell<Option<(f64, f64)>>>,
        pub key_age: Cell<Option<u64>>,
        pub front: Option<AppInfo>,
        pub owner: Option<AppInfo>,
        pub elements: Option<Vec<AxBrief>>,
        /// What `elements_at` answers at a point, when it differs by point (a drop's target).
        pub elements_by: Vec<((f64, f64), Vec<AxBrief>)>,
        pub owners_by: Vec<((f64, f64), AppInfo)>,
        pub focused: Option<guard::Focus>,
        /// The apps by process, for the keyboard's owner.
        pub apps: Vec<AppInfo>,
        pub file: Option<std::path::PathBuf>,
        pub selection: Vec<std::path::PathBuf>,
        /// The front app after this many events have been posted (another app taking the keyboard mid-action).
        pub front_after: Option<(std::rc::Rc<Cell<usize>>, usize, AppInfo)>,
        pub url: Option<String>,
        pub secure: bool,
        pub slept: u64,
        pub taps: usize,
        /// Every app's quarantine attribute.
        pub qtn: Option<String>,
    }

    pub fn finder() -> AppInfo {
        AppInfo { pid: 77, name: "Finder".into(), bundle_id: Some("com.apple.finder".into()) }
    }

    pub fn focus(role: &str, title: &str, in_web: bool, pid: Option<i32>) -> guard::Focus {
        guard::Focus { el: AxBrief { role: role.into(), title: title.into(), description: String::new() }, in_web, pid }
    }

    pub fn text_field(in_web: bool) -> guard::Focus {
        focus("AXTextField", "", in_web, Some(77))
    }

    fn near(a: (f64, f64), b: (f64, f64)) -> bool {
        (a.0 - b.0).abs() < 1.0 && (a.1 - b.1).abs() < 1.0
    }

    impl MockEnv {
        pub fn new(stop: std::rc::Rc<Cell<bool>>) -> Self {
            MockEnv {
                stop,
                now: Cell::new(10_000),
                pointer: std::rc::Rc::new(Cell::new(Some((100.0, 100.0)))),
                key_age: Cell::new(Some(60_000)),
                front: Some(finder()),
                owner: Some(finder()),
                elements: Some(vec![AxBrief { role: "AXGroup".into(), title: String::new(), description: String::new() }]),
                elements_by: vec![],
                owners_by: vec![],
                focused: Some(text_field(false)),
                apps: vec![finder()],
                file: None,
                selection: vec![],
                front_after: None,
                url: None,
                secure: false,
                slept: 0,
                taps: 0,
                qtn: None,
            }
        }
    }

    impl Env for MockEnv {
        fn stopped(&self) -> bool {
            self.stop.get()
        }
        fn sleep(&mut self, ms: u64) -> bool {
            self.slept += ms;
            self.now.set(self.now.get() + ms);
            self.key_age.set(self.key_age.get().map(|a| a + ms));
            !self.stop.get()
        }
        fn now_ms(&self) -> u64 {
            self.now.get()
        }
        fn pointer(&self) -> Option<(f64, f64)> {
            self.pointer.get()
        }
        fn key_down_age_ms(&self) -> Option<u64> {
            self.key_age.get()
        }
        fn front(&self) -> Option<AppInfo> {
            if let Some((count, after, app)) = &self.front_after {
                if count.get() >= *after {
                    return Some(app.clone());
                }
            }
            self.front.clone()
        }
        fn owner_at(&self, p: (f64, f64)) -> Option<AppInfo> {
            self.owners_by.iter().find(|(q, _)| near(*q, p)).map(|(_, a)| a.clone()).or_else(|| self.owner.clone())
        }
        fn forbidden(&self, app: &AppInfo) -> Option<String> {
            guard::no_act(&crate::look::AppId { bundle_id: app.bundle_id.clone(), names: vec![app.name.clone()] }, &[])
        }
        fn is_own(&self, app: &AppInfo) -> bool {
            app.bundle_id.as_deref() == Some(crate::look::OWN_BUNDLE_ID)
        }
        fn elements_at(&self, p: (f64, f64)) -> Option<Vec<AxBrief>> {
            self.elements_by.iter().find(|(q, _)| near(*q, p)).map(|(_, c)| c.clone()).or_else(|| self.elements.clone())
        }
        fn focused(&self) -> Option<guard::Focus> {
            let mut f = self.focused.clone()?;
            if let Some((count, after, app)) = &self.front_after {
                if count.get() >= *after {
                    f.pid = Some(app.pid);
                }
            }
            Some(f)
        }
        fn app_of(&self, pid: i32) -> Option<AppInfo> {
            let extra = self.front_after.as_ref().map(|(_, _, a)| a.clone());
            self.apps.iter().cloned().chain(extra).find(|a| a.pid == pid)
        }
        fn file_at(&self, _p: (f64, f64)) -> Option<std::path::PathBuf> {
            self.file.clone()
        }
        fn finder_selection(&self) -> Vec<std::path::PathBuf> {
            self.selection.clone()
        }
        fn page_url(&self) -> Option<String> {
            self.url.clone()
        }
        fn secure_input(&self) -> bool {
            self.secure
        }
        fn screenshot(&mut self) -> Result<Image, String> {
            Ok(Image { jpeg: vec![0xFF, 0xD8, 0xFF], width: 1280, height: 831 })
        }
        fn zoom(&mut self, _r: [f64; 4]) -> Result<Image, String> {
            Ok(Image { jpeg: vec![0xFF, 0xD8, 0xFF], width: 1280, height: 831 })
        }
        fn tap(&mut self, _p: (f64, f64)) {
            self.taps += 1;
        }
        fn quarantine(&self, _p: &std::path::Path) -> Option<String> {
            self.qtn.clone()
        }
        /// The guard's test probe's default apps by extension (no real lookup).
        fn handler_of(&self, p: &std::path::Path) -> Option<AppInfo> {
            let a = guard::OpenProbe::handler(&guard::tests::probe(), p)?;
            Some(AppInfo { pid: -1, name: a.names[0].clone(), bundle_id: a.bundle_id })
        }
    }

    pub fn geom() -> ShotGeom {
        ShotGeom { display: Bounds { x: 0.0, y: 0.0, w: 1280.0, h: 831.0 }, w: 1280, h: 831 }
    }

    fn act(id: &str, name: &str, input: Value) -> ApprovedAction {
        ApprovedAction { id: id.into(), member: name.into(), input }
    }

    struct Run {
        events: Vec<Synth>,
        results: Vec<StepResult>,
        flow: Flow,
        used: bool,
    }

    fn run_with(env: &mut MockEnv, poster: &mut RecordingPoster, actions: &[ApprovedAction], approved: Option<&str>) -> Run {
        poster.pointer = Some(env.pointer.clone());
        if let Some((c, _, _)) = env.front_after.as_mut() {
            *c = poster.count.clone();
        }
        let mut st = ExecState::new(geom(), env.now_ms(), env.pointer(), env.front.as_ref().map(|f| f.pid));
        let mut used = false;
        let mut results = vec![];
        let flow = execute(env, poster, &mut st, actions, approved, &mut used, 0, &mut results);
        Run { events: poster.events.clone(), results, flow, used }
    }

    fn run(actions: &[ApprovedAction], approved: Option<&str>, setup: impl FnOnce(&mut MockEnv)) -> Run {
        let stop = std::rc::Rc::new(Cell::new(false));
        let mut env = MockEnv::new(stop.clone());
        setup(&mut env);
        let mut poster = RecordingPoster::new(stop);
        run_with(&mut env, &mut poster, actions, approved)
    }

    fn err(r: &StepResult) -> &str {
        r.outcome.as_ref().err().map(|s| s.as_str()).unwrap_or("")
    }

    #[test]
    fn a_left_click_moves_waits_presses_and_lets_go() {
        let r = run(&[act("t1", "left_click", json!({ "coordinate": [640, 212] }))], None, |_| {});
        assert_eq!(r.flow, Flow::Done);
        assert_eq!(
            r.events,
            vec![
                Synth::Move { x: 640.0, y: 212.0, flags: 0 },
                Synth::Down { button: Button::Left, x: 640.0, y: 212.0, clicks: 1, flags: 0 },
                Synth::Up { button: Button::Left, x: 640.0, y: 212.0, clicks: 1, flags: 0 },
            ]
        );
        assert_eq!(serde_json::to_value(&r.results[0]).unwrap(), json!({ "id": "t1", "name": "left_click", "ok": true, "text": "OK" }));
    }

    #[test]
    fn every_member_maps_to_its_events() {
        let r = run(&[act("a", "right_click", json!({ "coordinate": [10, 10], "text": "cmd+shift" }))], None, |_| {});
        assert!(matches!(r.events[1], Synth::Down { button: Button::Right, flags, .. } if flags == MOD_COMMAND | MOD_SHIFT));
        let r = run(&[act("a", "triple_click", json!({ "coordinate": [10, 10] }))], None, |_| {});
        let clicks: Vec<i64> = r.events.iter().filter_map(|e| if let Synth::Down { clicks, .. } = e { Some(*clicks) } else { None }).collect();
        assert_eq!(clicks, vec![1, 2, 3]);
        let r = run(&[act("a", "middle_click", json!({}))], None, |_| {});
        assert!(matches!(r.events[0], Synth::Move { x, y, .. } if x == 100.0 && y == 100.0), "at the pointer");
        let r = run(&[act("a", "left_click_drag", json!({ "start_coordinate": [0, 0], "coordinate": [120, 60] }))], None, |_| {});
        assert_eq!(r.events.iter().filter(|e| matches!(e, Synth::Drag { .. })).count(), 12);
        assert!(matches!(r.events.last(), Some(Synth::Up { x, y, .. }) if *x == 120.0 && *y == 60.0));
        let r = run(&[act("a", "scroll", json!({ "scroll_direction": "down", "scroll_amount": 3, "coordinate": [5, 5] }))], None, |_| {});
        assert_eq!(r.events.iter().filter(|e| matches!(e, Synth::Scroll { dy: -1, dx: 0, .. })).count(), 3);
        let r = run(&[act("a", "scroll", json!({ "scroll_direction": "left", "scroll_amount": 99 }))], None, |_| {});
        assert_eq!(r.events.iter().filter(|e| matches!(e, Synth::Scroll { dy: 0, dx: 1, .. })).count(), 20, "at most 20");
        let r = run(&[act("a", "key", json!({ "text": "cmd+s", "repeat": 2 }))], None, |_| {});
        assert_eq!(r.events.len(), 4);
        assert_eq!(r.events[0], Synth::Key { code: 1, down: true, flags: MOD_COMMAND });
        let r = run(&[act("a", "mouse_move", json!({ "coordinate": [1, 2] }))], None, |_| {});
        assert_eq!(r.events, vec![Synth::Move { x: 1.0, y: 2.0, flags: 0 }]);
        let r = run(&[act("a", "cursor_position", json!({}))], None, |_| {});
        assert!(r.events.is_empty());
        assert_eq!(serde_json::to_value(&r.results[0]).unwrap()["text"], "x=100, y=100");
        let r = run(&[act("a", "screenshot", json!({}))], None, |_| {});
        let v = serde_json::to_value(&r.results[0]).unwrap();
        assert_eq!(v["image"]["mediaType"], "image/jpeg");
        assert_eq!(v["image"]["data"], "/9j/");
        let r = run(&[act("a", "hold_key", json!({ "text": "shift" }))], None, |_| {});
        assert!(err(&r.results[0]).contains("modifier on its own"));
        assert!(r.events.is_empty());
        let r = run(&[act("a", "wait", json!({ "duration": 60 }))], None, |_| {});
        assert!(r.results[0].outcome.is_ok());
    }

    #[test]
    fn a_batch_stops_at_the_first_failure_with_the_exact_strings() {
        let r = run(
            &[
                act("1", "left_click", json!({ "coordinate": [10, 10] })),
                act("2", "left_click", json!({ "coordinate": [5000, 10] })),
                act("3", "type", json!({ "text": "hi" })),
                act("4", "screenshot", json!({})),
            ],
            None,
            |_| {},
        );
        assert_eq!(r.flow, Flow::Done);
        assert_eq!(r.results.len(), 4);
        assert!(r.results[0].outcome.is_ok());
        assert_eq!(err(&r.results[1]), "Not executed: that point is off the screen.");
        assert_eq!(err(&r.results[2]), "Not executed: an earlier computer action in this turn failed.");
        assert_eq!(err(&r.results[3]), "Not executed: an earlier computer action in this turn failed.");
        assert_eq!(r.events.len(), 3, "nothing after the failure");
        let v = serde_json::to_value(&r.results[1]).unwrap();
        assert_eq!(v, json!({ "id": "2", "name": "left_click", "ok": false, "error": "Not executed: that point is off the screen." }));
    }

    /// The stop flag goes up mid-batch and mid-typing: nothing new is posted after it.
    #[test]
    fn stop_before_every_event() {
        // Mid-batch: after the first click's three events.
        let stop = std::rc::Rc::new(Cell::new(false));
        let mut env = MockEnv::new(stop.clone());
        let mut poster = RecordingPoster::new(stop.clone());
        poster.stop_after = Some(3);
        let r = run_with(&mut env, &mut poster, &[act("1", "left_click", json!({ "coordinate": [10, 10] })), act("2", "left_click", json!({ "coordinate": [20, 20] }))], None);
        assert_eq!(r.flow, Flow::Stopped { at: 1 });
        assert_eq!(r.events.len(), 3);
        // Mid-typing: 60 characters are three chunks; stop after the first.
        let stop = std::rc::Rc::new(Cell::new(false));
        let mut env = MockEnv::new(stop.clone());
        let mut poster = RecordingPoster::new(stop.clone());
        poster.stop_after = Some(1);
        let r = run_with(&mut env, &mut poster, &[act("1", "type", json!({ "text": "a".repeat(60) }))], None);
        assert_eq!(r.flow, Flow::Stopped { at: 0 });
        assert_eq!(r.events.len(), 1, "one chunk, then nothing");
        // Mid-click (between down and up): only the release follows.
        let stop = std::rc::Rc::new(Cell::new(false));
        let mut env = MockEnv::new(stop.clone());
        let mut poster = RecordingPoster::new(stop.clone());
        poster.stop_after = Some(2);
        let r = run_with(&mut env, &mut poster, &[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None);
        assert_eq!(r.flow, Flow::Stopped { at: 0 });
        assert_eq!(r.events.len(), 3);
        assert!(r.events[2].is_release(), "the button is let go, nothing else");
        // Already stopped: nothing at all.
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, |e| e.stop.set(true));
        assert_eq!(r.flow, Flow::Stopped { at: 0 });
        assert!(r.events.is_empty());
    }

    #[test]
    fn interference_pauses() {
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, |e| e.pointer.set(Some((100.0, 100.0))));
        assert_eq!(r.flow, Flow::Done);
        // The person moved the pointer after the yes.
        let stop = std::rc::Rc::new(Cell::new(false));
        let mut env = MockEnv::new(stop.clone());
        let mut st = ExecState::new(geom(), env.now_ms(), Some((100.0, 100.0)), Some(77));
        env.pointer.set(Some((300.0, 100.0)));
        let mut poster = RecordingPoster::new(stop.clone());
        let (mut used, mut results) = (false, vec![]);
        let flow = execute(&mut env, &mut poster, &mut st, &[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, &mut used, 0, &mut results);
        assert_eq!(flow, Flow::Paused { why: Why::Moved, at: 0 });
        assert!(poster.events.is_empty());
        // The person typed after the yes.
        env.pointer.set(Some((100.0, 100.0)));
        env.key_age.set(Some(10));
        st.since_ms = env.now_ms() - 5_000;
        let flow = execute(&mut env, &mut poster, &mut st, &[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, &mut used, 0, &mut results);
        assert_eq!(flow, Flow::Paused { why: Why::Typed, at: 0 });
        // Another app came to the front by itself.
        env.key_age.set(Some(60_000));
        env.front = Some(AppInfo { pid: 5, name: "Notes".into(), bundle_id: Some("com.apple.Notes".into()) });
        let flow = execute(&mut env, &mut poster, &mut st, &[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, &mut used, 0, &mut results);
        assert_eq!(flow, Flow::Paused { why: Why::Focus, at: 0 });
        // Carry on: the new pointer and front app are the baseline.
        st.resume(env.now_ms(), Some((100.0, 100.0)), Some(5));
        let flow = execute(&mut env, &mut poster, &mut st, &[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, &mut used, 0, &mut results);
        assert_eq!(flow, Flow::Done);
        // Her own clicks moving the pointer are not interference on the next action.
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] })), act("2", "left_click", json!({ "coordinate": [20, 20] }))], None, |_| {});
        assert_eq!(r.flow, Flow::Done);
        assert_eq!(r.events.len(), 6);
    }

    #[test]
    fn interference_rules_are_pure() {
        let st = ExecState::new(geom(), 1_000, Some((10.0, 10.0)), Some(1));
        assert_eq!(interference(&st, 2_000, Some((12.0, 12.0)), None, Some(1)), None, "under 4 points");
        assert_eq!(interference(&st, 2_000, Some((15.0, 10.0)), None, Some(1)), Some(Why::Moved));
        assert_eq!(interference(&st, 2_000, Some((10.0, 10.0)), Some(5_000), Some(1)), None, "a key before the yes");
        assert_eq!(interference(&st, 2_000, Some((10.0, 10.0)), Some(100), Some(1)), Some(Why::Typed));
        assert_eq!(interference(&st, 2_000, Some((10.0, 10.0)), Some(980), Some(1)), None, "within the 50 ms grace");
        assert_eq!(interference(&st, 2_000, Some((10.0, 10.0)), None, Some(2)), Some(Why::Focus));
        let mut st2 = st.clone();
        st2.focus_may_change = true;
        assert_eq!(interference(&st2, 2_000, Some((10.0, 10.0)), None, Some(2)), None, "after her own click");
    }

    #[test]
    fn outward_click_refused_without_approval() {
        let send = vec![AxBrief { role: "AXButton".into(), title: "Send".into(), description: String::new() }];
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] })), act("2", "screenshot", json!({}))], None, |e| e.elements = Some(send.clone()));
        assert_eq!(err(&r.results[0]), "Not executed: this step would send. Call ask_before first, naming exactly this step.");
        assert_eq!(err(&r.results[1]), NOT_EXECUTED_EARLIER);
        assert!(r.events.is_empty());
        assert!(!r.used);
    }

    #[test]
    fn outward_click_allowed_once_with_approval() {
        let send = vec![AxBrief { role: "AXButton".into(), title: "Send".into(), description: String::new() }];
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] })), act("2", "left_click", json!({ "coordinate": [10, 10] }))], Some("send"), |e| {
            e.elements = Some(send.clone())
        });
        assert!(r.results[0].outcome.is_ok());
        assert!(r.used);
        assert!(err(&r.results[1]).starts_with("Not executed: this step would send."), "one yes covers one step");
        assert_eq!(r.events.len(), 3);
    }

    #[test]
    fn outward_keys_need_their_own_yes() {
        let r = run(&[act("1", "key", json!({ "text": "cmd+Return" }))], None, |_| {});
        assert_eq!(err(&r.results[0]), "Not executed: this step would send. Call ask_before first, naming exactly this step.");
        let r = run(&[act("1", "key", json!({ "text": "cmd+q" }))], None, |_| {});
        assert!(err(&r.results[0]).contains("would quit"));
        let r = run(&[act("1", "key", json!({ "text": "Return" }))], None, |e| e.focused = Some(text_field(true)));
        assert!(err(&r.results[0]).contains("would submit"));
        let r = run(&[act("1", "type", json!({ "text": "hello\n" }))], None, |e| e.focused = Some(text_field(true)));
        assert!(err(&r.results[0]).contains("would submit"), "a newline in a web form is Return");
        let r = run(&[act("1", "key", json!({ "text": "Return" }))], None, |e| e.focused = Some(focus("AXTextArea", "", false, Some(77))));
        assert!(r.results[0].outcome.is_ok(), "Return in a native text area is just a new line");
    }

    fn brief(role: &str, title: &str) -> AxBrief {
        AxBrief { role: role.into(), title: title.into(), description: String::new() }
    }

    fn app(pid: i32, name: &str, id: &str) -> AppInfo {
        AppInfo { pid, name: name.into(), bundle_id: Some(id.into()) }
    }

    /// Review, 12 October 2026 (permission-1): the keyboard can press, submit, send and delete too, and what cannot be
    /// read asks first.
    #[test]
    fn keys_that_press_or_send_need_their_own_yes() {
        // Tab to a Send button, then Return or Space.
        let r = run(&[act("1", "key", json!({ "text": "Tab" })), act("2", "key", json!({ "text": "Return" }))], None, |e| e.focused = Some(focus("AXButton", "Send", true, Some(77))));
        assert!(r.results[0].outcome.is_ok());
        assert!(err(&r.results[1]).contains("would send"), "{}", err(&r.results[1]));
        let r = run(&[act("1", "key", json!({ "text": "space" }))], None, |e| e.focused = Some(focus("AXButton", "Delete account", true, Some(77))));
        assert!(err(&r.results[0]).contains("would delete"));
        assert!(r.events.is_empty());
        // Return in an Electron app's comment box (Linear is not on any list).
        let slack = app(40, "Linear", "com.linear");
        let r = run(&[act("1", "type", json!({ "text": "Approved\n" }))], None, |e| {
            e.front = Some(slack.clone());
            e.owner = Some(slack.clone());
            e.apps.push(slack.clone());
            e.focused = Some(focus("AXTextArea", "", false, Some(40)));
        });
        assert!(err(&r.results[0]).contains("would send"), "{:?}", r.results[0]);
        assert!(r.events.is_empty(), "nothing typed, not even the words before the Return");
        // A single-key delete on a selected message.
        let r = run(&[act("1", "key", json!({ "text": "BackSpace" }))], None, |e| e.focused = Some(focus("AXTable", "", false, Some(77))));
        assert!(err(&r.results[0]).contains("would delete"));
        // No answer from Accessibility: ask first, for a click and for a key.
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, |e| e.elements = None);
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_UNKNOWN);
        assert!(r.events.is_empty());
        let r = run(&[act("1", "key", json!({ "text": "Return" }))], None, |e| e.focused = None);
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_UNKNOWN);
        // Typing letters into a web page with no field: its one-key shortcuts.
        let chrome = app(41, "Google Chrome", "com.google.Chrome");
        let r = run(&[act("1", "type", json!({ "text": "#" }))], None, |e| {
            e.front = Some(chrome.clone());
            e.owner = Some(chrome.clone());
            e.focused = Some(focus("AXGroup", "", true, Some(41)));
        });
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_UNKNOWN);
        // With the person's yes to that step, the unreadable step goes, once.
        let r = run(&[act("1", "key", json!({ "text": "Return" })), act("2", "key", json!({ "text": "Return" }))], Some("other"), |e| e.focused = None);
        assert!(r.results[0].outcome.is_ok());
        assert_eq!(err(&r.results[1]), NOT_EXECUTED_UNKNOWN);
    }

    /// Review, 12 October 2026 (permission-6): a yes covers the step of the kind the person heard, nothing else.
    #[test]
    fn a_yes_covers_only_its_own_kind() {
        let del = vec![brief("AXButton", "Delete conversation")];
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], Some("other"), |e| e.elements = Some(del.clone()));
        assert!(err(&r.results[0]).contains("would delete"), "a yes to 'Save as draft' never deletes");
        assert!(!r.used);
        let r = run(&[act("1", "key", json!({ "text": "cmd+Return" }))], Some("delete"), |_| {});
        assert!(err(&r.results[0]).contains("would send"));
        let post = vec![brief("AXButton", "Post")];
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], Some("send"), |e| e.elements = Some(post.clone()));
        assert!(r.results[0].outcome.is_ok(), "the sending family");
        assert!(r.used);
    }

    /// Review, 12 October 2026 (permission-2): the keyboard's owner is checked before every key and every piece of typing.
    #[test]
    fn the_keyboard_is_checked_before_every_event() {
        // Spotlight has the keyboard while Finder stays in front.
        let spotlight = app(90, "Spotlight", "com.apple.Spotlight");
        let r = run(&[act("1", "type", json!({ "text": "Terminal" }))], None, |e| {
            e.apps.push(spotlight.clone());
            e.focused = Some(focus("AXTextField", "", false, Some(90)));
        });
        assert_eq!(err(&r.results[0]), "Not executed: I never work in Spotlight. Call cannot_continue.");
        assert!(r.events.is_empty());
        // Terminal comes to the front in the middle of a long piece of typing: nothing more goes after it.
        let terminal = app(91, "Terminal", "com.apple.Terminal");
        let r = run(&[act("1", "type", json!({ "text": " ".repeat(200) }))], None, |e| {
            e.front_after = Some((std::rc::Rc::new(Cell::new(0)), 3, terminal.clone()));
        });
        assert_eq!(err(&r.results[0]), "Not executed: I never work in Terminal. Call cannot_continue.");
        assert_eq!(r.events.len(), 3, "three chunks went to Finder, none to Terminal");
        // ⌘Space, then typing: the settle and the check catch the launcher.
        let r = run(&[act("1", "key", json!({ "text": "cmd+space" })), act("2", "type", json!({ "text": "Terminal" }))], None, |e| {
            e.apps.push(spotlight.clone());
            e.front_after = None;
            e.focused = Some(focus("AXTextField", "", false, Some(77)));
        });
        assert!(r.results[0].outcome.is_ok());
        assert!(r.results[1].outcome.is_ok(), "Finder still had the keyboard in this mock");
    }

    /// Owner request, 12 October 2026 (companion2-spec B.4): ordinary apps, documents and folders open again; installers,
    /// scripts, link files, stray or new apps and never-act apps never do.
    #[test]
    fn she_opens_apps_but_never_installers_or_scripts() {
        let dbl = |file: &str| {
            let f = file.to_string();
            run(&[act("1", "double_click", json!({ "coordinate": [10, 10] }))], None, move |e| e.file = Some(f.clone().into()))
        };
        let r = dbl("/Users/a/Desktop/run.command");
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_RUNS);
        assert!(r.events.is_empty());
        assert_eq!(err(&dbl("/Users/a/Downloads/Setup.pkg").results[0]), NOT_EXECUTED_RUNS);
        assert_eq!(err(&dbl("/Users/a/Desktop/Docs.webloc").results[0]), NOT_EXECUTED_RUNS);
        assert!(dbl("/Users/a/Desktop/Q3 report.pdf").results[0].outcome.is_ok());
        assert!(dbl("/Applications/Figma.app").results[0].outcome.is_ok(), "an ordinary app opens again");
        assert_eq!(err(&dbl("/Users/a/Downloads/Figma.app").results[0]), NOT_EXECUTED_OUTSIDE_APP);
        assert_eq!(err(&dbl("/System/Applications/Utilities/Terminal.app").results[0]), "Not executed: I never work in Terminal. Call cannot_continue.");
        let r = run(&[act("1", "double_click", json!({ "coordinate": [10, 10] }))], None, |e| {
            e.file = Some("/Applications/New.app".into());
            e.qtn = Some("0083;6712a1b2;Safari;".into());
        });
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_NEW_APP);
        assert!(r.events.is_empty());
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, |e| e.elements = Some(vec![brief("AXDockItem", "Terminal")]));
        assert_eq!(err(&r.results[0]), "Not executed: I never work in Terminal. Call cannot_continue.");
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, |e| e.elements = Some(vec![brief("AXDockItem", "Figma")]));
        assert!(r.results[0].outcome.is_ok(), "a Dock click opens an ordinary app");
        let r = run(&[act("1", "key", json!({ "text": "cmd+o" }))], None, |e| e.selection = vec!["/Applications/Utilities/Terminal.app".into()]);
        assert_eq!(err(&r.results[0]), "Not executed: I never work in Terminal. Call cannot_continue.");
        let r = run(&[act("1", "key", json!({ "text": "cmd+o" }))], None, |e| e.selection = vec!["/Users/a/Downloads/Installer.dmg".into()]);
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_RUNS);
        let r = run(&[act("1", "key", json!({ "text": "cmd+o" }))], None, |e| e.selection = vec!["/Applications/Notes.app".into()]);
        assert!(r.results[0].outcome.is_ok());
        let r = run(&[act("1", "key", json!({ "text": "cmd+o" }))], None, |e| e.selection = vec!["/Users/a/Plan.docx".into()]);
        assert!(r.results[0].outcome.is_ok());
        // Review, 12 October 2026: what opens a document is checked too, and disk images and certificates never open.
        assert_eq!(err(&dbl("/Users/a/Downloads/Clipboard.alfredworkflow").results[0]), "Not executed: that opens in Alfred Preferences, and I never work there. Call cannot_continue.");
        assert_eq!(err(&dbl("/Users/a/Downloads/root.kc").results[0]), "Not executed: that opens in Keychain Access, and I never work there. Call cannot_continue.");
        assert_eq!(err(&dbl("/Users/a/Downloads/disk.vhd").results[0]), "Not executed: that opens in DiskImageMounter, and I never work there. Call cannot_continue.");
        assert_eq!(err(&dbl("/Users/a/Downloads/ubuntu.iso").results[0]), NOT_EXECUTED_RUNS);
        assert_eq!(err(&dbl("/Users/a/Downloads/root-ca.cer").results[0]), NOT_EXECUTED_RUNS);
        assert_eq!(err(&dbl("/System/Library/CoreServices/Erase Assistant.app").results[0]), NOT_EXECUTED_RUNS);
        assert_eq!(err(&dbl("/Applications/Install macOS Sequoia.app").results[0]), NOT_EXECUTED_RUNS);
        assert_eq!(err(&dbl("/System/Library/CoreServices/DiskImageMounter.app").results[0]), NOT_EXECUTED_OUTSIDE_APP);
    }

    /// Review, 12 October 2026 (permission-5): a drop into the Trash deletes; a drop into another app shares.
    #[test]
    fn drops_into_the_trash_or_another_app_need_their_own_yes() {
        let trash = vec![brief("AXDockItem", "Trash")];
        let dock = app(12, "Dock", "com.apple.dock");
        let r = run(&[act("1", "left_click_drag", json!({ "start_coordinate": [100, 100], "coordinate": [600, 820] }))], None, |e| {
            e.elements_by = vec![((600.0, 820.0), trash.clone())];
            e.owners_by = vec![((600.0, 820.0), dock.clone())];
        });
        assert!(err(&r.results[0]).contains("would delete"));
        assert!(r.events.is_empty());
        let r = run(&[act("1", "left_click_drag", json!({ "start_coordinate": [100, 100], "coordinate": [600, 820] }))], Some("delete"), |e| {
            e.elements_by = vec![((600.0, 820.0), trash.clone())];
            e.owners_by = vec![((600.0, 820.0), dock.clone())];
        });
        assert!(r.results[0].outcome.is_ok());
        // Press, move, let go over the Trash.
        let r = run(
            &[act("1", "left_mouse_down", json!({})), act("2", "mouse_move", json!({ "coordinate": [600, 820] })), act("3", "left_mouse_up", json!({}))],
            None,
            |e| {
                e.elements_by = vec![((600.0, 820.0), trash.clone())];
                e.owners_by = vec![((600.0, 820.0), dock.clone())];
            },
        );
        assert!(r.results[1].outcome.is_ok());
        assert!(err(&r.results[2]).contains("would delete"));
        // From Finder into a browser's upload area: shares.
        let safari = app(30, "Safari", "com.apple.Safari");
        let r = run(&[act("1", "left_click_drag", json!({ "start_coordinate": [100, 100], "coordinate": [900, 400] }))], None, |e| {
            e.owners_by = vec![((900.0, 400.0), safari.clone())];
        });
        assert!(err(&r.results[0]).contains("would share"));
        // Within Finder: a move.
        let r = run(&[act("1", "left_click_drag", json!({ "start_coordinate": [100, 100], "coordinate": [300, 300] }))], None, |_| {});
        assert!(r.results[0].outcome.is_ok());
    }

    #[test]
    fn she_lets_the_screen_settle_after_a_click() {
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] })), act("2", "screenshot", json!({}))], None, |_| {});
        assert_eq!(r.flow, Flow::Done);
        assert!(r.results.iter().all(|x| x.outcome.is_ok()));
    }

    #[test]
    fn where_she_never_works() {
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, |e| {
            e.owner = Some(AppInfo { pid: 9, name: "Terminal".into(), bundle_id: Some("com.apple.Terminal".into()) })
        });
        assert_eq!(err(&r.results[0]), "Not executed: I never work in Terminal. Call cannot_continue.");
        assert!(r.events.is_empty());
        // Brenda in front is a pause now, not a refusal (L.1): `own_front_pauses_not_refuses`.
        let r = run(&[act("1", "type", json!({ "text": "x" }))], None, |e| e.front = None);
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_FRONT_UNKNOWN, "fails closed");
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, |e| {
            e.front = Some(AppInfo { pid: 3, name: "Safari".into(), bundle_id: Some("com.apple.Safari".into()) });
            e.owner = e.front.clone();
            e.url = Some("https://www.paypal.com/myaccount".into());
        });
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_PAYMENT);
    }

    #[test]
    fn secure_input_refuses_typing() {
        let r = run(&[act("1", "type", json!({ "text": "hunter2" }))], None, |e| e.secure = true);
        assert_eq!(err(&r.results[0]), "Not executed: a password field has the keyboard, and I never type into those.");
        assert!(r.events.is_empty());
        let r = run(&[act("1", "key", json!({ "text": "Tab" }))], None, |e| e.secure = true);
        assert!(r.results[0].outcome.is_ok(), "Tab types nothing");
        let r = run(&[act("1", "key", json!({ "text": "a" }))], None, |e| e.secure = true);
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_SECURE);
    }

    #[test]
    fn typing_chunks_keep_characters_whole() {
        let p = type_pieces(&"a".repeat(45));
        assert_eq!(p.len(), 3);
        assert!(matches!(&p[0], TypePiece::Units(u) if u.len() == 20));
        // 19 letters then a family emoji (11 UTF-16 units): the emoji goes whole into the next chunk.
        let family = "\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}";
        let text = format!("{}{}", "a".repeat(19), family);
        let p = type_pieces(&text);
        assert_eq!(p.len(), 2);
        assert!(matches!(&p[1], TypePiece::Units(u) if String::from_utf16(u).unwrap() == family));
        // A letter and its combining accent stay together.
        let text = format!("{}e\u{0301}", "a".repeat(19));
        let p = type_pieces(&text);
        assert!(matches!(&p[1], TypePiece::Units(u) if String::from_utf16(u).unwrap() == "e\u{0301}"));
        assert_eq!(type_pieces("hi\nthere"), vec![TypePiece::Units("hi".encode_utf16().collect()), TypePiece::Return, TypePiece::Units("there".encode_utf16().collect())]);
        for piece in type_pieces(&"\u{1F600}".repeat(30)) {
            if let TypePiece::Units(u) = piece {
                assert!(u.len() <= 20 && String::from_utf16(&u).is_ok());
            }
        }
    }

    #[test]
    fn key_parsing() {
        assert_eq!(parse_combo("Return").unwrap(), Combo { code: 36, flags: 0 });
        assert_eq!(parse_combo("Enter").unwrap(), Combo { code: 36, flags: 0 });
        assert_eq!(parse_combo("Tab").unwrap().code, 48);
        assert_eq!(parse_combo("BackSpace").unwrap().code, 51);
        assert_eq!(parse_combo("Delete").unwrap().code, 117);
        assert_eq!(parse_combo("Escape").unwrap().code, 53);
        assert_eq!(parse_combo("Left").unwrap().code, 123);
        assert_eq!(parse_combo("Page_Down").unwrap().code, 121);
        assert_eq!(parse_combo("F12").unwrap().code, 111);
        assert_eq!(parse_combo("cmd+shift+s").unwrap(), Combo { code: 1, flags: MOD_COMMAND | MOD_SHIFT });
        assert_eq!(parse_combo("super+c").unwrap(), Combo { code: 8, flags: MOD_COMMAND });
        assert_eq!(parse_combo("ctrl+alt+Delete").unwrap(), Combo { code: 117, flags: MOD_CONTROL | MOD_OPTION });
        assert_eq!(parse_combo("A").unwrap(), Combo { code: 0, flags: MOD_SHIFT });
        assert_eq!(parse_combo("1").unwrap().code, 18);
        assert_eq!(parse_combo("period").unwrap().code, 47);
        assert!(parse_combo("cmd").is_err());
        assert!(parse_combo("hyper+x").is_err());
        assert!(parse_combo("Banana").is_err());
        assert_eq!(parse_keys("ctrl+a ctrl+c").unwrap().len(), 2);
        assert_eq!(parse_keys("space").unwrap(), vec![Combo { code: 49, flags: 0 }]);
        assert!(parse_keys(&"a+".repeat(40)).is_err());
        assert!(Combo { code: 0, flags: 0 }.types_character());
        assert!(!Combo { code: 0, flags: MOD_COMMAND }.types_character());
        assert!(!Combo { code: 36, flags: 0 }.types_character());
    }

    #[test]
    fn coordinates_map_on_a_secondary_display_with_a_negative_origin() {
        let g = ShotGeom { display: Bounds { x: -1920.0, y: -300.0, w: 1920.0, h: 1080.0 }, w: 1280, h: 720 };
        assert_eq!(shot_to_global(&g, 640.0, 360.0), Some((-960.0, 240.0)));
        assert_eq!(shot_to_global(&g, 0.0, 0.0), Some((-1920.0, -300.0)));
        assert_eq!(shot_to_global(&g, -5.0, -8.0), Some((-1920.0, -300.0)), "slightly outside is the edge");
        assert_eq!(shot_to_global(&g, -9.0, 0.0), None);
        assert_eq!(shot_to_global(&g, 1289.0, 0.0), None);
        assert_eq!(global_to_shot(&g, -960.0, 240.0), (640, 360));
        assert_eq!(global_to_shot(&g, 5000.0, 5000.0), (1279, 719));
    }

    #[test]
    fn events_are_tagged_brnd() {
        assert_eq!(EVENT_TAG, 0x4252_4E44);
        assert_eq!(&EVENT_TAG.to_be_bytes()[4..], b"BRND");
    }

    /// B.7.2: the Mac's poster is private here, and the poster is called only inside the executor.
    #[test]
    fn only_execute_posts_events() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        let mut posts = 0;
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            let code: String = src.split("#[cfg(test)]").next().unwrap().to_string();
            posts += code.matches("poster.post(").count();
            if name != "input.rs" {
                assert!(!code.contains("CgPoster"), "{name} must not touch CgPoster");
                assert!(!code.contains("CGEvent::post"), "{name} must not post events");
            }
        }
        assert_eq!(posts, 3, "Ctx::emit, Ctx::release_all for buttons and keys already held, and the front desk's type_into_focus");
        let input = std::fs::read_to_string(format!("{dir}/input.rs")).unwrap();
        let code: String = input.split("#[cfg(test)]").next().unwrap().to_string();
        assert_eq!(code.matches("poster.post(&Synth::Text { units })").count(), 1, "type_into_focus posts only characters");
        // Only the front desk's Mac calls it.
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") || name == "input.rs" {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            let code: String = src.split("#[cfg(test)]").next().unwrap().to_string();
            if code.contains("type_into_focus(") {
                assert_eq!(name, "macos.rs", "{name} types");
            }
        }
    }

    /// L.1: Brenda's own window in front pauses the task (Carry on resumes); it is never refused as before.
    #[test]
    fn own_front_pauses_not_refuses() {
        let own = AppInfo { pid: 1, name: "Brenda".into(), bundle_id: Some(crate::look::OWN_BUNDLE_ID.into()) };
        let o = own.clone();
        let r = run(&[act("1", "type", json!({ "text": "x" }))], None, move |e| e.front = Some(o.clone()));
        assert_eq!(r.flow, Flow::Paused { why: Why::OwnFront, at: 0 });
        assert!(r.results.is_empty() && r.events.is_empty(), "nothing typed, nothing refused");
        let o = own.clone();
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, move |e| e.front = Some(o.clone()));
        assert_eq!(r.flow, Flow::Paused { why: Why::OwnFront, at: 0 });
        assert!(r.events.is_empty());
        // The keyboard's owner is Brenda (her notch took focus): a pause too.
        let r = run(&[act("1", "type", json!({ "text": "x" }))], None, move |e| {
            e.focused = Some(text_field_of(1));
            e.apps.push(own.clone());
        });
        assert_eq!(r.flow, Flow::Paused { why: Why::OwnFront, at: 0 });
        assert_eq!(serde_json::to_value(Why::OwnFront).unwrap(), json!("own_front"));
    }

    fn text_field_of(pid: i32) -> guard::Focus {
        focus("AXTextField", "", false, Some(pid))
    }

    /// L.1: a click ON Brenda's island is still refused, whatever is in front.
    #[test]
    fn click_on_island_still_refused() {
        let r = run(&[act("1", "left_click", json!({ "coordinate": [10, 10] }))], None, |e| {
            e.owner = Some(AppInfo { pid: 1, name: "Brenda".into(), bundle_id: Some(crate::look::OWN_BUNDLE_ID.into()) })
        });
        assert_eq!(err(&r.results[0]), NOT_EXECUTED_OWN);
        assert!(r.events.iter().all(|e| !matches!(e, Synth::Down { .. })), "nothing pressed");
    }

    #[test]
    fn front_typing_never_presses_return_or_tab() {
        assert_eq!(front_typing("one\ntwo\tthree\r\nfour"), "one two three  four");
        assert!(type_pieces(&front_typing("a\nb")).iter().all(|p| matches!(p, TypePiece::Units(_))));
    }
}
