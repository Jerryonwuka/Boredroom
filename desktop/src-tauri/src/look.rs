//! Brenda Look: "press the two buttons, ask Brenda a question about what I'm pointing at on my screen and she helps me
//! out with it" (owner decisions, 11 October 2026), made instant and whole-screen in phase 2 (owner request,
//! 12 October 2026: "the preview step is a bad experience"; "it must see the desktop and anything under the pointer").
//!
//! Hold Control+Command (only those two, for about 0.3 s) and Brenda takes the screen your pointer is on (the whole
//! display, desktop included, never-look apps blanked by ScreenCaptureKit's own filter and hatched), a sharp close-up
//! round the pointer, and listens while the keys are held (whisper on this Mac). Let go and the question goes at once
//! with both pictures (or, with "Show me the picture first" on, after the person presses Send on the preview). Her
//! answer streams back (`text`, `say`, `point`, `propose`, `done`); she can point at things (`companion.rs`) and, only
//! when the person's own words asked for something to be done, propose it (`act.rs`), which then needs a yes. The
//! pictures stay in memory for a minute after the answer for follow-ups, then are wiped.
//!
//! What this file promises, and how:
//! - No keyboard access. The keys are found by POLLING the modifier state (`CGEventSourceFlagsState`, combined session
//!   state, about 30 times a second while screen help is on and available), never an event tap, so Brenda needs neither
//!   Input Monitoring nor Accessibility. Apple's documentation for `CGEventSourceFlagsState`,
//!   `CGEventSourceSecondsSinceLastEventType` and `NSEvent.modifierFlags` names no permission (checked 11 October 2026);
//!   Input Monitoring governs event taps, which Brenda never creates. Carbon hotkeys (the global-shortcut plugin) cannot
//!   register a modifier-only chord, which is why this does not use them.
//! - Guards against accidental looks: exactly Control+Command (Shift, Option or Fn cancel it; Caps Lock is ignored), held
//!   for `LOOK_KEYS.hold_ms`, no other key pressed meanwhile, 1.5 s between looks, nothing while the Mac is locked; a
//!   look whose front app changed before the keys came up is cancelled (Control+Command+Space opens the emoji picker,
//!   Control+Command+Q locks the screen, Control+Command+F toggles full screen).
//! - First the task state (B.2, owner rule, 12 October 2026): while a task runs, holding the keys STOPS it; while a
//!   question waits, the hold is the ANSWER (no picture). Only otherwise is it a look.
//! - Never: the never-look apps (`FIXED_NEVER_LOOK`, not removable; the workspace's list; the person's own list), which
//!   are left out of the picture and hatched, Brenda's own windows, anything during a live Boredroom call or while the
//!   screen looks shared.
//! - A look's request is the person's own words: their spoken words as Rust heard them (`via: voice`), or words typed
//!   with a real press (`via: typed`). Nothing else ever sends a look.
//! - The pictures live in memory only (`Capture`, `Pic`, wiped on drop), and go only to Boredroom's look route, built
//!   and sent here (`look_send`); the generic `api` command refuses that route and the act routes.
//! - The opt-ins are stored on this Mac (`brenda.json`) and are the signed-in person's: signing out clears them. The
//!   page tells Boredroom which are on, for the person alone (owner request, 12 October 2026, companion2-spec 0b.2);
//!   Rust reports nothing itself.
//! - Phase 3 (owner request, 12 October 2026): `LookStatus` v3 says whether she is by the pointer and why not; one
//!   setup turns everything on under consent 3 (`help.rs`); a look tells Boredroom it can take plans
//!   (`abilities.plans`), whether clicking and typing are allowed (`abilities.accessibility`), and the folders the
//!   person points at (with file work on, by name only).
//! - Brenda and her helpers (owner brief, 12 October 2026; helpers-spec J, P.6): `LookStatus` v4 reports the front desk
//!   (`front`); a look the front desk sends for a question carries `front: 1` and a lane (`auto`, `now` or `think`), so
//!   Boredroom answers on the quick model or thinks harder; the person's app is found even when the notch is in front
//!   (`capture::person_front`, L.1); and the front desk's and jobs' routes are Rust's only (`path_allowed`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

use crate::capture::{self, AppMeta, DisplayShot, Exclude, LookGeometry, Pic};
use crate::filework::{self, Candidate};
use crate::{act, companion, voice, ApiError, AppState};

// ---- the keys ------------------------------------------------------------------------------------------------------

#[cfg_attr(not(test), allow(dead_code))] // Caps Lock is ignored; named for the tests
pub const FLAG_CAPS_LOCK: u64 = 0x0001_0000;
pub const FLAG_SHIFT: u64 = 0x0002_0000;
pub const FLAG_CONTROL: u64 = 0x0004_0000;
pub const FLAG_OPTION: u64 = 0x0008_0000;
pub const FLAG_COMMAND: u64 = 0x0010_0000;
pub const FLAG_FN: u64 = 0x0080_0000;
/// Modifiers that must NOT be down. Caps Lock (`FLAG_CAPS_LOCK`) is a toggle, so it is ignored.
const OTHER: u64 = FLAG_SHIFT | FLAG_OPTION | FLAG_FN;

pub struct LookKeys {
    pub flags: u64,
    pub name: &'static str,
    pub symbols: &'static str,
    pub hold_ms: u64,
}

/// Owner decision, 11 October 2026: "not Control+Command, it's too long; two easy buttons, Control and Command".
/// Change here only. Never Control+Option: that is VoiceOver's key for screen-reader users (and Clicky's).
pub const LOOK_KEYS: LookKeys = LookKeys { flags: FLAG_CONTROL | FLAG_COMMAND, name: "Control+Command", symbols: "⌃ ⌘", hold_ms: 300 };
/// At least this long between the starts of two looks.
const COOLDOWN_MS: u64 = 1_500;
/// The modifier poll while armed, and the sleep while not (or while the Mac is locked).
const TICK_ARMED: Duration = Duration::from_millis(33);
const TICK_IDLE: Duration = Duration::from_secs(1);

/// One reading of the keyboard's modifier state.
#[derive(Clone, Copy, Debug)]
pub struct Tick {
    pub now_ms: u64,
    pub flags: u64,
    /// How long ago a key (not a modifier) last went down, when the system says (None: nothing useful).
    pub key_age_ms: Option<u64>,
    pub locked: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelReason {
    Keys,
    FrontChanged,
    Locked,
    Timeout,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChordEvent {
    Start,
    Cancel(CancelReason),
    Release,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ChordState {
    Idle,
    Arming { since: u64 },
    Holding { since: u64 },
    /// A cancelled or used chord must be fully released before the next one.
    WaitRelease,
}

/// The look keys as a pure state machine (B.2), fed by the poll.
pub struct ChordMachine {
    keys: u64,
    hold_ms: u64,
    state: ChordState,
    last_start: Option<u64>,
}

impl ChordMachine {
    pub fn new(keys: &LookKeys) -> Self {
        ChordMachine { keys: keys.flags, hold_ms: keys.hold_ms, state: ChordState::Idle, last_start: None }
    }

    fn key_since(t: &Tick, since: u64) -> bool {
        t.key_age_ms.is_some_and(|age| age < t.now_ms.saturating_sub(since))
    }

    pub fn holding(&self) -> bool {
        matches!(self.state, ChordState::Holding { .. })
    }

    /// Screen help went off (or unavailable) mid-chord: a hold in progress is cancelled, the rest forgotten.
    pub fn disarm(&mut self) -> Option<ChordEvent> {
        let was = self.holding();
        self.state = ChordState::Idle;
        was.then_some(ChordEvent::Cancel(CancelReason::Keys))
    }

    pub fn step(&mut self, t: Tick) -> Option<ChordEvent> {
        let both = t.flags & self.keys;
        let exact = both == self.keys && t.flags & OTHER == 0;
        let none = both == 0;
        match self.state {
            ChordState::Idle => {
                if exact && !t.locked {
                    self.state = ChordState::Arming { since: t.now_ms };
                }
                None
            }
            ChordState::Arming { since } => {
                if t.locked || Self::key_since(&t, since) {
                    self.state = ChordState::WaitRelease;
                } else if !exact {
                    self.state = if none { ChordState::Idle } else { ChordState::WaitRelease };
                } else if t.now_ms.saturating_sub(since) >= self.hold_ms
                    && self.last_start.is_none_or(|l| t.now_ms.saturating_sub(l) >= COOLDOWN_MS)
                {
                    self.last_start = Some(t.now_ms);
                    self.state = ChordState::Holding { since: t.now_ms };
                    return Some(ChordEvent::Start);
                }
                None
            }
            ChordState::Holding { since } => {
                if t.locked {
                    self.state = ChordState::WaitRelease;
                    return Some(ChordEvent::Cancel(CancelReason::Locked));
                }
                if t.flags & OTHER != 0 || Self::key_since(&t, since) {
                    self.state = ChordState::WaitRelease;
                    return Some(ChordEvent::Cancel(CancelReason::Keys));
                }
                if both != self.keys {
                    self.state = if none { ChordState::Idle } else { ChordState::WaitRelease };
                    return Some(ChordEvent::Release);
                }
                None
            }
            ChordState::WaitRelease => {
                if none {
                    self.state = ChordState::Idle;
                }
                None
            }
        }
    }
}

/// `CGEventSourceSecondsSinceLastEventType` in milliseconds, or None when it says nothing useful (B.2).
pub fn age_ms(seconds: f64) -> Option<u64> {
    (seconds.is_finite() && seconds >= 0.0 && seconds < 1_000_000.0).then(|| (seconds * 1000.0) as u64)
}

// ---- windows -------------------------------------------------------------------------------------------------------

/// A rectangle in global points, origin at the top-left of the main display (as the window list gives them).
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// One row of the on-screen window list (front to back). Titles are never read.
#[derive(Clone, Debug, PartialEq)]
pub struct WindowInfo {
    pub id: u32,
    pub pid: i32,
    pub layer: i64,
    pub alpha: f64,
    pub bounds: Bounds,
    pub owner_name: String,
}

// ---- never look ----------------------------------------------------------------------------------------------------

pub struct FixedApp {
    pub name: &'static str,
    #[allow(dead_code)] // kept so the table reads as the contract's (and the server's) does
    pub category: &'static str,
    pub ids: &'static [&'static str],
    pub prefixes: &'static [&'static str],
    pub names: &'static [&'static str],
}

const fn fixed(name: &'static str, category: &'static str, ids: &'static [&'static str], prefixes: &'static [&'static str], names: &'static [&'static str]) -> FixedApp {
    FixedApp { name, category, ids, prefixes, names }
}

/// Apps Brenda never looks at, whatever anyone sets (look-spec B.4; the same table is `FIXED_NEVER_LOOK` in
/// `src/lib/screen-help.ts`: change both). Bundle ids given only as prefixes are best-known, not confirmed.
pub const FIXED_NEVER_LOOK: &[FixedApp] = &[
    fixed("1Password", "password", &["com.1password.1password", "com.agilebits.onepassword7", "com.agilebits.onepassword-osx", "com.agilebits.onepassword4"], &["com.1password.", "com.agilebits.onepassword"], &["1Password", "1Password 7"]),
    fixed("Bitwarden", "password", &["com.bitwarden.desktop"], &["com.bitwarden."], &["Bitwarden"]),
    fixed("Keychain Access", "password", &["com.apple.keychainaccess"], &[], &["Keychain Access"]),
    fixed("Passwords", "password", &["com.apple.Passwords"], &[], &["Passwords"]),
    fixed("LastPass", "password", &["com.lastpass.LastPass"], &["com.lastpass."], &["LastPass"]),
    fixed("Dashlane", "password", &[], &["com.dashlane."], &["Dashlane"]),
    fixed("KeePassXC", "password", &["org.keepassxc.keepassxc"], &[], &["KeePassXC"]),
    fixed("Enpass", "password", &["in.sinew.Enpass-Desktop"], &["in.sinew.enpass"], &["Enpass"]),
    fixed("Proton Pass", "password", &[], &["me.proton.pass"], &["Proton Pass"]),
    fixed("NordPass", "password", &[], &["com.nordsec.nordpass", "com.nordpass."], &["NordPass"]),
    fixed("Keeper", "password", &[], &["com.callpod.keepermac", "com.keepersecurity."], &["Keeper", "Keeper Password Manager"]),
    fixed("Sign-in and password prompts", "password", &["com.apple.SecurityAgent", "com.apple.loginwindow", "com.apple.ScreenSaver.Engine"], &["com.apple.LocalAuthentication"], &[]),
    fixed("Messages", "messaging", &["com.apple.MobileSMS"], &[], &["Messages"]),
    fixed("WhatsApp", "messaging", &["net.whatsapp.WhatsApp", "desktop.WhatsApp"], &[], &["WhatsApp"]),
    fixed("Signal", "messaging", &["org.whispersystems.signal-desktop"], &[], &["Signal"]),
    fixed("Telegram", "messaging", &["ru.keepcoder.Telegram", "org.telegram.desktop"], &[], &["Telegram"]),
    fixed("Slack", "messaging", &["com.tinyspeck.slackmacgap"], &[], &["Slack"]),
    fixed("Microsoft Teams", "calls", &["com.microsoft.teams2", "com.microsoft.teams"], &[], &["Microsoft Teams"]),
    fixed("Discord", "messaging", &["com.hnc.Discord"], &[], &["Discord"]),
    fixed("Messenger", "messaging", &[], &["com.facebook.archon"], &["Messenger"]),
    fixed("WeChat", "messaging", &["com.tencent.xinWeChat"], &[], &["WeChat"]),
    fixed("Element", "messaging", &["im.riot.app"], &[], &["Element"]),
    fixed("Viber", "messaging", &["com.viber.osx"], &[], &["Viber"]),
    fixed("LINE", "messaging", &["jp.naver.line.mac"], &[], &["LINE"]),
    fixed("Skype", "calls", &["com.skype.skype"], &[], &["Skype"]),
    fixed("Wire", "messaging", &["com.wearezeta.zclient.mac"], &[], &["Wire"]),
    fixed("Zoom", "calls", &["us.zoom.xos"], &[], &["Zoom", "zoom.us"]),
    fixed("FaceTime", "calls", &["com.apple.FaceTime"], &[], &["FaceTime"]),
    fixed("Webex", "calls", &["Cisco-Systems.Spark", "com.webex.meetingmanager"], &[], &["Webex"]),
    fixed("GoTo Meeting", "calls", &["com.logmein.GoToMeeting"], &[], &["GoTo Meeting"]),
    fixed("System Settings", "system", &["com.apple.systempreferences"], &[], &["System Settings", "System Preferences"]),
    fixed("Brenda", "system", &["cc.boredroom.brenda"], &[], &[]),
];

/// Brenda's own bundle id: her windows are never looked at.
pub const OWN_BUNDLE_ID: &str = "cc.boredroom.brenda";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuleSource {
    Fixed,
    Workspace,
    You,
}

/// A never-look rule from the workspace or the person (sent by the page from the desktop state).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub name: String,
    #[serde(default)]
    pub bundle_id: Option<String>,
    pub source: RuleSource,
}

/// Who owns the window: its bundle id when known, and every name it goes by (the app's name and the window list's
/// owner name). A name match can only make her refuse, never look.
#[derive(Clone, Debug, Default)]
pub struct AppId {
    pub bundle_id: Option<String>,
    pub names: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NeverMatch {
    pub source: RuleSource,
    pub name: String,
}

fn same(a: &str, b: &str) -> bool {
    !a.trim().is_empty() && a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Whether the app is on a never-look list (B.4): the fixed list first, then the workspace's, then the person's.
pub fn never_look(app: &AppId, rules: &[Rule]) -> Option<NeverMatch> {
    let id = app.bundle_id.as_deref().map(|s| s.trim().to_lowercase()).filter(|s| !s.is_empty());
    let named = |n: &str| app.names.iter().any(|x| same(x, n));
    for f in FIXED_NEVER_LOOK {
        let by_id = id.as_deref().is_some_and(|id| {
            f.ids.iter().any(|x| x.to_lowercase() == id) || f.prefixes.iter().any(|p| id.starts_with(&p.to_lowercase()))
        });
        if by_id || f.names.iter().any(|n| named(n)) {
            return Some(NeverMatch { source: RuleSource::Fixed, name: f.name.to_string() });
        }
    }
    for source in [RuleSource::Workspace, RuleSource::You] {
        for r in rules.iter().filter(|r| r.source == source) {
            let by_id = match (r.bundle_id.as_deref().map(str::trim).filter(|s| !s.is_empty()), id.as_deref()) {
                (Some(rid), Some(id)) => rid.to_lowercase() == id,
                _ => false,
            };
            if by_id || named(&r.name) {
                return Some(NeverMatch { source, name: r.name.trim().to_string() });
            }
        }
    }
    None
}

// ---- the picture ---------------------------------------------------------------------------------------------------

pub const PREVIEW_W: f64 = 720.0;
pub const PREVIEW_H: f64 = 440.0;
pub const PREVIEW_QUALITY: f64 = 0.7;
/// The marker: a white ring under an orange one, centred on the pointer, no fill (A.3).
pub const MARKER_RADIUS: f64 = 15.0;
pub const MARKER_WHITE_WIDTH: f64 = 4.0;
pub const MARKER_ORANGE_WIDTH: f64 = 2.0;
pub const MARKER_ORANGE: (f64, f64, f64) = (1.0, 108.0 / 255.0, 2.0 / 255.0); // #FF6C02

/// The size that fits `w` × `h` inside `max_w` × `max_h` without enlarging.
pub fn fit_within(w: u32, h: u32, max_w: f64, max_h: f64) -> (u32, u32) {
    let s = 1f64.min(max_w / w as f64).min(max_h / h as f64);
    (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Point {
    pub x: u32,
    pub y: u32,
}

/// Cocoa's mouse location (bottom-left of the main display, y up) in top-left global points.
pub fn cocoa_to_top_left(x: f64, y: f64, main_height: f64) -> (f64, f64) {
    (x, main_height - y)
}

/// The topmost window at a global point that a person sees there: an ordinary window (layer 0) or the desktop's own
/// (negative layers), never one of Brenda's (B.2 step 3). The window list is front to back.
pub fn window_at(list: &[WindowInfo], p: (f64, f64), own_pid: i32) -> Option<&WindowInfo> {
    list.iter().find(|w| {
        w.pid != own_pid
            && w.alpha > 0.0
            && (w.layer == 0 || w.layer < 0)
            && p.0 >= w.bounds.x
            && p.1 >= w.bounds.y
            && p.0 < w.bounds.x + w.bounds.w
            && p.1 < w.bounds.y + w.bounds.h
    })
}

/// A `point` line (B.3.3) in global points (B.5): picture pixels through the picture's own geometry; up to 8 pixels
/// outside counts as the edge, further is dropped; a point becomes a 36-point square; clamped inside the display.
pub fn point_to_global(line: &Value, g: &LookGeometry) -> Option<Bounds> {
    let picture = line.get("picture")?.as_str()?;
    let num = |k: &str| line.get(k).and_then(|v| v.as_f64()).filter(|v| v.is_finite());
    let (x, y) = (num("x")?, num("y")?);
    let (w, h) = (num("width").unwrap_or(0.0).max(0.0), num("height").unwrap_or(0.0).max(0.0));
    let (area, pw, ph) = match picture {
        "screen" => (g.display, g.screen_w as f64, g.screen_h as f64),
        "closeup" => {
            let c = g.crop?;
            (c.area, c.w as f64, c.h as f64)
        }
        _ => return None,
    };
    if pw <= 0.0 || ph <= 0.0 || x < -8.0 || y < -8.0 || x > pw + 8.0 || y > ph + 8.0 {
        return None;
    }
    let (x, y) = (x.clamp(0.0, pw), y.clamp(0.0, ph));
    let sx = area.w / pw;
    let sy = area.h / ph;
    let (mut gx, mut gy, mut gw, mut gh) = (area.x + x * sx, area.y + y * sy, w.min(pw) * sx, h.min(ph) * sy);
    if gw <= 0.0 || gh <= 0.0 {
        gx -= 18.0;
        gy -= 18.0;
        gw = 36.0;
        gh = 36.0;
    }
    let d = g.display;
    gw = gw.min(d.w);
    gh = gh.min(d.h);
    gx = gx.clamp(d.x, d.x + d.w - gw);
    gy = gy.clamp(d.y, d.y + d.h - gh);
    Some(Bounds { x: gx, y: gy, w: gw, h: gh })
}

/// The snap rule (B.5): an accessibility element's frame is used when it contains the point and covers at most 40 % of
/// the display.
pub fn snap_ok(frame: Bounds, centre: (f64, f64), display: Bounds) -> bool {
    frame.w > 0.0
        && frame.h > 0.0
        && centre.0 >= frame.x
        && centre.1 >= frame.y
        && centre.0 <= frame.x + frame.w
        && centre.1 <= frame.y + frame.h
        && frame.w * frame.h <= 0.4 * display.w * display.h
}

// ---- live calls ----------------------------------------------------------------------------------------------------

/// How long the page's report of a Boredroom call is trusted (B.5).
const CALL_FRESH_MS: u64 = 15_000;

#[derive(Debug, PartialEq, Eq)]
pub enum CallCheck {
    Live,
    Clear,
    Stale,
}

/// `state` = (live, how long ago it was reported). Live refuses at once, however old; an old "clear" is asked again.
pub fn call_check(state: Option<(bool, u64)>, age_limit_ms: u64) -> CallCheck {
    match state {
        Some((true, _)) => CallCheck::Live,
        Some((false, age)) if age <= age_limit_ms => CallCheck::Clear,
        _ => CallCheck::Stale,
    }
}

/// `GET /calls/now`'s answer: live when the person is in a call or one rings for them.
pub fn live_of(calls_now: &Value) -> bool {
    let active = calls_now.get("active").is_some_and(|a| !a.is_null() && a != &Value::Bool(false));
    let ringing = calls_now.get("ringing").and_then(|r| r.as_array()).is_some_and(|r| !r.is_empty());
    active || ringing
}

// ---- real presses --------------------------------------------------------------------------------------------------

/// How recent a press must be (B.11.6).
const PRESS_WINDOW_S: f64 = 1.5;

/// Whether a command came from the person's own press: a left click on the island in the last 1.5 s, or a key while
/// the notch has focus. When the system says nothing useful about either, being over the island or focused is enough.
pub fn real_press(mouse_age_s: Option<f64>, key_age_s: Option<f64>, cursor_on_island: bool, notch_focused: bool) -> bool {
    if mouse_age_s.is_none() && key_age_s.is_none() {
        return cursor_on_island || notch_focused;
    }
    mouse_age_s.is_some_and(|a| a <= PRESS_WINDOW_S) && cursor_on_island || key_age_s.is_some_and(|a| a <= PRESS_WINDOW_S) && notch_focused
}

pub fn is_real_press(app: &AppHandle) -> bool {
    let mouse = capture::seconds_since_mouse_down().filter(|s| age_ms(*s).is_some());
    let key = capture::seconds_since_key_down().filter(|s| age_ms(*s).is_some());
    let focused = app.get_webview_window("notch").and_then(|w| w.is_focused().ok()).unwrap_or(false);
    real_press(mouse, key, crate::island::cursor_on_island(app), focused)
}

/// A press that is the person's: real, and no event of Brenda's own in the last 1.5 s (owner rule, 12 October 2026: a
/// click Brenda made can never count as the person's).
pub fn is_person_press(app: &AppHandle) -> bool {
    act::press_ok(is_real_press(app), crate::input::seconds_since_post())
}

/// How long ago the person's press was (ms), for `request.ageMs`.
fn press_age_ms() -> u64 {
    let m = capture::seconds_since_mouse_down().and_then(age_ms);
    let k = capture::seconds_since_key_down().and_then(age_ms);
    m.into_iter().chain(k).min().unwrap_or(0).min(120_000)
}

// ---- the generic api command ---------------------------------------------------------------------------------------

/// Whether the generic `api` command may call `path`: Boredroom API paths only, and never the look route or the act
/// routes, which only Rust's own calls reach (`look_send`, `act.rs`; B.11, owner rule 12 October 2026: the page can
/// never confirm a task).
///
/// The path is checked the way it is sent (review, 11 October 2026: `/assistant/./look`, `/assistant/%2e/look` and
/// `/assistant/x/../look` passed the old check, and reqwest's URL parser then took the dot segments out): it is parsed
/// with the same WHATWG parser reqwest uses (dot segments removed, `\` read as `/`, tabs and newlines dropped), then each
/// segment is percent-decoded until it stops changing. A segment that is still `.` or `..` after decoding is refused
/// outright, since a server or proxy further on may decode and remove it.
pub fn path_allowed(path: &str) -> bool {
    if !path.starts_with("/api/") {
        return false;
    }
    let Ok(url) = reqwest::Url::parse(&format!("https://boredroom.invalid{path}")) else { return false };
    if url.host_str() != Some("boredroom.invalid") || !url.path().starts_with("/api/") {
        return false;
    }
    let mut parts: Vec<String> = Vec::new();
    for seg in url.path_segments().into_iter().flatten() {
        let mut s = seg.to_string();
        for _ in 0..4 {
            let d = percent_decode(&s);
            if d == s {
                break;
            }
            s = d;
        }
        for p in s.to_lowercase().split(['/', '\\']) {
            let p = p.trim_matches(|c: char| c.is_whitespace() || c.is_control());
            if p.is_empty() {
                continue;
            }
            if p == "." || p == ".." {
                return false;
            }
            parts.push(p.to_string());
        }
    }
    if parts.windows(2).any(|w| w[0] == "assistant" && (w[1] == "look" || w[1] == "act" || w[1] == "jobs")) {
        return false;
    }
    // One sign-in (owner request, 24 October 2026): the window's sign-in and handoff routes are Rust's own (webauth.rs),
    // so the notch's page can never mint a handoff code or redeem a sign-in code.
    if parts.len() >= 3 && parts[0] == "api" && parts[1] == "desktop" && parts[2] == "app" {
        return false;
    }
    // The front desk (helpers-spec O.1): Rust's only, except the page's `/assistant/front/line` (a speech offer).
    for (i, w) in parts.windows(2).enumerate() {
        if w[0] == "assistant" && w[1] == "front" && !(parts.len() == i + 3 && parts[i + 2] == "line") {
            return false;
        }
    }
    true
}

/// `%XX` decoded once (anything else kept as it is), as text.
pub(crate) fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(a), Some(b)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((a * 16 + b) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---- status --------------------------------------------------------------------------------------------------------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LookStatus {
    /// 2: this Rust takes v2 looks (instant, two pictures, streamed answers) and tasks.
    pub v: u8,
    pub supported: bool,
    pub unsupported_reason: Option<&'static str>,
    pub permission: &'static str,
    pub on: bool,
    pub on_at: Option<u64>,
    pub keys: &'static str,
    pub keys_label: &'static str,
    pub armed: bool,
    pub available: bool,
    /// 0 never, 1 phase 1's consent (the update card opens before the next look), 2 today's.
    pub consent: u32,
    /// "Show me the picture first".
    pub preview: bool,
    /// "Show Brenda by my pointer".
    pub companion: bool,
    /// Whether she is by the pointer now, and why not (companion2-spec F; v3).
    pub companion_shown: bool,
    pub companion_why: &'static str,
    /// The front desk (helpers-spec P.6; v4): `{ ready, checkEvery, clickConsent, folders, apps, jobLive }`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub front: Option<Value>,
}

/// `LookStatus.permission`: granted when the preflight says so, denied when the system prompt was shown before on this
/// Mac and it still says no, else unknown.
pub fn permission_label(granted: bool, asked: bool) -> &'static str {
    if granted {
        "granted"
    } else if asked {
        "denied"
    } else {
        "unknown"
    }
}

/// The consent version (0b.2): every phase 1 opt-in reads as 1 until the person keeps it on under the new words; 3 is
/// the one setup card's (companion2-spec 0b.1).
pub fn consent_of(on: bool, stored: u32) -> u32 {
    if stored >= 3 {
        3
    } else if stored >= 2 {
        2
    } else if on {
        1
    } else {
        0
    }
}

// ---- the picture in memory -----------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Keys,
    Button,
    FollowUp,
    Drop,
}

/// A look's pictures and what was under the pointer, held until sent (or 120 s), then for a minute after the answer for
/// follow-ups (`Held`). Never printed, never written anywhere; every picture's bytes are zeroed when dropped.
pub struct Capture {
    pub id: String,
    pub screen: Option<Pic>,
    pub crop: Option<Pic>,
    pub geometry: Option<LookGeometry>,
    pub hidden: Vec<String>,
    /// The app under the pointer (None: "your screen", the Look button or a drop).
    pub app_name: Option<String>,
    pub bundle_id: Option<String>,
    pub desktop: bool,
    pub source: Source,
    pub taken: Instant,
    pub candidates: Vec<Candidate>,
    pub front_pid: Option<i32>,
    pub pointer: Option<(f64, f64)>,
}

impl Capture {
    /// A copy for another request with the same pictures (a follow-up); the copy wipes itself too.
    pub fn duplicate(&self, id: String, source: Source) -> Capture {
        Capture {
            id,
            screen: self.screen.as_ref().map(Pic::duplicate),
            crop: self.crop.as_ref().map(Pic::duplicate),
            geometry: self.geometry,
            hidden: self.hidden.clone(),
            app_name: self.app_name.clone(),
            bundle_id: self.bundle_id.clone(),
            desktop: self.desktop,
            source,
            taken: Instant::now(),
            candidates: self.candidates.clone(),
            front_pid: self.front_pid,
            pointer: self.pointer,
        }
    }

    fn origin(&self) -> act::Origin {
        act::Origin { display: self.geometry.map(|g| (g.display_id, g.display)), candidates: self.candidates.clone(), front_pid: self.front_pid }
    }
}

/// Overwrites a buffer with zeros in a way the compiler keeps.
pub fn wipe(buf: &mut [u8]) {
    buf.fill(0);
    std::sync::atomic::compiler_fence(Ordering::SeqCst);
}

#[cfg(test)]
thread_local! {
    static WIPED: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

impl Drop for Capture {
    fn drop(&mut self) {
        // The pictures wipe themselves (`Pic`); counted here for the tests.
        #[cfg(test)]
        WIPED.with(|w| w.set(w.get() + 1));
    }
}

/// How long a picture waits for Send (the preview card).
pub const KEEP_FOR: Duration = Duration::from_secs(120);
/// How long the pictures stay for follow-ups after an answer (A.12).
pub const FOLLOW_UP_FOR: Duration = Duration::from_secs(60);

/// The store: at most one picture awaiting its question.
#[derive(Default)]
pub struct Store {
    held: Option<Capture>,
}

impl Store {
    /// Keeps a new picture; the one held before (if any) is dropped and wiped.
    pub fn put(&mut self, c: Capture) {
        self.held = Some(c);
    }
    /// Takes the picture out if it is the one asked for.
    pub fn take(&mut self, id: &str) -> Option<Capture> {
        if self.held.as_ref().is_some_and(|c| c.id == id) {
            self.held.take()
        } else {
            None
        }
    }
    /// Drops the held picture if it has waited longer than `KEEP_FOR`, and says which one.
    pub fn expire(&mut self, now: Instant) -> Option<String> {
        if self.held.as_ref().is_some_and(|c| now.saturating_duration_since(c.taken) > KEEP_FOR) {
            return self.held.take().map(|c| c.id.clone());
        }
        None
    }
    pub fn clear(&mut self) {
        self.held = None;
    }
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn held_id(&self) -> Option<&str> {
        self.held.as_ref().map(|c| c.id.as_str())
    }
}

/// The pictures kept for a minute after an answer.
pub struct Held {
    pub capture: Capture,
    pub until: Instant,
}

/// Whether held pictures are past their minute (kept while a proposal from them waits for its answer).
pub fn held_expired(until: Instant, now: Instant, keep: bool) -> bool {
    !keep && now >= until
}

// ---- events --------------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Refusal {
    Permission,
    OnCall,
    CallUnknown,
    NoWindow,
    NeverLook,
    Busy,
    Unsupported,
    NotAvailable,
    /// The page has not passed on the workspace's rules for 120 s (Boredroom can't be reached): she won't look, and
    /// says why, rather than blaming the workspace (review, 11 October 2026).
    Offline,
    /// The screen looks shared (B.4.7): she doesn't look.
    Sharing,
    /// A phase 1 opt-in: the updated consent opens instead of a look (0b.2).
    ConsentUpdate,
    /// A question is waiting for its answer (A.6.4).
    AnswerFirst,
    /// The person's front window, or the window under the pointer, is Boredroom's own: she never looks at it (owner
    /// request, 24 October 2026).
    OwnWindow,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AppName {
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppFull {
    pub name: String,
    pub bundle_id: Option<String>,
}

/// `brenda://look` (phase 1's phases, plus v2's: B.11).
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum LookEvent {
    Looking {
        look_id: String,
        source: Source,
        app: AppName,
        listening: bool,
        /// Why a keys look isn't listening (review, 11 October 2026): "off", "needs-model" or "busy", so the card can
        /// say to type the question instead of losing what the person said. Absent when listening, or for the button.
        #[serde(skip_serializing_if = "Option::is_none")]
        mic: Option<&'static str>,
        /// Over the desktop ("Looking at your desktop…").
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        desktop: bool,
    },
    Preview { look_id: String, source: Source, app: AppFull, image: String, width: u32, height: u32, pointer: Option<Point> },
    Released { look_id: String },
    Refused {
        reason: Refusal,
        #[serde(skip_serializing_if = "Option::is_none")]
        app: Option<AppName>,
        #[serde(skip_serializing_if = "Option::is_none")]
        source: Option<RuleSource>,
    },
    Cancelled { look_id: String, reason: CancelReason },
    Error {
        #[serde(skip_serializing_if = "Option::is_none")]
        look_id: Option<String>,
        message: String,
    },
    Sending { look_id: String },
    Text { look_id: String, d: String },
    Say { look_id: String, text: String, speech: Value },
    Point { look_id: String, label: String },
    Held { look_id: String, until: u64 },
    Dropped {},
    /// The `done` result of a stream Rust started itself (a new request from an answer, 0.5), which no `look_send`
    /// promise is waiting for.
    Result { look_id: String, result: Value },
}

fn emit(app: &AppHandle, e: LookEvent) {
    let _ = app.emit("brenda://look", e);
}

fn refuse(app: &AppHandle, reason: Refusal) {
    emit(app, LookEvent::Refused { reason, app: None, source: None });
}

// ---- state ---------------------------------------------------------------------------------------------------------

/// The page's last word on the workspace's rules (from the desktop state), trusted for 120 s.
struct Rules {
    available: bool,
    never_look: Vec<Rule>,
    at: Instant,
    /// `look.act.available` (D.4): on-screen actions and file work allowed here.
    act_available: bool,
    /// `look.v` (D.4): 2 when the server takes v2 looks.
    server_v: u32,
}

/// The page's `front` in `set_look_rules` (helpers-spec P.2): the server has migration 0060, and the person's "Check with
/// me before every task".
#[derive(Deserialize, Clone, Copy, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FrontIn {
    #[serde(default)]
    pub ready: bool,
    #[serde(default)]
    pub check_every: bool,
}
const RULES_FRESH: Duration = Duration::from_secs(120);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    /// The checks and the capture are under way.
    Checking,
    /// The checks passed: `looking` went out (and the microphone may be open).
    Live,
    /// A check failed: nothing was captured, the keys' release does nothing.
    Refused,
}

/// The look in progress (from Start until the next one).
struct Pending {
    id: String,
    gen: u64,
    source: Source,
    phase: Phase,
    /// The keys came up while the checks ran.
    released: bool,
    released_at: Option<Instant>,
    /// The frontmost app when the look started.
    front_pid: Option<i32>,
    mic: bool,
}

/// What the current hold of her keys is (B.2's first step).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
enum HoldKind {
    #[default]
    None,
    Look,
    Answer,
    Stop,
}

#[derive(Default)]
pub struct Look {
    store: Mutex<Store>,
    pending: Mutex<Option<Pending>>,
    rules: Mutex<Option<Rules>>,
    /// The page's last report of a Boredroom call: (live, when).
    call: Mutex<Option<(bool, Instant)>>,
    gen: AtomicU64,
    sending: AtomicBool,
    ids: AtomicU64,
    /// Rust's own transcript of a look's words: (look id, words, when the keys came up).
    heard: Mutex<Option<(String, String, Instant)>>,
    held: Mutex<Option<Held>>,
    keep_held: AtomicBool,
    hold: Mutex<HoldKind>,
    last_messages: Mutex<Vec<Value>>,
}

/// A fresh look id: 16 hex characters, unpredictable enough to match a picture to its request.
fn new_id(look: &Look) -> String {
    use std::hash::{BuildHasher, Hasher};
    let n = look.ids.fetch_add(1, Ordering::SeqCst);
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u64(n);
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!("{:016x}", h.finish())
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn rules_fresh(look: &Look) -> Option<(bool, Vec<Rule>)> {
    look.rules.lock().unwrap().as_ref().filter(|r| r.at.elapsed() <= RULES_FRESH).map(|r| (r.available, r.never_look.clone()))
}

/// The never-look rules as last passed on (empty when none).
pub fn current_rules(app: &AppHandle) -> Vec<Rule> {
    app.try_state::<Look>().and_then(|l| l.rules.lock().unwrap().as_ref().map(|r| r.never_look.clone())).unwrap_or_default()
}

/// What a picture leaves out (B.2 step 4): Brenda's own windows (not hatched), and every never-look app (hatched).
pub fn exclusion(rules: &[Rule], own_pid: i32) -> impl Fn(&AppMeta) -> Exclude + '_ {
    move |m: &AppMeta| {
        if m.pid == own_pid || m.bundle_id.is_some_and(|b| b.eq_ignore_ascii_case(OWN_BUNDLE_ID)) {
            return Exclude::Own;
        }
        match never_look(&AppId { bundle_id: m.bundle_id.map(String::from), names: vec![m.name.to_string()] }, rules) {
            Some(n) => Exclude::Hidden(if n.source == RuleSource::Fixed && !m.name.trim().is_empty() { m.name.trim().to_string() } else { n.name }),
            None => Exclude::No,
        }
    }
}

/// Why a look's microphone didn't open, as the `looking` event says it (None when it did).
pub fn mic_label(m: voice::LookMic) -> Option<&'static str> {
    match m {
        voice::LookMic::Started => None,
        voice::LookMic::Off => Some("off"),
        voice::LookMic::NeedsModel => Some("needs-model"),
        voice::LookMic::Busy => Some("busy"),
    }
}

/// The page's last word on the rules: whether it said available, and how long ago; None when it never said.
fn rules_seen(look: &Look) -> Option<(bool, Duration)> {
    look.rules.lock().unwrap().as_ref().map(|r| (r.available, r.at.elapsed()))
}

/// Why a look can't start for the workspace's rules (review, 11 October 2026), or None when it may: rules not heard
/// for 120 s (or never) are `Offline`, never "not on in this workspace"; fresh rules that say no are `NotAvailable`.
pub fn rules_refusal(seen: Option<(bool, Duration)>) -> Option<Refusal> {
    match seen {
        Some((true, age)) if age <= RULES_FRESH => None,
        Some((false, age)) if age <= RULES_FRESH => Some(Refusal::NotAvailable),
        _ => Some(Refusal::Offline),
    }
}

/// Whether the keys are listened for: signed in, opted in on this Mac, and the workspace's last word was "available",
/// however old (review, 11 October 2026). Rules gone stale keep the keys armed, so a hold says "I can't reach
/// Boredroom" instead of doing nothing; the look itself still refuses until fresh rules arrive.
pub fn keys_armed(signed_in: bool, opted_in: bool, seen: Option<(bool, Duration)>) -> bool {
    signed_in && opted_in && seen.is_some_and(|(available, _)| available)
}

fn signed_in(app: &AppHandle) -> bool {
    app.state::<AppState>().config.lock().unwrap().token.is_some()
}

fn opted_in(app: &AppHandle) -> bool {
    app.state::<AppState>().config.lock().unwrap().screen_help
}

/// Screen help on under today's consent.
pub fn screen_help_on(app: &AppHandle) -> bool {
    let st = app.state::<AppState>();
    let c = st.config.lock().unwrap();
    c.screen_help && c.screen_help_consent >= 2
}

/// On-screen actions and file work are allowed here (the page's last `set_look_rules`, fresh).
pub fn act_available(app: &AppHandle) -> bool {
    app.try_state::<Look>().is_some_and(|l| l.rules.lock().unwrap().as_ref().is_some_and(|r| r.at.elapsed() <= RULES_FRESH && r.available && r.act_available))
}

/// A Boredroom call is live or ringing, as the page last said (however old: live refuses at once).
pub fn call_live(app: &AppHandle) -> bool {
    app.try_state::<Look>().is_some_and(|l| l.call.lock().unwrap().is_some_and(|(live, _)| live))
}

/// A live call the page reported within `fresh` (the Boredroom window asks before closing during one; owner request,
/// 24 October 2026).
pub fn call_fresh(app: &AppHandle, fresh: Duration) -> bool {
    app.try_state::<Look>().is_some_and(|l| l.call.lock().unwrap().is_some_and(|(live, at)| live && at.elapsed() <= fresh))
}

fn server_v(app: &AppHandle) -> u32 {
    app.try_state::<Look>().and_then(|l| l.rules.lock().unwrap().as_ref().map(|r| r.server_v)).unwrap_or(1)
}

pub fn status(app: &AppHandle) -> LookStatus {
    let supported = capture::supported();
    let (on, on_at, asked, stored, preview, companion) = {
        let state = app.state::<AppState>();
        let c = state.config.lock().unwrap();
        (c.screen_help, c.screen_help_at, c.screen_help_asked, c.screen_help_consent, c.look_preview, c.companion != Some(false))
    };
    let available = supported && rules_fresh(&app.state::<Look>()).is_some_and(|(a, _)| a);
    let comp = companion::status(app);
    LookStatus {
        v: 4,
        supported,
        unsupported_reason: if supported { None } else if cfg!(target_os = "macos") { Some("macos") } else { Some("platform") },
        permission: if supported { permission_label(capture::preflight(), asked) } else { "unknown" },
        on,
        on_at,
        keys: LOOK_KEYS.name,
        keys_label: LOOK_KEYS.symbols,
        armed: supported && keys_armed(signed_in(app), on, rules_seen(&app.state::<Look>())),
        available,
        consent: consent_of(on, stored),
        preview,
        companion,
        companion_shown: comp.shown,
        companion_why: comp.why,
        front: Some(crate::front::status_value(app)),
    }
}

fn armed(app: &AppHandle) -> bool {
    keys_armed(signed_in(app), opted_in(app), rules_seen(&app.state::<Look>()))
}

/// Screen help on (under today's consent) or off; off also turns off doing things on the Mac and file work (0b.5).
fn set_on(app: &AppHandle, on: bool) {
    set_on_with(app, on, 2);
}

/// Screen help on under `consent` (2: the old card; 3: the setup card, `help.rs`), never lowering what the person
/// agreed to; or off.
pub fn set_on_with(app: &AppHandle, on: bool, consent: u32) {
    crate::update_config(app, |c| {
        // Already on: it keeps the time it was turned on ("Turn off on my Macs" compares with it).
        let was_on = c.screen_help && c.screen_help_at.is_some();
        c.screen_help = on;
        c.screen_help_at = if !on { None } else if was_on { c.screen_help_at } else { Some(now_unix_ms()) };
        if on {
            c.screen_help_consent = c.screen_help_consent.max(consent);
        } else {
            c.use_mac = false;
            c.use_mac_at = None;
            c.file_work = false;
            c.file_work_at = None;
        }
    });
}

fn drop_held(app: &AppHandle) {
    if let Some(look) = app.try_state::<Look>() {
        if look.held.lock().unwrap().take().is_some() {
            emit(app, LookEvent::Dropped {});
        }
    }
}

/// Signing out: the consent was the signed-in person's, and any picture goes with it.
pub fn forget(app: &AppHandle) {
    if let Some(look) = app.try_state::<Look>() {
        look.gen.fetch_add(1, Ordering::SeqCst);
        look.store.lock().unwrap().clear();
        *look.pending.lock().unwrap() = None;
        *look.call.lock().unwrap() = None;
        *look.rules.lock().unwrap() = None;
        *look.heard.lock().unwrap() = None;
        look.last_messages.lock().unwrap().clear();
    }
    drop_held(app);
    crate::refresh_tray(app);
}

/// "You'll see her looking": a look shows the notch window if the tray hid it.
pub fn show_notch(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("notch") {
        if !w.is_visible().unwrap_or(true) {
            let _ = w.show();
            if let Some(item) = app.try_state::<crate::ToggleMenu>() {
                let _ = item.0.set_text("Hide Brenda");
            }
        }
    }
}

/// While a proposal from these pictures waits for its answer they are kept past their minute (B.6.2).
pub fn hold_pictures(app: &AppHandle, keep: bool) {
    if let Some(look) = app.try_state::<Look>() {
        look.keep_held.store(keep, Ordering::SeqCst);
    }
}

/// Rust's own transcript of a look's words (from `voice.rs`), so `look_send` can tell spoken words from typed ones.
pub fn note_heard(app: &AppHandle, look_id: &str, text: &str) {
    let Some(look) = app.try_state::<Look>() else { return };
    let released = look.pending.lock().unwrap().as_ref().filter(|p| p.id == look_id).and_then(|p| p.released_at).unwrap_or_else(Instant::now);
    *look.heard.lock().unwrap() = Some((look_id.to_string(), text.to_string(), released));
}

/// Spaces folded, ends trimmed: how a typed question is compared with the transcript.
pub fn fold_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The request's origin (B.3.1): the person's own spoken words (exactly Rust's transcript of this look) or typed words
/// with a real press. None when neither (nothing is sent).
pub fn request_via(question: &str, transcript: Option<(&str, &str)>, look_id: &str, person_press: bool) -> Option<&'static str> {
    if let Some((id, words)) = transcript {
        if id == look_id && !words.trim().is_empty() && fold_ws(words) == fold_ws(question) {
            return Some("voice");
        }
    }
    person_press.then_some("typed")
}

/// A question waits for the person (a task's, the front desk's or a job's): a new look or typed request waits too.
pub fn answer_first(app: &AppHandle) -> bool {
    act::question_waiting(app) || crate::front::waiting(app).is_some() || crate::jobs::waiting(app).is_some()
}

// ---- the thread ----------------------------------------------------------------------------------------------------

/// Starts the look thread (B.2). It does nothing on a Mac older than macOS 14 (or elsewhere), and only reads the
/// modifier state while screen help is on, signed in and available.
pub fn start(app: &AppHandle) {
    if !capture::supported() {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("brenda-look".into()).spawn(move || run(app));
}

fn run(app: AppHandle) {
    let epoch = Instant::now();
    let mut machine = ChordMachine::new(&LOOK_KEYS);
    let mut locked = false;
    let mut locked_checked: Option<Instant> = None;
    let mut janitor = Instant::now();
    let mut watched = Instant::now();
    loop {
        if janitor.elapsed() >= Duration::from_secs(1) {
            janitor = Instant::now();
            expire(&app);
        }
        // A task stops at once when the Mac locks or a call starts (B.6.5), checked every 250 ms while one is live.
        if act::live(&app) && watched.elapsed() >= Duration::from_millis(250) {
            watched = Instant::now();
            act::watch(&app, capture::screen_locked(), call_live(&app), false);
        }
        if !armed(&app) {
            if let Some(ChordEvent::Cancel(reason)) = machine.disarm() {
                on_cancel(&app, reason);
            }
            std::thread::sleep(if act::live(&app) { Duration::from_millis(250) } else { TICK_IDLE });
            continue;
        }
        if locked_checked.is_none_or(|t| t.elapsed() >= Duration::from_secs(1)) {
            locked = capture::screen_locked();
            locked_checked = Some(Instant::now());
        }
        let tick = Tick {
            now_ms: epoch.elapsed().as_millis() as u64,
            flags: capture::modifier_flags(),
            key_age_ms: capture::seconds_since_key_down().and_then(age_ms),
            locked,
        };
        match machine.step(tick) {
            Some(ChordEvent::Start) => on_start(&app),
            Some(ChordEvent::Cancel(reason)) => on_cancel(&app, reason),
            Some(ChordEvent::Release) => on_release(&app),
            None => {}
        }
        std::thread::sleep(if locked { TICK_IDLE } else { TICK_ARMED });
    }
}

/// The keys came down (B.2): first the task state (a Stop, an answer), only then a look.
fn on_start(app: &AppHandle) {
    let look = app.state::<Look>();
    match act::hold_role(app) {
        act::Role::Stop => {
            *look.hold.lock().unwrap() = HoldKind::Stop;
            act::stop(app, "keys");
        }
        act::Role::Answer(target) => {
            *look.hold.lock().unwrap() = HoldKind::Answer;
            voice::start_answer_recording(app, target, crate::voice_on(app));
        }
        act::Role::Free => {
            *look.hold.lock().unwrap() = HoldKind::Look;
            begin(app, Source::Keys);
        }
    }
}

fn on_cancel(app: &AppHandle, reason: CancelReason) {
    let kind = std::mem::take(&mut *app.state::<Look>().hold.lock().unwrap());
    match kind {
        HoldKind::Look => cancel(app, reason),
        HoldKind::Answer => voice::cancel_answer_recording(app),
        HoldKind::Stop | HoldKind::None => {}
    }
}

fn on_release(app: &AppHandle) {
    let kind = std::mem::take(&mut *app.state::<Look>().hold.lock().unwrap());
    match kind {
        HoldKind::Look => release(app),
        HoldKind::Answer => voice::finish_answer_recording(app),
        HoldKind::Stop | HoldKind::None => {}
    }
}

/// A picture waited 120 s without being sent, or the held pictures' minute is up: dropped, and the page told.
fn expire(app: &AppHandle) {
    let look = app.state::<Look>();
    let gone = look.store.lock().unwrap().expire(Instant::now());
    if let Some(id) = gone {
        emit(app, LookEvent::Cancelled { look_id: id, reason: CancelReason::Timeout });
    }
    let keep = look.keep_held.load(Ordering::SeqCst);
    let expired = look.held.lock().unwrap().as_ref().is_some_and(|h| held_expired(h.until, Instant::now(), keep));
    if expired {
        drop_held(app);
    }
}

/// Start (A.2): a new look, checked and captured on a worker thread.
fn begin(app: &AppHandle, source: Source) {
    let look = app.state::<Look>();
    let gen = look.gen.fetch_add(1, Ordering::SeqCst) + 1;
    let id = new_id(&look);
    *look.pending.lock().unwrap() = Some(Pending { id: id.clone(), gen, source, phase: Phase::Checking, released: source == Source::Button, released_at: None, front_pid: None, mic: false });
    let app = app.clone();
    let _ = std::thread::Builder::new().name("brenda-look-capture".into()).spawn(move || work(&app, id, gen, source));
}

fn current(look: &Look, gen: u64) -> bool {
    look.gen.load(Ordering::SeqCst) == gen
}

/// Marks the look refused (if it is still the current one) and tells the page.
fn refused(app: &AppHandle, gen: u64, e: LookEvent) {
    let look = app.state::<Look>();
    let mut p = look.pending.lock().unwrap();
    if !current(&look, gen) {
        return;
    }
    if let Some(p) = p.as_mut() {
        p.phase = Phase::Refused;
    }
    drop(p);
    emit(app, e);
}

/// Whether a Boredroom call is live (B.5): the page's report when fresh, else Boredroom asked directly (5 s). Errors
/// fail closed.
pub fn call_state(app: &AppHandle) -> Result<(), Refusal> {
    let report = app.state::<Look>().call.lock().unwrap().map(|(live, at)| (live, at.elapsed().as_millis() as u64));
    match call_check(report, CALL_FRESH_MS) {
        CallCheck::Live => Err(Refusal::OnCall),
        CallCheck::Clear => Ok(()),
        CallCheck::Stale => {
            let app2 = app.clone();
            let answer = tauri::async_runtime::block_on(async move { ask_calls_now(&app2).await });
            match answer {
                Some(true) => Err(Refusal::OnCall),
                Some(false) => Ok(()),
                None => Err(Refusal::CallUnknown),
            }
        }
    }
}

async fn ask_calls_now(app: &AppHandle) -> Option<bool> {
    let state = app.state::<AppState>();
    let (base, token, slug) = {
        let c = state.config.lock().unwrap();
        (crate::base_url(&c), c.token.clone()?, c.workspace_slug.clone()?)
    };
    // No `ring=`: the one-ringer bookkeeping belongs to the page's own poll.
    let res = state
        .http
        .get(format!("{base}/api/orgs/{slug}/calls/now"))
        .bearer_auth(token)
        .header("accept", "application/json")
        .header("user-agent", crate::user_agent())
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let v: Value = res.json().await.ok()?;
    let live = live_of(&v);
    *app.state::<Look>().call.lock().unwrap() = Some((live, Instant::now()));
    Some(live)
}

/// The screen looks shared (B.4.7): Zoom's sharing helper is running or showing.
fn sharing_now(app: &AppHandle) -> bool {
    let running = capture::env_snapshot(app).map(|s| s.running).unwrap_or_default();
    let owners: Vec<String> = capture::window_list(false).into_iter().map(|w| w.owner_name).collect();
    crate::guard::sharing_suspected(&running, &owners)
}

/// The display the notch is on (the Look button's picture).
fn notch_display(app: &AppHandle) -> Option<(u32, Bounds)> {
    let w = app.get_webview_window("notch")?;
    let pos = w.outer_position().ok()?;
    let scale = w.scale_factor().ok()?;
    let size = w.outer_size().ok()?;
    let c = (pos.x as f64 / scale + size.width as f64 / scale / 2.0, pos.y as f64 / scale + 4.0);
    capture::display_under(c)
}

/// The files the person could mean (B.9.1), gathered only with file work on.
fn gather_files(app: &AppHandle, pointer: Option<(f64, f64)>, front: Option<&capture::FrontApp>, desktop: bool, under: Option<filework::SourceApp>, rules: &[Rule]) -> Vec<Candidate> {
    // A file found in an app Brenda never looks at or never works in is never offered (review, 12 October 2026): not
    // its name to the model, not its contents to a file job. Each candidate says which app it came from, so the server
    // checks the same lists again.
    let blocked = |a: &filework::SourceApp| crate::guard::no_act(&AppId { bundle_id: a.bundle_id.clone(), names: vec![a.name.clone()] }, rules).is_some();
    let with_app = |c: Candidate, a: &filework::SourceApp| Candidate { app: Some(a.clone()), ..c };
    let finder = filework::SourceApp { name: "Finder".into(), bundle_id: Some("com.apple.finder".into()) };
    let mut out: Vec<Candidate> = crate::files::recent_candidates(app);
    let finder_front = front.is_some_and(|f| f.bundle_id.as_deref() == Some("com.apple.finder"));
    let finder_under = under.as_ref().is_some_and(|u| u.bundle_id.as_deref() == Some("com.apple.finder"));
    let mut folders: Vec<Candidate> = Vec::new();
    if (finder_front || finder_under || desktop) && !blocked(&finder) {
        let selection = if finder_front || desktop { filework::finder_selection() } else { Vec::new() };
        out.extend(selection.iter().filter_map(|p| filework::candidate(filework::Source::FinderSelection, p)).map(|c| with_app(c, &finder)));
        // The folder the person points at (the Finder window in front, or the desktop) and folders they selected (owner
        // request, 12 October 2026: "look through my documents"; companion2-spec C.1; names only).
        if let Some(home) = filework::home() {
            let never = crate::folder::never_names(rules);
            folders = filework::folder_candidates(finder_front || finder_under, desktop, &selection, &home, &never).into_iter().map(|c| with_app(c, &finder)).collect();
        }
    }
    if crate::ax::trusted() {
        if let Some(f) = front.filter(|f| f.pid != std::process::id() as i32) {
            let fa = filework::SourceApp { name: f.name.clone().unwrap_or_default(), bundle_id: f.bundle_id.clone() };
            if !blocked(&fa) {
                if let Some(p) = crate::ax::front_document(f.pid) {
                    out.extend(filework::candidate(filework::Source::FrontDocument, &p).map(|c| with_app(c, &fa)));
                }
            }
        }
        let pa = if desktop { Some(finder.clone()) } else { under };
        if let Some(pa) = pa.filter(|a| !blocked(a)) {
            if let Some(p) = pointer.and_then(crate::ax::file_at) {
                out.extend(filework::candidate(filework::Source::Pointer, &p).map(|c| with_app(c, &pa)));
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|c| seen.insert((c.source, c.name.clone())));
    out.truncate(filework::MAX_CANDIDATES);
    out.extend(folders.into_iter().filter(|c| seen.insert((c.source, c.name.clone()))));
    out
}

/// The checks, the capture and the files, in B.2's order. Every refusal captures nothing.
fn work(app: &AppHandle, id: String, gen: u64, source: Source) {
    let look = app.state::<Look>();
    let refuse_with = |reason: Refusal| refused(app, gen, LookEvent::Refused { reason, app: None, source: None });
    if !capture::supported() {
        return refuse_with(Refusal::Unsupported);
    }
    let (on, consent, preview, file_work) = {
        let st = app.state::<AppState>();
        let c = st.config.lock().unwrap();
        (c.screen_help, consent_of(c.screen_help, c.screen_help_consent), c.look_preview, c.file_work)
    };
    if !on {
        return refuse_with(Refusal::NotAvailable);
    }
    if consent < 2 {
        show_notch(app);
        return refuse_with(Refusal::ConsentUpdate);
    }
    if let Some(r) = rules_refusal(rules_seen(&look)) {
        return refuse_with(r);
    }
    let Some((_, rules)) = rules_fresh(&look) else { return refuse_with(Refusal::Offline) };
    if look.sending.load(Ordering::SeqCst) {
        return refuse_with(Refusal::Busy);
    }
    if answer_first(app) {
        return refuse_with(Refusal::AnswerFirst);
    }
    if !capture::preflight() {
        return refuse_with(Refusal::Permission);
    }
    if let Err(r) = call_state(app) {
        return refuse_with(r);
    }
    if sharing_now(app) {
        return refuse_with(Refusal::Sharing);
    }
    let own_pid = std::process::id() as i32;
    // The person's app, even when Brenda's notch is in front (L.1 step 3).
    let front = capture::person_front(app);
    let pointer = if source == Source::Keys { capture::pointer_top_left() } else { None };
    // Boredroom's own window (owner request, 24 October 2026): never looked at, and never the app behind it instead.
    let own_under_pointer = pointer.is_some_and(|p| capture::own_window_at(&capture::window_list(true), p, own_pid));
    if own_under_pointer || (pointer.is_none() && front.as_ref().is_some_and(|f| f.own_window)) {
        return refuse_with(Refusal::OwnWindow);
    }
    let display = match pointer {
        Some(p) => capture::display_under(p),
        None => notch_display(app).or_else(|| capture::displays().into_iter().next()),
    };
    let Some((display_id, bounds)) = display else { return refuse_with(Refusal::NoWindow) };
    // What is under the pointer (keys only): its app, or the desktop (Finder).
    let (mut app_name, mut bundle_id, mut desktop) = (None, None, false);
    if let Some(p) = pointer {
        let list = capture::window_list(true);
        match window_at(&list, p, own_pid) {
            Some(w) if w.layer < 0 => desktop = true,
            Some(w) => {
                let owner = capture::app_of_pid(app, w.pid);
                let mut names = vec![w.owner_name.clone()];
                names.extend(owner.as_ref().and_then(|o| o.name.clone()));
                bundle_id = owner.as_ref().and_then(|o| o.bundle_id.clone());
                let name = names.iter().map(|n| n.trim()).find(|n| !n.is_empty()).unwrap_or("this app").chars().take(80).collect::<String>();
                if bundle_id.as_deref() == Some("com.apple.finder") && w.bounds.w >= bounds.w - 1.0 && w.bounds.h >= bounds.h - 1.0 {
                    desktop = true;
                }
                if let Some(m) = never_look(&AppId { bundle_id: bundle_id.clone(), names }, &rules) {
                    return refused(app, gen, LookEvent::Refused { reason: Refusal::NeverLook, app: Some(AppName { name: if m.source == RuleSource::Fixed { name } else { m.name } }), source: Some(m.source) });
                }
                app_name = Some(name);
            }
            None => desktop = true,
        }
        if desktop {
            app_name = Some("Finder".into());
            bundle_id = Some("com.apple.finder".into());
        }
    }

    // The checks passed: stop her speaking, open the microphone (keys only), say she is looking. The notch is shown
    // first, outside the pending lock (showing it waits for the main thread).
    voice::stop_speaking(app);
    show_notch(app);
    {
        let mut p = look.pending.lock().unwrap();
        if !current(&look, gen) {
            return;
        }
        let Some(p) = p.as_mut() else { return };
        p.phase = Phase::Live;
        p.front_pid = front.as_ref().map(|f| f.pid);
        let outcome = if source == Source::Keys && !p.released { Some(voice::start_look_recording(app, &id, crate::voice_on(app))) } else { None };
        let listening = outcome == Some(voice::LookMic::Started);
        p.mic = listening;
        companion::exchange_begin(app);
        let shown = if desktop { "your desktop".to_string() } else { app_name.clone().unwrap_or_else(|| "your screen".into()) };
        emit(app, LookEvent::Looking { look_id: id.clone(), source, app: AppName { name: shown }, listening, mic: outcome.and_then(mic_label), desktop });
    }
    // The keys came up while the checks ran: finish the release now.
    let early_release = source == Source::Keys && look.pending.lock().unwrap().as_ref().is_some_and(|p| p.gen == gen && p.released);
    if early_release {
        finish_release(app, gen);
    }

    let shot = capture::capture_display(display_id, bounds, &exclusion(&rules, own_pid), pointer, source == Source::Keys, preview);
    let shot: DisplayShot = match shot {
        Ok(s) => s,
        Err(message) => {
            if current(&look, gen) {
                voice::cancel_look_recording(app, &id);
                companion::exchange_end(app, true);
                emit(app, LookEvent::Error { look_id: Some(id), message });
            }
            return;
        }
    };
    let under = app_name.clone().filter(|_| !desktop).map(|name| filework::SourceApp { name, bundle_id: bundle_id.clone() });
    let candidates = if file_work { gather_files(app, pointer, front.as_ref(), desktop, under, &rules) } else { Vec::new() };
    let preview_event = shot.preview.clone().map(|image| LookEvent::Preview {
        look_id: id.clone(),
        source,
        app: AppFull { name: app_name.clone().unwrap_or_else(|| "your screen".into()), bundle_id: bundle_id.clone() },
        image,
        width: shot.screen.width,
        height: shot.screen.height,
        pointer: shot.screen.pointer,
    });
    let capture = Capture {
        id: id.clone(),
        geometry: Some(shot.geometry),
        hidden: shot.hidden.clone(),
        screen: Some(shot.screen),
        crop: shot.crop,
        app_name,
        bundle_id,
        desktop,
        source,
        taken: Instant::now(),
        candidates,
        front_pid: front.as_ref().map(|f| f.pid),
        pointer,
    };
    {
        // Under the pending lock, so a Cancel either sees the picture in the store or bumps the generation first.
        let _p = look.pending.lock().unwrap();
        if !current(&look, gen) {
            return; // cancelled while the picture was taken: dropped unseen (and wiped)
        }
        look.store.lock().unwrap().put(capture);
    }
    if let Some(e) = preview_event {
        emit(app, e);
    }
    capture::flash_outline(app, bounds);
}

/// Cancel (B.2): the picture is dropped (now, or when it lands), the recording discarded unheard, the page told.
fn cancel(app: &AppHandle, reason: CancelReason) {
    let look = app.state::<Look>();
    let mut p = look.pending.lock().unwrap();
    let Some(pending) = p.as_ref() else { return };
    if pending.gen != look.gen.load(Ordering::SeqCst) || pending.phase == Phase::Refused {
        return;
    }
    let id = pending.id.clone();
    look.gen.fetch_add(1, Ordering::SeqCst);
    let _ = look.store.lock().unwrap().take(&id);
    *p = None;
    drop(p);
    voice::cancel_look_recording(app, &id);
    companion::exchange_end(app, false);
    emit(app, LookEvent::Cancelled { look_id: id, reason });
}

/// The keys came up (B.2): a look whose front app changed is cancelled; otherwise `released`, and the words are
/// turned into text on this Mac.
fn release(app: &AppHandle) {
    let look = app.state::<Look>();
    let gen = {
        let mut p = look.pending.lock().unwrap();
        let Some(pending) = p.as_mut() else { return };
        if pending.gen != look.gen.load(Ordering::SeqCst) || pending.source != Source::Keys {
            return;
        }
        match pending.phase {
            Phase::Refused => return,
            Phase::Checking => {
                pending.released = true; // the worker finishes the release once the checks pass
                pending.released_at = Some(Instant::now());
                return;
            }
            Phase::Live => pending.gen,
        }
    };
    finish_release(app, gen);
}

fn finish_release(app: &AppHandle, gen: u64) {
    let look = app.state::<Look>();
    let Some((id, front_pid, mic)) = look.pending.lock().unwrap().as_mut().filter(|p| p.gen == gen).map(|p| {
        p.released_at.get_or_insert_with(Instant::now);
        (p.id.clone(), p.front_pid, p.mic)
    }) else {
        return;
    };
    let now_front = capture::frontmost(app).map(|f| f.pid);
    if front_pid.is_some() && now_front.is_some() && now_front != front_pid && now_front != Some(std::process::id() as i32) {
        return cancel(app, CancelReason::FrontChanged);
    }
    if !current(&look, gen) {
        return;
    }
    companion::set_state(app, companion::State::Thinking);
    emit(app, LookEvent::Released { look_id: id.clone() });
    if mic {
        voice::finish_look_recording(app, &id);
    }
}

// ---- sending -------------------------------------------------------------------------------------------------------

pub const MAX_MESSAGES: usize = 30;
pub const MAX_MESSAGES_BYTES: usize = 400 * 1024;
pub const MAX_QUESTION_CHARS: usize = 4_000;
/// The whole request at most (under the 4.5 MB serverless body limit; the server checks 4,000,000 too).
pub const MAX_BODY_BYTES: usize = 4_000_000;
/// One NDJSON line at most, and the whole stream at most (B.3.3).
pub const MAX_LINE_BYTES: usize = 1_048_576;
pub const MAX_STREAM_BYTES: usize = 4_000_000;
const SEND_TIMEOUT: Duration = Duration::from_secs(180);
/// How long `look_send` waits for a picture still being taken.
const CAPTURE_WAIT: Duration = Duration::from_secs(4);

fn look_error(message: impl Into<String>, code: &str) -> ApiError {
    ApiError { status: 0, message: message.into(), code: Some(code.to_string()) }
}

/// The question and the chat so far, as `look_send` accepts them (A.5): 1–4,000 characters, ≤ 30 messages, ≤ 400 KB,
/// the last one the question itself.
pub fn check_send(question: &str, messages: &[Value]) -> Result<(), ApiError> {
    let q = question.trim();
    let n = q.chars().count();
    if n == 0 || n > MAX_QUESTION_CHARS {
        return Err(look_error("Ask her something about the screen first (up to 4,000 characters).", "LOOK_QUESTION"));
    }
    if messages.is_empty() || messages.len() > MAX_MESSAGES {
        return Err(look_error("That chat is too long to send with a picture.", "LOOK_MESSAGES"));
    }
    if serde_json::to_vec(messages).map(|v| v.len()).unwrap_or(usize::MAX) > MAX_MESSAGES_BYTES {
        return Err(look_error("That chat is too long to send with a picture.", "LOOK_MESSAGES"));
    }
    let last = messages.last().unwrap();
    let ok = last.get("role").and_then(|r| r.as_str()) == Some("user") && last.get("content").and_then(|c| c.as_str()).map(str::trim) == Some(q);
    if !ok {
        return Err(look_error("The question must be the chat's last message.", "LOOK_MESSAGES"));
    }
    Ok(())
}

/// A buffer that zeroes itself when the last owner lets go (reqwest's copy of the request body included).
pub struct WipeOnDrop(pub Vec<u8>);
impl AsRef<[u8]> for WipeOnDrop {
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}
impl Drop for WipeOnDrop {
    fn drop(&mut self) {
        wipe(&mut self.0);
    }
}

/// Counts what a serialiser writes.
struct Count(usize);
impl std::io::Write for Count {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0 += b.len();
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// `v` as JSON in a buffer sized exactly up front (so no copy of a picture is left behind by a growing buffer) that
/// wipes itself; None when it would pass `max` bytes or cannot be written.
pub fn to_wiped_json<T: Serialize>(v: &T, max: usize) -> Option<WipeOnDrop> {
    let mut count = Count(0);
    serde_json::to_writer(&mut count, v).ok()?;
    if count.0 > max {
        return None;
    }
    let mut out = WipeOnDrop(Vec::with_capacity(count.0));
    serde_json::to_writer(&mut out.0, v).ok()?;
    Some(out)
}

/// A picture in a request: `{mediaType, data, width, height, pointer}`, the base64 wiped once written.
struct PicJson<'a>(&'a Pic, bool);

impl Serialize for PicJson<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use base64::Engine;
        use serde::ser::SerializeMap;
        let mut data = base64::engine::general_purpose::STANDARD.encode(&self.0.jpeg);
        let mut m = s.serialize_map(None)?;
        m.serialize_entry("mediaType", "image/jpeg")?;
        let r = m.serialize_entry("data", &data);
        // SAFETY: zero bytes are valid UTF-8.
        unsafe { data.as_bytes_mut().fill(0) };
        r?;
        m.serialize_entry("width", &self.0.width)?;
        m.serialize_entry("height", &self.0.height)?;
        if self.1 {
            m.serialize_entry("pointer", &self.0.pointer)?;
        }
        m.end()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppBody<'a> {
    name: &'a str,
    bundle_id: Option<&'a str>,
    /// The pointer was on the desktop (Finder owns it, so the name can't tell): the server then says so to the model
    /// (integration, 12 October 2026; the server reads `app.desktop`). Left out otherwise, and always in v1 bodies.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    desktop: bool,
}

#[derive(Serialize)]
struct LookBodyV1<'a> {
    version: u8,
    source: Source,
    image: PicJson<'a>,
    pointer: Option<Point>,
    app: AppBody<'a>,
    messages: &'a [Value],
}

/// Phase 1's request body (for a server that still says `v: 1`): the screen picture as the one image.
pub fn look_body(c: &Capture, messages: &[Value]) -> Result<WipeOnDrop, ApiError> {
    let screen = c.screen.as_ref().ok_or_else(|| look_error("That picture is gone. Look again.", "LOOK_GONE"))?;
    let source = if c.source == Source::Button { Source::Button } else { Source::Keys };
    let body = LookBodyV1 {
        version: 1,
        source,
        image: PicJson(screen, false),
        pointer: screen.pointer,
        app: AppBody { name: c.app_name.as_deref().unwrap_or("your screen"), bundle_id: c.bundle_id.as_deref(), desktop: false },
        messages,
    };
    to_wiped_json(&body, MAX_BODY_BYTES).ok_or_else(|| look_error("That picture is too large to send.", "PAYLOAD_TOO_LARGE"))
}

/// The person's request (B.3.2 `request`).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub text: String,
    pub via: &'static str,
    pub age_ms: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Abilities {
    pub use_mac: bool,
    pub file_work: bool,
    pub busy: Option<&'static str>,
    /// This Rust takes plans (companion2-spec D.1.1): 1.
    pub plans: u8,
    /// Clicking and typing are allowed (Accessibility granted and events can be posted).
    pub accessibility: bool,
    /// This Rust has the front desk and `front.ready` (helpers-spec J.1): 1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub front: Option<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DisplayBody {
    width_pt: f64,
    height_pt: f64,
    scale: f64,
}

#[derive(Serialize)]
struct LookBodyV2<'a> {
    version: u8,
    source: Source,
    request: &'a Request,
    screen: Option<PicJson<'a>>,
    crop: Option<PicJson<'a>>,
    display: Option<DisplayBody>,
    app: Option<AppBody<'a>>,
    hidden: &'a [String],
    abilities: &'a Abilities,
    files: Vec<filework::Hint>,
    messages: &'a [Value],
    /// helpers-spec J.1: `front: 1` and the lane, only from the front desk.
    #[serde(skip_serializing_if = "Option::is_none")]
    front: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    lane: Option<&'a str>,
    /// Boredroom's own record of what Brenda did on this Mac in the last ten minutes (`front::recent_json`: at most six
    /// done lines and how many minutes ago; never screen text). Owner report, 28 October 2026: a look said "I did not open
    /// any tab" and "I can't control your browser" because it never knew. Left out when there is none.
    #[serde(skip_serializing_if = "<[Value]>::is_empty")]
    recent: &'a [Value],
}

/// The v2 request body (B.3.2), ≤ 4,000,000 bytes, in a self-wiping buffer.
#[cfg_attr(not(test), allow(dead_code))]
pub fn look_body_v2(c: &Capture, request: &Request, abilities: &Abilities, messages: &[Value]) -> Result<WipeOnDrop, ApiError> {
    look_body_v2_lane(c, request, abilities, messages, None)
}

/// The v2 body with the front desk's lane (helpers-spec J.1): `front: 1` and `lane` when `lane` is given.
pub fn look_body_v2_lane(c: &Capture, request: &Request, abilities: &Abilities, messages: &[Value], lane: Option<&str>) -> Result<WipeOnDrop, ApiError> {
    look_body_v2_recent(c, request, abilities, messages, lane, &[])
}

/// The v2 body with the lane and what Brenda did on this Mac lately (`recent`; owner report, 28 October 2026).
pub fn look_body_v2_recent(c: &Capture, request: &Request, abilities: &Abilities, messages: &[Value], lane: Option<&str>, recent: &[Value]) -> Result<WipeOnDrop, ApiError> {
    let app = if c.source == Source::Drop { None } else { Some(AppBody { name: c.app_name.as_deref().unwrap_or("your screen"), bundle_id: c.bundle_id.as_deref(), desktop: c.desktop }) };
    let files = if abilities.file_work { c.candidates.iter().map(Candidate::hint).collect() } else { Vec::new() };
    let body = LookBodyV2 {
        version: 2,
        source: c.source,
        request,
        screen: c.screen.as_ref().map(|p| PicJson(p, true)),
        crop: c.crop.as_ref().map(|p| PicJson(p, true)),
        display: c.geometry.map(|g| DisplayBody { width_pt: g.display.w, height_pt: g.display.h, scale: g.scale }),
        app,
        hidden: &c.hidden,
        abilities,
        files,
        messages,
        front: lane.map(|_| 1),
        lane,
        recent,
    };
    to_wiped_json(&body, MAX_BODY_BYTES).ok_or_else(|| look_error("That picture is too large to send.", "PAYLOAD_TOO_LARGE"))
}

/// Splits a streamed NDJSON answer into JSON objects (B.3.3): lines may be split across chunks; a line over 1 MiB, a
/// stream over 4,000,000 bytes or a line that is not a JSON object ends the read.
#[derive(Default)]
pub struct Lines {
    buf: Vec<u8>,
    total: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub enum StreamError {
    LineTooLong,
    TooBig,
    Unreadable,
}

impl Lines {
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, StreamError> {
        self.total += chunk.len();
        if self.total > MAX_STREAM_BYTES {
            return Err(StreamError::TooBig);
        }
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(i) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=i).collect();
            if line.len() > MAX_LINE_BYTES + 1 {
                return Err(StreamError::LineTooLong);
            }
            if let Some(v) = Self::parse(&line)? {
                out.push(v);
            }
        }
        if self.buf.len() > MAX_LINE_BYTES {
            return Err(StreamError::LineTooLong);
        }
        Ok(out)
    }

    /// The last line, when the stream ends without a newline.
    pub fn finish(&mut self) -> Result<Option<Value>, StreamError> {
        let line = std::mem::take(&mut self.buf);
        Self::parse(&line)
    }

    fn parse(line: &[u8]) -> Result<Option<Value>, StreamError> {
        let text = std::str::from_utf8(line).map_err(|_| StreamError::Unreadable)?.trim();
        if text.is_empty() {
            return Ok(None);
        }
        let v: Value = serde_json::from_str(text).map_err(|_| StreamError::Unreadable)?;
        if !v.is_object() {
            return Err(StreamError::Unreadable);
        }
        Ok(Some(v))
    }
}

/// One line of the answer, as Rust acts on it (B.3.3). Unknown kinds are ignored.
#[derive(Debug, PartialEq)]
pub enum Line {
    Text(String),
    Say(String, Value),
    Point(Value),
    Propose(Value),
    Done(Value),
    Error(ApiError),
    Ignore,
}

impl PartialEq for ApiError {
    fn eq(&self, o: &Self) -> bool {
        self.status == o.status && self.message == o.message && self.code == o.code
    }
}

pub fn line_of(v: &Value) -> Line {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
    match v.get("t").and_then(|t| t.as_str()) {
        Some("text") => s("d").map(Line::Text).unwrap_or(Line::Ignore),
        Some("say") => s("text").map(|t| Line::Say(t, v.get("speech").cloned().unwrap_or(Value::Null))).unwrap_or(Line::Ignore),
        Some("point") => Line::Point(v.clone()),
        Some("propose") => v.get("task").cloned().map(Line::Propose).unwrap_or(Line::Ignore),
        Some("done") => Line::Done(v.get("result").cloned().unwrap_or(Value::Null)),
        Some("error") => Line::Error(ApiError {
            status: v.get("status").and_then(|x| x.as_u64()).unwrap_or(500) as u16,
            message: s("message").unwrap_or_else(|| "Request failed.".into()),
            code: s("code"),
        }),
        _ => Line::Ignore,
    }
}

/// Clears `sending` however a send ends.
struct Sending<'a>(&'a AtomicBool);
impl Drop for Sending<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn unreadable() -> ApiError {
    look_error("Boredroom's answer couldn't be read.", "LOOK_STREAM")
}

/// Sends a look (v2 streamed, or v1 for an older server) and acts on its answer as it arrives; the pictures are held
/// for a minute after a good answer. `look_id` tags the events.
async fn stream_look(app: &AppHandle, capture: Capture, request: Request, messages: Vec<Value>, look_id: String) -> Result<Value, ApiError> {
    stream_look_lane(app, capture, request, messages, look_id, None).await
}

/// A look with the front desk's lane (helpers-spec J): `front: 1` and `lane` in the body.
async fn stream_look_lane(app: &AppHandle, capture: Capture, request: Request, messages: Vec<Value>, look_id: String, lane: Option<String>) -> Result<Value, ApiError> {
    let state = app.state::<AppState>();
    let (base, token, slug, use_mac, file_work) = {
        let c = state.config.lock().unwrap();
        (crate::base_url(&c), c.token.clone(), c.workspace_slug.clone(), c.use_mac, c.file_work)
    };
    let (Some(token), Some(slug)) = (token, slug) else { return Err(ApiError::new(401, "Not signed in.")) };
    let v2 = server_v(app) >= 2;
    let available = act_available(app);
    let front = lane.as_ref().map(|_| 1);
    let abilities = Abilities { use_mac: use_mac && available, file_work: file_work && available, busy: act::busy_file(app).then_some("file"), plans: 1, accessibility: act::can_click_and_type(), front };
    let recent = crate::front::recent_now(app);
    let body = if v2 { look_body_v2_recent(&capture, &request, &abilities, &messages, lane.as_deref(), &recent)? } else { look_body(&capture, &messages)? };
    *app.state::<Look>().last_messages.lock().unwrap() = messages;
    emit(app, LookEvent::Sending { look_id: look_id.clone() });
    companion::set_state(app, companion::State::Thinking);
    let res = state
        .http
        .post(format!("{base}/api/orgs/{slug}/assistant/look"))
        .bearer_auth(token)
        .header("content-type", "application/json")
        .header("accept", if v2 { "application/x-ndjson" } else { "application/json" })
        .header("user-agent", crate::user_agent())
        .timeout(SEND_TIMEOUT)
        .body(bytes::Bytes::from_owner(body))
        .send()
        .await
        .map_err(|e| ApiError::new(0, format!("Cannot reach Boredroom: {}", e.without_url())));
    let result = match res {
        Err(e) => Err(e),
        Ok(res) => {
            let status = res.status().as_u16();
            let ndjson = res.headers().get("content-type").and_then(|v| v.to_str().ok()).is_some_and(|t| t.contains("ndjson"));
            if status >= 400 || !ndjson {
                let value: Value = res.json().await.unwrap_or(Value::Null);
                if status >= 400 {
                    let message = value.get("message").and_then(|m| m.as_str()).unwrap_or("Request failed.").to_string();
                    let code = value.get("code").and_then(|c| c.as_str()).map(String::from);
                    Err(ApiError { status, message, code })
                } else {
                    Ok(value)
                }
            } else {
                read_stream(app, res, &capture, &look_id).await
            }
        }
    };
    match &result {
        Ok(v) => {
            companion::exchange_answered(app);
            let look = app.state::<Look>();
            // Her answer joins the chat Rust keeps, so a new request made from a long no (0.5) reads after her proposal,
            // not straight after the question (integration, 12 October 2026). Marked as having read the screen.
            if let Some(reply) = v.get("reply").and_then(|r| r.as_str()).map(str::trim).filter(|r| !r.is_empty()) {
                let mut m = look.last_messages.lock().unwrap();
                m.push(json!({ "role": "assistant", "content": clip_utf16(reply, MAX_QUESTION_CHARS), "tainted": true }));
                while m.len() > MAX_MESSAGES - 1 {
                    m.remove(0);
                }
            }
            let until = Instant::now() + FOLLOW_UP_FOR;
            let held_ok = capture.screen.is_some();
            if held_ok {
                *look.held.lock().unwrap() = Some(Held { capture, until });
                emit(app, LookEvent::Held { look_id, until: now_unix_ms() + FOLLOW_UP_FOR.as_millis() as u64 });
            }
        }
        Err(_) => companion::exchange_end(app, true),
    }
    result
}

async fn read_stream(app: &AppHandle, res: reqwest::Response, capture: &Capture, look_id: &str) -> Result<Value, ApiError> {
    use futures_util::StreamExt;
    let mut lines = Lines::default();
    let mut stream = res.bytes_stream();
    let mut done: Option<Value> = None;
    let mut points = 0;
    let mut handle = |v: Value| -> Result<(), ApiError> {
        match line_of(&v) {
            Line::Text(d) => emit(app, LookEvent::Text { look_id: look_id.to_string(), d }),
            Line::Say(text, speech) => emit(app, LookEvent::Say { look_id: look_id.to_string(), text, speech }),
            Line::Point(p) => {
                if points < companion::MAX_POINTS {
                    if let Some(g) = capture.geometry {
                        if let Some(rect) = point_to_global(&p, &g) {
                            points += 1;
                            let label = companion::clip(p.get("label").and_then(|l| l.as_str()).unwrap_or(""), 24);
                            emit(app, LookEvent::Point { look_id: look_id.to_string(), label: label.clone() });
                            let app2 = app.clone();
                            let snap = act_available(app) && app.state::<AppState>().config.lock().unwrap().use_mac;
                            std::thread::spawn(move || {
                                let mut rect = rect;
                                if snap && crate::ax::trusted() {
                                    let c = (rect.x + rect.w / 2.0, rect.y + rect.h / 2.0);
                                    if let Some(f) = crate::ax::frame_at(c).filter(|f| snap_ok(*f, c, g.display)) {
                                        rect = f;
                                    }
                                }
                                companion::point(&app2, rect, &label, g.display);
                            });
                        }
                    }
                }
            }
            Line::Propose(task) => {
                let app2 = app.clone();
                let origin = capture.origin();
                std::thread::spawn(move || act::asking(&app2, task, origin));
            }
            Line::Done(r) => done = Some(r),
            Line::Error(e) => return Err(e),
            Line::Ignore => {}
        }
        Ok(())
    };
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ApiError::new(0, "Boredroom's answer stopped half way."))?;
        for v in lines.push(&chunk).map_err(|_| unreadable())? {
            handle(v)?;
        }
    }
    if let Some(v) = lines.finish().map_err(|_| unreadable())? {
        handle(v)?;
    }
    done.ok_or_else(unreadable)
}

// ---- commands ------------------------------------------------------------------------------------------------------

#[tauri::command]
pub async fn look_status(app: AppHandle) -> LookStatus {
    status(&app)
}

/// Turns screen help on (only from the person's own press, after the consent card: today's consent, 2) or off (always;
/// off also turns off doing things on the Mac and file work, and stops any task).
#[tauri::command]
pub async fn set_screen_help(app: AppHandle, enabled: bool) -> Result<LookStatus, ApiError> {
    if enabled {
        if !capture::supported() {
            return Err(look_error("Screen help needs macOS 14 Sonoma or later.", "LOOK_UNSUPPORTED"));
        }
        if !is_person_press(&app) {
            return Err(look_error("Press the button to turn screen help on.", "LOOK_NOT_A_PRESS"));
        }
        set_on(&app, true);
    } else {
        set_on(&app, false);
        act::stop(&app, "button");
        // Review, 16 October 2026: screen help off turns her actions and file work off, so a background job stops too.
        crate::jobs::switched_off(&app);
        let look = app.state::<Look>();
        look.gen.fetch_add(1, Ordering::SeqCst);
        look.store.lock().unwrap().clear();
        drop_held(&app);
    }
    companion::wake(&app);
    crate::refresh_tray(&app);
    let _ = app.emit("brenda://act", act::ActEvent::Status(act::status(&app)));
    Ok(status(&app))
}

/// Screen help off from the tray (always possible): as `set_screen_help(false)`.
pub fn screen_help_off(app: &AppHandle) {
    set_on(app, false);
    act::stop(app, "tray");
    crate::jobs::switched_off(app);
    let look = app.state::<Look>();
    look.gen.fetch_add(1, Ordering::SeqCst);
    look.store.lock().unwrap().clear();
    drop_held(app);
    companion::wake(app);
    crate::refresh_tray(app);
    let _ = app.emit("brenda://look-status", status(app));
}

/// "Show me the picture first" and "Show Brenda by my pointer" (A.11). Stored on this Mac only.
#[tauri::command]
pub async fn look_set_options(app: AppHandle, preview: Option<bool>, companion: Option<bool>) -> LookStatus {
    crate::update_config(&app, |c| {
        if let Some(p) = preview {
            c.look_preview = p;
        }
        if let Some(on) = companion {
            c.companion = Some(on);
        }
    });
    companion::wake(&app);
    crate::refresh_tray(&app);
    status(&app)
}

/// Shows the system's Screen Recording prompt (once per Mac, as macOS allows), from the person's own press.
#[tauri::command]
pub async fn look_request_permission(app: AppHandle) -> Result<LookStatus, ApiError> {
    if !capture::supported() {
        return Err(look_error("Screen help needs macOS 14 Sonoma or later.", "LOOK_UNSUPPORTED"));
    }
    if !is_person_press(&app) {
        return Err(look_error("Press the button to ask for the permission.", "LOOK_NOT_A_PRESS"));
    }
    capture::request();
    crate::update_config(&app, |c| c.screen_help_asked = true);
    Ok(status(&app))
}

/// Opens System Settings › Privacy & Security › Screen Recording. The address is fixed; the page passes none.
#[tauri::command]
pub async fn look_open_privacy_settings(app: AppHandle) {
    use tauri_plugin_opener::OpenerExt;
    if cfg!(target_os = "macos") {
        let _ = app.opener().open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture", None::<&str>);
    }
}

/// The Look button (A.2.7): a look without the keys, so without a pointer, of the display the notch is on.
#[tauri::command]
pub async fn look_now(app: AppHandle) -> Result<(), ApiError> {
    if !capture::supported() {
        refuse(&app, Refusal::Unsupported);
        return Ok(());
    }
    if !signed_in(&app) {
        return Err(ApiError::new(401, "Not signed in."));
    }
    if !opted_in(&app) {
        return Err(look_error("Turn on screen help first.", "LOOK_OFF"));
    }
    if !is_person_press(&app) {
        return Err(look_error("Press Look to let her look.", "LOOK_NOT_A_PRESS"));
    }
    if answer_first(&app) {
        refuse(&app, Refusal::AnswerFirst);
        return Ok(());
    }
    if act::live(&app) && !act::busy_file(&app) {
        refuse(&app, Refusal::Busy);
        return Ok(());
    }
    if let Some(r) = rules_refusal(rules_seen(&app.state::<Look>())) {
        refuse(&app, r);
        return Ok(());
    }
    begin(&app, Source::Button);
    Ok(())
}

/// Takes the look's picture, waiting a moment if it is still being taken.
async fn take_capture(app: &AppHandle, look_id: &str) -> Option<Capture> {
    let look = app.state::<Look>();
    let until = Instant::now() + CAPTURE_WAIT;
    loop {
        if let Some(c) = look.store.lock().unwrap().take(look_id) {
            return Some(c);
        }
        let waiting = look.pending.lock().unwrap().as_ref().is_some_and(|p| p.id == look_id && p.phase != Phase::Refused && current(&look, p.gen));
        if !waiting || Instant::now() >= until {
            return None;
        }
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(30))).await;
    }
}

/// Send (B.3): the look's pictures, the person's question and the chat so far go to Boredroom's look route, at once
/// after the words are written out (or from the preview's Send). The question must be the person's own: Rust's
/// transcript of this look (`voice`), or typed with a real press (`typed`).
#[tauri::command]
pub async fn look_send(app: AppHandle, look_id: String, question: String, messages: Vec<Value>, lane: Option<String>) -> Result<Value, ApiError> {
    // The lane (helpers-spec J.5) only from this build's front desk, and only one it knows.
    let lane = lane.filter(|l| ["auto", "now", "think"].contains(&l.as_str()) && crate::front::ready(&app));
    check_send(&question, &messages)?;
    if answer_first(&app) {
        refuse(&app, Refusal::AnswerFirst);
        return Err(look_error("Answer this one first.", "LOOK_ANSWER_FIRST"));
    }
    let look = app.state::<Look>();
    if look.sending.swap(true, Ordering::SeqCst) {
        return Err(look_error("She is still looking at the last one.", "LOOK_BUSY"));
    }
    let _sending = Sending(&look.sending);
    let Some(capture) = take_capture(&app, &look_id).await else {
        return Err(look_error("That picture is gone. Look again.", "LOOK_GONE"));
    };
    if !opted_in(&app) {
        return Err(look_error("Screen help is off on this Mac.", "LOOK_OFF"));
    }
    match rules_refusal(rules_seen(&look)) {
        None => {}
        Some(Refusal::Offline) => return Err(look_error("I can't reach Boredroom right now, so I didn't send it.", "LOOK_OFFLINE")),
        Some(_) => return Err(look_error("Screen help isn't on in this workspace.", "LOOK_NOT_AVAILABLE")),
    }
    let app2 = app.clone();
    let calls = tauri::async_runtime::spawn_blocking(move || call_state(&app2)).await.unwrap_or(Err(Refusal::CallUnknown));
    match calls {
        Err(Refusal::OnCall) => return Err(look_error("I don't look at the screen during a Boredroom call.", "LOOK_ON_CALL")),
        Err(_) => return Err(look_error("I couldn't check whether you're on a call, so I didn't send it.", "LOOK_CALL_UNKNOWN")),
        Ok(()) => {}
    }
    let heard = look.heard.lock().unwrap().clone();
    let via = request_via(&question, heard.as_ref().map(|(id, w, _)| (id.as_str(), w.as_str())), &look_id, is_person_press(&app));
    let Some(via) = via else { return Err(look_error("Press Enter to send your question.", "LOOK_NOT_A_PRESS")) };
    let age_ms = if via == "voice" { heard.map(|(_, _, at)| at.elapsed().as_millis() as u64).unwrap_or(0) } else { press_age_ms() };
    let request = Request { text: question.trim().to_string(), via, age_ms: age_ms.min(120_000) };
    stream_look_lane(&app, capture, request, messages, look_id, lane).await
}

/// Rust's own transcript of the last look: (look id, words).
pub fn heard(app: &AppHandle) -> Option<(String, String)> {
    app.try_state::<Look>()?.heard.lock().unwrap().as_ref().map(|(id, w, _)| (id.clone(), w.clone()))
}

/// How long ago a look's words were heard (ms), for `request.ageMs`.
pub fn heard_age_ms(app: &AppHandle, look_id: &str) -> u64 {
    app.try_state::<Look>().and_then(|l| l.heard.lock().unwrap().as_ref().filter(|(id, _, _)| id == look_id).map(|(_, _, at)| at.elapsed().as_millis() as u64)).unwrap_or(0).min(120_000)
}

/// What the front desk may know of a look's pictures before deciding (helpers-spec B.4): whether they are there, the
/// app under the pointer, and the files and folders the person pointed at (paths stay here).
pub struct CaptureInfo {
    pub pictures: bool,
    pub candidates: Vec<Candidate>,
}

pub fn capture_info(app: &AppHandle, look_id: &str) -> Option<CaptureInfo> {
    let look = app.try_state::<Look>()?;
    let store = look.store.lock().unwrap();
    let c = store.held.as_ref().filter(|c| c.id == look_id)?;
    Some(CaptureInfo { pictures: c.screen.is_some(), candidates: c.candidates.clone() })
}

/// Waits (≤ 4 s) for a look's picture to land, and says whether it did (the front desk asks before deciding).
pub async fn capture_ready(app: &AppHandle, look_id: &str) -> bool {
    let until = Instant::now() + CAPTURE_WAIT;
    loop {
        if capture_info(app, look_id).is_some() {
            return true;
        }
        let look = app.state::<Look>();
        let waiting = look.pending.lock().unwrap().as_ref().is_some_and(|p| p.id == look_id && p.phase != Phase::Refused && current(&look, p.gen));
        if !waiting || Instant::now() >= until {
            return false;
        }
        let _ = tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(30))).await;
    }
}

/// The front desk's look (helpers-spec P.4 step 3, J): a question with pictures goes at once with `front: 1` and its
/// lane. The words were checked by `front_send` (the person's own); the checks of `look_send` apply.
pub async fn front_look(app: &AppHandle, look_id: &str, question: &str, messages: Vec<Value>, via: &'static str, lane: &str) -> Result<Value, ApiError> {
    check_send(question, &messages)?;
    let look = app.state::<Look>();
    if look.sending.swap(true, Ordering::SeqCst) {
        return Err(look_error("She is still looking at the last one.", "LOOK_BUSY"));
    }
    let _sending = Sending(&look.sending);
    let Some(capture) = take_capture(app, look_id).await else {
        return Err(look_error("That picture is gone. Look again.", "LOOK_GONE"));
    };
    if !opted_in(app) {
        return Err(look_error("Screen help is off on this Mac.", "LOOK_OFF"));
    }
    match rules_refusal(rules_seen(&look)) {
        None => {}
        Some(Refusal::Offline) => return Err(look_error("I can't reach Boredroom right now, so I didn't send it.", "LOOK_OFFLINE")),
        Some(_) => return Err(look_error("Screen help isn't on in this workspace.", "LOOK_NOT_AVAILABLE")),
    }
    match call_state_async(app).await {
        Err(Refusal::OnCall) => return Err(look_error("I don't look at the screen during a Boredroom call.", "LOOK_ON_CALL")),
        Err(_) => return Err(look_error("I couldn't check whether you're on a call, so I didn't send it.", "LOOK_CALL_UNKNOWN")),
        Ok(()) => {}
    }
    let age_ms = if via == "voice" { heard_age_ms(app, look_id) } else { press_age_ms() };
    let request = Request { text: question.trim().to_string(), via, age_ms };
    stream_look_lane(app, capture, request, messages, look_id.to_string(), Some(lane.to_string())).await
}

/// The pictures of a look the front desk handled itself are wiped (nothing left the Mac).
pub fn discard(app: &AppHandle, look_id: &str) {
    let Some(look) = app.try_state::<Look>() else { return };
    let _ = look.store.lock().unwrap().take(look_id);
    let is_current = look.pending.lock().unwrap().as_ref().is_some_and(|p| p.id == look_id && p.gen == look.gen.load(Ordering::SeqCst));
    if is_current {
        look.gen.fetch_add(1, Ordering::SeqCst);
    }
    companion::exchange_end(app, false);
}

/// A follow-up typed in the reply card within a minute (A.12): the same pictures, a new request.
#[tauri::command]
pub async fn look_follow_up(app: AppHandle, question: String, messages: Vec<Value>) -> Result<Value, ApiError> {
    check_send(&question, &messages)?;
    if answer_first(&app) {
        refuse(&app, Refusal::AnswerFirst);
        return Err(look_error("Answer this one first.", "LOOK_ANSWER_FIRST"));
    }
    if !is_person_press(&app) {
        return Err(look_error("Press Enter to send your question.", "LOOK_NOT_A_PRESS"));
    }
    let look = app.state::<Look>();
    if look.sending.swap(true, Ordering::SeqCst) {
        return Err(look_error("She is still looking at the last one.", "LOOK_BUSY"));
    }
    let _sending = Sending(&look.sending);
    let id = new_id(&look);
    let capture = {
        let held = look.held.lock().unwrap();
        held.as_ref().filter(|h| Instant::now() < h.until).map(|h| h.capture.duplicate(id.clone(), Source::FollowUp))
    };
    let Some(capture) = capture else {
        return Err(look_error(format!("Those pictures are gone. Hold {} and ask again.", LOOK_KEYS.name), "LOOK_GONE"));
    };
    if let Err(Refusal::OnCall) = call_state_async(&app).await {
        return Err(look_error("I don't look at the screen during a Boredroom call.", "LOOK_ON_CALL"));
    }
    let request = Request { text: question.trim().to_string(), via: "typed", age_ms: press_age_ms() };
    stream_look(&app, capture, request, messages, id).await
}

async fn call_state_async(app: &AppHandle) -> Result<(), Refusal> {
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || call_state(&app2)).await.unwrap_or(Err(Refusal::CallUnknown))
}

/// At most `max` UTF-16 units of `s` (the server counts a message's length as JavaScript does), never splitting a character.
pub fn clip_utf16(s: &str, max: usize) -> String {
    let mut n = 0;
    s.chars().take_while(|c| {
        n += c.len_utf16();
        n <= max
    }).collect()
}

/// The held pictures, copied for a new request (0.5) at the moment the answer is decided, before the task's end lets
/// them go (integration, 12 October 2026: the new request now waits for the server to record the no first).
pub fn held_for_new_request(app: &AppHandle) -> Option<Capture> {
    let look = app.try_state::<Look>()?;
    let id = new_id(&look);
    let held = look.held.lock().unwrap();
    held.as_ref().map(|h| h.capture.duplicate(id, Source::FollowUp))
}

/// A no or unclear answer that was really a new request (0.5): Rust sends the person's words itself, with the pictures
/// still held (`held_for_new_request`), so the only thing that can come of it is a new proposal (which needs its own
/// yes). Without held pictures nothing is sent: a look needs a hold of her keys.
pub fn new_request(app: &AppHandle, capture: Option<Capture>, words: String, via: &'static str) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let look = app.state::<Look>();
        let Some(capture) = capture else {
            emit(&app, LookEvent::Error { look_id: None, message: format!("Hold {} and ask me that, so I can see your screen.", LOOK_KEYS.name) });
            return;
        };
        let id = capture.id.clone();
        if look.sending.swap(true, Ordering::SeqCst) {
            return;
        }
        let _sending = Sending(&look.sending);
        let mut messages = look.last_messages.lock().unwrap().clone();
        messages.push(json!({ "role": "user", "content": words }));
        while messages.len() > MAX_MESSAGES {
            messages.remove(0);
        }
        if check_send(&words, &messages).is_err() {
            return;
        }
        let request = Request { text: words.trim().to_string(), via, age_ms: 0 };
        match stream_look(&app, capture, request, messages, id.clone()).await {
            Ok(result) => emit(&app, LookEvent::Result { look_id: id, result }),
            Err(e) => emit(&app, LookEvent::Error { look_id: Some(id), message: e.message }),
        }
    });
}

/// A dropped file's request (A.8, `act_file_from_drop`): no picture, only the files, the person's typed words.
pub async fn send_drop(app: AppHandle, question: String, candidates: Vec<Candidate>) -> Result<Value, ApiError> {
    let messages = vec![json!({ "role": "user", "content": question })];
    check_send(&question, &messages)?;
    let look = app.state::<Look>();
    if look.sending.swap(true, Ordering::SeqCst) {
        return Err(look_error("She is still looking at the last one.", "LOOK_BUSY"));
    }
    let _sending = Sending(&look.sending);
    let id = new_id(&look);
    let capture = Capture {
        id: id.clone(),
        screen: None,
        crop: None,
        geometry: None,
        hidden: vec![],
        app_name: None,
        bundle_id: None,
        desktop: false,
        source: Source::Drop,
        taken: Instant::now(),
        candidates,
        front_pid: capture::person_front(&app).map(|f| f.pid),
        pointer: None,
    };
    let request = Request { text: question.trim().to_string(), via: "typed", age_ms: press_age_ms() };
    stream_look(&app, capture, request, messages, id).await
}

/// The follow-up pictures are dropped now (the reply card closed).
#[tauri::command]
pub async fn look_drop_held(app: AppHandle) {
    if !app.state::<Look>().keep_held.load(Ordering::SeqCst) {
        drop_held(&app);
    }
}

/// Don't send, Esc, closing the card: the picture is dropped and wiped; nothing left the Mac.
#[tauri::command]
pub async fn look_discard(app: AppHandle, look_id: String) {
    let look = app.state::<Look>();
    let _ = look.store.lock().unwrap().take(&look_id);
    let is_current = look.pending.lock().unwrap().as_ref().is_some_and(|p| p.id == look_id && p.gen == look.gen.load(Ordering::SeqCst));
    if is_current {
        look.gen.fetch_add(1, Ordering::SeqCst); // a picture still being taken is dropped when it lands
        voice::cancel_look_recording(&app, &look_id);
        companion::exchange_end(&app, false);
    }
}

/// The page's word on Boredroom calls after each `/calls/now` answer (and `false` on sign-out). A call starting stops
/// any screen task at once.
#[tauri::command]
pub async fn set_call_state(app: AppHandle, live: bool) {
    *app.state::<Look>().call.lock().unwrap() = Some((live, Instant::now()));
    if live {
        act::stop(&app, "call");
        companion::cancel_pointing(&app);
    }
    companion::wake(&app);
}

/// A never-look rule as the page sends it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleIn {
    name: String,
    #[serde(default)]
    bundle_id: Option<String>,
    source: String,
}

pub const MAX_RULES: usize = 100;
const MAX_RULE_CHARS: usize = 255;

/// The rules as the page sends them, checked (≤ 100, strings ≤ 255, source "workspace" or "you").
pub fn rules_of(never_look: Vec<RuleIn>) -> Result<Vec<Rule>, ApiError> {
    if never_look.len() > MAX_RULES {
        return Err(look_error("Too many apps on the never-look lists.", "LOOK_RULES"));
    }
    never_look
        .into_iter()
        .map(|r| {
            let source = match r.source.as_str() {
                "workspace" => RuleSource::Workspace,
                "you" => RuleSource::You,
                _ => return Err(look_error("Unknown never-look list.", "LOOK_RULES")),
            };
            if r.name.chars().count() > MAX_RULE_CHARS || r.bundle_id.as_ref().is_some_and(|b| b.chars().count() > MAX_RULE_CHARS) {
                return Err(look_error("A never-look app's name is too long.", "LOOK_RULES"));
            }
            Ok(Rule { name: r.name, bundle_id: r.bundle_id, source })
        })
        .collect()
}

/// The workspace's rules from the desktop state (A.10), trusted for 120 s; also whether on-screen actions are allowed
/// here and which look version the server takes (D.4). Refreshes the tray.
#[tauri::command]
pub async fn set_look_rules(app: AppHandle, available: bool, reason: Option<String>, never_look: Vec<RuleIn>, act_available: Option<bool>, server_v: Option<u32>, front: Option<FrontIn>) -> Result<LookStatus, ApiError> {
    let _ = reason; // the page shows the reason; here only "available" matters
    let rules = rules_of(never_look)?;
    let act_ok = act_available == Some(true);
    // An older page sends no `front`: the front desk stays off (helpers-spec 0b.1).
    crate::front::set_rules(&app, front.unwrap_or_default(), available && act_ok);
    *app.state::<Look>().rules.lock().unwrap() = Some(Rules { available, never_look: rules, at: Instant::now(), act_available: act_ok, server_v: server_v.unwrap_or(1).min(2) });
    if !act_ok || !available {
        // The workspace switched it off: a running task stops (owner switch, 0b.12).
        if act::live(&app) {
            act::stop(&app, "button");
        }
        // Review, 16 October 2026: a background job stops too.
        crate::jobs::switched_off(&app);
    }
    crate::refresh_tray(&app);
    Ok(status(&app))
}

/// A real 40 × 24 JPEG (the server's integration tests use the same one), for the contract check with the server's own
/// readers (integration, 12 October 2026).
#[cfg(test)]
pub(crate) const SEAM_JPEG: &str = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAYACgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD6D1/WbfQ7NLm7SV43kEYEQBOSCe5HpXP/APCw9J/5977/AL4T/wCKo+Kn/IvW/wD19L/6A9eWV8rm+b4jCYh0qTVrLofWZPk+GxeGVWqne76ns2geKrHXLx7a0iuUkSMyEyqoGAQOxPrW/Xlnwr/5GG4/69W/9DSvU69fKMVUxeHVWrvdnj5xhKeExLpUtrIKKKK9M8sKKKKACiiigAooooA//9k=";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CC: u64 = FLAG_CONTROL | FLAG_COMMAND;

    fn t(now_ms: u64, flags: u64) -> Tick {
        Tick { now_ms, flags, key_age_ms: None, locked: false }
    }

    /// Feeds ticks every 33 ms from `from` to `to` with `flags`; returns the events.
    fn feed(m: &mut ChordMachine, from: u64, to: u64, flags: u64) -> Vec<ChordEvent> {
        let mut out = vec![];
        let mut now = from;
        while now <= to {
            out.extend(m.step(t(now, flags)));
            now += 33;
        }
        out
    }

    #[test]
    fn the_keys_are_control_and_command_held_for_300_ms() {
        assert_eq!(LOOK_KEYS.flags, 0x0004_0000 | 0x0010_0000);
        assert_eq!(LOOK_KEYS.name, "Control+Command");
        assert_eq!(LOOK_KEYS.symbols, "⌃ ⌘");
        assert_eq!(LOOK_KEYS.hold_ms, 300);
        assert_eq!(LOOK_KEYS.flags & FLAG_OPTION, 0, "never Control+Option (VoiceOver's key)");
    }

    #[test]
    fn an_exact_hold_starts_and_letting_go_releases() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        assert_eq!(feed(&mut m, 0, 290, CC), vec![]);
        assert_eq!(m.step(t(300, CC)), Some(ChordEvent::Start));
        assert_eq!(feed(&mut m, 333, 2000, CC), vec![]);
        assert_eq!(m.step(t(2033, 0)), Some(ChordEvent::Release));
        assert_eq!(m.state, ChordState::Idle);
    }

    #[test]
    fn a_short_tap_does_nothing() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        assert_eq!(feed(&mut m, 0, 200, CC), vec![]);
        assert_eq!(m.step(t(233, 0)), None);
        assert_eq!(m.state, ChordState::Idle);
    }

    #[test]
    fn shift_option_or_fn_present_never_start() {
        for extra in [FLAG_SHIFT, FLAG_OPTION, FLAG_FN] {
            let mut m = ChordMachine::new(&LOOK_KEYS);
            assert_eq!(feed(&mut m, 0, 1000, CC | extra), vec![], "extra {extra:#x}");
        }
    }

    #[test]
    fn caps_lock_is_ignored() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        assert_eq!(feed(&mut m, 0, 330, CC | FLAG_CAPS_LOCK), vec![ChordEvent::Start]);
    }

    #[test]
    fn a_key_while_arming_never_starts_until_fully_released() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        m.step(t(0, CC));
        // A key (e.g. Space for the emoji picker) went down 10 ms ago, after the chord began.
        assert_eq!(m.step(Tick { now_ms: 100, flags: CC, key_age_ms: Some(10), locked: false }), None);
        assert_eq!(m.state, ChordState::WaitRelease);
        assert_eq!(feed(&mut m, 133, 1000, CC), vec![]);
        m.step(t(1033, 0));
        assert_eq!(m.state, ChordState::Idle);
    }

    #[test]
    fn a_key_before_the_chord_does_not_count() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        m.step(t(1000, CC));
        // The last key went down 5 s ago, long before the chord.
        assert_eq!(m.step(Tick { now_ms: 1300, flags: CC, key_age_ms: Some(5000), locked: false }), Some(ChordEvent::Start));
    }

    #[test]
    fn a_key_while_holding_cancels() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        assert_eq!(feed(&mut m, 0, 330, CC), vec![ChordEvent::Start]);
        assert_eq!(m.step(Tick { now_ms: 600, flags: CC, key_age_ms: Some(20), locked: false }), Some(ChordEvent::Cancel(CancelReason::Keys)));
        assert_eq!(m.step(t(633, 0)), None, "no Release after a Cancel");
    }

    #[test]
    fn adding_shift_while_holding_cancels() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        feed(&mut m, 0, 330, CC);
        assert_eq!(m.step(t(400, CC | FLAG_SHIFT)), Some(ChordEvent::Cancel(CancelReason::Keys)));
    }

    #[test]
    fn locking_cancels_and_nothing_arms_while_locked() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        feed(&mut m, 0, 330, CC);
        assert_eq!(m.step(Tick { now_ms: 400, flags: CC, key_age_ms: None, locked: true }), Some(ChordEvent::Cancel(CancelReason::Locked)));
        let mut m = ChordMachine::new(&LOOK_KEYS);
        for now in (0..1000).step_by(33) {
            assert_eq!(m.step(Tick { now_ms: now, flags: CC, key_age_ms: None, locked: true }), None);
        }
    }

    #[test]
    fn letting_go_of_one_key_releases_and_waits_for_the_other() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        feed(&mut m, 0, 330, CC);
        assert_eq!(m.step(t(500, FLAG_COMMAND)), Some(ChordEvent::Release));
        assert_eq!(m.state, ChordState::WaitRelease);
        // Pressing Control again with Command still down does not re-arm.
        assert_eq!(feed(&mut m, 533, 1500, CC), vec![]);
        m.step(t(1533, 0));
        assert_eq!(feed(&mut m, 1566, 3000, CC), vec![ChordEvent::Start]);
    }

    #[test]
    fn re_arms_only_after_a_full_release() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        m.step(t(0, CC | FLAG_SHIFT));
        assert_eq!(m.state, ChordState::Idle);
        m.step(t(33, CC));
        m.step(t(66, CC | FLAG_SHIFT)); // Shift joined while arming: wait for a full release
        assert_eq!(m.state, ChordState::WaitRelease);
        assert_eq!(feed(&mut m, 100, 800, CC), vec![]);
    }

    #[test]
    fn looks_are_at_least_1_5_s_apart() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        assert_eq!(feed(&mut m, 0, 330, CC), vec![ChordEvent::Start]); // starts at 330
        assert_eq!(m.step(t(400, 0)), Some(ChordEvent::Release));
        // Pressed again at 500: held past 300 ms, but the start waits for 330 + 1500.
        let events = feed(&mut m, 500, 2000, CC);
        assert_eq!(events, vec![ChordEvent::Start]);
        let mut m2 = ChordMachine::new(&LOOK_KEYS);
        feed(&mut m2, 0, 330, CC);
        m2.step(t(400, 0));
        let mut started_at = None;
        let mut now = 500;
        while now <= 2000 {
            if m2.step(t(now, CC)) == Some(ChordEvent::Start) {
                started_at = Some(now);
            }
            now += 33;
        }
        assert!(started_at.unwrap() >= 330 + COOLDOWN_MS);
    }

    #[test]
    fn disarming_mid_hold_cancels() {
        let mut m = ChordMachine::new(&LOOK_KEYS);
        feed(&mut m, 0, 330, CC);
        assert_eq!(m.disarm(), Some(ChordEvent::Cancel(CancelReason::Keys)));
        assert_eq!(m.disarm(), None);
    }

    #[test]
    fn uninformative_key_ages_go_quiet() {
        assert_eq!(age_ms(0.25), Some(250));
        assert_eq!(age_ms(f64::NAN), None);
        assert_eq!(age_ms(f64::INFINITY), None);
        assert_eq!(age_ms(2_000_000.0), None);
        assert_eq!(age_ms(-1.0), None);
    }

    fn app(id: Option<&str>, names: &[&str]) -> AppId {
        AppId { bundle_id: id.map(String::from), names: names.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn the_fixed_list_matches_by_id_prefix_and_name() {
        assert_eq!(never_look(&app(Some("com.1password.1password"), &["1Password"]), &[]).unwrap().name, "1Password");
        assert_eq!(never_look(&app(Some("com.1password.someday"), &["X"]), &[]).unwrap().name, "1Password", "prefix");
        assert_eq!(never_look(&app(Some("COM.APPLE.MOBILESMS"), &[]), &[]).unwrap().name, "Messages", "case");
        assert_eq!(never_look(&app(None, &["zoom.us"]), &[]).unwrap().name, "Zoom", "name");
        assert_eq!(never_look(&app(Some("com.apple.LocalAuthentication.UIAgent"), &[]), &[]).unwrap().name, "Sign-in and password prompts");
        assert_eq!(never_look(&app(Some("com.apple.systempreferences"), &["System Settings"]), &[]).unwrap().source, RuleSource::Fixed);
        assert_eq!(never_look(&app(Some("cc.boredroom.brenda"), &[]), &[]).unwrap().name, "Brenda");
        assert_eq!(never_look(&app(Some("com.figma.Desktop"), &["Figma"]), &[]), None);
        assert_eq!(never_look(&app(None, &[""]), &[]), None, "an empty name matches nothing");
    }

    #[test]
    fn the_fixed_table_is_the_contracts() {
        assert_eq!(FIXED_NEVER_LOOK.len(), 32);
        let ids: Vec<&str> = FIXED_NEVER_LOOK.iter().flat_map(|f| f.ids.iter().copied()).collect();
        for id in ["com.bitwarden.desktop", "com.apple.keychainaccess", "com.tinyspeck.slackmacgap", "us.zoom.xos", "com.microsoft.teams2", "com.apple.FaceTime", "com.apple.systempreferences", "com.apple.SecurityAgent"] {
            assert!(ids.contains(&id), "{id}");
        }
        for f in FIXED_NEVER_LOOK {
            assert!(["password", "messaging", "calls", "system"].contains(&f.category), "{}", f.name);
        }
    }

    #[test]
    fn workspace_and_personal_rules_match_by_id_or_name() {
        let rules = vec![
            Rule { name: "Outlook".into(), bundle_id: Some("com.microsoft.Outlook".into()), source: RuleSource::Workspace },
            Rule { name: "Banking".into(), bundle_id: None, source: RuleSource::You },
            Rule { name: "Excel".into(), bundle_id: None, source: RuleSource::You },
        ];
        let m = never_look(&app(Some("com.microsoft.outlook"), &["Microsoft Outlook"]), &rules).unwrap();
        assert_eq!((m.source, m.name.as_str()), (RuleSource::Workspace, "Outlook"));
        let m = never_look(&app(Some("com.bank.app"), &["banking"]), &rules).unwrap();
        assert_eq!((m.source, m.name.as_str()), (RuleSource::You, "Banking"));
        assert_eq!(never_look(&app(Some("com.figma.Desktop"), &["Figma"]), &rules), None);
        // The fixed list comes first.
        let both = vec![Rule { name: "Slack".into(), bundle_id: None, source: RuleSource::You }];
        assert_eq!(never_look(&app(None, &["Slack"]), &both).unwrap().source, RuleSource::Fixed);
    }

    #[test]
    fn previews_fit_720_by_440() {
        assert_eq!(fit_within(1512, 982, PREVIEW_W, PREVIEW_H), (677, 440));
        assert_eq!(fit_within(300, 200, PREVIEW_W, PREVIEW_H), (300, 200));
        assert_eq!(fit_within(2576, 400, PREVIEW_W, PREVIEW_H), (720, 112));
    }

    #[test]
    fn cocoa_points_turn_top_left() {
        assert_eq!(cocoa_to_top_left(10.0, 900.0, 982.0), (10.0, 82.0));
        assert_eq!(cocoa_to_top_left(0.0, 982.0, 982.0), (0.0, 0.0));
    }

    #[test]
    fn call_checks_fail_closed() {
        assert_eq!(call_check(Some((true, 0)), CALL_FRESH_MS), CallCheck::Live);
        assert_eq!(call_check(Some((true, 60_000)), CALL_FRESH_MS), CallCheck::Live);
        assert_eq!(call_check(Some((false, 2_000)), CALL_FRESH_MS), CallCheck::Clear);
        assert_eq!(call_check(Some((false, 16_000)), CALL_FRESH_MS), CallCheck::Stale);
        assert_eq!(call_check(None, CALL_FRESH_MS), CallCheck::Stale);
        assert!(live_of(&json!({ "active": { "id": "x" }, "ringing": [] })));
        assert!(live_of(&json!({ "active": null, "ringing": [{ "id": "y" }] })));
        assert!(!live_of(&json!({ "active": null, "ringing": [] })));
        assert!(!live_of(&json!({})));
    }

    fn pic(w: u32, h: u32, n: usize) -> Pic {
        Pic { jpeg: (0..n as u32).map(|i| (i % 251) as u8).collect(), width: w, height: h, pointer: Some(Point { x: w / 2, y: h / 2 }) }
    }

    fn geometry() -> LookGeometry {
        LookGeometry {
            display_id: 1,
            display: Bounds { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 },
            scale: 2.0,
            screen_w: 1568,
            screen_h: 1018,
            crop: Some(capture::CropGeom { area: Bounds { x: 532.0, y: 267.0, w: 448.0, h: 448.0 }, w: 896, h: 896 }),
        }
    }

    fn capture(id: &str, taken: Instant) -> Capture {
        Capture {
            id: id.into(),
            screen: Some(pic(1568, 1018, 3000)),
            crop: Some(pic(896, 896, 1000)),
            geometry: Some(geometry()),
            hidden: vec!["1Password".into()],
            app_name: Some("Figma".into()),
            bundle_id: Some("com.figma.Desktop".into()),
            desktop: false,
            source: Source::Keys,
            taken,
            candidates: vec![],
            front_pid: Some(9),
            pointer: Some((756.0, 491.0)),
        }
    }

    fn wiped() -> usize {
        WIPED.with(|w| w.get())
    }

    #[test]
    fn the_store_holds_one_picture() {
        let now = Instant::now();
        let mut s = Store::default();
        s.put(capture("a", now));
        assert!(s.take("b").is_none(), "a different id takes nothing");
        assert_eq!(s.held_id(), Some("a"));
        let before = wiped();
        s.put(capture("b", now));
        assert_eq!(wiped(), before + 1, "replacing drops the old one");
        assert!(s.take("a").is_none());
        let c = s.take("b").unwrap();
        assert!(s.held_id().is_none());
        drop(c);
        assert_eq!(wiped(), before + 2, "dropping wipes");
        s.put(capture("c", now));
        assert_eq!(s.expire(now + Duration::from_secs(60)), None);
        assert_eq!(s.expire(now + Duration::from_secs(121)).as_deref(), Some("c"));
        assert!(s.held_id().is_none());
    }

    #[test]
    fn held_pictures_last_a_minute_unless_a_question_waits() {
        let now = Instant::now();
        let until = now + FOLLOW_UP_FOR;
        assert!(!held_expired(until, now + Duration::from_secs(59), false));
        assert!(held_expired(until, now + Duration::from_secs(60), false));
        assert!(!held_expired(until, now + Duration::from_secs(90), true), "kept while a proposal from them waits");
        let c = capture("a", now);
        let d = c.duplicate("b".into(), Source::FollowUp);
        assert_eq!(d.screen.as_ref().unwrap().jpeg, c.screen.as_ref().unwrap().jpeg);
        assert_eq!(d.source, Source::FollowUp);
        assert_eq!(d.geometry, c.geometry);
    }

    #[test]
    fn wiping_zeroes_the_bytes() {
        let mut v = vec![1u8, 2, 3];
        wipe(&mut v);
        assert_eq!(v, vec![0, 0, 0]);
    }

    #[test]
    fn real_presses() {
        assert!(real_press(Some(0.2), Some(30.0), true, false), "a click on the island");
        assert!(!real_press(Some(0.2), Some(30.0), false, false), "a click elsewhere");
        assert!(!real_press(Some(3.0), Some(30.0), true, false), "an old click");
        assert!(real_press(Some(30.0), Some(0.1), false, true), "a key in the focused notch");
        assert!(!real_press(Some(30.0), Some(0.1), false, false), "a key elsewhere");
        assert!(real_press(None, None, true, false), "nothing known: over the island is enough");
        assert!(!real_press(None, None, false, false));
    }

    #[test]
    fn voice_request_needs_its_own_transcript() {
        let q = "How do I export this as a PDF?";
        assert_eq!(request_via(q, Some(("look1", "How do I export  this as a PDF?")), "look1", false), Some("voice"), "spaces folded");
        assert_eq!(request_via(q, Some(("look0", q)), "look1", false), None, "another look's words are not this one's");
        assert_eq!(request_via("Delete everything", Some(("look1", q)), "look1", false), None, "words the person didn't say");
        assert_eq!(request_via(q, None, "look1", false), None);
        assert_eq!(request_via(q, Some(("look1", "")), "look1", false), None);
    }

    #[test]
    fn typed_request_needs_a_real_press() {
        let q = "How do I export this as a PDF?";
        assert_eq!(request_via(q, None, "look1", true), Some("typed"));
        assert_eq!(request_via("something typed", Some(("look1", q)), "look1", true), Some("typed"), "edited words are typed words");
        assert_eq!(request_via("something typed", Some(("look1", q)), "look1", false), None, "and need the press");
    }

    /// Owner report, 28 October 2026: a look carries what Brenda did on this Mac lately, and nothing when she did nothing.
    #[test]
    fn body_v2_recent() {
        let c = capture("a", Instant::now());
        let messages = vec![json!({ "role": "user", "content": "Are you okay?" })];
        let req = Request { text: "Are you okay?".into(), via: "voice", age_ms: 900 };
        let ab = Abilities { use_mac: true, file_work: false, busy: None, plans: 1, accessibility: true, front: Some(1) };
        let recent = vec![json!({ "line": "Opened Brave Browser.", "minutesAgo": 1 })];
        let v: Value = serde_json::from_slice(&look_body_v2_recent(&c, &req, &ab, &messages, Some("auto"), &recent).unwrap().0).unwrap();
        assert_eq!(v["recent"], json!(recent));
        assert_eq!(v["front"], 1);
        let v: Value = serde_json::from_slice(&look_body_v2_lane(&c, &req, &ab, &messages, Some("auto")).unwrap().0).unwrap();
        assert!(v.get("recent").is_none(), "left out when empty, so an older server reads it as before");
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/look.rs")).unwrap();
        let at = src.find("async fn stream_look_lane(").expect("stream_look_lane");
        let sl = &src[at..at + src[at..].find("\n}\n").unwrap()];
        assert!(sl.contains("let recent = crate::front::recent_now(app);") && sl.contains("look_body_v2_recent("), "every v2 look sends the record");
    }

    #[test]
    fn body_v2() {
        let c = capture("a", Instant::now());
        let messages = vec![json!({ "role": "assistant", "content": "Hello", "tainted": false }), json!({ "role": "user", "content": "What is this?" })];
        let req = Request { text: "What is this?".into(), via: "voice", age_ms: 900 };
        let ab = Abilities { use_mac: true, file_work: false, busy: None, plans: 1, accessibility: false, front: None };
        let body = look_body_v2(&c, &req, &ab, &messages).unwrap();
        let text = std::str::from_utf8(&body.0).unwrap();
        assert!(!text.contains('\n'), "no line breaks");
        let v: Value = serde_json::from_str(text).unwrap();
        assert_eq!(v["version"], 2);
        assert_eq!(v["source"], "keys");
        assert_eq!(v["request"], json!({ "text": "What is this?", "via": "voice", "ageMs": 900 }));
        assert_eq!(v["screen"]["mediaType"], "image/jpeg");
        assert_eq!(v["screen"]["width"], 1568);
        assert_eq!(v["screen"]["pointer"], json!({ "x": 784, "y": 509 }));
        assert_eq!(v["crop"]["width"], 896);
        assert_eq!(v["display"], json!({ "widthPt": 1512.0, "heightPt": 982.0, "scale": 2.0 }));
        assert_eq!(v["app"], json!({ "name": "Figma", "bundleId": "com.figma.Desktop" }));
        assert_eq!(v["hidden"], json!(["1Password"]));
        assert_eq!(v["abilities"], json!({ "useMac": true, "fileWork": false, "busy": null, "plans": 1, "accessibility": false }));
        assert_eq!(v["files"], json!([]));
        assert_eq!(v["messages"], json!(messages));
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD.decode(v["screen"]["data"].as_str().unwrap()).unwrap();
        assert_eq!(&decoded, &c.screen.as_ref().unwrap().jpeg);
        // Files only with file work on, by name and kind, never a path.
        let mut c2 = capture("b", Instant::now());
        c2.candidates = vec![Candidate { source: filework::Source::Dropped, name: "Q3.pdf".into(), kind: filework::Kind::Pdf, bytes: 10, path: "/Users/x/Q3.pdf".into(), app: None }];
        c2.candidates.push(Candidate { source: filework::Source::FrontFolder, name: "Invoices".into(), kind: filework::Kind::Folder, bytes: 0, path: "/Users/x/Documents/Invoices".into(), app: None });
        let v: Value = serde_json::from_slice(&look_body_v2(&c2, &req, &Abilities { use_mac: false, file_work: true, busy: Some("file"), plans: 1, accessibility: true, front: None }, &messages).unwrap().0).unwrap();
        assert_eq!(v["files"], json!([{ "source": "dropped", "name": "Q3.pdf", "kind": "pdf", "bytes": 10 }, { "source": "front_folder", "name": "Invoices", "kind": "folder", "bytes": 0 }]), "folders by name only (companion2-spec C.1)");
        c2.candidates.pop();
        assert_eq!(v["abilities"]["busy"], "file");
        assert!(!serde_json::to_string(&v).unwrap().contains("/Users/x"));
        // A drop: no pictures, no app.
        c2.source = Source::Drop;
        c2.screen = None;
        c2.crop = None;
        c2.geometry = None;
        let v: Value = serde_json::from_slice(&look_body_v2(&c2, &req, &ab, &messages).unwrap().0).unwrap();
        assert_eq!((v["screen"].clone(), v["crop"].clone(), v["app"].clone(), v["display"].clone()), (Value::Null, Value::Null, Value::Null, Value::Null));
        assert_eq!(v["source"], "drop");
        // Over the body cap: refused.
        let mut big = capture("c", Instant::now());
        big.screen = Some(pic(1568, 1018, 3_100_000));
        assert_eq!(look_body_v2(&big, &req, &ab, &messages).err().unwrap().code.as_deref(), Some("PAYLOAD_TOO_LARGE"));
        // A v1 server: phase 1's body, the screen picture as the image.
        let v: Value = serde_json::from_slice(&look_body(&c, &messages).unwrap().0).unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(v["image"]["width"], 1568);
        assert_eq!(v["pointer"], json!({ "x": 784, "y": 509 }));
        assert!(v["image"].get("pointer").is_none());
        assert_eq!(v["app"]["name"], "Figma");
    }

    #[test]
    fn stream_lines() {
        let mut l = Lines::default();
        assert!(l.push(b"{\"t\":\"text\",\"d\":\"Hel").unwrap().is_empty());
        let got = l.push(b"lo\"}\n{\"t\":\"ping\"}\n\n{\"t\":\"say\",").unwrap();
        assert_eq!(got, vec![json!({ "t": "text", "d": "Hello" }), json!({ "t": "ping" })]);
        let got = l.push(b"\"text\":\"Hello.\",\"speech\":null}\n").unwrap();
        assert_eq!(line_of(&got[0]), Line::Say("Hello.".into(), Value::Null));
        assert!(l.push(b"{\"t\":\"done\",\"result\":{\"reply\":\"x\"}}").unwrap().is_empty(), "no newline yet");
        assert_eq!(line_of(&l.finish().unwrap().unwrap()), Line::Done(json!({ "reply": "x" })));
        // Unknown kinds are ignored; an error mid-stream ends it with its words.
        assert_eq!(line_of(&json!({ "t": "launch_missiles" })), Line::Ignore);
        assert_eq!(line_of(&json!({ "t": "propose" })), Line::Ignore, "a proposal without a task is nothing");
        assert_eq!(line_of(&json!({ "t": "error", "status": 429, "code": "AI_LIMIT", "message": "You've used today's requests." })), Line::Error(ApiError { status: 429, message: "You've used today's requests.".into(), code: Some("AI_LIMIT".into()) }));
        // A line over 1 MiB, a stream over 4 MB, or a line that isn't a JSON object ends the read.
        let mut l = Lines::default();
        assert_eq!(l.push(&vec![b'a'; MAX_LINE_BYTES + 2]), Err(StreamError::LineTooLong));
        let mut l = Lines::default();
        for _ in 0..3 {
            let _ = l.push(&vec![b' '; 1_000_000]);
        }
        assert_eq!(l.push(&vec![b'\n'; 1_000_001]), Err(StreamError::TooBig));
        let mut l = Lines::default();
        assert_eq!(l.push(b"[1,2]\n"), Err(StreamError::Unreadable));
        let mut l = Lines::default();
        assert_eq!(l.push(b"{not json}\n"), Err(StreamError::Unreadable));
    }

    #[test]
    fn point_to_global_maps_both_pictures() {
        let g = geometry();
        // The screen picture: 1568 px across 1512 points.
        let r = point_to_global(&json!({ "picture": "screen", "x": 784, "y": 509, "width": 0, "height": 0 }), &g).unwrap();
        assert!((r.x - (756.0 - 18.0)).abs() < 0.01 && (r.y - (491.0 - 18.0)).abs() < 0.5 && r.w == 36.0, "a point is a 36-point square: {r:?}");
        let r = point_to_global(&json!({ "picture": "screen", "x": 0, "y": 0, "width": 156, "height": 100 }), &g).unwrap();
        assert_eq!((r.x, r.y), (0.0, 0.0));
        assert!((r.w - 156.0 * 1512.0 / 1568.0).abs() < 0.01);
        // The close-up: its own pixels, through its square.
        let r = point_to_global(&json!({ "picture": "closeup", "x": 448, "y": 448, "width": 40, "height": 20 }), &g).unwrap();
        assert_eq!((r.x, r.y, r.w, r.h), (532.0 + 224.0, 267.0 + 224.0, 20.0, 10.0));
        // Slightly outside is the edge; far outside is dropped.
        assert!(point_to_global(&json!({ "picture": "screen", "x": -8, "y": -3, "width": 10, "height": 10 }), &g).is_some());
        assert!(point_to_global(&json!({ "picture": "screen", "x": -9, "y": 0, "width": 0, "height": 0 }), &g).is_none());
        assert!(point_to_global(&json!({ "picture": "screen", "x": 1600, "y": 0, "width": 0, "height": 0 }), &g).is_none());
        assert!(point_to_global(&json!({ "picture": "window", "x": 1, "y": 1, "width": 0, "height": 0 }), &g).is_none());
        // A secondary display with a negative origin.
        let mut g2 = g;
        g2.display = Bounds { x: -1920.0, y: -300.0, w: 1920.0, h: 1080.0 };
        g2.screen_w = 1568;
        g2.screen_h = 882;
        let r = point_to_global(&json!({ "picture": "screen", "x": 784, "y": 441, "width": 98, "height": 0 }), &g2).unwrap();
        assert!((r.x + 960.0 + 18.0).abs() < 0.01 || (r.x + 960.0).abs() < 0.01, "{r:?}");
        assert!(r.x >= -1920.0 && r.x + r.w <= 0.0, "clamped inside the display");
        // The snap rule.
        let d = Bounds { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 };
        assert!(snap_ok(Bounds { x: 100.0, y: 100.0, w: 80.0, h: 24.0 }, (120.0, 110.0), d));
        assert!(!snap_ok(Bounds { x: 100.0, y: 100.0, w: 80.0, h: 24.0 }, (300.0, 110.0), d), "must contain the point");
        assert!(!snap_ok(Bounds { x: 0.0, y: 0.0, w: 1512.0, h: 600.0 }, (10.0, 10.0), d), "at most 40 % of the display");
    }

    #[test]
    fn the_window_under_the_pointer() {
        let w = |id: u32, pid: i32, layer: i64, x: f64, y: f64, ww: f64, hh: f64| WindowInfo { id, pid, layer, alpha: 1.0, bounds: Bounds { x, y, w: ww, h: hh }, owner_name: format!("app{pid}") };
        let list = vec![
            w(1, 50, 25, 0.0, 0.0, 1512.0, 33.0),     // the menu bar (layer 25): skipped
            w(2, 1, 0, 516.0, 0.0, 480.0, 440.0),     // Brenda's notch window: skipped
            w(3, 7, 0, 100.0, 100.0, 800.0, 600.0),   // Figma
            w(4, 8, -2147483603, 0.0, 0.0, 1512.0, 982.0), // the desktop's icons
        ];
        assert_eq!(window_at(&list, (600.0, 200.0), 1).map(|w| w.id), Some(3));
        assert_eq!(window_at(&list, (1200.0, 900.0), 1).map(|w| w.id), Some(4), "the desktop");
        assert_eq!(window_at(&list, (600.0, 10.0), 1).map(|w| w.id), Some(4), "the menu bar and Brenda are skipped");
        assert_eq!(window_at(&[], (1.0, 1.0), 1), None);
    }

    #[test]
    fn exclusions_leave_out_brenda_and_hatch_never_look_apps() {
        let rules = vec![Rule { name: "Excel".into(), bundle_id: None, source: RuleSource::You }];
        let ex = exclusion(&rules, 42);
        assert_eq!(ex(&AppMeta { pid: 42, bundle_id: None, name: "brenda-desktop" }), Exclude::Own);
        assert_eq!(ex(&AppMeta { pid: 5, bundle_id: Some("cc.boredroom.brenda"), name: "Brenda" }), Exclude::Own);
        assert_eq!(ex(&AppMeta { pid: 6, bundle_id: Some("com.1password.1password"), name: "1Password" }), Exclude::Hidden("1Password".into()));
        assert_eq!(ex(&AppMeta { pid: 7, bundle_id: Some("com.microsoft.Excel"), name: "Microsoft Excel" }), Exclude::No, "a name rule needs the name");
        assert_eq!(ex(&AppMeta { pid: 7, bundle_id: Some("com.microsoft.Excel"), name: "Excel" }), Exclude::Hidden("Excel".into()));
        assert_eq!(ex(&AppMeta { pid: 8, bundle_id: Some("com.figma.Desktop"), name: "Figma" }), Exclude::No);
    }

    #[test]
    fn exact_size_buffers() {
        let v = json!({ "a": [1, 2, 3], "b": "x".repeat(100) });
        let b = to_wiped_json(&v, 1_000).unwrap();
        assert_eq!(b.0.len(), b.0.capacity(), "sized exactly, so it never grew");
        assert_eq!(serde_json::from_slice::<Value>(&b.0).unwrap(), v);
        assert!(to_wiped_json(&v, 10).is_none());
    }

    #[test]
    fn send_arguments_are_checked() {
        let q = "What is this?";
        let ok = vec![json!({ "role": "user", "content": q })];
        assert!(check_send(q, &ok).is_ok());
        assert!(check_send("  ", &ok).is_err());
        assert!(check_send(&"a".repeat(4001), &[json!({ "role": "user", "content": "a".repeat(4001) })]).is_err());
        assert!(check_send(q, &[]).is_err());
        assert!(check_send(q, &[json!({ "role": "user", "content": "something else" })]).is_err());
        assert!(check_send(q, &[json!({ "role": "assistant", "content": q })]).is_err());
        let many: Vec<Value> = (0..31).map(|_| json!({ "role": "user", "content": q })).collect();
        assert!(check_send(q, &many).is_err());
        let big = vec![json!({ "role": "assistant", "content": "x".repeat(410_000) }), json!({ "role": "user", "content": q })];
        assert!(check_send(q, &big).is_err());
    }

    #[test]
    fn only_rust_reaches_the_look_and_act_routes() {
        assert!(path_allowed("/api/orgs/acme/assistant/chat"));
        assert!(path_allowed("/api/orgs/acme/brenda/desktop"));
        assert!(path_allowed("/api/orgs/acme/assistant/looking-glass"));
        assert!(path_allowed("/api/orgs/acme/assistant/actions"));
        assert!(!path_allowed("/api/orgs/acme/assistant/look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/look/"));
        assert!(!path_allowed("/api/orgs/acme/assistant/look?x=1"));
        assert!(!path_allowed("/api/orgs/acme//assistant//look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/%6cook"));
        assert!(!path_allowed("/api/orgs/acme/Assistant/Look"));
        assert!(!path_allowed("/app/acme"));
        assert!(!path_allowed("https://evil.example/api/x"));
        // Dot segments, which reqwest's URL parser removes before sending (review, 11 October 2026).
        assert!(!path_allowed("/api/orgs/acme/assistant/./look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/%2e/look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/%2E/look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/x/../look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/x/%2e%2e/look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/x/.%2e/look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/%252e/look"));
        assert!(!path_allowed("/api/orgs/acme/assistant\\look"));
        assert!(!path_allowed("/api/orgs/acme/assistant/lo\tok"));
        assert!(!path_allowed("/api/orgs/acme/assistant%2flook"));
        assert!(!path_allowed("/api/orgs/acme/assistant/%256cook"));
        assert!(!path_allowed("/api/../app/acme"));
        assert!(path_allowed("/api/orgs/acme/brenda/desktop?opener=0"));
        assert!(path_allowed("/api/orgs/acme/assistant/speech"));
        // The act routes (owner rule, 12 October 2026): the page can never answer, step or stop a task through `api`.
        let id = "0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30";
        for tail in ["answer", "step", "step-answer", "stop", "file"] {
            assert!(!path_allowed(&format!("/api/orgs/acme/assistant/act/{id}/{tail}")), "{tail}");
            assert!(!path_allowed(&format!("/api/orgs/acme/assistant/ACT/{id}/{tail}")), "{tail}");
            assert!(!path_allowed(&format!("/api/orgs/acme/assistant/%61ct/{id}/{tail}")), "{tail}");
            assert!(!path_allowed(&format!("/api/orgs/acme/assistant/x/../act/{id}/{tail}")), "{tail}");
        }
    }

    #[test]
    fn stale_rules_say_offline_not_switched_off() {
        let fresh = Duration::from_secs(5);
        let stale = Duration::from_secs(121);
        assert_eq!(rules_refusal(Some((true, fresh))), None);
        assert_eq!(rules_refusal(Some((false, fresh))), Some(Refusal::NotAvailable));
        assert_eq!(rules_refusal(Some((true, stale))), Some(Refusal::Offline));
        assert_eq!(rules_refusal(Some((false, stale))), Some(Refusal::Offline));
        assert_eq!(rules_refusal(None), Some(Refusal::Offline));
        // The keys stay armed while the last word was "available", so a hold says why instead of nothing.
        assert!(keys_armed(true, true, Some((true, stale))));
        assert!(keys_armed(true, true, Some((true, fresh))));
        assert!(!keys_armed(true, true, Some((false, fresh))));
        assert!(!keys_armed(true, true, None));
        assert!(!keys_armed(false, true, Some((true, fresh))));
        assert!(!keys_armed(true, false, Some((true, fresh))));
    }

    #[test]
    fn permission_labels_and_consent() {
        assert_eq!(permission_label(true, false), "granted");
        assert_eq!(permission_label(true, true), "granted");
        assert_eq!(permission_label(false, true), "denied");
        assert_eq!(permission_label(false, false), "unknown");
        assert_eq!(consent_of(true, 0), 1, "every phase 1 opt-in sees the update first");
        assert_eq!(consent_of(true, 2), 2);
        assert_eq!(consent_of(false, 0), 0);
        assert_eq!(consent_of(false, 2), 2);
        assert_eq!(consent_of(true, 3), 3, "the setup card's consent (companion2-spec 0b.1)");
        assert_eq!(consent_of(false, 3), 3);
    }

    #[test]
    fn events_are_shaped_as_b11() {
        let v = serde_json::to_value(LookEvent::Preview { look_id: "ab".into(), source: Source::Keys, app: AppFull { name: "Figma".into(), bundle_id: None }, image: "data:image/jpeg;base64,AA".into(), width: 10, height: 20, pointer: None }).unwrap();
        assert_eq!(v, json!({ "phase": "preview", "lookId": "ab", "source": "keys", "app": { "name": "Figma", "bundleId": null }, "image": "data:image/jpeg;base64,AA", "width": 10, "height": 20, "pointer": null }));
        let v = serde_json::to_value(LookEvent::Refused { reason: Refusal::NeverLook, app: Some(AppName { name: "Slack".into() }), source: Some(RuleSource::Fixed) }).unwrap();
        assert_eq!(v, json!({ "phase": "refused", "reason": "never_look", "app": { "name": "Slack" }, "source": "fixed" }));
        for (r, s) in [(Refusal::Sharing, "sharing"), (Refusal::ConsentUpdate, "consent_update"), (Refusal::AnswerFirst, "answer_first"), (Refusal::CallUnknown, "call_unknown"), (Refusal::OwnWindow, "own_window")] {
            assert_eq!(serde_json::to_value(LookEvent::Refused { reason: r, app: None, source: None }).unwrap(), json!({ "phase": "refused", "reason": s }));
        }
        let v = serde_json::to_value(LookEvent::Cancelled { look_id: "ab".into(), reason: CancelReason::FrontChanged }).unwrap();
        assert_eq!(v, json!({ "phase": "cancelled", "lookId": "ab", "reason": "front_changed" }));
        let v = serde_json::to_value(LookEvent::Looking { look_id: "ab".into(), source: Source::Button, app: AppName { name: "your screen".into() }, listening: false, mic: None, desktop: false }).unwrap();
        assert_eq!(v, json!({ "phase": "looking", "lookId": "ab", "source": "button", "app": { "name": "your screen" }, "listening": false }));
        let v = serde_json::to_value(LookEvent::Looking { look_id: "ab".into(), source: Source::Keys, app: AppName { name: "your desktop".into() }, listening: false, mic: mic_label(voice::LookMic::Off), desktop: true }).unwrap();
        assert_eq!(v, json!({ "phase": "looking", "lookId": "ab", "source": "keys", "app": { "name": "your desktop" }, "listening": false, "mic": "off", "desktop": true }));
        assert_eq!(mic_label(voice::LookMic::NeedsModel), Some("needs-model"));
        assert_eq!(mic_label(voice::LookMic::Busy), Some("busy"));
        assert_eq!(mic_label(voice::LookMic::Started), None);
        assert_eq!(serde_json::to_value(LookEvent::Sending { look_id: "ab".into() }).unwrap(), json!({ "phase": "sending", "lookId": "ab" }));
        assert_eq!(serde_json::to_value(LookEvent::Text { look_id: "ab".into(), d: "Hi".into() }).unwrap(), json!({ "phase": "text", "lookId": "ab", "d": "Hi" }));
        assert_eq!(serde_json::to_value(LookEvent::Say { look_id: "ab".into(), text: "Hi.".into(), speech: Value::Null }).unwrap(), json!({ "phase": "say", "lookId": "ab", "text": "Hi.", "speech": null }));
        assert_eq!(serde_json::to_value(LookEvent::Point { look_id: "ab".into(), label: "Export".into() }).unwrap(), json!({ "phase": "point", "lookId": "ab", "label": "Export" }));
        assert_eq!(serde_json::to_value(LookEvent::Held { look_id: "ab".into(), until: 5 }).unwrap(), json!({ "phase": "held", "lookId": "ab", "until": 5 }));
        assert_eq!(serde_json::to_value(LookEvent::Dropped {}).unwrap(), json!({ "phase": "dropped" }));
        assert_eq!(serde_json::to_value(Source::FollowUp).unwrap(), json!("follow_up"));
        let v = serde_json::to_value(LookEvent::Error { look_id: None, message: "x".into() }).unwrap();
        assert_eq!(v, json!({ "phase": "error", "message": "x" }));
        let s = LookStatus { v: 3, supported: true, unsupported_reason: None, permission: "granted", on: false, on_at: None, keys: LOOK_KEYS.name, keys_label: LOOK_KEYS.symbols, armed: false, available: false, consent: 0, preview: false, companion: true, companion_shown: false, companion_why: "screen_help_off", front: None };
        assert_eq!(serde_json::to_value(s).unwrap(), json!({ "v": 3, "supported": true, "unsupportedReason": null, "permission": "granted", "on": false, "onAt": null, "keys": "Control+Command", "keysLabel": "⌃ ⌘", "armed": false, "available": false, "consent": 0, "preview": false, "companion": true, "companionShown": false, "companionWhy": "screen_help_off" }));
    }

    #[test]
    fn rules_from_the_page_are_checked() {
        let ok = rules_of(vec![RuleIn { name: "Mail".into(), bundle_id: Some("com.apple.mail".into()), source: "workspace".into() }]).unwrap();
        assert_eq!(ok[0].source, RuleSource::Workspace);
        assert!(rules_of(vec![RuleIn { name: "Mail".into(), bundle_id: None, source: "fixed".into() }]).is_err());
        assert!(rules_of(vec![RuleIn { name: "x".repeat(256), bundle_id: None, source: "you".into() }]).is_err());
        assert!(rules_of((0..101).map(|_| RuleIn { name: "a".into(), bundle_id: None, source: "you".into() }).collect()).is_err());
    }

    /// Her reply kept for a new request is cut as JavaScript counts (UTF-16 units), never in the middle of a character.
    #[test]
    fn replies_are_clipped_as_the_server_counts() {
        assert_eq!(clip_utf16("I'll rename them.", 4_000), "I'll rename them.");
        assert_eq!(clip_utf16("abc", 2), "ab");
        assert_eq!(clip_utf16("a😀b", 2), "a"); // the emoji is two units: it doesn't fit, and is never split
        assert_eq!(clip_utf16("a😀b", 3), "a😀");
        assert_eq!(clip_utf16(&"😀".repeat(3_000), 4_000).encode_utf16().count(), 4_000);
    }

    fn seam_dir() -> Option<String> {
        std::env::var("BRENDA_SEAM_DIR").ok().filter(|d| !d.is_empty())
    }

    fn seam_pic(w: u32, h: u32, pointer: Option<Point>) -> Pic {
        use base64::Engine;
        Pic { jpeg: base64::engine::general_purpose::STANDARD.decode(SEAM_JPEG).unwrap(), width: w, height: h, pointer }
    }

    /// The look bodies exactly as Rust writes them, for the server's own schema and readers to read back (the integrator's
    /// contract check, 12 October 2026). By hand only: `BRENDA_SEAM_DIR=<dir> cargo test --lib -- --ignored seam_`.
    #[test]
    #[ignore]
    fn seam_look_bodies() {
        let Some(dir) = seam_dir() else { return };
        let write = |name: &str, body: WipeOnDrop| std::fs::write(format!("{dir}/rust-{name}.json"), &body.0).unwrap();
        let q = "Rename these files to invoices";
        let messages = vec![json!({ "role": "assistant", "content": "Hello", "tainted": true }), json!({ "role": "user", "content": q })];
        let mut c = capture("seam", Instant::now());
        c.screen = Some(seam_pic(40, 24, Some(Point { x: 12, y: 9 })));
        c.crop = Some(seam_pic(40, 24, Some(Point { x: 20, y: 12 })));
        c.candidates = vec![
            Candidate { source: filework::Source::Dropped, name: "notes.txt".into(), kind: filework::Kind::Text, bytes: 120, path: "/Users/x/notes.txt".into(), app: None },
            Candidate { source: filework::Source::FinderSelection, name: "Q3 report.pdf".into(), kind: filework::Kind::Pdf, bytes: 2_104_331, path: "/Users/x/Q3 report.pdf".into(), app: None },
            Candidate { source: filework::Source::FrontDocument, name: "Plan.docx".into(), kind: filework::Kind::Document, bytes: 30_000, path: "/Users/x/Plan.docx".into(), app: Some(filework::SourceApp { name: "Pages".into(), bundle_id: Some("com.apple.iWork.Pages".into()) }) },
            Candidate { source: filework::Source::Pointer, name: "Budget.xlsx".into(), kind: filework::Kind::Spreadsheet, bytes: 9_000, path: "/Users/x/Budget.xlsx".into(), app: Some(filework::SourceApp { name: "Finder".into(), bundle_id: Some("com.apple.finder".into()) }) },
        ];
        let all = Abilities { use_mac: true, file_work: true, busy: None, plans: 1, accessibility: true, front: None };
        write("look-v2-keys", look_body_v2(&c, &Request { text: q.into(), via: "voice", age_ms: 900 }, &all, &messages).unwrap());
        write("look-v1", look_body(&c, &messages).unwrap());
        let mut desk = c.duplicate("seam-d".into(), Source::Keys);
        (desk.desktop, desk.app_name, desk.bundle_id) = (true, Some("Finder".into()), Some("com.apple.finder".into()));
        write("look-v2-desktop", look_body_v2(&desk, &Request { text: q.into(), via: "voice", age_ms: 900 }, &all, &messages).unwrap());
        let follow = c.duplicate("seam-f".into(), Source::FollowUp);
        write("look-v2-follow-up", look_body_v2(&follow, &Request { text: q.into(), via: "typed", age_ms: 40 }, &Abilities { use_mac: true, file_work: true, busy: Some("file"), plans: 1, accessibility: true, front: None }, &messages).unwrap());
        let mut button = capture("seam-b", Instant::now());
        (button.source, button.screen, button.crop, button.app_name, button.bundle_id) = (Source::Button, Some(seam_pic(40, 24, None)), None, None, None);
        write("look-v2-button", look_body_v2(&button, &Request { text: q.into(), via: "typed", age_ms: 300 }, &Abilities { use_mac: false, file_work: false, busy: None, plans: 1, accessibility: false, front: None }, &messages).unwrap());
        let mut drop = c.duplicate("seam-x".into(), Source::Drop);
        (drop.screen, drop.crop, drop.geometry) = (None, None, None);
        drop.candidates.truncate(1);
        let only = vec![json!({ "role": "user", "content": "Summarise this into a one-page brief" })];
        write("look-v2-drop", look_body_v2(&drop, &Request { text: "Summarise this into a one-page brief".into(), via: "typed", age_ms: 500 }, &all, &only).unwrap());
    }

    /// Helpers-spec T.2: a front desk look (`front: 1`, `lane`), as Rust writes it.
    #[test]
    #[ignore]
    fn seam_look_front() {
        let Some(dir) = seam_dir() else { return };
        let q = "What does this error mean?";
        let messages = vec![json!({ "role": "user", "content": q })];
        let mut c = capture("seam-front", Instant::now());
        c.screen = Some(seam_pic(40, 24, Some(Point { x: 12, y: 9 })));
        c.crop = Some(seam_pic(40, 24, Some(Point { x: 20, y: 12 })));
        let ab = Abilities { use_mac: true, file_work: true, busy: None, plans: 1, accessibility: true, front: Some(1) };
        let body = look_body_v2_lane(&c, &Request { text: q.into(), via: "voice", age_ms: 600 }, &ab, &messages, Some("auto")).unwrap();
        let v: Value = serde_json::from_slice(&body.0).unwrap();
        assert_eq!((v["front"].as_u64(), v["lane"].as_str(), v["abilities"]["front"].as_u64()), (Some(1), Some("auto"), Some(1)));
        std::fs::write(format!("{dir}/rust-look-front.json"), &body.0).unwrap();
    }

    /// Without the front desk, the look body is exactly phase 3's (no `front`, no `lane`).
    #[test]
    fn look_body_without_front_is_unchanged() {
        let messages = vec![json!({ "role": "user", "content": "What is this?" })];
        let mut c = capture("plain", Instant::now());
        c.screen = Some(seam_pic(40, 24, None));
        let ab = Abilities { use_mac: false, file_work: false, busy: None, plans: 1, accessibility: false, front: None };
        let v: Value = serde_json::from_slice(&look_body_v2(&c, &Request { text: "What is this?".into(), via: "typed", age_ms: 1 }, &ab, &messages).unwrap().0).unwrap();
        assert!(v.get("front").is_none() && v.get("lane").is_none() && v["abilities"].get("front").is_none());
    }

    /// The server's real answers (written by tests/integration/act-flow.test.ts with ACT_SEAM_DIR) through Rust's own
    /// stream reader: every line is read, the point lands on the screen, the proposal is whole (its hash is its plan).
    #[test]
    #[ignore]
    fn seam_server_lines() {
        let Some(dir) = seam_dir() else { return };
        for name in ["server-look-point.ndjson", "server-look-propose.ndjson"] {
            let bytes = std::fs::read(format!("{dir}/{name}")).unwrap();
            let mut lines = Lines::default();
            // In uneven chunks, as a network delivers them.
            let mut all = Vec::new();
            for chunk in bytes.chunks(37) {
                all.extend(lines.push(chunk).unwrap());
            }
            all.extend(lines.finish().unwrap());
            let mut kinds = Vec::new();
            for v in &all {
                match line_of(v) {
                    Line::Text(d) => { assert!(!d.is_empty()); kinds.push("text"); }
                    Line::Say(t, _) => { assert!(!t.is_empty()); kinds.push("say"); }
                    Line::Point(p) => { assert!(point_to_global(&p, &geometry()).is_some(), "{p}"); kinds.push("point"); }
                    Line::Propose(t) => {
                        let view: act::TaskView = serde_json::from_value(t).unwrap();
                        assert!(act::view_ok(&view) && act::plan_ok(&view), "{view:?}");
                        assert_eq!(view.question, "Do you want me to do this?");
                        kinds.push("propose");
                    }
                    Line::Done(r) => { assert!(r["reply"].as_str().is_some_and(|s| !s.is_empty())); kinds.push("done"); }
                    Line::Error(e) => panic!("{e:?}"),
                    Line::Ignore => kinds.push("ignored"),
                }
            }
            assert_eq!(kinds.last(), Some(&"done"), "{name}: {kinds:?}");
            if name.contains("point") {
                assert!(kinds.contains(&"text") && kinds.contains(&"say") && kinds.contains(&"point"), "{kinds:?}");
            } else {
                assert!(kinds.contains(&"propose"), "{kinds:?}");
            }
        }
    }
}
