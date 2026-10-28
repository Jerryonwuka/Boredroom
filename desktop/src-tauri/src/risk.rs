//! The risk classifier (permission rule v2, owner, 12 October 2026: "when you hold the keys and clearly ask for a routine
//! task, the request is the permission, and she does it. She still asks before anything destructive, anything sent,
//! anything that costs money, or anything sensitive."; helpers-spec D).
//!
//! `routine` < `ask` < `never`. A kind has a base class (D.2); each true fact that applies to it can only raise it (D.3).
//! The Mac classifies right before every action and every job call, with what only it sees (paths, the focused
//! element, the running apps, quarantine); the server classifies the same table with what it sees. Either side's `ask`
//! asks, and the Mac never runs an `ask` the server sent as routine (`at_least`). The same table and vectors are
//! `src/lib/mac-risk.ts` (`RISK_VECTORS`): change both. Pure.

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Class {
    Routine,
    Ask,
    Never,
}

impl Class {
    pub fn key(self) -> &'static str {
        match self {
            Class::Routine => "routine",
            Class::Ask => "ask",
            Class::Never => "never",
        }
    }

    pub fn of(s: &str) -> Option<Class> {
        match s {
            "routine" => Some(Class::Routine),
            "ask" => Some(Class::Ask),
            "never" => Some(Class::Never),
            _ => None,
        }
    }
}

/// What the Mac (or the server) can see about one action (D.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(test), allow(dead_code))]
pub enum Fact {
    /// An installer-like app, or a file that runs (`RUNS_EXT`, a disk image, a certificate, a link file).
    Installer,
    /// An app from the internet that was never opened.
    Quarantined,
    /// An app outside the Applications folders.
    OutsideApps,
    /// A password store or export, a key, a certificate, an `.env` file.
    Secret,
    /// The focused or target app is on a never-look list or the never-act table.
    NeverLook,
    /// A password box has the keyboard.
    SecureField,
    /// Brenda herself.
    Own,
    /// Quitting Finder.
    Finder,
    BadUrl,
    /// Outside the allowed roots once canonicalised.
    OutsideAllowed,
    /// A dot name, `Library`, an app bundle, a library package, a package's inside (that item is skipped).
    HiddenOrSystem,
    /// Modified or status-changed in the last 300 s (that item is skipped).
    RecentlyChanged,
    CrossVolume,
    /// A to-do for someone else.
    OthersTodo,
    /// "Check with me before every task" (request level only).
    CheckEvery,
}

impl Fact {
    #[cfg_attr(not(test), allow(dead_code))]
    pub const ALL: [Fact; 15] = [
        Fact::Installer,
        Fact::Quarantined,
        Fact::OutsideApps,
        Fact::Secret,
        Fact::NeverLook,
        Fact::SecureField,
        Fact::Own,
        Fact::Finder,
        Fact::BadUrl,
        Fact::OutsideAllowed,
        Fact::HiddenOrSystem,
        Fact::RecentlyChanged,
        Fact::CrossVolume,
        Fact::OthersTodo,
        Fact::CheckEvery,
    ];

    pub fn key(self) -> &'static str {
        match self {
            Fact::Installer => "installer",
            Fact::Quarantined => "quarantined",
            Fact::OutsideApps => "outside_apps",
            Fact::Secret => "secret",
            Fact::NeverLook => "never_look",
            Fact::SecureField => "secure_field",
            Fact::Own => "own",
            Fact::Finder => "finder",
            Fact::BadUrl => "bad_url",
            Fact::OutsideAllowed => "outside_allowed",
            Fact::HiddenOrSystem => "hidden_or_system",
            Fact::RecentlyChanged => "recently_changed",
            Fact::CrossVolume => "cross_volume",
            Fact::OthersTodo => "others_todo",
            Fact::CheckEvery => "check_every",
        }
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn of(s: &str) -> Option<Fact> {
        Fact::ALL.into_iter().find(|f| f.key() == s)
    }

    /// What the fact raises a kind to, and the kinds it applies to (D.3).
    fn rule(self) -> (Class, &'static [&'static str]) {
        const FILE_ITEMS: &[&str] = &["files.move", "files.copy", "files.rename", "files.trash", "files.organise", "files.rename_by_date"];
        match self {
            // The browser a page, a tab or a search opens in is an app like any other (owner report, 28 October 2026).
            Fact::Installer => (Class::Never, &["open_app", "open_file", "files.open", "open_url", "new_tab", "new_window", "search_web"]),
            Fact::Quarantined => (Class::Never, &["open_app", "switch_app", "open_url", "new_tab", "new_window", "search_web"]),
            Fact::OutsideApps => (Class::Never, &["open_app", "open_url", "new_tab", "new_window", "search_web"]),
            Fact::Secret => (Class::Never, &["open_file", "reveal_file", "files.read", "files.open", "files.convert"]),
            Fact::NeverLook => (Class::Never, &["type_text", "copy_selection", "files.read"]),
            Fact::SecureField => (Class::Never, &["type_text", "copy_selection"]),
            Fact::Own => (Class::Never, &["quit_app", "hide_app", "type_text", "copy_selection"]),
            Fact::Finder => (Class::Never, &["quit_app"]),
            Fact::BadUrl => (Class::Never, &["open_url", "search_web"]),
            Fact::OutsideAllowed => (Class::Never, &["files.list", "files.read", "files.make_folder", "files.move", "files.copy", "files.rename", "files.organise", "files.rename_by_date", "files.convert", "files.write", "files.trash", "files.open"]),
            Fact::HiddenOrSystem | Fact::RecentlyChanged => (Class::Never, FILE_ITEMS),
            Fact::CrossVolume => (Class::Never, &["files.move"]),
            Fact::OthersTodo => (Class::Ask, &["bd.create_todos"]),
            // Request level only (`classify_request`).
            Fact::CheckEvery => (Class::Ask, &[]),
        }
    }
}

/// The front desk's direct actions (C) and the job and Boredroom kinds that are routine at base (D.2).
pub const ROUTINE_KINDS: &[&str] = &[
    "open_app", "open_url", "open_folder", "open_file", "reveal_file", "find_files", "switch_app", "hide_app", "hide_others", "hide_all", "show_all", "minimise",
    "arrange", "fill", "half", "quit_app", "volume", "mute", "unmute", "screenshot", "copy_selection", "type_text", "wifi_on",
    // Owner report, 28 October 2026: a new tab or window in a browser, and a web search.
    "new_tab", "new_window", "search_web",
    "files.list", "files.read", "files.make_folder", "files.move", "files.copy", "files.rename", "files.organise", "files.rename_by_date", "files.convert",
    "files.write", "files.open", "bd.remind_me", "bd.create_todos", "bd.timer", "job.files", "job.operator",
];

/// The kinds that ask at base, and their `askKind` (phase 2's `ASK_KINDS`).
pub const ASK_KINDS: &[(&str, &str)] = &[("wifi_off", "other"), ("empty_trash", "delete"), ("files.trash", "delete"), ("bd.sends", "send")];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verdict {
    pub class: Class,
    /// The fact that decided, or "base".
    pub reason: &'static str,
    /// When the class is `ask`: what kind of thing it is (delete, send, other).
    pub ask_kind: Option<&'static str>,
}

/// `wifi` is classified as `wifi_on` or `wifi_off` by its `on`.
pub fn kind_key(kind: &str, on: bool) -> &str {
    if kind == "wifi" {
        if on {
            "wifi_on"
        } else {
            "wifi_off"
        }
    } else {
        kind
    }
}

/// One action or call (D.1): its base class, raised by each fact that applies to it. An unknown kind is `never`.
pub fn classify(kind: &str, facts: &[Fact]) -> Verdict {
    let mut v = if let Some((_, ask)) = ASK_KINDS.iter().find(|(k, _)| *k == kind) {
        Verdict { class: Class::Ask, reason: "base", ask_kind: Some(ask) }
    } else if ROUTINE_KINDS.contains(&kind) {
        Verdict { class: Class::Routine, reason: "base", ask_kind: None }
    } else {
        return Verdict { class: Class::Never, reason: "unknown", ask_kind: None };
    };
    for f in facts {
        let (raise, kinds) = f.rule();
        if kinds.contains(&kind) && raise > v.class {
            v = Verdict { class: raise, reason: f.key(), ask_kind: (raise == Class::Ask).then_some("other") };
        }
    }
    if v.class != Class::Ask {
        v.ask_kind = None;
    }
    v
}

/// A whole request (D.1): the highest class of its items; and `ask` (reason `check_every`) when that is routine and
/// "Check with me before every task" is on, except a request that only finds files (it changes nothing).
pub fn classify_request(items: &[Verdict], kinds: &[&str], check_every: bool) -> Verdict {
    let mut top = Verdict { class: Class::Routine, reason: "base", ask_kind: None };
    for v in items {
        if v.class > top.class {
            top = *v;
        }
    }
    let only_finds = !kinds.is_empty() && kinds.iter().all(|k| *k == "find_files");
    if top.class == Class::Routine && check_every && !only_finds {
        return Verdict { class: Class::Ask, reason: "check_every", ask_kind: Some("other") };
    }
    top
}

/// The Mac never downgrades the server's class (D.4).
pub fn at_least(mac: Verdict, server: Option<Class>) -> Verdict {
    match server {
        Some(Class::Ask) if mac.class == Class::Routine => Verdict { class: Class::Ask, reason: "server", ask_kind: Some("other") },
        Some(Class::Never) if mac.class != Class::Never => Verdict { class: Class::Never, reason: "server", ask_kind: None },
        _ => mac,
    }
}

/// One shared vector (D.6): the kinds (one, or a request's several), the facts, whether it is a request, and the answer.
#[cfg_attr(not(test), allow(dead_code))]
pub struct Vector {
    pub request: bool,
    pub kinds: &'static [&'static str],
    pub facts: &'static [&'static str],
    pub check_every: bool,
    pub class: Class,
    pub reason: &'static str,
    pub ask_kind: Option<&'static str>,
}

#[cfg_attr(not(test), allow(dead_code))]
const fn one(kind: &'static [&'static str], facts: &'static [&'static str], class: Class, reason: &'static str, ask_kind: Option<&'static str>) -> Vector {
    Vector { request: false, kinds: kind, facts, check_every: false, class, reason, ask_kind }
}

#[cfg_attr(not(test), allow(dead_code))]
const fn req(kinds: &'static [&'static str], check_every: bool, class: Class, reason: &'static str, ask_kind: Option<&'static str>) -> Vector {
    Vector { request: true, kinds, facts: &[], check_every, class, reason, ask_kind }
}

/// D.6, the same list as `RISK_VECTORS` in `src/lib/mac-risk.ts`.
#[cfg_attr(not(test), allow(dead_code))]
pub const VECTORS: &[Vector] = &[
    one(&["open_app"], &[], Class::Routine, "base", None),
    one(&["open_app"], &["never_look"], Class::Routine, "base", None),
    one(&["open_app"], &["installer"], Class::Never, "installer", None),
    one(&["open_app"], &["quarantined"], Class::Never, "quarantined", None),
    one(&["open_url"], &[], Class::Routine, "base", None),
    one(&["open_url"], &["bad_url"], Class::Never, "bad_url", None),
    one(&["open_file"], &["secret"], Class::Never, "secret", None),
    one(&["new_tab"], &[], Class::Routine, "base", None),
    one(&["search_web"], &["bad_url"], Class::Never, "bad_url", None),
    one(&["open_url"], &["quarantined"], Class::Never, "quarantined", None),
    one(&["switch_app"], &["never_look"], Class::Routine, "base", None),
    one(&["quit_app"], &["never_look"], Class::Routine, "base", None),
    one(&["quit_app"], &["own"], Class::Never, "own", None),
    one(&["quit_app"], &["finder"], Class::Never, "finder", None),
    one(&["type_text"], &[], Class::Routine, "base", None),
    one(&["type_text"], &["secure_field"], Class::Never, "secure_field", None),
    one(&["type_text"], &["never_look"], Class::Never, "never_look", None),
    one(&["copy_selection"], &["never_look"], Class::Never, "never_look", None),
    one(&["screenshot"], &[], Class::Routine, "base", None),
    one(&["wifi_on"], &[], Class::Routine, "base", None),
    one(&["wifi_off"], &[], Class::Ask, "base", Some("other")),
    one(&["empty_trash"], &[], Class::Ask, "base", Some("delete")),
    one(&["files.move"], &[], Class::Routine, "base", None),
    one(&["files.move"], &["outside_allowed"], Class::Never, "outside_allowed", None),
    one(&["files.move"], &["recently_changed"], Class::Never, "recently_changed", None),
    one(&["files.move"], &["cross_volume"], Class::Never, "cross_volume", None),
    one(&["files.trash"], &[], Class::Ask, "base", Some("delete")),
    one(&["files.read"], &["secret"], Class::Never, "secret", None),
    one(&["files.convert"], &["secret"], Class::Never, "secret", None),
    one(&["bd.remind_me"], &[], Class::Routine, "base", None),
    one(&["bd.create_todos"], &["others_todo"], Class::Ask, "others_todo", Some("other")),
    one(&["bd.sends"], &[], Class::Ask, "base", Some("send")),
    req(&["open_app"], true, Class::Ask, "check_every", Some("other")),
    req(&["open_app", "empty_trash"], false, Class::Ask, "base", Some("delete")),
    req(&["files.trash"], true, Class::Ask, "base", Some("delete")),
    req(&["find_files"], true, Class::Routine, "base", None),
    req(&["job.files"], true, Class::Ask, "check_every", Some("other")),
    // A step of a job the person already said yes to: `classify`, so "Check with me" never re-asks.
    Vector { request: false, kinds: &["files.move"], facts: &["check_every"], check_every: true, class: Class::Routine, reason: "base", ask_kind: None },
];

/// Runs one vector through the classifier.
#[cfg_attr(not(test), allow(dead_code))]
pub fn run_vector(v: &Vector) -> Verdict {
    let facts: Vec<Fact> = v.facts.iter().filter_map(|f| Fact::of(f)).collect();
    if v.request {
        let items: Vec<Verdict> = v.kinds.iter().map(|k| classify(k, &facts)).collect();
        classify_request(&items, v.kinds, v.check_every)
    } else {
        classify(v.kinds[0], &facts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vectors() {
        for v in VECTORS {
            let got = run_vector(v);
            assert_eq!((got.class, got.reason, got.ask_kind), (v.class, v.reason, v.ask_kind), "{:?} {:?} check_every={}", v.kinds, v.facts, v.check_every);
        }
        assert_eq!(VECTORS.len(), 38, "the same rows as RISK_VECTORS");
    }

    #[test]
    fn facts_only_raise_and_unknown_kinds_never_run() {
        assert_eq!(classify("open_app", &[Fact::OthersTodo]).class, Class::Routine, "a fact that doesn't apply changes nothing");
        assert_eq!(classify("empty_trash", &[Fact::NeverLook]).class, Class::Ask, "never lowers");
        assert_eq!(classify("format_disk", &[]).class, Class::Never);
        assert_eq!(classify(kind_key("wifi", false), &[]).class, Class::Ask);
        assert_eq!(classify(kind_key("wifi", true), &[]).class, Class::Routine);
        for f in Fact::ALL {
            assert_eq!(Fact::of(f.key()), Some(f));
        }
    }

    #[test]
    fn the_mac_never_downgrades_the_server() {
        let routine = classify("open_app", &[]);
        assert_eq!(at_least(routine, Some(Class::Ask)).class, Class::Ask);
        assert_eq!(at_least(routine, Some(Class::Never)).class, Class::Never);
        let never = classify("quit_app", &[Fact::Own]);
        assert_eq!(at_least(never, Some(Class::Routine)).class, Class::Never);
    }
}
