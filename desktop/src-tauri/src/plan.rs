//! Plans: broad asks, one sentence, one yes (owner report, 12 October 2026: "Brenda is meant to assist you do anything
//! you need it to do"; companion2-spec D, I.4), under the owner's permission rule, unchanged: "Brenda cannot take any
//! action except I explicitly give an instruction … Brenda should confirm, oh, do you want me to do this? And then I'll
//! say, yes".
//!
//! What this file promises, and how:
//! - A plan arrives only as a `propose` line of a look the person started (`look.rs` → `act::asking` → `receive`).
//!   Nothing else builds one: no timer, event or server message.
//! - Before asking, Brenda for Mac finds what the plan will touch, locally and read-only (`scope`: the app, the file
//!   found by words, the files in the one folder named or pointed at), in at most three seconds, and tells Boredroom
//!   counts, kinds and names of the chosen app, file or folder, never paths and never the folder's file names. Boredroom
//!   writes the lines under the sentence; the person is asked only once those came back, and only when the plan's
//!   SHA-256 over the sentence AND the lines (`plan_hash`) matches (`view_ok_v2`).
//! - One yes covers the whole plan. Steps then run in order (`run_steps`); Stop is checked before every step, every open,
//!   every file and every change; a Boredroom change that reaches anyone else asks again ("Next I'll go ahead with …")
//!   and runs only with that step's own yes; computer use keeps its own asks. The first failure ends the plan; what was
//!   done before it stays done.
//! - Opening goes through the `Opener` only, re-checked right before it (`open_step`); `WorkspaceOpener` is built here
//!   and nowhere else (`run_open`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use crate::act::{self, ActEvent, OutputRef, OutputShown, Phase, StepAsk};
use crate::filework::{self, Candidate, Kind, Source};
use crate::folder::{self, FindKind, Found, Kinds, NamedFolder, WalkOpts};
use crate::guard;
use crate::look::{AppId, Rule};
use crate::open::{self, AppFound, Opener, Why};
use crate::ApiError;

pub const MAX_STEPS: usize = 6;
pub const MAX_OPENS: usize = 3;
pub const MAX_CHANGES: usize = 4;
pub const MAX_LINES: usize = 8;
pub const LINE_CHARS: usize = 200;
pub const MAX_WORDS: usize = 6;
pub const WORD_CHARS: usize = 40;
pub const SINCE_DAYS_MAX: u32 = 3_650;
/// Everything scope looks up, at most (companion2-spec D.3).
pub const SCOPE_TIME: Duration = Duration::from_secs(3);
pub const SCOPE_BODY_MAX: usize = 64_000;
/// After an app opens, the next step waits up to this long for it to come to the front.
pub const FRONT_WAIT: Duration = Duration::from_secs(5);
/// A plan's wall clock from the yes: 10 minutes, 15 with a folder or file job (D.5).
pub const PLAN_MINUTES: u64 = 10;
pub const PLAN_MINUTES_FILES: u64 = 15;

// ---- the plan as Boredroom describes it (H.2.1) -----------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OpenTarget {
    App,
    Url,
    Folder,
    File,
    Recent,
    Reveal,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderRef {
    pub source: String,
    #[serde(default)]
    pub name: String,
}

impl FolderRef {
    pub fn none(&self) -> bool {
        self.source == "none"
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", rename_all_fields = "camelCase")]
pub enum StepView {
    Open {
        i: u32,
        target: OpenTarget,
        #[serde(default)]
        name: String,
        #[serde(default)]
        url: String,
        folder: FolderRef,
        #[serde(default)]
        words: Vec<String>,
        #[serde(default)]
        kinds: Vec<FindKind>,
        #[serde(default)]
        since_days: u32,
    },
    Folder {
        i: u32,
        folder: FolderRef,
        #[serde(default)]
        kinds: Vec<FindKind>,
        #[serde(default)]
        recursive: bool,
        #[serde(default)]
        since_days: u32,
        #[serde(default)]
        words: Vec<String>,
        per_file: bool,
        job: String,
        output: OutputRef,
    },
    File {
        i: u32,
        file: act::FileRef,
        output: OutputRef,
    },
    Screen {
        i: u32,
        goal: String,
    },
    Boredroom {
        i: u32,
        summary: String,
        #[serde(default)]
        outward: bool,
    },
}

impl StepView {
    pub fn i(&self) -> u32 {
        match self {
            StepView::Open { i, .. } | StepView::Folder { i, .. } | StepView::File { i, .. } | StepView::Screen { i, .. } | StepView::Boredroom { i, .. } => *i,
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            StepView::Open { .. } => "open",
            StepView::Folder { .. } => "folder",
            StepView::File { .. } => "file",
            StepView::Screen { .. } => "screen",
            StepView::Boredroom { .. } => "boredroom",
        }
    }

    /// Whether Brenda for Mac looks it up before asking (B.1: everything opened but a web page, and a folder job).
    pub fn needs_scope(&self) -> bool {
        match self {
            StepView::Open { target, .. } => *target != OpenTarget::Url,
            StepView::Folder { .. } => true,
            _ => false,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskViewV2 {
    pub id: String,
    pub kind: String,
    pub v: u32,
    pub plan: String,
    pub question: String,
    #[serde(default)]
    pub plan_sha256: String,
    #[serde(default)]
    pub answer_by: Option<String>,
    #[serde(default)]
    pub risky: bool,
    #[serde(default)]
    pub step_cap: Option<u32>,
    #[serde(default)]
    pub needs_scope: bool,
    #[serde(default)]
    pub lines: Option<Vec<String>>,
    pub steps: Vec<StepView>,
}

impl TaskViewV2 {
    /// The phase 2 view the task state machine holds (its hash is the plan's: the sentence's own until scope, then over
    /// the sentence and the lines).
    pub fn brief(&self) -> act::TaskView {
        act::TaskView {
            id: self.id.clone(),
            kind: "plan".into(),
            plan: self.plan.clone(),
            question: self.question.clone(),
            plan_sha256: if self.needs_scope { act::sha256_hex(&self.plan) } else { self.plan_sha256.to_ascii_lowercase() },
            answer_by: self.answer_by.clone(),
            risky: self.risky,
            step_cap: self.step_cap,
            file: None,
            output: None,
        }
    }

    pub fn minutes(&self) -> u64 {
        if self.steps.iter().any(|s| matches!(s, StepView::Folder { .. } | StepView::File { .. })) {
            PLAN_MINUTES_FILES
        } else {
            PLAN_MINUTES
        }
    }
}

/// What the person says yes to (companion2-spec D.4): the SHA-256 of the sentence and each line after a line break.
pub fn plan_hash(plan: &str, lines: &[String]) -> String {
    let mut s = plan.to_string();
    for l in lines {
        s.push('\n');
        s.push_str(l);
    }
    act::sha256_hex(&s)
}

fn one_line(s: &str) -> bool {
    !s.chars().any(|c| c == '\n' || c == '\r' || c == '\u{2028}' || c == '\u{2029}')
}

fn words_ok(words: &[String]) -> bool {
    words.len() <= MAX_WORDS && words.iter().all(|w| (1..=WORD_CHARS).contains(&w.chars().count()) && w.chars().all(|c| c.is_alphanumeric() || " ._-".contains(c)))
}

fn folder_ref_ok(f: &FolderRef, allow_none: bool) -> bool {
    match f.source.as_str() {
        "named" => NamedFolder::of(&f.name).is_some(),
        "front_folder" | "finder_selection" => (1..=255).contains(&f.name.chars().count()) && one_line(&f.name) && !f.name.contains('/'),
        "none" => allow_none,
        _ => false,
    }
}

fn output_ok(o: &OutputRef) -> bool {
    match o.format {
        filework::Format::Doc => (1..=255).contains(&o.name.chars().count()) && one_line(&o.name),
        f => filework::output_name_ok(&o.name, f),
    }
}

fn step_ok(s: &StepView) -> bool {
    match s {
        StepView::Open { target, name, url, folder, words, since_days, .. } => {
            *since_days <= SINCE_DAYS_MAX
                && words_ok(words)
                && match target {
                    OpenTarget::App => open::app_name_ok(name),
                    OpenTarget::Url => open::url_ok(url),
                    OpenTarget::Folder => folder_ref_ok(folder, false),
                    OpenTarget::File | OpenTarget::Recent | OpenTarget::Reveal => folder_ref_ok(folder, true) && (!words.is_empty() || (!name.is_empty() && name.chars().count() <= 255 && one_line(name))),
                }
        }
        StepView::Folder { folder, since_days, words, job, per_file, output, .. } => {
            folder_ref_ok(folder, false) && *since_days <= SINCE_DAYS_MAX && words_ok(words) && (3..=120).contains(&job.chars().count()) && one_line(job) && output_ok(output) && (output.format != filework::Format::Csv || !per_file)
        }
        StepView::File { file, output, .. } => file.source != Source::FrontFolder && (1..=255).contains(&file.name.chars().count()) && output_ok(output),
        StepView::Screen { goal, .. } => (8..=200).contains(&goal.chars().count()) && one_line(goal),
        StepView::Boredroom { summary, .. } => (1..=LINE_CHARS).contains(&summary.chars().count()) && one_line(summary),
    }
}

/// A plan fit to show (companion2-spec I.4.2): an id; one to six steps, each `i` its place, known kinds and targets,
/// at most three opens, one screen part, one folder or file job and four Boredroom changes; folders, words and kinds
/// within limits; the sentence one line of 12–200 characters starting "I'll "; and once looked up, its lines and the
/// hash over the sentence and the lines.
pub fn view_ok_v2(t: &TaskViewV2) -> bool {
    let n = t.plan.chars().count();
    if !(act::id_ok(&t.id) && t.kind == "plan" && t.v == 2 && (12..=200).contains(&n) && t.plan.starts_with("I'll ") && one_line(&t.plan)) {
        return false;
    }
    if t.steps.is_empty() || t.steps.len() > MAX_STEPS {
        return false;
    }
    let count = |k: &str| t.steps.iter().filter(|s| s.kind() == k).count();
    if count("open") > MAX_OPENS || count("screen") > 1 || count("folder") + count("file") > 1 || count("boredroom") > MAX_CHANGES {
        return false;
    }
    if !t.steps.iter().enumerate().all(|(k, s)| s.i() as usize == k && step_ok(s)) {
        return false;
    }
    if t.needs_scope {
        return t.lines.is_none();
    }
    let Some(lines) = t.lines.as_ref() else { return false };
    // A page's line names the whole address it opens, so the yes covers it (review, 12 October 2026).
    let pages_named = t.steps.iter().all(|s| match s {
        StepView::Open { target: OpenTarget::Url, url, i, .. } => open::url_shown(url).is_some_and(|w| lines.get(*i as usize).is_some_and(|l| *l == format!("Open {w} in your browser"))),
        _ => true,
    });
    pages_named && lines.len() <= MAX_LINES && lines.iter().all(|l| (1..=LINE_CHARS).contains(&l.chars().count()) && one_line(l)) && t.plan_sha256.eq_ignore_ascii_case(&plan_hash(&t.plan, lines))
}

/// The plan Boredroom sent back after scope is the one that was looked up: the same id, sentence and steps (a recent
/// document's default of seven days may be filled in by Boredroom; nothing else may change).
pub fn same_plan(before: &TaskViewV2, after: &TaskViewV2) -> bool {
    let key = |t: &TaskViewV2| -> Vec<StepView> {
        t.steps
            .iter()
            .cloned()
            .map(|mut s| {
                if let StepView::Open { target: OpenTarget::Recent, since_days, .. } = &mut s {
                    if *since_days == 7 {
                        *since_days = 0;
                    }
                }
                s
            })
            .collect()
    };
    before.id == after.id && before.plan == after.plan && key(before) == key(after)
}

/// What a plan needs switched on (companion2-spec D.2.2 `needsOf`), and the first gap in the order "Do things",
/// "Work on my files", Accessibility: the refusal reason the notch shows (`use_mac_off`, `files_off`, `accessibility`).
pub fn ability_gap(t: &TaskViewV2, use_mac: bool, file_work: bool, can_click: bool) -> Option<&'static str> {
    let (mut mac, mut files, mut ax) = (false, false, false);
    for s in &t.steps {
        match s {
            StepView::Open { target, words, .. } => {
                mac = true;
                files |= !words.is_empty() || *target == OpenTarget::Recent;
            }
            StepView::Folder { .. } | StepView::File { .. } => files = true,
            StepView::Screen { .. } => {
                mac = true;
                ax = true;
            }
            StepView::Boredroom { .. } => {}
        }
    }
    if mac && !use_mac {
        Some("use_mac_off")
    } else if files && !file_work {
        Some("files_off")
    } else if ax && !can_click {
        Some("accessibility")
    } else {
        None
    }
}

// ---- scope (D.3) ------------------------------------------------------------------------------------------------------

/// What Brenda for Mac found for one step (paths stay here).
#[derive(Clone, Debug, PartialEq)]
pub enum Resolved {
    Nothing,
    App(AppFound),
    Url(String),
    Folder { path: PathBuf, words: String },
    File { path: PathBuf, name: String },
    Files { root: PathBuf, words: String, files: Vec<Found> },
    FileJob(Candidate),
}

/// The context scope reads: the home folder, the rules, what the look saw, and the Mac's searches.
pub struct ScopeCtx<'a> {
    pub home: PathBuf,
    pub rules: &'a [Rule],
    pub candidates: &'a [Candidate],
    pub fs: &'a dyn folder::Fs,
    pub search: &'a dyn open::AppSearch,
    pub last_used: &'a dyn folder::LastUsed,
    pub probe: &'a dyn guard::OpenProbe,
    pub bundle: &'a dyn Fn(&Path) -> Option<String>,
    pub app_folders: Vec<(PathBuf, &'static str)>,
    pub now_unix: i64,
    pub deadline: Instant,
}

/// One step's line in the scope body (H.2.2).
fn found(i: u32, f: Value) -> Value {
    json!({ "i": i, "found": f })
}

fn not_found(i: u32, why: Why) -> Value {
    json!({ "i": i, "found": null, "why": why.key() })
}

fn kind_key(path: &Path) -> &'static str {
    folder::find_kind_of(path).map(FindKind::key).unwrap_or("other")
}

/// A folder reference as a path: a named folder under the home folder, or one the look saw (exactly by source and
/// name), if it may be listed.
fn folder_path(f: &FolderRef, cx: &ScopeCtx) -> Result<PathBuf, Why> {
    let never = folder::never_names(cx.rules);
    match f.source.as_str() {
        "named" => {
            let nf = NamedFolder::of(&f.name).ok_or(Why::Gone)?;
            let p = nf.dir(&cx.home);
            folder::folder_ok(&p, &cx.home, &never).then_some(p).ok_or(Why::Forbidden)
        }
        "front_folder" | "finder_selection" => {
            let source = if f.source == "front_folder" { Source::FrontFolder } else { Source::FinderSelection };
            let c = cx.candidates.iter().find(|c| c.kind == Kind::Folder && c.source == source && c.name == f.name).ok_or(Why::Gone)?;
            folder::folder_ok(&c.path, &cx.home, &never).then(|| c.path.clone()).ok_or(Why::Forbidden)
        }
        _ => Err(Why::Gone),
    }
}

/// A folder that is there and readable: found; refused by macOS: denied; missing: gone.
fn folder_readable(p: &Path, cx: &ScopeCtx) -> Result<(), Why> {
    match cx.fs.read_dir(p) {
        Ok(_) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(1) => Err(Why::Denied),
        Err(_) => Err(Why::Gone),
    }
}

fn walk_opts(cx: &ScopeCtx, kinds: Kinds, depth: u32, since_days: u32, words: &[String]) -> WalkOpts {
    WalkOpts {
        kinds,
        depth,
        since_days,
        words: words.to_vec(),
        never: folder::never_names(cx.rules),
        now_unix: cx.now_unix,
        deadline: cx.deadline.min(Instant::now() + folder::WALK_TIME),
    }
}

/// A file the look saw, named exactly (any source, a file not a folder), checked against the rules.
fn candidate_file(name: &str, cx: &ScopeCtx) -> Option<Result<PathBuf, Why>> {
    let c = cx.candidates.iter().find(|c| c.kind != Kind::Folder && c.name == name)?;
    if guard::secret_file(&c.path) {
        return Some(Err(Why::Forbidden));
    }
    if let Some(n) = guard::never_open(&c.path, cx.probe) {
        return Some(Err(Why::of_never(n)));
    }
    if handler_forbidden(&c.path, cx.probe, cx.rules) {
        return Some(Err(Why::Forbidden));
    }
    Some(Ok(c.path.clone()))
}

/// Whether the app that would open this file is one Brenda never works in (review, 12 October 2026: a certificate opens
/// Keychain Access, a workflow Alfred, a disk image DiskImageMounter). Scope asks only when macOS names an app; the
/// open itself also refuses a file no app is known for.
fn handler_forbidden(p: &Path, probe: &dyn guard::OpenProbe, rules: &[Rule]) -> bool {
    probe.handler(p).is_some_and(|h| guard::handler_refused(&h, rules).is_some())
}

/// Looks one step up (B.1, C.1, I.4.3, I.4.4). Returns what was found and its line in the scope body.
pub fn scope_step(s: &StepView, cx: &ScopeCtx) -> (Resolved, Option<Value>) {
    let i = s.i();
    if Instant::now() >= cx.deadline && s.needs_scope() {
        return (Resolved::Nothing, Some(not_found(i, Why::Timeout)));
    }
    match s {
        StepView::Open { target: OpenTarget::App, name, .. } => match open::resolve_app(name, &cx.app_folders, cx.search, cx.probe, cx.bundle, cx.rules) {
            Ok(a) => {
                let line = found(i, json!({ "type": "app", "name": folder::clip_name(&a.name, open::APP_NAME_MAX), "bundleId": a.bundle_id, "where": a.where_ }));
                (Resolved::App(a), Some(line))
            }
            Err(w) => (Resolved::Nothing, Some(not_found(i, w))),
        },
        StepView::Open { target: OpenTarget::Url, url, .. } => {
            if open::url_ok(url) {
                (Resolved::Url(url.trim().to_string()), None)
            } else {
                (Resolved::Nothing, None)
            }
        }
        StepView::Open { target: OpenTarget::Folder, folder: f, .. } => match folder_path(f, cx).and_then(|p| folder_readable(&p, cx).map(|_| p)) {
            Ok(p) => {
                let words = folder::folder_words(&p, &cx.home);
                (Resolved::Folder { path: p, words: words.clone() }, Some(found(i, json!({ "type": "folder", "name": words }))))
            }
            Err(w) => (Resolved::Nothing, Some(not_found(i, w))),
        },
        StepView::Open { target, name, folder: f, words, kinds, since_days, .. } => {
            // A file the person named or pointed at, else a search by words.
            if !name.is_empty() {
                if let Some(r) = candidate_file(name, cx) {
                    return match r {
                        Ok(p) => file_found(i, p, None, 0, cx),
                        Err(w) => (Resolved::Nothing, Some(not_found(i, w))),
                    };
                }
            }
            if words.is_empty() {
                return (Resolved::Nothing, Some(not_found(i, Why::None)));
            }
            let roots: Vec<PathBuf> = if f.none() {
                [NamedFolder::Desktop, NamedFolder::Documents, NamedFolder::Downloads].iter().map(|n| n.dir(&cx.home)).collect()
            } else {
                match folder_path(f, cx) {
                    Ok(p) => vec![p],
                    Err(w) => return (Resolved::Nothing, Some(not_found(i, w))),
                }
            };
            let recent = *target == OpenTarget::Recent;
            let since = if recent && *since_days == 0 { 7 } else { *since_days };
            let kinds = if kinds.is_empty() { Kinds::AnyFile } else { Kinds::of(kinds) };
            let o = walk_opts(cx, kinds, folder::MAX_DEPTH, since, words);
            match folder::search(cx.fs, &roots, &o, recent, cx.last_used) {
                (Some(p), _) => file_found(i, p.file.path, p.last_used, p.others, cx),
                (None, true) => (Resolved::Nothing, Some(not_found(i, Why::Denied))),
                (None, false) if Instant::now() >= cx.deadline => (Resolved::Nothing, Some(not_found(i, Why::Timeout))),
                (None, false) => (Resolved::Nothing, Some(not_found(i, Why::None))),
            }
        }
        StepView::Folder { folder: f, kinds, recursive, since_days, words, .. } => {
            let root = match folder_path(f, cx) {
                Ok(p) => p,
                Err(w) => return (Resolved::Nothing, Some(not_found(i, w))),
            };
            let o = walk_opts(cx, Kinds::of(kinds), if *recursive { folder::MAX_DEPTH } else { 1 }, *since_days, words);
            let w = folder::walk(cx.fs, &root, &o);
            if w.denied {
                return (Resolved::Nothing, Some(not_found(i, Why::Denied)));
            }
            if w.missing {
                return (Resolved::Nothing, Some(not_found(i, Why::Gone)));
            }
            if w.kept.is_empty() {
                return (Resolved::Nothing, Some(not_found(i, if w.timed_out { Why::Timeout } else { Why::None })));
            }
            let words = folder::folder_words(&root, &cx.home);
            let kinds: serde_json::Map<String, Value> = w.counts.iter().map(|(k, n)| (k.key().to_string(), json!(n))).collect();
            let line = found(i, json!({ "type": "files", "folder": words, "count": w.kept.len(), "total": w.total.max(w.kept.len()), "kinds": kinds, "bytes": w.bytes, "nameHashes": w.name_hashes() }));
            (Resolved::Files { root, words, files: w.kept }, Some(line))
        }
        StepView::File { file, .. } => match filework::sources_match(cx.candidates, file.source, &file.name) {
            Some(c) if c.kind != Kind::Folder => (Resolved::FileJob(c.clone()), None),
            _ => (Resolved::Nothing, None),
        },
        StepView::Screen { .. } | StepView::Boredroom { .. } => (Resolved::Nothing, None),
    }
}

fn file_found(i: u32, path: PathBuf, last_used: Option<i64>, others: usize, cx: &ScopeCtx) -> (Resolved, Option<Value>) {
    let Ok(meta) = cx.fs.meta(&path) else { return (Resolved::Nothing, Some(not_found(i, Why::Gone))) };
    if handler_forbidden(&path, cx.probe, cx.rules) {
        return (Resolved::Nothing, Some(not_found(i, Why::Forbidden)));
    }
    let modified = meta.modified;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    if name.is_empty() || name.contains('/') || !one_line(&name) {
        return (Resolved::Nothing, Some(not_found(i, Why::None)));
    }
    let line = found(
        i,
        json!({ "type": "file", "name": folder::clip_name(&name, 255), "kind": kind_key(&path), "where": folder::where_words(&path, &cx.home), "modified": folder::ymd(modified), "lastUsed": last_used.map(folder::ymd), "others": others.min(folder::MAX_OTHERS) }),
    );
    (Resolved::File { path, name }, Some(line))
}

/// Looks up every step (in order, at most three seconds in all) and builds the scope body (H.2.2) of the steps that
/// need it. The body never holds a path.
pub fn scope(t: &TaskViewV2, cx: &ScopeCtx) -> (Vec<Resolved>, Value) {
    let mut resolved = Vec::new();
    let mut lines = Vec::new();
    for s in &t.steps {
        let (r, line) = scope_step(s, cx);
        resolved.push(r);
        if s.needs_scope() {
            lines.push(line.unwrap_or_else(|| not_found(s.i(), Why::None)));
        }
    }
    (resolved, json!({ "version": 1, "steps": lines }))
}

/// Whether every step Rust must hold something for has it (a page, a file job's file; the rest is answered by
/// Boredroom's unresolved words after scope).
pub fn local_gap(t: &TaskViewV2, resolved: &[Resolved]) -> Option<&'static str> {
    for (s, r) in t.steps.iter().zip(resolved) {
        match (s, r) {
            (StepView::Open { target: OpenTarget::Url, .. }, Resolved::Nothing) => return Some("url"),
            (StepView::File { .. }, Resolved::Nothing) => return Some("file_unresolved"),
            (StepView::File { .. }, Resolved::FileJob(c)) if c.kind == Kind::Other => return Some("file_type"),
            (StepView::File { .. }, Resolved::FileJob(c)) if c.bytes > filework::MAX_FILE_BYTES => return Some("file_too_big"),
            (s, Resolved::Nothing) if s.needs_scope() && !t.needs_scope => return Some("unresolved"),
            _ => {}
        }
    }
    None
}

/// The names a folder step will read, for "Show the 14" (the page only; never Boredroom before the yes).
pub fn local_names(resolved: &[Resolved]) -> Option<Value> {
    resolved.iter().find_map(|r| match r {
        Resolved::Files { files, .. } => Some(json!({ "names": files.iter().take(folder::MAX_FILES).map(|f| f.name.clone()).collect::<Vec<_>>() })),
        _ => None,
    })
}

// ---- opening (B.3) ----------------------------------------------------------------------------------------------------

/// What the re-check right before an open needs.
pub struct Recheck<'a> {
    pub home: PathBuf,
    pub rules: &'a [Rule],
    pub probe: &'a dyn guard::OpenProbe,
}

/// One open step: the stop flag, then the thing re-checked (still there, the same kind, still allowed), then the
/// `Opener`. `Err` is the progress error: `gone`, `refused` or `failed` (or `stopped`: nothing was opened).
pub fn open_step(opener: &mut dyn Opener, stopped: &dyn Fn() -> bool, target: OpenTarget, r: &Resolved, cx: &Recheck) -> Result<(), &'static str> {
    if stopped() {
        return Err("stopped");
    }
    let never = folder::never_names(cx.rules);
    let file_ok = |p: &Path| -> Result<(), &'static str> {
        let m = std::fs::metadata(p).map_err(|_| "gone")?;
        if !m.is_file() {
            return Err("gone");
        }
        if guard::secret_file(p) || guard::never_open(p, cx.probe).is_some() {
            return Err("refused");
        }
        // The app that opens it, named by macOS and allowed (review, 12 October 2026); none named: not opened.
        match cx.probe.handler(p) {
            Some(h) if guard::handler_refused(&h, cx.rules).is_none() => {}
            _ => return Err("refused"),
        }
        let inside = p.starts_with(&cx.home) || p.starts_with("/Volumes");
        let parent_ok = p.parent().is_some_and(|d| folder::folder_ok(d, &cx.home, &never) || d == cx.home);
        if !inside || !parent_ok {
            return Err("refused");
        }
        Ok(())
    };
    let ok = match (target, r) {
        (OpenTarget::App, Resolved::App(a)) => {
            if !std::fs::metadata(&a.path).is_ok_and(|m| m.is_dir()) {
                return Err("gone");
            }
            if guard::never_open(&a.path, cx.probe).is_some()
                || guard::no_act(&AppId { bundle_id: a.bundle_id.clone(), names: vec![a.name.clone()] }, cx.rules).is_some()
                || guard::installer_like(std::slice::from_ref(&a.name), a.bundle_id.as_deref())
            {
                return Err("refused");
            }
            if stopped() {
                return Err("stopped");
            }
            opener.open_path(&a.path)
        }
        (OpenTarget::Url, Resolved::Url(u)) => {
            if !open::url_ok(u) {
                return Err("refused");
            }
            if stopped() {
                return Err("stopped");
            }
            opener.open_url(u)
        }
        (OpenTarget::Folder, Resolved::Folder { path, .. }) => {
            if !std::fs::metadata(path).is_ok_and(|m| m.is_dir()) {
                return Err("gone");
            }
            if !folder::folder_ok(path, &cx.home, &never) {
                return Err("refused");
            }
            if stopped() {
                return Err("stopped");
            }
            opener.open_path(path)
        }
        (OpenTarget::File | OpenTarget::Recent, Resolved::File { path, .. }) => {
            file_ok(path)?;
            if stopped() {
                return Err("stopped");
            }
            opener.open_path(path)
        }
        (OpenTarget::Reveal, Resolved::File { path, .. }) => {
            file_ok(path)?;
            if stopped() {
                return Err("stopped");
            }
            opener.reveal(path)
        }
        _ => return Err("gone"),
    };
    if ok {
        Ok(())
    } else {
        Err("failed")
    }
}

/// The real open (B.3): the one place a `WorkspaceOpener` is built.
pub fn run_open(app: &tauri::AppHandle, stopped: &dyn Fn() -> bool, target: OpenTarget, r: &Resolved, cx: &Recheck) -> Result<(), &'static str> {
    let mut opener = open::WorkspaceOpener::new(app);
    open_step(&mut opener, stopped, target, r, cx)
}

/// "Opening Figma…" (M.7), for the doing card.
pub fn open_note(target: OpenTarget, r: &Resolved) -> String {
    match (target, r) {
        (_, Resolved::App(a)) => format!("Opening {}…", a.name),
        (_, Resolved::Url(u)) => format!("Opening {}…", reqwest::Url::parse(u).ok().and_then(|u| u.host_str().map(|h| h.trim_start_matches("www.").to_string())).unwrap_or_else(|| "the page".into())),
        (_, Resolved::Folder { words, .. }) => format!("Opening {words}…"),
        (OpenTarget::Reveal, Resolved::File { name, .. }) => format!("Showing {name} in Finder…"),
        (_, Resolved::File { name, .. }) => format!("Opening {name}…"),
        _ => "Opening it…".into(),
    }
}

/// The progress error in words (M.8 "Couldn't: …").
pub fn progress_words(error: &str) -> &'static str {
    match error {
        "gone" => "the thing to open was gone",
        "refused" => "macOS wouldn't open it",
        _ => "it didn't open",
    }
}

/// What a failed open says (M.8 "Couldn't: …"): Boredroom's own sentence, which its `/progress` answer carries as
/// `summary` (`{status: "failed", planDone: false, summary}`; integration, 12 October 2026: Rust read only `message`, so
/// Boredroom's words were dropped), else a `message`, else this Mac's words.
pub fn progress_failed_words(v: &Value, error: &str) -> String {
    ["summary", "message"]
        .iter()
        .find_map(|k| v.get(*k).and_then(|m| m.as_str()).map(str::trim).filter(|m| !m.is_empty()).map(String::from))
        .unwrap_or_else(|| format!("Couldn't: {}.", progress_words(error)))
}

// ---- bodies (H.1, H.2) ------------------------------------------------------------------------------------------------

pub fn progress_body(i: u32, result: Result<(), &str>) -> Value {
    match result {
        Ok(()) => json!({ "version": 1, "i": i, "ok": true }),
        Err(e) => json!({ "version": 1, "i": i, "ok": false, "error": if matches!(e, "gone" | "refused") { e } else { "failed" } }),
    }
}

pub fn run_body(i: u32) -> Value {
    json!({ "version": 1, "i": i })
}

pub fn finish_body(i: u32, sections: &[folder::Section], skipped: &[folder::Skipped]) -> Value {
    json!({ "version": 1, "i": i, "sections": sections, "skipped": skipped })
}

/// `planDone` and the plan's summary from any step answer.
pub fn plan_done(v: &Value) -> (bool, Option<String>) {
    (v.get("planDone").and_then(|d| d.as_bool()).unwrap_or(false), v.get("summary").and_then(|s| s.as_str()).map(String::from).filter(|s| !s.trim().is_empty()))
}

// ---- running the steps (D.5, I.4.7) -----------------------------------------------------------------------------------

/// A step that finished: whether the plan is done, with its summary, and what it made.
#[derive(Debug, Default)]
pub struct StepDone {
    pub plan_done: bool,
    pub summary: Option<String>,
    pub outputs: Vec<OutputShown>,
    pub doc: Option<Value>,
    pub skipped: usize,
    pub steps: u32,
}

/// How a plan ended, for `act.rs` to tell the person and the server.
#[derive(Debug, PartialEq)]
pub enum PlanEnd {
    Done { summary: String, steps: u32, outputs: Vec<OutputShown>, doc: Option<Value>, skipped: usize },
    Stopped { why: String },
    SaidNo,
    Failed { code: Option<String>, message: String },
    Refused { reason: String },
    /// The part already ended the task itself (a screen part or a file job, as in phase 2).
    Ended,
}

/// What the steps need from the Mac and Boredroom (`act.rs`'s real one; the tests' own).
pub trait PlanHost {
    fn stopped(&self) -> bool;
    fn past_deadline(&self) -> bool;
    /// A small JSON post to `/act/{id}/{tail}`.
    fn post(&mut self, tail: &str, body: Value) -> Result<Value, ApiError>;
    fn emit(&mut self, e: ActEvent);
    fn phase(&mut self, p: Phase);
    fn open(&mut self, target: OpenTarget, r: &Resolved) -> Result<(), &'static str>;
    /// After an app opens: up to five seconds for it to come to the front.
    fn wait_front(&mut self, bundle_id: Option<&str>);
    /// A Boredroom change that reaches someone else: the step card, the person's answer, `/step-answer`. Ok(true): yes.
    fn ask(&mut self, ask: StepAsk) -> Result<bool, PlanEnd>;
    fn folder(&mut self, i: u32, step: &StepView, r: &Resolved) -> Result<StepDone, PlanEnd>;
    fn file(&mut self, i: u32, step: &StepView, r: &Resolved) -> Result<StepDone, PlanEnd>;
    fn screen(&mut self, i: u32, goal: &str, after_open: bool) -> Result<StepDone, PlanEnd>;
    fn task_id(&self) -> String;
}

fn failed(e: ApiError) -> PlanEnd {
    if e.code.as_deref() == Some("STOPPED") {
        return PlanEnd::Stopped { why: "button".into() };
    }
    PlanEnd::Failed { code: e.code, message: if e.status == 0 { "I couldn't reach Boredroom, so I stopped. What I did before that stays done.".into() } else { e.message } }
}

/// Runs the plan's steps in order after the yes (companion2-spec D.5). Stop is checked before every step.
pub fn run_steps(host: &mut dyn PlanHost, t: &TaskViewV2, resolved: &[Resolved]) -> PlanEnd {
    let n = t.steps.len() as u32;
    let id = host.task_id();
    let mut outputs: Vec<OutputShown> = Vec::new();
    let mut doc: Option<Value> = None;
    let mut skipped = 0usize;
    let mut steps = 0u32;
    let mut summary: Option<String> = None;
    let mut after_open = false;
    let none = Resolved::Nothing;
    for (k, s) in t.steps.iter().enumerate() {
        let r = resolved.get(k).unwrap_or(&none);
        if host.stopped() {
            return PlanEnd::Stopped { why: "button".into() };
        }
        if host.past_deadline() {
            return PlanEnd::Refused { reason: "time".into() };
        }
        let i = s.i();
        let part = Some(act::Part { k: k as u32 + 1, of: n, kind: s.kind() });
        let done = match s {
            StepView::Open { target, .. } => {
                host.phase(Phase::Running);
                host.emit(ActEvent::Running { task_id: id.clone(), step: steps, note: Some(open_note(*target, r)), part });
                let opened = host.open(*target, r);
                if opened == Err("stopped") || host.stopped() {
                    return PlanEnd::Stopped { why: "button".into() };
                }
                let v = match host.post("progress", progress_body(i, opened)) {
                    Ok(v) => v,
                    Err(e) => return failed(e),
                };
                if let Err(e) = opened {
                    return PlanEnd::Failed { code: Some("ACT_OPEN".into()), message: progress_failed_words(&v, e) };
                }
                let (plan_done, s) = plan_done(&v);
                if let (OpenTarget::App, Resolved::App(a), false) = (target, r, plan_done) {
                    host.wait_front(a.bundle_id.as_deref());
                }
                after_open = true;
                StepDone { plan_done, summary: s, ..Default::default() }
            }
            StepView::Boredroom { .. } => {
                host.phase(Phase::Running);
                host.emit(ActEvent::Running { task_id: id.clone(), step: steps, note: Some("Making the change in Boredroom…".into()), part });
                let mut asked = false;
                loop {
                    if host.stopped() {
                        return PlanEnd::Stopped { why: "button".into() };
                    }
                    let v = match host.post("run", run_body(i)) {
                        Ok(v) => v,
                        Err(e) => return failed(e),
                    };
                    match v.get("status").and_then(|s| s.as_str()) {
                        Some("done") => {
                            let (plan_done, s) = plan_done(&v);
                            break StepDone { plan_done, summary: s, ..Default::default() };
                        }
                        Some("ask") if !asked => {
                            asked = true;
                            let a = v.get("ask").cloned().unwrap_or(Value::Null);
                            let kind = a.get("kind").and_then(|k| k.as_str()).unwrap_or("send").to_string();
                            let what = a.get("what").and_then(|k| k.as_str()).unwrap_or("").to_string();
                            let question = a.get("question").and_then(|k| k.as_str()).map(String::from).unwrap_or_else(|| format!("Next I'll {what}. Do you want me to do this?"));
                            let because = a.get("because").and_then(|k| k.as_str()).map(String::from).unwrap_or_else(|| act::because(&kind).into());
                            match host.ask(StepAsk { i: Some(i), kind, what, question, because }) {
                                Ok(true) => {
                                    host.phase(Phase::Running);
                                    continue;
                                }
                                Ok(false) => return PlanEnd::SaidNo,
                                Err(e) => return e,
                            }
                        }
                        _ => return PlanEnd::Failed { code: None, message: "Boredroom's answer couldn't be read, so I stopped. What I did before that stays done.".into() },
                    }
                }
            }
            StepView::Folder { .. } => {
                host.phase(Phase::Working);
                match host.folder(i, s, r) {
                    Ok(d) => d,
                    Err(e) => return e,
                }
            }
            StepView::File { .. } => {
                host.phase(Phase::Working);
                match host.file(i, s, r) {
                    Ok(d) => d,
                    Err(e) => return e,
                }
            }
            StepView::Screen { goal, .. } => {
                host.phase(Phase::Running);
                match host.screen(i, goal, after_open) {
                    Ok(d) => d,
                    Err(e) => return e,
                }
            }
        };
        steps += done.steps;
        outputs.extend(done.outputs);
        if done.doc.is_some() {
            doc = done.doc;
        }
        skipped += done.skipped;
        if done.summary.is_some() {
            summary = done.summary;
        }
        if done.plan_done {
            return PlanEnd::Done { summary: summary.unwrap_or_else(|| "Done.".into()), steps, outputs, doc, skipped };
        }
    }
    PlanEnd::Done { summary: summary.unwrap_or_else(|| "Done.".into()), steps, outputs, doc, skipped }
}

/// A folder job's step (C.2) over its own host: each file, then `/folder/finish`, then the new file saved in that
/// folder. Stopped at any point: nothing is finished or written.
pub trait FolderStepHost: folder::JobHost {
    fn finish(&mut self, body: Value) -> Result<Value, ApiError>;
    /// Saves the finished result in `dir` (or takes its Boredroom document): what was made, or why not.
    fn save(&mut self, v: &Value, dir: &Path, output: &OutputRef) -> Result<(Option<OutputShown>, Option<Value>), PlanEnd>;
}

pub fn folder_step(host: &mut dyn FolderStepHost, i: u32, output: &OutputRef, root: &Path, files: &[Found]) -> Result<StepDone, PlanEnd> {
    let (sections, skipped) = match folder::read_and_send(host, files) {
        Ok(x) => x,
        Err(folder::JobEnd::Stopped) => return Err(PlanEnd::Stopped { why: "button".into() }),
        Err(folder::JobEnd::Failed(e)) => return Err(failed(e)),
    };
    if host.stopped() {
        return Err(PlanEnd::Stopped { why: "button".into() });
    }
    let body = finish_body(i, &sections, &skipped);
    drop(sections);
    let v = host.finish(body).map_err(failed)?;
    if host.stopped() {
        return Err(PlanEnd::Stopped { why: "button".into() });
    }
    let (shown, doc) = host.save(&v, root, output)?;
    let (plan_done, summary) = plan_done(&v);
    Ok(StepDone { plan_done, summary, outputs: shown.into_iter().collect(), doc, skipped: skipped.len(), steps: 0 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::folder::tests::{file, scratch};
    use crate::open::RecordingOpener;
    use std::collections::VecDeque;

    const ID: &str = "0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30";

    fn open_app(i: u32, name: &str) -> StepView {
        StepView::Open { i, target: OpenTarget::App, name: name.into(), url: String::new(), folder: FolderRef { source: "none".into(), name: String::new() }, words: vec![], kinds: vec![], since_days: 0 }
    }

    fn folder_job(i: u32) -> StepView {
        StepView::Folder {
            i,
            folder: FolderRef { source: "named".into(), name: "documents".into() },
            kinds: vec![FindKind::Any],
            recursive: false,
            since_days: 0,
            words: vec![],
            per_file: true,
            job: "write a one-page summary of each".into(),
            output: OutputRef { format: filework::Format::Docx, name: "Documents summary.docx".into() },
        }
    }

    fn view(steps: Vec<StepView>, lines: Option<Vec<String>>) -> TaskViewV2 {
        let plan = "I'll open Figma, make a new file called “Landing v2” and remind you at 3pm to review it.".to_string();
        let needs_scope = lines.is_none();
        TaskViewV2 {
            id: ID.into(),
            kind: "plan".into(),
            v: 2,
            plan_sha256: lines.as_ref().map(|l| plan_hash(&plan, l)).unwrap_or_default(),
            plan,
            question: "Do you want me to do this?".into(),
            answer_by: None,
            risky: false,
            step_cap: Some(20),
            needs_scope,
            lines,
            steps,
        }
    }

    /// Companion2-spec D.4's vectors (the server tests the same ones).
    #[test]
    fn hash_v2_vector() {
        assert_eq!(plan_hash("I'll open Figma.", &[]), "f75d875cdd62dc03ea7f46421a864df5534713f13e035300c1b8754c58eba84d");
        assert_eq!(plan_hash("I'll open Figma.", &[]), act::sha256_hex("I'll open Figma."), "no lines: phase 2's hash");
        assert_eq!(plan_hash("I'll open Figma.", &["Open Figma (Applications)".into()]), "c34c5ecef6cd6529bd124d9083a7e39abe97003e272547af3e7cc82d4648aaf6");
        assert_eq!(
            plan_hash(
                "I'll read the documents in your Documents folder and write a one-page summary of each into “Documents summary.docx”.",
                &["Read the 14 documents in Documents (PDF, Word, text, 38 MB) and save “Documents summary.docx” there".into()]
            ),
            "2e189312e84ed8bfeb455b90da14742a71802c5b6ab1cd2c2ddd23e79728516a"
        );
        assert_eq!(act::sha256_hex("Invoice 1042.pdf"), "af8e832f1c3fcf8e2b33909bb32b7756a7524e2ce45b417221d1ab0e54782e14");
    }

    /// H.2.1's example parses, and `view_ok_v2` holds the plan to I.4.2.
    #[test]
    fn view_ok_v2_rules() {
        let example = json!({ "id": ID, "kind": "plan", "v": 2,
          "plan": "I'll open Figma, make a new file called “Landing v2” and remind you at 3pm to review it.",
          "question": "Do you want me to do this?", "planSha256": "", "answerBy": "2026-10-12T10:31:05Z",
          "risky": false, "stepCap": 20, "needsScope": true, "lines": null, "file": null, "output": null,
          "steps": [
            { "i": 0, "kind": "open", "target": "app", "name": "Figma", "url": "", "folder": { "source": "none", "name": "" }, "words": [], "kinds": [], "sinceDays": 0 },
            { "i": 1, "kind": "screen", "goal": "Make a new design file and name it “Landing v2”." },
            { "i": 2, "kind": "boredroom", "summary": "Remind you at 15:00: review Landing v2", "outward": false }
          ] });
        let v: TaskViewV2 = serde_json::from_value(example).unwrap();
        assert!(view_ok_v2(&v));
        assert_eq!(v.brief().plan_sha256, act::sha256_hex(&v.plan), "before scope: the sentence's own hash");
        assert!(v.steps[0].needs_scope() && !v.steps[1].needs_scope() && !v.steps[2].needs_scope());
        let shapes = json!([
            { "i": 0, "kind": "folder", "folder": { "source": "named", "name": "documents" }, "kinds": ["any"], "recursive": false, "sinceDays": 0, "words": [], "perFile": true, "job": "write a one-page summary of each", "output": { "format": "docx", "name": "Documents summary.docx" } },
            { "i": 0, "kind": "file", "file": { "source": "finder_selection", "name": "Q3 report.pdf" }, "output": { "format": "md", "name": "Q3 report (Brenda summary).md" } }
        ]);
        for s in shapes.as_array().unwrap() {
            let st: StepView = serde_json::from_value(s.clone()).unwrap();
            let mut t = v.clone();
            t.steps = vec![st];
            assert!(view_ok_v2(&t), "{s}");
        }
        // Once looked up: the lines and the hash over both.
        let lines = vec!["Open Figma (Applications)".to_string(), "On your screen: Make a new design file and name it “Landing v2”.".into(), "Remind you at 15:00: review Landing v2".into()];
        let mut ready = v.clone();
        ready.needs_scope = false;
        ready.plan_sha256 = plan_hash(&ready.plan, &lines);
        ready.lines = Some(lines.clone());
        assert!(view_ok_v2(&ready));
        assert_eq!(ready.brief().plan_sha256, ready.plan_sha256);
        let mut tampered = ready.clone();
        tampered.lines.as_mut().unwrap()[0] = "Open Terminal (Utilities)".into();
        assert!(!view_ok_v2(&tampered), "a line the hash doesn't cover");
        let mut t = ready.clone();
        t.plan_sha256 = act::sha256_hex(&t.plan);
        assert!(!view_ok_v2(&t), "the sentence's hash alone is not enough once there are lines");
        let mut t = ready.clone();
        t.lines = None;
        assert!(!view_ok_v2(&t), "not looked up yet and no lines");
        // Shapes and counts.
        let bad = |f: &dyn Fn(&mut TaskViewV2)| {
            let mut t = v.clone();
            f(&mut t);
            view_ok_v2(&t)
        };
        assert!(!bad(&|t| t.steps[1] = StepView::Screen { i: 2, goal: "Make a new design file.".into() }), "i is its place");
        assert!(!bad(&|t| t.steps = vec![]));
        assert!(!bad(&|t| t.steps = (0..7).map(|i| StepView::Boredroom { i, summary: "x".into(), outward: false }).collect()));
        assert!(!bad(&|t| t.steps = (0..4).map(|i| open_app(i, "Figma")).collect()), "three opens at most");
        assert!(!bad(&|t| t.steps = vec![StepView::Screen { i: 0, goal: "Do the first thing.".into() }, StepView::Screen { i: 1, goal: "Do the next thing.".into() }]));
        assert!(!bad(&|t| t.steps = vec![folder_job(0), folder_job(1)]));
        assert!(!bad(&|t| t.steps = (0..5).map(|i| StepView::Boredroom { i, summary: "x".into(), outward: false }).collect()), "four changes at most");
        assert!(!bad(&|t| t.plan = "Open Figma for you now.".into()));
        assert!(!bad(&|t| t.plan = "I'll open Figma.\nThen Terminal.".into()));
        assert!(!bad(&|t| t.kind = "screen".into()));
        assert!(!bad(&|t| t.id = "../x".into()));
        assert!(!bad(&|t| t.steps[0] = open_app(0, "a/b")));
        assert!(!bad(&|t| t.steps[0] = StepView::Open { i: 0, target: OpenTarget::Url, name: String::new(), url: "file:///etc/hosts".into(), folder: FolderRef { source: "none".into(), name: String::new() }, words: vec![], kinds: vec![], since_days: 0 }));
        assert!(!bad(&|t| t.steps[0] = StepView::Open { i: 0, target: OpenTarget::Folder, name: String::new(), url: String::new(), folder: FolderRef { source: "named".into(), name: "library".into() }, words: vec![], kinds: vec![], since_days: 0 }));
        assert!(!bad(&|t| t.steps[0] = StepView::Open { i: 0, target: OpenTarget::File, name: String::new(), url: String::new(), folder: FolderRef { source: "none".into(), name: String::new() }, words: vec!["in<voice".into()], kinds: vec![], since_days: 0 }));
        assert!(!bad(&|t| t.steps[0] = StepView::Open { i: 0, target: OpenTarget::File, name: String::new(), url: String::new(), folder: FolderRef { source: "none".into(), name: String::new() }, words: vec![], kinds: vec![], since_days: 0 }), "a file needs its name or words");
        assert!(bad(&|t| t.steps[0] = StepView::Open { i: 0, target: OpenTarget::Recent, name: String::new(), url: String::new(), folder: FolderRef { source: "none".into(), name: String::new() }, words: vec!["invoice".into()], kinds: vec![FindKind::Pdf], since_days: 7 }));
        assert!(!bad(&|t| t.steps[1] = StepView::Screen { i: 1, goal: "short".into() }));
        // A page's line must name its whole address (review, 12 October 2026).
        let page = |url: &str| StepView::Open { i: 0, target: OpenTarget::Url, name: String::new(), url: url.into(), folder: FolderRef { source: "none".into(), name: String::new() }, words: vec![], kinds: vec![], since_days: 0 };
        let with = |url: &str, line: &str| {
            let mut t = view(vec![page(url)], Some(vec![line.to_string()]));
            t.plan_sha256 = plan_hash(&t.plan, t.lines.as_ref().unwrap());
            view_ok_v2(&t)
        };
        assert!(with("https://www.figma.com/files/recent?fuid=1", "Open figma.com/files/recent?fuid=1 in your browser"));
        assert!(!with("https://www.figma.com/files/recent?fuid=1", "Open figma.com/files/recent in your browser"), "the query left out");
        assert!(!with("https://docs.google.com/forms/d/x/formResponse?entry.1=yes&submit=Submit", "Open docs.google.com/forms/d/x/formResponse in your browser"));
        assert!(!with("https://www.google.com/url?q=https://www.paypal.com/", "Open google.com/url?q=https://www.paypal.com/ in your browser"), "a redirector never shows");
        let unknown = json!({ "i": 0, "kind": "run_command", "command": "rm -rf ~" });
        assert!(serde_json::from_value::<StepView>(unknown).is_err(), "an unknown kind never parses");
        let unknown = json!({ "i": 0, "kind": "open", "target": "terminal", "name": "", "url": "", "folder": { "source": "none", "name": "" }, "words": [], "kinds": [], "sinceDays": 0 });
        assert!(serde_json::from_value::<StepView>(unknown).is_err(), "an unknown target never parses");
        assert!(same_plan(&v, &ready));
        let mut other = ready.clone();
        other.steps[0] = open_app(0, "Sketch");
        assert!(!same_plan(&v, &other), "Boredroom can't change what was looked up");
    }

    /// Section 0.5's name for the rules above (`plan::tests::named::view_ok_v2`).
    mod named {
        #[test]
        fn view_ok_v2() {
            super::view_ok_v2_rules();
        }
    }

    #[test]
    fn abilities_first_gap() {
        let v = view(vec![open_app(0, "Figma"), StepView::Screen { i: 1, goal: "Make a new design file.".into() }, folder_job(2)], None);
        assert_eq!(ability_gap(&v, false, false, false), Some("use_mac_off"));
        assert_eq!(ability_gap(&v, true, false, false), Some("files_off"));
        assert_eq!(ability_gap(&v, true, true, false), Some("accessibility"));
        assert_eq!(ability_gap(&v, true, true, true), None);
        let only_open = view(vec![open_app(0, "Figma")], None);
        assert_eq!(ability_gap(&only_open, true, false, false), None, "opening needs neither files nor Accessibility");
        let only_change = view(vec![StepView::Boredroom { i: 0, summary: "Remind you at 15:00".into(), outward: false }], Some(vec!["Remind you at 15:00".into()]));
        assert_eq!(ability_gap(&only_change, false, false, false), None);
    }

    fn cx_for<'a>(home: &Path, cands: &'a [Candidate], probe: &'a guard::tests::FakeProbe, bundle: &'a dyn Fn(&Path) -> Option<String>) -> ScopeCtx<'a> {
        ScopeCtx {
            home: home.to_path_buf(),
            rules: &[],
            candidates: cands,
            fs: &folder::RealFs,
            search: &open::NoSearch,
            last_used: &folder::NoLastUsed,
            probe,
            bundle,
            app_folders: vec![(home.join("Applications"), "your Applications")],
            now_unix: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64,
            deadline: Instant::now() + SCOPE_TIME,
        }
    }

    /// H.2.2's shapes from a temp home folder: no path ever in the body.
    #[test]
    fn scope_body() {
        let home = scratch("scope");
        std::fs::create_dir_all(home.join("Applications/Figma.app")).unwrap();
        std::fs::create_dir_all(home.join("Documents")).unwrap();
        std::fs::create_dir_all(home.join("Downloads")).unwrap();
        std::fs::create_dir_all(home.join("Desktop")).unwrap();
        for n in ["Plan.docx", "Notes.txt", "Q3.pdf"] {
            file(&home.join("Documents"), n, 1_000, 1);
        }
        file(&home.join("Downloads"), "Invoice 1042.pdf", 2_000, 3);
        file(&home.join("Downloads"), "Invoice 1041.pdf", 2_000, 30);
        let probe = guard::tests::FakeProbe { home: Some(home.clone()), quarantine: vec![], exec: vec![] };
        let bundle = |_p: &Path| Some("com.figma.Desktop".to_string());
        let cx = cx_for(&home, &[], &probe, &bundle);
        let find = StepView::Open { i: 2, target: OpenTarget::File, name: String::new(), url: String::new(), folder: FolderRef { source: "none".into(), name: String::new() }, words: vec!["invoice".into()], kinds: vec![FindKind::Pdf], since_days: 0 };
        let open_docs = StepView::Open { i: 3, target: OpenTarget::Folder, name: String::new(), url: String::new(), folder: FolderRef { source: "named".into(), name: "downloads".into() }, words: vec![], kinds: vec![], since_days: 0 };
        let missing = open_app(4, "Sketch");
        let t = view(vec![open_app(0, "Figma"), folder_job(1), find, open_docs, missing], None);
        let (resolved, body) = scope(&t, &cx);
        assert_eq!(body["version"], 1);
        let s = body["steps"].as_array().unwrap();
        assert_eq!(s.len(), 5, "each scope-needing step once");
        assert_eq!(s[0], json!({ "i": 0, "found": { "type": "app", "name": "Figma", "bundleId": "com.figma.Desktop", "where": "your Applications" } }));
        assert_eq!(s[1]["found"]["type"], "files");
        assert_eq!(s[1]["found"]["folder"], "Documents");
        assert_eq!((s[1]["found"]["count"].as_u64(), s[1]["found"]["total"].as_u64(), s[1]["found"]["bytes"].as_u64()), (Some(3), Some(3), Some(3_000)));
        assert_eq!(s[1]["found"]["kinds"], json!({ "pdf": 1, "word": 1, "text": 1 }));
        let hashes: Vec<&str> = s[1]["found"]["nameHashes"].as_array().unwrap().iter().map(|h| h.as_str().unwrap()).collect();
        assert_eq!(hashes.len(), 3);
        assert!(hashes.contains(&act::sha256_hex("Plan.docx").as_str()));
        assert_eq!(s[2]["found"]["type"], "file");
        assert_eq!(s[2]["found"]["name"], "Invoice 1042.pdf");
        assert_eq!((s[2]["found"]["kind"].as_str(), s[2]["found"]["where"].as_str(), s[2]["found"]["others"].as_u64()), (Some("pdf"), Some("Downloads"), Some(1)));
        assert_eq!(s[2]["found"]["modified"].as_str().unwrap().len(), 10);
        assert_eq!(s[2]["found"]["lastUsed"], Value::Null);
        assert_eq!(s[3], json!({ "i": 3, "found": { "type": "folder", "name": "Downloads" } }));
        assert_eq!(s[4], json!({ "i": 4, "found": null, "why": "none" }));
        let text = body.to_string();
        assert!(!text.contains(&*home.to_string_lossy()), "never a path");
        assert!(!text.contains("Plan.docx") && !text.contains("Notes.txt"), "the folder's names stay on the Mac");
        assert!(matches!(&resolved[1], Resolved::Files { files, .. } if files.len() == 3));
        assert_eq!(local_names(&resolved).unwrap()["names"].as_array().unwrap().len(), 3);
        // A folder macOS refuses, and one that is gone.
        let mut f = folder_job(0);
        if let StepView::Folder { folder, .. } = &mut f {
            *folder = FolderRef { source: "named".into(), name: "pictures".into() };
        }
        let (_, b) = scope(&view(vec![f], None), &cx);
        assert_eq!(b["steps"][0]["why"], "gone");
        // Review, 12 October 2026: a file found by words that opens in a never-act app is refused before asking, and a
        // password export is never found.
        file(&home.join("Downloads"), "Clipboard workflow.alfredworkflow", 10, 0);
        file(&home.join("Downloads"), "Chrome Passwords.csv", 10, 0);
        let by = |w: &str| StepView::Open { i: 0, target: OpenTarget::File, name: String::new(), url: String::new(), folder: FolderRef { source: "named".into(), name: "downloads".into() }, words: vec![w.into()], kinds: vec![], since_days: 0 };
        let (_, b) = scope(&view(vec![by("workflow")], None), &cx);
        assert_eq!(b["steps"][0], json!({ "i": 0, "found": null, "why": "forbidden" }));
        let (_, b) = scope(&view(vec![by("passwords")], None), &cx);
        assert_eq!(b["steps"][0]["why"], "none");
        let _ = std::fs::remove_dir_all(&home);
    }

    /// Section 0.5 `plan::scope_before_asking` and `plan::state_machine`: scoping → asking (only once the lines came back
    /// and the hash holds) → yes → open → progress → a Boredroom change asks again → yes → run → folder → finish → done.
    struct Mock {
        posts: Vec<(String, Value)>,
        answers: VecDeque<Result<Value, ApiError>>,
        events: Vec<String>,
        opener: RecordingOpener,
        stop_at: Option<String>,
        stopped: std::cell::Cell<bool>,
        ask_yes: bool,
        folder_done: Option<StepDone>,
        home: PathBuf,
    }

    impl Mock {
        fn new(answers: Vec<Value>) -> Self {
            Mock { posts: vec![], answers: answers.into_iter().map(Ok).collect(), events: vec![], opener: RecordingOpener::default(), stop_at: None, stopped: std::cell::Cell::new(false), ask_yes: true, folder_done: None, home: "/Users/a".into() }
        }
    }

    impl PlanHost for Mock {
        fn stopped(&self) -> bool {
            self.stopped.get()
        }
        fn past_deadline(&self) -> bool {
            false
        }
        fn post(&mut self, tail: &str, body: Value) -> Result<Value, ApiError> {
            self.posts.push((tail.into(), body));
            if self.stop_at.as_deref() == Some(tail) {
                self.stopped.set(true);
            }
            self.answers.pop_front().unwrap_or(Ok(json!({ "status": "ok", "planDone": false })))
        }
        fn emit(&mut self, e: ActEvent) {
            let v = serde_json::to_value(&e).unwrap();
            self.events.push(v["phase"].as_str().unwrap().to_string());
        }
        fn phase(&mut self, p: Phase) {
            self.events.push(format!("phase:{p:?}"));
        }
        fn open(&mut self, target: OpenTarget, r: &Resolved) -> Result<(), &'static str> {
            let stopped = self.stopped.get();
            let probe = guard::tests::FakeProbe { home: Some(self.home.clone()), quarantine: vec![], exec: vec![] };
            open_step(&mut self.opener, &|| stopped, target, r, &Recheck { home: self.home.clone(), rules: &[], probe: &probe })
        }
        fn wait_front(&mut self, _b: Option<&str>) {
            self.events.push("wait_front".into());
        }
        fn ask(&mut self, ask: StepAsk) -> Result<bool, PlanEnd> {
            self.events.push(format!("step_ask:{}", ask.what));
            self.posts.push(("step-answer".into(), act::step_answer_body(self.ask_yes, act::Via::Button, &ask.what, None)));
            Ok(self.ask_yes)
        }
        fn folder(&mut self, i: u32, _s: &StepView, _r: &Resolved) -> Result<StepDone, PlanEnd> {
            self.posts.push(("folder".into(), json!({ "i": i })));
            self.posts.push(("folder/finish".into(), json!({ "i": i })));
            Ok(self.folder_done.take().unwrap_or_default())
        }
        fn file(&mut self, _i: u32, _s: &StepView, _r: &Resolved) -> Result<StepDone, PlanEnd> {
            Ok(StepDone::default())
        }
        fn screen(&mut self, _i: u32, _g: &str, _after: bool) -> Result<StepDone, PlanEnd> {
            Ok(StepDone::default())
        }
        fn task_id(&self) -> String {
            ID.into()
        }
    }

    #[test]
    fn state_machine() {
        let home = scratch("machine");
        std::fs::create_dir_all(home.join("Applications/Figma.app")).unwrap();
        std::fs::create_dir_all(home.join("Documents")).unwrap();
        file(&home.join("Documents"), "Plan.docx", 1_000, 1);
        let probe = guard::tests::FakeProbe { home: Some(home.clone()), quarantine: vec![], exec: vec![] };
        let bundle = |_p: &Path| Some("com.figma.Desktop".to_string());
        let cx = cx_for(&home, &[], &probe, &bundle);
        let steps = vec![open_app(0, "Figma"), StepView::Boredroom { i: 1, summary: "Message Ada: the landing page is ready".into(), outward: true }, folder_job(2)];
        let proposed = view(steps.clone(), None);
        assert!(view_ok_v2(&proposed));
        // Scoping: what was found goes to Boredroom; nothing is asked yet.
        let (resolved, body) = scope(&proposed, &cx);
        let lines = vec!["Open Figma (your Applications)".to_string(), "Message Ada: the landing page is ready (I'll ask again before it goes)".into(), "Read the 1 document in Documents (Word, under 1 MB) and save “Documents summary.docx” there".into()];
        let mut ready = view(steps, Some(lines.clone()));
        ready.plan = proposed.plan.clone();
        ready.plan_sha256 = plan_hash(&ready.plan, &lines);
        let mut m = Mock::new(vec![
            json!({ "status": "ready", "task": ready }),
            json!({ "status": "running" }),
            json!({ "status": "ok", "planDone": false }),
            json!({ "status": "ask", "ask": { "i": 1, "kind": "send", "what": "go ahead with “Message Ada: the landing page is ready”", "question": "Next I'll go ahead with “Message Ada: the landing page is ready”. Do you want me to do this?", "because": "this sends something" } }),
            json!({ "status": "done", "line": "Sent your message to Ada.", "planDone": false }),
        ]);
        m.home = home.clone();
        m.folder_done = Some(StepDone { plan_done: true, summary: Some("I've opened Figma, sent your message to Ada and written a summary of each of the 1 document in Documents into “Documents summary.docx”.".into()), outputs: vec![OutputShown { name: "Documents summary.docx".into(), folder: "Documents".into() }], ..Default::default() });
        let scoped = m.post("scope", body.clone()).unwrap();
        assert_eq!(scoped["status"], "ready");
        let after: TaskViewV2 = serde_json::from_value(scoped["task"].clone()).unwrap();
        // Asked only now: the same plan, its lines, the hash over both.
        assert!(same_plan(&proposed, &after) && view_ok_v2(&after) && !after.needs_scope);
        assert_eq!(after.brief().plan_sha256, plan_hash(&after.plan, &lines));
        m.events.push("asking".into());
        // The yes, bound to the sentence and the lines.
        m.post("answer", act::answer_body("yes", act::Via::Button, &after.brief().plan_sha256, None)).unwrap();
        let end = run_steps(&mut m, &after, &resolved);
        assert!(matches!(&end, PlanEnd::Done { outputs, .. } if outputs.len() == 1), "{end:?}");
        let tails: Vec<&str> = m.posts.iter().map(|(t, _)| t.as_str()).collect();
        assert_eq!(tails, vec!["scope", "answer", "progress", "run", "step-answer", "run", "folder", "folder/finish"]);
        assert_eq!(m.posts[2].1, json!({ "version": 1, "i": 0, "ok": true }));
        assert_eq!(m.posts[3].1, json!({ "version": 1, "i": 1 }));
        assert_eq!(m.posts[1].1["planSha256"], plan_hash(&after.plan, &lines));
        assert_eq!(m.opener.calls, vec![format!("open {}", home.join("Applications/Figma.app").display())]);
        let asked_at = m.events.iter().position(|e| e == "asking").unwrap();
        assert!(m.events.iter().position(|e| e.starts_with("step_ask:")).unwrap() > asked_at);
        assert!(m.events.contains(&"wait_front".to_string()), "the next step waits for Figma to come to the front");
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn scope_before_asking() {
        // A plan that still needs scope is never shown: no lines, so `view_ok_v2` on it as a ready plan fails, and
        // Boredroom's `unresolved` ends it without asking.
        let t = view(vec![open_app(0, "Figma")], None);
        let mut as_ready = t.clone();
        as_ready.needs_scope = false;
        assert!(!view_ok_v2(&as_ready));
        let mut m = Mock::new(vec![json!({ "status": "unresolved", "message": "I couldn't find an app called “Figma” on this Mac.", "settings": null })]);
        let v = m.post("scope", json!({ "version": 1, "steps": [{ "i": 0, "found": null, "why": "none" }] })).unwrap();
        assert_eq!(v["status"], "unresolved");
        assert!(m.events.is_empty(), "nothing asked");
    }

    #[test]
    fn a_change_said_no_to_stops_the_plan() {
        let t = view(vec![StepView::Boredroom { i: 0, summary: "Message Ada".into(), outward: true }, open_app(1, "Figma")], Some(vec!["Message Ada (I'll ask again before it goes)".into(), "Open Figma (Applications)".into()]));
        let mut m = Mock::new(vec![json!({ "status": "ask", "ask": { "i": 0, "kind": "send", "what": "go ahead with “Message Ada”" } })]);
        m.ask_yes = false;
        assert_eq!(run_steps(&mut m, &t, &[Resolved::Nothing, Resolved::Nothing]), PlanEnd::SaidNo);
        assert!(m.opener.calls.is_empty(), "nothing after a no");
        assert_eq!(m.posts.iter().map(|(t, _)| t.as_str()).collect::<Vec<_>>(), vec!["run", "step-answer"]);
    }

    #[test]
    fn no_open_after_stop() {
        let mut o = RecordingOpener::default();
        let probe = guard::tests::probe();
        let cx = Recheck { home: "/Users/a".into(), rules: &[], probe: &probe };
        let r = Resolved::Url("https://www.figma.com/".into());
        assert_eq!(open_step(&mut o, &|| true, OpenTarget::Url, &r, &cx), Err("stopped"));
        assert!(o.calls.is_empty());
        assert_eq!(open_step(&mut o, &|| false, OpenTarget::Url, &r, &cx), Ok(()));
        assert_eq!(o.calls, vec!["url https://www.figma.com/"]);
        // The plan's executor: stopped before the open, nothing opened, nothing posted.
        let t = view(vec![open_app(0, "Figma")], Some(vec!["Open Figma (Applications)".into()]));
        let mut m = Mock::new(vec![]);
        m.stopped.set(true);
        assert!(matches!(run_steps(&mut m, &t, &[Resolved::Nothing]), PlanEnd::Stopped { .. }));
        assert!(m.opener.calls.is_empty() && m.posts.is_empty());
        // Re-checked right before opening: gone, or refused.
        let home = scratch("recheck");
        let pdf = file(&home, "Q3.pdf", 10, 0);
        let pkg = file(&home, "Setup.pkg", 10, 0);
        let probe = guard::tests::FakeProbe { home: Some(home.clone()), quarantine: vec![], exec: vec![] };
        let cx = Recheck { home: home.clone(), rules: &[], probe: &probe };
        let mut o = RecordingOpener::default();
        assert_eq!(open_step(&mut o, &|| false, OpenTarget::File, &Resolved::File { path: pdf.clone(), name: "Q3.pdf".into() }, &cx), Ok(()));
        assert_eq!(open_step(&mut o, &|| false, OpenTarget::Reveal, &Resolved::File { path: pdf.clone(), name: "Q3.pdf".into() }, &cx), Ok(()));
        assert_eq!(open_step(&mut o, &|| false, OpenTarget::File, &Resolved::File { path: pkg, name: "Setup.pkg".into() }, &cx), Err("refused"));
        assert_eq!(open_step(&mut o, &|| false, OpenTarget::File, &Resolved::File { path: home.join("gone.pdf"), name: "gone.pdf".into() }, &cx), Err("gone"));
        // Review, 12 October 2026: the app that opens it is checked, and a file no app is known for is not opened.
        let opened = o.calls.len();
        for (n, why) in [("root.kc", "refused"), ("flow.alfredworkflow", "refused"), ("disk.vhd", "refused"), ("patch.upd", "refused"), ("odd.zzz", "refused"), ("Chrome Passwords.csv", "refused"), ("root-ca.cer", "refused")] {
            let p = file(&home, n, 10, 0);
            assert_eq!(open_step(&mut o, &|| false, OpenTarget::File, &Resolved::File { path: p, name: n.into() }, &cx), Err(why), "{n}");
        }
        assert_eq!(o.calls.len(), opened, "none of them opened");
        assert_eq!(open_step(&mut o, &|| false, OpenTarget::Url, &Resolved::Url("https://www.paypal.com/".into()), &cx), Err("refused"));
        assert_eq!(o.calls.len(), 2);
        assert!(o.calls[1].starts_with("reveal "));
        let _ = std::fs::remove_dir_all(&home);
    }

    struct FolderMock {
        stop_after: Option<usize>,
        stopped: std::cell::Cell<bool>,
        sent: usize,
        finished: bool,
        saved: bool,
    }

    impl folder::JobHost for FolderMock {
        fn stopped(&self) -> bool {
            self.stopped.get()
        }
        fn read(&mut self, _f: &Found, _cap: usize) -> Result<(filework::Payload, bool), filework::Refusal> {
            Ok((filework::Payload::Text { text: "words".into(), pages: Some(1) }, false))
        }
        fn send(&mut self, _n: usize, f: &Found, _p: &filework::Payload, _t: bool) -> Result<folder::Section, ApiError> {
            self.sent += 1;
            if self.stop_after == Some(self.sent) {
                self.stopped.set(true);
            }
            Ok(folder::Section { title: f.name.clone(), markdown: "A summary.".into() })
        }
        fn progress(&mut self, _d: usize, _o: usize) {}
    }

    impl FolderStepHost for FolderMock {
        fn finish(&mut self, body: Value) -> Result<Value, ApiError> {
            self.finished = true;
            assert_eq!(body["version"], 1);
            Ok(json!({ "summary": "Done.", "format": "md", "name": "Documents summary.md", "content": "# x", "planDone": true }))
        }
        fn save(&mut self, _v: &Value, _dir: &Path, o: &OutputRef) -> Result<(Option<OutputShown>, Option<Value>), PlanEnd> {
            self.saved = true;
            Ok((Some(OutputShown { name: o.name.clone(), folder: "Documents".into() }), None))
        }
    }

    #[test]
    fn stop_mid_folder_writes_nothing() {
        let files: Vec<Found> = (0..4).map(|n| Found { path: PathBuf::from(format!("/x/f{n}.txt")), name: format!("f{n}.txt"), kind: Some(FindKind::Text), bytes: 5, modified: 0 }).collect();
        let out = OutputRef { format: filework::Format::Md, name: "Documents summary.md".into() };
        let mut m = FolderMock { stop_after: Some(2), stopped: std::cell::Cell::new(false), sent: 0, finished: false, saved: false };
        assert!(matches!(folder_step(&mut m, 0, &out, Path::new("/x"), &files), Err(PlanEnd::Stopped { .. })));
        assert_eq!(m.sent, 2);
        assert!(!m.finished && !m.saved, "no finish, nothing written");
        let mut m = FolderMock { stop_after: None, stopped: std::cell::Cell::new(false), sent: 0, finished: false, saved: false };
        let d = folder_step(&mut m, 0, &out, Path::new("/x"), &files).unwrap();
        assert!(m.finished && m.saved && d.plan_done && d.outputs.len() == 1);
        let body = finish_body(2, &[folder::Section { title: "a.txt".into(), markdown: "m".into() }], &[folder::Skipped { name: "b.txt".into(), why: "budget" }]);
        assert_eq!(body, json!({ "version": 1, "i": 2, "sections": [{ "title": "a.txt", "markdown": "m" }], "skipped": [{ "name": "b.txt", "why": "budget" }] }));
    }

    /// A file's code without its test module.
    fn code_of(file: &str) -> String {
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/").to_string() + file).unwrap();
        let cut = ["\n#[cfg(test)]\nmod tests", "\n#[cfg(test)]\npub(crate) mod tests"].iter().filter_map(|m| src.find(m)).min().unwrap_or(src.len());
        src[..cut].to_string()
    }

    /// Section 0.5: a plan comes only from a `propose` line of a look (`look.rs` → `act::asking` → `receive_plan`).
    #[test]
    fn only_from_propose_line() {
        let mut asking = 0;
        for f in ["lib.rs", "look.rs", "act.rs", "plan.rs", "help.rs", "open.rs", "folder.rs", "companion.rs", "filework.rs", "input.rs", "files.rs", "voice.rs", "island.rs"] {
            let code = code_of(f);
            asking += code.matches("act::asking(").count();
            if f != "look.rs" {
                assert!(!code.contains("act::asking("), "{f} starts a proposal");
            }
            if f != "act.rs" {
                assert!(!code.contains("receive_plan("), "{f} starts a plan");
            }
        }
        assert_eq!(asking, 1, "only the look's stream");
        let act = code_of("act.rs");
        assert_eq!(act.matches("receive_plan(").count(), 2, "defined once, called once (from `asking`)");
        assert!(act.contains("return receive_plan(app, task, origin);"));
        assert!(code_of("look.rs").contains("Line::Propose(task) =>"), "the propose line is the one way in");
        assert!(code_of("look.rs").contains("act::asking(&app2, task, origin)"));
    }

    /// Section 0.5: `WorkspaceOpener` is built in exactly two places: here, and the front desk's `RealMac` (owner brief,
    /// 12 October 2026; itself built only in the command entry points, `macos::tests::real_mac_only_in_entry_points`).
    #[test]
    fn opener_only_in_executor() {
        let mut n = 0;
        for f in ["lib.rs", "look.rs", "act.rs", "plan.rs", "help.rs", "open.rs", "folder.rs", "companion.rs", "filework.rs", "input.rs", "macos.rs", "front.rs", "jobs.rs", "fileops.rs"] {
            let code = code_of(f);
            let here = code.matches("WorkspaceOpener::new(").count();
            if here > 0 {
                assert!(f == "plan.rs" || f == "macos.rs", "{f} builds a WorkspaceOpener");
            }
            n += here;
        }
        assert_eq!(n, 2);
        assert!(code_of("plan.rs").contains("pub fn run_open("));
    }

    #[test]
    fn words_for_the_doing_card() {
        let app = Resolved::App(AppFound { path: "/Applications/Figma.app".into(), name: "Figma".into(), bundle_id: None, where_: "Applications" });
        assert_eq!(open_note(OpenTarget::App, &app), "Opening Figma…");
        assert_eq!(open_note(OpenTarget::Url, &Resolved::Url("https://www.figma.com/files".into())), "Opening figma.com…");
        assert_eq!(open_note(OpenTarget::Reveal, &Resolved::File { path: "/x/a.pdf".into(), name: "a.pdf".into() }), "Showing a.pdf in Finder…");
        assert_eq!(progress_words("refused"), "macOS wouldn't open it");
        // A failed open shows Boredroom's own sentence (its `/progress` answer's `summary`), else this Mac's words.
        assert_eq!(progress_failed_words(&json!({ "status": "failed", "planDone": false, "summary": "Couldn't: macOS wouldn't open it" }), "refused"), "Couldn't: macOS wouldn't open it");
        assert_eq!(progress_failed_words(&json!({ "message": "That task has ended." }), "gone"), "That task has ended.");
        assert_eq!(progress_failed_words(&json!({ "status": "failed", "summary": " " }), "gone"), "Couldn't: the thing to open was gone.");
        assert_eq!(progress_body(0, Err("stopped")), json!({ "version": 1, "i": 0, "ok": false, "error": "failed" }));
        assert_eq!(plan_done(&json!({ "planDone": true, "summary": "Opened Figma." })), (true, Some("Opened Figma.".into())));
    }

    fn seam_dir() -> Option<String> {
        std::env::var("BRENDA_SEAM_DIR").ok().filter(|d| !d.is_empty())
    }

    /// The plan bodies Rust sends, exactly as it writes them, for the server's own schemas (the integrator's contract
    /// check). By hand only: `BRENDA_SEAM_DIR=<dir> cargo test --lib -- --ignored seam_`.
    #[test]
    #[ignore]
    fn seam_plan_bodies() {
        let Some(dir) = seam_dir() else { return };
        let wv = |name: &str, v: &Value| std::fs::write(format!("{dir}/rust-{name}.json"), serde_json::to_vec(v).unwrap()).unwrap();
        let home = scratch("seam");
        std::fs::create_dir_all(home.join("Applications/Figma.app")).unwrap();
        std::fs::create_dir_all(home.join("Documents")).unwrap();
        std::fs::create_dir_all(home.join("Downloads")).unwrap();
        for n in ["Plan.docx", "Notes.txt", "Q3.pdf"] {
            file(&home.join("Documents"), n, 1_000, 1);
        }
        file(&home.join("Downloads"), "Invoice 1042.pdf", 2_000, 3);
        let probe = guard::tests::FakeProbe { home: Some(home.clone()), quarantine: vec![], exec: vec![] };
        let bundle = |_p: &Path| Some("com.figma.Desktop".to_string());
        let cx = cx_for(&home, &[], &probe, &bundle);
        let find = StepView::Open { i: 1, target: OpenTarget::File, name: String::new(), url: String::new(), folder: FolderRef { source: "none".into(), name: String::new() }, words: vec!["invoice".into()], kinds: vec![], since_days: 0 };
        let fold = StepView::Open { i: 2, target: OpenTarget::Folder, name: String::new(), url: String::new(), folder: FolderRef { source: "named".into(), name: "downloads".into() }, words: vec![], kinds: vec![], since_days: 0 };
        wv("scope-app", &scope(&view(vec![open_app(0, "Figma")], None), &cx).1);
        wv("scope-files", &scope(&view(vec![folder_job(0)], None), &cx).1);
        wv("scope-file", &scope(&view(vec![open_app(0, "Figma"), find], None), &cx).1);
        wv("scope-folder", &scope(&view(vec![open_app(0, "Figma"), StepView::Screen { i: 1, goal: "Make a new design file.".into() }, fold], None), &cx).1);
        wv("scope-unresolved", &scope(&view(vec![open_app(0, "Sketch")], None), &cx).1);
        wv("progress-ok", &progress_body(0, Ok(())));
        wv("progress-gone", &progress_body(0, Err("gone")));
        wv("progress-refused", &progress_body(0, Err("refused")));
        wv("progress-failed", &progress_body(0, Err("failed")));
        wv("run", &run_body(1));
        let text = filework::Payload::Text { text: "Plan, in words.".into(), pages: Some(1) };
        wv("folder-text", &json!({ "version": 1, "i": 0, "n": 0, "file": folder::FolderFileJson { name: "Plan.docx", bytes: 1_000, payload: &text, truncated: false } }));
        wv("folder-text-truncated", &json!({ "version": 1, "i": 0, "n": 1, "file": folder::FolderFileJson { name: "Notes.txt", bytes: 1_000, payload: &text, truncated: true } }));
        let pdf = filework::Payload::Pdf { data: b"%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n".to_vec() };
        wv("folder-pdf", &json!({ "version": 1, "i": 0, "n": 2, "file": folder::FolderFileJson { name: "Q3.pdf", bytes: 1_000, payload: &pdf, truncated: false } }));
        wv("folder-finish", &finish_body(0, &[folder::Section { title: "Plan.docx".into(), markdown: "A plan.".into() }, folder::Section { title: "Q3.pdf".into(), markdown: "The third quarter.".into() }], &[folder::Skipped { name: "Notes.txt".into(), why: "unreadable" }]));
        let _ = std::fs::remove_dir_all(&home);
    }

    /// The server's real plan answers (written by tests/integration/act-plan.test.ts with ACT_SEAM_DIR) through Rust's
    /// own readers.
    #[test]
    #[ignore]
    fn seam_server_plan_answers() {
        let Some(dir) = seam_dir() else { return };
        let read = |name: &str| serde_json::from_slice::<Value>(&std::fs::read(format!("{dir}/{name}")).unwrap()).unwrap();
        let line = read("server-propose-plan.json");
        let task = line.get("task").cloned().unwrap_or(line.clone());
        let proposed: TaskViewV2 = serde_json::from_value(task).expect("propose plan");
        assert!(view_ok_v2(&proposed));
        let ready = read("server-scope-ready.json");
        assert_eq!(ready["status"], "ready");
        let t: TaskViewV2 = serde_json::from_value(ready["task"].clone()).expect("ready task");
        assert!(view_ok_v2(&t) && !t.needs_scope, "the hash over the sentence and the lines holds");
        let un = read("server-scope-unresolved.json");
        assert_eq!(un["status"], "unresolved");
        assert!(un["message"].as_str().is_some_and(|m| !m.is_empty()));
        let done = read("server-run-done.json");
        assert_eq!(done["status"], "done");
        let _ = plan_done(&done);
        let ask = read("server-run-ask.json");
        assert_eq!(ask["status"], "ask");
        assert!(ask["ask"]["what"].as_str().is_some() && ask["ask"]["kind"].as_str().is_some());
        let ok = read("server-folder-ok.json");
        let s: folder::Section = serde_json::from_value(ok["section"].clone()).expect("section");
        assert!(!s.markdown.is_empty());
        let fin = read("server-folder-finish.json");
        let (done, summary) = plan_done(&fin);
        assert!(done && summary.is_some());
    }
}
