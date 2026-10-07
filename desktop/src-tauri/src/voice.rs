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

struct Recording {
    stop: mpsc::Sender<()>,
    thread: std::thread::JoinHandle<Result<(Vec<f32>, u32), String>>,
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
}

fn emit(app: &AppHandle, e: VoiceEvent) {
    let _ = app.emit("brenda://voice", e);
}

fn fail(app: &AppHandle, message: impl Into<String>) {
    emit(app, VoiceEvent { phase: "error", message: Some(message.into()), ..Default::default() });
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

/// Keys down: stop any speech and start recording, if voice is on and the model is here.
pub fn pressed(app: &AppHandle, enabled: bool) {
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
    let thread = std::thread::spawn(move || record(handle, rx));
    *slot = Some(Recording { stop: tx, thread });
}

/// Keys up: stop recording and turn what was said into text, off the main thread.
pub fn released(app: &AppHandle) {
    let v = app.state::<Voice>();
    let Some(rec) = v.recording.lock().unwrap().take() else { return };
    let _ = rec.stop.send(());
    v.busy.store(true, Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        let result = rec.thread.join().unwrap_or_else(|_| Err("The microphone stopped unexpectedly.".into()));
        match result {
            Err(message) => fail(&app, message),
            Ok((samples, rate)) => transcribe_and_emit(&app, samples, rate),
        }
        app.state::<Voice>().busy.store(false, Ordering::SeqCst);
    });
}

// ---- recording -----------------------------------------------------------------------------------------------------

/// Runs on its own thread (the audio stream cannot move between threads on macOS) until told to stop, or for 30 seconds.
fn record(app: AppHandle, stop: mpsc::Receiver<()>) -> Result<(Vec<f32>, u32), String> {
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

    emit(&app, VoiceEvent { phase: "listening", level: Some(0.0), ..Default::default() });
    let started = Instant::now();
    let window = (rate as usize) / 14; // about 70 ms of sound for the level meter
    loop {
        match stop.recv_timeout(Duration::from_millis(70)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if started.elapsed() > Duration::from_secs(MAX_SECONDS) {
            emit(&app, VoiceEvent { phase: "limit", ..Default::default() });
            let _ = stop.recv(); // keep the recording until the keys come up, but stop growing it
            break;
        }
        let level = {
            let buf = samples.lock().unwrap();
            let tail = &buf[buf.len().saturating_sub(window)..];
            if tail.is_empty() { 0.0 } else { (tail.iter().map(|x| x * x).sum::<f32>() / tail.len() as f32).sqrt() }
        };
        emit(&app, VoiceEvent { phase: "listening", level: Some((level * 6.0).min(1.0)), ..Default::default() });
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

fn transcribe_and_emit(app: &AppHandle, samples: Vec<f32>, rate: u32) {
    let seconds = samples.len() as f32 / rate.max(1) as f32;
    if seconds < MIN_SECONDS {
        return emit(app, VoiceEvent { phase: "too-short", ..Default::default() });
    }
    let peak = samples.iter().fold(0f32, |m, x| m.max(x.abs()));
    if peak < 0.002 {
        return fail(app, "I couldn't hear anything. Check that Brenda may use the microphone in System Settings › Privacy & Security › Microphone, and that the right microphone is selected.");
    }
    emit(app, VoiceEvent { phase: "transcribing", ..Default::default() });
    match transcribe(app, &resample(&samples, rate)) {
        Ok(text) if !text.is_empty() => emit(app, VoiceEvent { phase: "heard", text: Some(text), ..Default::default() }),
        Ok(_) => emit(app, VoiceEvent { phase: "too-short", ..Default::default() }),
        Err(message) => fail(app, message),
    }
}

fn transcribe(app: &AppHandle, audio: &[f32]) -> Result<String, String> {
    let v = app.state::<Voice>();
    let mut guard = v.whisper.lock().unwrap();
    if guard.is_none() {
        let path = model_path(app).ok_or("No place to keep the speech model.")?;
        let ctx = WhisperContext::new_with_params(&path, WhisperContextParameters::default())
            .map_err(|e| format!("The speech model could not be loaded ({e}). Turn voice off and on again to download it again."))?;
        *guard = Some(ctx);
    }
    let ctx = guard.as_ref().unwrap();
    let mut state = ctx.create_state().map_err(|e| format!("Speech recognition failed to start: {e}"))?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));
    params.set_n_threads(std::thread::available_parallelism().map(|n| n.get().min(8) as i32).unwrap_or(4));
    params.set_no_context(true);
    params.set_suppress_blank(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    // Names whisper would otherwise misspell.
    params.set_initial_prompt("Brenda, Boredroom, clock in, clock out, to-do, timer, task.");
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
        Err(message) => fail(&app, message.clone()),
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

/// Cuts her off: Stop on the reply card, a new reply, typing to her, closing the card, the talk keys, signing out,
/// quitting (the tray's Quit and the app's exit, so `afplay` or `say` never finish the reply after the app is gone).
pub fn stop_speaking(app: &AppHandle) {
    halt(app);
}

/// Stops what speaks now (the render, the player or `say`), removes its rendered file, and tells the page `spoken` if
/// she was heard.
fn halt(app: &AppHandle) {
    let v = app.state::<Voice>();
    let mut slot = v.speaking.lock().unwrap();
    v.speech_gen.fetch_add(1, Ordering::SeqCst);
    if let Some(mut child) = slot.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(file) = v.speech_file.lock().unwrap().take() {
        let _ = std::fs::remove_file(file);
    }
    if v.speech_live.swap(false, Ordering::SeqCst) {
        said(app, VoiceEvent { phase: "spoken", interrupted: Some(true), ..Default::default() });
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
        v.speech_live.store(true, Ordering::SeqCst);
        said(app, e);
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
    let heard = v.speech_live.swap(false, Ordering::SeqCst);
    said(app, VoiceEvent { phase: if heard { "spoken" } else { "unspoken" }, ..Default::default() });
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
            Some(Ok(None)) => said(app, VoiceEvent { phase: "speaking", level: Some(level), ..Default::default() }),
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
