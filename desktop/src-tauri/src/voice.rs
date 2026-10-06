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

use futures_util::StreamExt;
use serde::Serialize;
use std::{
    path::PathBuf,
    process::Child,
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

struct Recording {
    stop: mpsc::Sender<()>,
    thread: std::thread::JoinHandle<Result<(Vec<f32>, u32), String>>,
}

#[derive(Default)]
pub struct Voice {
    recording: Mutex<Option<Recording>>,
    whisper: Mutex<Option<WhisperContext>>,
    speaking: Mutex<Option<Child>>,
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

/// Brenda's reply, out loud, with the computer's own voice. A new press of the shortcut cuts her off.
pub fn speak(app: &AppHandle, text: &str) {
    stop_speaking(app);
    let text: String = text.chars().take(600).collect();
    if text.trim().is_empty() {
        return;
    }
    #[cfg(target_os = "macos")]
    let child = std::process::Command::new("say").arg("-r").arg("195").arg("--").arg(&text).spawn();
    #[cfg(target_os = "windows")]
    let child = {
        use std::os::windows::process::CommandExt;
        let script = "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak([Console]::In.ReadToEnd())";
        let mut c = std::process::Command::new("powershell");
        c.args(["-NoProfile", "-Command", script]).stdin(std::process::Stdio::piped()).creation_flags(0x0800_0000);
        c.spawn().map(|mut child| {
            if let Some(mut stdin) = child.stdin.take() {
                use std::io::Write;
                let _ = stdin.write_all(text.as_bytes());
            }
            child
        })
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let child = std::process::Command::new("spd-say").arg("--").arg(&text).spawn();
    if let Ok(child) = child {
        *app.state::<Voice>().speaking.lock().unwrap() = Some(child);
    }
}

pub fn stop_speaking(app: &AppHandle) {
    if let Some(mut child) = app.state::<Voice>().speaking.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
