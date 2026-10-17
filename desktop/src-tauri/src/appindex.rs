//! The app index (owner brief, 12 October 2026: "Common commands are recognised ON THE MAC with no AI call ('open
//! Figma' …)"; helpers-spec B.2).
//!
//! The `.app` bundles directly in the app folders (`guard::app_folders`: `/Applications`, its Utilities,
//! `/System/Applications`, its Utilities, `~/Applications`, and Finder from CoreServices), plus the running ordinary
//! apps, built on a background thread at start, again every 10 minutes, and at most once every 30 s when a name misses.
//! It answers "which app did they mean" (`resolve`: exact, the alias table, a running app's own name, then one letter
//! off), and feeds whisper the app names so they are heard right (`whisper_prompt`). It only reads folder listings and
//! AppKit's list of running apps; opening goes through `open::resolve_app_v2`'s checks at the moment it happens.

use std::{
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::macos::RunningApp;

pub const REBUILD_EVERY: Duration = Duration::from_secs(600);
pub const MISS_REBUILD_GAP: Duration = Duration::from_secs(30);
/// The app names in whisper's prompt stop at this many characters (B.2).
pub const PROMPT_NAMES_MAX: usize = 600;

/// One app the person could name.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    /// Its own name (the bundle's stem, or the running app's localised name).
    pub name: String,
    /// Lower-case letters and digits only.
    pub key: String,
    pub path: Option<PathBuf>,
    /// "Applications", "Utilities", "System Applications", "your Applications", or "running".
    pub where_: &'static str,
    /// Its process, when it is running now.
    pub pid: Option<i32>,
    pub bundle_id: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Index {
    pub entries: Vec<Entry>,
}

/// A name as a key: lower-case letters and digits only ("Visual Studio Code" → "visualstudiocode").
pub fn key_of(name: &str) -> String {
    name.chars().flat_map(char::to_lowercase).filter(|c| c.is_alphanumeric()).collect()
}

fn stem(p: &Path) -> String {
    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
}

/// The index from the app folders (in order) and the running apps.
pub fn build(folders: &[(PathBuf, &'static str)], running: &[RunningApp]) -> Index {
    let mut entries: Vec<Entry> = Vec::new();
    for (dir, words) in folders {
        let core = dir.ends_with("CoreServices");
        let Ok(rd) = std::fs::read_dir(dir) else { continue };
        let mut apps: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("app"))).collect();
        apps.sort();
        for p in apps {
            if core && p != Path::new(crate::guard::FINDER_APP) {
                continue;
            }
            let name = stem(&p);
            let key = key_of(&name);
            if key.is_empty() || entries.iter().any(|e| e.path.as_deref() == Some(p.as_path())) {
                continue;
            }
            entries.push(Entry { name, key, path: Some(p), where_: words, pid: None, bundle_id: None });
        }
    }
    for r in running.iter().filter(|r| r.regular) {
        let by_path = r.path.as_ref().and_then(|p| entries.iter_mut().find(|e| e.path.as_ref() == Some(p)));
        match by_path {
            Some(e) => {
                e.pid = Some(r.pid);
                e.bundle_id = r.bundle_id.clone();
            }
            None => {
                let key = key_of(&r.name);
                if key.is_empty() {
                    continue;
                }
                entries.push(Entry { name: r.name.clone(), key, path: r.path.clone(), where_: "running", pid: Some(r.pid), bundle_id: r.bundle_id.clone() });
            }
        }
    }
    Index { entries }
}

/// The edit distance between two keys (Levenshtein, characters).
pub fn distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            cur[j + 1] = (prev[j + 1] + 1).min(cur[j] + 1).min(prev[j] + usize::from(ca != cb));
        }
        prev = cur;
    }
    prev[b.len()]
}

/// A name as people say it: a trailing "app"/"application" and a leading "the"/"my" dropped.
pub fn clean_said(said: &str) -> String {
    let mut words: Vec<&str> = said.split_whitespace().collect();
    while words.len() > 1 && matches!(words.last().map(|w| w.to_lowercase()).as_deref(), Some("app" | "application")) {
        words.pop();
    }
    while words.len() > 1 && matches!(words.first().map(|w| w.to_lowercase()).as_deref(), Some("the" | "my")) {
        words.remove(0);
    }
    words.join(" ")
}

impl Index {
    /// Which app a name means (B.2): exact key, then `APP_ALIASES`, then a running app's localised name, then the one
    /// entry within one letter (keys of 5 or more characters) or two (9 or more). Ambiguous or nothing: None. Running
    /// apps win a tie between entries with the same key.
    pub fn resolve(&self, said: &str) -> Option<&Entry> {
        let said = clean_said(said);
        let k = key_of(&said);
        if k.is_empty() {
            return None;
        }
        let exact = |k: &str| -> Option<&Entry> {
            let mut found: Vec<&Entry> = self.entries.iter().filter(|e| e.key == k).collect();
            found.sort_by_key(|e| e.pid.is_none());
            found.into_iter().next()
        };
        if let Some(e) = exact(&k) {
            return Some(e);
        }
        if let Some((_, target)) = crate::open::APP_ALIASES.iter().find(|(a, _)| key_of(a) == k) {
            if let Some(e) = exact(&key_of(target)) {
                return Some(e);
            }
        }
        let limit = if k.chars().count() >= 9 {
            2
        } else if k.chars().count() >= 5 {
            1
        } else {
            return None;
        };
        let mut near: Vec<&Entry> = self.entries.iter().filter(|e| distance(&e.key, &k) <= limit).collect();
        near.sort_by_key(|e| e.pid.is_none());
        let mut keys: Vec<&str> = near.iter().map(|e| e.key.as_str()).collect();
        keys.dedup();
        if keys.len() == 1 {
            near.into_iter().next()
        } else {
            None
        }
    }

    /// Every app's own name, once each.
    pub fn names(&self) -> Vec<String> {
        let mut seen = std::collections::HashSet::new();
        self.entries.iter().filter(|e| seen.insert(e.key.clone())).map(|e| e.name.clone()).collect()
    }
}

/// Whisper's prompt (B.2, K.1): her names, then running apps' names and the index's, until 600 characters, then the
/// words the front desk needs heard right.
pub fn whisper_prompt(assistant: &str, running: &[String], names: &[String]) -> String {
    let mut out = String::new();
    let a = assistant.trim();
    if !a.is_empty() && !a.eq_ignore_ascii_case("brenda") {
        out.push_str(a);
        out.push_str(", ");
    }
    out.push_str("Brenda, Boredroom, ");
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    for n in running.iter().chain(names.iter()) {
        let n = n.trim();
        if n.is_empty() || n.contains(['\n', '\r']) || !seen.insert(key_of(n)) {
            continue;
        }
        if out.chars().count() + n.chars().count() + 2 > PROMPT_NAMES_MAX {
            break;
        }
        out.push_str(n);
        out.push_str(", ");
    }
    // "error" (review, 16 October 2026: "What does this error mean?" was heard as "What does this airamine?").
    out.push_str("to-do, timer, Desktop, Documents, Downloads, screenshot, volume, Wi-Fi, Trash, error.");
    out
}

// ---- the index on this Mac --------------------------------------------------------------------------------------------

#[derive(Default)]
pub struct AppIndex {
    current: Mutex<Option<(Index, Instant)>>,
    last_miss: Mutex<Option<Instant>>,
}

fn rebuild(app: &tauri::AppHandle) -> Index {
    use tauri::Manager;
    let home = crate::filework::home();
    let index = build(&crate::guard::app_folders(home.as_deref()), &crate::macos::running_apps(app));
    if let Some(s) = app.try_state::<AppIndex>() {
        *s.current.lock().unwrap() = Some((index.clone(), Instant::now()));
    }
    index
}

/// Builds the index now and every 10 minutes, on its own thread.
pub fn start(app: &tauri::AppHandle) {
    let app = app.clone();
    let _ = std::thread::Builder::new().name("brenda-apps".into()).spawn(move || loop {
        rebuild(&app);
        std::thread::sleep(REBUILD_EVERY);
    });
}

/// The index as it is now (empty before the first build).
pub fn current(app: &tauri::AppHandle) -> Index {
    use tauri::Manager;
    app.try_state::<AppIndex>().and_then(|s| s.current.lock().unwrap().as_ref().map(|(i, _)| i.clone())).unwrap_or_default()
}

/// Resolves a name; on a miss, rebuilds (at most once every 30 s) and tries again. Never call on the main thread.
pub fn resolve(app: &tauri::AppHandle, said: &str) -> Option<Entry> {
    use tauri::Manager;
    if let Some(e) = current(app).resolve(said).cloned() {
        return Some(e);
    }
    let state = app.try_state::<AppIndex>()?;
    {
        let mut last = state.last_miss.lock().unwrap();
        if last.is_some_and(|t| t.elapsed() < MISS_REBUILD_GAP) {
            return None;
        }
        *last = Some(Instant::now());
    }
    rebuild(app).resolve(said).cloned()
}

/// Whisper's prompt from the index as it is now.
pub fn whisper_prompt_now(app: &tauri::AppHandle) -> String {
    let index = current(app);
    let running: Vec<String> = index.entries.iter().filter(|e| e.pid.is_some()).map(|e| e.name.clone()).collect();
    whisper_prompt(&crate::companion::name(app), &running, &index.names())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// B.2's fixture: a temp folder of empty bundles and a fake running list.
    pub fn fixture() -> (PathBuf, Index) {
        let dir = std::env::temp_dir().join(format!("brenda-apps-{}-{}", std::process::id(), crate::act::sha256_hex(&format!("{:?}", Instant::now()))[..8].to_string()));
        let _ = std::fs::remove_dir_all(&dir);
        for n in ["Figma", "Slack", "Spotify", "Safari", "Google Chrome", "Visual Studio Code", "Notes", "Calculator", "Microsoft Word"] {
            std::fs::create_dir_all(dir.join(format!("{n}.app/Contents"))).unwrap();
        }
        let running = vec![
            RunningApp { pid: 21, name: "Slack".into(), bundle_id: Some("com.tinyspeck.slackmacgap".into()), path: Some(dir.join("Slack.app")), regular: true, hidden: false },
            RunningApp { pid: 22, name: "Zoom Workplace".into(), bundle_id: Some("us.zoom.xos".into()), path: Some(PathBuf::from("/Applications/zoom.us.app")), regular: true, hidden: false },
            RunningApp { pid: 23, name: "Helper".into(), bundle_id: None, path: None, regular: false, hidden: false },
        ];
        let index = build(&[(dir.clone(), "Applications")], &running);
        (dir, index)
    }

    #[test]
    fn resolves_exact_alias_running_fuzzy() {
        let (dir, ix) = fixture();
        let name = |s: &str| ix.resolve(s).map(|e| e.name.clone());
        assert_eq!(name("Figma").as_deref(), Some("Figma"));
        assert_eq!(name("figma app").as_deref(), Some("Figma"));
        assert_eq!(name("the Slack application").as_deref(), Some("Slack"));
        assert_eq!(ix.resolve("slack").unwrap().pid, Some(21), "running");
        assert_eq!(name("vs code").as_deref(), Some("Visual Studio Code"), "the alias table");
        assert_eq!(name("chrome").as_deref(), Some("Google Chrome"));
        assert_eq!(name("word").as_deref(), Some("Microsoft Word"));
        assert_eq!(name("Zoom Workplace").as_deref(), Some("Zoom Workplace"), "a running app's own name");
        assert_eq!(name("Sigma").as_deref(), Some("Figma"), "one letter off, five letters");
        assert_eq!(name("Spotfy").as_deref(), Some("Spotify"));
        assert_eq!(name("Calculater").as_deref(), Some("Calculator"));
        assert_eq!(name("Helper"), None, "not an ordinary app");
        assert_eq!(name("Nots"), None, "too short to guess");
        assert_eq!(name("Photoshop"), None);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn ambiguous_fuzzy_is_none() {
        let mk = |n: &str| Entry { name: n.into(), key: key_of(n), path: None, where_: "Applications", pid: None, bundle_id: None };
        let ix = Index { entries: vec![mk("Notion"), mk("Motion"), mk("Lotion")] };
        assert_eq!(ix.resolve("Potion"), None, "three apps one letter off");
        assert_eq!(ix.resolve("Notion").unwrap().name, "Notion", "exact still wins");
        assert_eq!(distance("figma", "sigma"), 1);
        assert_eq!(distance("", "abc"), 3);
    }

    #[test]
    fn prompt_capped() {
        let names: Vec<String> = (0..200).map(|i| format!("App Number {i}")).collect();
        let p = whisper_prompt("Max", &["Figma".into(), "Slack".into()], &names);
        assert!(p.starts_with("Max, Brenda, Boredroom, Figma, Slack, App Number 0, "));
        assert!(p.ends_with("to-do, timer, Desktop, Documents, Downloads, screenshot, volume, Wi-Fi, Trash, error."));
        assert!(p.chars().count() <= PROMPT_NAMES_MAX + 90);
        let p = whisper_prompt("Brenda", &["Figma".into()], &["Figma".into()]);
        assert_eq!(p, "Brenda, Boredroom, Figma, to-do, timer, Desktop, Documents, Downloads, screenshot, volume, Wi-Fi, Trash, error.");
    }
}
