//! Brenda's front desk (owner brief, 12 October 2026: "Do it now (front lane). Hold Control+Command (or type in the
//! notch). Common commands are recognised ON THE MAC with no AI call ('open Figma', 'volume down', 'hide everything',
//! 'quit Spotify', 'take a screenshot'…); everything else goes to a small fast model (claude-haiku-5-5) that picks the
//! lane"; permission rule v2: "when you hold the keys and clearly ask for a routine task, the request is the
//! permission, and she does it. She still asks before anything destructive, anything sent, anything that costs money,
//! or anything sensitive."; helpers-spec 0, A, B, C, E.3, P).
//!
//! What this file promises, and how:
//! - Only the person's request starts anything (0.3): `front_send` takes words only from Rust's own transcript of a hold
//!   of her keys (the look's, or the last Option+Space within 15 s) or words typed in the notch with a real press, each
//!   with a fresh nonce. No event, timer, server line or screen text reaches `run_actions` (a test greps the sources).
//! - The matcher (`match_command`, B.1) is pure and needs no network. What it can't match goes to the router as words
//!   only, never a picture (B.4); a question goes straight to a look instead (`intent.rs`, B.3).
//! - Every action is classified (`risk.rs`, D) with what the Mac sees, right before it runs; `ask` waits for a real press
//!   or a yes the grammar accepts (60 s; Esc and silence are no); `never` refuses with words people can act on (S.5).
//!   The Mac never runs an `ask` the server sent as routine. "Check with me before every task" makes routine requests
//!   ask too.
//! - Mac-local requests don't wait for Boredroom: they are recorded afterwards through an in-memory outbox (E.3) that
//!   retries for an hour; signing out drops it. Nothing in a record is a path, a picture or typed text.
//! - Everything the front desk does to the Mac goes through `macos::Mac`; tests use `RecordingMac` and fakes only.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    time::{Duration, Instant},
};

use crate::macos::{Mac, MacRefusal, RunningApp, TextRefusal};
use crate::risk::{self, Class, Fact, Verdict};

// ---- the action (B.4's flat object) ------------------------------------------------------------------------------------

/// A folder named in a request: `named` (desktop, downloads…), `added`, `pointed` (Finder's front window), or `none`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderRef {
    #[serde(default = "none_source")]
    pub source: String,
    #[serde(default)]
    pub name: String,
}

fn none_source() -> String {
    "none".into()
}

impl Default for FolderRef {
    fn default() -> Self {
        FolderRef { source: "none".into(), name: String::new() }
    }
}

/// One direct action (C), as the matcher makes it and the router's `do_on_mac` sends it.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MacAction {
    pub kind: String,
    #[serde(default)]
    pub app: String,
    #[serde(default)]
    pub app2: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub folder: FolderRef,
    #[serde(default)]
    pub words: Vec<String>,
    #[serde(default)]
    pub kinds: Vec<String>,
    #[serde(default)]
    pub since_days: u32,
    #[serde(default)]
    pub pick: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub level: u8,
    #[serde(default)]
    pub change: String,
    #[serde(default)]
    pub side: String,
    #[serde(default)]
    pub on: bool,
}

/// The kinds C lists, and nothing else.
pub const KINDS: &[&str] = &[
    "open_app", "open_url", "open_folder", "open_file", "reveal_file", "find_files", "switch_app", "hide_app", "hide_others", "hide_all", "show_all", "minimise",
    "arrange", "fill", "half", "quit_app", "volume", "mute", "unmute", "screenshot", "copy_selection", "type_text", "wifi", "empty_trash",
];

impl MacAction {
    pub fn of(kind: &str) -> MacAction {
        MacAction { kind: kind.into(), ..Default::default() }
    }
    fn app(kind: &str, app: &str) -> MacAction {
        MacAction { kind: kind.into(), app: app.into(), ..Default::default() }
    }
    /// The risk table's kind (`wifi` is `wifi_on` or `wifi_off`).
    pub fn risk_kind(&self) -> &str {
        risk::kind_key(&self.kind, self.on)
    }
}

/// What the matcher found (B.1).
#[derive(Clone, Debug, PartialEq)]
pub enum Matched {
    /// R1: stop the running front sequence, a Files job or speech (not an action; no record).
    Stop,
    Actions(Vec<MacAction>),
}

// ---- normalising (B.1) -------------------------------------------------------------------------------------------------

const STRIP_START: &[&str] = &[
    "brenda", "hey", "ok", "okay", "so", "um", "uh", "please", "can you", "could you", "would you", "will you", "can u", "i want you to", "i need you to", "id like you to",
    "i'd like you to", "go ahead and", "just", "quickly",
];
const STRIP_END: &[&str] = &["please", "for me", "now", "right now", "thanks", "thank you", "brenda"];

fn strip_word_dots(w: &str) -> &str {
    w.trim_matches(|c: char| c == '.' || c == '\'' || c == '-')
}

/// The words as the matcher reads them (B.1): folded (NFKC as `yes.rs` does it), lower case, "wi fi"/"wi-fi" as
/// "wifi", "stripe dot com" as "stripe.com", everything outside a–z, 0–9 and `. % ' -` a space, the name and the
/// polite openers and closers taken off both ends. Empty when nothing is left.
pub fn normalise(text: &str, name: &str) -> String {
    let folded = crate::yes::fold(text).replace("wi-fi", "wifi").replace("wi fi", "wifi");
    let cleaned: String = folded.chars().map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || ".%'- ".contains(c) { c } else { ' ' }).collect();
    // A hyphen inside a word is a space ("side-by-side", "full-screen": whisper writes them so; review, 16 October
    // 2026), except in a web address ("my-site.com" keeps its hyphen).
    let cleaned: String = cleaned.split_whitespace().map(|w| if w.trim_matches('.').contains('.') { w.to_string() } else { w.replace('-', " ") }).collect::<Vec<_>>().join(" ");
    let mut words: Vec<String> = cleaned.split_whitespace().map(|w| strip_word_dots(w).to_string()).filter(|w| !w.is_empty()).collect();
    // " dot " between letters or digits.
    let mut i = 1;
    while i + 1 < words.len() {
        if words[i] == "dot" && words[i - 1].chars().last().is_some_and(|c| c.is_ascii_alphanumeric()) && words[i + 1].chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
            let joined = format!("{}.{}", words[i - 1], words[i + 1]);
            words.splice(i - 1..=i + 1, [joined]);
        } else {
            i += 1;
        }
    }
    let name_words: Vec<String> = normalise_plain(name);
    let starts = |w: &[String], p: &[&str]| w.len() >= p.len() && w.iter().zip(p).all(|(a, b)| a == b);
    let ends = |w: &[String], p: &[&str]| w.len() >= p.len() && w[w.len() - p.len()..].iter().zip(p).all(|(a, b)| a == b);
    loop {
        let before = words.len();
        if !name_words.is_empty() && starts(&words, &name_words.iter().map(String::as_str).collect::<Vec<_>>()) {
            words.drain(..name_words.len());
        }
        for p in STRIP_START {
            let pw: Vec<&str> = p.split(' ').collect();
            if starts(&words, &pw) {
                words.drain(..pw.len());
            }
        }
        if !name_words.is_empty() && ends(&words, &name_words.iter().map(String::as_str).collect::<Vec<_>>()) {
            let n = words.len() - name_words.len();
            words.truncate(n);
        }
        for p in STRIP_END {
            let pw: Vec<&str> = p.split(' ').collect();
            if ends(&words, &pw) && words.len() > pw.len() {
                let n = words.len() - pw.len();
                words.truncate(n);
            }
        }
        if words.len() == before || words.is_empty() {
            break;
        }
    }
    words.join(" ")
}

fn normalise_plain(s: &str) -> Vec<String> {
    let folded = crate::yes::fold(s);
    let cleaned: String = folded.chars().map(|c| if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '\'' { c } else { ' ' }).collect();
    cleaned.split_whitespace().map(String::from).collect()
}

// ---- tiny pattern helpers ----------------------------------------------------------------------------------------------

/// Every way `parts` (each a list of alternatives, "" for none) can start `s`: the alternatives chosen and what is left.
fn prefixes<'a>(s: &str, parts: &[&[&'a str]]) -> Vec<(Vec<&'a str>, String)> {
    if parts.is_empty() {
        return vec![(vec![], s.to_string())];
    }
    let mut out = Vec::new();
    for alt in parts[0] {
        let rest: Option<String> = if alt.is_empty() {
            Some(s.to_string())
        } else if s == *alt {
            Some(String::new())
        } else {
            s.strip_prefix(&format!("{alt} ")).map(String::from)
        };
        if let Some(rest) = rest {
            for (mut chosen, r) in prefixes(&rest, &parts[1..]) {
                chosen.insert(0, alt);
                out.push((chosen, r));
            }
        }
    }
    out
}

/// Whether `s` is exactly `parts`; the alternatives chosen.
fn exactly<'a>(s: &str, parts: &[&[&'a str]]) -> Option<Vec<&'a str>> {
    prefixes(s, parts).into_iter().find(|(_, r)| r.is_empty()).map(|(c, _)| c)
}

/// Every way `parts` can end `s`: the alternatives chosen and what comes before.
fn suffixes<'a>(s: &str, parts: &[&[&'a str]]) -> Vec<(Vec<&'a str>, String)> {
    if parts.is_empty() {
        return vec![(vec![], s.to_string())];
    }
    let last = parts.len() - 1;
    let mut out = Vec::new();
    for alt in parts[last] {
        let rest: Option<String> = if alt.is_empty() {
            Some(s.to_string())
        } else if s == *alt {
            Some(String::new())
        } else {
            s.strip_suffix(&format!(" {alt}")).map(String::from)
        };
        if let Some(rest) = rest {
            for (mut chosen, r) in suffixes(&rest, &parts[..last]) {
                chosen.push(alt);
                out.push((chosen, r));
            }
        }
    }
    out
}

/// `prefix SLOT suffix`: the slot (non-empty) and the alternatives chosen on each side, first by the longest prefix.
fn slot<'a>(s: &str, pre: &[&[&'a str]], post: &[&[&'a str]]) -> Vec<(Vec<&'a str>, String, Vec<&'a str>)> {
    let mut out = Vec::new();
    for (a, rest) in prefixes(s, pre) {
        for (b, mid) in suffixes(&rest, post) {
            if !mid.trim().is_empty() {
                out.push((a.clone(), mid.trim().to_string(), b));
            }
        }
    }
    out.sort_by_key(|(_, m, _)| m.len());
    out
}

// ---- the matcher (B.1) ---------------------------------------------------------------------------------------------------

/// What the matcher needs to know about this Mac: which app a name means (the app index, B.2) and the names of the
/// folders the person added.
pub struct MatchCtx<'a> {
    pub name: &'a str,
    pub resolve: &'a dyn Fn(&str) -> Option<String>,
    pub added: &'a [String],
}

const NAMED_FOLDERS: &[(&str, &str)] = &[("home", "home"), ("home folder", "home"), ("desktop", "desktop"), ("documents", "documents"), ("downloads", "downloads"), ("pictures", "pictures"), ("movies", "movies"), ("music", "music")];
const OPEN_VERBS: &[&str] = &["open up", "open", "launch", "start", "run", "fire up", "bring up", "pull up", "switch to", "go to", "show me", "show"];
const QUIT_NOT: &[&str] = &["this", "it", "that", "the window", "this window", "the tab", "this tab"];

fn is_hostish(u: &str) -> bool {
    let u: String = u.chars().filter(|c| *c != ' ').collect();
    let (host, path) = match u.find('/') {
        Some(i) => (&u[..i], Some(&u[i..])),
        None => (u.as_str(), None),
    };
    let labels: Vec<&str> = host.split('.').collect();
    labels.len() >= 2 && labels.iter().all(|l| !l.is_empty() && l.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')) && path.is_none_or(|p| !p.contains(char::is_whitespace))
}

/// Apps named in `s` ("figma", "figma and slack", "figma slack and notes"): each resolving, at most three.
fn apps_in(s: &str, ctx: &MatchCtx) -> Option<Vec<String>> {
    fn split(s: &str, ctx: &MatchCtx, left: usize) -> Option<Vec<String>> {
        if left == 0 {
            return None;
        }
        if let Some(a) = (ctx.resolve)(s) {
            return Some(vec![a]);
        }
        let words: Vec<&str> = s.split(' ').collect();
        for i in 1..words.len() {
            let a = words[..i].join(" ");
            if let Some(first) = (ctx.resolve)(&a) {
                if let Some(mut rest) = split(&words[i..].join(" "), ctx, left - 1) {
                    rest.insert(0, first);
                    return Some(rest);
                }
            }
        }
        None
    }
    let parts: Vec<&str> = s.split(" and ").collect();
    let mut out = Vec::new();
    for (i, p) in parts.iter().enumerate() {
        let left = 3usize.saturating_sub(out.len());
        let found = if i == 0 { split(p.trim(), ctx, left)? } else { vec![(ctx.resolve)(p.trim())?] };
        out.extend(found);
    }
    (!out.is_empty() && out.len() <= 3).then_some(out)
}

fn one_app(s: &str, ctx: &MatchCtx) -> Option<String> {
    if s.is_empty() || s.contains(" and ") {
        return None;
    }
    (ctx.resolve)(s)
}

/// The quotes round typed text, straight or curly, taken off.
fn unquote(s: &str) -> &str {
    let t = s.trim();
    for (a, b) in [('\'', '\''), ('"', '"'), ('\u{2018}', '\u{2019}'), ('\u{201C}', '\u{201D}')] {
        if t.len() >= 2 && t.starts_with(a) && t.ends_with(b) {
            return t[a.len_utf8()..t.len() - b.len_utf8()].trim();
        }
    }
    t
}

/// R17, from the person's own text: `type <P>`, or `(write|put|enter) <P> (here|in here|in this box|…)`.
fn match_typing(original: &str, name: &str) -> Option<String> {
    // The original words with their byte offsets, so the text keeps its case and punctuation.
    let mut words: Vec<(usize, String)> = Vec::new();
    let mut start = None;
    for (i, c) in original.char_indices() {
        if c.is_whitespace() {
            if let Some(s) = start.take() {
                words.push((s, original[s..i].to_string()));
            }
        } else if start.is_none() {
            start = Some(i);
        }
    }
    if let Some(s) = start {
        words.push((s, original[s..].to_string()));
    }
    let plain = |w: &str| -> String { crate::yes::fold(w).chars().filter(|c| c.is_ascii_alphanumeric() || *c == '\'').collect() };
    let name_words = normalise_plain(name);
    let mut i = 0;
    'strip: loop {
        if !name_words.is_empty() && i + name_words.len() <= words.len() && words[i..i + name_words.len()].iter().zip(&name_words).all(|((_, w), n)| plain(w) == *n) {
            i += name_words.len();
            continue;
        }
        for p in STRIP_START {
            let pw: Vec<&str> = p.split(' ').collect();
            if i + pw.len() <= words.len() && words[i..i + pw.len()].iter().zip(&pw).all(|((_, w), p)| plain(w) == *p) {
                i += pw.len();
                continue 'strip;
            }
        }
        break;
    }
    let verb = plain(&words.get(i)?.1);
    let after = words.get(i + 1)?.0;
    let mut p = original[after..].trim().to_string();
    if verb == "type" {
        // A full stop whisper added at the end is not part of what to type.
        if p.ends_with('.') && !p.ends_with("..") {
            p.pop();
        }
    } else if ["write", "put", "enter"].contains(&verb.as_str()) {
        let tail = |s: &str| -> String { crate::yes::fold(s).trim_end_matches(['.', '!', ' ']).to_string() };
        let lower = tail(&p);
        let ends = ["into this box", "into the box", "in this field", "in this box", "in the box", "in here", "in it", "here"];
        let cut = ends.iter().find(|e| lower.ends_with(&format!(" {e}")))?;
        let keep = lower.len() - cut.len() - 1;
        // `fold` keeps lengths for ASCII; for anything else, cut by characters from the end.
        let n_chars = lower[..keep].chars().count();
        p = p.chars().take(n_chars).collect();
    } else {
        return None;
    }
    // "Write, running five minutes late, here." (whisper's commas round the words; review, 16 October 2026): the commas,
    // semicolons and colons next to the cut words are not part of the text.
    let p = p.trim().trim_end_matches([',', ';', ':']).trim_end().to_string();
    let p = p.trim_start_matches([',', ';', ':']).trim_start().to_string();
    let p = unquote(&p).to_string();
    let n = p.chars().count();
    let lp = p.to_lowercase();
    ((1..=2_000).contains(&n) && !["it", "that", "this"].contains(&lp.as_str())).then_some(p)
}

/// The on-Mac matcher (B.1): the first rule that matches wins; no match (or an app or folder that doesn't resolve) is
/// None, and the request goes on to `intent.rs` and the router.
pub fn match_command(text: &str, ctx: &MatchCtx) -> Option<Matched> {
    let s = normalise(text, ctx.name);
    if s.is_empty() {
        return None;
    }
    // R1
    if ["stop", "cancel", "stop it", "stop that", "stop the job", "never mind", "cancel that"].contains(&s.as_str()) {
        return Some(Matched::Stop);
    }
    let one = |a: MacAction| Some(Matched::Actions(vec![a]));
    // R2 ("a bit", "lower the volume" and the like: review, 16 October 2026).
    const A_BIT: &[&str] = &["", "a bit", "a little", "a little bit", "a touch", "slightly", "some"];
    if let Some(c) = exactly(&s, &[&["turn", "put"], &["it", "the volume", "the sound", "the music"], &["up", "down"], A_BIT]) {
        return one(MacAction { change: c[2].into(), ..MacAction::of("volume") });
    }
    if let Some(c) = exactly(&s, &[&["turn"], &["up", "down"], &["the volume", "the sound", "the music"], A_BIT]) {
        return one(MacAction { change: c[1].into(), ..MacAction::of("volume") });
    }
    if let Some(c) = exactly(&s, &[&["volume", "sound"], &["up", "down"], A_BIT]) {
        return one(MacAction { change: c[1].into(), ..MacAction::of("volume") });
    }
    if let Some(c) = exactly(&s, &[&["lower", "reduce", "decrease", "raise", "increase"], &["the", "my", ""], &["volume", "sound"], A_BIT]) {
        let change = if ["raise", "increase"].contains(&c[0]) { "up" } else { "down" };
        return one(MacAction { change: change.into(), ..MacAction::of("volume") });
    }
    match s.as_str() {
        "louder" => return one(MacAction { change: "up".into(), ..MacAction::of("volume") }),
        "quieter" | "softer" => return one(MacAction { change: "down".into(), ..MacAction::of("volume") }),
        _ => {}
    }
    // R3
    for (_, rest) in prefixes(&s, &[&["set", ""], &["the", ""], &["volume"], &["to", ""]]) {
        let r = rest.replace(" percent", "").replace(" %", "").replace('%', "");
        if let Ok(n) = r.trim().parse::<u32>() {
            if n <= 100 && !r.trim().is_empty() {
                return one(MacAction { change: "set".into(), level: n as u8, ..MacAction::of("volume") });
            }
        }
    }
    // R4
    if exactly(&s, &[&["mute", "unmute"], &["", "the sound", "the volume", "the mac", "the computer"]]).is_some() {
        return one(MacAction::of(if s.starts_with("unmute") { "unmute" } else { "mute" }));
    }
    if exactly(&s, &[&["turn"], &["the", ""], &["sound", "volume"], &["off"]]).is_some() {
        return one(MacAction::of("mute"));
    }
    if exactly(&s, &[&["turn"], &["the", ""], &["sound", "volume"], &["back", ""], &["on"]]).is_some() {
        return one(MacAction::of("unmute"));
    }
    // R5
    if exactly(&s, &[&["take", "grab", "capture", ""], &["a", ""], &["screenshot", "screen shot", "screen grab"], &["", "this", "that", "of this", "of that", "of my screen", "of the screen", "of everything", "of it"]]).is_some()
        || exactly(&s, &[&["capture"], &["my", "the", ""], &["screen"]]).is_some()
    {
        return one(MacAction::of("screenshot"));
    }
    // R6
    let wifi = |on: bool| one(MacAction { on, ..MacAction::of("wifi") });
    if let Some(c) = exactly(&s, &[&["turn", "switch"], &["the", ""], &["wifi"], &["on", "off"]]) {
        return wifi(c[3] == "on");
    }
    if let Some(c) = exactly(&s, &[&["turn", "switch"], &["on", "off"], &["the", ""], &["wifi"]]) {
        return wifi(c[1] == "on");
    }
    if let Some(c) = exactly(&s, &[&["wifi"], &["on", "off"]]) {
        return wifi(c[1] == "on");
    }
    if exactly(&s, &[&["disconnect"], &["from", ""], &["the", ""], &["wifi"]]).is_some() {
        return wifi(false);
    }
    // R7
    if exactly(&s, &[&["empty"], &["the", "my", ""], &["trash", "bin", "rubbish bin", "recycle bin"]]).is_some() {
        return one(MacAction::of("empty_trash"));
    }
    // R8
    if exactly(&s, &[&["hide"], &["everything", "all", "all windows", "all apps", "it all", "all my windows", "all my apps", "all the windows", "all the apps", "my windows", "my apps"]]).is_some() {
        return one(MacAction::of("hide_all"));
    }
    if exactly(&s, &[&["hide"], &["the", ""], &["other", "others", "other apps", "other windows", "everything else"]]).is_some() {
        return one(MacAction::of("hide_others"));
    }
    if exactly(&s, &[&["show", "unhide"], &["everything", "all", "all windows", "all apps"]]).is_some() || exactly(&s, &[&["bring"], &["everything", "it all"], &["back"]]).is_some() {
        return one(MacAction::of("show_all"));
    }
    for (_, a, _) in slot(&s, &[&["hide"]], &[&["", "app", "window"]]) {
        if let Some(app) = one_app(&a, ctx) {
            return one(MacAction::app("hide_app", &app));
        }
    }
    // R9
    if exactly(&s, &[&["minimise", "minimize"], &["", "this", "this window", "the window"]]).is_some() {
        return one(MacAction::app("minimise", ""));
    }
    for (_, a, _) in slot(&s, &[&["minimise", "minimize"]], &[]) {
        if let Some(app) = one_app(&a, ctx) {
            return one(MacAction::app("minimise", &app));
        }
    }
    // R10
    if exactly(&s, &[&["full screen", "fullscreen", "maximise", "maximize"], &["", "this"]]).is_some() {
        return one(MacAction::app("fill", ""));
    }
    for (_, a, _) in slot(&s, &[&["make", "put"]], &[&["full screen", "fullscreen", "fill the screen", "bigger"]]).into_iter().chain(slot(&s, &[&["maximise", "maximize"]], &[])) {
        if let Some(app) = one_app(&a, ctx) {
            return one(MacAction::app("fill", &app));
        }
    }
    // R11
    let pair = |mid: &str| -> Option<(String, String)> {
        let (a, b) = mid.split_once(" and ")?;
        Some(((ctx.resolve)(a.trim())?, (ctx.resolve)(b.trim())?))
    };
    let arrange = |a: String, b: String| one(MacAction { app2: b, ..MacAction::app("arrange", &a) });
    for (_, mid, _) in slot(&s, &[&["put", "place", "show", ""]], &[&["side by side"]]).into_iter().chain(slot(&s, &[&["side by side"]], &[])).chain(slot(&s, &[&["split"], &["the", ""], &["screen"], &["between", ""]], &[])) {
        if let Some((a, b)) = pair(&mid) {
            return arrange(a, b);
        }
    }
    for (first, second) in [("left", "right"), ("right", "left")] {
        for (_, rest) in prefixes(&s, &[&["put", ""]]) {
            let marker = format!(" on the {first}");
            let Some(i) = rest.find(&marker) else { continue };
            let a = rest[..i].trim().to_string();
            let tail = rest[i + marker.len()..].trim_start_matches(" side").trim().to_string();
            let Some(b_part) = tail.strip_prefix("and ") else { continue };
            let b = b_part.trim().strip_suffix(&format!(" on the {second} side")).or_else(|| b_part.trim().strip_suffix(&format!(" on the {second}"))).map(str::trim);
            if let (Some(ra), Some(rb)) = (one_app(&a, ctx), b.and_then(|b| one_app(b, ctx))) {
                return if first == "left" { arrange(ra, rb) } else { arrange(rb, ra) };
            }
        }
    }
    // R12
    for (_, a, c) in slot(&s, &[&["put", "move", "snap"]], &[&["to", "on"], &["the"], &["left", "right"], &["", "half", "side"]]) {
        if let Some(app) = one_app(&a, ctx) {
            return one(MacAction { side: c[2].into(), ..MacAction::app("half", &app) });
        }
    }
    // R13
    for (_, a, _) in slot(&s, &[&["quit", "close", "exit"]], &[&["", "app"]]) {
        if QUIT_NOT.contains(&a.as_str()) {
            return None;
        }
        if let Some(app) = one_app(&a, ctx) {
            return one(MacAction::app("quit_app", &app));
        }
    }
    // R14
    for (_, u, _) in slot(&s, &[&["go to", "open", "visit", "load", "take me to", "bring up", "pull up"]], &[]) {
        if is_hostish(&u) {
            let u: String = u.chars().filter(|c| *c != ' ').collect();
            return one(MacAction { url: format!("https://{u}"), ..MacAction::of("open_url") });
        }
    }
    // R15
    for (_, t, _) in slot(&s, &[OPEN_VERBS, &["the", "my", ""]], &[&["", "app", "application", "folder"]]) {
        if let Some((_, key)) = NAMED_FOLDERS.iter().find(|(n, _)| *n == t) {
            return one(MacAction { folder: FolderRef { source: "named".into(), name: (*key).into() }, ..MacAction::of("open_folder") });
        }
        if let Some(added) = ctx.added.iter().find(|a| normalise_plain(a).join(" ") == t) {
            return one(MacAction { folder: FolderRef { source: "added".into(), name: added.clone() }, ..MacAction::of("open_folder") });
        }
    }
    // R16
    for (_, t, _) in slot(&s, &[OPEN_VERBS, &["the", "my", ""]], &[&["", "app", "application", "apps"]]) {
        if let Some(apps) = apps_in(&t, ctx) {
            return Some(Matched::Actions(apps.iter().map(|a| MacAction::app("open_app", a)).collect()));
        }
    }
    // R17
    if let Some(p) = match_typing(text, ctx.name) {
        return one(MacAction { text: p, ..MacAction::of("type_text") });
    }
    // R18
    if exactly(&s, &[&["copy"], &["that", "this", "it", "the selection", "what's selected", "the selected text"]]).is_some() {
        return one(MacAction::of("copy_selection"));
    }
    None
}

// ---- the words (S) -----------------------------------------------------------------------------------------------------

/// A name as the lines carry it (S.1): letters, digits and ` .,'&+()_-` only, at most 60 characters, a file's extension
/// dropped when the name is over 40.
pub fn line_name(s: &str) -> String {
    let mut n = s.trim().to_string();
    if n.chars().count() > 40 {
        if let Some(stem) = Path::new(&n).file_stem().map(|x| x.to_string_lossy().to_string()).filter(|x| !x.is_empty()) {
            n = stem;
        }
    }
    let kept: String = n.chars().filter(|c| c.is_alphanumeric() || " .,'&+()_-".contains(*c)).take(60).collect();
    kept.trim().to_string()
}

/// A host without "www." ("stripe.com").
pub fn host_of(url: &str) -> String {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or_default()
}

/// The words for a folder (S.1 `{Folder}`): "Downloads", "your home folder", an added folder's name.
pub fn folder_words(f: &FolderRef) -> String {
    if f.source == "named" {
        crate::folder::NamedFolder::of(&f.name).map(|n| n.words().to_string()).unwrap_or_else(|| line_name(&f.name))
    } else {
        line_name(&f.name)
    }
}

fn words_of(a: &MacAction) -> String {
    line_name(&a.words.join(" "))
}

/// The doing line (S.1), said at once.
pub fn doing_line(a: &MacAction) -> String {
    let x = line_name(&a.app);
    match a.kind.as_str() {
        "open_app" => format!("Opening {x}."),
        "open_url" => format!("Opening {}.", line_name(&host_of(&a.url))),
        "open_folder" => format!("Opening {}.", folder_words(&a.folder)),
        "open_file" | "reveal_file" | "find_files" => format!("Looking for {}.", words_of(a)),
        "switch_app" => format!("Switching to {x}."),
        "hide_app" => format!("Hiding {x}."),
        "hide_others" => "Hiding the others.".into(),
        "hide_all" => "Hiding everything.".into(),
        "show_all" => "Showing everything.".into(),
        "minimise" => format!("Minimising {}.", if x.is_empty() { "it".into() } else { x }),
        "fill" => format!("Making {} fill the screen.", if x.is_empty() { "it".into() } else { x }),
        "half" => format!("Putting {x} on the {}.", if a.side == "right" { "right" } else { "left" }),
        "arrange" => format!("Putting {x} and {} side by side.", line_name(&a.app2)),
        "quit_app" => format!("Quitting {x}."),
        "volume" => volume_line(a),
        "mute" => "Muted.".into(),
        "unmute" => "Sound's back on.".into(),
        "screenshot" => "Taking a screenshot.".into(),
        "copy_selection" => "Copying that.".into(),
        "type_text" => "Typing it.".into(),
        "wifi" => if a.on { "Turning Wi-Fi on." } else { "Turning Wi-Fi off." }.into(),
        "empty_trash" => "Emptying the Trash.".into(),
        _ => "One moment.".into(),
    }
}

fn volume_line(a: &MacAction) -> String {
    match a.change.as_str() {
        "up" => "Volume up.".into(),
        "down" => "Volume down.".into(),
        _ => format!("Volume {} percent.", a.level.min(100)),
    }
}

/// The done line (S.1). `name`: what was opened or shown; `n`: how many were found.
pub fn done_line(a: &MacAction, name: &str, n: usize) -> String {
    let x = line_name(&a.app);
    match a.kind.as_str() {
        "open_app" => format!("Opened {x}."),
        "open_url" => format!("Opened {}.", line_name(&host_of(&a.url))),
        "open_folder" => format!("Opened {}.", folder_words(&a.folder)),
        "open_file" => format!("Opened {}.", line_name(name)),
        "reveal_file" => format!("Showed {} in Finder.", line_name(name)),
        "find_files" => if n == 1 { "Found one file.".into() } else { format!("Found {n} files.") },
        "switch_app" => format!("Switched to {x}."),
        "hide_app" => format!("Hid {x}."),
        "hide_others" => "Hid the other apps.".into(),
        "hide_all" => "Hid everything.".into(),
        "show_all" => "Everything's back.".into(),
        "minimise" => format!("Minimised {}.", if x.is_empty() { line_name(name) } else { x }),
        "fill" => format!("{} fills the screen.", if x.is_empty() { line_name(name) } else { x }),
        "half" => format!("{x} is on the {}.", if a.side == "right" { "right" } else { "left" }),
        "arrange" => format!("{x} and {} are side by side.", line_name(&a.app2)),
        "quit_app" => format!("Quit {x}."),
        "volume" => volume_line(a),
        "mute" => "Muted.".into(),
        "unmute" => "Sound's back on.".into(),
        "screenshot" => "Screenshot saved to your Desktop.".into(),
        "copy_selection" => "Copied.".into(),
        "type_text" => "Typed it.".into(),
        "wifi" => if a.on { "Wi-Fi is on." } else { "Wi-Fi is off." }.into(),
        "empty_trash" => "The Trash is empty.".into(),
        _ => "Done.".into(),
    }
}

/// The verb phrase for "Check with me" (S.2).
fn check_phrase(a: &MacAction) -> String {
    let x = line_name(&a.app);
    match a.kind.as_str() {
        "open_app" => format!("open {x}"),
        "open_url" => format!("open {}", line_name(&host_of(&a.url))),
        "open_folder" => format!("open {}", folder_words(&a.folder)),
        "open_file" => format!("open {}", words_of(a)),
        "reveal_file" => format!("show {} in Finder", words_of(a)),
        "find_files" => format!("look for {}", words_of(a)),
        "switch_app" => format!("switch to {x}"),
        "hide_app" => format!("hide {x}"),
        "hide_others" => "hide the other apps".into(),
        "hide_all" => "hide everything".into(),
        "show_all" => "show everything again".into(),
        "minimise" => format!("minimise {}", if x.is_empty() { "the window you're in".into() } else { x }),
        "fill" => format!("make {} fill the screen", if x.is_empty() { "the window you're in".into() } else { x }),
        "half" => format!("put {x} on the {}", if a.side == "right" { "right" } else { "left" }),
        "arrange" => format!("put {x} and {} side by side", line_name(&a.app2)),
        "quit_app" => format!("quit {x}"),
        "volume" => match a.change.as_str() {
            "up" => "turn the volume up".into(),
            "down" => "turn the volume down".into(),
            _ => format!("set the volume to {} percent", a.level.min(100)),
        },
        "mute" => "mute the sound".into(),
        "unmute" => "turn the sound back on".into(),
        "screenshot" => "take a screenshot and save it to your Desktop".into(),
        "copy_selection" => "copy what's selected".into(),
        "type_text" => "type that into the box you're in".into(),
        "wifi" => if a.on { "turn Wi-Fi on" } else { "turn Wi-Fi off" }.into(),
        "empty_trash" => "empty the Trash".into(),
        _ => "do that".into(),
    }
}

/// "I'll open Figma and hide Slack." (S.2).
pub fn check_sentence(actions: &[MacAction]) -> String {
    let p: Vec<String> = actions.iter().map(check_phrase).collect();
    let joined = match p.len() {
        0 => "do that".to_string(),
        1 => p[0].clone(),
        n => format!("{} and {}", p[..n - 1].join(", "), p[n - 1]),
    };
    format!("I'll {joined}.")
}

/// A job's sentence for "Check with me" (S.2): "I'll organise your Desktop."
pub fn job_sentence(title: &str) -> String {
    let mut c = title.trim().chars();
    let first = c.next().map(|f| f.to_lowercase().collect::<String>()).unwrap_or_default();
    format!("I'll {first}{}.", c.as_str().trim_end_matches('.'))
}

/// One ask card (F.2, S.2, S.3).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskCard {
    pub question: String,
    pub because: String,
    pub yes: String,
    pub wait_ms: u64,
}

pub const ASK_WAIT_MS: u64 = 60_000;
pub const HINT: &str = "Answer with Yes or No, or hold ⌃ ⌘ and say it. I'll wait a minute.";

/// The ask card for a request (S.2, S.3): the Trash and Wi-Fi off have their own words; anything else (and "Check
/// with me") is the sentence and "Do you want me to do this?".
pub fn ask_card(actions: &[MacAction], v: &Verdict) -> AskCard {
    let card = |q: &str, b: &str, y: &str| AskCard { question: q.into(), because: b.into(), yes: y.into(), wait_ms: ASK_WAIT_MS };
    if v.reason != "check_every" {
        if actions.iter().any(|a| a.kind == "empty_trash") {
            return card("Empty the Trash for good?", "This can't be undone.", "Empty the Trash");
        }
        if actions.iter().any(|a| a.kind == "wifi" && !a.on) {
            return card("Turn off Wi-Fi?", "You'll lose your connection until it's back on.", "Turn off Wi-Fi");
        }
    }
    card(&check_sentence(actions), "Do you want me to do this?", "Yes, do it")
}

/// Why something wasn't done, as the person reads it (S.5): title, sub, and the setup step that fixes it.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Refusal {
    pub title: String,
    pub sub: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enable: Option<String>,
    /// For the record: refused (a rule) or failed (the Mac couldn't).
    #[serde(skip)]
    pub failed: bool,
}

pub fn refusal(title: impl Into<String>, sub: impl Into<String>) -> Refusal {
    Refusal { title: title.into(), sub: sub.into(), enable: None, failed: false }
}

fn failure(title: impl Into<String>, sub: impl Into<String>) -> Refusal {
    Refusal { failed: true, ..refusal(title, sub) }
}

fn enable(title: &str, sub: &str, which: &str) -> Refusal {
    Refusal { enable: Some(which.into()), ..refusal(title, sub) }
}

pub fn app_refusal(name: &str, why: crate::open::Why) -> Refusal {
    let n = line_name(name);
    match why {
        crate::open::Why::None => refusal(format!("I couldn't find an app called “{n}”"), "Check the name, or open it once yourself."),
        crate::open::Why::Runs => refusal(format!("I don't open {n}"), "It installs, updates or erases things, and I never open those."),
        crate::open::Why::Quarantined => refusal(format!("I don't open {n} yet"), "It came from the internet and hasn't been opened before. Open it once yourself first."),
        crate::open::Why::Outside => refusal("I only open apps from your Applications folders", format!("{n} isn't in one.")),
        _ => failure("I couldn't do that", "macOS wouldn't open it."),
    }
}

fn not_open(name: &str) -> Refusal {
    refusal(format!("{} isn't open", line_name(name)), "")
}

fn accessibility_needed() -> Refusal {
    enable("I need Accessibility to do that", "Allow it once, then ask me again.", "accessibility")
}

fn text_refusal(r: &TextRefusal, copying: bool) -> Refusal {
    match r {
        TextRefusal::NoAccessibility => accessibility_needed(),
        TextRefusal::NoBox => refusal("There's no box to type in", "Click in the box first, then ask me again."),
        TextRefusal::Secure => refusal("That's a password box", "I never type or copy in password boxes."),
        TextRefusal::NeverLook(app) => refusal(if copying { format!("I don't copy from {}", line_name(app)) } else { format!("I don't type in {}", line_name(app)) }, "It's one of the apps I never look at or work in."),
        TextRefusal::Own => refusal("There's no box to type in", "Click in the box first, then ask me again."),
        TextRefusal::NothingSelected => refusal("Nothing's selected", "Select the text first, then ask me again."),
        TextRefusal::Stopped => refusal("Stopped", "What I did before that stays done."),
        TextRefusal::Failed => failure("I couldn't do that", "The box didn't take the text."),
    }
}

// ---- events (P.3, `brenda://front`) ------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Label {
    pub kind: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Row {
    pub name: String,
    #[serde(rename = "where")]
    pub where_: String,
    /// The day it changed, local, "YYYY-MM-DD": the page words it ("Downloads, changed 8 October"; front.js `meta`).
    /// Integration, 16 October 2026: words here ("changed 8 October") read on the page as 8 October 2001.
    pub when: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum FrontEvent {
    Matched { nonce: String, actions: Vec<Label>, say: String, risk: Class },
    Routing { nonce: String },
    Doing { nonce: String, k: usize, of: usize, line: String },
    Ask { nonce: String, question: String, because: String, yes: String, wait_ms: u64 },
    Choose { nonce: String, question: String, options: Vec<Row> },
    Found { nonce: String, title: String, options: Vec<Row> },
    Done { nonce: String, line: String, undo: bool, others: Vec<Row>, show: bool, speak: bool },
    Refused { nonce: String, title: String, sub: String, #[serde(skip_serializing_if = "Option::is_none")] enable: Option<String> },
    Failed { nonce: String, title: String, sub: String },
    SaidNo { nonce: String, line: String },
    Undone { nonce: String, line: String },
    Consent { nonce: String },
    Status { front: Value },
}

// ---- search (C.3) ------------------------------------------------------------------------------------------------------

/// Spotlight, by name, within one folder (`mdfind -onlyin <root> -name <word>`, 1.5 s). None when it didn't answer.
pub trait Spot {
    fn find(&self, root: &Path, word: &str) -> Option<Vec<PathBuf>>;
}

pub struct RealSpot;

impl Spot for RealSpot {
    fn find(&self, root: &Path, word: &str) -> Option<Vec<PathBuf>> {
        let w: String = word.chars().filter(|c| c.is_alphanumeric() || " ._-".contains(*c)).collect();
        if w.trim().is_empty() {
            return None;
        }
        let out = crate::fileops::run_tool("/usr/bin/mdfind", &["-onlyin", &root.to_string_lossy(), "-name", w.trim()], Duration::from_millis(1_500))?;
        Some(String::from_utf8_lossy(&out).lines().map(str::trim).filter(|l| l.starts_with('/')).take(500).map(PathBuf::from).collect())
    }
}

/// One file found.
#[derive(Clone, Debug, PartialEq)]
pub struct Hit {
    pub path: PathBuf,
    pub name: String,
    pub modified: i64,
    /// "Downloads", "Projects".
    pub where_: String,
}

/// Case- and accent-insensitive (the accents of Latin letters folded away).
pub fn fold_name(s: &str) -> String {
    s.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' => 'a',
            'ç' | 'ć' | 'č' => 'c',
            'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ę' => 'e',
            'ì' | 'í' | 'î' | 'ï' | 'ī' => 'i',
            'ñ' | 'ń' => 'n',
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' => 'o',
            'ù' | 'ú' | 'û' | 'ü' | 'ū' => 'u',
            'ý' | 'ÿ' => 'y',
            'ś' | 'š' => 's',
            'ž' | 'ź' | 'ż' => 'z',
            other => other,
        })
        .collect()
}

/// Where to search (C.3): the folder named, or the Desktop, Documents, Downloads and the added folders.
pub struct SearchIn<'a> {
    pub roots: &'a [(PathBuf, String)],
    pub never: &'a [String],
    pub now: i64,
}

/// C.3: Spotlight by the longest word in each root, kept when the name has every word, the kind and the date fit and
/// the file passes the folder rules; Spotlight silent: a walk (depth 3, 5,000 entries, 2 s). Newest first, at most 10.
pub fn search(fs: &dyn crate::folder::Fs, spot: &dyn Spot, a: &MacAction, at: &SearchIn) -> Vec<Hit> {
    let words: Vec<String> = a.words.iter().map(|w| fold_name(w.trim())).filter(|w| !w.is_empty()).collect();
    let longest = words.iter().max_by_key(|w| w.chars().count()).cloned().unwrap_or_default();
    let since = if a.since_days == 0 { None } else { Some(at.now - a.since_days as i64 * 86_400) };
    let keep = |p: &Path, root: &Path, modified: i64| -> bool {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let folded = fold_name(&name);
        p.starts_with(root)
            && !crate::fileops::inside_package(p, root)
            && !crate::folder::skip_file(p, at.never)
            && p.parent().is_some_and(|d| d == root || crate::folder::folder_ok(d, root, at.never))
            && words.iter().all(|w| folded.contains(w.as_str()))
            && crate::fileops::kind_matches(crate::fileops::file_kind(&name), &a.kinds)
            && since.is_none_or(|s| modified >= s)
    };
    let mut hits: Vec<Hit> = Vec::new();
    for (root, title) in at.roots {
        let found = if longest.is_empty() { None } else { spot.find(root, &longest) };
        let mut got_any = false;
        if let Some(paths) = found {
            for p in paths {
                let Ok(e) = fs.meta(&p) else { continue };
                if e.kind != crate::folder::EntryKind::File {
                    continue;
                }
                if keep(&p, root, e.modified) {
                    got_any = true;
                    hits.push(Hit { name: e.name.clone(), path: p, modified: e.modified, where_: where_of(&e.path, root, title) });
                }
            }
        }
        if !got_any {
            let o = crate::folder::WalkOpts {
                kinds: crate::folder::Kinds::AnyFile,
                depth: crate::folder::MAX_DEPTH,
                since_days: a.since_days,
                words: words.clone(),
                never: at.never.to_vec(),
                now_unix: at.now,
                deadline: Instant::now() + crate::folder::WALK_TIME,
            };
            for f in crate::folder::walk(fs, root, &o).kept {
                if keep(&f.path, root, f.modified) && !hits.iter().any(|h| h.path == f.path) {
                    hits.push(Hit { where_: where_of(&f.path, root, title), name: f.name, path: f.path, modified: f.modified });
                }
            }
        }
    }
    hits.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    hits.dedup_by(|a, b| a.path == b.path);
    hits.truncate(10);
    hits
}

fn where_of(p: &Path, root: &Path, title: &str) -> String {
    match p.parent() {
        Some(d) if d == root => title.to_string(),
        Some(d) => d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| title.to_string()),
        None => title.to_string(),
    }
}

fn row(h: &Hit, _now: i64) -> Row {
    let (y, m, d, ..) = crate::fileops::local_parts(h.modified);
    Row { name: line_name(&h.name), where_: line_name(&h.where_), when: format!("{y:04}-{m:02}-{d:02}") }
}

// ---- running a request (C.1) -------------------------------------------------------------------------------------------

/// How the person answered an ask or a chooser.
#[derive(Clone, Debug, PartialEq)]
pub enum Answer {
    Yes(&'static str),
    No,
    Silence,
}

/// An app as the front desk will use it: its own name, where it is, whether it runs, and whether the rules let it open.
#[derive(Clone, Debug, PartialEq)]
pub struct AppTarget {
    pub name: String,
    pub path: Option<PathBuf>,
    pub pid: Option<i32>,
    pub bundle_id: Option<String>,
    /// Why it may not be opened (`open::resolve_app_v2`), if so.
    pub refused: Option<crate::open::Why>,
}

/// Everything around a running request that isn't the Mac itself (C.1): events, waits, names, folders, files.
pub trait Host {
    fn stopped(&self) -> bool;
    fn emit(&mut self, e: FrontEvent);
    /// Shows the ask card and waits (60 s; Esc and silence are no).
    fn ask(&mut self, card: &AskCard) -> Answer;
    /// Shows the chooser and waits; the row chosen.
    fn choose(&mut self, rows: &[Row]) -> Option<usize>;
    fn app(&self, said: &str) -> Option<AppTarget>;
    fn search(&self, a: &MacAction) -> Result<Vec<Hit>, Refusal>;
    fn folder(&self, f: &FolderRef) -> Result<PathBuf, Refusal>;
    /// A never-look or never-act app's name.
    fn never(&self, app: &RunningApp) -> Option<String>;
    /// Facts about a file to open or show (installer, secret).
    fn file_facts(&self, p: &Path) -> Vec<Fact>;
    /// Saves a screenshot on the Desktop (never replacing): the file and what Undo needs.
    fn save_screenshot(&mut self, png: &[u8]) -> Result<(PathBuf, crate::fileops::Op), Refusal>;
    fn now_unix(&self) -> i64;
    /// Where a typed request's screenshot is taken (the notch's display), when typed.
    fn notch_point(&self) -> Option<(f64, f64)>;
    /// The other matches of an "open the newest", kept for "Show the others" and the found list (paths stay here).
    fn keep_hits(&mut self, hits: Vec<Hit>);
}

/// One action's record (E.3): kind, outcome, words (never typed text).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ActionRecord {
    pub kind: String,
    pub outcome: &'static str,
    pub words: String,
}

/// How a request ended on the Mac.
#[derive(Clone, Debug, PartialEq)]
pub struct SeqOutcome {
    /// done, partly, refused, failed, said_no, stopped.
    pub outcome: &'static str,
    pub actions: Vec<ActionRecord>,
    pub summary: String,
    pub risk: Class,
    /// request or yes.
    pub authorised_by: &'static str,
    pub confirmed_via: Option<&'static str>,
    /// A screenshot's Undo.
    pub undo: Option<crate::fileops::Op>,
}

/// The facts the Mac sees for one action, right before it runs (D.3).
fn facts_for(mac: &dyn Mac, host: &dyn Host, a: &MacAction, target: Option<&AppTarget>) -> Vec<Fact> {
    let mut f = Vec::new();
    match a.kind.as_str() {
        "open_app" | "switch_app" => {
            if let Some(t) = target {
                match t.refused {
                    Some(crate::open::Why::Runs) => f.push(Fact::Installer),
                    Some(crate::open::Why::Quarantined) => f.push(Fact::Quarantined),
                    Some(crate::open::Why::Outside) => f.push(Fact::OutsideApps),
                    _ => {}
                }
            }
        }
        "quit_app" | "hide_app" => {
            if let Some(t) = target {
                if t.pid == Some(mac.own_pid()) || t.bundle_id.as_deref().is_some_and(|b| b.eq_ignore_ascii_case(crate::look::OWN_BUNDLE_ID)) {
                    f.push(Fact::Own);
                }
                if a.kind == "quit_app" && t.bundle_id.as_deref() == Some(crate::guard::FINDER_ID) {
                    f.push(Fact::Finder);
                }
            }
        }
        "open_url" => {
            if crate::open::front_url_ok(&a.url).is_none() {
                f.push(Fact::BadUrl);
            }
        }
        "type_text" | "copy_selection" => {
            // Brenda's own notch has the keyboard (a typed request): the front is handed back first, and the box is
            // checked again then (`macos::type_text`), so nothing here is a fact about the person's box yet.
            // The Boredroom window is the person's front window (owner request, 24 October 2026): never typed or
            // copied in, and never the app behind it instead.
            if mac.person_front().is_some_and(|p| p.pid == mac.own_pid()) {
                f.push(Fact::Own);
            }
            if let Some(focus) = mac.focused_text().filter(|f| f.pid != Some(mac.own_pid())) {
                if focus.secure() || mac.secure_input() {
                    f.push(Fact::SecureField);
                }
                if let Some(app) = focus.pid.and_then(|p| mac.running_apps().into_iter().find(|x| x.pid == p)) {
                    if host.never(&app).is_some() {
                        f.push(Fact::NeverLook);
                    }
                    if app.pid == mac.own_pid() {
                        f.push(Fact::Own);
                    }
                }
            }
        }
        _ => {}
    }
    f
}

/// The app an action is about, when it names one.
fn target_of(host: &dyn Host, a: &MacAction) -> Option<AppTarget> {
    (!a.app.is_empty() && ["open_app", "switch_app", "hide_app", "minimise", "fill", "half", "arrange", "quit_app"].contains(&a.kind.as_str())).then(|| host.app(&a.app)).flatten()
}

/// The request's class (D.1) with what the Mac sees now, never below the server's (D.4).
pub fn classify_actions(mac: &dyn Mac, host: &dyn Host, actions: &[MacAction], check_every: bool, server: Option<Class>) -> Verdict {
    let items: Vec<Verdict> = actions.iter().map(|a| risk::classify(a.risk_kind(), &facts_for(mac, host, a, target_of(host, a).as_ref()))).collect();
    let kinds: Vec<&str> = actions.iter().map(|a| a.risk_kind()).collect();
    risk::at_least(risk::classify_request(&items, &kinds, check_every), server)
}

/// What one action did.
enum Did {
    Done(String),
    /// Done, with a Show in Finder (a screenshot) and its Undo.
    Saved(String, crate::fileops::Op),
    /// Done, with the others for "Show the others".
    Opened(String, Vec<Row>),
    Found(usize),
    /// The person chose none of them.
    Said,
    No(Refusal),
}

/// Waits for an app to have a window (≤ 5 s): its pid.
fn wait_window(mac: &dyn Mac, host: &dyn Host, name: &str) -> Option<i32> {
    for _ in 0..50 {
        if host.stopped() {
            return None;
        }
        if let Some(pid) = mac.running_apps().into_iter().find(|a| a.name.eq_ignore_ascii_case(name)).map(|a| a.pid) {
            if mac.window_frame(pid).is_some() {
                return Some(pid);
            }
        }
        mac.sleep_ms(100);
    }
    None
}

/// An app running now, or opened and waited for (≤ 5 s): its pid.
fn ensure_running(mac: &mut dyn Mac, host: &dyn Host, t: &AppTarget) -> Result<i32, Refusal> {
    if let Some(pid) = t.pid.filter(|p| mac.is_running(*p)) {
        return Ok(pid);
    }
    if let Some(r) = t.refused {
        return Err(app_refusal(&t.name, r));
    }
    let path = t.path.clone().ok_or_else(|| app_refusal(&t.name, crate::open::Why::None))?;
    if !mac.open_path(&path) {
        return Err(failure("I couldn't do that", "macOS wouldn't open it."));
    }
    wait_window(mac, host, &t.name).ok_or_else(|| failure(format!("{} didn't open a window", line_name(&t.name)), "Try again in a moment."))
}

fn resolved(host: &dyn Host, said: &str) -> Result<AppTarget, Refusal> {
    host.app(said).ok_or_else(|| app_refusal(said, crate::open::Why::None))
}

/// The person's app, the front handed back to it first when Brenda has it (L.1).
fn person_app(mac: &dyn Mac) -> Option<RunningApp> {
    let f = mac.person_front()?;
    mac.hand_back(f.pid);
    Some(f)
}

fn run_one(mac: &mut dyn Mac, host: &mut dyn Host, nonce: &str, a: &MacAction) -> Did {
    let accessibility = |mac: &dyn Mac| if mac.accessibility() { Ok(()) } else { Err(accessibility_needed()) };
    match a.kind.as_str() {
        "open_app" => {
            let t = match resolved(host, &a.app) {
                Ok(t) => t,
                Err(r) => return Did::No(r),
            };
            if let Some(r) = t.refused {
                return Did::No(app_refusal(&t.name, r));
            }
            match t.path.as_ref() {
                Some(p) if mac.open_path(p) => Did::Done(format!("Opened {}.", line_name(&t.name))),
                Some(_) => Did::No(failure("I couldn't do that", "macOS wouldn't open it.")),
                None => match t.pid {
                    Some(pid) if mac.activate(pid) => Did::Done(format!("Opened {}.", line_name(&t.name))),
                    _ => Did::No(app_refusal(&t.name, crate::open::Why::None)),
                },
            }
        }
        "switch_app" => {
            let t = match resolved(host, &a.app) {
                Ok(t) => t,
                Err(r) => return Did::No(r),
            };
            match t.pid.filter(|p| mac.is_running(*p)) {
                Some(pid) if mac.activate(pid) => Did::Done(format!("Switched to {}.", line_name(&t.name))),
                Some(_) => Did::No(failure("I couldn't do that", "macOS wouldn't switch to it.")),
                None => match ensure_running(mac, host, &t) {
                    Ok(_) => Did::Done(format!("Switched to {}.", line_name(&t.name))),
                    Err(r) => Did::No(r),
                },
            }
        }
        "open_url" => match crate::open::front_url_ok(&a.url) {
            Some(u) if mac.open_url(&u) => Did::Done(format!("Opened {}.", line_name(&host_of(&u)))),
            Some(_) => Did::No(failure("I couldn't do that", "macOS wouldn't open it.")),
            None => Did::No(refusal("I can't open that address", "Only ordinary web pages, never downloads of apps or scripts.")),
        },
        "open_folder" => match host.folder(&a.folder) {
            Ok(p) if mac.open_path(&p) => Did::Done(format!("Opened {}.", folder_words(&a.folder))),
            Ok(_) => Did::No(failure("I couldn't do that", "macOS wouldn't open it.")),
            Err(r) => Did::No(r),
        },
        "open_file" | "reveal_file" | "find_files" => {
            let hits = match host.search(a) {
                Ok(h) => h,
                Err(r) => return Did::No(r),
            };
            let now = host.now_unix();
            if hits.is_empty() {
                return Did::No(refusal("I couldn't find anything like that", "I looked in your Desktop, Documents, Downloads and the folders you added."));
            }
            if a.kind == "find_files" {
                let rows: Vec<Row> = hits.iter().take(8).map(|h| row(h, now)).collect();
                let n = hits.len();
                host.keep_hits(hits);
                host.emit(FrontEvent::Found { nonce: nonce.into(), title: done_line(a, "", n).trim_end_matches('.').to_string(), options: rows });
                return Did::Found(n);
            }
            let reveal = a.kind == "reveal_file";
            let (chosen, others) = if hits.len() == 1 {
                (hits[0].clone(), vec![])
            } else if a.pick == "newest" {
                let others: Vec<Row> = hits[1..].iter().take(9).map(|h| row(h, now)).collect();
                (hits[0].clone(), others)
            } else {
                let rows: Vec<Row> = hits.iter().take(5).map(|h| row(h, now)).collect();
                match host.choose(&rows) {
                    Some(i) if i < rows.len() => (hits[i].clone(), vec![]),
                    _ => return Did::Said,
                }
            };
            // Re-checked right before (phase 3's open rules): runs, secrets, password exports.
            let facts = host.file_facts(&chosen.path);
            let v = risk::classify(if reveal { "reveal_file" } else { "open_file" }, &facts);
            if v.class == Class::Never {
                return Did::No(if v.reason == "secret" {
                    refusal("I don't open that file", "It looks like a password or key file.")
                } else {
                    refusal("I never open that kind of file", "It's an installer, a disk image, a certificate, a script or a link file.")
                });
            }
            let ok = if reveal { mac.reveal(&chosen.path) } else { mac.open_path(&chosen.path) };
            if !ok {
                return Did::No(failure("I couldn't do that", "macOS wouldn't open it."));
            }
            let line = if reveal { format!("Showed {} in Finder.", line_name(&chosen.name)) } else { format!("Opened {}.", line_name(&chosen.name)) };
            if !others.is_empty() {
                host.keep_hits(hits[1..].to_vec());
            }
            Did::Opened(line, others)
        }
        "hide_app" => {
            let t = match resolved(host, &a.app) {
                Ok(t) => t,
                Err(r) => return Did::No(r),
            };
            match t.pid.filter(|p| mac.is_running(*p)) {
                Some(pid) if mac.hide(pid) => Did::Done(format!("Hid {}.", line_name(&t.name))),
                Some(_) => Did::No(failure("I couldn't do that", "macOS wouldn't hide it.")),
                None => Did::No(not_open(&t.name)),
            }
        }
        "hide_others" => {
            let keep = person_app(mac).map(|f| f.pid);
            let own = mac.own_pid();
            for app in mac.running_apps().into_iter().filter(|x| x.regular && Some(x.pid) != keep && x.pid != own && !x.hidden) {
                if host.stopped() {
                    return Did::No(refusal("Stopped", "What I did before that stays done."));
                }
                mac.hide(app.pid);
            }
            Did::Done("Hid the other apps.".into())
        }
        "hide_all" => {
            if mac.hide_all_others() {
                Did::Done("Hid everything.".into())
            } else {
                Did::No(failure("I couldn't do that", "macOS wouldn't hide them."))
            }
        }
        "show_all" => {
            if mac.show_all() {
                Did::Done("Everything's back.".into())
            } else {
                Did::No(failure("I couldn't do that", "macOS wouldn't show them."))
            }
        }
        "minimise" | "fill" | "half" => {
            if let Err(r) = accessibility(mac) {
                return Did::No(r);
            }
            let (pid, name) = if a.app.is_empty() {
                match person_app(mac) {
                    Some(f) => (f.pid, f.name),
                    None => return Did::No(refusal("There's no window to do that to", "Click the window first, then ask me again.")),
                }
            } else {
                let t = match resolved(host, &a.app) {
                    Ok(t) => t,
                    Err(r) => return Did::No(r),
                };
                if a.kind == "minimise" {
                    match t.pid.filter(|p| mac.is_running(*p)) {
                        Some(pid) => (pid, t.name),
                        None => return Did::No(not_open(&t.name)),
                    }
                } else {
                    match ensure_running(mac, host, &t) {
                        Ok(pid) => (pid, t.name),
                        Err(r) => return Did::No(r),
                    }
                }
            };
            // Boredroom's own window (owner request, 24 October 2026): minimised by Rust, never moved by Accessibility.
            if pid == mac.own_pid() {
                if a.kind == "minimise" && mac.minimise_own() {
                    return Did::Done("Minimised Boredroom.".into());
                }
                return Did::No(refusal("That's Boredroom itself", "I don't click, type or change anything in it."));
            }
            if a.kind == "minimise" {
                return if mac.minimise(pid) { Did::Done(format!("Minimised {}.", line_name(&name))) } else { Did::No(failure("I couldn't do that", "That window wouldn't minimise.")) };
            }
            let Some(frame) = mac.window_frame(pid) else { return Did::No(failure(format!("{} has no window to move", line_name(&name)), "")) };
            let centre = (frame.x + frame.w / 2.0, frame.y + frame.h / 2.0);
            let Some(visible) = mac.visible_frame_for(centre) else { return Did::No(failure("I couldn't do that", "I couldn't find that screen.")) };
            let side = if a.kind == "fill" { "fill" } else if a.side == "right" { "right" } else { "left" };
            if mac.set_window_frame(pid, crate::macos::half_frame(visible, side)) {
                mac.activate(pid);
                Did::Done(if side == "fill" { format!("{} fills the screen.", line_name(&name)) } else { format!("{} is on the {side}.", line_name(&name)) })
            } else {
                Did::No(failure("I couldn't do that", "That window wouldn't move."))
            }
        }
        "arrange" => {
            if let Err(r) = accessibility(mac) {
                return Did::No(r);
            }
            let (ta, tb) = match (resolved(host, &a.app), resolved(host, &a.app2)) {
                (Ok(x), Ok(y)) => (x, y),
                (Err(r), _) | (_, Err(r)) => return Did::No(r),
            };
            let pa = match ensure_running(mac, host, &ta) {
                Ok(p) => p,
                Err(r) => return Did::No(r),
            };
            let pb = match ensure_running(mac, host, &tb) {
                Ok(p) => p,
                Err(r) => return Did::No(r),
            };
            let at = mac.window_frame(pa).map(|f| (f.x + f.w / 2.0, f.y + f.h / 2.0)).or_else(|| mac.pointer()).unwrap_or((0.0, 0.0));
            let Some(visible) = mac.visible_frame_for(at) else { return Did::No(failure("I couldn't do that", "I couldn't find that screen.")) };
            let ok = mac.set_window_frame(pa, crate::macos::half_frame(visible, "left")) & mac.set_window_frame(pb, crate::macos::half_frame(visible, "right"));
            mac.activate(pb);
            mac.activate(pa);
            if ok {
                Did::Done(format!("{} and {} are side by side.", line_name(&ta.name), line_name(&tb.name)))
            } else {
                Did::No(failure("I couldn't do that", "A window wouldn't move."))
            }
        }
        "quit_app" => {
            let t = match resolved(host, &a.app) {
                Ok(t) => t,
                Err(r) => return Did::No(r),
            };
            if t.pid == Some(mac.own_pid()) || t.bundle_id.as_deref().is_some_and(|b| b.eq_ignore_ascii_case(crate::look::OWN_BUNDLE_ID)) {
                return Did::No(refusal("I can't quit myself", "Quit Boredroom from its menu (⌘Q)."));
            }
            if t.bundle_id.as_deref() == Some(crate::guard::FINDER_ID) {
                return Did::No(refusal("Finder always stays open", ""));
            }
            let Some(pid) = t.pid.filter(|p| mac.is_running(*p)) else { return Did::No(not_open(&t.name)) };
            mac.terminate(pid);
            for _ in 0..20 {
                if !mac.is_running(pid) {
                    return Did::Done(format!("Quit {}.", line_name(&t.name)));
                }
                mac.sleep_ms(100);
            }
            Did::Done(format!("{} is asking about unsaved work.", line_name(&t.name)))
        }
        "volume" => {
            let (now, muted) = mac.volume().unwrap_or((50, false));
            let n = crate::macos::next_volume(now, &a.change, a.level);
            let ok = mac.set_volume(n) && (a.change != "up" || !muted || mac.set_muted(false));
            if ok {
                Did::Done(volume_line(a))
            } else {
                Did::No(failure("I couldn't do that", "macOS wouldn't change the volume."))
            }
        }
        "mute" | "unmute" => {
            if mac.set_muted(a.kind == "mute") {
                Did::Done(if a.kind == "mute" { "Muted." } else { "Sound's back on." }.into())
            } else {
                Did::No(failure("I couldn't do that", "macOS wouldn't change the sound."))
            }
        }
        "screenshot" => {
            if !mac.screen_recording() {
                return Did::No(enable("I need Screen Recording to take screenshots", "Allow it once, then ask me again.", "screen"));
            }
            let at = host.notch_point().or_else(|| mac.pointer()).unwrap_or((0.0, 0.0));
            match mac.screenshot_png(at) {
                Ok(png) => match host.save_screenshot(&png) {
                    Ok((_, op)) => Did::Saved("Screenshot saved to your Desktop.".into(), op),
                    Err(r) => Did::No(r),
                },
                Err(_) => Did::No(failure("I couldn't take the screenshot", "Try again in a moment.")),
            }
        }
        "copy_selection" => {
            if let Some(f) = mac.person_front() {
                mac.hand_back(f.pid);
            }
            let never = |app: &RunningApp| host.never(app);
            match crate::macos::copy_selection(mac, &never) {
                Ok(()) => Did::Done("Copied.".into()),
                Err(r) => Did::No(text_refusal(&r, true)),
            }
        }
        "type_text" => {
            if a.text.trim().is_empty() || a.text.chars().count() > 2_000 {
                return Did::No(refusal("I couldn't do that", "That's more than I type in one go."));
            }
            if let Some(f) = mac.person_front() {
                mac.hand_back(f.pid);
            }
            let never = |app: &RunningApp| host.never(app);
            let stopped = || host.stopped();
            match crate::macos::type_text(mac, &a.text, &never, &stopped) {
                Ok(()) => Did::Done("Typed it.".into()),
                Err(r) => Did::No(text_refusal(&r, false)),
            }
        }
        "wifi" => match mac.wifi(a.on) {
            Ok(()) => Did::Done(if a.on { "Wi-Fi is on." } else { "Wi-Fi is off." }.into()),
            Err(MacRefusal::WifiAdmin) => Did::No(refusal("macOS wants an administrator for that", "Turn Wi-Fi off from Control Centre instead.")),
            Err(_) => Did::No(failure("I couldn't do that", "I couldn't find the Wi-Fi.")),
        },
        "empty_trash" => match mac.empty_trash() {
            Ok(()) => Did::Done("The Trash is empty.".into()),
            Err(MacRefusal::FinderDenied) => Did::No(Refusal {
                // The page's way out is named "finder" (System Settings › Automation; integration, 16 October 2026).
                enable: Some("finder".into()),
                ..refusal("Finder said no", "Let Boredroom ask Finder in System Settings › Privacy & Security › Automation, or empty the Trash from the Dock.")
            }),
            Err(_) => Did::No(failure("I couldn't do that", "Finder didn't empty the Trash.")),
        },
        other => Did::No(refusal("I couldn't do that", format!("I don't know how to {}.", other.replace('_', " ")))),
    }
}

/// Runs a request's actions in order (C.1): stop flag, re-check, classify, ask when needed, run, events; the first
/// failure ends the sequence. `pre`: the request's verdict (from `classify_actions`).
pub fn run_actions(mac: &mut dyn Mac, host: &mut dyn Host, nonce: &str, actions: &[MacAction], pre: &Verdict, check_every: bool) -> SeqOutcome {
    let started = Instant::now();
    let mut out = SeqOutcome { outcome: "done", actions: vec![], summary: String::new(), risk: pre.class, authorised_by: "request", confirmed_via: None, undo: None };
    let actions: Vec<MacAction> = actions.iter().take(3).cloned().collect();
    if pre.class == Class::Never {
        // Refused before anything ran: the first action that is never says why.
        let r = actions.iter().find_map(|a| {
            let t = target_of(host, a);
            let v = risk::classify(a.risk_kind(), &facts_for(mac, host, a, t.as_ref()));
            (v.class == Class::Never).then(|| never_words(a, &v, t.as_ref()))
        });
        let r = r.unwrap_or_else(|| refusal("I couldn't do that", "That isn't something I do."));
        host.emit(FrontEvent::Refused { nonce: nonce.into(), title: r.title.clone(), sub: r.sub.clone(), enable: r.enable.clone() });
        out.outcome = "refused";
        out.summary = r.title;
        out.actions = actions.iter().map(|a| ActionRecord { kind: a.kind.clone(), outcome: "refused", words: String::new() }).collect();
        return out;
    }
    let mut asked = false;
    if pre.class == Class::Ask {
        let card = ask_card(&actions, pre);
        match host.ask(&card) {
            Answer::Yes(via) => {
                asked = true;
                out.authorised_by = "yes";
                out.confirmed_via = Some(via);
            }
            other => {
                let line = if other == Answer::Silence { "I didn't hear a yes, so I won't do it." } else { "Okay, I won't." };
                host.emit(FrontEvent::SaidNo { nonce: nonce.into(), line: line.into() });
                out.outcome = "said_no";
                out.summary = line.into();
                out.actions = actions.iter().map(|a| ActionRecord { kind: a.kind.clone(), outcome: "said_no", words: String::new() }).collect();
                return out;
            }
        }
    }
    let n = actions.len();
    let mut last_line = String::new();
    let mut others: Vec<Row> = Vec::new();
    let mut show = false;
    for (k, a) in actions.iter().enumerate() {
        if host.stopped() {
            out.outcome = if k == 0 { "stopped" } else { "partly" };
            host.emit(FrontEvent::Refused { nonce: nonce.into(), title: "Stopped".into(), sub: "What I did before that stays done.".into(), enable: None });
            for b in &actions[k..] {
                out.actions.push(ActionRecord { kind: b.kind.clone(), outcome: "stopped", words: String::new() });
            }
            out.summary = "Stopped".into();
            return out;
        }
        // Re-check right before: the class with what the Mac sees now; a newly asking step asks now.
        let t = target_of(host, a);
        let v = risk::classify(a.risk_kind(), &facts_for(mac, host, a, t.as_ref()));
        if v.class == Class::Never {
            let r = never_words(a, &v, t.as_ref());
            host.emit(FrontEvent::Refused { nonce: nonce.into(), title: r.title.clone(), sub: r.sub.clone(), enable: r.enable.clone() });
            out.actions.push(ActionRecord { kind: a.kind.clone(), outcome: "refused", words: String::new() });
            out.outcome = if k == 0 { "refused" } else { "partly" };
            out.summary = r.title;
            return out;
        }
        if v.class == Class::Ask && !asked {
            match host.ask(&ask_card(std::slice::from_ref(a), &v)) {
                Answer::Yes(via) => {
                    asked = true;
                    out.authorised_by = "yes";
                    out.confirmed_via = Some(via);
                }
                _ => {
                    host.emit(FrontEvent::SaidNo { nonce: nonce.into(), line: "Okay, I won't.".into() });
                    out.actions.push(ActionRecord { kind: a.kind.clone(), outcome: "said_no", words: String::new() });
                    out.outcome = if k == 0 { "said_no" } else { "partly" };
                    out.summary = "Okay, I won't.".into();
                    return out;
                }
            }
        }
        host.emit(FrontEvent::Doing { nonce: nonce.into(), k: k + 1, of: n, line: doing_line(a) });
        let _ = check_every;
        match run_one(mac, host, nonce, a) {
            Did::Done(line) => {
                out.actions.push(ActionRecord { kind: a.kind.clone(), outcome: "done", words: record_words(a, &line) });
                last_line = line;
            }
            Did::Saved(line, op) => {
                out.actions.push(ActionRecord { kind: a.kind.clone(), outcome: "done", words: record_words(a, &line) });
                out.undo = Some(op);
                show = true;
                last_line = line;
            }
            Did::Opened(line, rows) => {
                out.actions.push(ActionRecord { kind: a.kind.clone(), outcome: "done", words: record_words(a, &line) });
                others = rows;
                last_line = line;
            }
            Did::Found(count) => {
                out.actions.push(ActionRecord { kind: a.kind.clone(), outcome: "done", words: done_line(a, "", count) });
                last_line = done_line(a, "", count);
            }
            Did::Said => {
                host.emit(FrontEvent::SaidNo { nonce: nonce.into(), line: "Okay, I won't.".into() });
                out.actions.push(ActionRecord { kind: a.kind.clone(), outcome: "said_no", words: String::new() });
                out.outcome = if k == 0 { "said_no" } else { "partly" };
                out.summary = "Okay, I won't.".into();
                return out;
            }
            Did::No(r) => {
                if r.failed {
                    host.emit(FrontEvent::Failed { nonce: nonce.into(), title: r.title.clone(), sub: if k > 0 { format!("{} What I did before that stays done.", r.sub).trim().to_string() } else { r.sub.clone() } });
                } else {
                    host.emit(FrontEvent::Refused { nonce: nonce.into(), title: r.title.clone(), sub: r.sub.clone(), enable: r.enable.clone() });
                }
                out.actions.push(ActionRecord { kind: a.kind.clone(), outcome: if r.failed { "failed" } else { "refused" }, words: String::new() });
                out.outcome = if k > 0 { "partly" } else if r.failed { "failed" } else { "refused" };
                out.summary = r.title;
                return out;
            }
        }
    }
    let speak = started.elapsed() > Duration::from_millis(1_500);
    host.emit(FrontEvent::Done { nonce: nonce.into(), line: last_line.clone(), undo: out.undo.is_some(), others, show, speak });
    out.summary = last_line.trim_end_matches('.').to_string();
    out
}

/// What the record says an action did (E.3): its done line, never typed text ("Typed into Notes").
fn record_words(a: &MacAction, line: &str) -> String {
    if a.kind == "type_text" {
        return "Typed into the box".into();
    }
    line.trim_end_matches('.').chars().take(120).collect()
}

/// The words for a `never` class (S.5).
fn never_words(a: &MacAction, v: &Verdict, t: Option<&AppTarget>) -> Refusal {
    let name = t.map(|t| t.name.clone()).unwrap_or_else(|| a.app.clone());
    match v.reason {
        "installer" => app_refusal(&name, crate::open::Why::Runs),
        "quarantined" => app_refusal(&name, crate::open::Why::Quarantined),
        "outside_apps" => app_refusal(&name, crate::open::Why::Outside),
        "bad_url" => refusal("I can't open that address", "Only ordinary web pages, never downloads of apps or scripts."),
        "secure_field" => refusal("That's a password box", "I never type or copy in password boxes."),
        "never_look" => refusal(if a.kind == "copy_selection" { "I don't copy from that app" } else { "I don't type in that app" }, "It's one of the apps I never look at or work in."),
        "own" if a.kind == "quit_app" => refusal("I can't quit myself", "Quit Boredroom from its menu (⌘Q)."),
        "own" => refusal("That's Boredroom itself", "I don't click, type or change anything in it."),
        "finder" => refusal("Finder always stays open", ""),
        "secret" => refusal("I don't open that file", "It looks like a password or key file."),
        _ => refusal("I couldn't do that", "That isn't something I do."),
    }
}

// ---- the router (B.4) --------------------------------------------------------------------------------------------------

/// A job the router offers (B.4 `start_job`).
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct JobOffer {
    pub helper: String,
    pub title: String,
    pub doing: String,
    #[serde(default)]
    pub goal: String,
    pub token: String,
    #[serde(default)]
    pub needs: JobNeeds,
}

#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct JobNeeds {
    #[serde(default)]
    pub consent: bool,
    #[serde(default)]
    pub yes: bool,
}

/// One line of the router's answer, as the Mac acts on it. Unknown lines are ignored.
#[derive(Clone, Debug, PartialEq)]
pub enum RouteLine {
    Mac { actions: Vec<MacAction>, risk: Class },
    Job { job: JobOffer, say: Option<String>, speech: Value },
    Look { lane: String },
    Boredroom,
    Ask { question: String },
    Enable { which: String },
    Refused { reason: String, message: String },
    Done(Value),
    Error { status: u16, code: Option<String>, message: String },
    Ignore,
}

pub fn route_line(v: &Value) -> RouteLine {
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(String::from);
    match v.get("t").and_then(|t| t.as_str()) {
        Some("route") => match v.get("lane").and_then(|l| l.as_str()) {
            Some("mac") => {
                let actions: Option<Vec<MacAction>> = v.get("actions").cloned().and_then(|a| serde_json::from_value(a).ok());
                match actions {
                    Some(a) if (1..=3).contains(&a.len()) && a.iter().all(|x| KINDS.contains(&x.kind.as_str())) => RouteLine::Mac { actions: a, risk: v.get("risk").and_then(|r| r.as_str()).and_then(Class::of).unwrap_or(Class::Ask) },
                    _ => RouteLine::Ignore,
                }
            }
            Some("job") => match v.get("job").cloned().and_then(|j| serde_json::from_value::<JobOffer>(j).ok()) {
                Some(job) if job.helper == "files" || job.helper == "operator" => RouteLine::Job { job, say: s("say"), speech: v.get("speech").cloned().unwrap_or(Value::Null) },
                _ => RouteLine::Ignore,
            },
            Some("look") => RouteLine::Look { lane: v.pointer("/look/lane").and_then(|l| l.as_str()).filter(|l| *l == "now" || *l == "think").unwrap_or("now").to_string() },
            Some("boredroom") => RouteLine::Boredroom,
            Some("ask") => s("question").map(|question| RouteLine::Ask { question }).unwrap_or(RouteLine::Ignore),
            Some("enable") => s("which").map(|which| RouteLine::Enable { which }).unwrap_or(RouteLine::Ignore),
            Some("refused") => RouteLine::Refused { reason: s("reason").unwrap_or_default(), message: s("message").unwrap_or_else(|| "I couldn't do that.".into()) },
            _ => RouteLine::Ignore,
        },
        Some("done") => RouteLine::Done(v.get("result").cloned().unwrap_or(Value::Null)),
        Some("error") => RouteLine::Error { status: v.get("status").and_then(|x| x.as_u64()).unwrap_or(500) as u16, code: s("code"), message: s("message").unwrap_or_else(|| "Request failed.".into()) },
        _ => RouteLine::Ignore,
    }
}

/// The words for an AI or network error (L.2, S.5): title and sub.
pub fn error_words(code: Option<&str>, message: &str) -> (String, String) {
    match code {
        Some("AI_NO_CREDIT") => ("I can't think that through right now".into(), "Boredroom's AI account has run out of credit. Simple things like “open Figma” still work.".into()),
        Some("AI_BUSY") => ("Claude is busy just now".into(), "Try again in a moment.".into()),
        Some("AI_FAILED") => ("I couldn't reach Claude just now".into(), "Try again in a moment.".into()),
        Some("OFFLINE") => ("I can't reach Boredroom right now".into(), "Simple things like opening apps still work.".into()),
        Some("JOB_BUSY") => ("I'm still on the last job".into(), "Wait for it to finish, or stop it in the notch.".into()),
        _ => ("I couldn't do that".into(), message.to_string()),
    }
}

/// The request part of the router's body (B.4).
pub fn front_request_json(text: &str, via: &str, age_ms: u64, nonce: &str, at: &str) -> Value {
    json!({ "text": text, "via": via, "ageMs": age_ms.min(30_000), "nonce": nonce, "at": at })
}

/// What the Mac tells the router (B.4 `context`): names only, never a path or a picture.
pub struct FrontContext {
    pub front: Value,
    pub running: Vec<String>,
    pub files: Vec<Value>,
    pub folders: Vec<Value>,
    pub use_mac: bool,
    pub file_work: bool,
    pub accessibility: bool,
    pub click_consent: bool,
    pub screen_recording: bool,
    pub pictures: bool,
}

pub fn front_context_json(c: &FrontContext) -> Value {
    json!({
        "front": c.front,
        "running": c.running.iter().take(20).map(|n| n.chars().take(80).collect::<String>()).collect::<Vec<_>>(),
        "files": c.files.iter().take(10).collect::<Vec<_>>(),
        "folders": c.folders.iter().take(14).collect::<Vec<_>>(),
        "abilities": { "useMac": c.use_mac, "fileWork": c.file_work, "accessibility": c.accessibility, "clickConsent": c.click_consent, "screenRecording": c.screen_recording },
        "pictures": c.pictures,
    })
}

/// The router's body (B.4): the request, what the Mac knows (names only), the chat so far.
pub fn router_body(request: &Value, context: &Value, messages: &[Value]) -> Value {
    json!({ "version": 1, "request": request, "context": context, "messages": messages })
}

/// The chat as the router takes it (B.4): at most 10 turns of at most 4,000 characters, the last the request itself.
pub fn router_messages(messages: &[Value], text: &str) -> Vec<Value> {
    let mut m: Vec<Value> = messages
        .iter()
        .filter_map(|x| {
            let role = x.get("role").and_then(|r| r.as_str())?;
            let content = x.get("content").and_then(|c| c.as_str())?;
            (role == "user" || role == "assistant").then(|| json!({ "role": role, "content": crate::look::clip_utf16(content, 4_000) }))
        })
        .collect();
    let last_ok = m.last().is_some_and(|l| l["role"] == "user" && l["content"].as_str() == Some(text));
    if !last_ok {
        m.push(json!({ "role": "user", "content": text }));
    }
    let n = m.len();
    if n > 10 {
        m.drain(..n - 10);
    }
    m
}

// ---- the record and the outbox (E.3) --------------------------------------------------------------------------------------

/// The retry steps after a failed send (E.3): 30 s, 1, 2, 5, then every 10 minutes.
pub const OUTBOX_BACKOFF: [u64; 5] = [30, 60, 120, 300, 600];
pub const OUTBOX_KEEP: Duration = Duration::from_secs(3_600);
pub const OUTBOX_BATCH: usize = 20;
pub const OUTBOX_EVERY: Duration = Duration::from_secs(30);

/// One record waiting to be sent.
#[derive(Clone, Debug)]
pub struct Queued {
    pub record: Value,
    pub at: Instant,
}

/// Records of Mac-local requests, sent in the background (E.3): at once, then every 30 s; after a failure 30 s, 1, 2,
/// 5 and 10 minutes; anything older than an hour dropped; cleared on sign-out.
#[derive(Default, Debug)]
pub struct Outbox {
    pub queue: Vec<Queued>,
    pub failures: usize,
    pub next_at: Option<Instant>,
}

impl Outbox {
    pub fn push(&mut self, record: Value, now: Instant) {
        // A newer record for the same request (an Undo) replaces the older one.
        let nonce = record.get("nonce").cloned();
        self.queue.retain(|q| q.record.get("nonce") != nonce.as_ref());
        self.queue.push(Queued { record, at: now });
        if self.failures == 0 || self.next_at.is_none() {
            self.next_at = Some(now);
        }
    }

    /// What to send now (at most 20), or nothing yet.
    pub fn due(&mut self, now: Instant) -> Vec<Value> {
        self.queue.retain(|q| now.saturating_duration_since(q.at) <= OUTBOX_KEEP);
        if self.queue.is_empty() {
            self.failures = 0;
            self.next_at = None;
            return vec![];
        }
        if self.next_at.is_some_and(|t| now < t) {
            return vec![];
        }
        self.queue.iter().take(OUTBOX_BATCH).map(|q| q.record.clone()).collect()
    }

    /// The answer to a send of `sent` records.
    pub fn sent(&mut self, ok: bool, sent: usize, now: Instant) {
        if ok {
            self.queue.drain(..sent.min(self.queue.len()));
            self.failures = 0;
            self.next_at = Some(now + if self.queue.is_empty() { OUTBOX_EVERY } else { Duration::ZERO });
        } else {
            let step = OUTBOX_BACKOFF[self.failures.min(OUTBOX_BACKOFF.len() - 1)];
            self.failures += 1;
            self.next_at = Some(now + Duration::from_secs(step));
        }
    }

    pub fn clear(&mut self) {
        self.queue.clear();
        self.failures = 0;
        self.next_at = None;
    }
}

/// A record (E.3) for a request the Mac handled.
#[allow(clippy::too_many_arguments)]
pub fn record_of(nonce: &str, text: &str, via: &str, at_iso: &str, matched: &str, o: &SeqOutcome, undone: bool) -> Value {
    json!({
        "nonce": nonce,
        "text": crate::look::clip_utf16(text, 1_000),
        "via": via,
        "at": at_iso,
        "matched": matched,
        "lane": "mac",
        "risk": o.risk.key(),
        "authorisedBy": o.authorised_by,
        "confirmedVia": o.confirmed_via,
        "actions": o.actions.iter().take(10).collect::<Vec<_>>(),
        "outcome": if undone { "undone" } else { o.outcome },
        "summary": o.summary.chars().take(300).collect::<String>(),
        "undo": { "available": o.undo.is_some() && !undone },
    })
}

/// An ISO 8601 time (UTC, milliseconds).
pub fn iso_now() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
    iso_of(ms)
}

pub fn iso_of(ms: i64) -> String {
    let secs = ms.div_euclid(1_000);
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3600, rem / 60 % 60, rem % 60, ms.rem_euclid(1_000))
}

// ---- the request's origin (0.3, P.2) ----------------------------------------------------------------------------------------

/// How long Option+Space's transcript counts as the request (P.2).
pub const TALK_FRESH: Duration = Duration::from_secs(15);

/// Where a request's words came from (0.3), or None when they aren't the person's (nothing runs). With a look id: the
/// look's own transcript or a real press (`look::request_via`). Without: the last Option+Space transcript, fresh and
/// equal to the words, or a real press.
pub fn origin_of(text: &str, look: Option<(&str, Option<(&str, &str)>)>, last_talk: Option<(&str, Duration)>, person_press: bool) -> Option<&'static str> {
    if let Some((look_id, heard)) = look {
        return crate::look::request_via(text, heard, look_id, person_press);
    }
    if let Some((words, age)) = last_talk {
        if age <= TALK_FRESH && !words.trim().is_empty() && crate::look::fold_ws(words) == crate::look::fold_ws(text) {
            return Some("voice");
        }
    }
    person_press.then_some("typed")
}

/// A fresh nonce: 32 lowercase hex from the system's random source (0.2).
pub fn new_nonce() -> String {
    use std::io::Read;
    let mut b = [0u8; 16];
    let ok = std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b)).is_ok();
    if !ok {
        use std::hash::{BuildHasher, Hasher};
        for (i, chunk) in b.chunks_mut(8).enumerate() {
            let mut h = std::collections::hash_map::RandomState::new().build_hasher();
            h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0) + i as u128);
            chunk.copy_from_slice(&h.finish().to_le_bytes());
        }
    }
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn nonce_ok(n: &str) -> bool {
    n.len() == 32 && n.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

/// Whether words the matcher didn't recognise go to the router (B.3). Owner report, 27 October 2026 ("she says I should
/// confirm for her to do it by holding down the keys and saying it again, but when I do that she doesn't do it and just
/// repeats what she said"): only a plain question skips it now ("what…", "how…", "is…"); an instruction the verb list
/// misses ("clear my desktop", "Open Figma?") used to go to a look or the chat, which can't act and said to ask again
/// with the keys, and the same words went the same way again.
pub fn goes_to_router(text: &str, name: &str) -> bool {
    crate::intent::is_instruction(text, name) || !crate::intent::is_plain_question(text, name)
}

// ---- the front desk on this Mac (P.2–P.6) ----------------------------------------------------------------------------

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Condvar, Mutex,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::{ApiError, AppState};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum WaitKind {
    Ask,
    Choose,
    Consent,
}

#[derive(Clone, Debug, PartialEq)]
enum Signal {
    Yes(&'static str, Option<String>),
    No,
    Choose(Option<usize>),
    Consent(bool),
}

#[derive(Default)]
pub struct Front {
    /// The server has 0060 and this workspace allows doing things (`set_look_rules`'s `front.ready`).
    ready: AtomicBool,
    check_every: AtomicBool,
    warmed: AtomicBool,
    /// A request is being handled (one at a time).
    busy: AtomicBool,
    /// Stop for the request being handled: cleared when a request starts, never in the middle of one (review, 16 October
    /// 2026: `do_actions` used to clear it, so a "stop" said while the router thought was wiped and the request still ran).
    stop: Arc<AtomicBool>,
    /// Wakes a request waiting on the router when the person says "stop" or presses Stop: the router call is dropped.
    cancel: tokio::sync::Notify,
    wait: Mutex<Option<(String, WaitKind)>>,
    signal: Mutex<Option<Signal>>,
    wake: Condvar,
    outbox: Mutex<Outbox>,
    /// "Show the others" and the found list: the request's nonce and the files (paths stay here).
    kept: Mutex<Option<(String, Vec<Hit>)>>,
    /// The last screenshot's Undo: the nonce, the change, and its record.
    undo: Mutex<Option<(String, crate::fileops::Op, Value)>>,
}

fn front(app: &AppHandle) -> Option<tauri::State<'_, Front>> {
    app.try_state::<Front>()
}

fn front_error(message: &str, code: &str) -> ApiError {
    ApiError { status: 0, message: message.into(), code: Some(code.into()) }
}

/// The front desk is on: this build's Rust (`LookStatus.v` 4), 0060 on the server, doing things allowed here (0b.1).
pub fn ready(app: &AppHandle) -> bool {
    front(app).is_some_and(|f| f.ready.load(Ordering::SeqCst))
}

fn emit(app: &AppHandle, e: FrontEvent) {
    let _ = app.emit("brenda://front", e);
}

/// The page's `front` from the desktop state (P.2): 0060 is on the server, and "Check with me".
pub fn set_rules(app: &AppHandle, f: crate::look::FrontIn, available: bool) {
    let Some(s) = front(app) else { return };
    let on = f.ready && available;
    let was = s.ready.swap(on, Ordering::SeqCst);
    s.check_every.store(f.check_every, Ordering::SeqCst);
    let saved = app.state::<AppState>().config.lock().unwrap().check_every;
    if saved != f.check_every && f.ready {
        crate::update_config(app, |c| c.check_every = f.check_every);
    }
    // K.5.4: the route is compiled and the pool warmed once, before the first request.
    if on && !s.warmed.swap(true, Ordering::SeqCst) {
        let app2 = app.clone();
        std::thread::spawn(move || warm_up(&app2));
    }
    if on != was {
        emit(app, FrontEvent::Status { front: status_value(app) });
    }
}

fn check_every(app: &AppHandle) -> bool {
    front(app).is_some_and(|f| f.check_every.load(Ordering::SeqCst))
}

/// `LookStatus.front` (P.6).
pub fn status_value(app: &AppHandle) -> Value {
    let (ready, check) = front(app).map(|f| (f.ready.load(Ordering::SeqCst), f.check_every.load(Ordering::SeqCst))).unwrap_or((false, false));
    let (consent, added, answers) = {
        let st = app.state::<AppState>();
        let c = st.config.lock().unwrap();
        (c.click_consent_at, c.extra_folders.clone(), c.folders.clone())
    };
    let state_of = |v: Option<&String>| v.filter(|s| s.as_str() == "granted" || s.as_str() == "denied").cloned().unwrap_or_else(|| "unknown".into());
    let mut folders = vec![
        json!({ "source": "named", "name": "desktop", "title": "Desktop", "state": state_of(answers.as_ref().and_then(|a| a.desktop.as_ref())) }),
        json!({ "source": "named", "name": "documents", "title": "Documents", "state": state_of(answers.as_ref().and_then(|a| a.documents.as_ref())) }),
        json!({ "source": "named", "name": "downloads", "title": "Downloads", "state": state_of(answers.as_ref().and_then(|a| a.downloads.as_ref())) }),
    ];
    for a in &added {
        let title = Path::new(a).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        folders.push(json!({ "source": "added", "name": title, "title": title, "state": "granted" }));
    }
    json!({
        "ready": ready,
        "checkEvery": check,
        "clickConsent": consent.is_some(),
        "folders": folders,
        "apps": crate::appindex::current(app).entries.len(),
        "jobLive": crate::jobs::brief_value(app),
    })
}

/// The nonce of a front question waiting for its answer (her keys and Option+Space answer it, A.9).
pub fn waiting(app: &AppHandle) -> Option<String> {
    front(app)?.wait.lock().unwrap().as_ref().filter(|(_, k)| *k != WaitKind::Consent).map(|(n, _)| n.clone())
}

fn signal(app: &AppHandle, nonce: &str, s: Signal) -> bool {
    let Some(f) = front(app) else { return false };
    if f.wait.lock().unwrap().as_ref().is_none_or(|(n, _)| n != nonce) {
        return false;
    }
    *f.signal.lock().unwrap() = Some(s);
    f.wake.notify_all();
    true
}

/// Esc on a front question is no (and "None of these" on a chooser). Whether it was one.
pub fn esc(app: &AppHandle) -> bool {
    let Some(f) = front(app) else { return false };
    let w = f.wait.lock().unwrap().clone();
    match w {
        Some((n, WaitKind::Ask)) => signal(app, &n, Signal::No),
        Some((n, WaitKind::Choose)) => signal(app, &n, Signal::Choose(None)),
        _ => false,
    }
}

/// Words heard while a front question waited (her keys, Option+Space): the yes grammar on Rust's own transcript.
pub fn heard_answer(app: &AppHandle, nonce: &str, text: &str) {
    let name = crate::companion::name(app);
    let yes = crate::yes::verdict(text, &name) == crate::yes::Verdict::Yes;
    signal(app, nonce, if yes { Signal::Yes("voice", Some(text.chars().take(200).collect())) } else { Signal::No });
}

/// Arms the wait before its card is shown, so an answer can't arrive before Brenda listens for it.
fn arm(app: &AppHandle, nonce: &str, kind: WaitKind) {
    if let Some(f) = front(app) {
        *f.signal.lock().unwrap() = None;
        *f.wait.lock().unwrap() = Some((nonce.to_string(), kind));
        crate::act::sync_esc(app);
    }
}

/// Waits for the person (ms) after `arm`; the signal, or None (silence, or stopped).
fn wait_for(app: &AppHandle, nonce: &str, kind: WaitKind, ms: u64) -> Option<Signal> {
    let f = front(app)?;
    if f.wait.lock().unwrap().as_ref().is_none_or(|(n, k)| n != nonce || *k != kind) {
        arm(app, nonce, kind);
    }
    let until = Instant::now() + Duration::from_millis(ms);
    let mut s = f.signal.lock().unwrap();
    let out = loop {
        if let Some(x) = s.take() {
            break Some(x);
        }
        if f.stop.load(Ordering::SeqCst) || Instant::now() >= until {
            break None;
        }
        s = f.wake.wait_timeout(s, until.saturating_duration_since(Instant::now()).min(Duration::from_millis(250))).unwrap().0;
    };
    drop(s);
    *f.wait.lock().unwrap() = None;
    crate::act::sync_esc(app);
    out
}

/// R1 "stop", the tray: the front sequence, a Files job and speech stop.
pub fn stop_all(app: &AppHandle) {
    if let Some(f) = front(app) {
        f.stop.store(true, Ordering::SeqCst);
        f.wake.notify_all();
        f.cancel.notify_waiters();
    }
    crate::jobs::stop(app, "said");
    crate::voice::stop_speaking(app);
}

/// Signing out: the outbox, the kept files and Undo go; anything running stops.
pub fn forget(app: &AppHandle) {
    if let Some(f) = front(app) {
        f.stop.store(true, Ordering::SeqCst);
        f.wake.notify_all();
        f.cancel.notify_waiters();
        f.outbox.lock().unwrap().clear();
        *f.kept.lock().unwrap() = None;
        *f.undo.lock().unwrap() = None;
        f.ready.store(false, Ordering::SeqCst);
        f.warmed.store(false, Ordering::SeqCst);
    }
}

/// The person's app's name and bundle (names only), for the router.
fn front_app_json(app: &AppHandle) -> Value {
    match crate::capture::person_front(app) {
        Some(f) => json!({ "name": f.name.unwrap_or_default().chars().take(80).collect::<String>(), "bundleId": f.bundle_id }),
        None => Value::Null,
    }
}

/// The real host around a request: events, waits, the app index, search, folders, the screenshot's file.
struct AppHost {
    app: AppHandle,
    nonce: String,
    typed: bool,
    pointed: Vec<PathBuf>,
    stop: Arc<AtomicBool>,
    /// The apps looked up for this request (the index and `plutil` once per name).
    apps: std::cell::RefCell<std::collections::HashMap<String, Option<AppTarget>>>,
}

impl AppHost {
    fn roots(&self) -> Vec<(PathBuf, String)> {
        let home = crate::filework::home().unwrap_or_default();
        let added = self.app.state::<AppState>().config.lock().unwrap().extra_folders.clone();
        crate::jobs::roots(&home, &added, &self.pointed).into_iter().map(|r| (r.path, r.title)).collect()
    }
}

impl Host for AppHost {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
    fn emit(&mut self, e: FrontEvent) {
        // Her states by the pointer (F.1): doing while the sequence runs.
        if let FrontEvent::Doing { line, .. } = &e {
            crate::companion::set_act(&self.app, Some(crate::companion::ActView { state: crate::companion::State::Doing, text: line.trim_end_matches('.').to_string(), sub: String::new(), hint: String::new() }), None);
        }
        emit(&self.app, e);
    }
    fn ask(&mut self, card: &AskCard) -> Answer {
        crate::companion::set_act(&self.app, Some(crate::companion::ActView { state: crate::companion::State::Asking, text: card.question.clone(), sub: card.because.clone(), hint: HINT.into() }), None);
        arm(&self.app, &self.nonce, WaitKind::Ask);
        emit(&self.app, FrontEvent::Ask { nonce: self.nonce.clone(), question: card.question.clone(), because: card.because.clone(), yes: card.yes.clone(), wait_ms: card.wait_ms });
        match wait_for(&self.app, &self.nonce, WaitKind::Ask, card.wait_ms) {
            Some(Signal::Yes(via, _)) => Answer::Yes(via),
            Some(_) => Answer::No,
            None => Answer::Silence,
        }
    }
    fn choose(&mut self, rows: &[Row]) -> Option<usize> {
        arm(&self.app, &self.nonce, WaitKind::Choose);
        emit(&self.app, FrontEvent::Choose { nonce: self.nonce.clone(), question: "Which one?".into(), options: rows.to_vec() });
        match wait_for(&self.app, &self.nonce, WaitKind::Choose, ASK_WAIT_MS) {
            Some(Signal::Choose(i)) => i,
            _ => None,
        }
    }
    fn app(&self, said: &str) -> Option<AppTarget> {
        if let Some(t) = self.apps.borrow().get(said) {
            return t.clone();
        }
        let t = self.lookup(said);
        self.apps.borrow_mut().insert(said.to_string(), t.clone());
        t
    }
    fn search(&self, a: &MacAction) -> Result<Vec<Hit>, Refusal> {
        self.search_in(a)
    }
    fn folder(&self, f: &FolderRef) -> Result<PathBuf, Refusal> {
        self.folder_of(f)
    }
    fn never(&self, app: &RunningApp) -> Option<String> {
        let rules = crate::look::current_rules(&self.app);
        crate::guard::no_act(&crate::look::AppId { bundle_id: app.bundle_id.clone(), names: vec![app.name.clone()] }, &rules)
    }
    fn file_facts(&self, p: &Path) -> Vec<Fact> {
        self.facts_of(p)
    }
    fn save_screenshot(&mut self, png: &[u8]) -> Result<(PathBuf, crate::fileops::Op), Refusal> {
        self.save_png(png)
    }
    fn now_unix(&self) -> i64 {
        (iso_ms() / 1000) as i64
    }
    fn notch_point(&self) -> Option<(f64, f64)> {
        self.notch()
    }
    fn keep_hits(&mut self, hits: Vec<Hit>) {
        if let Some(f) = front(&self.app) {
            *f.kept.lock().unwrap() = Some((self.nonce.clone(), hits));
        }
    }
}

impl AppHost {
    fn new(app: &AppHandle, nonce: &str, typed: bool, pointed: Vec<PathBuf>, stop: Arc<AtomicBool>) -> Self {
        AppHost { app: app.clone(), nonce: nonce.to_string(), typed, pointed, stop, apps: Default::default() }
    }

    fn lookup(&self, said: &str) -> Option<AppTarget> {
        let e = crate::appindex::resolve(&self.app, said)?;
        let running = e.pid.is_some();
        let refused = crate::open::resolve_app_v2(e.path.as_deref(), &e.name, e.bundle_id.as_deref(), running, &crate::open::RealProbe).err();
        let bundle_id = e.bundle_id.clone().or_else(|| e.path.as_deref().and_then(crate::open::bundle_id_of));
        Some(AppTarget { name: e.name, path: e.path, pid: e.pid, bundle_id, refused })
    }
    fn search_in(&self, a: &MacAction) -> Result<Vec<Hit>, Refusal> {
        let file_work = self.app.state::<AppState>().config.lock().unwrap().file_work;
        if !file_work {
            return Err(Refusal { enable: Some("files".into()), ..refusal("“Work on my files” is off on this Mac.", "Turn it on, then ask me again.") });
        }
        let mut roots = self.roots();
        if a.folder.source != "none" && !a.folder.name.is_empty() {
            let p = self.folder(&a.folder)?;
            let title = folder_words(&a.folder);
            roots = vec![(p, title)];
        }
        let rules = crate::look::current_rules(&self.app);
        let never = crate::folder::never_names(&rules);
        let at = SearchIn { roots: &roots, never: &never, now: (iso_ms() / 1000) as i64 };
        Ok(search(&crate::folder::RealFs, &RealSpot, a, &at))
    }
    fn folder_of(&self, f: &FolderRef) -> Result<PathBuf, Refusal> {
        let home = crate::filework::home().ok_or_else(|| failure("I couldn't do that", "I couldn't find your home folder."))?;
        let rules = crate::look::current_rules(&self.app);
        let never = crate::folder::never_names(&rules);
        let gone = || refusal("I couldn't find that folder", "");
        let p = match f.source.as_str() {
            "named" => crate::folder::NamedFolder::of(&f.name).map(|n| n.dir(&home)).ok_or_else(gone)?,
            "added" => {
                let added = self.app.state::<AppState>().config.lock().unwrap().extra_folders.clone();
                added.iter().map(PathBuf::from).find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(f.name.trim()))).ok_or_else(gone)?
            }
            "pointed" => self.pointed.iter().find(|p| p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(f.name.trim()))).cloned().ok_or_else(gone)?,
            _ => return Err(gone()),
        };
        let ok = p == home || crate::folder::folder_ok(&p, &home, &never) || (f.source == "added" && p.is_dir());
        if !ok || !p.is_dir() {
            return Err(gone());
        }
        Ok(p)
    }
    fn facts_of(&self, p: &Path) -> Vec<Fact> {
        let mut f = Vec::new();
        if crate::guard::never_open(p, &crate::open::RealProbe).is_some() || crate::guard::runs_something(p) {
            f.push(Fact::Installer);
        }
        if crate::guard::secret_file(p) {
            f.push(Fact::Secret);
        }
        if let Some(h) = crate::guard::OpenProbe::handler(&crate::open::RealProbe, p) {
            if crate::guard::handler_refused(&h, &crate::look::current_rules(&self.app)).is_some() {
                f.push(Fact::Installer);
            }
        }
        f
    }
    fn save_png(&mut self, png: &[u8]) -> Result<(PathBuf, crate::fileops::Op), Refusal> {
        use crate::fileops::FileSys;
        let home = crate::filework::home().ok_or_else(|| failure("I couldn't save the screenshot", ""))?;
        let desktop = home.join("Desktop");
        let fs = crate::fileops::RealFileSys::new();
        let name = crate::macos::screenshot_name((iso_ms() / 1000) as i64);
        for cand in crate::fileops::name_candidates(&name) {
            let p = desktop.join(&cand);
            match fs.write_new(&p, png) {
                Ok(()) => {
                    let s = fs.stat(&p).map_err(|_| failure("I couldn't save the screenshot", ""))?;
                    return Ok((p.clone(), crate::fileops::Op::New { path: p, ino: s.ino, size: s.size, mtime: s.mtime }));
                }
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(1) => {
                    // "folder": macOS's own permission, so the way out is System Settings › Files and Folders ("files"
                    // is the Work on my files switch; integration, 16 October 2026).
                    return Err(Refusal { enable: Some("folder".into()), ..refusal("Your Mac hasn't let Boredroom into Desktop", "Allow it in System Settings › Privacy & Security › Files and Folders, then ask me again.") })
                }
                Err(_) => return Err(failure("I couldn't save the screenshot", "")),
            }
        }
        Err(failure("I couldn't save the screenshot", ""))
    }
    fn notch(&self) -> Option<(f64, f64)> {
        if !self.typed {
            return None;
        }
        let w = self.app.get_webview_window("notch")?;
        let pos = w.outer_position().ok()?;
        let scale = w.scale_factor().ok()?;
        let size = w.outer_size().ok()?;
        Some((pos.x as f64 / scale + size.width as f64 / scale / 2.0, pos.y as f64 / scale + 4.0))
    }
}

fn iso_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// One request as the front desk handles it.
#[derive(Clone, Debug)]
struct Req {
    nonce: String,
    text: String,
    via: &'static str,
    at: String,
    age_ms: u64,
    look_id: Option<String>,
    candidates: Vec<crate::filework::Candidate>,
    /// Ask first for this one request, as "Check with me before every task" does (review, 16 October 2026: the page's Ask
    /// again sends words kept up to ten minutes, so anything they lead to shows Yes and No first).
    check: bool,
}

impl Req {
    fn pointed(&self) -> Vec<PathBuf> {
        self.candidates.iter().filter(|c| c.kind == crate::filework::Kind::Folder).map(|c| c.path.clone()).collect()
    }
}

fn result(req: &Req, lane: &str, extra: Value) -> Value {
    let mut v = json!({ "v": 1, "nonce": req.nonce, "lane": lane });
    if let (Some(o), Value::Object(e)) = (v.as_object_mut(), extra) {
        o.extend(e);
    }
    v
}

/// Runs a request's actions on this Mac (matched here, or the router's `mac` lane): classify, `matched`, the pictures
/// wiped, the ask when needed, the sequence, the record into the outbox. Blocking; never on the main thread.
fn do_actions(app: &AppHandle, req: &Req, actions: &[MacAction], matched: &str, server: Option<Class>) -> Value {
    let f = front(app).expect("front state");
    // Never cleared here (review, 16 October 2026): a "stop" said while the router thought must still hold.
    if f.stop.load(Ordering::SeqCst) {
        if let Some(id) = &req.look_id {
            crate::look::discard(app, id);
        }
        return result(req, "none", json!({ "outcome": "stopped" }));
    }
    // "Do things when I ask" off: never "I can't", the switch is offered (C, S.5).
    if !app.state::<AppState>().config.lock().unwrap().use_mac {
        let r = Refusal { enable: Some("mac".into()), ..refusal("“Do things when I ask” is off on this Mac.", "Turn it on, then ask me again.") };
        emit(app, FrontEvent::Refused { nonce: req.nonce.clone(), title: r.title, sub: r.sub, enable: r.enable });
        if let Some(id) = &req.look_id {
            crate::look::discard(app, id);
        }
        let o = SeqOutcome { outcome: "refused", actions: actions.iter().map(|a| ActionRecord { kind: a.kind.clone(), outcome: "refused", words: String::new() }).collect(), summary: "Do things when I ask is off".into(), risk: Class::Routine, authorised_by: "request", confirmed_via: None, undo: None };
        f.outbox.lock().unwrap().push(record_of(&req.nonce, &req.text, req.via, &req.at, matched, &o, false), Instant::now());
        return result(req, "enable", json!({ "enable": { "which": "mac" } }));
    }
    let mut mac = crate::macos::RealMac::new(app);
    let mut host = AppHost::new(app, &req.nonce, req.via == "typed", req.pointed(), f.stop.clone());
    let check = check_every(app) || req.check;
    let v = classify_actions(&mac, &host, actions, check, server);
    let labels = actions.iter().map(|a| Label { kind: a.kind.clone(), label: doing_line(a).trim_end_matches('.').to_string() }).collect();
    emit(app, FrontEvent::Matched { nonce: req.nonce.clone(), actions: labels, say: doing_line(&actions[0]), risk: v.class });
    if let Some(id) = &req.look_id {
        crate::look::discard(app, id);
    }
    let o = run_actions(&mut mac, &mut host, &req.nonce, actions, &v, check);
    let record = record_of(&req.nonce, &req.text, req.via, &req.at, matched, &o, false);
    if let Some(op) = o.undo.clone() {
        *f.undo.lock().unwrap() = Some((req.nonce.clone(), op, record.clone()));
    }
    f.outbox.lock().unwrap().push(record, Instant::now());
    crate::companion::set_act(app, None, Some(o.outcome == "done"));
    result(req, "mac", json!({ "outcome": o.outcome, "summary": o.summary, "undo": o.undo.is_some() }))
}

/// The router's answer, read whole (B.4): NDJSON lines.
async fn route(app: &AppHandle, req: &Req, messages: &[Value], pictures: bool) -> Result<Vec<RouteLine>, ApiError> {
    let (base, token, slug, use_mac, file_work, consent) = {
        let st = app.state::<AppState>();
        let c = st.config.lock().unwrap();
        (crate::base_url(&c), c.token.clone(), c.workspace_slug.clone(), c.use_mac, c.file_work, c.click_consent_at.is_some())
    };
    let (Some(token), Some(slug)) = (token, slug) else { return Err(ApiError::new(401, "Not signed in.")) };
    let app2 = app.clone();
    let (front_app, running) = tauri::async_runtime::spawn_blocking(move || {
        let index = crate::appindex::current(&app2);
        let running: Vec<String> = index.entries.iter().filter(|e| e.pid.is_some()).map(|e| e.name.chars().take(80).collect()).take(20).collect();
        (front_app_json(&app2), running)
    })
    .await
    .unwrap_or((Value::Null, vec![]));
    let files: Vec<Value> = req.candidates.iter().filter(|c| c.kind != crate::filework::Kind::Folder).take(10).map(|c| serde_json::to_value(c.hint()).unwrap_or(Value::Null)).collect();
    let mut folders = vec![json!({ "source": "named", "name": "desktop" }), json!({ "source": "named", "name": "documents" }), json!({ "source": "named", "name": "downloads" })];
    let added = app.state::<AppState>().config.lock().unwrap().extra_folders.clone();
    for a in added.iter().take(10) {
        folders.push(json!({ "source": "added", "name": Path::new(a).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() }));
    }
    for p in req.pointed().iter().take(1) {
        folders.push(json!({ "source": "pointed", "name": p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default() }));
    }
    let request = front_request_json(&req.text, req.via, req.age_ms, &req.nonce, &req.at);
    let context = front_context_json(&FrontContext {
        front: front_app,
        running,
        files,
        folders,
        use_mac,
        file_work,
        accessibility: crate::act::can_click_and_type(),
        click_consent: consent,
        screen_recording: crate::capture::preflight(),
        pictures,
    });
    let body = router_body(&request, &context, &router_messages(messages, &req.text));
    let res = app
        .state::<AppState>()
        .http
        .post(format!("{base}/api/orgs/{slug}/assistant/front"))
        .bearer_auth(token)
        .header("content-type", "application/json")
        .header("accept", "application/x-ndjson")
        .header("user-agent", crate::user_agent())
        // 20 seconds (helpers-spec; review, 16 October 2026: it was 120, and the strip said "One moment" all that time).
        .timeout(ROUTER_TIMEOUT)
        .json(&body)
        .send()
        .await
        .map_err(|e| if e.is_timeout() { ApiError { status: 0, message: "Claude is busy just now.".into(), code: Some("AI_BUSY".into()) } } else { ApiError { status: 0, message: "I can't reach Boredroom right now.".into(), code: Some("OFFLINE".into()) } })?;
    let status = res.status().as_u16();
    if status >= 400 {
        let v: Value = res.json().await.unwrap_or(Value::Null);
        return Err(ApiError { status, message: v.get("message").and_then(|m| m.as_str()).unwrap_or("Request failed.").into(), code: v.get("code").and_then(|c| c.as_str()).map(String::from) });
    }
    use futures_util::StreamExt;
    let mut lines = crate::look::Lines::default();
    let mut out = Vec::new();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ApiError { status: 0, message: "I can't reach Boredroom right now.".into(), code: Some("OFFLINE".into()) })?;
        for v in lines.push(&chunk).map_err(|_| ApiError::new(0, "Boredroom's answer couldn't be read."))? {
            out.push(route_line(&v));
        }
    }
    if let Some(v) = lines.finish().map_err(|_| ApiError::new(0, "Boredroom's answer couldn't be read."))? {
        out.push(route_line(&v));
    }
    Ok(out)
}

/// How long the router may take before the request ends as busy (helpers-spec B.4).
const ROUTER_TIMEOUT: Duration = Duration::from_secs(20);

/// The router's answer, or None when the person stopped the request meanwhile (said "stop" or pressed Stop): the call is
/// dropped there and then, and nothing it would have done happens (review, 16 October 2026).
async fn route_or_stop(app: &AppHandle, req: &Req, messages: &[Value], pictures: bool) -> Option<Result<Vec<RouteLine>, ApiError>> {
    let f = front(app)?;
    until_stopped(route(app, req, messages, pictures), &f.stop, &f.cancel).await
}

/// `fut`'s answer, or None when `stop` is set before it starts or `cancel` wakes (or `stop` is set) before it answers:
/// `fut` is then dropped, so the request it was making goes no further.
async fn until_stopped<T>(fut: impl std::future::Future<Output = T>, stop: &AtomicBool, cancel: &tokio::sync::Notify) -> Option<T> {
    let cancelled = cancel.notified();
    let mut cancelled = std::pin::pin!(cancelled);
    cancelled.as_mut().enable();
    if stop.load(Ordering::SeqCst) {
        return None;
    }
    let fut = std::pin::pin!(fut);
    match futures_util::future::select(fut, cancelled).await {
        futures_util::future::Either::Left((r, _)) => (!stop.load(Ordering::SeqCst)).then_some(r),
        futures_util::future::Either::Right(_) => None,
    }
}

/// The refused answer for an error (L.2).
fn refused_result(app: &AppHandle, req: &Req, code: Option<&str>, message: &str) -> Value {
    let (title, sub) = error_words(code, message);
    emit(app, FrontEvent::Refused { nonce: req.nonce.clone(), title: title.clone(), sub: sub.clone(), enable: None });
    result(req, "refused", json!({ "error": { "code": code.unwrap_or("FRONT_FAILED"), "message": format!("{title}. {sub}").trim().to_string() } }))
}

/// A job the router offered (B.4, G.2): the click consent once per Mac (operator), "Check with me", then the job.
async fn start_job(app: &AppHandle, req: &Req, job: JobOffer, say: Option<String>, speech: Value) -> Value {
    // A job never needs the pictures (its files were named on this Mac already): wiped now.
    discard_pictures(app, req);
    let mut click = app.state::<AppState>().config.lock().unwrap().click_consent_at.is_some();
    if job.helper == "operator" && (job.needs.consent || !click) {
        arm(app, &req.nonce, WaitKind::Consent);
        emit(app, FrontEvent::Consent { nonce: req.nonce.clone() });
        let (app2, nonce) = (app.clone(), req.nonce.clone());
        let got = tauri::async_runtime::spawn_blocking(move || wait_for(&app2, &nonce, WaitKind::Consent, ASK_WAIT_MS)).await.ok().flatten();
        match got {
            Some(Signal::Consent(true)) => click = true,
            _ => {
                emit(app, FrontEvent::SaidNo { nonce: req.nonce.clone(), line: "Okay, I won't click for you.".into() });
                return result(req, "none", json!({ "outcome": "said_no" }));
            }
        }
    }
    let mut yes: Option<(&'static str, Option<String>)> = None;
    if job.needs.yes || check_every(app) || req.check {
        let card = AskCard { question: job_sentence(&job.title), because: "Do you want me to do this?".into(), yes: "Yes, do it".into(), wait_ms: ASK_WAIT_MS };
        arm(app, &req.nonce, WaitKind::Ask);
        emit(app, FrontEvent::Ask { nonce: req.nonce.clone(), question: card.question.clone(), because: card.because.clone(), yes: card.yes.clone(), wait_ms: card.wait_ms });
        let (app2, nonce) = (app.clone(), req.nonce.clone());
        match tauri::async_runtime::spawn_blocking(move || wait_for(&app2, &nonce, WaitKind::Ask, ASK_WAIT_MS)).await.ok().flatten() {
            Some(Signal::Yes(via, text)) => yes = Some((via, text)),
            other => {
                let line = if other.is_none() { "I didn't hear a yes, so I won't do it." } else { "Okay, I won't." };
                emit(app, FrontEvent::SaidNo { nonce: req.nonce.clone(), line: line.into() });
                return result(req, "none", json!({ "outcome": "said_no" }));
            }
        }
    }
    let (app2, token, helper) = (app.clone(), job.token.clone(), job.helper.clone());
    let created = tauri::async_runtime::spawn_blocking(move || crate::jobs::create_job(&app2, &token, yes, click)).await.unwrap_or_else(|_| Err(ApiError::new(0, "That didn't go through.")));
    let mut view = match created {
        Ok(v) if v.helper == helper => v,
        Ok(_) => return refused_result(app, req, None, "Boredroom's answer couldn't be read."),
        Err(e) => return refused_result(app, req, e.code.as_deref(), &e.message),
    };
    // The router's line ("Organising your Desktop.") and its natural-voice offer go with the `started` event (M.2).
    view.say = say.filter(|s| !s.trim().is_empty()).map(|s| s.chars().take(200).collect()).unwrap_or_default();
    view.speech = if view.say.is_empty() { Value::Null } else { speech };
    let started = if view.helper == "files" {
        crate::jobs::start_files(app, view.clone(), crate::jobs::StartCtx { candidates: req.candidates.clone(), pointed: req.pointed() })
    } else {
        let origin = crate::act::Origin { display: None, candidates: vec![], front_pid: crate::capture::person_front(app).map(|f| f.pid) };
        crate::jobs::start_operator(app, view.clone(), origin)
    };
    if let Err(e) = started {
        return refused_result(app, req, e.code.as_deref(), &e.message);
    }
    result(req, "job", json!({ "job": { "id": view.id, "helper": view.helper, "title": view.title, "doing": view.doing } }))
}

/// Clears `busy` however a request ends.
struct Busy<'a>(&'a AtomicBool);
impl Drop for Busy<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// The front desk (P.2, P.4): the person's request, from a hold of her keys (`lookId`), Option+Space, or typed with a
/// real press. Matched on the Mac, or a question to a look, or an instruction to the router.
/// Content-free timing lines with `BRENDA_TIMING=1` (K.6): never words.
fn timing(parts: &[(&str, u128)]) {
    if std::env::var("BRENDA_TIMING").ok().as_deref() == Some("1") {
        let p: Vec<String> = parts.iter().map(|(k, ms)| format!("{k} {ms}ms")).collect();
        eprintln!("[timing] {}", p.join(", "));
    }
}

#[tauri::command]
pub async fn front_send(app: AppHandle, look_id: Option<String>, text: String, messages: Vec<Value>, preview: Option<bool>, check: Option<bool>) -> Result<Value, ApiError> {
    let t0 = Instant::now();
    if !ready(&app) {
        return Err(front_error("This needs a database update first.", "FRONT_NOT_READY"));
    }
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(front_error("Say or type what you'd like.", "FRONT_INVALID"));
    }
    let heard = crate::look::heard(&app);
    let look = look_id.as_deref().map(|id| (id, heard.as_ref().map(|(i, w)| (i.as_str(), w.as_str()))));
    let talk = crate::voice::last_talk(&app);
    let via = origin_of(&text, look, talk.as_ref().map(|(w, d)| (w.as_str(), *d)), crate::look::is_person_press(&app)).ok_or_else(|| front_error("Press Enter to send it.", "FRONT_NOT_A_PRESS"))?;
    if crate::act::question_waiting(&app) || waiting(&app).is_some() || crate::jobs::waiting(&app).is_some() {
        return Err(front_error("Answer this one first.", "LOOK_ANSWER_FIRST"));
    }
    let f = front(&app).ok_or_else(|| front_error("This needs a database update first.", "FRONT_NOT_READY"))?;
    // "Stop" works even while the last request still runs (B.1 R1).
    let name_now = crate::companion::name(&app);
    if ["stop", "cancel", "stop it", "stop that", "stop the job", "never mind", "cancel that"].contains(&normalise(&text, &name_now).as_str()) {
        stop_all(&app);
        if let Some(id) = &look_id {
            crate::look::discard(&app, id);
        }
        return Ok(json!({ "v": 1, "nonce": new_nonce(), "lane": "none", "outcome": "stopped" }));
    }
    if f.busy.swap(true, Ordering::SeqCst) {
        return Err(front_error("I'm still on the last one.", "FRONT_BUSY"));
    }
    let _busy = Busy(&f.busy);
    // A new request: its own stop starts clear (a "stop" from before it began is not about it).
    f.stop.store(false, Ordering::SeqCst);
    let age_ms = match (&look_id, via) {
        (Some(id), "voice") => crate::look::heard_age_ms(&app, id),
        (None, "voice") => talk.as_ref().map(|(_, d)| d.as_millis() as u64).unwrap_or(0),
        _ => 0,
    };
    let mut req = Req { nonce: new_nonce(), text: text.clone(), via, at: iso_now(), age_ms, look_id: look_id.clone(), candidates: vec![], check: check == Some(true) };
    let name = crate::companion::name(&app);
    let instruction = crate::intent::is_instruction(&text, &name);
    // Matched first, on the Mac (B.1): a command needs no picture, so it never waits for one.
    let matched = if text.chars().count() > 1_000 {
        None
    } else {
        let app2 = app.clone();
        let t2 = text.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let added: Vec<String> = app2.state::<AppState>().config.lock().unwrap().extra_folders.iter().filter_map(|a| Path::new(a).file_name().map(|n| n.to_string_lossy().to_string())).collect();
            let resolve = |s: &str| crate::appindex::resolve(&app2, s).map(|e| e.name);
            let name = crate::companion::name(&app2);
            let ctx = MatchCtx { name: &name, resolve: &resolve, added: &added };
            match_command(&t2, &ctx)
        })
        .await
        .unwrap_or(None)
    };
    match matched {
        Some(Matched::Stop) => {
            stop_all(&app);
            discard_pictures(&app, &req);
            return Ok(result(&req, "none", json!({ "outcome": "stopped" })));
        }
        Some(Matched::Actions(actions)) => {
            let matched_ms = t0.elapsed().as_millis();
            let (app2, r2) = (app.clone(), req.clone());
            let out = tauri::async_runtime::spawn_blocking(move || do_actions(&app2, &r2, &actions, "mac", None)).await.map_err(|_| front_error("That didn't go through.", "FRONT_FAILED"));
            timing(&[("heard", req.age_ms as u128), ("matched", matched_ms), ("done", t0.elapsed().as_millis())]);
            return out;
        }
        None => {}
    }
    // Not matched: the look's pictures and the files and folders it found (names only leave the Mac).
    if let Some(id) = &look_id {
        crate::look::capture_ready(&app, id).await;
    }
    let info = look_id.as_deref().and_then(|id| crate::look::capture_info(&app, id));
    req.candidates = info.as_ref().map(|i| i.candidates.clone()).unwrap_or_default();
    let pictures = info.as_ref().is_some_and(|i| i.pictures);
    // Over 1,000 characters: never matched or routed (P.4 step 1).
    if text.chars().count() > 1_000 {
        return Ok(if instruction || !pictures { result(&req, "chat", json!({})) } else { ask_look(&app, &req, messages, "auto", preview).await });
    }
    if !goes_to_router(&text, &name) {
        // A question: a look with the pictures, or ordinary chat without (B.3, J.5).
        return Ok(if pictures { ask_look(&app, &req, messages, "auto", preview).await } else { result(&req, "chat", json!({})) });
    }
    emit(&app, FrontEvent::Routing { nonce: req.nonce.clone() });
    let lines = route_or_stop(&app, &req, &messages, pictures).await;
    timing(&[("heard", req.age_ms as u128), ("routed", t0.elapsed().as_millis())]);
    let lines = match lines {
        None => {
            discard_pictures(&app, &req);
            return Ok(result(&req, "none", json!({ "outcome": "stopped" })));
        }
        Some(Ok(l)) => l,
        Some(Err(e)) => return Ok(refused_result(&app, &req, e.code.as_deref().or(if e.status == 0 { Some("OFFLINE") } else { None }), &e.message)),
    };
    let done = lines.iter().find_map(|l| if let RouteLine::Done(v) = l { Some(v.clone()) } else { None }).unwrap_or(Value::Null);
    for line in lines {
        match line {
            RouteLine::Mac { actions, risk } => {
                let (app2, r2) = (app.clone(), req.clone());
                return tauri::async_runtime::spawn_blocking(move || do_actions(&app2, &r2, &actions, "router", Some(risk))).await.map_err(|_| front_error("That didn't go through.", "FRONT_FAILED"));
            }
            RouteLine::Job { job, say, speech } => {
                // Stopped while the router answered: no job starts (review, 16 October 2026).
                if f.stop.load(Ordering::SeqCst) {
                    discard_pictures(&app, &req);
                    return Ok(result(&req, "none", json!({ "outcome": "stopped" })));
                }
                return Ok(start_job(&app, &req, job, say, speech).await);
            }
            RouteLine::Look { lane } => {
                return Ok(if pictures { ask_look(&app, &req, messages, &lane, preview).await } else { result(&req, "look", json!({ "screen": true })) });
            }
            RouteLine::Boredroom => {
                discard_pictures(&app, &req);
                return Ok(result(&req, "boredroom", json!({ "result": done })));
            }
            RouteLine::Ask { question } => {
                discard_pictures(&app, &req);
                return Ok(result(&req, "ask", json!({ "question": question })));
            }
            RouteLine::Enable { which } => {
                discard_pictures(&app, &req);
                return Ok(result(&req, "enable", json!({ "enable": { "which": which } })));
            }
            RouteLine::Refused { reason, message } => {
                discard_pictures(&app, &req);
                emit(&app, FrontEvent::Refused { nonce: req.nonce.clone(), title: message.clone(), sub: String::new(), enable: None });
                return Ok(result(&req, "refused", json!({ "error": { "code": reason, "message": message } })));
            }
            RouteLine::Error { code, message, .. } => {
                discard_pictures(&app, &req);
                return Ok(refused_result(&app, &req, code.as_deref(), &message));
            }
            RouteLine::Done(_) | RouteLine::Ignore => {}
        }
    }
    discard_pictures(&app, &req);
    Ok(refused_result(&app, &req, None, "Boredroom's answer couldn't be read."))
}

fn discard_pictures(app: &AppHandle, req: &Req) {
    if let Some(id) = &req.look_id {
        crate::look::discard(app, id);
    }
}

/// A question about the screen (J): the pictures go with `front: 1` and the lane; with "Show me the picture first" on,
/// the page shows the preview and its Send calls `look_send` with the lane.
async fn ask_look(app: &AppHandle, req: &Req, messages: Vec<Value>, lane: &str, preview: Option<bool>) -> Value {
    let Some(id) = req.look_id.clone() else { return result(req, "look", json!({ "screen": true })) };
    let wants_preview = preview.unwrap_or(false) || app.state::<AppState>().config.lock().unwrap().look_preview;
    if wants_preview {
        return result(req, "look", json!({ "needsPreview": true, "look": { "lane": lane } }));
    }
    let mut messages = messages;
    let last_ok = messages.last().is_some_and(|m| m.get("role").and_then(|r| r.as_str()) == Some("user") && m.get("content").and_then(|c| c.as_str()).map(str::trim) == Some(req.text.as_str()));
    if !last_ok {
        messages.push(json!({ "role": "user", "content": req.text }));
    }
    match crate::look::front_look(app, &id, &req.text, messages, req.via, lane).await {
        Ok(r) => result(req, "look", json!({ "result": r })),
        Err(e) => refused_result(app, req, e.code.as_deref(), &e.message),
    }
}

/// The person's answer to a front question from the notch (P.2): a real press for the buttons, the yes grammar for words.
#[tauri::command]
pub async fn front_answer(app: AppHandle, nonce: String, answer: String, via: String, text: Option<String>) -> Result<(), ApiError> {
    if !nonce_ok(&nonce) {
        return Err(front_error("That question is gone.", "FRONT_GONE"));
    }
    let v = match via.as_str() {
        "button" => crate::act::Via::Button,
        "typed" => crate::act::Via::Typed,
        _ => return Err(front_error("Answer with the buttons or by typing.", "ACT_ANSWER")),
    };
    let name = crate::companion::name(&app);
    let d = crate::act::decide(&answer, v, text.as_deref(), &name, crate::look::is_real_press(&app), crate::input::seconds_since_post());
    match d {
        crate::act::Decision::NotAPress => Err(front_error("Press Yes to say yes.", "ACT_NOT_A_PRESS")),
        crate::act::Decision::Yes => {
            signal(&app, &nonce, Signal::Yes(if v == crate::act::Via::Button { "button" } else { "typed" }, text));
            Ok(())
        }
        _ => {
            signal(&app, &nonce, Signal::No);
            Ok(())
        }
    }
}

/// A row of the chooser, or None of these (a real press).
#[tauri::command]
pub async fn front_choose(app: AppHandle, nonce: String, index: Option<usize>) -> Result<(), ApiError> {
    if !nonce_ok(&nonce) {
        return Err(front_error("That list is gone.", "FRONT_GONE"));
    }
    if index.is_some() && !crate::act::real_press(&app) {
        return Err(front_error("Press the one you want.", "ACT_NOT_A_PRESS"));
    }
    signal(&app, &nonce, Signal::Choose(index));
    Ok(())
}

/// Opens (or shows) another file from "Show the others" or the found list (a real press; the path re-checked).
/// `index` null is the result itself: the screenshot a done card offers "Show in Finder" for (F.2; the page sends null
/// for it, integration, 16 October 2026). Gone once its Undo put it in the Trash.
#[tauri::command]
pub async fn front_more(app: AppHandle, nonce: String, index: Option<usize>, reveal: bool) -> Result<(), ApiError> {
    if !crate::act::real_press(&app) {
        return Err(front_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    let f = front(&app).ok_or_else(|| front_error("That list is gone.", "FRONT_GONE"))?;
    let hit = match index {
        Some(i) => f.kept.lock().unwrap().as_ref().filter(|(n, _)| *n == nonce).and_then(|(_, h)| h.get(i).cloned()),
        None => f.undo.lock().unwrap().as_ref().filter(|(n, _, _)| *n == nonce).and_then(|(_, op, _)| match op {
            crate::fileops::Op::New { path, .. } => Some(Hit { path: path.clone(), name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), modified: 0, where_: "Desktop".into() }),
            _ => None,
        }),
    }
    .ok_or_else(|| front_error("That list is gone.", "FRONT_GONE"))?;
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use crate::macos::Mac;
        let host = AppHost::new(&app2, &nonce, true, vec![], Arc::new(AtomicBool::new(false)));
        let facts = host.file_facts(&hit.path);
        if risk::classify(if reveal { "reveal_file" } else { "open_file" }, &facts).class == Class::Never || std::fs::symlink_metadata(&hit.path).map(|m| !m.is_file()).unwrap_or(true) {
            return Err(front_error("I don't open that file.", "ACT_FILE"));
        }
        let mut mac = crate::macos::RealMac::new(&app2);
        let ok = if reveal { mac.reveal(&hit.path) } else { mac.open_path(&hit.path) };
        ok.then_some(()).ok_or_else(|| front_error("macOS wouldn't open it.", "ACT_FILE"))
    })
    .await
    .map_err(|_| front_error("That didn't go through.", "ACT_FILE"))?
}

/// Undo of a front action (a screenshot): to the Trash if unchanged; the record says `undone` (a real press).
#[tauri::command]
pub async fn front_undo(app: AppHandle, nonce: String) -> Result<Value, ApiError> {
    if !crate::act::real_press(&app) {
        return Err(front_error("Press Undo.", "ACT_NOT_A_PRESS"));
    }
    let f = front(&app).ok_or_else(|| front_error("That can't be undone any more.", "FRONT_UNDO_GONE"))?;
    let (n, op, mut record) = f.undo.lock().unwrap().take().filter(|(n, _, _)| *n == nonce).ok_or_else(|| front_error("That can't be undone any more.", "FRONT_UNDO_GONE"))?;
    let fs = crate::fileops::RealFileSys::new();
    let c = crate::fileops::undo(&fs, &[op]);
    let line = if c.restored == 1 { "I moved the screenshot to the Trash." } else { "That screenshot had changed, so I left it." };
    if c.restored == 1 {
        record["outcome"] = json!("undone");
        record["undo"] = json!({ "available": false });
        f.outbox.lock().unwrap().push(record, Instant::now());
    }
    emit(&app, FrontEvent::Undone { nonce: n, line: line.into() });
    Ok(json!({ "ok": c.restored == 1, "line": line }))
}

/// Stop on the strip: the front sequence stops (always allowed).
#[tauri::command]
pub async fn front_stop(app: AppHandle) {
    if let Some(f) = front(&app) {
        f.stop.store(true, Ordering::SeqCst);
        f.wake.notify_all();
        f.cancel.notify_waiters();
    }
}

/// The first short line, said at once (K.4; ≤ 200 characters).
#[tauri::command]
pub async fn speak_now(app: AppHandle, text: String) {
    let t: String = text.chars().take(200).collect();
    crate::voice::speak_now(&app, &t);
}

/// "Let Brenda click and type for you" (I.6): once per Mac, from a real press; allowing needs Accessibility.
#[tauri::command]
pub async fn click_consent(app: AppHandle, allow: bool) -> Result<Value, ApiError> {
    if !crate::act::real_press(&app) {
        return Err(front_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    if allow && !crate::ax::trusted() {
        return Err(front_error("Allow Accessibility first.", "ACT_ACCESSIBILITY"));
    }
    crate::update_config(&app, |c| c.click_consent_at = allow.then(|| iso_ms()));
    let waiting_nonce = front(&app).and_then(|f| f.wait.lock().unwrap().as_ref().filter(|(_, k)| *k == WaitKind::Consent).map(|(n, _)| n.clone()));
    if let Some(n) = waiting_nonce {
        signal(&app, &n, Signal::Consent(allow));
    }
    Ok(status_value(&app))
}

/// "Add a folder…" (0b.23): the system's folder picker, one folder, never a system, hidden or home folder; at most 10.
#[tauri::command]
pub async fn files_add_folder(app: AppHandle) -> Result<Value, ApiError> {
    if !crate::act::real_press(&app) {
        return Err(front_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    if app.state::<AppState>().config.lock().unwrap().extra_folders.len() >= 10 {
        return Err(front_error("You can add up to 10 folders.", "FILES_TOO_MANY"));
    }
    let app2 = app.clone();
    let chosen = tauri::async_runtime::spawn_blocking(move || pick_folder(&app2)).await.ok().flatten();
    let Some(p) = chosen else { return Ok(status_value(&app)) };
    let home = crate::filework::home().unwrap_or_default();
    let p = std::fs::canonicalize(&p).unwrap_or(p);
    if !crate::fileops::added_folder_ok(&p, &home) {
        return Err(front_error("That folder can't be added: it's a system or hidden folder, or it holds your home folder.", "FILES_FOLDER"));
    }
    let s = p.to_string_lossy().to_string();
    crate::update_config(&app, |c| {
        if !c.extra_folders.contains(&s) && c.extra_folders.len() < 10 {
            c.extra_folders.push(s.clone());
        }
    });
    Ok(status_value(&app))
}

/// Removes an added folder (a real press).
#[tauri::command]
pub async fn files_remove_folder(app: AppHandle, name: String) -> Result<Value, ApiError> {
    if !crate::act::real_press(&app) {
        return Err(front_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    crate::update_config(&app, |c| c.extra_folders.retain(|a| Path::new(a).file_name().is_none_or(|n| n.to_string_lossy() != name)));
    Ok(status_value(&app))
}

/// `NSOpenPanel`, folders only, one, "Allow" (main thread; modal).
fn pick_folder(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
        use objc2_foundation::NSString;
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let out = objc2::rc::autoreleasepool(|_| unsafe {
                let cls = AnyClass::get(c"NSOpenPanel")?;
                let panel: Option<Retained<AnyObject>> = msg_send![cls, openPanel];
                let panel = panel?;
                let _: () = msg_send![&*panel, setCanChooseDirectories: true];
                let _: () = msg_send![&*panel, setCanChooseFiles: false];
                let _: () = msg_send![&*panel, setAllowsMultipleSelection: false];
                let _: () = msg_send![&*panel, setCanCreateDirectories: false];
                let prompt = NSString::from_str("Allow");
                let _: () = msg_send![&*panel, setPrompt: &*prompt];
                let r: isize = msg_send![&*panel, runModal];
                if r != 1 {
                    return None;
                }
                let url: Option<Retained<AnyObject>> = msg_send![&*panel, URL];
                let path: Option<Retained<NSString>> = url.and_then(|u| msg_send![&*u, path]);
                path.map(|p| PathBuf::from(p.to_string()))
            });
            let _ = tx.send(out);
        })
        .ok()?;
        rx.recv_timeout(Duration::from_secs(600)).ok().flatten()
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        None
    }
}

/// `GET /assistant/front` once (K.5.4): the route compiled, the pool warmed. Nothing is read from the answer.
fn warm_up(app: &AppHandle) {
    let (base, token, slug) = {
        let st = app.state::<AppState>();
        let c = st.config.lock().unwrap();
        (crate::base_url(&c), c.token.clone(), c.workspace_slug.clone())
    };
    let (Some(token), Some(slug)) = (token, slug) else { return };
    let http = app.state::<AppState>().http.clone();
    let _ = tauri::async_runtime::block_on(async move {
        http.get(format!("{base}/api/orgs/{slug}/assistant/front")).bearer_auth(token).header("user-agent", crate::user_agent()).timeout(Duration::from_secs(20)).send().await
    });
}

/// The outbox's sender (E.3): due records go to `POST /assistant/front/record`, on its own thread. "Check with me" starts
/// as this Mac last heard it (0b.22).
pub fn start(app: &AppHandle) {
    if let Some(f) = front(app) {
        f.check_every.store(app.state::<AppState>().config.lock().unwrap().check_every, Ordering::SeqCst);
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("brenda-front-outbox".into()).spawn(move || loop {
        std::thread::sleep(Duration::from_secs(1));
        let Some(f) = front(&app) else { continue };
        let due = f.outbox.lock().unwrap().due(Instant::now());
        if due.is_empty() {
            continue;
        }
        let n = due.len();
        let ok = send_records(&app, due);
        f.outbox.lock().unwrap().sent(ok, n, Instant::now());
    });
}

fn send_records(app: &AppHandle, records: Vec<Value>) -> bool {
    let (base, token, slug) = {
        let st = app.state::<AppState>();
        let c = st.config.lock().unwrap();
        (crate::base_url(&c), c.token.clone(), c.workspace_slug.clone())
    };
    let (Some(token), Some(slug)) = (token, slug) else { return false };
    let http = app.state::<AppState>().http.clone();
    let body = json!({ "version": 1, "records": records });
    tauri::async_runtime::block_on(async move {
        match http.post(format!("{base}/api/orgs/{slug}/assistant/front/record")).bearer_auth(token).header("user-agent", crate::user_agent()).timeout(Duration::from_secs(20)).json(&body).send().await {
            // Anything the server answered (saved, or a record it refused) is done with; only no answer retries.
            Ok(res) => res.status().as_u16() < 500,
            Err(_) => false,
        }
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::macos::testing::RecordingMac;
    use std::cell::RefCell;

    /// B.2's fixture names, resolved as the index would.
    pub fn resolver(s: &str) -> Option<String> {
        let apps = ["Figma", "Slack", "Spotify", "Safari", "Google Chrome", "Visual Studio Code", "Notes", "Calculator", "Microsoft Word"];
        let k = crate::appindex::key_of(&crate::appindex::clean_said(s));
        if k.is_empty() {
            return None;
        }
        if let Some(a) = apps.iter().find(|a| crate::appindex::key_of(a) == k) {
            return Some(a.to_string());
        }
        if let Some((_, t)) = crate::open::APP_ALIASES.iter().find(|(a, _)| crate::appindex::key_of(a) == k) {
            if apps.contains(t) {
                return Some(t.to_string());
            }
        }
        let near: Vec<&&str> = apps.iter().filter(|a| k.len() >= 5 && crate::appindex::distance(&crate::appindex::key_of(a), &k) <= 1).collect();
        (near.len() == 1).then(|| near[0].to_string())
    }

    fn m(text: &str) -> Option<Matched> {
        let ctx = MatchCtx { name: "Max", resolve: &resolver, added: &["Projects".to_string()] };
        match_command(text, &ctx)
    }

    fn acts(text: &str) -> Vec<MacAction> {
        match m(text) {
            Some(Matched::Actions(a)) => a,
            other => panic!("{text:?} → {other:?}"),
        }
    }

    fn kinds(text: &str) -> Vec<String> {
        acts(text).into_iter().map(|a| a.kind).collect()
    }

    /// The ways out Rust names on a refusal (`enable`) are the ones the page's refused card acts on (front.js
    /// `refusedModel`: Turn it on, Allow it, Open System Settings). Integration, 16 October 2026: "automation" and a
    /// folder permission sent as "files" had no button, or the wrong one.
    #[test]
    fn enable_names_are_the_pages() {
        let page = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/front.js")).unwrap();
        let at = page.find("function refusedModel(").expect("refusedModel");
        let list_at = at + page[at..].find("const which = [").expect("the list") + "const which = [".len();
        let list = &page[list_at..list_at + page[list_at..].find(']').unwrap()];
        let known: Vec<String> = list.split(',').map(|x| x.trim().trim_matches('"').to_string()).collect();
        assert!(known.contains(&"finder".to_string()) && known.contains(&"folder".to_string()), "{known:?}");
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/front.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        let mut seen = vec![];
        // `enable: Some("which")`.
        let mut rest = code;
        while let Some(i) = rest.find("enable: Some(\"") {
            rest = &rest[i + "enable: Some(\"".len()..];
            seen.push(rest.chars().take_while(|c| *c != '"').collect::<String>());
        }
        // enable("title", "sub", "which"): the third argument.
        let mut rest = code;
        while let Some(i) = rest.find("enable(\"") {
            rest = &rest[i..];
            let call: String = rest.chars().take_while(|c| *c != ')').collect();
            if let Some(last) = call.rsplit("\", \"").next() {
                seen.push(last.trim_end_matches('"').to_string());
            }
            rest = &rest[1..];
        }
        seen.retain(|n| !n.is_empty() && !n.contains(' '));
        for n in ["finder", "folder", "files", "mac", "accessibility", "screen"] {
            assert!(seen.iter().any(|x| x == n), "{n} not found in {seen:?}");
        }
        for n in &seen {
            assert!(known.contains(n), "Rust sends enable {n:?}, which the page's refused card doesn't know ({known:?})");
        }
    }

    /// B.1's vectors.
    #[test]
    fn match_vectors() {
        for t in ["Open Figma", "open up figma", "Launch Figma.", "Max, can you open Figma please", "open figma for me", "Open Sigma"] {
            assert_eq!(acts(t), vec![MacAction::app("open_app", "Figma")], "{t}");
        }
        for t in ["switch to Slack", "go to Slack", "bring up slack"] {
            assert_eq!(acts(t), vec![MacAction::app("open_app", "Slack")], "{t}");
        }
        assert_eq!(acts("open Figma and Slack"), vec![MacAction::app("open_app", "Figma"), MacAction::app("open_app", "Slack")]);
        assert_eq!(acts("open Figma, Slack and Notes").len(), 3);
        for t in ["Go to stripe.com", "go to stripe dot com", "open stripe.com"] {
            assert_eq!(acts(t), vec![MacAction { url: "https://stripe.com".into(), ..MacAction::of("open_url") }], "{t}");
        }
        for (t, f) in [("open my downloads", "downloads"), ("open the downloads folder", "downloads"), ("show me my documents", "documents")] {
            assert_eq!(acts(t), vec![MacAction { folder: FolderRef { source: "named".into(), name: f.into() }, ..MacAction::of("open_folder") }], "{t}");
        }
        assert_eq!(acts("open my Projects folder")[0].folder, FolderRef { source: "added".into(), name: "Projects".into() });
        let vol = |t: &str| {
            let a = acts(t);
            (a[0].kind.clone(), a[0].change.clone(), a[0].level)
        };
        for t in ["Turn the volume down", "volume down", "quieter", "Turn the volume down a bit.", "Lower the volume.", "volume down a little", "turn down the music a touch"] {
            assert_eq!(vol(t), ("volume".into(), "down".into(), 0), "{t}");
        }
        for t in ["Raise the volume", "increase the sound a bit"] {
            assert_eq!(vol(t), ("volume".into(), "up".into(), 0), "{t}");
        }
        for t in ["turn it up", "louder"] {
            assert_eq!(vol(t), ("volume".into(), "up".into(), 0), "{t}");
        }
        for t in ["set the volume to 30", "volume 30 percent", "volume 30%"] {
            assert_eq!(vol(t), ("volume".into(), "set".into(), 30), "{t}");
        }
        assert_eq!(kinds("mute"), ["mute"]);
        assert_eq!(kinds("turn the sound off"), ["mute"]);
        assert_eq!(kinds("unmute"), ["unmute"]);
        for t in ["Take a screenshot of this", "screenshot", "capture my screen", "Screenshot this.", "screenshot that"] {
            assert_eq!(kinds(t), ["screenshot"], "{t}");
        }
        for (t, on) in [("Turn off Wi-Fi", false), ("wifi off", false), ("turn wi fi on", true)] {
            assert_eq!(acts(t), vec![MacAction { on, ..MacAction::of("wifi") }], "{t}");
        }
        assert_eq!(kinds("Empty the Trash"), ["empty_trash"]);
        assert_eq!(kinds("empty the bin"), ["empty_trash"]);
        assert_eq!(kinds("Hide everything"), ["hide_all"]);
        assert_eq!(kinds("Hide all my windows."), ["hide_all"]);
        assert_eq!(kinds("hide the other apps"), ["hide_others"]);
        assert_eq!(kinds("show everything"), ["show_all"]);
        assert_eq!(acts("hide Slack"), vec![MacAction::app("hide_app", "Slack")]);
        assert_eq!(acts("minimise this"), vec![MacAction::app("minimise", "")]);
        assert_eq!(acts("minimize Figma"), vec![MacAction::app("minimise", "Figma")]);
        assert_eq!(acts("make Figma full screen"), vec![MacAction::app("fill", "Figma")]);
        assert_eq!(acts("maximise Safari"), vec![MacAction::app("fill", "Safari")]);
        let sbs = vec![MacAction { app2: "Figma".into(), ..MacAction::app("arrange", "Slack") }];
        for t in ["Put Slack and Figma side by side", "Slack on the left and Figma on the right", "Figma on the right and Slack on the left", "Put Slack and Figma side-by-side."] {
            assert_eq!(acts(t), sbs, "{t}");
        }
        assert_eq!(acts("put Figma on the left"), vec![MacAction { side: "left".into(), ..MacAction::app("half", "Figma") }]);
        for t in ["Quit Spotify", "close Spotify"] {
            assert_eq!(acts(t), vec![MacAction::app("quit_app", "Spotify")], "{t}");
        }
        assert_eq!(acts("Write 'running five minutes late' here")[0].text, "running five minutes late");
        assert_eq!(acts("write running five minutes late in here")[0].text, "running five minutes late");
        assert_eq!(acts("Write, running five minutes late, here.")[0].text, "running five minutes late", "whisper's commas");
        assert_eq!(acts("Write running five minutes late here.")[0].text, "running five minutes late");
        assert_eq!(acts("make Figma full-screen"), vec![MacAction::app("fill", "Figma")]);
        assert_eq!(acts("type Hello, World"), vec![MacAction { text: "Hello, World".into(), ..MacAction::of("type_text") }]);
        assert_eq!(acts("Max, type “Back at 3”.")[0].text, "Back at 3", "curly quotes and her name");
        assert_eq!(kinds("copy that"), ["copy_selection"]);
        assert_eq!(m("stop"), Some(Matched::Stop));
        assert_eq!(m("never mind"), Some(Matched::Stop));
        for t in ["open the Q3 deck", "close this window", "write an email to Ada", "turn on dark mode", "what's the volume?", "open a new tab", "kill Spotify", "remind me at 3 to call Ada", "organise my desktop", "", "Max", "please"] {
            assert_eq!(m(t), None, "no match: {t:?}");
        }
    }

    /// Review, 16 October 2026 (experience-1): "stop" while the router thinks drops the router's call, and nothing it
    /// answered runs; the request's stop is cleared only when the next request starts, never inside `do_actions`.
    #[test]
    fn stop_while_routing() {
        let stop = Arc::new(AtomicBool::new(false));
        let cancel = Arc::new(tokio::sync::Notify::new());
        let (s2, c2) = (stop.clone(), cancel.clone());
        let t = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            s2.store(true, Ordering::SeqCst);
            c2.notify_waiters();
        });
        let started = Instant::now();
        let got = tauri::async_runtime::block_on(until_stopped(futures_util::future::pending::<u8>(), &stop, &cancel));
        t.join().unwrap();
        assert_eq!(got, None);
        assert!(started.elapsed() < Duration::from_secs(2), "dropped at once, not at the router's timeout");
        // Stopped before it began: never started.
        assert_eq!(tauri::async_runtime::block_on(until_stopped(async { 1 }, &stop, &cancel)), None);
        stop.store(false, Ordering::SeqCst);
        assert_eq!(tauri::async_runtime::block_on(until_stopped(async { 7 }, &stop, &cancel)), Some(7));
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/front.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        let da = &code[code.find("fn do_actions(").unwrap()..];
        let da = &da[..da.find("\n}\n").unwrap()];
        assert!(!da.contains("stop.store(false"), "do_actions never clears a stop");
        let send = &code[code.find("pub async fn front_send(").unwrap()..];
        assert!(send.find("f.stop.store(false").unwrap() < send.find("route_or_stop(").unwrap(), "cleared when a request starts");
        assert!(code.contains("const ROUTER_TIMEOUT: Duration = Duration::from_secs(20);"));
    }

    /// The matcher's speed (ignored; run with --nocapture): microseconds per request, B.2's fixture resolver.
    #[test]
    #[ignore]
    fn bench_match() {
        for t in ["Open Figma", "Put Slack and Figma side-by-side.", "Turn the volume down a bit.", "Lower the volume.", "Hide all my windows.", "Screenshot this.", "Write, running five minutes late, here.", "open the Q3 deck", "What does this error mean?"] {
            let n = 2_000;
            let start = Instant::now();
            let mut hit = None;
            for _ in 0..n {
                hit = m(t);
            }
            println!("match {t:?}: {:.1} µs each ({})", start.elapsed().as_secs_f64() * 1e6 / n as f64, if hit.is_some() { "matched" } else { "not matched" });
        }
    }

    #[test]
    fn the_words() {
        assert_eq!(doing_line(&MacAction::app("open_app", "Figma")), "Opening Figma.");
        assert_eq!(done_line(&MacAction { url: "https://www.stripe.com/pay".into(), ..MacAction::of("open_url") }, "", 0), "Opened stripe.com.");
        assert_eq!(doing_line(&MacAction { change: "set".into(), level: 30, ..MacAction::of("volume") }), "Volume 30 percent.");
        assert_eq!(done_line(&MacAction::of("find_files"), "", 1), "Found one file.");
        assert_eq!(done_line(&MacAction::of("find_files"), "", 3), "Found 3 files.");
        assert_eq!(check_sentence(&[MacAction::app("open_app", "Figma"), MacAction::app("hide_app", "Slack"), MacAction::of("mute")]), "I'll open Figma, hide Slack and mute the sound.");
        assert_eq!(job_sentence("Organise your Desktop"), "I'll organise your Desktop.");
        assert_eq!(line_name("  Q3 <deck>/final  "), "Q3 deckfinal");
        assert_eq!(line_name(&format!("{}.pdf", "a".repeat(45))), "a".repeat(45));
        let v = risk::classify("empty_trash", &[]);
        assert_eq!(ask_card(&[MacAction::of("empty_trash")], &v).yes, "Empty the Trash");
        let c = risk::Verdict { class: Class::Ask, reason: "check_every", ask_kind: Some("other") };
        let card = ask_card(&[MacAction::app("open_app", "Figma")], &c);
        assert_eq!((card.question.as_str(), card.yes.as_str()), ("I'll open Figma.", "Yes, do it"));
        // A row's day goes to the page as "YYYY-MM-DD" (front.js `meta` words it).
        let when = row(&Hit { path: PathBuf::from("/x/Q3.key"), name: "Q3.key".into(), modified: crate::fileops::tests::later(), where_: "Downloads".into() }, 0).when;
        assert!(when.len() == 10 && when.as_bytes()[4] == b'-' && when.as_bytes()[7] == b'-' && when[..4].parse::<i32>().is_ok(), "{when}");
    }

    #[test]
    fn url_vectors() {
        assert_eq!(crate::open::front_url_ok("stripe.com").as_deref(), Some("https://stripe.com"));
        assert!(crate::open::front_url_ok("https://google.com/url?q=https://paypal.com").is_none());
        assert!(is_hostish("stripe.com") && is_hostish("docs.google.com/x") && !is_hostish("slack") && !is_hostish("a..b"));
    }

    #[test]
    fn router_lines_parse() {
        let r = route_line(&json!({ "t": "route", "lane": "mac", "actions": [{ "kind": "open_file", "app": "", "app2": "", "url": "", "folder": { "source": "none", "name": "" }, "words": ["Q3"], "kinds": ["presentation"], "since_days": 0, "pick": "ask", "text": "", "level": 0, "change": "none", "side": "none", "on": false }], "risk": "routine" }));
        match r {
            RouteLine::Mac { actions, risk } => {
                assert_eq!((actions[0].kind.as_str(), actions[0].words[0].as_str(), actions[0].pick.as_str(), risk), ("open_file", "Q3", "ask", Class::Routine));
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(route_line(&json!({ "t": "route", "lane": "mac", "actions": [{ "kind": "format_disk" }], "risk": "routine" })), RouteLine::Ignore, "unknown kinds never run");
        assert_eq!(route_line(&json!({ "t": "route", "lane": "mac", "actions": [{ "kind": "open_app", "app": "Figma" }] })), RouteLine::Mac { actions: vec![MacAction::app("open_app", "Figma")], risk: Class::Ask }, "no risk: asks");
        let j = route_line(&json!({ "t": "route", "lane": "job", "job": { "helper": "files", "title": "Organise your Desktop", "doing": "Organising your Desktop", "goal": "Organise my desktop.", "token": "tok", "needs": { "consent": false, "yes": true } }, "say": "Organising your Desktop.", "speech": null }));
        assert!(matches!(j, RouteLine::Job { ref job, .. } if job.needs.yes && job.helper == "files"));
        assert_eq!(route_line(&json!({ "t": "route", "lane": "job", "job": { "helper": "shell", "title": "x", "doing": "x", "token": "t" } })), RouteLine::Ignore);
        assert_eq!(route_line(&json!({ "t": "route", "lane": "look", "look": { "lane": "think" } })), RouteLine::Look { lane: "think".into() });
        assert_eq!(route_line(&json!({ "t": "route", "lane": "boredroom" })), RouteLine::Boredroom);
        assert_eq!(route_line(&json!({ "t": "route", "lane": "ask", "question": "Which deck do you mean?" })), RouteLine::Ask { question: "Which deck do you mean?".into() });
        assert_eq!(route_line(&json!({ "t": "route", "lane": "enable", "which": "files" })), RouteLine::Enable { which: "files".into() });
        assert!(matches!(route_line(&json!({ "t": "route", "lane": "refused", "reason": "installer", "message": "I don't open that." })), RouteLine::Refused { .. }));
        assert_eq!(route_line(&json!({ "t": "done", "result": {} })), RouteLine::Done(json!({})));
        assert!(matches!(route_line(&json!({ "t": "error", "status": 503, "code": "AI_NO_CREDIT", "message": "x" })), RouteLine::Error { status: 503, .. }));
        assert_eq!(route_line(&json!({ "t": "mystery" })), RouteLine::Ignore);
        assert_eq!(error_words(Some("AI_NO_CREDIT"), "").0, "I can't think that through right now");
    }

    #[test]
    fn router_messages_end_with_the_request() {
        let m = router_messages(&[json!({ "role": "user", "content": "hi" }), json!({ "role": "assistant", "content": "hello" })], "Organise my desktop");
        assert_eq!(m.last().unwrap()["content"], "Organise my desktop");
        let many: Vec<Value> = (0..20).map(|i| json!({ "role": "user", "content": format!("m{i}") })).collect();
        assert_eq!(router_messages(&many, "m19").len(), 10);
        assert!(router_messages(&[json!({ "role": "system", "content": "x" })], "a").iter().all(|x| x["role"] != "system"));
    }

    #[test]
    fn outbox_retry_schedule() {
        let t0 = Instant::now();
        let mut o = Outbox::default();
        o.push(json!({ "nonce": "a" }), t0);
        assert_eq!(o.due(t0).len(), 1, "sent at once");
        o.sent(false, 1, t0);
        assert!(o.due(t0 + Duration::from_secs(29)).is_empty());
        assert_eq!(o.due(t0 + Duration::from_secs(30)).len(), 1, "then after 30 s");
        o.sent(false, 1, t0 + Duration::from_secs(30));
        assert!(o.due(t0 + Duration::from_secs(89)).is_empty());
        assert_eq!(o.due(t0 + Duration::from_secs(90)).len(), 1, "then a minute");
        for _ in 0..6 {
            o.sent(false, 1, t0);
        }
        assert_eq!(o.next_at, Some(t0 + Duration::from_secs(600)), "never more than ten minutes apart");
        o.sent(true, 1, t0 + Duration::from_secs(700));
        assert!(o.queue.is_empty() && o.failures == 0);
    }

    #[test]
    fn outbox_an_hour() {
        let t0 = Instant::now();
        let mut o = Outbox::default();
        o.push(json!({ "nonce": "a" }), t0);
        o.sent(false, 1, t0);
        assert!(o.due(t0 + Duration::from_secs(3_601)).is_empty(), "older than an hour: dropped");
        assert!(o.queue.is_empty());
        // At most 20 a send; a newer record for the same request replaces the older.
        for i in 0..25 {
            o.push(json!({ "nonce": format!("n{i}") }), t0);
        }
        o.push(json!({ "nonce": "n3", "outcome": "undone" }), t0);
        assert_eq!(o.queue.len(), 25);
        assert_eq!(o.due(t0).len(), 20);
    }

    #[test]
    fn outbox_sign_out() {
        let mut o = Outbox::default();
        o.push(json!({ "nonce": "a" }), Instant::now());
        o.clear();
        assert!(o.queue.is_empty() && o.due(Instant::now()).is_empty());
    }

    #[test]
    fn origin_voice_needs_rusts_transcript() {
        // A look's words: exactly Rust's transcript of that look.
        assert_eq!(origin_of("Open Figma", Some(("look1", Some(("look1", "Open Figma")))), None, false), Some("voice"));
        assert_eq!(origin_of("Open Figma", Some(("look1", Some(("look0", "Open Figma")))), None, false), None, "another look's transcript");
        assert_eq!(origin_of("Empty the Trash", Some(("look1", Some(("look1", "Open Figma")))), None, false), None, "words the page changed");
        // Option+Space: the last talk, fresh and the same.
        assert_eq!(origin_of("Open Figma", None, Some(("Open Figma", Duration::from_secs(3))), false), Some("voice"));
        assert_eq!(origin_of("Open Figma", None, Some(("Open Figma", Duration::from_secs(16))), false), None, "too old");
        assert_eq!(origin_of("Quit Slack", None, Some(("Open Figma", Duration::from_secs(1))), false), None);
    }

    /// Owner report, 27 October 2026: "she says I should confirm for her to do it by holding down the keys and saying it
    /// again, but when I do that she doesn't do it and just repeats what she said". Words said with her keys that the
    /// matcher and the verb list both miss went to a look or the chat (which can't act) every time they were said; now
    /// only a plain question skips the router.
    #[test]
    fn key_held_requests_reach_the_router() {
        for s in ["Clear my desktop", "Open Figma?", "Tell Ada I'm running late", "Wi-Fi off", "Open Figma", "Organise my desktop", "Max, hide Slack"] {
            assert!(goes_to_router(s, "Max"), "routed: {s:?}");
            // The same words a second time go the same way: a repeat can never land somewhere new, so nothing may ask for one.
            assert_eq!(goes_to_router(s, "Max"), goes_to_router(s, "Max"));
        }
        for s in ["What does this error mean?", "How do I export in Figma?", "Is Figma open?", "Do you know what this is?"] {
            assert!(!goes_to_router(s, "Max"), "a plain question: {s:?}");
        }
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/front.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        let send = &code[code.find("pub async fn front_send(").unwrap()..];
        let send = &send[..send.find("\n}\n").unwrap()];
        assert!(send.contains("if !goes_to_router(&text, &name) {"), "front_send asks goes_to_router before a look or the chat");
    }

    #[test]
    fn origin_typed_needs_a_real_press() {
        assert_eq!(origin_of("Open Figma", None, None, true), Some("typed"));
        assert_eq!(origin_of("Open Figma", None, None, false), None);
        assert_eq!(origin_of("Open Figma", Some(("look1", None)), None, true), Some("typed"));
    }

    #[test]
    fn nonce_is_fresh_per_request() {
        let a = new_nonce();
        let b = new_nonce();
        assert!(nonce_ok(&a) && nonce_ok(&b));
        assert_ne!(a, b);
        assert!(!nonce_ok("ABC") && !nonce_ok(&"g".repeat(32)));
    }

    // ---- the sequence (C.1) with a recording Mac ----

    pub struct ScriptedHost {
        pub events: Vec<FrontEvent>,
        pub answers: RefCell<Vec<Answer>>,
        pub asked: Vec<AskCard>,
        pub choice: Option<usize>,
        pub hits: Vec<Hit>,
        pub stop_after_events: Option<usize>,
        pub never_names: Vec<String>,
        pub saved: Vec<PathBuf>,
        pub kept: Vec<Hit>,
        pub file_facts: Vec<Fact>,
    }

    impl ScriptedHost {
        pub fn new() -> Self {
            ScriptedHost { events: vec![], answers: RefCell::new(vec![]), asked: vec![], choice: None, hits: vec![], stop_after_events: None, never_names: vec![], saved: vec![], kept: vec![], file_facts: vec![] }
        }
        fn phases(&self) -> Vec<String> {
            self.events.iter().map(|e| serde_json::to_value(e).unwrap()["phase"].as_str().unwrap().to_string()).collect()
        }
    }

    impl Host for ScriptedHost {
        fn stopped(&self) -> bool {
            self.stop_after_events.is_some_and(|n| self.events.len() >= n)
        }
        fn emit(&mut self, e: FrontEvent) {
            self.events.push(e);
        }
        fn ask(&mut self, card: &AskCard) -> Answer {
            self.asked.push(card.clone());
            let mut a = self.answers.borrow_mut();
            if a.is_empty() {
                Answer::Silence
            } else {
                a.remove(0)
            }
        }
        fn choose(&mut self, rows: &[Row]) -> Option<usize> {
            self.events.push(FrontEvent::Choose { nonce: "n".into(), question: "Which one?".into(), options: rows.to_vec() });
            self.choice
        }
        fn app(&self, said: &str) -> Option<AppTarget> {
            let name = resolver(said)?;
            let pid = match name.as_str() {
                "Figma" => Some(11),
                "Slack" => Some(12),
                "Spotify" => Some(13),
                _ => None,
            };
            Some(AppTarget { path: Some(PathBuf::from(format!("/Applications/{name}.app"))), pid, bundle_id: None, refused: None, name })
        }
        fn search(&self, _a: &MacAction) -> Result<Vec<Hit>, Refusal> {
            Ok(self.hits.clone())
        }
        fn folder(&self, f: &FolderRef) -> Result<PathBuf, Refusal> {
            Ok(PathBuf::from(format!("/Users/ada/{}", folder_words(f))))
        }
        fn never(&self, app: &RunningApp) -> Option<String> {
            self.never_names.iter().find(|n| **n == app.name).cloned()
        }
        fn file_facts(&self, _p: &Path) -> Vec<Fact> {
            self.file_facts.clone()
        }
        fn save_screenshot(&mut self, _png: &[u8]) -> Result<(PathBuf, crate::fileops::Op), Refusal> {
            let p = PathBuf::from("/Users/ada/Desktop/Screenshot.png");
            self.saved.push(p.clone());
            Ok((p.clone(), crate::fileops::Op::New { path: p, ino: 1, size: 9, mtime: 1 }))
        }
        fn now_unix(&self) -> i64 {
            1_760_277_845
        }
        fn notch_point(&self) -> Option<(f64, f64)> {
            None
        }
        fn keep_hits(&mut self, hits: Vec<Hit>) {
            self.kept = hits;
        }
    }

    fn go(mac: &mut RecordingMac, host: &mut ScriptedHost, actions: &[MacAction], check_every: bool) -> SeqOutcome {
        let v = classify_actions(mac, host, actions, check_every, None);
        run_actions(mac, host, "nonce", actions, &v, check_every)
    }

    #[test]
    fn sequence_order() {
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &acts("open Figma and Slack"), false);
        assert_eq!(o.outcome, "done");
        assert_eq!(mac.calls(), ["open /Applications/Figma.app", "open /Applications/Slack.app"]);
        assert_eq!(host.phases(), ["doing", "doing", "done"]);
        assert!(host.asked.is_empty(), "routine: no Yes/No (rule v2)");
        assert_eq!((o.authorised_by, o.confirmed_via), ("request", None));
        assert_eq!(o.actions[0].words, "Opened Figma");
    }

    #[test]
    fn sequence_stop_between_actions() {
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        host.stop_after_events = Some(1);
        let o = go(&mut mac, &mut host, &acts("open Figma and Slack"), false);
        assert_eq!(o.outcome, "partly");
        assert_eq!(mac.calls(), ["open /Applications/Figma.app"], "nothing after the stop");
    }

    #[test]
    fn sequence_first_failure_ends() {
        let mut mac = RecordingMac::new();
        mac.open_ok = false;
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &acts("open Figma and Slack"), false);
        assert_eq!(o.outcome, "failed");
        assert_eq!(mac.calls().len(), 1);
        assert_eq!(host.phases().last().unwrap(), "failed");
        // Not running: hide refuses with the words, the rest doesn't run.
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &[MacAction::app("hide_app", "Notes"), MacAction::of("mute")], false);
        assert_eq!(o.outcome, "refused");
        assert!(matches!(&host.events[1], FrontEvent::Refused { title, .. } if title == "Notes isn't open"));
        assert!(!mac.calls().iter().any(|c| c.starts_with("muted")));
    }

    #[test]
    fn sequence_ask_waits() {
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        host.answers.borrow_mut().push(Answer::Yes("button"));
        let o = go(&mut mac, &mut host, &acts("Empty the Trash"), false);
        assert_eq!(host.asked[0].question, "Empty the Trash for good?");
        assert_eq!(o.outcome, "done");
        assert_eq!((o.authorised_by, o.confirmed_via), ("yes", Some("button")));
        assert!(mac.calls().contains(&"empty_trash".to_string()));
        // No: nothing happens.
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        host.answers.borrow_mut().push(Answer::No);
        let o = go(&mut mac, &mut host, &acts("turn off wifi"), false);
        assert_eq!(o.outcome, "said_no");
        assert!(mac.calls().is_empty());
    }

    #[test]
    fn silence_is_no() {
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &acts("Empty the Trash"), false);
        assert_eq!(o.outcome, "said_no");
        assert!(matches!(&host.events[0], FrontEvent::SaidNo { line, .. } if line == "I didn't hear a yes, so I won't do it."));
        assert!(mac.calls().is_empty());
    }

    #[test]
    fn check_every_asks_for_routine() {
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &acts("Open Figma"), true);
        assert_eq!(host.asked[0].question, "I'll open Figma.");
        assert_eq!(o.outcome, "said_no", "silence");
        assert!(mac.calls().is_empty());
        let mut host = ScriptedHost::new();
        host.answers.borrow_mut().push(Answer::Yes("voice"));
        let o = go(&mut mac, &mut host, &acts("Open Figma"), true);
        assert_eq!((o.outcome, o.authorised_by, o.confirmed_via), ("done", "yes", Some("voice")));
    }

    #[test]
    fn ask_class_waits_for_yes() {
        // The server sent it as ask: the Mac asks even though it sees routine (D.4).
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let a = acts("Open Figma");
        let v = classify_actions(&mac, &host, &a, false, Some(Class::Ask));
        assert_eq!(v.class, Class::Ask);
        let o = run_actions(&mut mac, &mut host, "n", &a, &v, false);
        assert_eq!(o.outcome, "said_no");
        assert_eq!(host.asked.len(), 1);
        assert!(mac.calls().is_empty());
    }

    #[test]
    fn never_refuses_with_words() {
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &[MacAction { url: "https://x.com/setup.pkg".into(), ..MacAction::of("open_url") }], false);
        assert_eq!(o.outcome, "refused");
        assert!(matches!(&host.events[0], FrontEvent::Refused { title, .. } if title == "I can't open that address"));
        assert!(mac.calls().is_empty());
        // Typing into a never-look app.
        let mut mac = RecordingMac::new();
        mac.focus = Some(crate::ax::FocusedText { role: "AXTextArea".into(), pid: Some(12), ..Default::default() });
        let mut host = ScriptedHost::new();
        host.never_names = vec!["Slack".into()];
        let o = go(&mut mac, &mut host, &acts("type hello"), false);
        assert_eq!(o.outcome, "refused");
        assert!(mac.typed.borrow().is_empty());
    }

    #[test]
    fn direct_actions_on_the_recording_mac() {
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        go(&mut mac, &mut host, &acts("Put Slack and Figma side by side"), false);
        assert!(mac.calls().contains(&"frame 12 0 25 720 875".to_string()), "{:?}", mac.calls());
        assert!(mac.calls().contains(&"frame 11 720 25 720 875".to_string()));
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &acts("Quit Spotify"), false);
        assert_eq!(o.summary, "Quit Spotify");
        assert!(mac.calls().contains(&"terminate 13".to_string()));
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        go(&mut mac, &mut host, &acts("quieter"), false);
        assert_eq!(mac.volume.get().0, 38);
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &acts("Take a screenshot of this"), false);
        assert!(o.undo.is_some() && host.saved.len() == 1);
        assert!(matches!(host.events.last().unwrap(), FrontEvent::Done { show: true, undo: true, .. }));
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        go(&mut mac, &mut host, &acts("hide the other apps"), false);
        assert!(mac.calls().contains(&"hide 12".to_string()) && !mac.calls().contains(&"hide 11".to_string()), "the person's own app stays: {:?}", mac.calls());
        assert!(!mac.calls().contains(&"hide 999".to_string()), "never Brenda");
        // Quit: never Brenda, never Finder.
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        let o = go(&mut mac, &mut host, &[MacAction::app("quit_app", "Notes")], false);
        assert_eq!(o.outcome, "refused", "not open");
        let o = go(&mut mac, &mut host, &acts("type running late"), false);
        assert_eq!(o.actions[0].words, "Typed into the box", "the typed text is never recorded");
    }

    /// A typed request: Brenda's notch has the keyboard until the front is handed back, so that is no reason to refuse
    /// (the box is checked after the hand-back).
    #[test]
    fn typed_request_hands_back_before_the_box_is_checked() {
        let mut mac = RecordingMac::new();
        mac.focus = Some(crate::ax::FocusedText { role: "AXTextField".into(), pid: Some(999), ..Default::default() });
        let host = ScriptedHost::new();
        let v = classify_actions(&mac, &host, &acts("type running late"), false, None);
        assert_eq!(v.class, Class::Routine, "not refused as Brenda's own box before the hand-back");
        let mut host = ScriptedHost::new();
        let o = run_actions(&mut mac, &mut host, "n", &acts("type running late"), &v, false);
        assert!(mac.calls().iter().any(|c| c.starts_with("hand_back")), "{:?}", mac.calls());
        assert_eq!(o.outcome, "refused", "still Brenda's after the hand-back: no box");
        assert!(mac.typed.borrow().is_empty());
        let long = MacAction { text: "x".repeat(2_001), ..MacAction::of("type_text") };
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        assert_eq!(go(&mut mac, &mut host, &[long], false).outcome, "refused");
    }

    #[test]
    fn several_matches_choose_and_newest() {
        let hit = |n: &str, t: i64| Hit { path: PathBuf::from(format!("/Users/ada/Downloads/{n}")), name: n.into(), modified: t, where_: "Downloads".into() };
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        host.hits = vec![hit("Q3 deck v2.key", 300), hit("Q3 deck.key", 200)];
        host.choice = Some(1);
        let a = MacAction { words: vec!["Q3".into()], kinds: vec!["presentation".into()], pick: "ask".into(), ..MacAction::of("open_file") };
        let o = go(&mut mac, &mut host, &[a.clone()], false);
        assert_eq!(o.outcome, "done");
        assert_eq!(mac.calls(), ["open /Users/ada/Downloads/Q3 deck.key"]);
        assert!(host.phases().contains(&"choose".to_string()));
        // None of these: no.
        let mut mac = RecordingMac::new();
        host.choice = None;
        host.events.clear();
        assert_eq!(go(&mut mac, &mut host, &[a.clone()], false).outcome, "said_no");
        // "last week's invoice": the newest opens, the others are listed.
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        host.hits = vec![hit("Invoice 12.pdf", 300), hit("Invoice 11.pdf", 200), hit("Invoice 10.pdf", 100)];
        let a = MacAction { words: vec!["invoice".into()], since_days: 7, pick: "newest".into(), ..MacAction::of("open_file") };
        go(&mut mac, &mut host, &[a], false);
        assert_eq!(mac.calls(), ["open /Users/ada/Downloads/Invoice 12.pdf"]);
        assert!(matches!(host.events.last().unwrap(), FrontEvent::Done { others, .. } if others.len() == 2));
        assert_eq!(host.kept.len(), 2);
        // A secret never opens.
        let mut mac = RecordingMac::new();
        let mut host = ScriptedHost::new();
        host.hits = vec![hit("vault.kdbx", 1)];
        host.file_facts = vec![Fact::Secret];
        let o = go(&mut mac, &mut host, &[MacAction { words: vec!["vault".into()], ..MacAction::of("open_file") }], false);
        assert_eq!(o.outcome, "refused");
        assert!(mac.calls().is_empty());
    }

    pub struct FakeSpot(pub Option<Vec<PathBuf>>);

    impl Spot for FakeSpot {
        fn find(&self, _root: &Path, _word: &str) -> Option<Vec<PathBuf>> {
            self.0.clone()
        }
    }

    #[test]
    fn search_over_a_temp_tree() {
        let t = crate::fileops::tests::Tree::new("search");
        let a = t.file("Downloads/Invoice Oct.pdf", "a");
        let b = t.file("Documents/Clients/Invoice Sept.pdf", "b");
        t.file("Downloads/notes.txt", "n");
        t.file("Downloads/invoice passwords.csv", "secret");
        t.file("Downloads/.invoice hidden.pdf", "h");
        crate::fileops::tests::set_mtime(&b, 1_700_000_000);
        let _ = a;
        let roots = vec![(t.home.join("Desktop"), "Desktop".to_string()), (t.home.join("Documents"), "Documents".to_string()), (t.home.join("Downloads"), "Downloads".to_string())];
        let at = SearchIn { roots: &roots, never: &[], now: crate::fileops::tests::later() };
        let act = MacAction { words: vec!["invoice".into()], kinds: vec!["pdf".into()], ..MacAction::of("open_file") };
        // Spotlight silent: the walk.
        let hits = search(&crate::folder::RealFs, &FakeSpot(None), &act, &at);
        assert_eq!(hits.iter().map(|h| h.name.as_str()).collect::<Vec<_>>(), ["Invoice Oct.pdf", "Invoice Sept.pdf"], "newest first; no secrets, no hidden files");
        assert_eq!(hits[1].where_, "Clients");
        // Spotlight's answers are checked the same way (a path outside the roots is dropped).
        let spot = FakeSpot(Some(vec![t.home.join("Downloads/Invoice Oct.pdf"), PathBuf::from("/etc/invoice.pdf"), t.home.join("Downloads/invoice passwords.csv")]));
        let hits = search(&crate::folder::RealFs, &spot, &act, &at);
        assert!(hits.iter().all(|h| h.path.starts_with(&t.home)));
        assert!(hits.iter().any(|h| h.name == "Invoice Oct.pdf"));
        // Last week only.
        let act = MacAction { words: vec!["invoice".into()], since_days: 7, ..MacAction::of("open_file") };
        let hits = search(&crate::folder::RealFs, &FakeSpot(None), &act, &at);
        assert_eq!(hits.len(), 1);
        assert_eq!(fold_name("Résumé"), "resume");
    }

    fn seam_dir() -> Option<String> {
        std::env::var("BRENDA_SEAM_DIR").ok().filter(|d| !d.is_empty())
    }

    /// T.2: the router's body and a record, as Rust writes them (`BRENDA_SEAM_DIR=<dir> cargo test --lib -- --ignored seam_`).
    #[test]
    #[ignore]
    fn seam_front_bodies() {
        let Some(dir) = seam_dir() else { return };
        let nonce = "0123456789abcdef0123456789abcdef";
        let request = front_request_json("Organise my desktop", "voice", 412, nonce, "2026-10-12T15:04:05.120Z");
        let context = front_context_json(&FrontContext {
            front: json!({ "name": "Figma", "bundleId": "com.figma.Desktop" }),
            running: vec!["Figma".into(), "Slack".into(), "Safari".into()],
            files: vec![json!({ "source": "finder_selection", "name": "IMG_2041.HEIC", "kind": "image", "bytes": 2_210_000 })],
            folders: vec![json!({ "source": "named", "name": "desktop" }), json!({ "source": "added", "name": "Projects" }), json!({ "source": "pointed", "name": "Invoices" })],
            use_mac: true,
            file_work: true,
            accessibility: true,
            click_consent: false,
            screen_recording: true,
            pictures: true,
        });
        let body = router_body(&request, &context, &router_messages(&[json!({ "role": "assistant", "content": "Hello" })], "Organise my desktop"));
        std::fs::write(format!("{dir}/rust-front-request.json"), serde_json::to_vec_pretty(&body).unwrap()).unwrap();
        let o = SeqOutcome { outcome: "done", actions: vec![ActionRecord { kind: "open_app".into(), outcome: "done", words: "Opened Figma".into() }], summary: "Opened Figma".into(), risk: Class::Routine, authorised_by: "request", confirmed_via: None, undo: None };
        let asked = SeqOutcome { outcome: "done", actions: vec![ActionRecord { kind: "empty_trash".into(), outcome: "done", words: "The Trash is empty".into() }], summary: "The Trash is empty".into(), risk: Class::Ask, authorised_by: "yes", confirmed_via: Some("button"), undo: None };
        let records = json!({ "version": 1, "records": [
            record_of(nonce, "Open Figma", "voice", "2026-10-12T15:04:05.120Z", "mac", &o, false),
            record_of("fedcba9876543210fedcba9876543210", "Empty the Trash", "typed", "2026-10-12T15:05:00.000Z", "mac", &asked, false),
        ] });
        std::fs::write(format!("{dir}/rust-front-record.json"), serde_json::to_vec_pretty(&records).unwrap()).unwrap();
    }

    /// T.2: the server's router answers, through Rust's own reader: each lane's lines are read and acted on.
    #[test]
    #[ignore]
    fn seam_server_route_lines() {
        let Some(dir) = seam_dir() else { return };
        for (lane, name) in [("mac", "server-front-route-mac.ndjson"), ("job", "server-front-route-job.ndjson"), ("look", "server-front-route-look.ndjson"), ("boredroom", "server-front-route-boredroom.ndjson"), ("ask", "server-front-route-ask.ndjson"), ("enable", "server-front-route-enable.ndjson"), ("refused", "server-front-route-refused.ndjson")] {
            let Ok(bytes) = std::fs::read(format!("{dir}/{name}")) else {
                println!("{name}: not written yet");
                continue;
            };
            let mut lines = crate::look::Lines::default();
            let mut all = Vec::new();
            for chunk in bytes.chunks(29) {
                all.extend(lines.push(chunk).unwrap());
            }
            all.extend(lines.finish().unwrap());
            let parsed: Vec<RouteLine> = all.iter().map(route_line).collect();
            assert!(matches!(parsed.last(), Some(RouteLine::Done(_))), "{name}: done is last");
            let ok = parsed.iter().any(|l| match (lane, l) {
                ("mac", RouteLine::Mac { actions, .. }) => !actions.is_empty(),
                ("job", RouteLine::Job { job, .. }) => !job.token.is_empty() && !job.title.is_empty(),
                ("look", RouteLine::Look { lane }) => lane == "now" || lane == "think",
                ("boredroom", RouteLine::Boredroom) => true,
                ("ask", RouteLine::Ask { question }) => !question.is_empty(),
                ("enable", RouteLine::Enable { which }) => ["mac", "files", "accessibility"].contains(&which.as_str()),
                ("refused", RouteLine::Refused { message, .. }) => !message.is_empty(),
                _ => false,
            });
            assert!(ok, "{name}: {parsed:?}");
        }
    }

    /// 0.5: nothing reaches `run_actions` except a request (`handle_request`): no event, timer or server line.
    #[test]
    fn nothing_runs_without_a_request() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        let mut calls = 0;
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            let code: String = src.split("#[cfg(test)]").next().unwrap().to_string();
            let n = code.matches("run_actions(").count();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if n > 0 {
                assert_eq!(name, "front.rs", "{name} runs actions");
            }
            calls += n;
        }
        assert_eq!(calls, 2, "defined once, called once (from the request's own handling)");
        let code = std::fs::read_to_string(format!("{dir}/front.rs")).unwrap();
        let code = code.split("#[cfg(test)]").next().unwrap();
        let at = code.find("fn do_actions(").expect("do_actions");
        assert!(code[at..].find("run_actions(").is_some());
        assert_eq!(code.matches("do_actions(").count(), 3, "defined once; called for a match and for the router's mac lane");
    }
}
