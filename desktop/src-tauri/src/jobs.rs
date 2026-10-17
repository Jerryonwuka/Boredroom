//! Helpers in the background (owner brief, 12 October 2026: "Multi-step work as jobs: a notch card with progress and
//! Stop, then a result card with Open / Show in Finder / Undo … THIS BUILD: the Files helper … and the Mac operator";
//! "Mac jobs pause when the Mac sleeps and resume"; helpers-spec G, H, I).
//!
//! What this file promises, and how:
//! - A job starts only from the person's recorded request: the router's job token for that request's nonce goes to
//!   `POST /assistant/jobs` (`create_job`), from `front.rs` and nowhere else. Nothing here starts a job by itself.
//! - The Files helper's runner (`run_files`) posts a step, Boredroom's server answers with at most 8 calls, and the Mac
//!   makes them with `fileops.rs`'s fixed actions, then posts the results with the next step. The Mac holds the
//!   transcript (the server keeps its SHA-256). Files are named to the server only by refs; paths stay here.
//! - The Trash is a question: the server holds the call (`ask`), the person answers on the job's ask card or by voice
//!   (10 minutes; silence is no), the yes is recorded (`/act/:id/step-answer`), and only then does the held call run, and
//!   only for exactly the refs and count the person heard (`fileops::Approval`). Review, 16 October 2026: the question is
//!   built HERE from the files themselves (the model's words for them are never shown), and the Mac honours the server's
//!   approval only when this Mac asked about exactly those refs and heard this person's yes, on the very next reply, once.
//! - Stop is instant: Stop on the strip or card, the tray, or saying "stop": the item in flight finishes, nothing after
//!   it runs, the server is told. Esc and her keys stay the person's while a Files job works (0.4).
//! - A sleep or a lost connection pauses the job (G.6): the post is retried after 2, 4, 8, 16, 30 and 60 s, then every
//!   60 s, for up to 30 minutes; then it stops, and Undo still works (the manifest is on disk).
//! - Undo (G.11) is a real press on the Mac: the manifest is reversed newest first, and Boredroom hears only the counts.
//! - Tests drive `run_files` with `ScriptedHttp`-style hosts and a temp tree: no network, no real folders.

use serde::Serialize;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant, SystemTime},
};
use tauri::{AppHandle, Emitter, Manager};

use crate::fileops::{self, Approval, CallResult, FilesJob};
use crate::{ApiError, AppState};

// ---- limits (G.8) ------------------------------------------------------------------------------------------------------

pub const FILES_STEPS: u32 = 40;
pub const ASK_WAIT_MS: u64 = 600_000;
/// Retries after a lost connection (G.6): 2, 4, 8, 16, 30, 60 s, then every 60 s.
pub const RETRY_STEPS: [u64; 6] = [2, 4, 8, 16, 30, 60];
pub const OFFLINE_LIMIT: Duration = Duration::from_secs(30 * 60);
/// The wall clock moved this much more than the monotonic one over a loop: the Mac slept.
pub const SLEEP_GAP: Duration = Duration::from_secs(30);
const STEP_TIMEOUT: Duration = Duration::from_secs(180);
const SMALL_TIMEOUT: Duration = Duration::from_secs(20);

/// What `POST /assistant/jobs` answers (G.2 `JobView`).
#[derive(Clone, Debug, PartialEq, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: String,
    pub helper: String,
    pub title: String,
    pub doing: String,
    #[serde(default)]
    pub goal: String,
    #[serde(default)]
    pub plan: String,
    #[serde(default)]
    pub plan_sha256: String,
    #[serde(default)]
    pub step_cap: u32,
    #[serde(default)]
    pub started_at: Option<String>,
    /// The router's line for the job and its natural-voice offer (B.4 `say`, `speech`; never from the job's own answer),
    /// carried to the `started` event so the page says it in her natural voice (M.2; integration, 16 October 2026: they
    /// were dropped, so a job's line was always the Mac's voice).
    #[serde(skip)]
    pub say: String,
    #[serde(skip)]
    pub speech: Value,
}

pub fn view_ok(v: &JobView) -> bool {
    crate::act::id_ok(&v.id) && (v.helper == "files" || v.helper == "operator") && (1..=60).contains(&v.title.chars().count()) && (1..=60).contains(&v.doing.chars().count())
}

// ---- events (`brenda://job`, P.3) --------------------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct OutputRow {
    pub i: usize,
    pub name: String,
    pub folder: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum JobEvent {
    Started {
        job: Value,
        #[serde(skip_serializing_if = "String::is_empty")]
        say: String,
        #[serde(skip_serializing_if = "Value::is_null")]
        speech: Value,
    },
    Progress { job_id: String, done: usize, of: usize, note: String },
    Ask { job_id: String, ask: Value, wait_ms: u64 },
    Paused { job_id: String, why: String },
    Resumed { job_id: String },
    Done {
        job_id: String,
        summary: String,
        #[serde(skip_serializing_if = "Value::is_null")]
        speech: Value,
        outputs: Vec<OutputRow>,
        undo: bool,
        ms: u64,
        /// The folder the job changed things in ("Desktop"), for Show in Finder (`job_show_folder`; review, 16 October 2026).
        #[serde(skip_serializing_if = "Option::is_none")]
        folder: Option<String>,
    },
    Stopped {
        job_id: String,
        why: String,
        summary: String,
        undo: bool,
        /// A folder macOS refused: the card offers Open System Settings (G.5).
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        settings: bool,
    },
    Failed {
        job_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
        message: String,
        undo: bool,
        #[serde(skip_serializing_if = "std::ops::Not::not")]
        settings: bool,
    },
    Undone { job_id: String, restored: usize, skipped: usize },
}

// ---- the runner's surroundings -----------------------------------------------------------------------------------------

/// What the Files runner needs from around it (P.5 `Http`, the clock, the answers).
pub trait JobHost {
    /// POSTs to `/api/orgs/:org/assistant/{tail}`.
    fn post(&mut self, tail: &str, body: &Value) -> Result<Value, ApiError>;
    fn emit(&mut self, e: JobEvent);
    /// Waits for the person's answer to the job's question (None: silence).
    fn wait_answer(&mut self, ms: u64) -> Option<(bool, &'static str, Option<String>)>;
    fn stopped(&self) -> bool;
    /// Sleeps; false when stopped meanwhile.
    fn sleep(&mut self, ms: u64) -> bool;
    /// (wall clock, monotonic clock).
    fn clocks(&self) -> (SystemTime, Instant);
}

/// One call to make, from the server's answer.
#[derive(Clone, Debug, PartialEq)]
pub struct CallIn {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// How a job ended on the Mac.
#[derive(Clone, Debug, PartialEq)]
pub enum JobEnd {
    Done { summary: String, outputs: Vec<String>, speech: Value },
    SaidNo,
    Stopped { why: String },
    Cannot { reason: String },
    Failed { code: Option<String>, message: String },
    Offline,
}

/// The wall clock moved 30 s more than the monotonic one: the Mac slept.
pub fn slept(before: (SystemTime, Instant), now: (SystemTime, Instant)) -> bool {
    let wall = now.0.duration_since(before.0).unwrap_or_default();
    let mono = now.1.saturating_duration_since(before.1);
    wall > mono + SLEEP_GAP
}

/// The S.6 words for a stopped job.
pub fn stopped_words(changed: bool) -> String {
    if changed { "I stopped. What I did stays done, and Undo puts it back." } else { "I stopped before changing anything." }.into()
}

/// Posts a step, pausing for a sleep or a lost connection (G.6). Err with the end when it gives up or is stopped.
fn post_step(host: &mut dyn JobHost, id: &str, body: &Value, clocks: &mut (SystemTime, Instant)) -> Result<Value, JobEnd> {
    let now = host.clocks();
    let mut paused = false;
    if slept(*clocks, now) {
        host.emit(JobEvent::Paused { job_id: id.into(), why: "sleep".into() });
        paused = true;
    }
    *clocks = now;
    let started = host.clocks().1;
    let mut attempt = 0usize;
    loop {
        if host.stopped() {
            return Err(JobEnd::Stopped { why: "button".into() });
        }
        match host.post(&format!("jobs/{id}/step"), body) {
            Ok(v) => {
                if paused {
                    host.emit(JobEvent::Resumed { job_id: id.into() });
                    let _ = host.post(&format!("jobs/{id}/state"), &state_body("running", "offline"));
                }
                *clocks = host.clocks();
                return Ok(v);
            }
            Err(e) if e.status == 0 && e.code.as_deref() != Some("STOPPED") => {
                if !paused {
                    host.emit(JobEvent::Paused { job_id: id.into(), why: "offline".into() });
                    paused = true;
                }
                if host.clocks().1.saturating_duration_since(started) >= OFFLINE_LIMIT {
                    return Err(JobEnd::Offline);
                }
                let wait = RETRY_STEPS.get(attempt).copied().unwrap_or(60);
                attempt += 1;
                if !host.sleep(wait * 1_000) {
                    return Err(JobEnd::Stopped { why: "button".into() });
                }
            }
            Err(e) if e.code.as_deref() == Some("STOPPED") => return Err(JobEnd::Stopped { why: "button".into() }),
            Err(e) if e.code.as_deref() == Some("ACT_ENDED") => return Err(JobEnd::Stopped { why: "ended".into() }),
            Err(e) => return Err(JobEnd::Failed { code: e.code, message: e.message }),
        }
    }
}

/// The Files helper's step loop (G.1–G.7). `calls` makes one call with `fileops` (the caller builds its surroundings);
/// `start` is step 0's `start` (candidates and folders).
pub fn run_files(host: &mut dyn JobHost, job: &mut FilesJob, calls: &mut dyn FnMut(&mut FilesJob, &CallIn, Option<&Approval>) -> CallResult, view: &JobView, start: Value) -> JobEnd {
    let id = view.id.clone();
    let mut transcript: Vec<Value> = Vec::new();
    let mut step: u32 = 0;
    let mut progress = (0usize, 0usize);
    let mut clocks = host.clocks();
    let mut body = json!({ "version": 1, "step": 0, "transcript": null, "results": [], "start": start, "progress": { "done": 0, "of": 0 }, "undo": false, "askAnswered": false });
    let mut turns = 0u32;
    let mut noted = true;
    // The person's yes on THIS Mac for one Trash question: its refs' SHA-256 and count, kept only after they said yes
    // here, honoured only on the very next reply and only once (review, 16 October 2026: before, any `approved` the
    // server sent was enough, with no question ever shown).
    let mut heard_yes: Option<Approval> = None;
    loop {
        if host.stopped() {
            return JobEnd::Stopped { why: "button".into() };
        }
        // Between turns the note says "Thinking", unless the model's own note came (S.6).
        if turns > 0 && !noted {
            host.emit(JobEvent::Progress { job_id: id.clone(), done: progress.0, of: progress.1, note: "Thinking".into() });
        }
        turns += 1;
        if turns > FILES_STEPS + 4 {
            return JobEnd::Failed { code: Some("ACT_STEP_CAP".into()), message: "That took more steps than one job may.".into() };
        }
        let r = match post_step(host, &id, &body, &mut clocks) {
            Ok(v) => v,
            Err(end) => return end,
        };
        if let Some(a) = r.get("append").and_then(|a| a.as_array()) {
            transcript.extend(a.iter().cloned());
        }
        step = r.get("step").and_then(|s| s.as_u64()).map(|s| s as u32).unwrap_or(step);
        let note = r.get("note").and_then(|n| n.as_str()).map(|n| n.chars().take(60).collect::<String>()).filter(|n| !n.trim().is_empty());
        noted = note.is_some();
        if let Some(n) = note.clone() {
            host.emit(JobEvent::Progress { job_id: id.clone(), done: progress.0, of: progress.1, note: n });
        }
        match r.get("status").and_then(|s| s.as_str()) {
            Some("act") => {
                let list: Vec<CallIn> = r
                    .get("calls")
                    .and_then(|c| c.as_array())
                    .map(|a| a.iter().filter_map(|c| Some(CallIn { id: c.get("id")?.as_str()?.to_string(), name: c.get("name")?.as_str()?.to_string(), input: c.get("input").cloned().unwrap_or(Value::Null) })).collect())
                    .unwrap_or_default();
                let sent = r.get("approved").filter(|a| a.is_object()).and_then(|a| {
                    Some(Approval { count: a.get("count")?.as_u64()? as usize, refs_sha256: a.get("refsSha256")?.as_str()?.to_string() })
                });
                let mut approval = approved_here(sent, heard_yes.take());
                let mut results: Vec<Value> = Vec::new();
                if list.len() > fileops::CALLS_PER_TURN {
                    for c in &list {
                        results.push(json!({ "id": c.id, "name": c.name, "ok": false, "error": fileops::TOO_MANY_CALLS }));
                    }
                } else {
                    for c in &list {
                        if host.stopped() {
                            break;
                        }
                        let once = if c.name == "trash" { approval.take() } else { None };
                        let res = calls(job, c, once.as_ref());
                        if !res.ok && res.error.as_deref().is_some_and(fileops::is_denied) {
                            job.denied = true;
                        }
                        results.push(serde_json::to_value(&res).unwrap_or(Value::Null));
                    }
                }
                if host.stopped() {
                    return JobEnd::Stopped { why: "button".into() };
                }
                progress = (job.changes, job.changes.max(progress.1));
                body = json!({ "version": 1, "step": step, "transcript": transcript, "results": results, "progress": { "done": progress.0, "of": progress.1 }, "undo": job.manifest.has_changes(), "askAnswered": false });
            }
            Some("ask") => {
                let ask = r.get("ask").cloned().unwrap_or(Value::Null);
                // The server's own words are only echoed back as its hash; the person sees what this Mac reads off the files.
                let what = ask.get("what").and_then(|w| w.as_str()).unwrap_or("").to_string();
                let Some((shown, pending)) = trash_ask(job, &ask) else {
                    let ab = json!({ "version": 1, "answer": "no", "via": "unresolved", "askSha256": crate::act::sha256_hex(&what) });
                    let _ = host.post(&format!("act/{id}/step-answer"), &ab);
                    return JobEnd::Cannot { reason: "I couldn't tell which files those were, so I left them where they are.".into() };
                };
                host.emit(JobEvent::Ask { job_id: id.clone(), ask: shown, wait_ms: ASK_WAIT_MS });
                let answer = host.wait_answer(ASK_WAIT_MS);
                let (yes, via, text) = match answer {
                    Some(a) => a,
                    None if host.stopped() => return JobEnd::Stopped { why: "button".into() },
                    None => (false, "timeout", None),
                };
                let mut ab = json!({ "version": 1, "answer": if yes { "yes" } else { "no" }, "via": via, "askSha256": crate::act::sha256_hex(&what) });
                if let Some(t) = text {
                    ab["text"] = json!(crate::look::clip_utf16(&t, crate::act::ANSWER_TEXT_MAX));
                }
                match host.post(&format!("act/{id}/step-answer"), &ab) {
                    Ok(_) if yes => heard_yes = Some(pending),
                    Ok(_) => return JobEnd::SaidNo,
                    Err(e) => return JobEnd::Failed { code: e.code, message: e.message },
                }
                body = json!({ "version": 1, "step": step, "transcript": transcript, "results": [], "progress": { "done": progress.0, "of": progress.1 }, "undo": job.manifest.has_changes(), "askAnswered": true });
            }
            Some("finished") => {
                let summary = r.get("summary").and_then(|s| s.as_str()).unwrap_or("Done.").chars().take(500).collect();
                let outputs = r.get("outputs").and_then(|o| o.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
                return JobEnd::Done { summary, outputs, speech: r.get("speech").cloned().unwrap_or(Value::Null) };
            }
            Some("cannot") => return JobEnd::Cannot { reason: r.get("reason").and_then(|s| s.as_str()).unwrap_or("I couldn't do that one.").chars().take(300).collect() },
            Some("stopped") => return JobEnd::Stopped { why: "ended".into() },
            _ => return JobEnd::Failed { code: None, message: "Boredroom's answer couldn't be read, so I stopped.".into() },
        }
    }
}

/// The approval a step's `act` reply may use: only the one this Mac kept after the person's own yes, and only when the
/// server's matches it exactly (review, 16 October 2026). Anything else is none, so a `trash` in that reply is refused.
pub fn approved_here(sent: Option<Approval>, kept: Option<Approval>) -> Option<Approval> {
    match (sent, kept) {
        (Some(a), Some(k)) if a == k => Some(a),
        _ => None,
    }
}

/// A Trash question from the server, read on this Mac (review, 16 October 2026): its refs must hash to its
/// `refsSha256` and number its `count`, and every one must be a file this job knows. The card shows the Mac's own
/// words for them (`FilesJob::trash_words`); the approval to keep after a yes. None: nothing is asked, nothing moves.
pub fn trash_ask(job: &FilesJob, ask: &Value) -> Option<(Value, Approval)> {
    if ask.get("kind").and_then(|k| k.as_str()) != Some("delete") {
        return None;
    }
    let refs: Vec<String> = ask.get("refs")?.as_array()?.iter().map(|r| r.as_str().filter(|r| fileops::ref_ok(r)).map(String::from)).collect::<Option<Vec<_>>>()?;
    let count = ask.get("count")?.as_u64()? as usize;
    let sha = ask.get("refsSha256")?.as_str()?.to_string();
    if refs.is_empty() || refs.len() != count || refs.len() > fileops::REFS_PER_CALL || fileops::refs_sha256(&refs) != sha {
        return None;
    }
    let (question, because) = job.trash_words(&refs)?;
    Some((json!({ "kind": "delete", "question": question, "because": because, "count": count }), Approval { count, refs_sha256: sha }))
}

/// What the person sees when a job ends (S.6), and what is told to Boredroom.
pub fn finish(host: &mut dyn JobHost, view: &JobView, job: &FilesJob, end: &JobEnd, ms: u64) {
    let undo = job.manifest.has_changes();
    let id = view.id.clone();
    match end {
        JobEnd::Done { summary, outputs, speech } => {
            let rows = job.outputs_of(outputs).into_iter().enumerate().map(|(i, (name, folder, _))| OutputRow { i, name, folder }).collect();
            let folder = job.job_folder().and_then(|f| job.roots.iter().find(|r| f.starts_with(&r.path)).map(|r| fileops::folder_title(&f, r)));
            host.emit(JobEvent::Done { job_id: id, summary: summary.clone(), speech: speech.clone(), outputs: rows, undo, ms, folder });
        }
        JobEnd::SaidNo => {
            let mut s = "Okay, I left them where they are.".to_string();
            if undo {
                s.push_str(" What I did before that stays done.");
            }
            host.emit(JobEvent::Stopped { job_id: id, why: "said_no".into(), summary: s, undo, settings: false });
        }
        JobEnd::Stopped { why } => {
            if why != "ended" {
                let _ = host.post(&format!("act/{}/stop", view.id), &json!({ "version": 1, "why": why }));
            }
            host.emit(JobEvent::Stopped { job_id: id, why: why.clone(), summary: stopped_words(undo), undo, settings: false });
        }
        JobEnd::Cannot { reason } => host.emit(JobEvent::Stopped { job_id: id, why: "cannot".into(), summary: reason.clone(), undo, settings: job.denied }),
        JobEnd::Offline => {
            let _ = host.post(&format!("act/{}/stop", view.id), &json!({ "version": 1, "why": "offline" }));
            host.emit(JobEvent::Stopped { job_id: id, why: "offline".into(), summary: "What I did stays done, and Undo still works.".into(), undo, settings: false });
        }
        JobEnd::Failed { code, message } => {
            let _ = host.post(&format!("act/{}/stop", view.id), &json!({ "version": 1, "why": "failed" }));
            let m = if undo { format!("{message} What I did before that stays done.") } else { message.clone() };
            host.emit(JobEvent::Failed { job_id: id, code: code.clone(), message: m, undo, settings: job.denied });
        }
    }
}

// ---- the jobs on this Mac ----------------------------------------------------------------------------------------------

/// A job as the recent-jobs card shows it (`job_list`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobBrief {
    pub id: String,
    pub helper: String,
    pub title: String,
    pub doing: String,
    /// running, paused, asking, done, stopped, failed, undone.
    pub state: String,
    /// When it started or ended (unix ms).
    pub at: u64,
    pub undo: bool,
    pub done: usize,
    pub of: usize,
    #[serde(skip)]
    pub manifest: Option<PathBuf>,
    #[serde(skip)]
    pub outputs: Vec<(String, String, PathBuf)>,
    /// The folder the job changed things in (Show in Finder on the done card).
    #[serde(skip)]
    pub folder: Option<PathBuf>,
}

#[derive(Default)]
pub struct Jobs {
    live: Mutex<Option<JobBrief>>,
    stop: Mutex<Option<Arc<AtomicBool>>>,
    recent: Mutex<Vec<JobBrief>>,
    asking: Mutex<Option<String>>,
    answer: Mutex<Option<(bool, &'static str, Option<String>)>>,
    wake: Condvar,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn emit(app: &AppHandle, e: JobEvent) {
    let _ = app.emit("brenda://job", e);
}

/// The live job's id.
pub fn live_id(app: &AppHandle) -> Option<String> {
    app.try_state::<Jobs>()?.live.lock().unwrap().as_ref().map(|j| j.id.clone())
}

/// A job's question waits for the person (for her keys, Option+Space and Esc).
pub fn waiting(app: &AppHandle) -> Option<String> {
    app.try_state::<Jobs>()?.asking.lock().unwrap().clone()
}

fn answer(app: &AppHandle, id: &str, a: (bool, &'static str, Option<String>)) {
    let Some(j) = app.try_state::<Jobs>() else { return };
    if j.asking.lock().unwrap().as_deref() != Some(id) {
        return;
    }
    *j.answer.lock().unwrap() = Some(a);
    j.wake.notify_all();
}

/// Words heard while a job's question waited (a hold of her keys or Option+Space): the yes grammar.
pub fn heard_answer(app: &AppHandle, id: &str, text: &str) {
    let name = crate::companion::name(app);
    let yes = crate::yes::verdict(text, &name) == crate::yes::Verdict::Yes;
    answer(app, id, (yes, "voice", Some(text.chars().take(200).collect())));
}

/// Esc on a job's question is no. Whether it was one.
pub fn esc(app: &AppHandle) -> bool {
    match waiting(app) {
        Some(id) => {
            answer(app, &id, (false, "esc", None));
            true
        }
        None => false,
    }
}

/// Stops the live job (Stop, the tray, "stop" said, signing out, quitting).
pub fn stop(app: &AppHandle, why: &str) {
    let Some(j) = app.try_state::<Jobs>() else { return };
    let helper = j.live.lock().unwrap().as_ref().map(|l| l.helper.clone());
    match helper.as_deref() {
        Some("operator") => crate::act::stop(app, why),
        Some(_) => {
            if let Some(f) = j.stop.lock().unwrap().as_ref() {
                f.store(true, Ordering::SeqCst);
            }
            j.wake.notify_all();
        }
        None => {}
    }
}

/// The front desk's status line (`LookStatus.front.jobLive`).
pub fn brief_value(app: &AppHandle) -> Value {
    live_id(app).map(Value::String).unwrap_or(Value::Null)
}

fn ended(app: &AppHandle, mut brief: JobBrief, state: &str) {
    let Some(j) = app.try_state::<Jobs>() else { return };
    *j.live.lock().unwrap() = None;
    *j.stop.lock().unwrap() = None;
    *j.asking.lock().unwrap() = None;
    brief.state = state.into();
    brief.at = now_ms();
    let mut r = j.recent.lock().unwrap();
    r.retain(|x| x.id != brief.id);
    r.insert(0, brief);
    r.truncate(10);
    drop(r);
    crate::companion::badge(app, false);
    crate::act::sync_esc(app);
    crate::refresh_tray(app);
}

/// The Mac operator's task ended (`act.rs`): it joins the recent jobs.
pub fn operator_ended(app: &AppHandle, id: &str) {
    let Some(j) = app.try_state::<Jobs>() else { return };
    let live = j.live.lock().unwrap().clone().filter(|l| l.id == id);
    if let Some(b) = live {
        ended(app, b, "done");
    }
}

/// Boredroom's address and the token (for Rust's own job routes).
fn route(app: &AppHandle, tail: &str) -> Result<(String, String), ApiError> {
    let (base, token, slug) = {
        let st = app.state::<AppState>();
        let c = st.config.lock().unwrap();
        (crate::base_url(&c), c.token.clone(), c.workspace_slug.clone())
    };
    let (Some(token), Some(slug)) = (token, slug) else { return Err(ApiError::new(401, "Not signed in.")) };
    Ok((format!("{base}/api/orgs/{slug}/assistant/{tail}"), token))
}

/// One POST to a job route, as JSON (blocking; never on the main thread).
pub fn post_json(app: &AppHandle, tail: &str, body: &Value, timeout: Duration) -> Result<Value, ApiError> {
    let (url, token) = route(app, tail)?;
    let http = app.state::<AppState>().http.clone();
    let bytes = serde_json::to_vec(body).unwrap_or_default();
    let body = crate::look::WipeOnDrop(bytes);
    tauri::async_runtime::block_on(async move {
        let res = http
            .post(url)
            .bearer_auth(token)
            .header("content-type", "application/json")
            .header("accept", "application/json")
            .header("user-agent", crate::user_agent())
            .timeout(timeout)
            .body(bytes::Bytes::from_owner(body))
            .send()
            .await
            .map_err(|e| ApiError::new(0, format!("Cannot reach Boredroom: {}", e.without_url())))?;
        let status = res.status().as_u16();
        let value: Value = res.json().await.unwrap_or(Value::Null);
        if status >= 400 {
            let message = value.get("message").and_then(|m| m.as_str()).unwrap_or("Request failed.").to_string();
            let code = value.get("code").and_then(|c| c.as_str()).map(String::from);
            return Err(ApiError { status, message, code });
        }
        Ok(value)
    })
}

/// Tells Boredroom a job paused or carried on (content-free; best effort, off this thread).
pub fn post_state(app: &AppHandle, id: &str, state: &str, why: &str) {
    if !crate::act::id_ok(id) {
        return;
    }
    let app = app.clone();
    let (id, body) = (id.to_string(), state_body(state, why));
    std::thread::spawn(move || {
        let _ = post_json(&app, &format!("jobs/{id}/state"), &body, SMALL_TIMEOUT);
    });
}

/// The body of `POST /assistant/jobs` (G.2).
pub fn create_body(token: &str, yes: Option<(&'static str, Option<String>)>, click: bool) -> Value {
    let yes = yes.map(|(via, text)| json!({ "via": via, "text": text.map(|t| crate::look::clip_utf16(&t, crate::act::ANSWER_TEXT_MAX)) }));
    json!({ "version": 1, "token": token, "yes": yes, "consent": { "click": click } })
}

/// The body of `POST /assistant/jobs/:id/state` (O.1).
pub fn state_body(state: &str, why: &str) -> Value {
    json!({ "version": 1, "state": state, "why": why })
}

/// The body of `POST /assistant/jobs/:id/undone` (G.11).
pub fn undone_body(restored: usize, skipped: usize) -> Value {
    json!({ "version": 1, "restored": restored.min(2_000), "skipped": skipped.min(2_000) })
}

/// `POST /assistant/jobs` (G.2): the router's token, the person's yes when "Check with me" asked, the click consent.
pub fn create_job(app: &AppHandle, token: &str, yes: Option<(&'static str, Option<String>)>, click: bool) -> Result<JobView, ApiError> {
    let v = post_json(app, "jobs", &create_body(token, yes, click), SMALL_TIMEOUT)?;
    let view: JobView = v.get("job").cloned().and_then(|j| serde_json::from_value(j).ok()).ok_or_else(|| ApiError::new(0, "Boredroom's answer couldn't be read."))?;
    if !view_ok(&view) {
        return Err(ApiError::new(0, "Boredroom's answer couldn't be read."));
    }
    Ok(view)
}

/// What a Files job starts with on this Mac (G.3 `start`): the files the person pointed at and the folder they had open.
#[derive(Clone, Debug, Default)]
pub struct StartCtx {
    pub candidates: Vec<crate::filework::Candidate>,
    pub pointed: Vec<PathBuf>,
}

/// The allowed roots on this Mac (H.2): Desktop, Documents, Downloads and the folders the person added; a folder they
/// pointed at only when it is inside one of those.
pub fn roots(home: &Path, added: &[String], pointed: &[PathBuf]) -> Vec<fileops::Root> {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    let mut out: Vec<fileops::Root> = ["Desktop", "Documents", "Downloads"].iter().map(|d| fileops::Root { path: canon(&home.join(d)), title: d.to_string(), source: "named", name: d.to_lowercase() }).collect();
    for a in added.iter().take(10) {
        let p = PathBuf::from(a);
        if fileops::added_folder_ok(&p, home) {
            let title = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            out.push(fileops::Root { path: canon(&p), name: title.clone(), title, source: "added" });
        }
    }
    let inside: Vec<PathBuf> = out.iter().map(|r| r.path.clone()).collect();
    for p in pointed {
        let c = canon(p);
        if inside.iter().any(|r| c.starts_with(r) && &c != r) && !fileops::inside_package(&c, inside.iter().find(|r| c.starts_with(r)).unwrap()) {
            let title = c.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            out.push(fileops::Root { path: c, name: title.clone(), title, source: "pointed" });
        }
    }
    out
}

/// Step 0's `start` (G.3): the candidates inside the allowed roots (c refs) and the folders (f refs).
pub fn start_body(job: &mut FilesJob, candidates: &[crate::filework::Candidate]) -> Value {
    let mut cands = Vec::new();
    for c in candidates.iter().filter(|c| c.kind != crate::filework::Kind::Folder).take(10) {
        let inside = job.roots.iter().any(|r| c.path.starts_with(&r.path));
        if inside {
            let r = job.refs.add('c', &c.path);
            cands.push(json!({ "ref": r, "name": c.name, "kind": fileops::file_kind(&c.name).key(), "bytes": c.bytes }));
        }
    }
    json!({ "candidates": cands, "folders": job.folders_json() })
}

/// The real job host: Boredroom over HTTP, events to the notch, answers from the person.
struct RealHost {
    app: AppHandle,
    stop: Arc<AtomicBool>,
}

impl JobHost for RealHost {
    fn post(&mut self, tail: &str, body: &Value) -> Result<Value, ApiError> {
        let timeout = if tail.ends_with("/step") { STEP_TIMEOUT } else { SMALL_TIMEOUT };
        post_json(&self.app, tail, body, timeout)
    }
    fn emit(&mut self, e: JobEvent) {
        if let JobEvent::Ask { job_id, .. } = &e {
            if let Some(j) = self.app.try_state::<Jobs>() {
                *j.asking.lock().unwrap() = Some(job_id.clone());
                *j.answer.lock().unwrap() = None;
                if let Some(l) = j.live.lock().unwrap().as_mut() {
                    l.state = "asking".into();
                }
            }
            crate::act::sync_esc(&self.app);
        }
        if let (JobEvent::Progress { done, of, .. }, Some(j)) = (&e, self.app.try_state::<Jobs>()) {
            if let Some(l) = j.live.lock().unwrap().as_mut() {
                l.done = *done;
                l.of = *of;
            }
        }
        if let (JobEvent::Paused { .. } | JobEvent::Resumed { .. }, Some(j)) = (&e, self.app.try_state::<Jobs>()) {
            if let Some(l) = j.live.lock().unwrap().as_mut() {
                l.state = if matches!(e, JobEvent::Paused { .. }) { "paused".into() } else { "running".into() };
            }
        }
        emit(&self.app, e);
    }
    fn wait_answer(&mut self, ms: u64) -> Option<(bool, &'static str, Option<String>)> {
        let j = self.app.state::<Jobs>();
        let until = Instant::now() + Duration::from_millis(ms);
        let mut a = j.answer.lock().unwrap();
        let out = loop {
            if let Some(x) = a.take() {
                break Some(x);
            }
            if self.stop.load(Ordering::SeqCst) || Instant::now() >= until {
                break None;
            }
            let left = until.saturating_duration_since(Instant::now()).min(Duration::from_millis(250));
            a = j.wake.wait_timeout(a, left).unwrap().0;
        };
        drop(a);
        *j.asking.lock().unwrap() = None;
        if let Some(l) = j.live.lock().unwrap().as_mut() {
            l.state = "running".into();
        }
        crate::act::sync_esc(&self.app);
        out
    }
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
    fn sleep(&mut self, ms: u64) -> bool {
        let until = Instant::now() + Duration::from_millis(ms);
        while Instant::now() < until {
            if self.stopped() {
                return false;
            }
            std::thread::sleep(Duration::from_millis(100).min(until.saturating_duration_since(Instant::now())));
        }
        !self.stopped()
    }
    fn clocks(&self) -> (SystemTime, Instant) {
        (SystemTime::now(), Instant::now())
    }
}

/// Where Undo manifests live (G.11).
pub fn undo_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("undo"))
}

/// A call refused because the person turned off "Work on my files" while the job ran.
pub const SWITCHED_OFF: &str = "Not done: you turned off “Work on my files”.";

/// A personal switch went off ("Work on my files", "Do things when I ask", screen help) or the workspace switched
/// actions off: the live job stops at once (review, 16 October 2026). Nothing when none runs.
pub fn switched_off(app: &AppHandle) {
    if live_id(app).is_some() {
        stop(app, "button");
    }
}

/// Starts the Files helper on its own thread for a job Boredroom created from the person's request.
pub fn start_files(app: &AppHandle, view: JobView, ctx: StartCtx) -> Result<(), ApiError> {
    let j = app.state::<Jobs>();
    {
        let mut live = j.live.lock().unwrap();
        if live.is_some() {
            return Err(ApiError { status: 409, message: "I'm still on the last job. Wait for it to finish, or stop it in the notch.".into(), code: Some("JOB_BUSY".into()) });
        }
        *live = Some(JobBrief { id: view.id.clone(), helper: "files".into(), title: view.title.clone(), doing: view.doing.clone(), state: "running".into(), at: now_ms(), undo: false, done: 0, of: 0, manifest: None, outputs: vec![], folder: None });
    }
    let stop = Arc::new(AtomicBool::new(false));
    *j.stop.lock().unwrap() = Some(stop.clone());
    let home = crate::filework::home().ok_or_else(|| ApiError::new(0, "I couldn't find your home folder."))?;
    let added = app.state::<AppState>().config.lock().unwrap().extra_folders.clone();
    let rules = crate::look::current_rules(app);
    let never = crate::folder::never_names(&rules);
    let head = fileops::ManifestHead { job_id: view.id.clone(), title: view.title.clone(), at: (now_ms() / 1000) as i64, undone_at: None };
    let manifest = undo_dir(app).and_then(|d| {
        fileops::prune_manifests(&d, head.at);
        fileops::Manifest::create(&d, &head).ok()
    });
    let manifest_path = manifest.as_ref().and_then(|m| m.path().map(Path::to_path_buf));
    if let Some(l) = j.live.lock().unwrap().as_mut() {
        l.manifest = manifest_path.clone();
    }
    let mut job = FilesJob::new(roots(&home, &added, &ctx.pointed), never, manifest.unwrap_or_else(fileops::Manifest::memory));
    let start = start_body(&mut job, &ctx.candidates);
    emit(app, JobEvent::Started { job: json!({ "id": view.id, "helper": "files", "title": view.title, "doing": view.doing }), say: view.say.clone(), speech: view.speech.clone() });
    crate::companion::badge(app, true);
    crate::refresh_tray(app);
    let app2 = app.clone();
    std::thread::Builder::new()
        .name("brenda-files-job".into())
        .spawn(move || {
            let started = Instant::now();
            let fs = fileops::RealFileSys::new();
            let render = |html: &str| crate::act::render_pdf(&app2, html);
            let tools = fileops::RealTools { render: &render };
            let mdls = fileops::RealMdls;
            let mut mac = crate::macos::RealMac::new(&app2);
            let app3 = app2.clone();
            let id = view.id.clone();
            let stop2 = stop.clone();
            let mut last_progress = Instant::now() - Duration::from_secs(1);
            // "Work on my files" is read before every call and between items (review, 16 October 2026: switching it off
            // left a running job moving files to its end). Off: the job stops, nothing more changes.
            let file_work = |a: &AppHandle| a.state::<AppState>().config.lock().unwrap().file_work;
            let mut calls = |job: &mut FilesJob, c: &CallIn, approval: Option<&Approval>| -> CallResult {
                if !file_work(&app3) {
                    stop2.store(true, Ordering::SeqCst);
                    return CallResult { id: c.id.clone(), name: c.name.clone(), ok: false, out: None, error: Some(SWITCHED_OFF.into()) };
                }
                let stopped = || stop2.load(Ordering::SeqCst) || !file_work(&app3);
                let mut progress = |p: fileops::Progress| {
                    // At most ten a second.
                    if last_progress.elapsed() >= Duration::from_millis(100) {
                        last_progress = Instant::now();
                        emit(&app3, JobEvent::Progress { job_id: id.clone(), done: p.done, of: p.of, note: p.note });
                    }
                };
                let mut open = |p: &Path, reveal: bool| {
                    use crate::macos::Mac;
                    if reveal {
                        mac.reveal(p)
                    } else {
                        mac.open_path(p)
                    }
                };
                let now = (now_ms() / 1000) as i64;
                let mut env = fileops::Env { fs: &fs, tools: &tools, mdls: &mdls, now, stopped: &stopped, progress: &mut progress, open: &mut open };
                job.run_call(&mut env, &c.id, &c.name, &c.input, approval)
            };
            let mut host = RealHost { app: app2.clone(), stop: stop.clone() };
            let end = run_files(&mut host, &mut job, &mut calls, &view, start);
            finish(&mut host, &view, &job, &end, started.elapsed().as_millis() as u64);
            let state = match &end {
                JobEnd::Done { .. } => "done",
                JobEnd::Failed { .. } => "failed",
                _ => "stopped",
            };
            let outputs = if let JobEnd::Done { outputs, .. } = &end { job.outputs_of(outputs) } else { vec![] };
            let brief = app2.state::<Jobs>().live.lock().unwrap().clone().map(|mut b| {
                b.undo = job.manifest.has_changes();
                b.outputs = outputs;
                b.folder = job.job_folder();
                b
            });
            if let Some(b) = brief {
                ended(&app2, b, state);
            }
        })
        .map_err(|_| ApiError::new(0, "I couldn't start that job."))?;
    Ok(())
}

/// Starts the Mac operator for a job (I.1): phase 2's step loop in `act.rs`.
pub fn start_operator(app: &AppHandle, view: JobView, origin: crate::act::Origin) -> Result<(), ApiError> {
    let j = app.state::<Jobs>();
    {
        let mut live = j.live.lock().unwrap();
        if live.is_some() || crate::act::live(app) {
            return Err(ApiError { status: 409, message: "I'm still on the last job. Wait for it to finish, or stop it in the notch.".into(), code: Some("JOB_BUSY".into()) });
        }
        *live = Some(JobBrief { id: view.id.clone(), helper: "operator".into(), title: view.title.clone(), doing: view.doing.clone(), state: "running".into(), at: now_ms(), undo: false, done: 0, of: 0, manifest: None, outputs: vec![], folder: None });
    }
    emit(app, JobEvent::Started { job: json!({ "id": view.id, "helper": "operator", "title": view.title, "doing": view.doing, "taskId": view.id }), say: view.say.clone(), speech: view.speech.clone() });
    let op = crate::act::OperatorJob { id: view.id.clone(), plan: view.plan.clone(), plan_sha256: view.plan_sha256.clone(), step_cap: if view.step_cap == 0 { 20 } else { view.step_cap }, doing: view.doing.clone() };
    if let Err(why) = crate::act::start_operator(app, op, origin) {
        *j.live.lock().unwrap() = None;
        let _ = post_json(app, &format!("act/{}/stop", view.id), &json!({ "version": 1, "why": "failed" }), SMALL_TIMEOUT);
        let message = if why == "accessibility" { "I need Accessibility to click and type for you." } else { "I'm still on the last job. Wait for it to finish, or stop it in the notch." };
        return Err(ApiError { status: 409, message: message.into(), code: Some(if why == "accessibility" { "ACT_ACCESSIBILITY".into() } else { "JOB_BUSY".into() }) });
    }
    Ok(())
}

/// The jobs this Mac knows (the live one and the last three finished), with the manifests on disk after a restart.
pub fn list(app: &AppHandle) -> Vec<JobBrief> {
    let Some(j) = app.try_state::<Jobs>() else { return vec![] };
    let mut out: Vec<JobBrief> = j.live.lock().unwrap().clone().into_iter().collect();
    let mut recent = j.recent.lock().unwrap().clone();
    if let Some(dir) = undo_dir(app) {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                if let Some((h, ops)) = fileops::read_manifest(&p) {
                    if !recent.iter().any(|r| r.id == h.job_id) && out.iter().all(|l| l.id != h.job_id) {
                        recent.push(JobBrief { id: h.job_id, helper: "files".into(), title: h.title, doing: String::new(), state: if h.undone_at.is_some() { "undone".into() } else { "done".into() }, at: h.at as u64 * 1000, undo: h.undone_at.is_none() && !ops.is_empty(), done: ops.len(), of: ops.len(), manifest: Some(p), outputs: vec![], folder: None });
                    }
                }
            }
        }
    }
    recent.sort_by(|a, b| b.at.cmp(&a.at));
    out.extend(recent.into_iter().take(3));
    out
}

fn find(app: &AppHandle, id: &str) -> Option<JobBrief> {
    list(app).into_iter().chain(app.try_state::<Jobs>().map(|j| j.recent.lock().unwrap().clone()).unwrap_or_default()).find(|b| b.id == id)
}

// ---- commands ------------------------------------------------------------------------------------------------------------

fn job_error(message: &str, code: &str) -> ApiError {
    ApiError { status: 0, message: message.into(), code: Some(code.into()) }
}

/// Stop: always allowed.
#[tauri::command]
pub async fn job_stop(app: AppHandle, job_id: String) {
    if live_id(&app).as_deref() == Some(job_id.as_str()) {
        stop(&app, "button");
    }
}

/// The person's answer to a job's question from the notch: a real press for the buttons, the yes grammar for words.
#[tauri::command]
pub async fn job_answer(app: AppHandle, job_id: String, answer: String, via: String, text: Option<String>) -> Result<(), ApiError> {
    if waiting(&app).as_deref() != Some(job_id.as_str()) {
        return Ok(());
    }
    let via = match via.as_str() {
        "button" => crate::act::Via::Button,
        "typed" => crate::act::Via::Typed,
        _ => return Err(job_error("Answer with the buttons or by typing.", "ACT_ANSWER")),
    };
    let name = crate::companion::name(&app);
    let d = crate::act::decide(&answer, via, text.as_deref(), &name, crate::look::is_real_press(&app), crate::input::seconds_since_post());
    match d {
        crate::act::Decision::NotAPress => Err(job_error("Press the button to answer.", "ACT_NOT_A_PRESS")),
        crate::act::Decision::Yes => {
            self::answer(&app, &job_id, (true, if via == crate::act::Via::Button { "button" } else { "typed" }, text));
            Ok(())
        }
        _ => {
            self::answer(&app, &job_id, (false, if via == crate::act::Via::Button { "button" } else { "typed" }, text));
            Ok(())
        }
    }
}

/// Carry on (an operator job's pause goes through phase 2's `act_continue`; a Files job never waits for it).
#[tauri::command]
pub async fn job_continue(app: AppHandle, job_id: String) -> Result<(), ApiError> {
    crate::act::act_continue(app, job_id).await
}

/// Undo (G.11): a real press; the manifest reversed on this Mac; Boredroom hears the counts.
#[tauri::command]
pub async fn job_undo(app: AppHandle, job_id: String) -> Result<Value, ApiError> {
    if !crate::act::real_press(&app) {
        return Err(job_error("Press Undo to put things back.", "ACT_NOT_A_PRESS"));
    }
    if live_id(&app).as_deref() == Some(job_id.as_str()) {
        return Err(job_error("Stop it first.", "JOB_LIVE"));
    }
    let brief = find(&app, &job_id).ok_or_else(|| job_error("That can't be undone any more.", "JOB_UNDO_GONE"))?;
    let path = brief.manifest.clone().ok_or_else(|| job_error("That can't be undone any more.", "JOB_UNDO_GONE"))?;
    let app2 = app.clone();
    let id = job_id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (head, ops) = fileops::read_manifest(&path).ok_or_else(|| job_error("That can't be undone any more.", "JOB_UNDO_GONE"))?;
        if head.undone_at.is_some() || head.job_id != id {
            return Err(job_error("That can't be undone any more.", "JOB_UNDO_GONE"));
        }
        let fs = fileops::RealFileSys::new();
        let c = fileops::undo(&fs, &ops);
        let _ = fileops::mark_undone(&path, (now_ms() / 1000) as i64);
        let _ = post_json(&app2, &format!("jobs/{id}/undone"), &undone_body(c.restored, c.skipped), SMALL_TIMEOUT);
        if let Some(j) = app2.try_state::<Jobs>() {
            for b in j.recent.lock().unwrap().iter_mut().filter(|b| b.id == id) {
                b.state = "undone".into();
                b.undo = false;
            }
        }
        emit(&app2, JobEvent::Undone { job_id: id.clone(), restored: c.restored, skipped: c.skipped });
        Ok(json!({ "restored": c.restored, "skipped": c.skipped }))
    })
    .await
    .map_err(|_| job_error("That didn't go through.", "JOB_UNDO"))?
}

fn output_path(app: &AppHandle, job_id: &str, index: usize) -> Result<PathBuf, ApiError> {
    let b = find(app, job_id).ok_or_else(|| job_error("That file is gone.", "ACT_FILE"))?;
    let (_, _, p) = b.outputs.get(index).cloned().ok_or_else(|| job_error("That file is gone.", "ACT_FILE"))?;
    // Re-checked: still a plain file, nothing that runs or holds secrets.
    let meta = std::fs::symlink_metadata(&p).map_err(|_| job_error("That file is gone.", "ACT_FILE"))?;
    if !meta.is_file() || crate::guard::runs_something(&p) || crate::guard::secret_file(&p) {
        return Err(job_error("I don't open that.", "ACT_FILE"));
    }
    Ok(p)
}

/// Opens one of a job's new files (a real press).
#[tauri::command]
pub async fn job_open_output(app: AppHandle, job_id: String, index: usize) -> Result<(), ApiError> {
    use tauri_plugin_opener::OpenerExt;
    if !crate::act::real_press(&app) {
        return Err(job_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    let p = output_path(&app, &job_id, index)?;
    app.opener().open_path(p.to_string_lossy().to_string(), None::<&str>).map_err(|_| job_error("I couldn't open that file.", "ACT_FILE"))
}

/// Shows one of a job's new files in Finder (a real press).
#[tauri::command]
pub async fn job_reveal_output(app: AppHandle, job_id: String, index: usize) -> Result<(), ApiError> {
    use tauri_plugin_opener::OpenerExt;
    if !crate::act::real_press(&app) {
        return Err(job_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    let p = output_path(&app, &job_id, index)?;
    app.opener().reveal_item_in_dir(p).map_err(|_| job_error("I couldn't show that file.", "ACT_FILE"))
}

/// Shows the folder a finished job changed things in, in Finder (a real press; review, 16 October 2026: the organise
/// card offered only Undo). Only a plain folder inside the allowed folders it had, re-checked now.
#[tauri::command]
pub async fn job_show_folder(app: AppHandle, job_id: String) -> Result<(), ApiError> {
    use tauri_plugin_opener::OpenerExt;
    if !crate::act::real_press(&app) {
        return Err(job_error("Press the button.", "ACT_NOT_A_PRESS"));
    }
    let b = find(&app, &job_id).ok_or_else(|| job_error("That folder is gone.", "ACT_FILE"))?;
    let p = b.folder.ok_or_else(|| job_error("That folder is gone.", "ACT_FILE"))?;
    let meta = std::fs::symlink_metadata(&p).map_err(|_| job_error("That folder is gone.", "ACT_FILE"))?;
    if !meta.is_dir() || p.extension().is_some() {
        return Err(job_error("I don't open that.", "ACT_FILE"));
    }
    app.opener().open_path(p.to_string_lossy().to_string(), None::<&str>).map_err(|_| job_error("I couldn't show that folder.", "ACT_FILE"))
}

/// The live job and the last three finished on this Mac.
#[tauri::command]
pub async fn job_list(app: AppHandle) -> Vec<JobBrief> {
    list(&app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fileops::tests::{job, Run, Tree};
    use std::collections::VecDeque;

    /// Boredroom, scripted: the answers in order, every post recorded. A fake clock moves only when the runner sleeps.
    struct Scripted {
        answers: VecDeque<Result<Value, ApiError>>,
        posts: Vec<(String, Value)>,
        events: Vec<JobEvent>,
        replies: VecDeque<Option<(bool, &'static str, Option<String>)>>,
        stop_after_posts: Option<usize>,
        wall: SystemTime,
        mono: Instant,
        slept_ms: u64,
        /// The Mac sleeps (the wall clock jumps an hour) at the next progress event.
        sleep_at_progress: bool,
    }

    impl Scripted {
        fn new(answers: Vec<Result<Value, ApiError>>) -> Self {
            Scripted { answers: answers.into(), posts: vec![], events: vec![], replies: VecDeque::new(), stop_after_posts: None, wall: SystemTime::now(), mono: Instant::now(), slept_ms: 0, sleep_at_progress: false }
        }
        fn phases(&self) -> Vec<String> {
            self.events.iter().map(|e| serde_json::to_value(e).unwrap()["phase"].as_str().unwrap().to_string()).collect()
        }
        fn step_posts(&self) -> Vec<&Value> {
            self.posts.iter().filter(|(t, _)| t.ends_with("/step")).map(|(_, b)| b).collect()
        }
    }

    impl JobHost for Scripted {
        fn post(&mut self, tail: &str, body: &Value) -> Result<Value, ApiError> {
            self.posts.push((tail.to_string(), body.clone()));
            if tail.ends_with("/step") {
                return self.answers.pop_front().unwrap_or_else(|| Err(ApiError::new(500, "no more answers")));
            }
            Ok(json!({ "ok": true }))
        }
        fn emit(&mut self, e: JobEvent) {
            if self.sleep_at_progress && matches!(e, JobEvent::Progress { .. }) {
                self.sleep_at_progress = false;
                self.wall += Duration::from_secs(3_600);
            }
            self.events.push(e);
        }
        fn wait_answer(&mut self, _ms: u64) -> Option<(bool, &'static str, Option<String>)> {
            self.replies.pop_front().flatten()
        }
        fn stopped(&self) -> bool {
            self.stop_after_posts.is_some_and(|n| self.step_posts().len() >= n)
        }
        fn sleep(&mut self, ms: u64) -> bool {
            self.slept_ms += ms;
            self.mono += Duration::from_millis(ms);
            self.wall += Duration::from_millis(ms);
            !self.stopped()
        }
        fn clocks(&self) -> (SystemTime, Instant) {
            (self.wall, self.mono)
        }
    }

    fn view() -> JobView {
        JobView { id: "0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30".into(), helper: "files".into(), title: "Delete my old screenshots".into(), doing: "Clearing out screenshots".into(), goal: "Delete my old screenshots.".into(), plan: "I'll delete my old screenshots.".into(), plan_sha256: String::new(), step_cap: 40, started_at: None, say: String::new(), speech: Value::Null }
    }

    fn drive(t: &Tree, host: &mut Scripted, job: &mut FilesJob) -> JobEnd {
        let mut run = Run::new(t);
        let mut calls = |job: &mut FilesJob, c: &CallIn, a: Option<&Approval>| run.call(job, &c.name, c.input.clone(), a);
        let start = start_body(job, &[]);
        run_files(host, job, &mut calls, &view(), start)
    }

    fn act(step: u32, calls: Value, approved: Value) -> Result<Value, ApiError> {
        Ok(json!({ "status": "act", "calls": calls, "approved": approved, "note": "Looking at your Desktop", "append": [{ "role": "assistant", "content": [] }], "step": step, "stepsLeft": 40 - step }))
    }

    /// M.2 (integration, 16 October 2026): the router's line and its natural-voice offer ride on `started`, at the top
    /// level where the page reads them; without a line, neither is sent.
    #[test]
    fn started_carries_the_routers_line() {
        let offer = json!({ "path": "/api/orgs/a/assistant/speech", "token": "t", "text": "Organising your Desktop." });
        let e = serde_json::to_value(JobEvent::Started { job: json!({ "id": "x" }), say: "Organising your Desktop.".into(), speech: offer.clone() }).unwrap();
        assert_eq!(e["phase"], "started");
        assert_eq!(e["say"], "Organising your Desktop.");
        assert_eq!(e["speech"], offer);
        let bare = serde_json::to_value(JobEvent::Started { job: json!({ "id": "x" }), say: String::new(), speech: Value::Null }).unwrap();
        assert!(bare.get("say").is_none() && bare.get("speech").is_none());
        let v: JobView = serde_json::from_value(json!({ "id": "x", "helper": "files", "title": "T", "doing": "D", "say": "never from the server", "speech": { "token": "no" } })).unwrap();
        assert!(v.say.is_empty() && v.speech.is_null(), "the job's own answer never sets them");
    }

    /// G.5 (integration, 16 October 2026): a folder macOS refused makes the end card offer Open System Settings.
    #[test]
    fn a_refused_folder_offers_system_settings() {
        use std::os::unix::fs::PermissionsExt;
        let t = Tree::new("jobdenied");
        t.file("Desktop/a.txt", "a");
        let desk = t.home.join("Desktop");
        std::fs::set_permissions(&desk, std::fs::Permissions::from_mode(0o000)).unwrap();
        let mut host = Scripted::new(vec![
            act(1, json!([{ "id": "toolu_1", "name": "list_files", "input": { "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] } }]), Value::Null),
            Ok(json!({ "status": "cannot", "reason": "Your Mac hasn't let me into your Desktop.", "append": [], "step": 2 })),
        ]);
        let mut j = job(&t);
        let end = drive(&t, &mut host, &mut j);
        std::fs::set_permissions(&desk, std::fs::Permissions::from_mode(0o755)).unwrap();
        let steps = host.step_posts();
        assert_eq!(steps[1]["results"][0]["error"], "Not done: your Mac hasn't let Brenda into Desktop.");
        assert!(j.denied);
        finish(&mut host, &view(), &j, &end, 1_000);
        let e = serde_json::to_value(host.events.last().unwrap()).unwrap();
        assert_eq!((e["phase"].as_str(), e["why"].as_str(), e["settings"].as_bool()), (Some("stopped"), Some("cannot"), Some(true)));
        assert_eq!(e["summary"], "Your Mac hasn't let me into your Desktop.");
        // Without a refusal the flag isn't sent at all.
        let ok = serde_json::to_value(JobEvent::Failed { job_id: "x".into(), code: None, message: "m".into(), undo: false, settings: false }).unwrap();
        assert!(ok.get("settings").is_none());
    }

    /// G.3, G.4: step 0 with start → act → results → ask → yes → the held trash → finished → done.
    #[test]
    fn files_state_machine() {
        let t = Tree::new("jobsm");
        t.file("Desktop/Screenshot 1.png", "1");
        t.file("Desktop/Screenshot 2.png", "2");
        t.file("Desktop/keep.txt", "k");
        let refs = vec!["e1".to_string(), "e2".to_string()];
        let mut host = Scripted::new(vec![
            act(1, json!([{ "id": "toolu_1", "name": "list_files", "input": { "folder": "f1", "recursive": false, "kinds": ["screenshot"], "since_days": 0, "words": [] } }]), Value::Null),
            ask(2, &refs, "move 2 screenshots to the Trash"),
            act(3, json!([{ "id": "toolu_2", "name": "trash", "input": { "refs": refs, "what": "screenshots" } }]), json!({ "kind": "delete", "count": 2, "refsSha256": fileops::refs_sha256(&refs) })),
            Ok(json!({ "status": "finished", "summary": "I moved 2 screenshots to the Trash.", "outputs": [], "speech": null, "append": [], "step": 4 })),
        ]);
        host.replies.push_back(Some((true, "button", None)));
        let mut j = job(&t);
        let end = drive(&t, &mut host, &mut j);
        assert_eq!(end, JobEnd::Done { summary: "I moved 2 screenshots to the Trash.".into(), outputs: vec![], speech: Value::Null });
        let steps = host.step_posts();
        assert_eq!(steps[0]["step"], 0);
        assert_eq!(steps[0]["start"]["folders"][0]["title"], "Desktop");
        assert!(steps[0]["start"]["folders"][0].get("path").is_none(), "paths never leave the Mac");
        assert_eq!(steps[1]["results"][0]["ok"], true);
        assert_eq!(steps[1]["results"][0]["out"]["items"].as_array().unwrap().len(), 2);
        assert_eq!(steps[1]["transcript"].as_array().unwrap().len(), 1, "the Mac holds the transcript");
        assert_eq!(steps[2]["askAnswered"], true);
        assert_eq!(steps[3]["results"][0]["out"]["done"], 2);
        assert_eq!(steps[3]["undo"], true);
        let answer = host.posts.iter().find(|(t, _)| t.ends_with("/step-answer")).unwrap();
        assert_eq!(answer.1["answer"], "yes");
        assert_eq!(answer.1["askSha256"], crate::act::sha256_hex("move 2 screenshots to the Trash"));
        assert!(t.home.join("Desktop/keep.txt").exists());
        assert_eq!(std::fs::read_dir(&t.trash).unwrap().count(), 2);
        assert!(host.phases().contains(&"ask".to_string()));
        // The card's words are the Mac's, from the files (review, 16 October 2026).
        let shown = host.events.iter().find_map(|e| if let JobEvent::Ask { ask, .. } = e { Some(ask.clone()) } else { None }).unwrap();
        assert_eq!(shown["question"], "Move 2 screenshots to the Trash?");
        let because = shown["because"].as_str().unwrap();
        assert!(because.contains("“Screenshot 1.png”") && because.contains("“Screenshot 2.png”") && because.ends_with("You can put them back from the Trash."), "{because}");
        assert!(shown.get("what").is_none(), "the model's words for them are never shown");
    }

    /// A Trash step reply (an ask) as the server sends it since review, 16 October 2026: the refs and their SHA-256.
    fn ask(step: u32, refs: &[String], what: &str) -> Result<Value, ApiError> {
        Ok(json!({ "status": "ask", "ask": { "kind": "delete", "what": what, "question": "Move them to the Trash?", "because": "You can put them back from the Trash.", "count": refs.len(), "refs": refs, "refsSha256": fileops::refs_sha256(refs) }, "append": [], "step": step }))
    }

    fn list_all(step: u32) -> Result<Value, ApiError> {
        act(step, json!([{ "id": "toolu_1", "name": "list_files", "input": { "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] } }]), Value::Null)
    }

    /// Review, 16 October 2026 (safety-1): an `approved` with no question shown and no yes heard on this Mac moves
    /// nothing, even when it names exactly the refs of the call.
    #[test]
    fn an_approval_without_a_yes_here_is_refused() {
        let t = Tree::new("jobnoask");
        t.file("Desktop/Screenshot 1.png", "1");
        let refs = vec!["e1".to_string()];
        let mut host = Scripted::new(vec![
            list_all(1),
            act(2, json!([{ "id": "toolu_2", "name": "trash", "input": { "refs": refs, "what": "screenshots" } }]), json!({ "kind": "delete", "count": 1, "refsSha256": fileops::refs_sha256(&refs) })),
            Ok(json!({ "status": "finished", "summary": "x", "outputs": [], "append": [], "step": 3 })),
        ]);
        let mut j = job(&t);
        drive(&t, &mut host, &mut j);
        assert_eq!(std::fs::read_dir(&t.trash).unwrap().count(), 0, "nothing moved");
        assert_eq!(host.step_posts()[2]["results"][0]["ok"], false);
        assert!(!host.phases().contains(&"ask".to_string()));
    }

    /// Review, 16 October 2026 (safety-1): a yes covers the very next reply only, once; a replayed approval moves nothing.
    #[test]
    fn a_yes_covers_one_reply_once() {
        let t = Tree::new("jobonce");
        t.file("Desktop/Screenshot 1.png", "1");
        t.file("Desktop/Screenshot 2.png", "2");
        let one = vec!["e1".to_string()];
        let approved = json!({ "kind": "delete", "count": 1, "refsSha256": fileops::refs_sha256(&one) });
        let trash = json!([{ "id": "toolu_2", "name": "trash", "input": { "refs": one, "what": "screenshots" } }]);
        let mut host = Scripted::new(vec![
            list_all(1),
            ask(2, &one, "move 1 screenshot to the Trash"),
            act(3, json!([trash[0], trash[0]]), approved.clone()),
            act(4, trash.clone(), approved),
            Ok(json!({ "status": "finished", "summary": "x", "outputs": [], "append": [], "step": 5 })),
        ]);
        host.replies.push_back(Some((true, "button", None)));
        let mut j = job(&t);
        drive(&t, &mut host, &mut j);
        let steps = host.step_posts();
        assert_eq!(steps[3]["results"][0]["ok"], true, "the call the person said yes to");
        assert_eq!(steps[3]["results"][1]["ok"], false, "a second call in the same reply: no");
        assert_eq!(steps[4]["results"][0]["ok"], false, "the approval again on the next reply: no");
        assert_eq!(std::fs::read_dir(&t.trash).unwrap().count(), 1);
    }

    /// Review, 16 October 2026 (safety-3): the question names what will really move, whatever the model called them;
    /// refs that don't match their SHA-256, or that this job doesn't know, ask nothing and move nothing.
    #[test]
    fn the_trash_question_is_built_from_the_files() {
        let t = Tree::new("jobwords");
        t.file("Desktop/Invoice Q3.pdf", "i");
        t.file("Desktop/Screenshot 1.png", "1");
        t.file("Desktop/Screenshot 2.png", "2");
        let mut j = job(&t);
        let mut run = Run::new(&t);
        run.call(&mut j, "list_files", json!({ "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] }), None);
        let all: Vec<String> = (1..=3).map(|i| format!("e{i}")).collect();
        let (shown, kept) = trash_ask(&j, &json!({ "kind": "delete", "what": "move 3 screenshots to the Trash", "count": 3, "refs": all, "refsSha256": fileops::refs_sha256(&all) })).unwrap();
        assert_eq!(shown["question"], "Move 3 files to the Trash?");
        let because = shown["because"].as_str().unwrap();
        assert!(because.starts_with("2 screenshots and 1 PDF: "), "{because}");
        assert!(because.contains(" and 1 more. You can put them back from the Trash."), "{because}");
        assert_eq!(kept, Approval { count: 3, refs_sha256: fileops::refs_sha256(&all) });
        // A SHA-256 that isn't these refs', a count that isn't theirs, a ref the job never listed: nothing is asked.
        assert!(trash_ask(&j, &json!({ "kind": "delete", "count": 3, "refs": all, "refsSha256": fileops::refs_sha256(&all[..2]) })).is_none());
        assert!(trash_ask(&j, &json!({ "kind": "delete", "count": 2, "refs": all, "refsSha256": fileops::refs_sha256(&all) })).is_none());
        let ghost = vec!["e9".to_string()];
        assert!(trash_ask(&j, &json!({ "kind": "delete", "count": 1, "refs": ghost, "refsSha256": fileops::refs_sha256(&ghost) })).is_none());
        assert!(trash_ask(&j, &json!({ "kind": "delete", "count": 1, "what": "move 1 file to the Trash" })).is_none(), "an ask without its refs");
        // In a job: the unreadable ask is answered no ("unresolved") and the job ends with nothing moved.
        let mut host = Scripted::new(vec![list_all(1), ask(2, &ghost, "move 1 file to the Trash")]);
        let mut j2 = job(&t);
        let end = drive(&t, &mut host, &mut j2);
        assert!(matches!(end, JobEnd::Cannot { .. }), "{end:?}");
        let a = host.posts.iter().find(|(t, _)| t.ends_with("/step-answer")).unwrap();
        assert_eq!((a.1["answer"].as_str(), a.1["via"].as_str()), (Some("no"), Some("unresolved")));
        assert!(!host.phases().contains(&"ask".to_string()));
        assert_eq!(std::fs::read_dir(&t.trash).unwrap().count(), 0);
    }

    /// Review, 16 October 2026 (safety-2): every switch that turns her file work or actions off stops a running job,
    /// and the Files helper reads "Work on my files" before every call and between items.
    #[test]
    fn switching_off_stops_a_job() {
        let read = |f: &str| std::fs::read_to_string(format!("{}/src/{f}", env!("CARGO_MANIFEST_DIR"))).unwrap();
        let body = |src: &str, start: &str| -> String {
            let at = src.find(start).unwrap_or_else(|| panic!("{start}"));
            let rest = &src[at..];
            rest[..rest.find("\n}\n").unwrap()].to_string()
        };
        let act = read("act.rs");
        let look = read("look.rs");
        let lib = read("lib.rs");
        for (src, f) in [(&act, "pub async fn act_set_use_mac("), (&act, "pub async fn act_set_file_work("), (&look, "pub async fn set_screen_help("), (&look, "pub fn screen_help_off("), (&look, "pub async fn set_look_rules(")] {
            assert!(body(src, f).contains("jobs::switched_off("), "{f} leaves a job running");
        }
        assert!(body(&lib, "\"act_mac\" | \"act_files\" =>").contains("jobs::switched_off("));
        let jobs = read("jobs.rs");
        let start = body(&jobs, "pub fn start_files(");
        assert!(start.contains("if !file_work(&app3)") && start.contains("|| !file_work(&app3)"), "read before every call and between items");
    }

    /// The notch preview's `job-replay` events (ignored; JOB_REPLAY_OUT=<file> writes them): this runner and fileops
    /// organising 64 files on a temp Desktop by kind, the end card as `finish` words it, and Undo's counts.
    #[test]
    #[ignore]
    fn replay_organise() {
        let Ok(out) = std::env::var("JOB_REPLAY_OUT") else { return };
        let t = Tree::new("replay");
        let kinds = ["pdf", "png", "docx", "xlsx", "key", "mov", "mp3", "zip", "fig", "txt"];
        let mut n = 0;
        for i in 0..64 {
            let ext = kinds[[0, 1, 1, 2, 3, 4, 5][i % 7]];
            t.file(&format!("Desktop/file {i:02}.{ext}"), "x");
            n += 1;
        }
        assert_eq!(n, 64);
        let mut v = view();
        v.id = "9b2f1c3e-6d4a-4e8b-9f10-2a3b4c5d6e7f".into();
        v.title = "Organise your Desktop".into();
        v.doing = "Organising your Desktop".into();
        let mut host = Scripted::new(vec![
            act(1, json!([{ "id": "toolu_1", "name": "organise", "input": { "folder": "f1", "by": "kind" } }]), Value::Null),
            Ok(json!({ "status": "finished", "summary": "I moved 64 files into 7 folders on your Desktop.", "outputs": [], "speech": null, "append": [], "step": 2 })),
        ]);
        let mut j = job(&t);
        let mut run = Run::new(&t);
        let end = {
            let mut calls = |job: &mut FilesJob, c: &CallIn, a: Option<&Approval>| run.call(job, &c.name, c.input.clone(), a);
            let start = start_body(&mut j, &[]);
            run_files(&mut host, &mut j, &mut calls, &v, start)
        };
        finish(&mut host, &v, &j, &end, 12_000);
        let mut events = vec![serde_json::to_value(JobEvent::Started { job: json!({ "id": v.id, "helper": "files", "title": v.title, "doing": v.doing }), say: String::new(), speech: Value::Null }).unwrap()];
        let (last, before) = host.events.split_last().unwrap();
        events.extend(before.iter().map(|e| serde_json::to_value(e).unwrap()));
        // fileops' own progress, as `start_files` sends it (at most ten a second: every fourth here).
        let p = &run.progress;
        events.extend(p.iter().enumerate().filter(|(i, _)| i % 4 == 0 || *i + 1 == p.len()).map(|(_, x)| serde_json::to_value(JobEvent::Progress { job_id: v.id.clone(), done: x.done, of: x.of, note: x.note.clone() }).unwrap()));
        events.push(serde_json::to_value(last).unwrap());
        let c = fileops::undo(&run.fs, &j.manifest.ops);
        std::fs::write(out, serde_json::to_string_pretty(&json!({ "events": events, "undo": { "restored": c.restored, "skipped": c.skipped } })).unwrap()).unwrap();
    }

    #[test]
    fn files_job_needs_token_answer() {
        // The job starts only from POST /assistant/jobs with the router's token (`create_job`), from `front.rs`.
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            let code: String = src.split("#[cfg(test)]").next().unwrap().to_string();
            for f in ["jobs::create_job(", "jobs::start_files(", "jobs::start_operator("] {
                if code.contains(f) {
                    assert_eq!(name, "front.rs", "{name} starts a job");
                }
            }
        }
        let src = std::fs::read_to_string(format!("{dir}/jobs.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        assert!(code.contains("\"token\": token"));
    }

    #[test]
    fn trash_only_with_approval_for_those_refs() {
        let t = Tree::new("jobtrash");
        t.file("Desktop/Screenshot 1.png", "1");
        t.file("Desktop/Screenshot 2.png", "2");
        // The server's approval names one ref; the call asks for two: nothing moves.
        let refs = vec!["e1".to_string(), "e2".to_string()];
        let mut host = Scripted::new(vec![
            act(1, json!([{ "id": "toolu_1", "name": "list_files", "input": { "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] } }]), Value::Null),
            act(2, json!([{ "id": "toolu_2", "name": "trash", "input": { "refs": refs, "what": "screenshots" } }]), json!({ "kind": "delete", "count": 1, "refsSha256": fileops::refs_sha256(&refs[..1]) })),
            act(3, json!([{ "id": "toolu_3", "name": "trash", "input": { "refs": refs, "what": "screenshots" } }]), Value::Null),
            Ok(json!({ "status": "finished", "summary": "Nothing moved.", "outputs": [], "append": [], "step": 4 })),
        ]);
        let mut j = job(&t);
        drive(&t, &mut host, &mut j);
        assert_eq!(std::fs::read_dir(&t.trash).unwrap().count(), 0);
        let steps = host.step_posts();
        assert_eq!(steps[2]["results"][0]["ok"], false);
        assert_eq!(steps[3]["results"][0]["ok"], false, "no approval at all: no");
    }

    #[test]
    fn a_no_ends_the_job() {
        let t = Tree::new("jobno");
        t.file("Desktop/Screenshot 1.png", "1");
        let refs = vec!["e1".to_string()];
        let mut host = Scripted::new(vec![list_all(1), ask(2, &refs, "move 1 screenshot to the Trash")]);
        host.replies.push_back(None);
        let mut j = job(&t);
        assert_eq!(drive(&t, &mut host, &mut j), JobEnd::SaidNo, "silence is no");
        let a = host.posts.iter().find(|(t, _)| t.ends_with("/step-answer")).unwrap();
        assert_eq!((a.1["answer"].as_str(), a.1["via"].as_str()), (Some("no"), Some("timeout")));
    }

    #[test]
    fn stop_mid_batch_keeps_manifest() {
        let t = Tree::new("jobstop");
        for i in 0..30 {
            t.file(&format!("Desktop/f{i}.txt"), "x");
        }
        let dir = t.base.join("undo");
        let head = fileops::ManifestHead { job_id: view().id, title: "Organise".into(), at: 1, undone_at: None };
        let mut j = FilesJob::new(t.roots(), vec![], fileops::Manifest::create(&dir, &head).unwrap());
        let mut host = Scripted::new(vec![
            act(1, json!([{ "id": "toolu_1", "name": "organise", "input": { "folder": "f1", "by": "kind" } }]), Value::Null),
            Ok(json!({ "status": "finished", "summary": "x", "outputs": [], "append": [], "step": 2 })),
        ]);
        let mut run = Run::new(&t);
        run.stop_at = Some(10);
        let mut calls = |job: &mut FilesJob, c: &CallIn, a: Option<&Approval>| run.call(job, &c.name, c.input.clone(), a);
        let start = start_body(&mut j, &[]);
        let end = run_files(&mut host, &mut j, &mut calls, &view(), start);
        let moved = j.manifest.ops.iter().filter(|o| matches!(o, fileops::Op::Moved { .. })).count();
        assert!(moved > 0 && moved < 30, "stopped part way: {moved}");
        let (_, on_disk) = fileops::read_manifest(j.manifest.path().unwrap()).unwrap();
        assert_eq!(on_disk.len(), j.manifest.ops.len(), "every finished item is on disk for Undo");
        let _ = end;
        let mut h2 = Scripted::new(vec![]);
        finish(&mut h2, &view(), &j, &JobEnd::Stopped { why: "button".into() }, 10);
        assert!(h2.posts.iter().any(|(t, b)| t.ends_with("/stop") && b["why"] == "button"));
        assert!(matches!(&h2.events[0], JobEvent::Stopped { summary, undo: true, .. } if summary == "I stopped. What I did stays done, and Undo puts it back."));
        let c = fileops::undo(&run.fs, &on_disk);
        assert_eq!(c.skipped, 0);
        assert_eq!(std::fs::read_dir(t.home.join("Desktop")).unwrap().count(), 30, "Undo puts every file back");
    }

    #[test]
    fn pause_on_sleep_gap_and_resume() {
        let t = Tree::new("jobsleep");
        let mut host = Scripted::new(vec![
            act(1, json!([]), Value::Null),
            Ok(json!({ "status": "finished", "summary": "Done.", "outputs": [], "append": [], "step": 2 })),
        ]);
        host.sleep_at_progress = true;
        // The wall clock jumps an hour between the loops: the runner notices on the next post.
        let mut j = job(&t);
        let mut run = Run::new(&t);
        let mut calls = |job: &mut FilesJob, c: &CallIn, a: Option<&Approval>| run.call(job, &c.name, c.input.clone(), a);
        let start = start_body(&mut j, &[]);
        let end = run_files(&mut host, &mut j, &mut calls, &view(), start);
        assert!(matches!(end, JobEnd::Done { .. }));
        assert_eq!(host.phases(), ["progress", "paused", "resumed"]);
        assert!(slept((SystemTime::now(), Instant::now()), (SystemTime::now() + Duration::from_secs(120), Instant::now())));
        assert!(!slept((SystemTime::now(), Instant::now()), (SystemTime::now() + Duration::from_secs(5), Instant::now())));
        // A lost connection: paused, retried after 2 s, then resumed.
        let mut host = Scripted::new(vec![Err(ApiError::new(0, "Cannot reach Boredroom")), Ok(json!({ "status": "finished", "summary": "Done.", "outputs": [], "append": [], "step": 1 }))]);
        let mut j = job(&t);
        let end = drive(&t, &mut host, &mut j);
        assert!(matches!(end, JobEnd::Done { .. }));
        assert_eq!(host.phases(), ["paused", "resumed"]);
        assert_eq!(host.slept_ms, 2_000);
        assert!(host.posts.iter().any(|(t, b)| t.ends_with("/state") && b["state"] == "running"));
    }

    #[test]
    fn offline_30_minutes_stops() {
        let t = Tree::new("joboffline");
        let answers: Vec<Result<Value, ApiError>> = (0..100).map(|_| Err(ApiError::new(0, "Cannot reach Boredroom"))).collect();
        let mut host = Scripted::new(answers);
        let mut j = job(&t);
        assert_eq!(drive(&t, &mut host, &mut j), JobEnd::Offline);
        let waited = host.slept_ms / 1000;
        assert!((1_800..=1_900).contains(&waited), "about 30 minutes of retries: {waited} s");
        assert_eq!(&RETRY_STEPS[..], &[2, 4, 8, 16, 30, 60]);
        let mut h2 = Scripted::new(vec![]);
        finish(&mut h2, &view(), &j, &JobEnd::Offline, 1);
        assert!(matches!(&h2.events[0], JobEvent::Stopped { why, .. } if why == "offline"));
    }

    #[test]
    fn one_live_job() {
        // The registry holds one live job; a second start is refused before anything happens (JOB_BUSY).
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/jobs.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        let start = &code[code.find("pub fn start_files(").unwrap()..];
        let first = &start[..start.find("*live = Some(").unwrap()];
        assert!(first.contains("if live.is_some()") && first.contains("JOB_BUSY"));
        let op = &code[code.find("pub fn start_operator(").unwrap()..];
        assert!(op[..op.find("*live = Some(").unwrap()].contains("crate::act::live(app)"), "one computer-use runner");
    }

    #[test]
    fn too_many_calls_in_one_turn() {
        let t = Tree::new("jobmany");
        let calls: Vec<Value> = (0..9).map(|i| json!({ "id": format!("toolu_{i}"), "name": "list_files", "input": { "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] } })).collect();
        let mut host = Scripted::new(vec![act(1, json!(calls), Value::Null), Ok(json!({ "status": "finished", "summary": "x", "outputs": [], "append": [], "step": 2 }))]);
        let mut j = job(&t);
        drive(&t, &mut host, &mut j);
        let r = &host.step_posts()[1]["results"];
        assert_eq!(r.as_array().unwrap().len(), 9);
        assert!(r.as_array().unwrap().iter().all(|x| x["error"] == fileops::TOO_MANY_CALLS));
    }

    fn seam_dir() -> Option<String> {
        std::env::var("BRENDA_SEAM_DIR").ok().filter(|d| !d.is_empty())
    }

    /// T.2: the job bodies as Rust writes them: create, step 0, a step with a result of every H.5 shape, the step after
    /// a yes, the state and Undo bodies.
    #[test]
    #[ignore]
    fn seam_job_bodies() {
        let Some(dir) = seam_dir() else { return };
        let w = |name: &str, v: &Value| std::fs::write(format!("{dir}/rust-{name}.json"), serde_json::to_vec_pretty(v).unwrap()).unwrap();
        // A token shaped like the router's (`signPayload`: base64url body, a dot, the signature); the server's schema
        // reads 10 to 8,000 characters (integration, 16 October 2026).
        w("jobs-create", &create_body("eyJrIjoiam9iIiwiaCI6ImZpbGVzIiwiZXhwIjoxNzYwMjgxNDI1fQ.c2VhbS1zaWduYXR1cmUtZm9yLXRoZS1pbnRlZ3JhdG9y", Some(("button", None)), false));
        w("job-state", &state_body("paused", "sleep"));
        w("job-undone", &undone_body(64, 2));
        let t = Tree::new("seamjob");
        t.file("Desktop/Screenshot 1.png", "1");
        t.file("Desktop/Q3 report.docx", "q");
        t.file("Desktop/IMG_1.jpg", "i");
        t.file("Desktop/notes.txt", "hello");
        let calls = json!([
            { "id": "toolu_01", "name": "list_files", "input": { "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] } },
            { "id": "toolu_02", "name": "read_text", "input": { "ref": "e4" } },
            { "id": "toolu_03", "name": "make_folder", "input": { "in": "f1", "name": "Finance" } },
            { "id": "toolu_04", "name": "copy", "input": { "refs": ["e4"], "to": "n1" } },
            { "id": "toolu_05", "name": "rename", "input": { "items": [{ "ref": "e3", "name": "Report" }] } },
            { "id": "toolu_06", "name": "rename_by_date", "input": { "refs": ["e1"] } },
            { "id": "toolu_07", "name": "convert", "input": { "ref": "e3", "to": "pdf" } },
            { "id": "toolu_08", "name": "write_file", "input": { "in": "f1", "name": "Desktop summary.md", "format": "md", "content": "# Desktop" } }
        ]);
        let more = json!([
            { "id": "toolu_09", "name": "move", "input": { "refs": ["e2"], "to": "n1" } },
            { "id": "toolu_10", "name": "organise", "input": { "folder": "f1", "by": "kind" } },
            { "id": "toolu_11", "name": "open", "input": { "ref": "n3", "reveal": true } }
        ]);
        let mut host = Scripted::new(vec![
            act(1, calls, Value::Null),
            act(2, more, Value::Null),
            ask(3, &["n4".to_string()], "move 1 file to the Trash"),
            act(4, json!([{ "id": "toolu_12", "name": "trash", "input": { "refs": ["n4"], "what": "files" } }]), json!({ "kind": "delete", "count": 1, "refsSha256": fileops::refs_sha256(&["n4".to_string()]) })),
            Ok(json!({ "status": "finished", "summary": "Done.", "outputs": [], "append": [], "step": 5 })),
        ]);
        host.replies.push_back(Some((true, "button", None)));
        let mut j = job(&t);
        let end = drive(&t, &mut host, &mut j);
        assert!(matches!(end, JobEnd::Done { .. }), "{end:?}");
        let steps = host.step_posts();
        w("files-step-0", steps[0]);
        // Each step as the Mac posts it (at most 8 results, the server's `callsPerTurn`): between them, a result of every
        // H.5 shape (integration, 16 October 2026; it was one merged body of 12, which the server refuses).
        for (i, s) in [(1, steps[1]), (2, steps[2]), (4, steps[4])] {
            let results = s["results"].as_array().unwrap();
            assert!(!results.is_empty() && results.len() <= 8 && results.iter().all(|r| r["ok"] == true), "{s}");
            w(&format!("files-step-{i}"), s);
        }
        w("files-step-asked", steps[3]);
    }

    /// T.2: the server's job answers, read the way the runner reads them.
    #[test]
    #[ignore]
    fn seam_server_job_answers() {
        let Some(dir) = seam_dir() else { return };
        if let Ok(b) = std::fs::read(format!("{dir}/server-jobs-create.json")) {
            let v: Value = serde_json::from_slice(&b).unwrap();
            let view: JobView = serde_json::from_value(v["job"].clone()).unwrap();
            assert!(view_ok(&view), "{view:?}");
        }
        for (name, status) in [("server-files-step-act.json", "act"), ("server-files-step-ask.json", "ask"), ("server-files-step-approved.json", "act"), ("server-files-step-finished.json", "finished"), ("server-files-step-cannot.json", "cannot")] {
            let Ok(b) = std::fs::read(format!("{dir}/{name}")) else {
                println!("{name}: not written yet");
                continue;
            };
            let v: Value = serde_json::from_slice(&b).unwrap();
            assert_eq!(v["status"], status, "{name}");
            assert!(v["step"].as_u64().is_some() && v["append"].is_array(), "{name}");
            match status {
                "act" => assert!(v["calls"].as_array().unwrap().iter().all(|c| c["id"].is_string() && c["name"].is_string() && c["input"].is_object()), "{name}"),
                "ask" => {
                    assert!(v["ask"]["what"].is_string() && v["ask"]["question"].is_string() && v["ask"]["count"].is_u64(), "{name}");
                    // Review, 16 October 2026: the refs and their SHA-256 come with the question, and agree.
                    let refs: Vec<String> = v["ask"]["refs"].as_array().expect("refs").iter().map(|r| r.as_str().unwrap().to_string()).collect();
                    assert_eq!(v["ask"]["refsSha256"].as_str(), Some(fileops::refs_sha256(&refs).as_str()), "{name}");
                    assert_eq!(v["ask"]["count"].as_u64(), Some(refs.len() as u64), "{name}");
                }
                "finished" => assert!(v["summary"].is_string() && v["outputs"].is_array(), "{name}"),
                _ => assert!(v["reason"].is_string(), "{name}"),
            }
            if name.contains("approved") {
                assert!(v["approved"]["refsSha256"].is_string() && v["approved"]["count"].is_u64(), "{name}");
            }
        }
    }

    #[test]
    fn roots_and_start() {
        let t = Tree::new("jobroots");
        std::fs::create_dir_all(t.home.join("Documents/Invoices")).unwrap();
        std::fs::create_dir_all(t.base.join("elsewhere")).unwrap();
        let r = roots(&t.home, &[], &[t.home.join("Documents/Invoices"), t.base.join("elsewhere"), t.home.join("Documents")]);
        assert_eq!(r.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), ["Desktop", "Documents", "Downloads", "Invoices"], "a pointed folder only inside an allowed root");
        assert_eq!(r[3].source, "pointed");
    }
}
