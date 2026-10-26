//! Talking to Brenda, step one: hold to talk (owner decision, 3 October 2026).
//!
//! Hold Option+Space (Alt+Space on Windows), speak, let go. While the keys are held the microphone records; nothing is
//! recorded at any other time. On release the audio is turned into text on this computer by whisper.cpp (the
//! English "base" model, about 148 MB, downloaded once from Hugging Face when the person turns voice on), and only that
//! text goes to Boredroom, where Brenda answers with the person's own permissions. The reply is spoken with the
//! computer's own voice.
//!
//! The page hears about each step through the `brenda://voice` event: `listening` (with the sound level), `transcribing`,
//! `heard` (the text), `error`, and `downloading` (with progress) while the model arrives. "Hey Brenda" (step two) will
//! only replace the trigger; everything after the recording stays the same.
//!
//! Her voice (owner decision, 7 October 2026: phase 2). She talks with a face that moves: on macOS the reply is first
//! rendered to a file with `say -o` (the Mac's system voice, on this computer, nothing sent anywhere), its loudness is
//! measured every 30 ms, and the file is played with `afplay` while the same `brenda://voice` channel carries
//! `speaking` events with that level, timed to the playback, so her eyes open and squash with the real syllables; the
//! `phase` tells speaking from listening. `spoken` follows once when she ends (`interrupted` when stopped); `unspoken`
//! when she was asked but will not be heard after all (the microphone is open, nothing to say). If rendering
//! fails, or on Windows and Linux, the reply is spoken as before and the start says `synthetic`: the page pulses her eyes
//! itself. One utterance at a time: a new one, Stop, the talk keys and signing out all cut her off, and she never starts
//! while the microphone is open.
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
//! A look's answer is spoken sentence by sentence as it streams (`speak_queue`): the first cuts off what was speaking,
//! the rest wait their turn, and one `spoken` follows the last. Levels also go to the companion by the pointer.
//!
//! Speed (owner brief, 12 October 2026: "Hearing ≤ 0.5 s … first sound ≤ 1 s"; helpers-spec K.1, K.4): whisper stays
//! base.en on the CPU, tuned: 4 threads at most, no re-decoding when unsure, the audio window sized to the clip, and the
//! app index's names in its prompt so "Figma" is heard as Figma; its logs go nowhere; the model loads at start when voice
//! is on. The front desk's first short line ("Opening Figma.") is spoken at once by one `NSSpeechSynthesizer` made once
//! and kept (`speak_now`), falling back to `say`. Option+Space's last transcript is kept 15 s (`last_talk`) so a
//! spoken request can be told from a typed one.

use futures_util::StreamExt;
use serde::Serialize;
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
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
    /// Whatever is speaking now: the `say -o` render, then `afplay`, or the plain `say` of the fallback. Every change to
    /// it, to `speech_gen` and to `speech_live` happens under this lock, with the speech events that go with it.
    speaking: Mutex<Option<Child>>,
    /// Which utterance is current: each new one and each Stop moves it on, and a thread whose number is no longer
    /// current stops at its next look.
    speech_gen: AtomicU64,
    /// She is audibly speaking (a `speaking` went out): exactly one `spoken` follows.
    speech_live: AtomicBool,
    /// Where speech events are queued for the one thread that emits them (see `said`).
    speech_events: Mutex<Option<mpsc::Sender<VoiceEvent>>>,
    /// The current utterance's rendered file, removed by a Stop and at its end (as well as by its thread), so quitting
    /// straight after a Stop leaves no recording of the reply in the temp folder (review, 7 October 2026).
    speech_file: Mutex<Option<PathBuf>>,
    busy: AtomicBool,
    downloading: AtomicBool,
    /// Sentences waiting to be spoken after the current one (`speak_queue`), at most 8.
    queue: Mutex<std::collections::VecDeque<String>>,
    /// Option+Space's last transcript and when (helpers-spec P.2: a spoken request's origin).
    last_talk: Mutex<Option<(String, Instant)>>,
    /// The kept `NSSpeechSynthesizer` is speaking the current utterance (`speak_now`).
    synth_on: AtomicBool,
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
// Her voice (owner decision, 7 October 2026: phase 2; the module header says what she does). The page starts her talking
// face on a `speaking` and only a `spoken` ends it, so the order of those events matters: every decision about an
// utterance (is it still the current one, which process is in the slot, is she live, what the page is told) is taken
// under the `speaking` lock, and the events leave in that order (`said`).

/// How fast she speaks, in words a minute, rendered or plain (as before phase 2).
#[cfg(target_os = "macos")]
const SAY_RATE: &str = "195";
/// What she says at most, in characters. The server already sends at most about 400 to be spoken (`spoken`).
const SAY_MAX_CHARS: usize = 600;
/// One level per 30 ms of sound: quick enough for syllables, light on the event channel.
#[cfg(target_os = "macos")]
const WINDOW_MS: usize = 30;
/// How long `afplay` takes to make its first sound, so her eyes move with the sound rather than just before it.
#[cfg(target_os = "macos")]
const AFPLAY_LATENCY: Duration = Duration::from_millis(50);

/// Speech events (`speaking`, `spoken`) leave through one thread, in the order they were decided. Tauri delivers an
/// event emitted on the main thread (a command, the talk keys) at once but queues one emitted from any other thread, so
/// emitting directly could let a level queued just before a Stop arrive after its `spoken` and leave her face talking.
/// Called with the `speaking` lock held.
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

/// What `say` is given (review, 7 October 2026), whatever the page sent: never a URL or an email address (a reply from
/// an older server, or a Confirm's summary carrying a typed title, can hold them), never a bracket (`say` obeys embedded
/// commands written `[[slnc 20000]]`, `[[rate 1]]`), no control characters, and single spaces.
fn sayable(text: &str) -> String {
    text.split_whitespace()
        .filter(|w| {
            let l = w.to_ascii_lowercase();
            let l = l.trim_start_matches(|c: char| !c.is_alphanumeric());
            !(l.contains("://") || l.starts_with("www.") || l.starts_with("mailto:") || (l.contains('@') && l.contains('.')))
        })
        .map(|w| w.chars().filter(|c| !matches!(c, '[' | ']') && !c.is_control()).collect::<String>())
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// Brenda's reply, out loud, with the computer's own voice. It replaces whatever she was saying; she says nothing while
/// the microphone is open, and a press of the talk keys cuts her off.
pub fn speak(app: &AppHandle, text: &str) {
    halt(app);
    let v = app.state::<Voice>();
    if v.recording.lock().unwrap().is_some() {
        return unspoken(app, None); // never over an open microphone
    }
    let text: String = sayable(text).chars().take(SAY_MAX_CHARS).collect();
    if text.trim().is_empty() {
        return unspoken(app, None);
    }
    let gen = v.speech_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        #[cfg(target_os = "macos")]
        if let Rendered::Finished = speak_rendered(&app, &text, gen) {
            return;
        }
        speak_plain(&app, &text, gen);
    });
}

/// How many sentences may wait, and how long each may be (B.10).
pub const QUEUE_MAX: usize = 8;
pub const QUEUED_CHARS: usize = 400;

/// A look's answer, sentence by sentence (B.10): `first` cuts off what was speaking and speaks at once, as `speak`;
/// otherwise the sentence waits for the current one, in order, and one `spoken` follows the last.
pub fn speak_queue(app: &AppHandle, text: &str, first: bool) {
    if first {
        return speak(app, text);
    }
    let v = app.state::<Voice>();
    let busy = {
        let slot = v.speaking.lock().unwrap();
        slot.is_some() || v.speech_live.load(Ordering::SeqCst)
    };
    if !busy {
        return speak(app, text);
    }
    let mut q = v.queue.lock().unwrap();
    if q.len() < QUEUE_MAX {
        let t: String = sayable(text).chars().take(QUEUED_CHARS).collect();
        if !t.trim().is_empty() {
            q.push_back(t);
        }
    }
}

/// Cuts her off: Stop on the reply card, a new reply, typing to her, closing the card, the talk keys, signing out,
/// quitting (the tray's Quit and the app's exit, so `afplay` or `say` never finish the reply after the app is gone).
pub fn stop_speaking(app: &AppHandle) {
    halt(app);
}

/// Stops what speaks now (the render, the player or `say`), removes its rendered file, and tells the page `spoken` if
/// she was heard.
fn halt(app: &AppHandle) {
    let v = app.state::<Voice>();
    v.queue.lock().unwrap().clear();
    let mut slot = v.speaking.lock().unwrap();
    v.speech_gen.fetch_add(1, Ordering::SeqCst);
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(file) = v.speech_file.lock().unwrap().take() {
        let _ = std::fs::remove_file(file);
    }
    if v.synth_on.swap(false, Ordering::SeqCst) {
        synth::stop(app);
    }
    if v.speech_live.swap(false, Ordering::SeqCst) {
        said(app, VoiceEvent { phase: "spoken", interrupted: Some(true), ..Default::default() });
        crate::companion::speaking(app, false, false);
    }
}

/// Option+Space's last transcript and how long ago (helpers-spec P.2).
pub fn last_talk(app: &AppHandle) -> Option<(String, Duration)> {
    app.try_state::<Voice>()?.last_talk.lock().unwrap().as_ref().map(|(t, at)| (t.clone(), at.elapsed()))
}

/// The front desk's short line, at once (K.4): the same contract as `speak` (it stops what was speaking, never over an
/// open microphone, `speaking`/`spoken` in order), spoken by the kept `NSSpeechSynthesizer` with a gentle synthetic level
/// for her face; `speak` when the synthesizer isn't there or won't start. [UNVERIFIED: NSSpeechSynthesizer, deprecated
/// since macOS 14, still speaks on macOS 26]
pub fn speak_now(app: &AppHandle, text: &str) {
    halt(app);
    let v = app.state::<Voice>();
    if v.recording.lock().unwrap().is_some() {
        return unspoken(app, None);
    }
    let text: String = sayable(text).chars().take(200).collect();
    if text.trim().is_empty() {
        return unspoken(app, None);
    }
    let gen = v.speech_gen.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        if !synth::start(&app, &text) {
            return speak(&app, &text);
        }
        let v = app.state::<Voice>();
        {
            let _slot = v.speaking.lock().unwrap();
            if v.speech_gen.load(Ordering::SeqCst) != gen {
                synth::stop(&app);
                return;
            }
            v.synth_on.store(true, Ordering::SeqCst);
            v.speech_live.store(true, Ordering::SeqCst);
            said(&app, VoiceEvent { phase: "speaking", synthetic: Some(true), ..Default::default() });
            crate::companion::speaking(&app, true, true);
        }
        let started = Instant::now();
        loop {
            std::thread::sleep(Duration::from_millis(30));
            if v.speech_gen.load(Ordering::SeqCst) != gen || !v.synth_on.load(Ordering::SeqCst) {
                return;
            }
            if !synth::speaking(&app) || started.elapsed() > Duration::from_secs(30) {
                break;
            }
            let t = started.elapsed().as_secs_f64();
            crate::companion::level(&app, 0.55 + 0.25 * (t * 6.0 * std::f64::consts::TAU).sin());
        }
        let _slot = v.speaking.lock().unwrap();
        if v.speech_gen.load(Ordering::SeqCst) != gen {
            return;
        }
        v.synth_on.store(false, Ordering::SeqCst);
        if v.speech_live.swap(false, Ordering::SeqCst) {
            said(&app, VoiceEvent { phase: "spoken", ..Default::default() });
            crate::companion::speaking(&app, false, false);
        }
    });
}

/// The one `NSSpeechSynthesizer`, made on the main thread the first time and kept (K.4). Every call is on the main thread.
mod synth {
    use tauri::AppHandle;

    #[cfg(target_os = "macos")]
    mod mac {
        use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
        use objc2_foundation::NSString;
        use std::sync::atomic::{AtomicUsize, Ordering};

        /// The kept synthesizer (a pointer retained once, for the app's life), or 0.
        static SYNTH: AtomicUsize = AtomicUsize::new(0);

        unsafe fn get() -> Option<&'static AnyObject> {
            let p = SYNTH.load(Ordering::SeqCst);
            if p != 0 {
                return Some(&*(p as *const AnyObject));
            }
            let cls = AnyClass::get(c"NSSpeechSynthesizer")?;
            // `new` is `initWithVoice: nil`: the system voice `say` uses.
            let s: Option<Retained<AnyObject>> = msg_send![cls, new];
            let s = s?;
            let _: () = msg_send![&*s, setRate: 195.0f32];
            let raw = Retained::into_raw(s);
            SYNTH.store(raw as usize, Ordering::SeqCst);
            Some(&*raw)
        }

        pub fn start(text: &str) -> bool {
            unsafe {
                let Some(s) = get() else { return false };
                let t = NSString::from_str(text);
                msg_send![s, startSpeakingString: &*t]
            }
        }

        pub fn speaking() -> bool {
            unsafe { get().is_some_and(|s| msg_send![s, isSpeaking]) }
        }

        pub fn stop() {
            unsafe {
                if let Some(s) = get() {
                    let _: () = msg_send![s, stopSpeaking];
                }
            }
        }
    }

    fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
        let (tx, rx) = std::sync::mpsc::channel();
        app.run_on_main_thread(move || {
            let _ = tx.send(f());
        })
        .ok()?;
        rx.recv_timeout(std::time::Duration::from_secs(1)).ok()
    }

    pub fn start(app: &AppHandle, text: &str) -> bool {
        #[cfg(target_os = "macos")]
        {
            let t = text.to_string();
            on_main(app, move || mac::start(&t)).unwrap_or(false)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (app, text, on_main::<()>);
            false
        }
    }

    pub fn speaking(app: &AppHandle) -> bool {
        #[cfg(target_os = "macos")]
        {
            on_main(app, mac::speaking).unwrap_or(false)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = app;
            false
        }
    }

    pub fn stop(app: &AppHandle) {
        #[cfg(target_os = "macos")]
        {
            let _ = app.run_on_main_thread(mac::stop);
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = app;
        }
    }
}

/// She was asked to speak but will not be heard after all (the microphone is open, nothing to say, no sound came of the
/// render, `say` would not start): `unspoken`, so the page's Listen button, a Stop since it asked, turns back at once
/// rather than after its own wait (review, 7 October 2026). Only for the current utterance (`gen`; None: the one just
/// asked for), never while she is heard, so a newer reply's wait is never cut short.
fn unspoken(app: &AppHandle, gen: Option<u64>) {
    let v = app.state::<Voice>();
    let _slot = v.speaking.lock().unwrap();
    if gen.is_some_and(|g| v.speech_gen.load(Ordering::SeqCst) != g) || v.speech_live.load(Ordering::SeqCst) {
        return;
    }
    said(app, VoiceEvent { phase: "unspoken", ..Default::default() });
}

/// Puts `child` in the slot as what speaks now, unless a Stop or a newer reply came since `gen`: then it is killed and
/// false returned. With `start`, she goes live and the page is told in the same step, so a Stop cannot fall between.
fn take_turn(app: &AppHandle, mut child: Child, gen: u64, start: Option<VoiceEvent>) -> bool {
    let v = app.state::<Voice>();
    let mut slot = v.speaking.lock().unwrap();
    if v.speech_gen.load(Ordering::SeqCst) != gen {
        drop(slot);
        let _ = child.kill();
        let _ = child.wait();
        return false;
    }
    *slot = Some(child);
    if let Some(e) = start {
        let synthetic = e.synthetic == Some(true);
        v.speech_live.store(true, Ordering::SeqCst);
        said(app, e);
        crate::companion::speaking(app, true, synthetic);
    }
    true
}

/// Waits for what is in the slot to end, looking every `every` (never holding the lock while waiting). None when a Stop
/// or a newer reply took over meanwhile; otherwise whether it ended well (not when it ran past `limit`: it is killed).
fn wait_turn(app: &AppHandle, gen: u64, every: Duration, limit: Duration) -> Option<bool> {
    let v = app.state::<Voice>();
    let started = Instant::now();
    loop {
        {
            let mut slot = v.speaking.lock().unwrap();
            if v.speech_gen.load(Ordering::SeqCst) != gen {
                return None;
            }
            let child = slot.as_mut()?;
            match child.try_wait() {
                Ok(Some(status)) => return Some(status.success()),
                Ok(None) if started.elapsed() < limit => {}
                _ => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Some(false);
                }
            }
        }
        std::thread::sleep(every);
    }
}

/// The end of an utterance this thread still owns: the slot is emptied, its file removed and, if she was heard, `spoken`
/// goes out once (`unspoken` if she never was).
fn finish_turn(app: &AppHandle, gen: u64) {
    let v = app.state::<Voice>();
    let mut slot = v.speaking.lock().unwrap();
    if v.speech_gen.load(Ordering::SeqCst) != gen {
        return;
    }
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(file) = v.speech_file.lock().unwrap().take() {
        let _ = std::fs::remove_file(file);
    }
    // The next queued sentence of the same answer follows at once, as one utterance: no `spoken` between them.
    if v.speech_live.load(Ordering::SeqCst) {
        if let Some(next) = v.queue.lock().unwrap().pop_front() {
            let gen = v.speech_gen.fetch_add(1, Ordering::SeqCst) + 1;
            drop(slot);
            let app = app.clone();
            std::thread::spawn(move || {
                #[cfg(target_os = "macos")]
                if let Rendered::Finished = speak_rendered(&app, &next, gen) {
                    return;
                }
                speak_plain(&app, &next, gen);
            });
            return;
        }
    }
    let heard = v.speech_live.swap(false, Ordering::SeqCst);
    said(app, VoiceEvent { phase: if heard { "spoken" } else { "unspoken" }, ..Default::default() });
    if heard {
        crate::companion::speaking(app, false, false);
    }
}

/// How speaking from a rendered file went: `Finished` (heard, stopped, or nothing to say) or `Failed` (no sound to play,
/// so she speaks the plain way instead).
#[cfg(target_os = "macos")]
enum Rendered {
    Finished,
    Failed,
}

/// The rendered file, removed however the thread ends.
#[cfg(target_os = "macos")]
struct TempFile(PathBuf);

#[cfg(target_os = "macos")]
impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// macOS: render with `say -o` (16-bit WAVE at 22.05 kHz), measure it, play it with `afplay`, and send the level of each
/// 30 ms as that moment plays.
#[cfg(target_os = "macos")]
fn speak_rendered(app: &AppHandle, text: &str, gen: u64) -> Rendered {
    let wav = std::env::temp_dir().join(format!("brenda-say-{}-{gen}.wav", std::process::id()));
    let _gone = TempFile(wav.clone());
    let render = Command::new("say")
        .args(["-r", SAY_RATE, "-o"])
        .arg(&wav)
        .args(["--file-format=WAVE", "--data-format=LEI16@22050", "--"])
        .arg(text)
        .stdin(Stdio::null())
        .spawn();
    let Ok(render) = render else { return Rendered::Failed };
    if !take_turn(app, render, gen, None) {
        return Rendered::Finished;
    }
    {
        // Known to Stop and to the end of the turn too (`speech_file`), while this utterance is still the current one.
        let v = app.state::<Voice>();
        let _slot = v.speaking.lock().unwrap();
        if v.speech_gen.load(Ordering::SeqCst) == gen {
            *v.speech_file.lock().unwrap() = Some(wav.clone());
        }
    }
    match wait_turn(app, gen, Duration::from_millis(20), Duration::from_secs(20)) {
        None => return Rendered::Finished,
        Some(false) => return Rendered::Failed,
        Some(true) => {}
    }
    let Some(pcm) = std::fs::read(&wav).ok().and_then(|bytes| read_wav(&bytes)) else { return Rendered::Failed };
    if pcm.samples.is_empty() {
        finish_turn(app, gen);
        return Rendered::Finished; // nothing to hear
    }
    let levels = envelope(&pcm);
    let Ok(player) = Command::new("afplay").arg(&wav).stdin(Stdio::null()).spawn() else { return Rendered::Failed };
    let t0 = Instant::now();
    if !take_turn(app, player, gen, Some(VoiceEvent { phase: "speaking", level: Some(0.0), ..Default::default() })) {
        return Rendered::Finished;
    }
    let v = app.state::<Voice>();
    let frames = window_frames(pcm.rate);
    for (i, &level) in levels.iter().enumerate() {
        let at = t0 + AFPLAY_LATENCY + Duration::from_secs_f64((i * frames) as f64 / pcm.rate as f64);
        std::thread::sleep(at.saturating_duration_since(Instant::now()));
        let mut slot = v.speaking.lock().unwrap();
        if v.speech_gen.load(Ordering::SeqCst) != gen {
            return Rendered::Finished;
        }
        match slot.as_mut().map(|child| child.try_wait()) {
            Some(Ok(None)) => {
                said(app, VoiceEvent { phase: "speaking", level: Some(level), ..Default::default() });
                crate::companion::level(app, level as f64);
            }
            _ => break, // the player ended early (or cannot be asked): she has finished
        }
    }
    let _ = wait_turn(app, gen, Duration::from_millis(20), Duration::from_secs(1));
    finish_turn(app, gen);
    Rendered::Finished
}

/// One utterance's sound: mono samples from -1 to 1, and their rate.
#[cfg(target_os = "macos")]
struct Pcm {
    samples: Vec<f32>,
    rate: u32,
}

/// Reads the RIFF/WAVE file `say` wrote. Walks its chunks (macOS pads with `FLLR`; `LIST` and anything unknown are
/// skipped), requires 16-bit PCM in `fmt ` and takes its channels and rate, clamps `data` to the file, mixes to mono.
#[cfg(target_os = "macos")]
fn read_wav(bytes: &[u8]) -> Option<Pcm> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let u16_at = |p: usize| u16::from_le_bytes([bytes[p], bytes[p + 1]]);
    let u32_at = |p: usize| u32::from_le_bytes([bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]]);
    let (mut format, mut data) = (None, None);
    let mut p = 12;
    while p + 8 <= bytes.len() {
        let size = u32_at(p + 4) as usize;
        let start = p + 8;
        let end = start.saturating_add(size).min(bytes.len());
        match &bytes[p..p + 4] {
            b"fmt " if end - start >= 16 => format = Some((u16_at(start), u16_at(start + 2), u32_at(start + 4), u16_at(start + 14))),
            b"data" => data = Some(&bytes[start..end]),
            _ => {}
        }
        p = start.saturating_add(size).saturating_add(size & 1); // chunks are padded to an even length
    }
    let (tag, channels, rate, bits) = format?;
    // 1 is plain PCM; 0xFFFE (extensible) is PCM too at 16 bits.
    if !(tag == 1 || tag == 0xFFFE) || bits != 16 || channels == 0 || rate == 0 {
        return None;
    }
    let channels = channels as usize;
    let samples = data?
        .chunks_exact(2 * channels)
        .map(|frame| frame.chunks_exact(2).map(|s| i16::from_le_bytes([s[0], s[1]]) as f32 / 32768.0).sum::<f32>() / channels as f32)
        .collect();
    Some(Pcm { samples, rate })
}

/// Frames in one 30 ms level window at this rate.
#[cfg(target_os = "macos")]
fn window_frames(rate: u32) -> usize {
    (rate as usize * WINDOW_MS / 1000).max(1)
}

/// Her level for each 30 ms, 0 to 1: the window's RMS, silence (under 0.006) as 0, measured against how loud this
/// utterance gets (the 95th percentile of the windows with any sound, at least 0.02) and eased (power 0.75), so quieter
/// syllables still open her eyes.
#[cfg(target_os = "macos")]
fn envelope(pcm: &Pcm) -> Vec<f32> {
    let rms: Vec<f32> = pcm
        .samples
        .chunks(window_frames(pcm.rate))
        .map(|w| (w.iter().map(|x| x * x).sum::<f32>() / w.len() as f32).sqrt())
        .collect();
    let mut heard: Vec<f32> = rms.iter().copied().filter(|&r| r > 0.004).collect();
    heard.sort_by(f32::total_cmp);
    let reference = heard.get((heard.len().saturating_sub(1) as f32 * 0.95) as usize).copied().unwrap_or(0.0).max(0.02);
    rms.iter().map(|&r| if r < 0.006 { 0.0 } else { (r / reference).clamp(0.0, 1.0).powf(0.75) }).collect()
}

/// The plain way, as before phase 2: `say` straight to the speakers (System.Speech on Windows, spd-say on Linux). There
/// is no level to follow, so the start says `synthetic` and the page makes her syllables itself.
fn speak_plain(app: &AppHandle, text: &str, gen: u64) {
    #[cfg(target_os = "macos")]
    let child = Command::new("say").args(["-r", SAY_RATE, "--"]).arg(text).stdin(Stdio::null()).spawn();
    #[cfg(target_os = "windows")]
    let child = {
        use std::os::windows::process::CommandExt;
        let script = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Console]::In.ReadToEnd())";
        let mut c = Command::new("powershell");
        c.args(["-NoProfile", "-Command", script]).stdin(Stdio::piped()).creation_flags(0x0800_0000);
        c.spawn().map(|mut child| {
            if let Some(mut stdin) = child.stdin.take() {
                use std::io::Write;
                let _ = stdin.write_all(text.as_bytes());
            }
            child
        })
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let child = Command::new("spd-say").arg("--").arg(text).stdin(Stdio::null()).spawn();
    let Ok(child) = child else { return unspoken(app, Some(gen)) };
    if !take_turn(app, child, gen, Some(VoiceEvent { phase: "speaking", synthetic: Some(true), ..Default::default() })) {
        return;
    }
    let _ = wait_turn(app, gen, Duration::from_millis(50), Duration::from_secs(120));
    finish_turn(app, gen);
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

    /// K.4 (ignored; the integrator's Mac, volume 0): how long `NSSpeechSynthesizer` takes to start speaking once warm.
    #[test]
    #[ignore]
    fn speak_now_latency() {
        #[cfg(target_os = "macos")]
        unsafe {
            use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
            let cls = AnyClass::get(c"NSSpeechSynthesizer").expect("NSSpeechSynthesizer");
            let s: Retained<AnyObject> = msg_send![cls, new];
            let _: () = msg_send![&*s, setVolume: 0.0f32];
            for round in 0..3 {
                let t = objc2_foundation::NSString::from_str("Opening Figma.");
                let started = Instant::now();
                let ok: bool = msg_send![&*s, startSpeakingString: &*t];
                assert!(ok, "startSpeakingString answered NO");
                let mut first = None;
                while started.elapsed() < Duration::from_secs(3) {
                    let speaking: bool = msg_send![&*s, isSpeaking];
                    if speaking && first.is_none() {
                        first = Some(started.elapsed());
                    }
                    if !speaking && first.is_some() {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(5));
                }
                println!("round {round}: speaking after {:?}", first);
            }
        }
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
mod sayable_tests {
    use super::sayable;

    #[test]
    fn never_gives_say_a_command_a_url_or_an_address() {
        assert_eq!(sayable("Added [[slnc 20000]] Call the bank."), "Added slnc 20000 Call the bank.");
        assert_eq!(sayable("See https://example.com/x, www.example.com or (mailto:a@b.co) now."), "See or now.");
        assert_eq!(sayable("Write to jane@example.com today."), "Write to today.");
        assert_eq!(sayable("  Two\n lines\tand\u{7} a bell.  "), "Two lines and a bell.");
        assert_eq!(sayable("Hi, I'm Max. You have 3 tasks."), "Hi, I'm Max. You have 3 tasks.");
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    /// A RIFF/WAVE file from its chunks, each padded to an even length as RIFF asks.
    fn riff(chunks: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut body = b"WAVE".to_vec();
        for (id, data) in chunks {
            body.extend_from_slice(*id);
            body.extend_from_slice(&(data.len() as u32).to_le_bytes());
            body.extend_from_slice(data);
            if data.len() % 2 == 1 {
                body.push(0);
            }
        }
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend(body);
        out
    }

    fn fmt(tag: u16, channels: u16, rate: u32, bits: u16) -> Vec<u8> {
        let mut f = Vec::new();
        f.extend_from_slice(&tag.to_le_bytes());
        f.extend_from_slice(&channels.to_le_bytes());
        f.extend_from_slice(&rate.to_le_bytes());
        f.extend_from_slice(&(rate * channels as u32 * bits as u32 / 8).to_le_bytes());
        f.extend_from_slice(&(channels * bits / 8).to_le_bytes());
        f.extend_from_slice(&bits.to_le_bytes());
        f
    }

    fn pcm16(samples: &[i16]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    #[test]
    fn reads_what_say_writes_skipping_its_filler() {
        let file = riff(&[(b"fmt ", fmt(1, 1, 22050, 16)), (b"FLLR", vec![0; 7]), (b"data", pcm16(&[0, 16384, -16384, 32767]))]);
        let pcm = read_wav(&file).expect("a 16-bit PCM file");
        assert_eq!(pcm.rate, 22050);
        assert_eq!(pcm.samples, vec![0.0, 0.5, -0.5, 32767.0 / 32768.0]);
    }

    #[test]
    fn mixes_stereo_to_mono_and_clamps_data_to_the_file() {
        let mut file = riff(&[(b"LIST", vec![1, 2, 3, 4]), (b"fmt ", fmt(1, 2, 44100, 16)), (b"data", pcm16(&[16384, 0, -16384, -16384]))]);
        // A data chunk claiming more than the file holds (as a stream that never went back to fix its size).
        let at = file.len() - 8 - 8 + 4;
        file[at..at + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        let pcm = read_wav(&file).expect("readable");
        assert_eq!(pcm.rate, 44100);
        assert_eq!(pcm.samples, vec![0.25, -0.5]);
    }

    #[test]
    fn refuses_what_it_cannot_measure() {
        assert!(read_wav(b"not a wave file").is_none());
        assert!(read_wav(&riff(&[(b"fmt ", fmt(3, 1, 22050, 32)), (b"data", vec![0; 8])])).is_none()); // float
        assert!(read_wav(&riff(&[(b"fmt ", fmt(1, 1, 22050, 8)), (b"data", vec![0; 8])])).is_none()); // 8-bit
        assert!(read_wav(&riff(&[(b"fmt ", fmt(1, 1, 22050, 16))])).is_none()); // no sound
        assert!(read_wav(&riff(&[(b"data", pcm16(&[1, 2]))])).is_none()); // no format
    }

    /// What `say -o` really writes, read and measured (renders to a file only; nothing is played). Ignored by default as
    /// it needs the Mac's voices and takes a few seconds: `cargo test --lib -- --ignored say_renders`.
    #[test]
    #[ignore]
    fn say_renders_a_file_her_face_can_follow() {
        let wav = std::env::temp_dir().join(format!("brenda-say-test-{}.wav", std::process::id()));
        let _gone = TempFile(wav.clone());
        let status = Command::new("say")
            .args(["-r", SAY_RATE, "-o"])
            .arg(&wav)
            .args(["--file-format=WAVE", "--data-format=LEI16@22050", "--", "Hi, I'm Max. You have 3 tasks due today."])
            .status()
            .expect("say runs");
        assert!(status.success());
        let pcm = read_wav(&std::fs::read(&wav).expect("the file is there")).expect("16-bit PCM");
        assert_eq!(pcm.rate, 22050);
        assert!(pcm.samples.len() > 22050, "at least a second of speech");
        let levels = envelope(&pcm);
        assert!(levels.iter().all(|l| (0.0..=1.0).contains(l)));
        assert!(levels.iter().filter(|&&l| l > 0.5).count() > 5, "syllables open her eyes");
        assert!(levels.iter().any(|&l| l == 0.0), "pauses close them");
    }

    #[test]
    fn levels_are_silent_in_silence_and_full_at_the_loudest() {
        let rate = 1000; // 30 frames a window
        let mut samples = vec![0.0; 30]; // silence
        samples.extend(std::iter::repeat(0.003).take(30)); // room noise, under the gate
        samples.extend((0..20 * 30).map(|i| if i % 2 == 0 { 0.5 } else { -0.5 })); // twenty loud windows
        samples.extend((0..30).map(|i| if i % 2 == 0 { 0.125 } else { -0.125 })); // one a quarter as loud
        let levels = envelope(&Pcm { samples, rate });
        assert_eq!(levels.len(), 23);
        assert_eq!(levels[0], 0.0);
        assert_eq!(levels[1], 0.0);
        assert!((levels[2] - 1.0).abs() < 1e-6);
        assert!((levels[22] - 0.25f32.powf(0.75)).abs() < 1e-4);
        assert!(levels.iter().all(|l| (0.0..=1.0).contains(l)));
    }
}
