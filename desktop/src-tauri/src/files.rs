//! Dropping a file on Brenda (owner decision, 4 October 2026; the idea is Coucou's, by Louis Raillé, MIT).
//!
//! The window's own drag-and-drop events tell the page that something is being dragged over the notch, where, and when
//! it lands. The paths of what landed are kept here and only those may be uploaded: the page never names a path, only
//! the index of a dropped file, so it cannot ask Rust to read anything else from the computer. Each file goes to
//! Boredroom's ordinary task upload (`POST /api/orgs/:org/tasks/:task/uploads`), which checks size, type and content
//! and keeps it with the task until it is sent for review.

use serde::Serialize;
use std::{path::PathBuf, sync::Mutex};
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, State};

use crate::{base_url, AppState};

const MAX_BYTES: u64 = 25 * 1024 * 1024;

#[derive(Default)]
pub struct Dropped(Mutex<Vec<PathBuf>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DroppedFile {
    index: usize,
    name: String,
    size: u64,
    /// Why Boredroom would refuse it, worked out before uploading (wrong type, too big), or none.
    problem: Option<String>,
}

#[derive(Serialize, Clone)]
struct DragPayload {
    phase: &'static str,
    x: f64,
    y: f64,
    count: usize,
    files: Vec<DroppedFile>,
}

fn mime_of(path: &PathBuf) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "pdf" => Some("application/pdf"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "txt" => Some("text/plain"),
        _ => None,
    }
}

fn describe(index: usize, path: &PathBuf) -> DroppedFile {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
    let meta = std::fs::metadata(path).ok();
    let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let problem = if meta.as_ref().map(|m| m.is_dir()).unwrap_or(false) {
        Some("Folders can't be attached.".to_string())
    } else if mime_of(path).is_none() {
        Some("Only PDF, PNG, JPEG, WebP and TXT files.".to_string())
    } else if size > MAX_BYTES {
        Some("Larger than 25 MB.".to_string())
    } else {
        None
    };
    DroppedFile { index, name, size, problem }
}

/// Called from the window's drag-and-drop events.
pub fn on_drag(app: &AppHandle, event: &DragDropEvent, scale: f64) {
    let (phase, pos, paths): (&'static str, Option<(f64, f64)>, Option<&Vec<PathBuf>>) = match event {
        DragDropEvent::Enter { paths, position } => ("enter", Some((position.x, position.y)), Some(paths)),
        DragDropEvent::Over { position } => ("over", Some((position.x, position.y)), None),
        DragDropEvent::Drop { paths, position } => ("drop", Some((position.x, position.y)), Some(paths)),
        DragDropEvent::Leave => ("leave", None, None),
        _ => return,
    };
    let (x, y) = pos.map(|(x, y)| (x / scale, y / scale)).unwrap_or((-1.0, -1.0));
    let mut files = vec![];
    if phase == "drop" {
        let paths = paths.cloned().unwrap_or_default();
        files = paths.iter().take(10).enumerate().map(|(i, p)| describe(i, p)).collect();
        *app.state::<Dropped>().0.lock().unwrap() = paths.into_iter().take(10).collect();
    }
    let count = paths.map(|p| p.len()).unwrap_or(0);
    let _ = app.emit("brenda://drag", DragPayload { phase, x, y, count, files });
}

/// Uploads one dropped file (by its index in the last drop) to a task. Returns Boredroom's answer: the staged file id.
#[tauri::command]
pub async fn upload_dropped(state: State<'_, AppState>, dropped: State<'_, Dropped>, index: usize, task_id: String) -> Result<serde_json::Value, crate::ApiError> {
    let fail = |status: u16, message: &str| crate::ApiError::new(status, message);
    if !task_id.chars().all(|c| c.is_ascii_hexdigit() || c == '-') || task_id.len() != 36 {
        return Err(fail(400, "Pick a task."));
    }
    let path = dropped.0.lock().unwrap().get(index).cloned().ok_or_else(|| fail(400, "Drop the file again."))?;
    let mime = mime_of(&path).ok_or_else(|| fail(400, "Only PDF, PNG, JPEG, WebP and TXT files."))?;
    let bytes = tokio::fs::read(&path).await.map_err(|_| fail(400, "That file can't be read."))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(fail(400, "Larger than 25 MB."));
    }
    let (base, token, slug) = {
        let c = state.config.lock().unwrap();
        (base_url(&c), c.token.clone(), c.workspace_slug.clone())
    };
    let (Some(token), Some(slug)) = (token, slug) else { return Err(fail(401, "Not signed in.")) };
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "evidence".into());
    let part = reqwest::multipart::Part::bytes(bytes).file_name(name).mime_str(mime).map_err(|_| fail(400, "Unknown file type."))?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let url = format!("{base}/api/orgs/{slug}/tasks/{task_id}/uploads");
    let res = state.http.post(url).bearer_auth(token).timeout(std::time::Duration::from_secs(180)).multipart(form).send().await.map_err(|e| fail(0, &format!("Cannot reach Boredroom: {e}")))?;
    let status = res.status().as_u16();
    let value: serde_json::Value = res.json().await.unwrap_or(serde_json::Value::Null);
    if status >= 400 {
        return Err(fail(status, value.get("message").and_then(|m| m.as_str()).unwrap_or("Upload failed.")));
    }
    Ok(value)
}
