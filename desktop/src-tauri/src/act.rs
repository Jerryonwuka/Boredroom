//! Doing things only when asked (owner rule, 12 October 2026, verbatim from his voice note: "Brenda cannot take any
//! action except I explicitly give an instruction. So Brenda cannot just be doing things in the background on its own.
//! Except I explicitly say Brenda, I need you to do this. And then if it's a core task, Brenda should confirm, oh, do
//! you want me to do this? And then I'll say, yes, I need you to do this. To just ensure that it's clarity before any
//! instruction is carried out."; companion-spec section 0, B.6–B.9).
//!
//! The task state machine on the Mac. Rust is the gate for physical origin; the server for the record and the binding.
//! - A task can only come from a `propose` line in the stream of a look the person started with their own keys or
//!   typed with their own press (`look.rs`). There is no other way in: no timer, event, notification or server message
//!   starts a proposal, a step or a file job, and the generic `api` command refuses these routes.
//! - A proposal is held for 60 seconds. Only an explicit yes starts it: a real press on Yes (an island click in the last
//!   1.5 s, and no event of Brenda's own in the last 1.5 s), or words that pass the yes grammar (`yes.rs`), spoken while
//!   holding her keys (Rust's own transcript) or typed with a real press. Silence, a timeout, Esc or anything unclear is
//!   no. A long no or unclear answer becomes a NEW request, which can only bring a new proposal (which needs its own yes).
//! - The yes is recorded with the server (`/answer`, with the SHA-256 of the plan the person saw) before anything runs.
//! - A screen task's steps come from the server one turn at a time (`/step`); `input.rs` runs only those actions, checks
//!   every one, and refuses an outward step (send, delete, pay…) unless the person said yes to that step too (`ask`,
//!   `/step-answer`), and that yes covers only a step of the kind they heard. The person moving the pointer, typing or
//!   switching apps pauses her; Esc, her keys, Option+Space, Stop, the tray, a lock, sign-out, quitting, a Boredroom call
//!   or a suspected share stop her at once.
//! - A file job stops the same way: Esc, her keys, Option+Space, Stop or the tray (rule f, review 12 October 2026). While
//!   one runs, Esc and her keys are Brenda's, so a look waits until it is done or stopped.
//! - "Act without asking" never applies here: nothing in this file reads any mode.
//! - A file job reads only the file the person said yes to and saves a new file next to it (`filework.rs`).
//! - Pictures, steps and file contents are kept only while the task runs, in memory, and wiped when it ends.
//! - Plans (owner report and requests, 12 October 2026: "Brenda is meant to assist you do anything you need it to do";
//!   companion2-spec D): a `propose` line may carry a plan of up to six steps (open things, a folder or file job, one
//!   screen part, Boredroom changes) under ONE sentence and ONE yes. `plan.rs` looks up what it will touch first
//!   (`scoping`), the person is asked only once Boredroom has written the lines and the hash over the sentence and the
//!   lines holds, and the steps then run in order here (`run_plan`), Stop checked before each; a Boredroom change that
//!   reaches anyone else asks again. The rule is unchanged: nothing starts without the person's own words and yes.
//! - The Mac operator (owner brief, 12 October 2026: "Mac operator (computer use, last resort …)"; helpers-spec I): a job
//!   the router started from the person's recorded request (`jobs.rs`) runs here as a screen task of kind `operator`,
//!   straight to Running (the request is the go-ahead; "Check with me" asked before the job was made), on phase 2's step
//!   loop. Every Send, Pay, Delete or Submit still asks. A lock, sleep, a Boredroom call or a suspected share PAUSE it
//!   (Carry on resumes; 10 minutes paused stops it); Esc, her keys and Stop stop it.
//! - The own-window fix (helpers-spec L.1): the front goes back to the person's app with `capture::hand_back`
//!   (synchronous, checked) instead of `activate` and a fixed sleep; Brenda in front pauses an action instead of
//!   refusing it (`input.rs`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};

use crate::capture::{self, Exclude};
use crate::companion::{self, ActView};
use crate::filework::{self, Candidate, Format};
use crate::input::{self, ApprovedAction, AppInfo, ExecState, Flow, ImageJson, ShotGeom, StepResult, Why};
use crate::look::{self, wipe, Bounds, WipeOnDrop};
use crate::plan::{self, PlanEnd, Resolved, StepDone, TaskViewV2};
use crate::yes::{self, Verdict};
use crate::{ax, folder, guard, ApiError, AppState};

/// How long a proposal (or a step question, or a pause) waits for the person.
pub const ANSWER_WAIT_MS: u64 = 60_000;
/// A press must be this recent, and no event of Brenda's own this recent (B.6.3).
pub const PRESS_WINDOW_S: f64 = 1.5;
/// A screen task stops after this long from the yes (B.7.1).
pub const TASK_WALL: Duration = Duration::from_secs(600);
/// A step request that would pass this many bytes stops the task (`too_big`, 0b.8).
pub const STEP_BODY_MAX: usize = 3_900_000;
pub const FILE_BODY_MAX: usize = 4_000_000;
const STEP_TIMEOUT: Duration = Duration::from_secs(180);
const SMALL_TIMEOUT: Duration = Duration::from_secs(20);
/// The words of an answer, at most.
pub const ANSWER_TEXT_MAX: usize = 200;

// ---- the task as the server describes it (B.6.1) ---------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct FileRef {
    pub source: filework::Source,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OutputRef {
    pub format: Format,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub id: String,
    pub kind: String,
    pub plan: String,
    pub question: String,
    pub plan_sha256: String,
    #[serde(default)]
    pub answer_by: Option<String>,
    #[serde(default)]
    pub risky: bool,
    #[serde(default)]
    pub step_cap: Option<u32>,
    #[serde(default)]
    pub file: Option<FileRef>,
    #[serde(default)]
    pub output: Option<OutputRef>,
}

impl TaskView {
    /// A screen task: phase 2's, or the Mac operator's (a job, helpers-spec I).
    pub fn screen(&self) -> bool {
        self.kind == "screen" || self.kind == "operator"
    }
}

pub fn sha256_hex(s: &str) -> String {
    use sha2::Digest;
    sha2::Sha256::digest(s.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// The plan the person will see is the plan the server recorded (B.6.2): its SHA-256 matches.
pub fn plan_ok(t: &TaskView) -> bool {
    sha256_hex(&t.plan) == t.plan_sha256.to_ascii_lowercase()
}

/// A task id as the routes take it (a UUID): nothing else goes into a path.
pub fn id_ok(id: &str) -> bool {
    id.len() == 36 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// A TaskView fit to show: an id, kind screen or file, a plan of one line (12–200 characters, starting "I'll"), its
/// hash, and for a file job its file and output.
pub fn view_ok(t: &TaskView) -> bool {
    let n = t.plan.chars().count();
    id_ok(&t.id)
        && (t.kind == "screen" || (t.kind == "file" && t.file.is_some() && t.output.is_some()))
        && (12..=200).contains(&n)
        && t.plan.starts_with("I'll ")
        && !t.plan.contains(['\n', '\r'])
}

// ---- phases and roles (pure) -----------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    /// A plan's things are being looked up before it is asked about (companion2-spec D.3).
    Scoping,
    Asking,
    Confirming,
    Running,
    StepAsk,
    Paused,
    Working,
}

/// Esc is Brenda's while a question waits or a task runs, a file job included (rule f: "Stop is always instant: Esc,
/// holding her keys again, or saying stop"; review, 12 October 2026, which reverses the earlier "a file job leaves Esc to
/// the person"). The consent for file work says so.
pub fn esc_wanted(p: Option<Phase>) -> bool {
    matches!(p, Some(Phase::Scoping | Phase::Asking | Phase::Confirming | Phase::Running | Phase::StepAsk | Phase::Paused | Phase::Working))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Target {
    Task(String),
    Confirm(String),
    /// The front desk's ask card or chooser (helpers-spec A.2, A.9), by the request's nonce.
    Front(String),
    /// A job's ask ("Move 41 screenshots to the Trash?", G.4), by the job's id.
    Job(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Role {
    /// An ordinary look (or, for Option+Space, ordinary talk).
    Free,
    /// The words are the answer to a question; no picture.
    Answer(Target),
    /// A screen task is under way: this press stops it.
    Stop,
}

/// What a hold of her keys (B.2) or Option+Space (B.10) means now.
pub fn role(phase: Option<Phase>, _screen: bool, task_id: Option<&str>, confirm: Option<&str>) -> Role {
    match phase {
        Some(Phase::Asking | Phase::StepAsk) => Role::Answer(Target::Task(task_id.unwrap_or_default().to_string())),
        // Rule f: her keys (and Option+Space) stop any task under way, a file job included (review, 12 October 2026).
        Some(Phase::Running | Phase::Paused | Phase::Working) => Role::Stop,
        Some(Phase::Confirming | Phase::Scoping) => Role::Stop,
        _ => match confirm {
            Some(id) => Role::Answer(Target::Confirm(id.to_string())),
            None => Role::Free,
        },
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Via {
    Button,
    Voice,
    Typed,
    Esc,
    Timeout,
    Unresolved,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Decision {
    Yes,
    No(Verdict),
    /// Long words that were not a yes: a new request (its own proposal, its own yes).
    NewRequest(String, Verdict),
    /// A "yes" that did not come from a real press.
    NotAPress,
}

/// A press counts when it is real and no event of Brenda's own came in the last 1.5 s.
pub fn press_ok(real_press: bool, since_post_s: Option<f64>) -> bool {
    real_press && since_post_s.is_none_or(|s| s > PRESS_WINDOW_S)
}

/// The answer (B.6.3): a button yes needs a real press; typed words need a real press and the grammar; spoken words the
/// grammar on Rust's own transcript; Esc, a timeout or an unresolved file are no.
pub fn decide(answer: &str, via: Via, text: Option<&str>, name: &str, real_press: bool, since_post_s: Option<f64>) -> Decision {
    match via {
        Via::Esc | Via::Timeout | Via::Unresolved => Decision::No(Verdict::No),
        Via::Button => {
            if answer != "yes" {
                Decision::No(Verdict::No)
            } else if press_ok(real_press, since_post_s) {
                Decision::Yes
            } else {
                Decision::NotAPress
            }
        }
        Via::Typed | Via::Voice => {
            let words = text.unwrap_or("").trim();
            if via == Via::Typed && !press_ok(real_press, since_post_s) {
                return Decision::NotAPress;
            }
            let v = yes::verdict(words, name);
            if v == Verdict::Yes && answer == "yes" {
                return Decision::Yes;
            }
            let v = if v == Verdict::Yes { Verdict::Unclear } else { v };
            if yes::is_new_request(words, name) {
                Decision::NewRequest(words.chars().take(4_000).collect(), v)
            } else {
                Decision::No(v)
            }
        }
    }
}

/// Sixty seconds with no answer is no (B.6.2).
pub fn expired(shown_ms: u64, now_ms: u64) -> bool {
    now_ms.saturating_sub(shown_ms) >= ANSWER_WAIT_MS
}

/// The words under a step question, by kind (A.7.3).
pub fn because(kind: &str) -> &'static str {
    match kind {
        "send" => "this sends something",
        "submit" => "this submits a form",
        "delete" => "this deletes something",
        "pay" => "this pays for something",
        "share" => "this shares something",
        "publish" => "this publishes something",
        "sign_in" => "this signs in",
        "accept_terms" => "this accepts terms",
        "overwrite" => "this replaces a file",
        "quit" => "this quits an app",
        _ => "this can't be undone",
    }
}

// ---- events (B.11) ---------------------------------------------------------------------------------------------------

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct StepAsk {
    /// The plan's step this asks about (a Boredroom change in a plan).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub i: Option<u32>,
    pub kind: String,
    pub what: String,
    pub question: String,
    pub because: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct OutputShown {
    pub name: String,
    pub folder: String,
}

/// A plan's step in "Part {k} of {n}".
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Part {
    pub k: u32,
    pub of: u32,
    pub kind: &'static str,
}

/// A folder job's progress ("Reading {k} of {n}").
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct FolderProgress {
    pub name: String,
    pub done: u32,
    pub of: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(tag = "phase", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ActEvent {
    /// A plan's things are being looked up (companion2-spec I.2): its sentence, no buttons yet. `task` is the plan as
    /// Boredroom proposed it (its steps; no paths), so the page can say "Nothing was opened." if an open-only plan can't
    /// be got ready (M.7; integration, 12 October 2026).
    Scoping {
        task_id: String,
        plan: String,
        task: Value,
    },
    Asking {
        /// Phase 2's TaskView, or a plan's (v 2, with its steps and lines).
        task: Value,
        /// The names a folder step will read, for "Show the 14" (the page only).
        #[serde(skip_serializing_if = "Option::is_none")]
        local: Option<Value>,
    },
    Heard {
        #[serde(skip_serializing_if = "Option::is_none")]
        task_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        for_confirm: Option<String>,
        text: String,
        verdict: Verdict,
    },
    Confirming {
        task_id: String,
    },
    Running {
        task_id: String,
        step: u32,
        note: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        part: Option<Part>,
    },
    StepAsk {
        task_id: String,
        ask: StepAsk,
    },
    Paused {
        task_id: String,
        why: Why,
    },
    Working {
        task_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        file: Option<FileRef>,
        output: Option<OutputRef>,
        started_at: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        folder: Option<FolderProgress>,
    },
    Done {
        task_id: String,
        kind: String,
        summary: String,
        steps: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<OutputShown>,
        #[serde(skip_serializing_if = "Option::is_none")]
        doc: Option<Value>,
        /// A plan's new files.
        #[serde(skip_serializing_if = "Option::is_none")]
        outputs: Option<Vec<OutputShown>>,
        /// Files a folder job could not read.
        #[serde(skip_serializing_if = "Option::is_none")]
        skipped: Option<u32>,
    },
    /// Boredroom found nothing to do for a plan's step (its words), and ended it.
    Unresolved {
        task_id: String,
        message: String,
        settings: Option<String>,
    },
    Stopped {
        task_id: String,
        why: String,
        step: u32,
        note: Option<String>,
        /// The model's `cannot_continue` reason (why "cannot").
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    SaidNo {
        task_id: String,
        verdict: Verdict,
        /// The words became a new request (a new proposal follows if one is made).
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        new_request: bool,
    },
    Expired {
        task_id: String,
    },
    Failed {
        task_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        message: String,
    },
    Refused {
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        app: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        n: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pages: Option<usize>,
    },
    Status(ActStatus),
}

fn emit(app: &AppHandle, e: ActEvent) {
    let _ = app.emit("brenda://act", e);
}

fn refused(app: &AppHandle, reason: &str) {
    emit(app, ActEvent::Refused { reason: reason.into(), app: None, n: None, pages: None });
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskBrief {
    pub id: String,
    pub kind: String,
    pub phase: Phase,
    pub plan: String,
    pub step: u32,
    pub started_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ActStatus {
    pub supported: bool,
    pub available: bool,
    pub use_mac: bool,
    pub use_mac_at: Option<u64>,
    pub file_work: bool,
    pub file_work_at: Option<u64>,
    pub accessibility: &'static str,
    pub finder: String,
    pub esc_registered: bool,
    pub task: Option<TaskBrief>,
    /// What macOS said when setup asked for each folder (companion2-spec A.1): granted, denied or unknown.
    pub folders: Folders,
    /// This Rust takes plans: 1.
    pub plans: u8,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Folders {
    pub documents: String,
    pub desktop: String,
    pub downloads: String,
}

impl Folders {
    pub fn of(c: Option<&crate::FolderAnswers>) -> Folders {
        let g = |v: Option<&String>| v.filter(|s| s.as_str() == "granted" || s.as_str() == "denied").cloned().unwrap_or_else(|| "unknown".into());
        Folders { documents: g(c.and_then(|c| c.documents.as_ref())), desktop: g(c.and_then(|c| c.desktop.as_ref())), downloads: g(c.and_then(|c| c.downloads.as_ref())) }
    }
}

// ---- state -----------------------------------------------------------------------------------------------------------

/// Where a proposal came from: the look's display, the files it could mean, the app that was in front.
#[derive(Clone, Debug, Default)]
pub struct Origin {
    pub display: Option<(u32, Bounds)>,
    pub candidates: Vec<Candidate>,
    pub front_pid: Option<i32>,
}

/// A plan's own state while it is live: what Boredroom sent (after scope, with its lines) and what Brenda for Mac found
/// for each step (paths stay here).
struct PlanLive {
    view: TaskViewV2,
    resolved: Vec<Resolved>,
}

struct Live {
    view: TaskView,
    plan: Option<PlanLive>,
    phase: Phase,
    gen: u64,
    shown: Instant,
    origin: Origin,
    file: Option<Candidate>,
    step: u32,
    started_at: Option<u64>,
    note: Option<String>,
    ask: Option<StepAsk>,
    stop_why: Option<String>,
}

/// What the person said to a step question or a pause.
#[derive(Clone, Debug)]
enum Signal {
    Yes(Via, Option<String>),
    No(Via, Option<String>),
    Continue,
}

#[derive(Default)]
pub struct Act {
    live: Mutex<Option<Live>>,
    gens: AtomicU64,
    stop: Arc<AtomicBool>,
    signal: Mutex<Option<Signal>>,
    wake: Condvar,
    confirm: Mutex<Option<String>>,
    esc_registered: AtomicBool,
    esc_failed: AtomicBool,
    /// The last file job's output, for Show in Finder and Open (Rust holds the path).
    output: Mutex<Option<(String, PathBuf)>>,
    /// A lock, sleep, call or share asked the Mac operator to pause (G.6); taken by its step loop.
    pause: Mutex<Option<Why>>,
}

fn act(app: &AppHandle) -> tauri::State<'_, Act> {
    app.state::<Act>()
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn phase(app: &AppHandle) -> Option<Phase> {
    app.try_state::<Act>().and_then(|a| a.live.lock().unwrap().as_ref().map(|l| l.phase))
}

/// What a hold of her keys means now (B.2's first step, before any look check).
pub fn hold_role(app: &AppHandle) -> Role {
    // A front desk question or a job's question waits: the hold is the answer (helpers-spec A.9).
    if let Some(n) = crate::front::waiting(app) {
        return Role::Answer(Target::Front(n));
    }
    if let Some(id) = crate::jobs::waiting(app) {
        return Role::Answer(Target::Job(id));
    }
    let Some(a) = app.try_state::<Act>() else { return Role::Free };
    let confirm = a.confirm.lock().unwrap().clone();
    let l = a.live.lock().unwrap();
    role(l.as_ref().map(|l| l.phase), l.as_ref().is_some_and(|l| l.view.screen()), l.as_ref().map(|l| l.view.id.as_str()), confirm.as_deref())
}

/// A file job is running (`abilities.busy`).
pub fn busy_file(app: &AppHandle) -> bool {
    phase(app) == Some(Phase::Working)
}

/// A question or a task is live: a new typed request waits ("Answer this one first.").
pub fn question_waiting(app: &AppHandle) -> bool {
    matches!(phase(app), Some(Phase::Asking | Phase::StepAsk))
}

fn config<R>(app: &AppHandle, f: impl FnOnce(&crate::Config) -> R) -> R {
    let st = app.state::<AppState>();
    let c = st.config.lock().unwrap();
    f(&c)
}

fn assistant_name(app: &AppHandle) -> String {
    companion::name(app)
}

pub fn accessibility_label(trusted: bool, can_post: bool, asked: bool) -> &'static str {
    if trusted && can_post {
        "granted"
    } else if asked {
        "denied"
    } else {
        "unknown"
    }
}

fn can_post_events() -> bool {
    #[cfg(target_os = "macos")]
    {
        objc2_core_graphics::CGPreflightPostEventAccess()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

pub fn status(app: &AppHandle) -> ActStatus {
    let (use_mac, use_mac_at, file_work, file_work_at, asked, finder, folders) = config(app, |c| (c.use_mac, c.use_mac_at, c.file_work, c.file_work_at, c.accessibility_asked, c.finder_answer.clone(), Folders::of(c.folders.as_ref())));
    let task = app.try_state::<Act>().and_then(|a| {
        a.live.lock().unwrap().as_ref().map(|l| TaskBrief { id: l.view.id.clone(), kind: l.view.kind.clone(), phase: l.phase, plan: l.view.plan.clone(), step: l.step, started_at: l.started_at })
    });
    ActStatus {
        supported: capture::supported(),
        available: look::act_available(app),
        use_mac,
        use_mac_at,
        file_work,
        file_work_at,
        accessibility: accessibility_label(ax::trusted(), can_post_events(), asked),
        finder: finder.unwrap_or_else(|| "unknown".into()),
        esc_registered: app.try_state::<Act>().is_some_and(|a| a.esc_registered.load(Ordering::SeqCst)),
        task,
        folders,
        plans: 1,
    }
}

/// Clicking and typing are allowed: Accessibility granted and events can be posted.
pub fn can_click_and_type() -> bool {
    ax::trusted() && can_post_events()
}

fn emit_status(app: &AppHandle) {
    emit(app, ActEvent::Status(status(app)));
    crate::refresh_tray(app);
}

// ---- Esc -------------------------------------------------------------------------------------------------------------

pub fn esc_shortcut() -> tauri_plugin_global_shortcut::Shortcut {
    tauri_plugin_global_shortcut::Shortcut::new(None, tauri_plugin_global_shortcut::Code::Escape)
}

/// Registers Esc while it is Brenda's (`esc_wanted`) and unregisters it the moment it is not, off the caller's thread
/// (the shortcut plugin dispatches to the main thread).
pub(crate) fn sync_esc(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let a = act(&app);
        // Esc is Brenda's too while a front desk question or a job's question waits (helpers-spec C.1, G.4), never just
        // because a Files job runs (it stays the person's, 0.4).
        let want = esc_wanted(phase(&app)) || crate::front::waiting(&app).is_some() || crate::jobs::waiting(&app).is_some();
        let have = a.esc_registered.load(Ordering::SeqCst);
        if want && !have {
            let ok = app.global_shortcut().register(esc_shortcut()).is_ok();
            a.esc_registered.store(ok, Ordering::SeqCst);
            a.esc_failed.store(!ok, Ordering::SeqCst);
            // The page says "Esc stops me" only once Esc is really hers (review, 12 October 2026).
            emit(&app, ActEvent::Status(status(&app)));
        } else if !want && have {
            let _ = app.global_shortcut().unregister(esc_shortcut());
            a.esc_registered.store(false, Ordering::SeqCst);
        }
    });
}

/// Esc (registered only while wanted): no to a question; stop to a running task.
pub fn esc(app: &AppHandle) {
    if crate::front::esc(app) || crate::jobs::esc(app) {
        return sync_esc(app);
    }
    match phase(app) {
        Some(Phase::Asking) => {
            if let Some(id) = live_id(app) {
                answer(app, &id, Decision::No(Verdict::No), Via::Esc, None);
            }
        }
        Some(Phase::StepAsk) => signal(app, Signal::No(Via::Esc, None)),
        Some(Phase::Scoping | Phase::Confirming | Phase::Running | Phase::Paused | Phase::Working) => stop(app, "esc"),
        _ => sync_esc(app),
    }
}

fn live_id(app: &AppHandle) -> Option<String> {
    act(app).live.lock().unwrap().as_ref().map(|l| l.view.id.clone())
}

fn signal(app: &AppHandle, s: Signal) {
    let a = act(app);
    *a.signal.lock().unwrap() = Some(s);
    a.wake.notify_all();
}

// ---- the server ------------------------------------------------------------------------------------------------------

fn act_path(app: &AppHandle, id: &str, tail: &str) -> Result<(String, String), ApiError> {
    if !id_ok(id) {
        return Err(ApiError::new(400, "That task is gone."));
    }
    let (base, token, slug) = config(app, |c| (crate::base_url(c), c.token.clone(), c.workspace_slug.clone()));
    let (Some(token), Some(slug)) = (token, slug) else { return Err(ApiError::new(401, "Not signed in.")) };
    Ok((format!("{base}/api/orgs/{slug}/assistant/act/{id}/{tail}"), token))
}

/// Posts to an act route, given up when `cancel` is set (the request is dropped: nothing more is sent or read).
fn post(app: &AppHandle, id: &str, tail: &str, body: WipeOnDrop, timeout: Duration, step: Option<u32>, cancel: Option<Arc<AtomicBool>>) -> Result<Value, ApiError> {
    let (url, token) = act_path(app, id, tail)?;
    let http = app.state::<AppState>().http.clone();
    tauri::async_runtime::block_on(async move {
        let mut req = http
            .post(url)
            .bearer_auth(token)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("user-agent", crate::user_agent())
            .timeout(timeout)
            .body(bytes::Bytes::from_owner(body));
        if let Some(n) = step {
            req = req.header("x-brenda-task-step", n.to_string());
        }
        let send = async move {
            let res = req.send().await.map_err(|e| ApiError::new(0, format!("Cannot reach Boredroom: {}", e.without_url())))?;
            let status = res.status().as_u16();
            let value: Value = res.json().await.unwrap_or(Value::Null);
            if status >= 400 {
                let message = value.get("message").and_then(|m| m.as_str()).unwrap_or("Request failed.").to_string();
                let code = value.get("code").and_then(|c| c.as_str()).map(String::from);
                return Err(ApiError { status, message, code });
            }
            Ok(value)
        };
        match cancel {
            None => send.await,
            Some(flag) => {
                let watch = async move {
                    while !flag.load(Ordering::SeqCst) {
                        tokio::time::sleep(Duration::from_millis(50)).await;
                    }
                };
                futures_util::pin_mut!(send);
                futures_util::pin_mut!(watch);
                match futures_util::future::select(send, watch).await {
                    futures_util::future::Either::Left((r, _)) => r,
                    futures_util::future::Either::Right(_) => Err(ApiError { status: 0, message: "Stopped.".into(), code: Some("STOPPED".into()) }),
                }
            }
        }
    })
}

fn json_body(v: &Value) -> WipeOnDrop {
    WipeOnDrop(serde_json::to_vec(v).unwrap_or_default())
}

/// The `/answer` body (D.7.2): the plan's SHA-256 binds the answer to the sentence shown; the words go only for an answer
/// said or typed (at most 200 UTF-16 units, as the server counts), so the server can check them against the grammar again.
pub fn answer_body(answer: &str, via: Via, plan_sha256: &str, text: Option<&str>) -> Value {
    let mut b = json!({ "version": 1, "answer": answer, "via": via, "planSha256": plan_sha256 });
    if let Some(t) = text {
        b["text"] = json!(look::clip_utf16(t, ANSWER_TEXT_MAX));
    }
    b
}

/// The `/step-answer` body (D.7.4): bound to the step asked by the SHA-256 of its words.
pub fn step_answer_body(yes: bool, via: Via, what: &str, text: Option<&str>) -> Value {
    let mut b = json!({ "version": 1, "answer": if yes { "yes" } else { "no" }, "via": via, "askSha256": sha256_hex(what) });
    if let Some(t) = text {
        b["text"] = json!(look::clip_utf16(t, ANSWER_TEXT_MAX));
    }
    b
}

/// The `/stop` body (D.7.5): why, one word.
pub fn stop_body(why: &str) -> Value {
    json!({ "version": 1, "why": why })
}

// ---- proposals and answers -------------------------------------------------------------------------------------------

/// A `propose` line from a look's stream (B.6.2): the only way a task begins. A plan (`kind: "plan"`, v 2) is looked up
/// first (`receive_plan`); a phase 2 task is asked about at once.
pub fn asking(app: &AppHandle, task: Value, origin: Origin) {
    if task.get("kind").and_then(|k| k.as_str()) == Some("plan") {
        return receive_plan(app, task, origin);
    }
    let Ok(view) = serde_json::from_value::<TaskView>(task) else { return };
    if !id_ok(&view.id) {
        return;
    }
    let no = |reason: Option<&str>, message: Option<&str>| refuse_proposal(app, &view, reason, message);
    if !view_ok(&view) || !plan_ok(&view) {
        return no(None, Some(NOT_WHOLE));
    }
    if act(app).live.lock().unwrap().is_some() {
        return no(Some("busy_task"), None);
    }
    let (use_mac, file_work) = config(app, |c| (c.use_mac, c.file_work));
    let mut file = None;
    if view.screen() {
        if !use_mac {
            return no(Some("use_mac_off"), None);
        }
        if !can_click_and_type() {
            return no(Some("accessibility"), None);
        }
    } else {
        if !file_work {
            return no(Some("files_off"), None);
        }
        let f = view.file.as_ref().expect("checked");
        let Some(c) = filework::sources_match(&origin.candidates, f.source, &f.name).cloned() else { return no(Some("file_unresolved"), None) };
        if c.bytes > filework::MAX_FILE_BYTES {
            return no(Some("file_too_big"), None);
        }
        if matches!(c.kind, filework::Kind::Other | filework::Kind::Folder) {
            return no(Some("file_type"), None);
        }
        file = Some(c);
    }
    let Some(gen) = begin_live(app, view.clone(), None, Phase::Asking, origin, file) else { return no(Some("busy_task"), None) };
    show_asking(app, gen, serde_json::to_value(&view).unwrap_or(Value::Null), None);
}

const NOT_WHOLE: &str = "That proposal didn't arrive whole, so I won't do it.";

/// A proposal that never becomes a task: the server hears no (unresolved, bound to the sentence it recorded) and the
/// page why.
fn refuse_proposal(app: &AppHandle, view: &TaskView, reason: Option<&str>, message: Option<&str>) {
    let body = json_body(&answer_body("no", Via::Unresolved, &view.plan_sha256, None));
    if post(app, &view.id, "answer", body, SMALL_TIMEOUT, None, None).is_err() {
        // A plan Boredroom refuses to hear no about before its scope still ends (a stop is idempotent).
        let _ = post(app, &view.id, "stop", json_body(&stop_body("failed")), SMALL_TIMEOUT, None, None);
    }
    if let Some(r) = reason {
        refused(app, r);
    }
    if let Some(m) = message {
        emit(app, ActEvent::Failed { task_id: view.id.clone(), code: None, message: m.into() });
    }
}

/// The one live task, from now: None when one is already live.
fn begin_live(app: &AppHandle, view: TaskView, plan: Option<PlanLive>, phase: Phase, origin: Origin, file: Option<Candidate>) -> Option<u64> {
    let a = act(app);
    let gen = a.gens.fetch_add(1, Ordering::SeqCst) + 1;
    {
        let mut l = a.live.lock().unwrap();
        if l.is_some() {
            return None;
        }
        *l = Some(Live { view, plan, phase, gen, shown: Instant::now(), origin, file, step: 0, started_at: None, note: None, ask: None, stop_why: None });
    }
    a.stop.store(false, Ordering::SeqCst);
    *a.signal.lock().unwrap() = None;
    look::hold_pictures(app, true);
    Some(gen)
}

/// The question, now (B.6.2): the card, the companion asking, Esc, and sixty seconds of silence is no.
fn show_asking(app: &AppHandle, gen: u64, task: Value, local: Option<Value>) {
    let mut plan_text = String::new();
    let mut id = String::new();
    if !set_live(app, gen, |l| {
        l.phase = Phase::Asking;
        l.shown = Instant::now();
        plan_text = l.view.plan.clone();
        id = l.view.id.clone();
    }) {
        return;
    }
    companion::set_act(app, Some(asking_view(app, &plan_text)), None);
    emit(app, ActEvent::Asking { task, local });
    sync_esc(app);
    emit_status(app);
    // Sixty seconds with no answer: no.
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(ANSWER_WAIT_MS));
        let still = act(&app2).live.lock().unwrap().as_ref().is_some_and(|l| l.gen == gen && l.phase == Phase::Asking && expired(0, l.shown.elapsed().as_millis() as u64));
        if still {
            answer(&app2, &id, Decision::No(Verdict::No), Via::Timeout, None);
        }
    });
}

/// A plan's `propose` line (companion2-spec I.4.2): checked, its abilities checked (belt and braces: Boredroom checked
/// them first), then looked up on the Mac (`plan::scope`, at most three seconds, read only), then `/scope`, then asked
/// about only once Boredroom's lines came back and the hash over the sentence and the lines holds.
fn receive_plan(app: &AppHandle, task: Value, origin: Origin) {
    let Ok(view) = serde_json::from_value::<TaskViewV2>(task) else { return };
    if !id_ok(&view.id) {
        return;
    }
    let brief = view.brief();
    let no = |reason: Option<&str>, message: Option<&str>| refuse_proposal(app, &brief, reason, message);
    if !plan::view_ok_v2(&view) {
        return no(None, Some(NOT_WHOLE));
    }
    if act(app).live.lock().unwrap().is_some() {
        return no(Some("busy_task"), None);
    }
    let (use_mac, file_work) = config(app, |c| (c.use_mac, c.file_work));
    if let Some(r) = plan::ability_gap(&view, use_mac, file_work, can_click_and_type()) {
        return no(Some(r), None);
    }
    let needs_scope = view.needs_scope;
    let id = view.id.clone();
    let candidates = origin.candidates.clone();
    let phase = if needs_scope { Phase::Scoping } else { Phase::Asking };
    let Some(gen) = begin_live(app, brief.clone(), Some(PlanLive { view: view.clone(), resolved: vec![] }), phase, origin, None) else { return no(Some("busy_task"), None) };
    if needs_scope {
        companion::set_act(app, Some(ActView { state: companion::State::Thinking, text: view.plan.clone(), sub: "Getting that ready…".into(), hint: String::new() }), None);
        emit(app, ActEvent::Scoping { task_id: id.clone(), plan: view.plan.clone(), task: serde_json::to_value(&view).unwrap_or(Value::Null) });
        sync_esc(app);
        emit_status(app);
    }
    // Looked up on the Mac, read only, for the person's own request.
    let home = filework::home().unwrap_or_else(|| PathBuf::from("/var/empty"));
    let rules = look::current_rules(app);
    let probe = crate::open::RealProbe;
    let spot = crate::open::Spotlight;
    let cx = plan::ScopeCtx {
        app_folders: guard::app_folders(Some(&home)),
        home,
        rules: &rules,
        candidates: &candidates,
        fs: &folder::RealFs,
        search: &spot,
        last_used: &spot,
        probe: &probe,
        bundle: &crate::open::bundle_id_of,
        now_unix: (now_unix_ms() / 1000) as i64,
        deadline: Instant::now() + plan::SCOPE_TIME,
    };
    let (resolved, body) = plan::scope(&view, &cx);
    if !set_live(app, gen, |_| {}) || act(app).stop.load(Ordering::SeqCst) {
        return; // stopped while looking: `stop` ends it
    }
    if let Some(r) = plan::local_gap(&view, &resolved) {
        let _ = post(app, &id, "answer", json_body(&answer_body("no", Via::Unresolved, &brief.plan_sha256, None)), SMALL_TIMEOUT, None, None);
        return end(app, gen, Ending::Refused { reason: r.into(), n: None, pages: None, post_stop: false });
    }
    let ready = if needs_scope {
        let Some(buf) = look::to_wiped_json(&body, plan::SCOPE_BODY_MAX) else { return end(app, gen, Ending::Failed { code: None, message: NOT_WHOLE.into(), post_stop: true }) };
        let stop_flag = act(app).stop.clone();
        let v = match post(app, &id, "scope", buf, SMALL_TIMEOUT, None, Some(stop_flag)) {
            Ok(v) => v,
            Err(e) if e.code.as_deref() == Some("STOPPED") => return,
            Err(e) => return end(app, gen, ending_of(e, 0)),
        };
        match v.get("status").and_then(|s| s.as_str()) {
            Some("ready") => match v.get("task").cloned().and_then(|t| serde_json::from_value::<TaskViewV2>(t).ok()) {
                Some(t) if plan::same_plan(&view, &t) && plan::view_ok_v2(&t) && !t.needs_scope => t,
                _ => return end(app, gen, Ending::Failed { code: None, message: NOT_WHOLE.into(), post_stop: true }),
            },
            Some("unresolved") => {
                let message = v.get("message").and_then(|m| m.as_str()).unwrap_or("I couldn't find that on this Mac.").to_string();
                let settings = v.get("settings").and_then(|s| s.as_str()).filter(|s| *s == "files").map(String::from);
                return end(app, gen, Ending::Unresolved { message, settings });
            }
            _ => return end(app, gen, Ending::Failed { code: None, message: "Boredroom's answer couldn't be read, so I won't do it.".into(), post_stop: true }),
        }
    } else {
        view
    };
    let local = plan::local_names(&resolved);
    let task = serde_json::to_value(&ready).unwrap_or(Value::Null);
    if !set_live(app, gen, |l| {
        l.view = ready.brief();
        l.plan = Some(PlanLive { view: ready, resolved });
    }) {
        return;
    }
    show_asking(app, gen, task, local);
}

fn asking_view(app: &AppHandle, plan: &str) -> ActView {
    let _ = app;
    ActView {
        state: companion::State::Asking,
        text: plan.into(),
        sub: "Do you want me to do this?".into(),
        hint: format!("Say yes or no while holding {}, or answer in the notch.", look::LOOK_KEYS.symbols),
    }
}

/// Records the person's answer with the server and starts (yes) or ends (no) the task.
fn answer(app: &AppHandle, id: &str, d: Decision, via: Via, text: Option<String>) {
    let a = act(app);
    let (view, gen) = {
        let mut l = a.live.lock().unwrap();
        let Some(live) = l.as_mut().filter(|l| l.view.id == id && l.phase == Phase::Asking) else { return };
        if d == Decision::Yes {
            live.phase = Phase::Confirming;
        }
        (live.view.clone(), live.gen)
    };
    let text: Option<String> = text.map(|t| t.chars().take(ANSWER_TEXT_MAX).collect());
    match d {
        Decision::Yes => {
            emit(app, ActEvent::Confirming { task_id: id.into() });
            let body = answer_body("yes", via, &view.plan_sha256, text.as_deref());
            match post(app, id, "answer", json_body(&body), SMALL_TIMEOUT, None, None) {
                Ok(_) => start(app, gen),
                Err(e) => {
                    let message = if e.status == 0 { "I couldn't reach Boredroom, so I didn't start.".to_string() } else { e.message.clone() };
                    // The task never starts here, so it is ended on the server too (a lost answer may have recorded the
                    // yes; a refused one may have left the proposal waiting): one live task per person must not stay
                    // blocked until the purge (integration, 12 October 2026). A stop is idempotent.
                    end(app, gen, Ending::Failed { code: e.code, message, post_stop: true });
                }
            }
        }
        Decision::No(verdict) | Decision::NewRequest(_, verdict) => {
            let body = answer_body("no", via, &view.plan_sha256, text.as_deref());
            // A long no is a new request (0.5): the held pictures are copied now, before the end below lets them go, and
            // the request goes only once the server has the no, or its proposal would find this one still live and be
            // refused as busy (one live task per person; integration, 12 October 2026).
            let follow = match &d {
                Decision::NewRequest(words, _) => Some((look::held_for_new_request(app), words.clone(), if via == Via::Voice { "voice" } else { "typed" })),
                _ => None,
            };
            let new_request = follow.is_some();
            let app2 = app.clone();
            let id2 = id.to_string();
            std::thread::spawn(move || {
                let _ = post(&app2, &id2, "answer", json_body(&body), SMALL_TIMEOUT, None, None);
                if let Some((capture, words, via)) = follow {
                    look::new_request(&app2, capture, words, via);
                }
            });
            if via == Via::Timeout {
                end(app, gen, Ending::Expired);
            } else {
                end(app, gen, Ending::SaidNo { verdict, new_request });
            }
        }
        Decision::NotAPress => {}
    }
}

/// Words heard while a question waited (a hold of her keys or Option+Space): the verdict, then the answer.
pub fn heard_answer(app: &AppHandle, target: Target, text: String) {
    let name = assistant_name(app);
    let verdict = yes::verdict(&text, &name);
    match target {
        Target::Front(nonce) => crate::front::heard_answer(app, &nonce, &text),
        Target::Job(id) => crate::jobs::heard_answer(app, &id, &text),
        Target::Confirm(id) => emit(app, ActEvent::Heard { task_id: None, for_confirm: Some(id), text, verdict }),
        Target::Task(id) => {
            emit(app, ActEvent::Heard { task_id: Some(id.clone()), for_confirm: None, text: text.clone(), verdict });
            let d = decide(if verdict == Verdict::Yes { "yes" } else { "no" }, Via::Voice, Some(&text), &name, false, None);
            match phase(app) {
                Some(Phase::Asking) => answer(app, &id, d, Via::Voice, Some(text)),
                Some(Phase::StepAsk) => match d {
                    Decision::Yes => signal(app, Signal::Yes(Via::Voice, Some(text))),
                    Decision::No(_) | Decision::NewRequest(..) => signal(app, Signal::No(Via::Voice, Some(text))),
                    Decision::NotAPress => {}
                },
                _ => {}
            }
        }
    }
}

// ---- starting and ending ---------------------------------------------------------------------------------------------

enum Ending {
    Done { summary: String, steps: u32, output: Option<OutputShown>, doc: Option<Value>, outputs: Option<Vec<OutputShown>>, skipped: Option<u32> },
    /// Boredroom found nothing for a plan's step and ended it (its words; `settings: "files"` offers System Settings).
    Unresolved { message: String, settings: Option<String> },
    Stopped { why: String, reason: Option<String>, post_stop: bool },
    SaidNo { verdict: Verdict, new_request: bool },
    Expired,
    Failed { code: Option<String>, message: String, post_stop: bool },
    Refused { reason: String, n: Option<u32>, pages: Option<usize>, post_stop: bool },
}

/// Ends the task of generation `gen` once (a second call does nothing): the server told when it was stopped here, Esc
/// let go, the pointer and the front app put back, the companion done or sad, everything held wiped.
fn end(app: &AppHandle, gen: u64, e: Ending) {
    let a = act(app);
    let live = {
        let mut l = a.live.lock().unwrap();
        if !l.as_ref().is_some_and(|l| l.gen == gen) {
            return;
        }
        l.take().unwrap()
    };
    a.stop.store(true, Ordering::SeqCst);
    a.wake.notify_all();
    let id = live.view.id.clone();
    let post_stop = match &e {
        Ending::Stopped { post_stop, .. } | Ending::Failed { post_stop, .. } | Ending::Refused { post_stop, .. } => *post_stop,
        _ => false,
    };
    if post_stop {
        let why = match &e {
            Ending::Stopped { why, .. } => why.clone(),
            Ending::Refused { reason, .. } => reason.clone(),
            // A file job whose save failed after the server recorded it done (review, 12 October 2026).
            Ending::Failed { .. } if live.view.kind == "file" && live.started_at.is_some() => "file_failed".into(),
            _ => "failed".into(),
        };
        let app2 = app.clone();
        let id2 = id.clone();
        std::thread::spawn(move || {
            let _ = post(&app2, &id2, "stop", json_body(&stop_body(&why)), SMALL_TIMEOUT, None, None);
        });
    }
    let ok = matches!(e, Ending::Done { .. });
    match e {
        Ending::Done { summary, steps, output, doc, outputs, skipped } => emit(app, ActEvent::Done { task_id: id, kind: live.view.kind.clone(), summary, steps, output, doc, outputs, skipped }),
        Ending::Unresolved { message, settings } => emit(app, ActEvent::Unresolved { task_id: id, message, settings }),
        Ending::Stopped { why, reason, .. } => emit(app, ActEvent::Stopped { task_id: id, why, step: live.step, note: live.note.clone(), reason }),
        Ending::SaidNo { verdict, new_request } => emit(app, ActEvent::SaidNo { task_id: id, verdict, new_request }),
        Ending::Expired => emit(app, ActEvent::Expired { task_id: id }),
        Ending::Failed { code, message, .. } => emit(app, ActEvent::Failed { task_id: id, code, message }),
        Ending::Refused { reason, n, pages, .. } => emit(app, ActEvent::Refused { reason, app: None, n, pages }),
    }
    let ran = live.started_at.is_some();
    companion::set_act(app, None, if ran { Some(ok) } else { None });
    // The keyboard goes back to the app the person was in, if Brenda's notch took it (B.7.7).
    if ran && (live.view.screen() || live.plan.is_some()) {
        if let Some(pid) = live.origin.front_pid.filter(|p| *p != std::process::id() as i32) {
            let app2 = app.clone();
            std::thread::spawn(move || {
                if capture::frontmost(&app2).is_some_and(|f| f.pid == std::process::id() as i32) {
                    capture::hand_back(&app2, pid, capture::HAND_BACK_MS);
                }
            });
        }
    }
    if live.view.kind != "screen" {
        companion::badge(app, false);
    }
    look::hold_pictures(app, false);
    if live.view.kind == "operator" {
        crate::jobs::operator_ended(app, &live.view.id);
    }
    sync_esc(app);
    emit_status(app);
}

/// The yes is recorded: a screen task runs (B.7), a file job works (B.9), a plan's steps run in order (D.5).
fn start(app: &AppHandle, gen: u64) {
    let a = act(app);
    let (screen, plan) = {
        let mut l = a.live.lock().unwrap();
        let Some(live) = l.as_mut().filter(|l| l.gen == gen) else { return };
        // Stopped while the yes was being recorded (Esc, the keys, Stop): it never starts.
        if let Some(why) = live.stop_why.clone() {
            drop(l);
            return end(app, gen, Ending::Stopped { why, reason: None, post_stop: true });
        }
        let plan = live.plan.is_some();
        live.phase = if live.view.screen() || plan { Phase::Running } else { Phase::Working };
        live.started_at = Some(now_unix_ms());
        (live.view.screen(), plan)
    };
    sync_esc(app);
    emit_status(app);
    let app2 = app.clone();
    if plan {
        let _ = std::thread::Builder::new().name("brenda-plan".into()).spawn(move || run_plan(&app2, gen));
    } else if screen {
        let _ = std::thread::Builder::new().name("brenda-act".into()).spawn(move || run_screen(&app2, gen));
    } else {
        let _ = std::thread::Builder::new().name("brenda-file".into()).spawn(move || run_file(&app2, gen));
    }
}

/// The word for a pause's reason, as `/assistant/jobs/:id/state` takes it (O.1).
fn why_word(w: Why) -> &'static str {
    match w {
        Why::Locked => "lock",
        Why::Call => "call",
        Why::Share => "share",
        Why::Sleep => "sleep",
        _ => "lock",
    }
}

/// What the job route said about an operator job (G.2 `JobView`).
#[derive(Clone, Debug, PartialEq)]
pub struct OperatorJob {
    pub id: String,
    pub plan: String,
    pub plan_sha256: String,
    pub step_cap: u32,
    pub doing: String,
}

/// Starts the Mac operator for a job the router made from the person's request (helpers-spec I.1): straight to Running
/// (no proposal, no `/answer`: the request, and the yes when "Check with me" asked, are already recorded), phase 2's step
/// loop on its own thread. One computer-use runner at a time: refused while a task is live.
pub fn start_operator(app: &AppHandle, job: OperatorJob, origin: Origin) -> Result<(), &'static str> {
    if !id_ok(&job.id) || sha256_hex(&job.plan) != job.plan_sha256.to_ascii_lowercase() {
        return Err("not_whole");
    }
    if !can_click_and_type() {
        return Err("accessibility");
    }
    let view = TaskView { id: job.id.clone(), kind: "operator".into(), plan: job.plan.clone(), question: String::new(), plan_sha256: job.plan_sha256.clone(), answer_by: None, risky: false, step_cap: Some(job.step_cap.clamp(1, 20)), file: None, output: None };
    let Some(gen) = begin_live(app, view, None, Phase::Running, origin, None) else { return Err("busy_task") };
    set_live(app, gen, |l| l.started_at = Some(now_unix_ms()));
    sync_esc(app);
    emit_status(app);
    let app2 = app.clone();
    let _ = std::thread::Builder::new().name("brenda-operator".into()).spawn(move || run_screen(&app2, gen));
    Ok(())
}

/// Stop (B.6.5), from anywhere: Esc, her keys, Option+Space, Stop, the tray, a lock, sign-out, quitting, a call, a share,
/// the display gone. The flag is up at once; the executor checks it before every event.
pub fn stop(app: &AppHandle, why: &str) {
    let Some(a) = app.try_state::<Act>() else { return };
    let (gen, phase, id) = {
        let mut l = a.live.lock().unwrap();
        let Some(live) = l.as_mut() else { return };
        live.stop_why.get_or_insert_with(|| why.to_string());
        (live.gen, live.phase, live.view.id.clone())
    };
    a.stop.store(true, Ordering::SeqCst);
    a.wake.notify_all();
    if phase == Phase::Asking {
        return answer(app, &id, Decision::No(Verdict::No), Via::Esc, None);
    }
    // The executor leaves within a tick; give it 100 ms to see the flag, then end the task here if it has not.
    let app2 = app.clone();
    let why = why.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(100));
        end(&app2, gen, Ending::Stopped { why, reason: None, post_stop: true });
    });
}

// ---- the screen task (B.7) -------------------------------------------------------------------------------------------

/// The Mac as the executor sees it.
struct MacEnv {
    app: AppHandle,
    stop: Arc<AtomicBool>,
    epoch: Instant,
    display_id: u32,
    display: Bounds,
    rules: Vec<look::Rule>,
    own_pid: i32,
    shot: (u32, u32),
    /// The apps whose web tree Brenda switched on (pid, and whether she turned `AXEnhancedUserInterface` on, to turn off
    /// again when the task ends).
    web_tree: Mutex<Vec<(i32, bool)>>,
    /// When the front was last handed back (L.1: once, not on every check).
    handed: Mutex<Option<Instant>>,
}

impl MacEnv {
    fn exclude(&self) -> impl Fn(&capture::AppMeta) -> Exclude + '_ {
        look::exclusion(&self.rules, self.own_pid)
    }

    /// An Electron or Chromium app shows its web tree only when asked (review, 12 October 2026): asked once per app per
    /// task, before its controls are read.
    fn web_tree_on(&self, pid: i32) {
        if pid <= 0 || pid == self.own_pid {
            return;
        }
        let mut seen = self.web_tree.lock().unwrap();
        if seen.iter().any(|(p, _)| *p == pid) {
            return;
        }
        let changed = ax::enable_web_tree(pid);
        seen.push((pid, changed));
    }
}

impl Drop for MacEnv {
    fn drop(&mut self) {
        for (pid, changed) in self.web_tree.lock().unwrap().drain(..) {
            if changed {
                ax::restore_web_tree(pid);
            }
        }
    }
}

fn app_info(f: &capture::FrontApp) -> AppInfo {
    AppInfo { pid: f.pid, name: f.name.clone().unwrap_or_default(), bundle_id: f.bundle_id.clone() }
}

impl input::Env for MacEnv {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
    fn sleep(&mut self, ms: u64) -> bool {
        let until = Instant::now() + Duration::from_millis(ms);
        while Instant::now() < until {
            if self.stopped() {
                return false;
            }
            std::thread::sleep(Duration::from_millis(5).min(until.saturating_duration_since(Instant::now())));
        }
        !self.stopped()
    }
    fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }
    fn pointer(&self) -> Option<(f64, f64)> {
        capture::pointer_top_left()
    }
    fn key_down_age_ms(&self) -> Option<u64> {
        capture::seconds_since_key_down().and_then(look::age_ms)
    }
    fn front(&self) -> Option<AppInfo> {
        let mut f = capture::frontmost(&self.app).map(|f| app_info(&f));
        // Brenda in front (her notch took the click): the front goes back to the person's app once (L.1 step 5), and
        // what is in front then is the answer; if it can't, the executor pauses (`Why::OwnFront`).
        if f.as_ref().is_some_and(|x| x.pid == self.own_pid) {
            let mut last = self.handed.lock().unwrap();
            if last.is_none_or(|t| t.elapsed() > Duration::from_secs(2)) {
                *last = Some(Instant::now());
                if let Some(p) = capture::person_front(&self.app).filter(|p| p.pid != self.own_pid) {
                    if capture::hand_back(&self.app, p.pid, capture::HAND_BACK_MS) {
                        f = capture::frontmost(&self.app).map(|f| app_info(&f));
                    }
                }
            }
        }
        if let Some(a) = f.as_ref() {
            self.web_tree_on(a.pid);
        }
        f
    }
    fn owner_at(&self, p: (f64, f64)) -> Option<AppInfo> {
        if crate::island::point_on_island(&self.app, p) {
            return Some(AppInfo { pid: self.own_pid, name: "Brenda".into(), bundle_id: Some(look::OWN_BUNDLE_ID.into()) });
        }
        let list = capture::window_list(true);
        let w = look::window_at(&list, p, self.own_pid)?;
        capture::app_of_pid(&self.app, w.pid).map(|f| app_info(&f)).or(Some(AppInfo { pid: w.pid, name: w.owner_name.clone(), bundle_id: None }))
    }
    fn forbidden(&self, a: &AppInfo) -> Option<String> {
        guard::no_act(&look::AppId { bundle_id: a.bundle_id.clone(), names: vec![a.name.clone()] }, &self.rules)
    }
    fn is_own(&self, a: &AppInfo) -> bool {
        a.pid == self.own_pid || a.bundle_id.as_deref().is_some_and(|b| b.eq_ignore_ascii_case(look::OWN_BUNDLE_ID))
    }
    fn elements_at(&self, p: (f64, f64)) -> Option<Vec<guard::AxBrief>> {
        ax::elements_at(p)
    }
    fn focused(&self) -> Option<guard::Focus> {
        ax::focused()
    }
    fn app_of(&self, pid: i32) -> Option<AppInfo> {
        capture::app_of_pid(&self.app, pid).map(|f| app_info(&f))
    }
    fn file_at(&self, p: (f64, f64)) -> Option<PathBuf> {
        ax::file_at(p)
    }
    fn finder_selection(&self) -> Vec<PathBuf> {
        filework::finder_selection()
    }
    fn page_url(&self) -> Option<String> {
        capture::frontmost(&self.app).and_then(|f| ax::page_url(f.pid))
    }
    fn secure_input(&self) -> bool {
        ax::secure_input()
    }
    fn screenshot(&mut self) -> Result<input::Image, String> {
        let img = capture::act_screenshot(self.display_id, self.display, &self.exclude()).map_err(|_| "Not executed: I couldn't take a screenshot.".to_string())?;
        self.shot = (img.width, img.height);
        Ok(img)
    }
    fn zoom(&mut self, r: [f64; 4]) -> Result<input::Image, String> {
        let g = ShotGeom { display: self.display, w: self.shot.0, h: self.shot.1 };
        let (Some(a), Some(b)) = (input::shot_to_global(&g, r[0], r[1]), input::shot_to_global(&g, r[2], r[3])) else { return Err(input::NOT_EXECUTED_OFF_SCREEN.into()) };
        let region = Bounds { x: a.0, y: a.1, w: (b.0 - a.0).max(1.0), h: (b.1 - a.1).max(1.0) };
        capture::act_zoom(self.display_id, self.display, region, self.shot, &self.exclude()).map_err(|_| "Not executed: I couldn't take that close-up.".to_string())
    }
    fn tap(&mut self, p: (f64, f64)) {
        companion::tap(&self.app, p);
    }
    // Opening by a double-click or ⌘O (owner request, 12 October 2026): the app rules read the real Mac.
    fn home(&self) -> Option<PathBuf> {
        guard::OpenProbe::home(&crate::open::RealProbe)
    }
    fn quarantine(&self, p: &std::path::Path) -> Option<String> {
        crate::open::quarantine_of(p)
    }
    fn exec_file(&self, p: &std::path::Path) -> bool {
        guard::OpenProbe::exec_file(&crate::open::RealProbe, p)
    }
    fn bundle_id_of(&self, p: &std::path::Path) -> Option<String> {
        crate::open::bundle_id_of(p)
    }
    fn handler_of(&self, p: &std::path::Path) -> Option<input::AppInfo> {
        let a = guard::OpenProbe::handler(&crate::open::RealProbe, p)?;
        Some(input::AppInfo { pid: -1, name: a.names.first().cloned().unwrap_or_default(), bundle_id: a.bundle_id })
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StepBody<'a> {
    version: u8,
    /// A plan's screen part (companion2-spec H.1).
    #[serde(skip_serializing_if = "Option::is_none")]
    i: Option<u32>,
    step: u32,
    transcript: Option<&'a [Value]>,
    results: &'a [StepResult],
    #[serde(skip_serializing_if = "Option::is_none")]
    screen: Option<ImageJson<'a>>,
    pointer: Option<Value>,
    front: Option<Value>,
    ask_answered: bool,
}

/// A step request body in a self-wiping buffer, or None when it would pass 3,900,000 bytes (`too_big`).
fn step_body(b: &StepBody) -> Option<WipeOnDrop> {
    look::to_wiped_json(b, STEP_BODY_MAX)
}

/// The step response (D.7.3), with the actions turned into `ApprovedAction`s only here.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct StepResponse {
    pub status: String,
    #[serde(default)]
    pub actions: Vec<ApprovedAction>,
    #[serde(default)]
    pub approved_outward: Option<Value>,
    #[serde(default)]
    pub ask: Option<Value>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub append: Vec<Value>,
    #[serde(default)]
    pub step: u32,
    /// A plan's screen part finished the plan.
    #[serde(default)]
    pub plan_done: bool,
    /// The server's count of steps left (shown nowhere yet; kept for the doing card).
    #[serde(default)]
    #[allow(dead_code)]
    pub steps_left: Option<u32>,
}

pub fn parse_step(v: Value) -> Option<StepResponse> {
    let r: StepResponse = serde_json::from_value(v).ok()?;
    matches!(r.status.as_str(), "act" | "ask" | "finished" | "cannot" | "stopped").then_some(r)
}

/// What a failed act request means for the task.
fn ending_of(e: ApiError, step: u32) -> Ending {
    match (e.status, e.code.as_deref()) {
        (0, Some("STOPPED")) => Ending::Stopped { why: "button".into(), reason: None, post_stop: true },
        (0, _) => Ending::Refused { reason: "offline".into(), n: None, pages: None, post_stop: true },
        (413, _) => Ending::Refused { reason: "too_big".into(), n: Some(step), pages: None, post_stop: true },
        (429, Some("ACT_STEP_CAP")) => Ending::Refused { reason: "cap".into(), n: Some(step), pages: None, post_stop: false },
        // Whatever else went wrong, the Mac has given the task up, so the server is told: most refusals already ended the
        // row, and a stop is idempotent, but some (a stale step, a 5xx) leave it live, which would block the person's next
        // task until the purge (integration, 12 October 2026).
        _ => Ending::Failed { code: e.code, message: e.message, post_stop: true },
    }
}

fn set_live(app: &AppHandle, gen: u64, f: impl FnOnce(&mut Live)) -> bool {
    let a = act(app);
    let mut l = a.live.lock().unwrap();
    match l.as_mut().filter(|l| l.gen == gen) {
        Some(live) => {
            f(live);
            true
        }
        None => false,
    }
}

fn doing_view(note: Option<&str>, first: bool) -> ActView {
    ActView {
        state: companion::State::Doing,
        text: note.map(|n| companion::clip(n, 48)).unwrap_or_default(),
        sub: String::new(),
        hint: if first { "Esc stops me".into() } else { String::new() },
    }
}

/// Waits for the person's answer to a step question or a pause (60 s), or Stop.
fn wait_signal(app: &AppHandle, gen: u64) -> Option<Signal> {
    wait_signal_for(app, gen, Duration::from_millis(ANSWER_WAIT_MS))
}

/// The Mac operator waits 10 minutes paused before it stops (G.6).
pub const OPERATOR_PAUSE: Duration = Duration::from_secs(600);

fn wait_signal_for(app: &AppHandle, gen: u64, wait: Duration) -> Option<Signal> {
    let a = act(app);
    let until = Instant::now() + wait;
    let mut s = a.signal.lock().unwrap();
    loop {
        if let Some(sig) = s.take() {
            return Some(sig);
        }
        if a.stop.load(Ordering::SeqCst) || !a.live.lock().unwrap().as_ref().is_some_and(|l| l.gen == gen) {
            return None;
        }
        let left = until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return None;
        }
        s = a.wake.wait_timeout(s, left.min(Duration::from_millis(250))).unwrap().0;
    }
}

fn run_screen(app: &AppHandle, gen: u64) {
    let _ = screen_part(app, gen, None, None, Instant::now() + TASK_WALL, None);
}

fn none<T>(_: ()) -> Option<T> {
    None
}

/// The screen task's step loop (B.7), on its own or as a plan's screen part (`i`; companion2-spec D.5.5): a phase 2
/// task ends here; a plan's part returns when it is finished (the plan carries on) and ends the task on anything else.
fn screen_part(app: &AppHandle, gen: u64, i: Option<u32>, display: Option<(u32, Bounds)>, wall: Instant, part: Option<Part>) -> Option<StepDone> {
    let a = act(app);
    let Some((id, origin)) = a.live.lock().unwrap().as_ref().filter(|l| l.gen == gen).map(|l| (l.view.id.clone(), l.origin.clone())) else { return None };
    let stop_flag = a.stop.clone();
    let own_pid = std::process::id() as i32;
    let pointer0 = capture::pointer_top_left();
    let display = display.or(origin.display).or_else(|| pointer0.and_then(capture::display_under));
    let Some((display_id, display)) = display else { return none(end(app, gen, Ending::Refused { reason: "display_gone".into(), n: None, pages: None, post_stop: true })) };
    let rules = look::current_rules(app);
    let mut env = MacEnv { app: app.clone(), stop: stop_flag.clone(), epoch: Instant::now(), display_id, display, rules, own_pid, shot: (0, 0), web_tree: Mutex::new(Vec::new()), handed: Mutex::new(None) };
    // The keyboard goes back to the app the person was in (the notch may have taken the Yes click).
    let front0 = origin.front_pid.filter(|p| *p != own_pid).or_else(|| capture::person_front(app).map(|f| f.pid).filter(|p| *p != own_pid));
    if let (Some(pid), Some(now)) = (front0, capture::frontmost(app)) {
        if now.pid == own_pid {
            capture::hand_back(app, pid, capture::HAND_BACK_MS);
        }
    }
    companion::set_act(app, Some(doing_view(Some("Taking a look…"), true)), None);
    emit(app, ActEvent::Running { task_id: id.clone(), step: 0, note: None, part: part.clone() });
    let started = Instant::now();
    let first = match input::Env::screenshot(&mut env) {
        Ok(img) => img,
        Err(_) => return none(end(app, gen, Ending::Failed { code: None, message: "I couldn't see the screen, so I stopped.".into(), post_stop: true })),
    };
    let mut st = ExecState::new(ShotGeom { display, w: first.width, h: first.height }, input::Env::now_ms(&env), pointer0, input::Env::front(&env).map(|f| f.pid));
    let front_json = |env: &MacEnv| input::Env::front(env).map(|f| json!({ "name": f.name, "bundleId": f.bundle_id }));
    let pointer_json = |st: &ExecState| capture::pointer_top_left().map(|p| {
        let (x, y) = input::global_to_shot(&st.geom, p.0, p.1);
        json!({ "x": x, "y": y })
    });
    let mut transcript = Transcript(Vec::new());
    let body = StepBody { version: 1, i, step: 0, transcript: None, results: &[], screen: Some(ImageJson(&first)), pointer: pointer_json(&st), front: front_json(&env), ask_answered: false };
    let Some(mut body) = step_body(&body) else { return none(end(app, gen, Ending::Refused { reason: "too_big".into(), n: Some(0), pages: None, post_stop: true })) };
    drop(first);
    let mut step: u32 = 0;
    let mut first_note = true;
    let operator = a.live.lock().unwrap().as_ref().is_some_and(|l| l.gen == gen && l.view.kind == "operator");
    let mut clocks = (std::time::SystemTime::now(), Instant::now());
    loop {
        if stop_flag.load(Ordering::SeqCst) {
            return none(finish_stop(app, gen, &st, pointer0));
        }
        // The Mac operator pauses for a lock, sleep, a call or a share (G.6), and carries on after the person's press.
        if operator {
            let slept = crate::jobs::slept(clocks, (std::time::SystemTime::now(), Instant::now()));
            clocks = (std::time::SystemTime::now(), Instant::now());
            let why = a.pause.lock().unwrap().take().or(slept.then_some(Why::Sleep));
            if let Some(why) = why {
                if !set_live(app, gen, |l| l.phase = Phase::Paused) {
                    return None;
                }
                sync_esc(app);
                emit(app, ActEvent::Paused { task_id: id.clone(), why });
                crate::jobs::post_state(app, &id, "paused", why_word(why));
                companion::set_act(app, Some(ActView { state: companion::State::Paused, text: "Paused. Carry on in the notch?".into(), sub: String::new(), hint: String::new() }), None);
                emit_status(app);
                match wait_signal_for(app, gen, OPERATOR_PAUSE) {
                    Some(Signal::Continue) => {
                        set_live(app, gen, |l| l.phase = Phase::Running);
                        crate::jobs::post_state(app, &id, "running", why_word(why));
                        emit_status(app);
                        if let Some(pid) = st.last_front_pid.or(front0).filter(|p| *p != own_pid) {
                            capture::hand_back(app, pid, capture::HAND_BACK_MS);
                        }
                        st.resume(input::Env::now_ms(&env), capture::pointer_top_left(), input::Env::front(&env).map(|f| f.pid));
                        clocks = (std::time::SystemTime::now(), Instant::now());
                    }
                    Some(_) => return none(finish_stop(app, gen, &st, pointer0)),
                    None => {
                        set_live(app, gen, |l| {
                            l.stop_why.get_or_insert_with(|| "paused_timeout".into());
                        });
                        return none(finish_stop(app, gen, &st, pointer0));
                    }
                }
            }
        }
        if Instant::now() > wall {
            return none(end(app, gen, Ending::Refused { reason: "time".into(), n: Some(step), pages: None, post_stop: true }));
        }
        let res = post(app, &id, "step", body, STEP_TIMEOUT, Some(step), Some(stop_flag.clone()));
        let r = match res {
            Ok(v) => match parse_step(v) {
                Some(r) => r,
                None => return none(end(app, gen, Ending::Failed { code: None, message: "Boredroom's answer couldn't be read, so I stopped.".into(), post_stop: true })),
            },
            Err(e) if e.code.as_deref() == Some("STOPPED") => return none(finish_stop(app, gen, &st, pointer0)),
            Err(e) => return none(end(app, gen, ending_of(e, step))),
        };
        transcript.0.extend(r.append.iter().cloned());
        let mut r = r;
        r.append.iter_mut().for_each(wipe_value);
        step = r.step;
        let note = r.note.clone().filter(|n| !n.trim().is_empty());
        set_live(app, gen, |l| {
            l.step = step;
            if note.is_some() {
                l.note = note.clone();
            }
        });
        emit(app, ActEvent::Running { task_id: id.clone(), step, note: note.clone(), part: part.clone() });
        companion::set_act(app, Some(doing_view(note.as_deref(), first_note && started.elapsed() < Duration::from_secs(5))), None);
        first_note = false;
        match r.status.as_str() {
            "act" => {
                // The kind of the asked step the person said yes to (send, delete…): it covers one step of that kind only
                // (review, 12 October 2026).
                let approved: Option<String> = r.approved_outward.as_ref().filter(|v| v.is_object()).map(|v| v.get("kind").and_then(|k| k.as_str()).unwrap_or("other").to_string());
                let mut used = false;
                let mut results: Vec<StepResult> = Vec::new();
                let mut from = 0;
                loop {
                    match input::run_on_mac(&mut env, &mut st, &r.actions, approved.as_deref(), &mut used, from, &mut results) {
                        Flow::Done => break,
                        Flow::Stopped { .. } => return none(finish_stop(app, gen, &st, pointer0)),
                        Flow::Paused { why, at } => {
                            let before = capture::frontmost(app).map(|f| f.pid);
                            if !set_live(app, gen, |l| l.phase = Phase::Paused) {
                                return None;
                            }
                            sync_esc(app);
                            emit(app, ActEvent::Paused { task_id: id.clone(), why });
                            companion::set_act(app, Some(ActView { state: companion::State::Paused, text: "Paused. Carry on in the notch?".into(), sub: String::new(), hint: String::new() }), None);
                            emit_status(app);
                            match wait_signal(app, gen) {
                                Some(Signal::Continue) => {
                                    set_live(app, gen, |l| l.phase = Phase::Running);
                                    emit_status(app);
                                    if let Some(pid) = st.last_front_pid.or(before).filter(|p| *p != own_pid) {
                                        capture::hand_back(app, pid, capture::HAND_BACK_MS);
                                    }
                                    let now = input::Env::now_ms(&env);
                                    let front = input::Env::front(&env).map(|f| f.pid);
                                    st.resume(now, capture::pointer_top_left(), front);
                                    companion::set_act(app, Some(doing_view(note.as_deref(), false)), None);
                                    from = at;
                                }
                                Some(_) => return none(finish_stop(app, gen, &st, pointer0)),
                                None => {
                                    set_live(app, gen, |l| {
                                        l.stop_why.get_or_insert_with(|| "paused_timeout".into());
                                    });
                                    return none(finish_stop(app, gen, &st, pointer0));
                                }
                            }
                        }
                    }
                }
                let b = StepBody { version: 1, i, step, transcript: Some(&transcript.0), results: &results, screen: None, pointer: pointer_json(&st), front: front_json(&env), ask_answered: false };
                body = match step_body(&b) {
                    Some(b) => b,
                    None => return none(end(app, gen, Ending::Refused { reason: "too_big".into(), n: Some(step), pages: None, post_stop: true })),
                };
            }
            "ask" => {
                let ask = r.ask.clone().unwrap_or(Value::Null);
                let kind = ask.get("kind").and_then(|k| k.as_str()).unwrap_or("other").to_string();
                let what = ask.get("what").and_then(|k| k.as_str()).unwrap_or("").to_string();
                let question = ask.get("question").and_then(|k| k.as_str()).map(String::from).unwrap_or_else(|| format!("Next I'll {what}. Do you want me to do this?"));
                let step_ask = StepAsk { i, because: because(&kind).into(), kind, what: what.clone(), question: question.clone() };
                *a.signal.lock().unwrap() = None;
                if !set_live(app, gen, |l| {
                    l.phase = Phase::StepAsk;
                    l.ask = Some(step_ask.clone());
                }) {
                    return None;
                }
                sync_esc(app);
                emit(app, ActEvent::StepAsk { task_id: id.clone(), ask: step_ask });
                companion::set_act(app, Some(ActView { state: companion::State::Asking, text: question, sub: String::new(), hint: format!("Say yes or no while holding {}, or answer in the notch.", look::LOOK_KEYS.symbols) }), None);
                emit_status(app);
                let sig = wait_signal(app, gen);
                let (yes, via, text) = match sig {
                    Some(Signal::Yes(via, text)) => (true, via, text),
                    Some(Signal::No(via, text)) => (false, via, text),
                    Some(Signal::Continue) => (false, Via::Button, None),
                    None if stop_flag.load(Ordering::SeqCst) => return none(finish_stop(app, gen, &st, pointer0)),
                    None => (false, Via::Timeout, None),
                };
                let ab = step_answer_body(yes, via, &what, text.as_deref());
                match post(app, &id, "step-answer", json_body(&ab), SMALL_TIMEOUT, None, None) {
                    Ok(_) if yes => {}
                    Ok(_) => return none(end(app, gen, Ending::Stopped { why: "said_no".into(), reason: None, post_stop: false })),
                    Err(e) => return none(end(app, gen, ending_of(e, step))),
                }
                set_live(app, gen, |l| {
                    l.phase = Phase::Running;
                    l.ask = None;
                });
                sync_esc(app);
                emit_status(app);
                if via == Via::Button {
                    if let Some(pid) = st.last_front_pid.or(front0).filter(|p| *p != own_pid) {
                        capture::hand_back(app, pid, capture::HAND_BACK_MS);
                    }
                }
                st.resume(input::Env::now_ms(&env), capture::pointer_top_left(), input::Env::front(&env).map(|f| f.pid));
                let b = StepBody { version: 1, i, step, transcript: Some(&transcript.0), results: &[], screen: None, pointer: pointer_json(&st), front: front_json(&env), ask_answered: true };
                body = match step_body(&b) {
                    Some(b) => b,
                    None => return none(end(app, gen, Ending::Refused { reason: "too_big".into(), n: Some(step), pages: None, post_stop: true })),
                };
            }
            "finished" => {
                restore(app, &st, pointer0);
                if i.is_some() {
                    // A plan's part: the plan carries on (or is done, by the server's word).
                    return Some(StepDone { plan_done: r.plan_done, summary: r.summary.filter(|s| !s.trim().is_empty()), steps: step, ..Default::default() });
                }
                let summary = r.summary.unwrap_or_else(|| "Done.".into());
                return none(end(app, gen, Ending::Done { summary, steps: step, output: None, doc: None, outputs: None, skipped: None }));
            }
            "cannot" => {
                restore(app, &st, pointer0);
                return none(end(app, gen, Ending::Stopped { why: "cannot".into(), reason: r.reason, post_stop: false }));
            }
            _ => return none(finish_stop(app, gen, &st, pointer0)),
        }
    }
}

/// The computer-use transcript the Mac holds for the server (0b.8): its pictures and words are zeroed when the task
/// ends, however it ends.
struct Transcript(Vec<Value>);

impl Drop for Transcript {
    fn drop(&mut self) {
        self.0.iter_mut().for_each(wipe_value);
    }
}

/// Zeroes every string in a JSON value (the base64 of earlier screenshots, the model's words).
fn wipe_value(v: &mut Value) {
    match v {
        Value::String(s) => unsafe { s.as_bytes_mut().fill(0) },
        Value::Array(a) => a.iter_mut().for_each(wipe_value),
        Value::Object(o) => o.values_mut().for_each(wipe_value),
        _ => {}
    }
}

/// The pointer goes back to where it was at the yes, if the person has not moved it since Brenda's last move (B.7.7).
fn restore(_app: &AppHandle, st: &ExecState, pointer0: Option<(f64, f64)>) {
    let (Some(p0), Some(last), Some(now)) = (pointer0, st.last_post_point, capture::pointer_top_left()) else { return };
    if ((now.0 - last.0).powi(2) + (now.1 - last.1).powi(2)).sqrt() <= input::MOVED_POINTS {
        input::restore_pointer(p0);
    }
}

fn finish_stop(app: &AppHandle, gen: u64, st: &ExecState, pointer0: Option<(f64, f64)>) {
    restore(app, st, pointer0);
    let why = act(app).live.lock().unwrap().as_ref().filter(|l| l.gen == gen).and_then(|l| l.stop_why.clone()).unwrap_or_else(|| "button".into());
    end(app, gen, Ending::Stopped { why, reason: None, post_stop: true });
}

// ---- the file job (B.9) ----------------------------------------------------------------------------------------------

fn run_file(app: &AppHandle, gen: u64) {
    let a = act(app);
    let Some((view, file)) = a.live.lock().unwrap().as_ref().filter(|l| l.gen == gen).map(|l| (l.view.clone(), l.file.clone())) else { return };
    let (Some(file), Some(file_ref)) = (file, view.file.clone()) else { return end(app, gen, Ending::Refused { reason: "file_unresolved".into(), n: None, pages: None, post_stop: true }) };
    let _ = file_part(app, gen, None, file, file_ref, view.output.clone());
}

/// The file job (B.9), on its own or as a plan's file step (`i`): read the one file, `/file`, save the new file next to
/// it. A phase 2 job ends here; a plan's step returns what it made (the plan carries on) and ends the task on anything
/// else.
fn file_part(app: &AppHandle, gen: u64, i: Option<u32>, file: Candidate, file_ref: FileRef, output: Option<OutputRef>) -> Option<StepDone> {
    let a = act(app);
    let id = a.live.lock().unwrap().as_ref().filter(|l| l.gen == gen).map(|l| l.view.id.clone())?;
    let stop_flag = a.stop.clone();
    companion::badge(app, true);
    companion::set_act(app, None, None);
    emit(app, ActEvent::Working { task_id: id.clone(), file: Some(file_ref), output: output.clone(), started_at: now_unix_ms(), folder: None });
    let payload = match filework::read(&file) {
        Ok(p) => p,
        Err((r, pages)) => {
            let reason = serde_json::to_value(r).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_else(|| "file_failed".into());
            return none(end(app, gen, Ending::Refused { reason, n: None, pages, post_stop: true }));
        }
    };
    #[derive(Serialize)]
    struct FileBody<'a> {
        version: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        i: Option<u32>,
        file: filework::FileJson<'a>,
    }
    let Some(buf) = look::to_wiped_json(&FileBody { version: 1, i, file: filework::FileJson { candidate: &file, payload: &payload } }, FILE_BODY_MAX) else {
        return none(end(app, gen, Ending::Refused { reason: "file_too_big".into(), n: None, pages: None, post_stop: true }));
    };
    drop(payload);
    let res = post(app, &id, "file", buf, Duration::from_secs(300), None, Some(stop_flag.clone()));
    if stop_flag.load(Ordering::SeqCst) {
        let why = a.live.lock().unwrap().as_ref().filter(|l| l.gen == gen).and_then(|l| l.stop_why.clone()).unwrap_or_else(|| "button".into());
        return none(end(app, gen, Ending::Stopped { why, reason: None, post_stop: true }));
    }
    let v = match res {
        Ok(v) => v,
        Err(e) => return none(end(app, gen, ending_of(e, 0))),
    };
    let summary = v.get("summary").and_then(|s| s.as_str()).unwrap_or("Done.").to_string();
    let Some(dir) = file.path.parent().map(|p| p.to_path_buf()) else { return none(end(app, gen, Ending::Failed { code: None, message: "I couldn't find that folder.".into(), post_stop: true })) };
    let (shown, doc) = save_output(app, gen, &id, &v, &dir, output.as_ref()).ok()?;
    if i.is_some() {
        let (plan_done, plan_summary) = plan::plan_done(&v);
        return Some(StepDone { plan_done, summary: plan_summary.filter(|_| plan_done), outputs: shown.into_iter().collect(), doc, ..Default::default() });
    }
    none(end(app, gen, Ending::Done { summary, steps: 0, output: shown, doc, outputs: None, skipped: None }))
}

/// Saves a finished job's result (B.9.4, C.2): a Boredroom document as it came, or a NEW file in `dir` (never replacing
/// anything). On any failure the task is ended here (`Err`); the server has recorded the job as done by then, so it is
/// told too (`/stop` with why file_failed or pdf_unavailable), and the person's Activity reads "Couldn't finish", as the
/// notch does (review, 12 October 2026).
fn save_output(app: &AppHandle, gen: u64, id: &str, v: &Value, dir: &std::path::Path, output: Option<&OutputRef>) -> Result<(Option<OutputShown>, Option<Value>), ()> {
    let a = act(app);
    if let Some(doc) = v.get("doc").filter(|d| d.is_object()) {
        return Ok((None, Some(doc.clone())));
    }
    let format: Option<Format> = v.get("format").cloned().and_then(|f| serde_json::from_value(f).ok()).or(output.map(|o| o.format));
    let Some(format) = format.filter(|f| *f != Format::Doc) else { return Err(end(app, gen, Ending::Failed { code: None, message: "That file couldn't be made.".into(), post_stop: true })) };
    let name = v.get("name").and_then(|n| n.as_str()).filter(|n| filework::output_name_ok(n, format)).map(String::from).or(output.map(|o| o.name.clone()).filter(|n| filework::output_name_ok(n, format)));
    let Some(name) = name else { return Err(end(app, gen, Ending::Failed { code: None, message: "That file name isn't one I can use.".into(), post_stop: true })) };
    let mut content = v.get("content").and_then(|c| c.as_str()).unwrap_or("").to_string();
    let html = v.get("html").and_then(|h| h.as_str()).map(String::from);
    let mut pdf: Option<Vec<u8>> = None;
    if format == Format::Pdf {
        pdf = html.as_deref().and_then(|h| render_pdf(app, h));
        if pdf.is_none() {
            unsafe { content.as_bytes_mut().fill(0) };
            return Err(end(app, gen, Ending::Refused { reason: "pdf_unavailable".into(), n: None, pages: None, post_stop: true }));
        }
    }
    if a.stop.load(Ordering::SeqCst) {
        unsafe { content.as_bytes_mut().fill(0) };
        return Err(end(app, gen, Ending::Stopped { why: "button".into(), reason: None, post_stop: true }));
    }
    let written = filework::write_output(dir, &name, format, &content, html.as_deref(), pdf.as_deref());
    unsafe { content.as_bytes_mut().fill(0) };
    if let Some(p) = pdf.as_mut() {
        wipe(p);
    }
    match written {
        Ok(path) => {
            let shown = OutputShown {
                name: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(name),
                folder: dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            };
            *a.output.lock().unwrap() = Some((id.to_string(), path));
            Ok((Some(shown), None))
        }
        Err(message) => Err(end(app, gen, Ending::Refused { reason: "file_failed".into(), n: None, pages: None, post_stop: true }.with_message(app, id, message))),
    }
}

// ---- a plan's steps (companion2-spec D.5, I.4.7) ----------------------------------------------------------------------

/// After the yes: the plan's steps in order on this thread, then the end.
fn run_plan(app: &AppHandle, gen: u64) {
    let a = act(app);
    let Some((id, view, resolved)) = a.live.lock().unwrap().as_mut().filter(|l| l.gen == gen).and_then(|l| {
        let p = l.plan.as_mut()?;
        Some((l.view.id.clone(), p.view.clone(), std::mem::take(&mut p.resolved)))
    }) else {
        return;
    };
    let deadline = Instant::now() + Duration::from_secs(view.minutes() * 60);
    let mut host = AppHost { app: app.clone(), gen, id, deadline, first_note: true };
    let ending = match plan::run_steps(&mut host, &view, &resolved) {
        PlanEnd::Done { summary, steps, outputs, doc, skipped } => {
            Ending::Done { summary, steps, output: None, doc, outputs: (!outputs.is_empty()).then_some(outputs), skipped: (skipped > 0).then_some(skipped as u32) }
        }
        PlanEnd::Stopped { why } => {
            let why = a.live.lock().unwrap().as_ref().filter(|l| l.gen == gen).and_then(|l| l.stop_why.clone()).unwrap_or(why);
            Ending::Stopped { why, reason: None, post_stop: true }
        }
        PlanEnd::SaidNo => Ending::Stopped { why: "said_no".into(), reason: None, post_stop: false },
        PlanEnd::Failed { code, message } => Ending::Failed { code, message, post_stop: true },
        PlanEnd::Refused { reason } => Ending::Refused { reason, n: None, pages: None, post_stop: true },
        PlanEnd::Ended => return,
    };
    end(app, gen, ending);
}

/// The Mac and Boredroom as a plan's steps reach them.
struct AppHost {
    app: AppHandle,
    gen: u64,
    id: String,
    deadline: Instant,
    first_note: bool,
}

impl AppHost {
    fn stop_flag(&self) -> Arc<AtomicBool> {
        act(&self.app).stop.clone()
    }
}

impl plan::PlanHost for AppHost {
    fn stopped(&self) -> bool {
        act(&self.app).stop.load(Ordering::SeqCst) || !act(&self.app).live.lock().unwrap().as_ref().is_some_and(|l| l.gen == self.gen)
    }
    fn past_deadline(&self) -> bool {
        Instant::now() > self.deadline
    }
    fn post(&mut self, tail: &str, body: Value) -> Result<Value, ApiError> {
        // A Boredroom change already sent completes even if Stop comes meanwhile (one quick call; P.4).
        let cancel = (tail != "run").then(|| self.stop_flag());
        post(&self.app, &self.id, tail, json_body(&body), if tail == "run" { Duration::from_secs(60) } else { SMALL_TIMEOUT }, None, cancel)
    }
    fn emit(&mut self, e: ActEvent) {
        if let ActEvent::Running { note, .. } = &e {
            companion::set_act(&self.app, Some(doing_view(note.as_deref(), self.first_note)), None);
            self.first_note = false;
            set_live(&self.app, self.gen, |l| l.note = note.clone());
        }
        emit(&self.app, e);
    }
    fn phase(&mut self, p: Phase) {
        if !set_live(&self.app, self.gen, |l| {
            l.phase = p;
            if p != Phase::StepAsk {
                l.ask = None;
            }
        }) {
            return;
        }
        companion::badge(&self.app, p == Phase::Working);
        if p == Phase::Working {
            companion::set_act(&self.app, None, None);
        }
        sync_esc(&self.app);
        emit_status(&self.app);
    }
    fn open(&mut self, target: plan::OpenTarget, r: &Resolved) -> Result<(), &'static str> {
        let rules = look::current_rules(&self.app);
        let probe = crate::open::RealProbe;
        let home = filework::home().unwrap_or_else(|| PathBuf::from("/var/empty"));
        let flag = self.stop_flag();
        plan::run_open(&self.app, &|| flag.load(Ordering::SeqCst), target, r, &plan::Recheck { home, rules: &rules, probe: &probe })
    }
    fn wait_front(&mut self, bundle_id: Option<&str>) {
        let Some(b) = bundle_id else { return };
        let until = Instant::now() + plan::FRONT_WAIT;
        while Instant::now() < until && !self.stopped() {
            if capture::frontmost(&self.app).and_then(|f| f.bundle_id).is_some_and(|f| f.eq_ignore_ascii_case(b)) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    fn ask(&mut self, ask: StepAsk) -> Result<bool, PlanEnd> {
        let a = act(&self.app);
        *a.signal.lock().unwrap() = None;
        if !set_live(&self.app, self.gen, |l| {
            l.phase = Phase::StepAsk;
            l.ask = Some(ask.clone());
        }) {
            return Err(PlanEnd::Ended);
        }
        sync_esc(&self.app);
        emit(&self.app, ActEvent::StepAsk { task_id: self.id.clone(), ask: ask.clone() });
        companion::set_act(&self.app, Some(ActView { state: companion::State::Asking, text: ask.question.clone(), sub: String::new(), hint: format!("Say yes or no while holding {}, or answer in the notch.", look::LOOK_KEYS.symbols) }), None);
        emit_status(&self.app);
        let (yes, via, text) = match wait_signal(&self.app, self.gen) {
            Some(Signal::Yes(via, text)) => (true, via, text),
            Some(Signal::No(via, text)) => (false, via, text),
            Some(Signal::Continue) => (false, Via::Button, None),
            None if a.stop.load(Ordering::SeqCst) => return Err(PlanEnd::Stopped { why: "button".into() }),
            None => (false, Via::Timeout, None),
        };
        let body = step_answer_body(yes, via, &ask.what, text.as_deref());
        match post(&self.app, &self.id, "step-answer", json_body(&body), SMALL_TIMEOUT, None, None) {
            Ok(_) => Ok(yes),
            Err(e) => Err(PlanEnd::Failed { code: e.code, message: e.message }),
        }
    }
    fn folder(&mut self, i: u32, step: &plan::StepView, r: &Resolved) -> Result<StepDone, PlanEnd> {
        let (plan::StepView::Folder { output, .. }, Resolved::Files { root, words, files }) = (step, r) else {
            return Err(PlanEnd::Refused { reason: "file_unresolved".into() });
        };
        let mut job = FolderJob { app: self.app.clone(), gen: self.gen, id: self.id.clone(), i, words: words.clone(), output: output.clone(), started_at: now_unix_ms() };
        plan::folder_step(&mut job, i, output, root, files)
    }
    fn file(&mut self, i: u32, step: &plan::StepView, r: &Resolved) -> Result<StepDone, PlanEnd> {
        let (plan::StepView::File { file, output, .. }, Resolved::FileJob(c)) = (step, r) else {
            return Err(PlanEnd::Refused { reason: "file_unresolved".into() });
        };
        file_part(&self.app, self.gen, Some(i), c.clone(), file.clone(), Some(output.clone())).ok_or(PlanEnd::Ended)
    }
    fn screen(&mut self, i: u32, _goal: &str, after_open: bool) -> Result<StepDone, PlanEnd> {
        // After an open, the display of the app now in front (its first window); else the look's.
        let display = if after_open { front_window_display(&self.app) } else { None };
        let n = act(&self.app).live.lock().unwrap().as_ref().and_then(|l| l.plan.as_ref().map(|p| p.view.steps.len() as u32)).unwrap_or(1);
        let part = Some(Part { k: i + 1, of: n, kind: "screen" });
        screen_part(&self.app, self.gen, Some(i), display, self.deadline, part).ok_or(PlanEnd::Ended)
    }
    fn task_id(&self) -> String {
        self.id.clone()
    }
}

/// The display of the front app's first ordinary window.
fn front_window_display(app: &AppHandle) -> Option<(u32, Bounds)> {
    let f = capture::frontmost(app)?;
    let w = capture::window_list(false).into_iter().find(|w| w.pid == f.pid && w.layer == 0 && w.alpha > 0.0)?;
    capture::display_under((w.bounds.x + w.bounds.w / 2.0, w.bounds.y + w.bounds.h / 2.0))
}

/// A plan's folder job (companion2-spec C.2) on this Mac: each file read here and sent as text, `/folder/finish`, the
/// result saved in that folder.
struct FolderJob {
    app: AppHandle,
    gen: u64,
    id: String,
    i: u32,
    words: String,
    output: OutputRef,
    started_at: u64,
}

impl folder::JobHost for FolderJob {
    fn stopped(&self) -> bool {
        act(&self.app).stop.load(Ordering::SeqCst)
    }
    fn read(&mut self, f: &folder::Found, cap: usize) -> Result<(filework::Payload, bool), filework::Refusal> {
        folder::read_found(f, cap)
    }
    fn send(&mut self, n: usize, f: &folder::Found, payload: &filework::Payload, truncated: bool) -> Result<folder::Section, ApiError> {
        #[derive(Serialize)]
        struct Body<'a> {
            version: u8,
            i: u32,
            n: usize,
            file: folder::FolderFileJson<'a>,
        }
        let body = Body { version: 1, i: self.i, n, file: folder::FolderFileJson { name: &f.name, bytes: f.bytes, payload, truncated } };
        let Some(buf) = look::to_wiped_json(&body, FILE_BODY_MAX) else { return Err(ApiError { status: 413, message: "That file is too large to send.".into(), code: Some("PAYLOAD_TOO_LARGE".into()) }) };
        let v = post(&self.app, &self.id, "folder", buf, Duration::from_secs(180), None, Some(act(&self.app).stop.clone()))?;
        serde_json::from_value::<folder::Section>(v.get("section").cloned().unwrap_or(Value::Null)).map_err(|_| ApiError { status: 0, message: "Boredroom's answer couldn't be read, so I stopped.".into(), code: None })
    }
    fn progress(&mut self, done: usize, of: usize) {
        emit(&self.app, ActEvent::Working { task_id: self.id.clone(), file: None, output: Some(self.output.clone()), started_at: self.started_at, folder: Some(FolderProgress { name: self.words.clone(), done: done as u32, of: of as u32 }) });
    }
}

impl plan::FolderStepHost for FolderJob {
    fn finish(&mut self, body: Value) -> Result<Value, ApiError> {
        let Some(buf) = look::to_wiped_json(&body, 2_000_000) else { return Err(ApiError { status: 413, message: "That's too much to send.".into(), code: Some("PAYLOAD_TOO_LARGE".into()) }) };
        post(&self.app, &self.id, "folder/finish", buf, Duration::from_secs(300), None, Some(act(&self.app).stop.clone()))
    }
    fn save(&mut self, v: &Value, dir: &std::path::Path, output: &OutputRef) -> Result<(Option<OutputShown>, Option<Value>), PlanEnd> {
        save_output(&self.app, self.gen, &self.id, v, dir, Some(output)).map_err(|_| PlanEnd::Ended)
    }
}

impl Ending {
    /// A refusal that also carries the words (`file_failed`'s "{message} Your file is as it was.").
    fn with_message(self, app: &AppHandle, id: &str, message: String) -> Ending {
        emit(app, ActEvent::Failed { task_id: id.into(), code: Some("FILE_FAILED".into()), message });
        self
    }
}

/// PDF output (should, B.9.4): the server's HTML in a hidden A4 window (`render.html`, no capability), printed by WebKit.
/// None when any part is missing or fails (the person is told `pdf_unavailable`, nothing is written).
///
/// Review, 12 October 2026: `createPDFWithConfiguration:` drew the whole page as ONE tall sheet in screen media, and the
/// page was filled after fixed sleeps, so a slow WebKit could leave it blank while the card said "Saved". Now: the page
/// says it is ready (render.js loaded) and that it holds the text, both read back from WebKit; then WebKit PRINTS it to a
/// private file on A4 (`printOperationWithPrintInfo:`, run modally for its own hidden window, which pages it by
/// render.html's @page and break rules); the file must be a whole PDF before it is read, wiped and removed. Tested by
/// hand on macOS 26 with the same calls from Swift (12 October 2026): 120 paragraphs became 8 A4 pages with margins.
#[cfg(target_os = "macos")]
pub(crate) fn render_pdf(app: &AppHandle, html: &str) -> Option<Vec<u8>> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    app.asset_resolver().get("render.html".into())?;
    let label = "file-render";
    if let Some(old) = app.get_webview_window(label) {
        let _ = old.close();
        std::thread::sleep(Duration::from_millis(100));
    }
    let w = WebviewWindowBuilder::new(app, label, WebviewUrl::App("render.html".into()))
        .title("Brenda")
        .inner_size(595.0, 842.0)
        .visible(false)
        .focused(false)
        .focusable(false)
        .skip_taskbar(true)
        .content_protected(true)
        .disable_drag_drop_handler()
        .build()
        .ok()?;
    let out = render_pdf_in(&w, html);
    let _ = w.close();
    out
}

/// Runs a script in the render window and reads back a number (1 for yes), or None after two seconds.
#[cfg(target_os = "macos")]
fn eval_number(w: &tauri::WebviewWindow, js: String) -> Option<i64> {
    use block2::RcBlock;
    use objc2::{msg_send, runtime::AnyObject};
    use objc2_foundation::{NSError, NSString};
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel::<Option<i64>>();
    let sent = w
        .with_webview(move |pw| {
            let wk = pw.inner() as *mut AnyObject;
            if wk.is_null() {
                let _ = tx.send(None);
                return;
            }
            let tx2 = tx.clone();
            let block = RcBlock::new(move |res: *mut AnyObject, _err: *mut NSError| {
                let n = unsafe { res.as_ref() }.and_then(|r| {
                    let num: bool = unsafe { msg_send![r, respondsToSelector: objc2::sel!(integerValue)] };
                    num.then(|| unsafe { msg_send![r, integerValue] })
                });
                let _ = tx2.send(n);
            });
            let script = NSString::from_str(&js);
            unsafe {
                let _: () = msg_send![&*wk, evaluateJavaScript: &*script, completionHandler: &*block];
            }
        })
        .is_ok();
    if !sent {
        return None;
    }
    rx.recv_timeout(Duration::from_secs(2)).ok().flatten()
}

#[cfg(target_os = "macos")]
fn render_pdf_in(w: &tauri::WebviewWindow, html: &str) -> Option<Vec<u8>> {
    use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject, runtime::Sel};
    use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
    // 1. The page is loaded and its script ready (8 s at most), read back from WebKit, never assumed.
    let until = Instant::now() + Duration::from_secs(8);
    loop {
        if eval_number(w, "(typeof window.Render === 'object' && document.readyState === 'complete') ? 1 : 0".into()) == Some(1) {
            break;
        }
        if Instant::now() >= until {
            return None;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    // 2. The text goes in, and the page must hold it.
    let arg = serde_json::to_string(html).ok()?.replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029");
    let js = format!("(window.Render.set({arg}) === true && document.body.textContent.trim().length > 0) ? 1 : 0");
    if eval_number(w, js) != Some(1) {
        return None;
    }
    // 3. Printed to a private file on A4.
    let dir = std::env::temp_dir().join(format!("brenda-render-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    }
    let path = dir.join(format!("{}.pdf", sha256_hex(&format!("{:?}{}", Instant::now(), now_unix_ms()))[..16].to_string()));
    let _ = std::fs::remove_file(&path);
    let target = path.to_string_lossy().to_string();
    let started = w
        .with_webview(move |pw| unsafe {
            let wk = pw.inner() as *mut AnyObject;
            let win = pw.ns_window() as *mut AnyObject;
            let (Some(wk), Some(win)) = (wk.as_ref(), win.as_ref()) else { return };
            let (Some(info_cls), Some(url_cls)) = (AnyClass::get(c"NSPrintInfo"), AnyClass::get(c"NSURL")) else { return };
            let info: Option<Retained<AnyObject>> = msg_send![info_cls, new];
            let Some(info) = info else { return };
            let _: () = msg_send![&*info, setPaperSize: NSSize::new(595.28, 841.89)];
            // The margins are render.html's @page ones.
            let _: () = msg_send![&*info, setTopMargin: 0.0f64];
            let _: () = msg_send![&*info, setBottomMargin: 0.0f64];
            let _: () = msg_send![&*info, setLeftMargin: 0.0f64];
            let _: () = msg_send![&*info, setRightMargin: 0.0f64];
            let _: () = msg_send![&*info, setHorizontalPagination: 1isize];
            let _: () = msg_send![&*info, setVerticalPagination: 0isize];
            let _: () = msg_send![&*info, setHorizontallyCentered: false];
            let _: () = msg_send![&*info, setVerticallyCentered: false];
            let save = NSString::from_str("NSPrintSaveJob");
            let _: () = msg_send![&*info, setJobDisposition: &*save];
            let p = NSString::from_str(&target);
            let url: Option<Retained<AnyObject>> = msg_send![url_cls, fileURLWithPath: &*p];
            let Some(url) = url else { return };
            let dict: Option<Retained<AnyObject>> = msg_send![&*info, dictionary];
            let Some(dict) = dict else { return };
            let key = NSString::from_str("NSPrintJobSavingURL");
            let _: () = msg_send![&*dict, setObject: &*url, forKey: &*key];
            let op: Option<Retained<AnyObject>> = msg_send![wk, printOperationWithPrintInfo: &*info];
            let Some(op) = op else { return };
            let _: () = msg_send![&*op, setShowsPrintPanel: false];
            let _: () = msg_send![&*op, setShowsProgressPanel: false];
            let view: Option<Retained<AnyObject>> = msg_send![&*op, view];
            if let Some(v) = view {
                let _: () = msg_send![&*v, setFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(595.0, 842.0))];
            }
            let none: *const AnyObject = std::ptr::null();
            let ctx: *mut std::ffi::c_void = std::ptr::null_mut();
            let _: () = msg_send![&*op, runOperationModalForWindow: win, delegate: none, didRunSelector: None::<Sel>, contextInfo: ctx];
        })
        .is_ok();
    let mut bytes: Option<Vec<u8>> = None;
    if started {
        // 4. A whole PDF (it ends with %%EOF and stops growing), 20 s at most.
        let until = Instant::now() + Duration::from_secs(20);
        let mut last = 0usize;
        while Instant::now() < until {
            std::thread::sleep(Duration::from_millis(150));
            let Ok(b) = std::fs::read(&path) else { continue };
            let whole = b.starts_with(b"%PDF") && b[b.len().saturating_sub(1024)..].windows(5).any(|x| x == b"%%EOF");
            if whole && b.len() == last {
                bytes = Some(b);
                break;
            }
            last = b.len();
            let mut b = b;
            wipe(&mut b);
        }
    }
    // The private file is overwritten and removed, whatever happened.
    if let Ok(meta) = std::fs::metadata(&path) {
        let _ = std::fs::write(&path, vec![0u8; meta.len() as usize]);
    }
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_dir(&dir);
    bytes
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn render_pdf(_app: &AppHandle, _html: &str) -> Option<Vec<u8>> {
    None
}

// ---- commands --------------------------------------------------------------------------------------------------------

fn act_error(message: &str, code: &str) -> ApiError {
    ApiError { status: 0, message: message.into(), code: Some(code.into()) }
}

pub(crate) fn real_press(app: &AppHandle) -> bool {
    press_ok(look::is_real_press(app), input::seconds_since_post())
}

#[tauri::command]
pub async fn act_status(app: AppHandle) -> ActStatus {
    status(&app)
}

/// "Let Brenda use my Mac" (B.8): on only from the person's press, with screen help on and the workspace allowing it.
#[tauri::command]
pub async fn act_set_use_mac(app: AppHandle, enabled: bool) -> Result<ActStatus, ApiError> {
    if enabled {
        if !real_press(&app) {
            return Err(act_error("Press the button to turn this on.", "ACT_NOT_A_PRESS"));
        }
        if !look::screen_help_on(&app) {
            return Err(act_error("Turn on screen help first.", "LOOK_OFF"));
        }
        if !look::act_available(&app) {
            return Err(act_error("On-screen actions aren't on in this workspace.", "ACT_NOT_AVAILABLE"));
        }
    } else {
        if phase(&app).is_some_and(|_| act(&app).live.lock().unwrap().as_ref().is_some_and(|l| l.view.screen() || l.plan.is_some())) {
            stop(&app, "button");
        }
        // Review, 16 October 2026: a background job (the Files helper or the Mac operator) stops too.
        crate::jobs::switched_off(&app);
    }
    crate::update_config(&app, |c| {
        c.use_mac = enabled;
        c.use_mac_at = enabled.then(now_unix_ms);
    });
    emit_status(&app);
    Ok(status(&app))
}

/// "Let Brenda work on files" (B.9.5): on only from the person's press; then Finder is asked one harmless question so
/// macOS asks its Automation question now, while the person is turning it on.
#[tauri::command]
pub async fn act_set_file_work(app: AppHandle, enabled: bool) -> Result<ActStatus, ApiError> {
    if enabled {
        if !real_press(&app) {
            return Err(act_error("Press the button to turn this on.", "ACT_NOT_A_PRESS"));
        }
        if !look::screen_help_on(&app) {
            return Err(act_error("Turn on screen help first.", "LOOK_OFF"));
        }
        if !look::act_available(&app) {
            return Err(act_error("On-screen actions aren't on in this workspace.", "ACT_NOT_AVAILABLE"));
        }
        crate::update_config(&app, |c| {
            c.file_work = true;
            c.file_work_at = Some(now_unix_ms());
        });
        let granted = tauri::async_runtime::spawn_blocking(filework::finder_probe).await.unwrap_or(false);
        crate::update_config(&app, |c| c.finder_answer = Some(if granted { "granted" } else { "denied" }.into()));
    } else {
        if busy_file(&app) {
            stop(&app, "button");
        }
        // Review, 16 October 2026: a running Files job stops too (it also reads the switch before every call).
        crate::jobs::switched_off(&app);
        crate::update_config(&app, |c| {
            c.file_work = false;
            c.file_work_at = None;
        });
    }
    emit_status(&app);
    Ok(status(&app))
}

/// The system's own Accessibility prompt, from the person's press. Nothing else.
#[tauri::command]
pub async fn act_request_accessibility(app: AppHandle) -> Result<ActStatus, ApiError> {
    if !real_press(&app) {
        return Err(act_error("Press the button to ask your Mac.", "ACT_NOT_A_PRESS"));
    }
    ax::request_trust();
    crate::update_config(&app, |c| c.accessibility_asked = true);
    Ok(status(&app))
}

/// Opens System Settings › Privacy & Security › Accessibility. The address is fixed; the page passes none.
#[tauri::command]
pub async fn act_open_accessibility_settings(app: AppHandle) {
    use tauri_plugin_opener::OpenerExt;
    if cfg!(target_os = "macos") {
        let _ = app.opener().open_url("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility", None::<&str>);
    }
}

/// The person's answer from the notch (B.6.3): Yes and No buttons, or words typed in the asking card.
#[tauri::command]
pub async fn act_answer(app: AppHandle, task_id: String, answer: String, via: String, text: Option<String>) -> Result<(), ApiError> {
    if answer != "yes" && answer != "no" {
        return Err(act_error("Answer yes or no.", "ACT_ANSWER"));
    }
    let via = match via.as_str() {
        "button" => Via::Button,
        "typed" => Via::Typed,
        _ => return Err(act_error("Answer with the buttons or by typing.", "ACT_ANSWER")),
    };
    let name = assistant_name(&app);
    let press = look::is_real_press(&app);
    let d = decide(&answer, via, text.as_deref(), &name, press, input::seconds_since_post());
    if d == Decision::NotAPress {
        return Err(act_error("Press Yes to say yes.", "ACT_NOT_A_PRESS"));
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || match phase(&app2) {
        Some(Phase::Asking) if live_id(&app2).as_deref() == Some(task_id.as_str()) => answer_cmd(&app2, &task_id, d, via, text),
        Some(Phase::StepAsk) if live_id(&app2).as_deref() == Some(task_id.as_str()) => match d {
            Decision::Yes => signal(&app2, Signal::Yes(via, text)),
            Decision::No(_) | Decision::NewRequest(..) => signal(&app2, Signal::No(via, text)),
            Decision::NotAPress => {}
        },
        _ => {}
    })
    .await
    .map_err(|_| act_error("That didn't go through.", "ACT_ANSWER"))
}

fn answer_cmd(app: &AppHandle, id: &str, d: Decision, via: Via, text: Option<String>) {
    answer(app, id, d, via, text)
}

/// Stop: always allowed, from the notch's Stop.
#[tauri::command]
pub async fn act_stop(app: AppHandle, task_id: Option<String>) {
    if let Some(id) = task_id {
        if live_id(&app).as_deref() != Some(id.as_str()) {
            return;
        }
    }
    stop(&app, "button");
}

/// Carry on after a pause: only from the person's press.
#[tauri::command]
pub async fn act_continue(app: AppHandle, task_id: String) -> Result<(), ApiError> {
    if !real_press(&app) {
        return Err(act_error("Press Carry on to carry on.", "ACT_NOT_A_PRESS"));
    }
    if phase(&app) == Some(Phase::Paused) && live_id(&app).as_deref() == Some(task_id.as_str()) {
        signal(&app, Signal::Continue);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct Expect {
    id: String,
    kind: String,
}

/// While a look's reply shows a Boredroom Confirm card, a hold of her keys answers it by voice (B.6.6). Rust only
/// passes the words and the verdict on; the page presses the card's own button.
#[tauri::command]
pub async fn act_expect_answer(app: AppHandle, expect: Option<Expect>) {
    let v = expect.filter(|e| e.kind == "confirm" && (1..=64).contains(&e.id.len()) && e.id.chars().all(|c| c.is_ascii_graphic())).map(|e| e.id);
    *act(&app).confirm.lock().unwrap() = v;
}

/// The drop card's "Ask Brenda to work on it" (A.8): a look request with no picture, only the dropped files.
#[tauri::command]
pub async fn act_file_from_drop(app: AppHandle, question: String) -> Result<Value, ApiError> {
    if !real_press(&app) {
        return Err(act_error("Press Enter to ask.", "ACT_NOT_A_PRESS"));
    }
    if !config(&app, |c| c.file_work) {
        refused(&app, "files_off");
        return Err(act_error("Working on files is off.", "ACT_FILES_OFF"));
    }
    if question_waiting(&app) {
        refused(&app, "answer_first");
        return Err(act_error("Answer this one first.", "ACT_ANSWER_FIRST"));
    }
    let cands = crate::files::recent_candidates(&app);
    if cands.is_empty() {
        refused(&app, "file_unresolved");
        return Err(act_error("I couldn't find that file.", "ACT_FILE"));
    }
    look::send_drop(app, question, cands).await
}

fn output_for(app: &AppHandle, task_id: &str) -> Option<PathBuf> {
    act(app).output.lock().unwrap().as_ref().filter(|(id, _)| id == task_id).map(|(_, p)| p.clone())
}

/// Show in Finder (the person's press; Rust holds the path).
#[tauri::command]
pub async fn act_reveal(app: AppHandle, task_id: String) -> Result<(), ApiError> {
    use tauri_plugin_opener::OpenerExt;
    if !real_press(&app) {
        return Err(act_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    let p = output_for(&app, &task_id).ok_or_else(|| act_error("That file is gone.", "ACT_FILE"))?;
    app.opener().reveal_item_in_dir(p).map_err(|_| act_error("I couldn't show that file.", "ACT_FILE"))
}

/// Open the new file (the person's press).
#[tauri::command]
pub async fn act_open_output(app: AppHandle, task_id: String) -> Result<(), ApiError> {
    use tauri_plugin_opener::OpenerExt;
    if !real_press(&app) {
        return Err(act_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    let p = output_for(&app, &task_id).ok_or_else(|| act_error("That file is gone.", "ACT_FILE"))?;
    app.opener().open_path(p.to_string_lossy().to_string(), None::<&str>).map_err(|_| act_error("I couldn't open that file.", "ACT_FILE"))
}

/// Signing out or quitting: any task stops and the opt-ins' task state goes.
pub fn forget(app: &AppHandle, why: &str) {
    stop(app, why);
    if let Some(a) = app.try_state::<Act>() {
        *a.confirm.lock().unwrap() = None;
        *a.output.lock().unwrap() = None;
    }
}

/// A lock, a call or a share: a screen task stops at once (the look thread checks the lock and calls every 250 ms
/// while a task is live; the companion's thread the share, once a second). A file job carries on: it never touches
/// the screen.
pub fn watch(app: &AppHandle, locked: bool, call_live: bool, sharing: bool) {
    if phase(app).is_none_or(|p| p == Phase::Working) {
        return;
    }
    // The Mac operator pauses instead of stopping (G.6); a pause already shown stays.
    let operator = app.try_state::<Act>().is_some_and(|a| a.live.lock().unwrap().as_ref().is_some_and(|l| l.view.kind == "operator"));
    if operator {
        if phase(app) == Some(Phase::Paused) {
            return;
        }
        let why = if locked {
            Some(Why::Locked)
        } else if call_live {
            Some(Why::Call)
        } else if sharing {
            Some(Why::Share)
        } else {
            None
        };
        if let (Some(w), Some(a)) = (why, app.try_state::<Act>()) {
            a.pause.lock().unwrap().get_or_insert(w);
        }
        return;
    }
    if locked {
        stop(app, "locked");
    } else if call_live {
        stop(app, "call");
    } else if sharing {
        stop(app, "share");
    }
}

pub fn live(app: &AppHandle) -> bool {
    phase(app).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(plan: &str) -> TaskView {
        TaskView {
            id: "0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30".into(),
            kind: "screen".into(),
            plan: plan.into(),
            question: "Do you want me to do this?".into(),
            plan_sha256: sha256_hex(plan),
            answer_by: None,
            risky: false,
            step_cap: Some(20),
            file: None,
            output: None,
        }
    }

    /// L.1: the front goes back with `hand_back`, never `activate` and a fixed sleep.
    #[test]
    fn hand_back_used_not_activate() {
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/act.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        assert!(!code.contains("capture::activate("), "no activate left in act.rs");
        assert!(code.matches("capture::hand_back(").count() >= 4);
    }

    /// I.1: the operator's task is a screen task that starts Running, without a proposal or an `/answer`.
    #[test]
    fn operator_starts_running_without_answer() {
        let mut v = view("I'll fill in the form.");
        v.kind = "operator".into();
        assert!(v.screen(), "the operator runs phase 2's step loop");
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/act.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        let start = &code[code.find("pub fn start_operator(").unwrap()..];
        let body = &start[..start.find("\n}\n").unwrap()];
        assert!(body.contains("Phase::Running") && body.contains("run_screen(") && !body.contains("\"answer\"") && !body.contains("show_asking("));
        // A lock pauses the operator; Esc and her keys still stop it.
        assert_eq!(role(Some(Phase::Running), true, Some("t"), None), Role::Stop);
        assert_eq!(why_word(Why::Locked), "lock");
        assert_eq!(serde_json::to_value(ActEvent::Paused { task_id: "t".into(), why: Why::Locked }).unwrap()["why"], "locked");
    }

    #[test]
    fn plan_hash_is_the_shown_plan() {
        let v = view("I'll rename these 6 files to Invoice-01 to Invoice-06.");
        assert!(plan_ok(&v));
        assert!(view_ok(&v));
        let mut tampered = v.clone();
        tampered.plan = "I'll delete these 6 files.".into();
        assert!(!plan_ok(&tampered), "a different plan than the one recorded");
        assert_eq!(sha256_hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let mut bad = v.clone();
        bad.plan = "Rename the files now please.".into();
        bad.plan_sha256 = sha256_hex(&bad.plan);
        assert!(!view_ok(&bad), "must start with I'll");
        let mut bad = v.clone();
        bad.id = "../../x".into();
        assert!(!view_ok(&bad));
        let mut file = v.clone();
        file.kind = "file".into();
        assert!(!view_ok(&file), "a file job names its file and output");
    }

    #[test]
    fn yes_button_needs_a_real_press() {
        assert_eq!(decide("yes", Via::Button, None, "Brenda", true, None), Decision::Yes);
        assert_eq!(decide("yes", Via::Button, None, "Brenda", false, None), Decision::NotAPress);
        assert_eq!(decide("no", Via::Button, None, "Brenda", false, None), Decision::No(Verdict::No), "no needs no press");
        assert_eq!(decide("yes", Via::Typed, Some("yes"), "Brenda", false, None), Decision::NotAPress);
        assert_eq!(decide("yes", Via::Typed, Some("yes please"), "Brenda", true, Some(10.0)), Decision::Yes);
        assert_eq!(decide("yes", Via::Typed, Some("sounds good"), "Brenda", true, None), Decision::No(Verdict::Unclear), "typed words need the grammar");
    }

    #[test]
    fn yes_button_needs_a_real_press_not_within_1_5_s_of_a_posted_event() {
        assert_eq!(decide("yes", Via::Button, None, "Brenda", true, Some(0.4)), Decision::NotAPress, "her own click just now");
        assert_eq!(decide("yes", Via::Button, None, "Brenda", true, Some(1.5)), Decision::NotAPress);
        assert_eq!(decide("yes", Via::Button, None, "Brenda", true, Some(1.6)), Decision::Yes);
        assert!(press_ok(true, None));
        assert!(!press_ok(false, Some(100.0)));
    }

    #[test]
    fn silence_is_no_after_60_s() {
        assert!(!expired(1_000, 60_999));
        assert!(expired(1_000, 61_000));
        assert_eq!(decide("yes", Via::Timeout, Some("yes"), "Brenda", true, None), Decision::No(Verdict::No));
        assert_eq!(decide("yes", Via::Esc, None, "Brenda", true, None), Decision::No(Verdict::No));
        assert_eq!(decide("yes", Via::Unresolved, None, "Brenda", true, None), Decision::No(Verdict::No));
    }

    #[test]
    fn unclear_is_no_and_long_words_become_a_new_request() {
        assert_eq!(decide("no", Via::Voice, Some("hmm"), "Brenda", false, None), Decision::No(Verdict::Unclear));
        assert_eq!(decide("no", Via::Voice, Some("yes?"), "Brenda", false, None), Decision::No(Verdict::Unclear));
        assert_eq!(decide("yes", Via::Voice, Some("Yes, I need you to do this."), "Brenda", false, None), Decision::Yes);
        assert_eq!(decide("no", Via::Voice, Some("no"), "Brenda", false, None), Decision::No(Verdict::No));
        assert_eq!(
            decide("no", Via::Voice, Some("yes but only the first three"), "Brenda", false, None),
            Decision::NewRequest("yes but only the first three".into(), Verdict::Unclear)
        );
        // Review, 12 October 2026: a no is a no, whatever follows it (nothing happens, no new look).
        assert_eq!(decide("no", Via::Typed, Some("no, rename them to receipts instead"), "Brenda", true, None), Decision::No(Verdict::No));
        assert_eq!(decide("no", Via::Voice, Some("No thanks, I'll do it myself later"), "Brenda", false, None), Decision::No(Verdict::No));
        // Everyday yeses with her name anywhere.
        assert_eq!(decide("yes", Via::Voice, Some("Yes, I need you to do this, Brenda."), "Brenda", false, None), Decision::Yes);
        assert_eq!(decide("yes", Via::Voice, Some("Yes, go ahead and do it."), "Brenda", false, None), Decision::Yes);
        // A yes the grammar missed is unclear, never a new request.
        assert_eq!(decide("no", Via::Voice, Some("yes go ahead and do it right now please thanks"), "Brenda", false, None), Decision::No(Verdict::Unclear));
        assert_eq!(decide("yes", Via::Typed, Some("no, don't do that"), "Brenda", true, None), Decision::No(Verdict::No), "the page's yes never beats the words");
    }

    #[test]
    fn esc_wanted_for_every_state() {
        assert!(!esc_wanted(None));
        assert!(esc_wanted(Some(Phase::Asking)));
        assert!(esc_wanted(Some(Phase::Confirming)));
        assert!(esc_wanted(Some(Phase::Running)));
        assert!(esc_wanted(Some(Phase::StepAsk)));
        assert!(esc_wanted(Some(Phase::Paused)));
        assert!(esc_wanted(Some(Phase::Working)), "rule f: Esc stops a file job too (review, 12 October 2026)");
    }

    /// B.6.4 (`executor::esc_registered_only_while_live`): Esc is Brenda's only while a question waits or a screen task
    /// runs, and is let go the moment it ends.
    #[test]
    fn esc_registered_only_while_live() {
        for (p, want) in [(None, false), (Some(Phase::Asking), true), (Some(Phase::Confirming), true), (Some(Phase::Running), true), (Some(Phase::StepAsk), true), (Some(Phase::Paused), true), (Some(Phase::Working), true)] {
            assert_eq!(esc_wanted(p), want, "{p:?}");
        }
    }

    #[test]
    fn holds_and_talk_keys_by_state() {
        let id = Some("t");
        assert_eq!(role(None, false, None, None), Role::Free);
        assert_eq!(role(None, false, None, Some("c1")), Role::Answer(Target::Confirm("c1".into())));
        assert_eq!(role(Some(Phase::Asking), true, id, None), Role::Answer(Target::Task("t".into())));
        assert_eq!(role(Some(Phase::StepAsk), true, id, Some("c1")), Role::Answer(Target::Task("t".into())), "the task's question first");
        assert_eq!(role(Some(Phase::Running), true, id, None), Role::Stop);
        assert_eq!(role(Some(Phase::Paused), true, id, None), Role::Stop);
        assert_eq!(role(Some(Phase::Confirming), true, id, None), Role::Stop);
        assert_eq!(role(Some(Phase::Confirming), false, id, None), Role::Stop, "a file job about to start stops too");
        assert_eq!(role(Some(Phase::Working), false, id, None), Role::Stop, "rule f: her keys stop a file job (review, 12 October 2026)");
        assert_eq!(role(Some(Phase::Working), false, id, Some("c1")), Role::Stop, "stop comes before a Confirm card");
    }

    #[test]
    fn state_machine_transitions_end_once() {
        // The phases a task passes through, and the Esc each one wants.
        let path = [Phase::Asking, Phase::Confirming, Phase::Running, Phase::StepAsk, Phase::Running, Phase::Paused, Phase::Running];
        assert!(path.iter().all(|p| esc_wanted(Some(*p))));
        assert!(esc_wanted(Some(Phase::Working)));
        assert_eq!(because("send"), "this sends something");
        assert_eq!(because("sign_in"), "this signs in");
        assert_eq!(because("whatever"), "this can't be undone");
    }

    #[test]
    fn step_responses_parse_only_known_statuses() {
        let r = parse_step(json!({ "status": "act", "actions": [{ "id": "toolu_1", "name": "left_click", "input": { "coordinate": [1, 2] } }], "approvedOutward": null, "append": [{ "role": "user" }], "step": 3, "stepsLeft": 17, "note": "Opening Finder…" })).unwrap();
        assert_eq!(r.actions.len(), 1);
        assert_eq!(r.actions[0].member, "left_click");
        assert_eq!(r.step, 3);
        assert!(r.approved_outward.as_ref().is_none_or(|v| v.is_null()));
        assert!(parse_step(json!({ "status": "run_anything", "actions": [] })).is_none());
        assert!(parse_step(json!({ "actions": [] })).is_none());
        let body = StepBody { version: 1, i: None, step: 4, transcript: Some(&[json!({ "role": "user", "content": [] })]), results: &[], screen: None, pointer: Some(json!({ "x": 1, "y": 2 })), front: None, ask_answered: true };
        let v: Value = serde_json::from_slice(&step_body(&body).unwrap().0).unwrap();
        assert_eq!(v["askAnswered"], true);
        assert_eq!(v["step"], 4);
        assert!(v.get("screen").is_none());
        assert_eq!(v["transcript"][0]["role"], "user");
    }

    #[test]
    fn events_are_shaped_as_b11() {
        let v = serde_json::to_value(ActEvent::Heard { task_id: Some("t".into()), for_confirm: None, text: "yes".into(), verdict: Verdict::Yes }).unwrap();
        assert_eq!(v, json!({ "phase": "heard", "taskId": "t", "text": "yes", "verdict": "yes" }));
        let v = serde_json::to_value(ActEvent::StepAsk { task_id: "t".into(), ask: StepAsk { i: None, kind: "send".into(), what: "press Send".into(), question: "Next I'll press Send. Do you want me to do this?".into(), because: because("send").into() } }).unwrap();
        assert_eq!(v["phase"], "step_ask");
        assert_eq!(v["ask"]["because"], "this sends something");
        let v = serde_json::to_value(ActEvent::SaidNo { task_id: "t".into(), verdict: Verdict::Unclear, new_request: false }).unwrap();
        assert_eq!(v, json!({ "phase": "said_no", "taskId": "t", "verdict": "unclear" }));
        let v = serde_json::to_value(ActEvent::Refused { reason: "forbidden_app".into(), app: Some("Terminal".into()), n: None, pages: None }).unwrap();
        assert_eq!(v, json!({ "phase": "refused", "reason": "forbidden_app", "app": "Terminal" }));
        let v = serde_json::to_value(ActEvent::Paused { task_id: "t".into(), why: Why::Moved }).unwrap();
        assert_eq!(v, json!({ "phase": "paused", "taskId": "t", "why": "moved" }));
        let s = ActStatus { supported: true, available: true, use_mac: false, use_mac_at: None, file_work: false, file_work_at: None, accessibility: "unknown", finder: "unknown".into(), esc_registered: false, task: None, folders: Folders::of(None), plans: 1 };
        let v = serde_json::to_value(ActEvent::Status(s.clone())).unwrap();
        assert_eq!(v["phase"], "status");
        assert_eq!(serde_json::to_value(s).unwrap(), json!({ "supported": true, "available": true, "useMac": false, "useMacAt": null, "fileWork": false, "fileWorkAt": null, "accessibility": "unknown", "finder": "unknown", "escRegistered": false, "task": null, "folders": { "documents": "unknown", "desktop": "unknown", "downloads": "unknown" }, "plans": 1 }));
        let f = Folders::of(Some(&crate::FolderAnswers { documents: Some("granted".into()), desktop: Some("denied".into()), downloads: Some("maybe".into()) }));
        assert_eq!((f.documents.as_str(), f.desktop.as_str(), f.downloads.as_str()), ("granted", "denied", "unknown"));
        assert_eq!(accessibility_label(true, true, false), "granted");
        assert_eq!(accessibility_label(true, false, true), "denied");
        assert_eq!(accessibility_label(false, false, false), "unknown");
    }

    /// Companion2-spec I.2: the plan events, as the page reads them; phase 2's shapes are unchanged.
    #[test]
    fn plan_events_are_shaped_as_i2() {
        let v = serde_json::to_value(ActEvent::Scoping { task_id: "t".into(), plan: "I'll open Figma.".into(), task: json!({ "id": "t", "kind": "plan", "v": 2, "steps": [{ "i": 0, "kind": "open" }] }) }).unwrap();
        assert_eq!(v, json!({ "phase": "scoping", "taskId": "t", "plan": "I'll open Figma.", "task": { "id": "t", "kind": "plan", "v": 2, "steps": [{ "i": 0, "kind": "open" }] } }));
        let v = serde_json::to_value(ActEvent::Asking { task: json!({ "id": "t", "kind": "plan", "v": 2 }), local: Some(json!({ "names": ["a.pdf"] })) }).unwrap();
        assert_eq!(v, json!({ "phase": "asking", "task": { "id": "t", "kind": "plan", "v": 2 }, "local": { "names": ["a.pdf"] } }));
        let v = serde_json::to_value(ActEvent::Asking { task: json!({ "id": "t" }), local: None }).unwrap();
        assert!(v.get("local").is_none());
        let v = serde_json::to_value(ActEvent::Running { task_id: "t".into(), step: 0, note: Some("Opening Figma…".into()), part: Some(Part { k: 1, of: 3, kind: "open" }) }).unwrap();
        assert_eq!(v, json!({ "phase": "running", "taskId": "t", "step": 0, "note": "Opening Figma…", "part": { "k": 1, "of": 3, "kind": "open" } }));
        let v = serde_json::to_value(ActEvent::Running { task_id: "t".into(), step: 2, note: None, part: None }).unwrap();
        assert_eq!(v, json!({ "phase": "running", "taskId": "t", "step": 2, "note": null }), "phase 2's shape");
        let out = OutputRef { format: Format::Docx, name: "Documents summary.docx".into() };
        let v = serde_json::to_value(ActEvent::Working { task_id: "t".into(), file: None, output: Some(out), started_at: 5, folder: Some(FolderProgress { name: "Documents".into(), done: 3, of: 14 }) }).unwrap();
        assert_eq!(v, json!({ "phase": "working", "taskId": "t", "output": { "format": "docx", "name": "Documents summary.docx" }, "startedAt": 5, "folder": { "name": "Documents", "done": 3, "of": 14 } }));
        let v = serde_json::to_value(ActEvent::StepAsk { task_id: "t".into(), ask: StepAsk { i: Some(1), kind: "send".into(), what: "go ahead with “Message Ada”".into(), question: "Next I'll go ahead with “Message Ada”. Do you want me to do this?".into(), because: because("send").into() } }).unwrap();
        assert_eq!(v["ask"]["i"], 1);
        let v = serde_json::to_value(ActEvent::Done { task_id: "t".into(), kind: "plan".into(), summary: "Opened Figma.".into(), steps: 0, output: None, doc: None, outputs: Some(vec![OutputShown { name: "Documents summary.docx".into(), folder: "Documents".into() }]), skipped: Some(2) }).unwrap();
        assert_eq!(v, json!({ "phase": "done", "taskId": "t", "kind": "plan", "summary": "Opened Figma.", "steps": 0, "outputs": [{ "name": "Documents summary.docx", "folder": "Documents" }], "skipped": 2 }));
        let v = serde_json::to_value(ActEvent::Unresolved { task_id: "t".into(), message: "Your Mac hasn't let Brenda into Documents.".into(), settings: Some("files".into()) }).unwrap();
        assert_eq!(v, json!({ "phase": "unresolved", "taskId": "t", "message": "Your Mac hasn't let Brenda into Documents.", "settings": "files" }));
        let v = serde_json::to_value(ActEvent::Unresolved { task_id: "t".into(), message: "m".into(), settings: None }).unwrap();
        assert_eq!(v["settings"], Value::Null);
        // Looking things up: Esc, her keys and Stop stop it.
        assert!(esc_wanted(Some(Phase::Scoping)));
        assert_eq!(role(Some(Phase::Scoping), false, Some("t"), None), Role::Stop);
        assert_eq!(serde_json::to_value(Phase::Scoping).unwrap(), "scoping");
        let r = parse_step(json!({ "status": "finished", "summary": "Made the file.", "step": 4, "planDone": true })).unwrap();
        assert!(r.plan_done);
        let b = StepBody { version: 1, i: Some(1), step: 0, transcript: None, results: &[], screen: None, pointer: None, front: None, ask_answered: false };
        let v: Value = serde_json::from_slice(&step_body(&b).unwrap().0).unwrap();
        assert_eq!(v["i"], 1, "a plan's screen part names its step");
    }

    #[test]
    fn the_transcript_is_wiped() {
        let mut v = json!({ "role": "user", "content": [{ "type": "image", "source": { "data": "AAAA" } }, "words"] });
        wipe_value(&mut v);
        assert_eq!(v["content"][0]["source"]["data"], "\0\0\0\0");
        assert_eq!(v["content"][1], "\0\0\0\0\0");
        assert_eq!(v["role"], "\0\0\0\0");
    }

    #[test]
    fn failed_requests_end_the_task_plainly() {
        let e = |status, code: Option<&str>| ApiError { status, message: "m".into(), code: code.map(String::from) };
        assert!(matches!(ending_of(e(0, None), 3), Ending::Refused { ref reason, .. } if reason == "offline"));
        assert!(matches!(ending_of(e(413, Some("PAYLOAD_TOO_LARGE")), 7), Ending::Refused { ref reason, n: Some(7), .. } if reason == "too_big"));
        assert!(matches!(ending_of(e(429, Some("ACT_STEP_CAP")), 20), Ending::Refused { ref reason, n: Some(20), .. } if reason == "cap"));
        assert!(matches!(ending_of(e(429, Some("ACT_LIMIT")), 2), Ending::Failed { code: Some(ref c), .. } if c == "ACT_LIMIT"));
        assert!(matches!(ending_of(e(403, Some("ACT_NOT_CONFIRMED")), 0), Ending::Failed { .. }));
        // Every failure the Mac gives up on is told to the server (a stop is idempotent), so a row the refusal left live
        // (a stale step, a 5xx) never blocks the person's next task (integration, 12 October 2026).
        for (status, code) in [(409, Some("ACT_STEP_STALE")), (500, None), (409, Some("ACT_ENDED")), (429, Some("ACT_WAIT"))] {
            assert!(matches!(ending_of(e(status, code), 4), Ending::Failed { post_stop: true, .. }), "{status} {code:?}");
        }
        assert!(matches!(ending_of(e(429, Some("ACT_STEP_CAP")), 20), Ending::Refused { post_stop: false, .. }));
    }

    /// No act code reads "Act without asking" (rule d): nothing here or in the executor names the mode.
    #[test]
    fn no_act_mode_is_read() {
        for file in ["act.rs", "input.rs", "filework.rs", "plan.rs", "open.rs", "folder.rs", "help.rs"] {
            let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/").to_string() + file).unwrap();
            let code = src.split("#[cfg(test)]").next().unwrap();
            for word in ["act_mode", "actMode", "act-mode", "without_asking", "withoutAsking"] {
                assert!(!code.contains(word), "{file} mentions {word}");
            }
        }
    }

    fn seam_dir() -> Option<String> {
        std::env::var("BRENDA_SEAM_DIR").ok().filter(|d| !d.is_empty())
    }

    fn seam_image() -> input::Image {
        use base64::Engine;
        input::Image { jpeg: base64::engine::general_purpose::STANDARD.decode(look::SEAM_JPEG).unwrap(), width: 40, height: 24 }
    }

    /// The bodies Rust sends the act routes, exactly as it writes them, for the server's own schemas to read back (the
    /// integrator's contract check, 12 October 2026). By hand only: `BRENDA_SEAM_DIR=<dir> cargo test --lib -- --ignored seam_`.
    #[test]
    #[ignore]
    fn seam_act_bodies() {
        let Some(dir) = seam_dir() else { return };
        let write = |name: &str, bytes: &[u8]| std::fs::write(format!("{dir}/rust-{name}.json"), bytes).unwrap();
        let wv = |name: &str, v: &Value| write(name, &serde_json::to_vec(v).unwrap());
        let sha = sha256_hex("I'll rename these 6 files to Invoice-01 to Invoice-06.");
        wv("answer-yes-button", &answer_body("yes", Via::Button, &sha, None));
        wv("answer-yes-voice", &answer_body("yes", Via::Voice, &sha, Some("Yes, I need you to do this.")));
        wv("answer-yes-typed", &answer_body("yes", Via::Typed, &sha, Some("yes please")));
        for via in [Via::Button, Via::Esc, Via::Timeout, Via::Unresolved] {
            wv(&format!("answer-no-{}", serde_json::to_value(via).unwrap().as_str().unwrap()), &answer_body("no", via, &sha, None));
        }
        // A long spoken no (a new request): its words cut to 200 units, an emoji never split.
        wv("answer-no-voice-long", &answer_body("no", Via::Voice, &sha, Some(&format!("No, only rename the first three {}", "files please 😀 ".repeat(40)))));
        wv("step-answer-yes-button", &step_answer_body(true, Via::Button, "press Send on the email to Ada", None));
        wv("step-answer-yes-voice", &step_answer_body(true, Via::Voice, "press Send on the email to Ada", Some("yes, do it")));
        wv("step-answer-no-timeout", &step_answer_body(false, Via::Timeout, "press Send on the email to Ada", None));
        for why in ["esc", "keys", "talk_keys", "button", "tray", "locked", "signout", "quit", "call", "share", "display", "paused_timeout", "offline", "too_big", "time",
            "display_gone", "file_unresolved", "file_too_big", "file_type", "file_scan", "file_long", "file_failed", "failed", "pdf_unavailable", "cap"] {
            wv(&format!("stop-{why}"), &stop_body(why));
        }
        // Step 0: the first screenshot, the pointer and the front app; a later step: the transcript and every result.
        let img = seam_image();
        let b0 = StepBody { version: 1, i: None, step: 0, transcript: None, results: &[], screen: Some(ImageJson(&img)), pointer: Some(json!({ "x": 12, "y": 9 })), front: Some(json!({ "name": "Finder", "bundleId": "com.apple.finder" })), ask_answered: false };
        write("step-0", &step_body(&b0).unwrap().0);
        let transcript = vec![
            json!({ "role": "user", "content": [{ "type": "text", "text": "The person asked: …" }] }),
            json!({ "role": "system", "content": "Reminder: …" }),
            json!({ "role": "assistant", "content": [{ "type": "thinking", "thinking": "Opening Finder", "signature": "sig-1" }, { "type": "tool_use", "id": "c1", "name": "left_click", "input": { "coordinate": [12, 9] }, "toolset_name": "computer" }, { "type": "tool_use", "id": "c2", "name": "screenshot", "input": {}, "toolset_name": "computer" }, { "type": "tool_use", "id": "c3", "name": "type", "input": { "text": "x" }, "toolset_name": "computer" }] }),
        ];
        let results = vec![
            StepResult { id: "c1".into(), name: "left_click".into(), outcome: Ok(input::Out::Text("OK".into())) },
            StepResult { id: "c2".into(), name: "screenshot".into(), outcome: Ok(input::Out::Image(seam_image())) },
            StepResult { id: "c3".into(), name: "type".into(), outcome: Err("Not executed: a password field has the keyboard, and I never type into those.".into()) },
        ];
        let b1 = StepBody { version: 1, i: None, step: 1, transcript: Some(&transcript), results: &results, screen: None, pointer: None, front: None, ask_answered: false };
        write("step-1", &step_body(&b1).unwrap().0);
        let b2 = StepBody { version: 1, i: None, step: 2, transcript: Some(&transcript), results: &[], screen: None, pointer: Some(json!({ "x": 0, "y": 0 })), front: None, ask_answered: true };
        write("step-ask-answered", &step_body(&b2).unwrap().0);
        // The file job: text, a PDF itself, a picture.
        let cand = |kind, name: &str| filework::Candidate { source: filework::Source::FinderSelection, name: name.into(), kind, bytes: 2_104, path: format!("/Users/x/{name}").into(), app: None };
        let file = |c: &filework::Candidate, p: &filework::Payload| serde_json::to_vec(&json!({ "version": 1, "file": serde_json::to_value(filework::FileJson { candidate: c, payload: p }).unwrap() })).unwrap();
        let text = cand(filework::Kind::Document, "Plan.docx");
        write("file-text", &file(&text, &filework::Payload::Text { text: "Plan, in words.".into(), pages: Some(1) }));
        let csv = cand(filework::Kind::Spreadsheet, "Budget.xlsx");
        write("file-text-no-pages", &file(&csv, &filework::Payload::Text { text: "a,b\n1,2".into(), pages: None }));
        let pdf = cand(filework::Kind::Pdf, "Q3 report.pdf");
        write("file-pdf", &file(&pdf, &filework::Payload::Pdf { data: b"%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n".to_vec() }));
        let pic = cand(filework::Kind::Image, "board.jpg");
        write("file-image", &file(&pic, &filework::Payload::Image { jpeg: seam_image().jpeg.clone(), width: 40, height: 24 }));
    }

    /// The server's real act answers (written by tests/integration/act-flow.test.ts with ACT_SEAM_DIR) through Rust's own
    /// parsers; then the transcript Rust would hold after step 0, written back as its next step body, so the server can check
    /// that its hash survives Rust's re-serialisation.
    #[test]
    #[ignore]
    fn seam_server_answers() {
        let Some(dir) = seam_dir() else { return };
        let read = |name: &str| serde_json::from_slice::<Value>(&std::fs::read(format!("{dir}/{name}")).unwrap()).unwrap();
        assert_eq!(read("server-answer-running.json")["status"], "running");
        let act = parse_step(read("server-step-act.json")).expect("act");
        assert_eq!(act.status, "act");
        assert_eq!(act.actions.iter().map(|a| (a.id.as_str(), a.member.as_str())).collect::<Vec<_>>(), vec![("c1", "left_click"), ("c2", "screenshot")]);
        assert_eq!(act.actions[0].input["coordinate"], json!([12, 9]));
        assert!(act.approved_outward.as_ref().is_none_or(|v| v.is_null()));
        assert_eq!(act.note.as_deref(), Some("Opening Finder"));
        assert_eq!(act.step, 1);
        assert!(!act.append.is_empty());
        let ask = parse_step(read("server-step-ask.json")).expect("ask");
        assert_eq!(ask.status, "ask");
        let a = ask.ask.clone().unwrap();
        assert_eq!((a["kind"].as_str(), a["what"].as_str()), (Some("send"), Some("press Send on the email to Ada")));
        assert_eq!(because(a["kind"].as_str().unwrap()), a["because"].as_str().unwrap());
        let approved = parse_step(read("server-step-act-approved.json")).expect("approved");
        assert!(approved.approved_outward.as_ref().is_some_and(|v| v["kind"] == "send"));
        assert_eq!(approved.actions[0].member, "key");
        let finished = parse_step(read("server-step-finished.json")).expect("finished");
        assert_eq!((finished.status.as_str(), finished.summary.as_deref()), ("finished", Some("Sent the email to Ada.")));
        let cannot = parse_step(read("server-step-cannot.json")).expect("cannot");
        assert_eq!((cannot.status.as_str(), cannot.reason.as_deref()), ("cannot", Some("The page asks for a password.")));
        for (name, format) in [("server-file-md.json", filework::Format::Md), ("server-file-docx.json", filework::Format::Docx)] {
            let v = read(name);
            let f: filework::Format = serde_json::from_value(v["format"].clone()).unwrap();
            assert_eq!(f, format);
            assert!(filework::output_name_ok(v["name"].as_str().unwrap(), f), "{v}");
            assert!(v["content"].as_str().is_some_and(|c| !c.is_empty()));
        }
        assert!(read("server-file-docx.json")["html"].as_str().is_some_and(|h| h.contains("<h1>")));
        let doc = read("server-file-doc.json");
        assert!(doc["doc"]["href"].as_str().is_some_and(|h| h.starts_with("/app/")));
        let ended = read("server-error-ended.json");
        assert_eq!((ended["code"].as_str(), ended["message"].as_str().is_some()), (Some("ACT_ENDED"), true));
        // What Rust holds after step 0 (the append, cloned as run_screen clones it) and sends with step 1's results.
        let mut transcript = Transcript(Vec::new());
        transcript.0.extend(act.append.iter().cloned());
        let results = vec![
            StepResult { id: "c1".into(), name: "left_click".into(), outcome: Ok(input::Out::Text("OK".into())) },
            StepResult { id: "c2".into(), name: "screenshot".into(), outcome: Ok(input::Out::Image(seam_image())) },
        ];
        let b = StepBody { version: 1, i: None, step: act.step, transcript: Some(&transcript.0), results: &results, screen: None, pointer: None, front: None, ask_answered: false };
        std::fs::write(format!("{dir}/rust-step-1-from-server.json"), &step_body(&b).unwrap().0).unwrap();
    }
}
