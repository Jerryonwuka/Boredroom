//! Talking to Brenda, step one: hold to talk (owner decision, 3 October 2026).
//!
//! Hold Option+Space (Alt+Space on Windows), speak, let go. While the keys are held the microphone records; nothing is
//! recorded at any other time. On release the audio is turned into text on this computer by whisper.cpp (the
//! English "base" model, about 148 MB, downloaded once from Hugging Face when the person turns voice on), and only that
//! text goes to Boredroom, where Brenda answers with the person's own permissions. The reply is spoken by the page in
//! her ElevenLabs voice only (owner request, 27 October 2026); Rust never speaks with the computer's own voice.
//!
//! The page hears about each step through the `brenda://voice` event: `listening` (with the sound level), `transcribing`,
//! `heard` (the text), `error`, and `downloading` (with progress) while the model arrives. "Hey Brenda" (step two) will
//! only replace the trigger; everything after the recording stays the same.
//!
//! Her voice (owner decision, 7 October 2026: phase 2; owner request, 27 October 2026: "everything ElevenLabs, no local
//! voice at all"). The page plays her ElevenLabs voice and moves her face with its measured level; Rust no longer
//! renders or speaks anything with the Mac's system voice (`say`, `afplay` and `NSSpeechSynthesizer` are gone). The old
//! `speak` commands only stop and answer `unspoken`.
//!
//! The look keys (owner decisions, 11 October 2026; `look.rs`): holding Control+Command records the same way, with every
//! event tagged `lookId` so the words become the look's question. A cancelled look's sound is discarded unheard
//! (`cancelled`). The microphone is still never open unless the person holds keys, and only once voice is on.
//!
//! Answers (owner rule, 12 October 2026: "Brenda should confirm, do you want me to do this? And then I'll say, yes"):
//! while a question waits (a proposal, a step question, a Boredroom Confirm from a look), a hold of her keys or of
//! Option+Space records the answer: its events carry `answer: true` and `taskId` or `forConfirm`, no picture is taken,
//! and the words go to the yes grammar (`act::heard_answer`). While a screen task runs, Option+Space stops it instead.
//!
//!
//! Speed (owner brief, 12 October 2026: "Hearing ≤ 0.5 s … first sound ≤ 1 s"; helpers-spec K.1, K.4): whisper stays
//! base.en on the CPU, tuned: 4 threads at most, no re-decoding when unsure, the audio window sized to the clip, and the
//! app index's names in its prompt so "Figma" is heard as Figma; its logs go nowhere; the model loads at start when voice
//! is on. Option+Space's last transcript is kept 15 s (`last_talk`) so a
//! spoken request can be told from a typed one.

use futures_util::StreamExt;
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

const MODEL_FILE: &str = "ggml-base.en.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
const MODEL_MIN_BYTES: u64 = 140_000_000; // the real file is about 148 MB; anything much smaller is a broken download
const MAX_SECONDS: u64 = 30;
const MIN_SECONDS: f32 = 0.4;
const WHISPER_RATE: u32 = 16_000;

#[cfg(target_os = "macos")]
pub const SHORTCUT_LABEL: &str = "⌥ Space";
#[cfg(not(target_os = "macos"))]
pub const SHORTCUT_LABEL: &str = "Alt + Space";

/// What a recording is for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Purpose {
    /// Option+Space: ordinary talk.
    Talk,
    /// The look this recording belongs to (Control+Command, owner decisions, 11 October 2026). Only that look's
    /// release, cancel or discard ends it; Option+Space leaves it alone.
    Look(String),
    /// The answer to a waiting question (owner rule, 12 October 2026). `talk_keys`: started by Option+Space, so its
    /// release ends it; otherwise the look keys' release does.
    Answer { target: crate::act::Target, talk_keys: bool },
}

impl Purpose {
    fn look_id(&self) -> Option<String> {
        match self {
            Purpose::Look(id) => Some(id.clone()),
            _ => None,
        }
    }
}

struct Recording {
    stop: mpsc::Sender<()>,
    thread: std::thread::JoinHandle<Result<(Vec<f32>, u32), String>>,
    purpose: Purpose,
}

#[derive(Default)]
pub struct Voice {
    recording: Mutex<Option<Recording>>,
    whisper: Mutex<Option<WhisperContext>>,
    /// She is audibly speaking (a `speaking` went out from Rust): exactly one `spoken` follows. Rust no longer speaks
    /// (owner request, 27 October 2026), so this only stays false; kept so a Stop is always answered the same way.
    speech_live: AtomicBool,
    /// Where speech events are queued for the one thread that emits them (see `said`).
    speech_events: Mutex<Option<mpsc::Sender<VoiceEvent>>>,
    busy: AtomicBool,
    downloading: AtomicBool,
    /// Option+Space's last transcript and when (helpers-spec P.2: a spoken request's origin).
    last_talk: Mutex<Option<(String, Instant)>>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub enabled: bool,
    pub model_ready: bool,
    pub downloading: bool,
    pub shortcut: &'static str,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct VoiceEvent {
    phase: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<f32>,
    /// On the start of a `speaking` with no levels to follow (the fallback): the page makes its own syllables.
    #[serde(skip_serializing_if = "Option::is_none")]
    synthetic: Option<bool>,
    /// On a `spoken` that was cut off (Stop, a new reply, the talk keys, signing out).
    #[serde(skip_serializing_if = "Option::is_none")]
    interrupted: Option<bool>,
    /// On every event of a look's recording (`lookId`), so the page fills the look's question, not a chat with her.
    /// Option+Space events never carry it.
    #[serde(skip_serializing_if = "Option::is_none")]
    look_id: Option<String>,
    /// On every event of an answer's recording (B.10): the words answer a question, they are not a request.
    #[serde(skip_serializing_if = "Option::is_none")]
    answer: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    for_confirm: Option<String>,
    /// The front desk's question this answers (helpers-spec A.9).
    #[serde(skip_serializing_if = "Option::is_none")]
    front_nonce: Option<String>,
    /// The job whose question this answers (G.4).
    #[serde(skip_serializing_if = "Option::is_none")]
    job_id: Option<String>,
}

/// The event fields that say what a recording is for.
fn tag(p: &Purpose) -> VoiceEvent {
    match p {
        Purpose::Talk => VoiceEvent::default(),
        Purpose::Look(id) => VoiceEvent { look_id: Some(id.clone()), ..Default::default() },
        Purpose::Answer { target: crate::act::Target::Task(id), .. } => VoiceEvent { answer: Some(true), task_id: Some(id.clone()), ..Default::default() },
        Purpose::Answer { target: crate::act::Target::Confirm(id), .. } => VoiceEvent { answer: Some(true), for_confirm: Some(id.clone()), ..Default::default() },
        Purpose::Answer { target: crate::act::Target::Front(n), .. } => VoiceEvent { answer: Some(true), front_nonce: Some(n.clone()), ..Default::default() },
        Purpose::Answer { target: crate::act::Target::Job(id), .. } => VoiceEvent { answer: Some(true), job_id: Some(id.clone()), ..Default::default() },
    }
}

fn tagged(p: &Purpose, phase: &'static str) -> VoiceEvent {
    VoiceEvent { phase, ..tag(p) }
}

fn emit(app: &AppHandle, e: VoiceEvent) {
    let _ = app.emit("brenda://voice", e);
}

fn fail(app: &AppHandle, message: impl Into<String>, purpose: &Purpose) {
    emit(app, VoiceEvent { message: Some(message.into()), ..tagged(purpose, "error") });
}

pub fn model_path(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("models").join(MODEL_FILE))
}

pub fn model_ready(app: &AppHandle) -> bool {
    model_path(app).and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len() >= MODEL_MIN_BYTES).unwrap_or(false)
}

pub fn status(app: &AppHandle, enabled: bool) -> VoiceStatus {
    let v = app.state::<Voice>();
    VoiceStatus { enabled, model_ready: model_ready(app), downloading: v.downloading.load(Ordering::SeqCst), shortcut: SHORTCUT_LABEL }
}

// ---- the shortcut --------------------------------------------------------------------------------------------------

/// Keys down: first the task state (B.10: a running screen task stops; a waiting question is answered), then stop any
/// speech and start recording, if voice is on and the model is here.
pub fn pressed(app: &AppHandle, enabled: bool) {
    let purpose = match crate::act::hold_role(app) {
        crate::act::Role::Stop => {
            crate::act::stop(app, "talk_keys");
            return;
        }
        crate::act::Role::Answer(target) => Purpose::Answer { target, talk_keys: true },
        crate::act::Role::Free => Purpose::Talk,
    };
    stop_speaking(app);
    if !enabled {
        return emit(app, VoiceEvent { phase: "off", ..Default::default() });
    }
    if !model_ready(app) {
        return emit(app, VoiceEvent { phase: "needs-model", ..Default::default() });
    }
    let v = app.state::<Voice>();
    if v.busy.load(Ordering::SeqCst) {
        return;
    }
    let mut slot = v.recording.lock().unwrap();
    if slot.is_some() {
        return;
    }
    let (tx, rx) = mpsc::channel::<()>();
    let handle = app.clone();
    let p = purpose.clone();
    let thread = std::thread::spawn(move || record(handle, rx, p));
    *slot = Some(Recording { stop: tx, thread, purpose });
}

/// Keys up: stop recording and turn what was said into text, off the main thread. A look's recording is not
/// Option+Space's to end.
pub fn released(app: &AppHandle) {
    let v = app.state::<Voice>();
    let rec = {
        let mut slot = v.recording.lock().unwrap();
        let ours = slot.as_ref().is_some_and(|r| matches!(r.purpose, Purpose::Talk | Purpose::Answer { talk_keys: true, .. }));
        if !ours {
            return;
        }
        slot.take()
    };
    let Some(rec) = rec else { return };
    finish(app, rec);
}

/// Stops a recording and turns it into text on its own thread (its events tagged with its look, if any).
fn finish(app: &AppHandle, rec: Recording) {
    let v = app.state::<Voice>();
    let _ = rec.stop.send(());
    v.busy.store(true, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let result = rec.thread.join().unwrap_or_else(|_| Err("The microphone stopped unexpectedly.".into()));
        match result {
            Err(message) => fail(&app, message, &rec.purpose),
            Ok((samples, rate)) => transcribe_and_emit(&app, samples, rate, &rec.purpose),
        }
        app.state::<Voice>().busy.store(false, Ordering::SeqCst);
    });
}

// ---- the look's recording (owner decisions, 11 October 2026) -------------------------------------------------------

/// What the microphone did when a look started.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LookMic {
    Started,
    /// Voice is off on this Mac: the person types the question.
    Off,
    NeedsModel,
    /// Something else holds the microphone, or a transcription is still running.
    Busy,
}

/// The look keys came down: stop her speaking and record, as Option+Space does, with every event tagged `lookId`.
pub fn start_look_recording(app: &AppHandle, look_id: &str, enabled: bool) -> LookMic {
    stop_speaking(app);
    if !enabled {
        return LookMic::Off;
    }
    if !model_ready(app) {
        return LookMic::NeedsModel;
    }
    let v = app.state::<Voice>();
    if v.busy.load(Ordering::SeqCst) {
        return LookMic::Busy;
    }
    let mut slot = v.recording.lock().unwrap();
    if slot.is_some() {
        return LookMic::Busy;
    }
    let (tx, rx) = mpsc::channel::<()>();
    let handle = app.clone();
    let purpose = Purpose::Look(look_id.to_string());
    let p = purpose.clone();
    let thread = std::thread::spawn(move || record(handle, rx, p));
    *slot = Some(Recording { stop: tx, thread, purpose });
    LookMic::Started
}

fn take_look(app: &AppHandle, look_id: &str) -> Option<Recording> {
    let v = app.state::<Voice>();
    let mut slot = v.recording.lock().unwrap();
    if slot.as_ref().is_some_and(|r| r.purpose == Purpose::Look(look_id.to_string())) {
        slot.take()
    } else {
        None
    }
}

// ---- answers (owner rule, 12 October 2026) ---------------------------------------------------------------------------

/// The look keys came down while a question waits: record the answer (no picture). Voice off: nothing is recorded, and
/// the person answers in the notch.
pub fn start_answer_recording(app: &AppHandle, target: crate::act::Target, enabled: bool) {
    stop_speaking(app);
    let purpose = Purpose::Answer { target, talk_keys: false };
    if !enabled {
        return emit(app, tagged(&purpose, "off"));
    }
    if !model_ready(app) {
        return emit(app, tagged(&purpose, "needs-model"));
    }
    let v = app.state::<Voice>();
    if v.busy.load(Ordering::SeqCst) {
        return;
    }
    let mut slot = v.recording.lock().unwrap();
    if slot.is_some() {
        return;
    }
    let (tx, rx) = mpsc::channel::<()>();
    let handle = app.clone();
    let p = purpose.clone();
    let thread = std::thread::spawn(move || record(handle, rx, p));
    *slot = Some(Recording { stop: tx, thread, purpose });
}

fn take_answer(app: &AppHandle) -> Option<Recording> {
    let v = app.state::<Voice>();
    let mut slot = v.recording.lock().unwrap();
    if slot.as_ref().is_some_and(|r| matches!(r.purpose, Purpose::Answer { talk_keys: false, .. })) {
        slot.take()
    } else {
        None
    }
}

/// The look keys came up: the answer's words are turned into text on this Mac and read by the yes grammar.
pub fn finish_answer_recording(app: &AppHandle) {
    if let Some(rec) = take_answer(app) {
        finish(app, rec);
    }
}

/// The hold was cancelled (another key, Shift…): the answer is discarded unheard. Nothing is answered.
pub fn cancel_answer_recording(app: &AppHandle) {
    let Some(rec) = take_answer(app) else { return };
    let _ = rec.stop.send(());
    let app = app.clone();
    std::thread::spawn(move || {
        if let Ok(Ok((mut samples, _))) = rec.thread.join() {
            samples.fill(0.0);
        }
        emit(&app, tagged(&rec.purpose, "cancelled"));
    });
}

/// The look keys came up: the look's words are turned into text on this Mac (`transcribing`, then `heard`).
pub fn finish_look_recording(app: &AppHandle, look_id: &str) {
    if let Some(rec) = take_look(app, look_id) {
        finish(app, rec);
    }
}

/// The look was cancelled: the recording stops and its sound is discarded, never transcribed; `cancelled` follows.
pub fn cancel_look_recording(app: &AppHandle, look_id: &str) {
    let Some(rec) = take_look(app, look_id) else { return };
    let _ = rec.stop.send(());
    let app = app.clone();
    std::thread::spawn(move || {
        if let Ok(Ok((mut samples, _))) = rec.thread.join() {
            samples.fill(0.0);
        }
        emit(&app, tagged(&rec.purpose, "cancelled"));
    });
}

// ---- recording -----------------------------------------------------------------------------------------------------

/// Runs on its own thread (the audio stream cannot move between threads on macOS) until told to stop, or for 30 seconds.
fn record(app: AppHandle, stop: mpsc::Receiver<()>, purpose: Purpose) -> Result<(Vec<f32>, u32), String> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("No microphone found on this computer.")?;
    let config = device.default_input_config().map_err(|e| format!("Cannot open the microphone: {e}"))?;
    let rate = config.sample_rate();
    let channels = config.channels() as usize;
    let samples: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(rate as usize * 10)));

    fn push<T: cpal::Sample>(input: &[T], channels: usize, out: &Arc<Mutex<Vec<f32>>>)
    where
        f32: cpal::FromSample<T>,
    {
        let mut buf = out.lock().unwrap();
        for frame in input.chunks(channels.max(1)) {
            let sum: f32 = frame.iter().map(|&s| <f32 as cpal::FromSample<T>>::from_sample_(s)).sum();
            buf.push(sum / frame.len() as f32);
        }
    }

    let err_fn = |e: cpal::Error| eprintln!("Brenda microphone: {e}");
    let s = samples.clone();
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream(config.into(), move |d: &[f32], _: &_| push(d, channels, &s), err_fn, None),
        cpal::SampleFormat::I16 => device.build_input_stream(config.into(), move |d: &[i16], _: &_| push(d, channels, &s), err_fn, None),
        cpal::SampleFormat::I32 => device.build_input_stream(config.into(), move |d: &[i32], _: &_| push(d, channels, &s), err_fn, None),
        other => return Err(format!("This microphone uses a sound format Brenda does not support yet ({other}).")),
    }
    .map_err(|e| format!("Cannot open the microphone: {e}. Check System Settings › Privacy & Security › Microphone."))?;
    stream.play().map_err(|e| format!("Cannot start the microphone: {e}"))?;

    emit(&app, VoiceEvent { level: Some(0.0), ..tagged(&purpose, "listening") });
    crate::companion::level(&app, 0.0);
    let started = Instant::now();
    let window = (rate as usize) / 14; // about 70 ms of sound for the level meter
    loop {
        match stop.recv_timeout(Duration::from_millis(70)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if started.elapsed() > Duration::from_secs(MAX_SECONDS) {
            emit(&app, tagged(&purpose, "limit"));
            let _ = stop.recv(); // keep the recording until the keys come up, but stop growing it
            break;
        }
        let level = {
            let buf = samples.lock().unwrap();
            let tail = &buf[buf.len().saturating_sub(window)..];
            if tail.is_empty() { 0.0 } else { (tail.iter().map(|x| x * x).sum::<f32>() / tail.len() as f32).sqrt() }
        };
        let level = (level * 6.0).min(1.0);
        emit(&app, VoiceEvent { level: Some(level), ..tagged(&purpose, "listening") });
        crate::companion::level(&app, level as f64);
    }
    drop(stream);
    let out = std::mem::take(&mut *samples.lock().unwrap());
    Ok((out, rate))
}

/// Linear resampling to the 16 kHz whisper expects. Plenty for speech.
fn resample(input: &[f32], from: u32) -> Vec<f32> {
    if from == WHISPER_RATE || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / WHISPER_RATE as f64;
    let n = (input.len() as f64 / ratio) as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * ratio;
            let j = pos as usize;
            let frac = (pos - j as f64) as f32;
            let a = input[j];
            let b = *input.get(j + 1).unwrap_or(&a);
            a + (b - a) * frac
        })
        .collect()
}

// ---- speech to text ------------------------------------------------------------------------------------------------

fn transcribe_and_emit(app: &AppHandle, samples: Vec<f32>, rate: u32, purpose: &Purpose) {
    let seconds = samples.len() as f32 / rate.max(1) as f32;
    if seconds < MIN_SECONDS {
        return emit(app, tagged(purpose, "too-short"));
    }
    let peak = samples.iter().fold(0f32, |m, x| m.max(x.abs()));
    if peak < 0.002 {
        return fail(app, "I couldn't hear anything. Check that Boredroom may use the microphone in System Settings › Privacy & Security › Microphone, and that the right microphone is selected.", purpose);
    }
    emit(app, tagged(purpose, "transcribing"));
    match transcribe(app, &resample(&samples, rate)) {
        Ok(text) if !text.is_empty() => {
            // Rust's own transcript: the only spoken words a look request or an answer can carry (owner rule,
            // 12 October 2026).
            if let Some(id) = purpose.look_id() {
                crate::look::note_heard(app, &id, &text);
            }
            if *purpose == Purpose::Talk {
                *app.state::<Voice>().last_talk.lock().unwrap() = Some((text.clone(), Instant::now()));
            }
            emit(app, VoiceEvent { text: Some(text.clone()), ..tagged(purpose, "heard") });
            if let Purpose::Answer { target, .. } = purpose {
                crate::act::heard_answer(app, target.clone(), text);
            }
        }
        Ok(_) => emit(app, tagged(purpose, "too-short")),
        Err(message) => fail(app, message, purpose),
    }
}

/// The audio window for a clip (K.1): `ceil((seconds + 1) × 50)` rounded up to 64, between 512 and 1,500; never smaller
/// than the audio (whisper's window is 50 frames a second).
pub fn audio_ctx(seconds: f32) -> i32 {
    let frames = ((seconds.max(0.0) + 1.0) * 50.0).ceil() as i32;
    let rounded = (frames + 63) / 64 * 64;
    rounded.clamp(512, 1_500)
}

/// Threads for whisper (K.1): at most 4.
pub fn whisper_threads(cores: usize) -> i32 {
    cores.clamp(1, 4) as i32
}

static LOG_HOOKS: std::sync::Once = std::sync::Once::new();

/// Loads the model into memory, once (K.1: at start when voice is on, not on first use).
fn load_model(app: &AppHandle) -> Result<(), String> {
    LOG_HOOKS.call_once(whisper_rs::install_logging_hooks);
    let v = app.state::<Voice>();
    let mut guard = v.whisper.lock().unwrap();
    if guard.is_none() {
        let path = model_path(app).ok_or("No place to keep the speech model.")?;
        let ctx = WhisperContext::new_with_params(&path, WhisperContextParameters::default())
            .map_err(|e| format!("The speech model could not be loaded ({e}). Turn voice off and on again to download it again."))?;
        *guard = Some(ctx);
    }
    Ok(())
}

/// Loads the speech model on a background thread when voice is on and the model is here.
pub fn preload(app: &AppHandle) {
    if !model_ready(app) {
        return;
    }
    let app = app.clone();
    let _ = std::thread::Builder::new().name("brenda-whisper-load".into()).spawn(move || {
        let _ = load_model(&app);
    });
}

fn transcribe(app: &AppHandle, audio: &[f32]) -> Result<String, String> {
    load_model(app)?;
    // The prompt is made before the model is locked (the app index may need a moment).
    let prompt = crate::appindex::whisper_prompt_now(app);
    let v = app.state::<Voice>();
    let guard = v.whisper.lock().unwrap();
    let ctx = guard.as_ref().ok_or("The speech model isn't loaded.")?;
    let mut state = ctx.create_state().map_err(|e| format!("Speech recognition failed to start: {e}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_n_threads(whisper_threads(std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)));
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    // No re-decoding when unsure, and a window sized to the clip (K.1; measured 116–188 ms with 5/5 right).
    params.set_temperature_inc(0.0);
    params.set_audio_ctx(audio_ctx(audio.len() as f32 / WHISPER_RATE as f32));
    // Her names and the apps on this Mac, so they are heard right (B.2).
    params.set_initial_prompt(&prompt);
    state.full(params, audio).map_err(|e| format!("Speech recognition failed: {e}"))?;
    let text: String = state.as_iter().map(|s| s.to_string()).collect::<Vec<_>>().join(" ");
    Ok(clean(&text))
}

/// Whisper marks silence and noise as "[BLANK_AUDIO]", "(wind blowing)" and so on; none of that is something said.
fn clean(text: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for ch in text.chars() {
        match ch {
            '[' | '(' => depth += 1,
            ']' | ')' => depth = (depth - 1).max(0),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

// ---- the model -----------------------------------------------------------------------------------------------------

/// Downloads the speech model once, with progress, to a temporary file that is renamed only when complete.
pub async fn download_model(app: AppHandle) -> Result<(), String> {
    if model_ready(&app) {
        return Ok(());
    }
    let v = app.state::<Voice>();
    if v.downloading.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    let result = fetch(&app).await;
    app.state::<Voice>().downloading.store(false, Ordering::SeqCst);
    match &result {
        Ok(()) => emit(&app, VoiceEvent { phase: "ready", ..Default::default() }),
        Err(message) => fail(&app, message.clone(), &Purpose::Talk),
    }
    result
}

async fn fetch(app: &AppHandle) -> Result<(), String> {
    let path = model_path(app).ok_or("No place to keep the speech model.")?;
    let dir = path.parent().unwrap().to_path_buf();
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let part = dir.join(format!("{MODEL_FILE}.part"));
    let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).build().map_err(|e| e.to_string())?;
    let res = client.get(MODEL_URL).send().await.map_err(|e| format!("Cannot download the speech model: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Cannot download the speech model (HTTP {}).", res.status().as_u16()));
    }
    let total = res.content_length().unwrap_or(147_964_211) as f32;
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
    let mut stream = res.bytes_stream();
    let mut got: u64 = 0;
    let mut last = Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("The download stopped: {e}"))?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        got += chunk.len() as u64;
        if last.elapsed() > Duration::from_millis(250) {
            last = Instant::now();
            emit(app, VoiceEvent { phase: "downloading", progress: Some((got as f32 / total).min(1.0)), ..Default::default() });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);
    if got < MODEL_MIN_BYTES {
        let _ = tokio::fs::remove_file(&part).await;
        return Err("The speech model download was incomplete. Try again.".into());
    }
    tokio::fs::rename(&part, &path).await.map_err(|e| e.to_string())?;
    Ok(())
}

// ---- speaking ------------------------------------------------------------------------------------------------------
// Only ElevenLabs speaks for her (owner request, 27 October 2026: "I want everything to be ElevenLabs voice and no local
// voice at all"). The page fetches and plays her natural voice itself (natural-voice.js); the Mac's own voice (`say`,
// `afplay`, `NSSpeechSynthesizer`) is gone, so it can never stand in when ElevenLabs is slow or refuses: she then stays
// quiet and the words still show. `speak`, `speak_queue` and `speak_now` stay as commands for an older page: they stop
// whatever was being said and answer `unspoken` at once, so its Listen button turns back, and never make a sound.

/// Speech events leave through one thread, in the order they were decided (Tauri queues an event emitted off the main
/// thread, so a `spoken` could otherwise overtake what came before it).
fn said(app: &AppHandle, e: VoiceEvent) {
    let v = app.state::<Voice>();
    let mut out = v.speech_events.lock().unwrap();
    let tx = out.get_or_insert_with(|| {
        let (tx, rx) = mpsc::channel::<VoiceEvent>();
        let app = app.clone();
        std::thread::spawn(move || rx.into_iter().for_each(|e| emit(&app, e)));
        tx
    });
    let _ = tx.send(e);
}

/// An older page asked Rust to speak: nothing is said in the computer's voice (owner request, 27 October 2026). What was
/// speaking stops, and `unspoken` goes out so the page does not wait.
pub fn speak(app: &AppHandle, _text: &str) {
    halt(app);
    said(app, VoiceEvent { phase: "unspoken", ..Default::default() });
}

/// As `speak` (a look's sentences, B.10): never the computer's voice. Only the first sentence answers `unspoken`.
pub fn speak_queue(app: &AppHandle, text: &str, first: bool) {
    if first {
        speak(app, text);
    }
}

/// As `speak` (the front desk's short line, K.4): never the computer's voice.
pub fn speak_now(app: &AppHandle, text: &str) {
    speak(app, text);
}

/// Stop on the reply card, a new reply, the talk keys, signing out, quitting: the page's natural voice stops itself;
/// here only a `spoken` is owed if Rust ever said she was live.
pub fn stop_speaking(app: &AppHandle) {
    halt(app);
}

fn halt(app: &AppHandle) {
    let v = app.state::<Voice>();
    if v.speech_live.swap(false, Ordering::SeqCst) {
        said(app, VoiceEvent { phase: "spoken", interrupted: Some(true), ..Default::default() });
        crate::companion::speaking(app, false, false);
    }
}

/// Option+Space's last transcript and how long ago (helpers-spec P.2).
pub fn last_talk(app: &AppHandle) -> Option<(String, Duration)> {
    app.try_state::<Voice>()?.last_talk.lock().unwrap().as_ref().map(|(t, at)| (t.clone(), at.elapsed()))
}

#[cfg(test)]
mod speed_tests {
    use super::*;

    /// K.1: the audio window fits the clip (0.9 s → 512, 12 s → 704, 40 s → 1,500).
    #[test]
    fn audio_ctx_sizes() {
        assert_eq!(audio_ctx(0.9), 512);
        assert_eq!(audio_ctx(12.0), 704);
        assert_eq!(audio_ctx(40.0), 1_500);
        assert_eq!(audio_ctx(0.0), 512);
        for s in [1.0f32, 5.0, 9.0, 9.3, 14.0, 20.0, 29.9] {
            let ctx = audio_ctx(s);
            assert!(ctx as f32 >= (s * 50.0).min(1_500.0), "never smaller than the audio: {s} s → {ctx}");
            assert_eq!(ctx % 64 == 0 || ctx == 1_500, true);
        }
        assert_eq!(whisper_threads(10), 4);
        assert_eq!(whisper_threads(2), 2);
    }

    /// B.2, K.1: the prompt is the app index's.
    #[test]
    fn prompt_from_index() {
        let p = crate::appindex::whisper_prompt("Max", &["Figma".into()], &["Slack".into(), "Figma".into()]);
        assert!(p.starts_with("Max, Brenda, Boredroom, Figma, Slack, "));
        assert!(!p.contains("clock in"), "the old fixed prompt is gone");
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/src/voice.rs")).unwrap();
        let code = src.split("#[cfg(test)]").next().unwrap();
        assert!(code.contains("params.set_initial_prompt(&prompt)") && code.contains("crate::appindex::whisper_prompt_now(app)"));
        assert!(code.contains("set_temperature_inc(0.0)") && code.contains("install_logging_hooks"));
    }

    /// K.1 (the integrator's machine, once): the investigation's clips, timed. `BRENDA_CLIPS` names the folder of
    /// `*.wav` clips (16 kHz mono) and `BRENDA_MODEL` the owner's `ggml-base.en.bin`, both read only. Prints only the
    /// milliseconds and the words.
    #[test]
    #[ignore]
    fn bench_clips() {
        let (Ok(dir), Ok(model)) = (std::env::var("BRENDA_CLIPS"), std::env::var("BRENDA_MODEL")) else {
            println!("set BRENDA_CLIPS and BRENDA_MODEL");
            return;
        };
        whisper_rs::install_logging_hooks();
        let ctx = WhisperContext::new_with_params(&model, WhisperContextParameters::default()).expect("model");
        let mut clips: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().is_some_and(|e| e == "wav")).collect();
        clips.sort();
        for c in clips {
            let bytes = std::fs::read(&c).unwrap();
            let pcm: Vec<f32> = bytes[44..].chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32_768.0).collect();
            let started = Instant::now();
            let mut state = ctx.create_state().unwrap();
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_language(Some("en"));
            params.set_n_threads(whisper_threads(std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4)));
            params.set_no_context(true);
            params.set_suppress_blank(true);
            params.set_temperature_inc(0.0);
            params.set_audio_ctx(audio_ctx(pcm.len() as f32 / 16_000.0));
            params.set_initial_prompt("Brenda, Boredroom, Figma, Slack, Safari, to-do, timer, Desktop, Documents, Downloads, screenshot, volume, Wi-Fi, Trash, error.");
            state.full(params, &pcm).unwrap();
            let text: String = state.as_iter().map(|s| s.to_string()).collect::<Vec<_>>().join(" ");
            let ms = started.elapsed().as_millis();
            println!("{} {ms} ms: {}", c.file_name().unwrap().to_string_lossy(), clean(&text));
            assert!(ms < 500, "hearing ≤ 0.5 s");
        }
    }
}

#[cfg(test)]
mod no_computer_voice {
    /// Owner request, 27 October 2026: she never speaks in the computer's own voice. Nothing in the app's code runs
    /// `say`, `afplay` or a speech synthesizer any more.
    #[test]
    fn nothing_speaks_with_the_macs_voice() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().is_none_or(|e| e != "rs") {
                continue;
            }
            let src = std::fs::read_to_string(&path).unwrap();
            // The code before the tests, without its comments (they may name what is gone).
            let code: String = src.split("#[cfg(test)]").next().unwrap().lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
            for banned in ["Command::new(\"say\")", "Command::new(\"afplay\")", "NSSpeechSynthesizer", "AVSpeechSynthesizer", "System.Speech", "spd-say"] {
                assert!(!code.contains(banned), "{} still has {banned}", path.display());
            }
        }
    }
}
