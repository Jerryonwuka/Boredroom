//! File work on request (owner request, 12 October 2026: "help you work on a file and it does that in the background
//! while you're still working"; owner rule: only when the person asks and says yes; companion-spec A.8, B.9).
//!
//! What this file promises, and how:
//! - Files are only gathered during a look, only with "Let Brenda work on files" on, and only from places the person
//!   chose: a file dropped on the notch in the last two minutes, the files selected in Finder (Finder in front or the
//!   pointer on the desktop), the document open in the front window, the item under the pointer. Their names, kinds and
//!   sizes go in the look request; their paths never leave Rust.
//! - A file is read only after the person said yes to a proposal naming exactly that file (`sources_match`), at most
//!   25 MB, and only that file.
//! - Nothing is ever overwritten: the result is a NEW file next to the original, opened with `create_new`, "… 2",
//!   "… 3" when the name is taken. Buffers holding the file are wiped after sending.
//! - Everything here runs on the Mac: text through `textutil` and PDFKit, spreadsheets through a small reader of their
//!   XML, Word output through `textutil`, PDF output through WebKit.
//! - Folders (owner request, 12 October 2026: "look through my documents and summarise them"): with file work on, a
//!   look also notes the folder the person points at (the Finder window in front, or the desktop) and folders selected
//!   in Finder, at most three, by name only (`folder_candidates`); `folder.rs` lists one only for a proposal their own
//!   words asked for. A folder job reads each file with its text cut at 200,000 characters (`read_capped`) instead of
//!   refusing a long one.

use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};

use crate::look::wipe;

pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_TEXT_CHARS: usize = 400_000;
/// PDFs up to this size go as the PDF itself; larger ones as their text.
pub const PDF_INLINE_BYTES: u64 = 2_621_440;
pub const IMAGE_LONG_EDGE: u32 = 1_568;
pub const IMAGE_MAX_BYTES: usize = 2_000_000;
pub const MAX_CANDIDATES: usize = 10;
/// Characters per page, for "It's about {pages} pages".
pub const CHARS_PER_PAGE: usize = 3_000;
pub const XLSX_MAX_SHEETS: usize = 10;
pub const XLSX_MAX_CELLS: usize = 50_000;
/// Uncompressed size cap per part of a spreadsheet.
pub const XLSX_PART_MAX: usize = 60 * 1024 * 1024;
pub const NAME_MAX: usize = 255;
pub const COLLISION_MAX: u32 = 99;
const TOOL_TIMEOUT: Duration = Duration::from_secs(20);
const FINDER_TIMEOUT: Duration = Duration::from_secs(5);

/// Where a file came from (the proposal names one of these and the file's exact name).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Pointer,
    FrontDocument,
    FinderSelection,
    Dropped,
    /// The folder of the Finder window in front (or the desktop under the pointer): folders only.
    FrontFolder,
}

/// How a file is read (B.9.2), by extension then a sniff.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Text,
    Pdf,
    Document,
    Spreadsheet,
    Image,
    Other,
    /// A folder the person pointed at or selected (never read as a file).
    Folder,
}

const TEXT_EXT: &[&str] = &[
    "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "log", "rs", "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rb", "go", "java", "kt", "swift",
    "c", "h", "cc", "cpp", "hpp", "cs", "php", "sh", "zsh", "bash", "sql", "css", "scss", "toml", "ini", "cfg", "conf", "env.example", "tex", "r", "lua", "pl",
    "dart", "scala", "vue", "svelte", "graphql", "proto", "srt", "vtt",
];
const DOC_EXT: &[&str] = &["docx", "doc", "rtf", "rtfd", "odt", "html", "htm", "webarchive"];
const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "heic", "webp", "gif"];

pub fn kind_of(path: &Path, head: &[u8]) -> Kind {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    if ext == "pdf" {
        return Kind::Pdf;
    }
    if ext == "xlsx" {
        return Kind::Spreadsheet;
    }
    if TEXT_EXT.contains(&ext.as_str()) {
        return Kind::Text;
    }
    if DOC_EXT.contains(&ext.as_str()) {
        return Kind::Document;
    }
    if IMAGE_EXT.contains(&ext.as_str()) {
        return Kind::Image;
    }
    if !ext.is_empty() {
        return Kind::Other;
    }
    // No extension: sniff.
    if head.starts_with(b"%PDF") {
        Kind::Pdf
    } else if head.starts_with(&[0x89, b'P', b'N', b'G']) || head.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Kind::Image
    } else if !head.is_empty() && !head.contains(&0) && std::str::from_utf8(&head[..head.len().min(512)]).is_ok() {
        Kind::Text
    } else {
        Kind::Other
    }
}

/// A file the person could mean, held by Rust only.
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub source: Source,
    pub name: String,
    pub kind: Kind,
    pub bytes: u64,
    pub path: PathBuf,
    /// The app it was found in (the front document's app, the app under the pointer, Finder), so the server can refuse a
    /// file from an app on a never-look list too (review, 12 October 2026). None for a file dropped on Brenda.
    pub app: Option<SourceApp>,
}

/// An app a candidate came from.
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SourceApp {
    pub name: String,
    #[serde(rename = "bundleId")]
    pub bundle_id: Option<String>,
}

/// What the look request says about a candidate (never its path).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Hint {
    pub source: Source,
    pub name: String,
    pub kind: Kind,
    pub bytes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app: Option<SourceApp>,
}

impl Candidate {
    pub fn hint(&self) -> Hint {
        Hint { source: self.source, name: self.name.clone(), kind: self.kind, bytes: self.bytes, app: self.app.clone() }
    }
}

/// A path Brenda may read for file work: canonical, a regular file, inside the person's home folder or `/Volumes`
/// (so a link cannot lead elsewhere), its name at most 255 characters.
pub fn allowed_path(path: &Path, home: Option<&Path>) -> Option<PathBuf> {
    let canon = std::fs::canonicalize(path).ok()?;
    let meta = std::fs::metadata(&canon).ok()?;
    if !meta.is_file() {
        return None;
    }
    let inside = home.is_some_and(|h| canon.starts_with(h)) || canon.starts_with("/Volumes");
    if !inside {
        return None;
    }
    let name = canon.file_name()?.to_string_lossy();
    (name.chars().count() <= NAME_MAX && !name.is_empty()).then_some(canon)
}

pub fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).and_then(|h| std::fs::canonicalize(h).ok())
}

/// A candidate from a path, if it may be read.
pub fn candidate(source: Source, path: &Path) -> Option<Candidate> {
    let canon = allowed_path(path, home().as_deref())?;
    let bytes = std::fs::metadata(&canon).ok()?.len();
    let mut head = [0u8; 16];
    let n = std::fs::File::open(&canon).ok().and_then(|mut f| std::io::Read::read(&mut f, &mut head).ok()).unwrap_or(0);
    let name = canon.file_name()?.to_string_lossy().to_string();
    Some(Candidate { source, name, kind: kind_of(&canon, &head[..n]), bytes, path: canon, app: None })
}

/// The one candidate the proposal names, exactly (B.9.1); anything else is unresolved.
pub fn sources_match<'a>(cands: &'a [Candidate], source: Source, name: &str) -> Option<&'a Candidate> {
    cands.iter().find(|c| c.source == source && c.name == name)
}

/// The files selected in Finder, by asking Finder (5 s at most; the Automation permission was asked when the person
/// turned file work on).
pub fn finder_selection() -> Vec<PathBuf> {
    const SCRIPT: &str = "tell application \"Finder\"\n  set out to \"\"\n  repeat with i in (get selection)\n    set out to out & POSIX path of (i as alias) & linefeed\n  end repeat\nend tell\nreturn out";
    let Some(out) = run_tool("/usr/bin/osascript", &["-e", SCRIPT], FINDER_TIMEOUT) else { return vec![] };
    String::from_utf8_lossy(&out).lines().map(str::trim).filter(|l| l.starts_with('/')).take(MAX_CANDIDATES).map(PathBuf::from).collect()
}

/// The folder of the Finder window in front, by asking Finder (5 s at most).
pub fn front_folder() -> Option<PathBuf> {
    const SCRIPT: &str = "tell application \"Finder\"\n  if (count of Finder windows) > 0 then return POSIX path of (target of front Finder window as alias)\nend tell\nreturn \"\"";
    let out = run_tool("/usr/bin/osascript", &["-e", SCRIPT], FINDER_TIMEOUT)?;
    let line = String::from_utf8_lossy(&out).trim().to_string();
    line.starts_with('/').then(|| PathBuf::from(line))
}

/// A folder the person pointed at or selected, if it may be listed (`folder::folder_ok`): canonical, inside the home
/// folder or a disk, nothing hidden, `Library`, a package or a never-look app's.
pub fn folder_candidate(source: Source, path: &Path, home: &Path, never: &[String]) -> Option<Candidate> {
    let canon = std::fs::canonicalize(path).ok()?;
    if !std::fs::metadata(&canon).ok()?.is_dir() || !crate::folder::folder_ok(&canon, home, never) {
        return None;
    }
    let name = if canon == home { "your home folder".to_string() } else { canon.file_name()?.to_string_lossy().to_string() };
    (name.chars().count() <= NAME_MAX && !name.is_empty() && !name.contains(['/', '\n', '\r'])).then_some(Candidate { source, name, kind: Kind::Folder, bytes: 0, path: canon, app: None })
}

/// The folders a look notes (companion2-spec C.1): the front Finder window's (or the desktop's) and those selected in
/// Finder, at most three. Only called with file work on, with Finder in front or the pointer on the desktop.
pub fn folder_candidates(front: bool, desktop: bool, selection: &[PathBuf], home: &Path, never: &[String]) -> Vec<Candidate> {
    let mut out = Vec::new();
    let front_dir = if desktop { Some(home.join("Desktop")) } else if front { front_folder() } else { None };
    if let Some(p) = front_dir {
        out.extend(folder_candidate(Source::FrontFolder, &p, home, never));
    }
    for p in selection.iter().filter(|p| p.to_string_lossy().ends_with('/')) {
        out.extend(folder_candidate(Source::FinderSelection, p, home, never));
    }
    out.truncate(crate::folder::MAX_FOLDER_CANDIDATES);
    out
}

/// Asks Finder one harmless question, so macOS shows its "Brenda wants to control Finder" prompt while the person is
/// turning file work on (B.9.5). True when Finder answered.
pub fn finder_probe() -> bool {
    run_tool("/usr/bin/osascript", &["-e", "tell application \"Finder\" to get name of startup disk"], Duration::from_secs(10)).is_some()
}

/// Runs a system tool with a time limit; its output, or None when it failed or ran too long.
fn run_tool(program: &str, args: &[&str], limit: Duration) -> Option<Vec<u8>> {
    let mut child = Command::new(program).args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut out = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = std::io::Read::read_to_end(&mut out, &mut buf);
        buf
    });
    let started = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let buf = reader.join().ok()?;
                return status.success().then_some(buf);
            }
            Ok(None) if started.elapsed() < limit => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

// ---- reading ---------------------------------------------------------------------------------------------------------

/// Why a file job stops before it starts (A.10 reasons).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Refusal {
    FileUnresolved,
    FileTooBig,
    FileType,
    FileScan,
    FileLong,
    FileFailed,
}

/// The file as it is sent to `/file` (B.9.3). Wiped when dropped.
pub enum Payload {
    Text { text: String, pages: Option<usize> },
    Pdf { data: Vec<u8> },
    Image { jpeg: Vec<u8>, width: u32, height: u32 },
}

impl Drop for Payload {
    fn drop(&mut self) {
        match self {
            Payload::Text { text, .. } => unsafe { text.as_bytes_mut().fill(0) },
            Payload::Pdf { data } => wipe(data),
            Payload::Image { jpeg, .. } => wipe(jpeg),
        }
    }
}

impl std::fmt::Debug for Payload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Payload::Text { text, pages } => write!(f, "Text({} chars, {pages:?} pages)", text.chars().count()),
            Payload::Pdf { data } => write!(f, "Pdf({} bytes)", data.len()),
            Payload::Image { jpeg, width, height } => write!(f, "Image({width}x{height}, {} bytes)", jpeg.len()),
        }
    }
}

fn pages_of(chars: usize) -> usize {
    chars.div_ceil(CHARS_PER_PAGE).max(1)
}

/// Text read from a file, checked for length.
fn text_payload(text: String) -> Result<Payload, (Refusal, Option<usize>)> {
    let n = text.chars().count();
    if n > MAX_TEXT_CHARS {
        let pages = pages_of(n);
        let mut t = text;
        unsafe { t.as_bytes_mut().fill(0) };
        return Err((Refusal::FileLong, Some(pages)));
    }
    Ok(Payload::Text { pages: Some(pages_of(n)), text })
}

/// Reads the file the person said yes to (B.9.2). The error carries the pages for `file_long`.
pub fn read(c: &Candidate) -> Result<Payload, (Refusal, Option<usize>)> {
    let meta = std::fs::metadata(&c.path).map_err(|_| (Refusal::FileUnresolved, None))?;
    if !meta.is_file() {
        return Err((Refusal::FileUnresolved, None));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err((Refusal::FileTooBig, None));
    }
    match c.kind {
        Kind::Text => {
            let mut bytes = std::fs::read(&c.path).map_err(|_| (Refusal::FileFailed, None))?;
            let text = String::from_utf8_lossy(&bytes).into_owned();
            wipe(&mut bytes);
            text_payload(text)
        }
        Kind::Pdf => {
            if meta.len() <= PDF_INLINE_BYTES {
                let data = std::fs::read(&c.path).map_err(|_| (Refusal::FileFailed, None))?;
                if !data.starts_with(b"%PDF") {
                    return Err((Refusal::FileType, None));
                }
                return Ok(Payload::Pdf { data });
            }
            let text = pdf_text(&c.path).ok_or((Refusal::FileFailed, None))?;
            if text.trim().is_empty() {
                return Err((Refusal::FileScan, None));
            }
            text_payload(text)
        }
        Kind::Document => {
            let out = run_tool("/usr/bin/textutil", &["-convert", "txt", "-stdout", &c.path.to_string_lossy()], TOOL_TIMEOUT).ok_or((Refusal::FileFailed, None))?;
            text_payload(String::from_utf8_lossy(&out).into_owned())
        }
        Kind::Spreadsheet => {
            let mut bytes = std::fs::read(&c.path).map_err(|_| (Refusal::FileFailed, None))?;
            let csv = xlsx_to_csv(&bytes);
            wipe(&mut bytes);
            text_payload(csv.ok_or((Refusal::FileType, None))?)
        }
        Kind::Image => {
            let mut bytes = std::fs::read(&c.path).map_err(|_| (Refusal::FileFailed, None))?;
            let out = crate::capture::image_file_to_jpeg(&bytes, IMAGE_LONG_EDGE, IMAGE_MAX_BYTES);
            wipe(&mut bytes);
            let (jpeg, width, height) = out.ok_or((Refusal::FileType, None))?;
            Ok(Payload::Image { jpeg, width, height })
        }
        Kind::Other | Kind::Folder => Err((Refusal::FileType, None)),
    }
}

/// Reads a file for a folder job (companion2-spec C.2): as `read`, but text longer than `max` characters is cut there
/// (true) instead of refused.
pub fn read_capped(c: &Candidate, max: usize) -> Result<(Payload, bool), (Refusal, Option<usize>)> {
    // Read with phase 2's reader, but a text too long for it is read again and cut rather than refused.
    let meta = std::fs::metadata(&c.path).map_err(|_| (Refusal::FileUnresolved, None))?;
    if !meta.is_file() {
        return Err((Refusal::FileUnresolved, None));
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err((Refusal::FileTooBig, None));
    }
    let raw = match c.kind {
        Kind::Text => {
            let mut bytes = std::fs::read(&c.path).map_err(|_| (Refusal::FileFailed, None))?;
            let text = String::from_utf8_lossy(&bytes).into_owned();
            wipe(&mut bytes);
            Some(text)
        }
        Kind::Document => Some(String::from_utf8_lossy(&run_tool("/usr/bin/textutil", &["-convert", "txt", "-stdout", &c.path.to_string_lossy()], TOOL_TIMEOUT).ok_or((Refusal::FileFailed, None))?).into_owned()),
        Kind::Spreadsheet => {
            let mut bytes = std::fs::read(&c.path).map_err(|_| (Refusal::FileFailed, None))?;
            let csv = xlsx_to_csv(&bytes);
            wipe(&mut bytes);
            Some(csv.ok_or((Refusal::FileType, None))?)
        }
        Kind::Pdf if meta.len() > PDF_INLINE_BYTES => {
            let text = pdf_text(&c.path).ok_or((Refusal::FileFailed, None))?;
            if text.trim().is_empty() {
                return Err((Refusal::FileScan, None));
            }
            Some(text)
        }
        _ => None,
    };
    match raw {
        None => read(c).map(|p| (p, false)),
        Some(text) => {
            let (text, cut) = cut_text(text, max);
            let n = text.chars().count();
            Ok((Payload::Text { pages: Some(pages_of(n)), text }, cut))
        }
    }
}

/// The first `max` characters of `text` (the rest wiped); true when it was cut.
pub fn cut_text(mut text: String, max: usize) -> (String, bool) {
    match text.char_indices().nth(max) {
        None => (text, false),
        Some((at, _)) => {
            unsafe { text.as_bytes_mut()[at..].fill(0) };
            text.truncate(at);
            (text, true)
        }
    }
}

/// The `/file` request's `file` object (B.9.3): `{source, name, kind, mediaType, text?, data?, bytes, pages?}`.
pub struct FileJson<'a> {
    pub candidate: &'a Candidate,
    pub payload: &'a Payload,
}

impl Serialize for FileJson<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use base64::Engine;
        use serde::ser::SerializeMap;
        let c = self.candidate;
        let mut m = s.serialize_map(None)?;
        m.serialize_entry("source", &c.source)?;
        m.serialize_entry("name", &c.name)?;
        m.serialize_entry("bytes", &c.bytes)?;
        let mut encoded: Option<String> = None;
        match self.payload {
            Payload::Text { text, pages } => {
                m.serialize_entry("kind", "text")?;
                m.serialize_entry("mediaType", "text/plain")?;
                m.serialize_entry("text", text)?;
                m.serialize_entry("pages", pages)?;
            }
            Payload::Pdf { data } => {
                m.serialize_entry("kind", "pdf")?;
                m.serialize_entry("mediaType", "application/pdf")?;
                encoded = Some(base64::engine::general_purpose::STANDARD.encode(data));
            }
            Payload::Image { jpeg, .. } => {
                m.serialize_entry("kind", "image")?;
                m.serialize_entry("mediaType", "image/jpeg")?;
                encoded = Some(base64::engine::general_purpose::STANDARD.encode(jpeg));
            }
        }
        if let Some(mut e) = encoded {
            let r = m.serialize_entry("data", &e);
            unsafe { e.as_bytes_mut().fill(0) };
            r?;
        }
        m.end()
    }
}

/// A large PDF's text through PDFKit (macOS; weak-linked in build.rs).
#[cfg(target_os = "macos")]
pub fn pdf_text(path: &Path) -> Option<String> {
    use objc2::{msg_send, rc::autoreleasepool, rc::Allocated, rc::Retained, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSString;
    autoreleasepool(|_| {
        let cls = AnyClass::get(c"PDFDocument")?;
        let url_cls = AnyClass::get(c"NSURL")?;
        let p = NSString::from_str(&path.to_string_lossy());
        let url: Option<Retained<AnyObject>> = unsafe { msg_send![url_cls, fileURLWithPath: &*p] };
        let url = url?;
        let doc: Option<Retained<AnyObject>> = unsafe {
            let alloc: Allocated<AnyObject> = msg_send![cls, alloc];
            msg_send![alloc, initWithURL: &*url]
        };
        let doc = doc?;
        let s: Option<Retained<NSString>> = unsafe { msg_send![&*doc, string] };
        Some(s.map(|s| s.to_string()).unwrap_or_default())
    })
}

#[cfg(not(target_os = "macos"))]
pub fn pdf_text(_path: &Path) -> Option<String> {
    None
}

// ---- the spreadsheet reader (a zip of XML) ---------------------------------------------------------------------------

fn u16_at(b: &[u8], p: usize) -> Option<u16> {
    b.get(p..p + 2).map(|s| u16::from_le_bytes([s[0], s[1]]))
}
fn u32_at(b: &[u8], p: usize) -> Option<u32> {
    b.get(p..p + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// The parts of a zip archive, by name: (method, compressed size, uncompressed size, local header offset).
fn zip_entries(b: &[u8]) -> Option<Vec<(String, u16, usize, usize, usize)>> {
    let start = b.len().saturating_sub(65_557);
    let eocd = (start..b.len().saturating_sub(21)).rev().find(|&i| u32_at(b, i) == Some(0x0605_4b50))?;
    let count = u16_at(b, eocd + 10)? as usize;
    let mut p = u32_at(b, eocd + 16)? as usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        if u32_at(b, p)? != 0x0201_4b50 {
            return None;
        }
        let method = u16_at(b, p + 10)?;
        let csize = u32_at(b, p + 20)? as usize;
        let usize_ = u32_at(b, p + 24)? as usize;
        let nlen = u16_at(b, p + 28)? as usize;
        let elen = u16_at(b, p + 30)? as usize;
        let clen = u16_at(b, p + 32)? as usize;
        let offset = u32_at(b, p + 42)? as usize;
        let name = String::from_utf8_lossy(b.get(p + 46..p + 46 + nlen)?).into_owned();
        out.push((name, method, csize, usize_, offset));
        p += 46 + nlen + elen + clen;
    }
    Some(out)
}

fn zip_read(b: &[u8], entries: &[(String, u16, usize, usize, usize)], name: &str) -> Option<String> {
    let (_, method, csize, usize_, offset) = entries.iter().find(|e| e.0 == name)?.clone();
    if usize_ > XLSX_PART_MAX {
        return None;
    }
    if u32_at(b, offset)? != 0x0403_4b50 {
        return None;
    }
    let nlen = u16_at(b, offset + 26)? as usize;
    let elen = u16_at(b, offset + 28)? as usize;
    let data = b.get(offset + 30 + nlen + elen..offset + 30 + nlen + elen + csize)?;
    let bytes = match method {
        0 => data.to_vec(),
        8 => {
            let mut out = Vec::with_capacity(usize_);
            let dec = flate2::read::DeflateDecoder::new(data);
            std::io::Read::read_to_end(&mut std::io::Read::take(dec, XLSX_PART_MAX as u64 + 1), &mut out).ok()?;
            if out.len() > XLSX_PART_MAX {
                return None;
            }
            out
        }
        _ => return None,
    };
    String::from_utf8(bytes).ok()
}

/// One XML tag or text run, from a small scanner (spreadsheet XML is plain: no DTDs, no CDATA that matters).
#[derive(Debug, PartialEq)]
enum Tok<'a> {
    Open { name: &'a str, attrs: &'a str, empty: bool },
    Close { name: &'a str },
    Text(String),
}

fn unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';').filter(|&e| e <= 12) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let ent = &rest[1..end];
        let ch = match ent {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
            _ if ent.starts_with('#') => ent[1..].parse::<u32>().ok().and_then(char::from_u32),
            _ => None,
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn tokens(xml: &str) -> Vec<Tok<'_>> {
    let mut out = Vec::new();
    let mut rest = xml;
    while !rest.is_empty() {
        match rest.find('<') {
            Some(0) => {
                let Some(end) = rest.find('>') else { break };
                let inner = &rest[1..end];
                rest = &rest[end + 1..];
                if inner.starts_with('?') || inner.starts_with('!') {
                    continue;
                }
                if let Some(name) = inner.strip_prefix('/') {
                    out.push(Tok::Close { name: name.trim() });
                    continue;
                }
                let empty = inner.ends_with('/');
                let inner = inner.trim_end_matches('/');
                let (name, attrs) = inner.split_once(|c: char| c.is_whitespace()).unwrap_or((inner, ""));
                out.push(Tok::Open { name, attrs, empty });
            }
            Some(i) => {
                out.push(Tok::Text(unescape(&rest[..i])));
                rest = &rest[i..];
            }
            None => {
                out.push(Tok::Text(unescape(rest)));
                break;
            }
        }
    }
    out
}

fn attr(attrs: &str, key: &str) -> Option<String> {
    let mut rest = attrs;
    while let Some(eq) = rest.find('=') {
        let k = rest[..eq].trim();
        let after = rest[eq + 1..].trim_start();
        let q = after.chars().next()?;
        if q != '"' && q != '\'' {
            return None;
        }
        let close = after[1..].find(q)? + 1;
        if k == key {
            return Some(unescape(&after[1..close]));
        }
        rest = &after[close + 1..];
    }
    None
}

/// "B12" → column 1 (A = 0).
fn column_of(r: &str) -> Option<usize> {
    let letters: String = r.chars().take_while(|c| c.is_ascii_alphabetic()).collect();
    if letters.is_empty() {
        return None;
    }
    Some(letters.to_ascii_uppercase().bytes().fold(0usize, |n, b| n * 26 + (b - b'A' + 1) as usize) - 1)
}

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Each sheet of an .xlsx file as CSV, under a "Sheet: {name}" line (at most 10 sheets and 50,000 cells). None when it
/// is not a spreadsheet this reader understands.
pub fn xlsx_to_csv(bytes: &[u8]) -> Option<String> {
    let entries = zip_entries(bytes)?;
    let workbook = zip_read(bytes, &entries, "xl/workbook.xml")?;
    let rels = zip_read(bytes, &entries, "xl/_rels/workbook.xml.rels").unwrap_or_default();
    let mut targets = std::collections::HashMap::new();
    for t in tokens(&rels) {
        if let Tok::Open { name: "Relationship", attrs, .. } = t {
            if let (Some(id), Some(target)) = (attr(attrs, "Id"), attr(attrs, "Target")) {
                let path = if let Some(abs) = target.strip_prefix('/') { abs.to_string() } else { format!("xl/{target}") };
                targets.insert(id, path);
            }
        }
    }
    let mut sheets = Vec::new();
    for t in tokens(&workbook) {
        if let Tok::Open { name: "sheet", attrs, .. } = t {
            let name = attr(attrs, "name").unwrap_or_else(|| format!("Sheet{}", sheets.len() + 1));
            let path = attr(attrs, "r:id").and_then(|id| targets.get(&id).cloned()).unwrap_or_else(|| format!("xl/worksheets/sheet{}.xml", sheets.len() + 1));
            sheets.push((name, path));
        }
    }
    let shared: Vec<String> = match zip_read(bytes, &entries, "xl/sharedStrings.xml") {
        None => vec![],
        Some(xml) => {
            let mut out = vec![];
            let (mut in_si, mut in_t, mut cur) = (false, false, String::new());
            for t in tokens(&xml) {
                match t {
                    Tok::Open { name: "si", empty, .. } => {
                        in_si = !empty;
                        cur.clear();
                        if empty {
                            out.push(String::new());
                        }
                    }
                    Tok::Close { name: "si" } => {
                        in_si = false;
                        out.push(std::mem::take(&mut cur));
                    }
                    Tok::Open { name: "t", empty: false, .. } if in_si => in_t = true,
                    Tok::Close { name: "t" } => in_t = false,
                    Tok::Text(s) if in_t => cur.push_str(&s),
                    _ => {}
                }
            }
            out
        }
    };
    let mut csv = String::new();
    let mut cells = 0usize;
    for (name, path) in sheets.iter().take(XLSX_MAX_SHEETS) {
        let Some(xml) = zip_read(bytes, &entries, path) else { continue };
        csv.push_str(&format!("Sheet: {name}\n"));
        let mut row: Vec<String> = vec![];
        let (mut col, mut ty, mut in_v, mut in_is_t, mut val) = (0usize, String::new(), false, false, String::new());
        for t in tokens(&xml) {
            match t {
                Tok::Open { name: "row", empty, .. } => {
                    row.clear();
                    if empty {
                        csv.push('\n');
                    }
                }
                Tok::Close { name: "row" } => {
                    csv.push_str(&row.iter().map(|c| csv_field(c)).collect::<Vec<_>>().join(","));
                    csv.push('\n');
                }
                Tok::Open { name: "c", attrs, empty } => {
                    col = attr(attrs, "r").and_then(|r| column_of(&r)).unwrap_or(row.len());
                    ty = attr(attrs, "t").unwrap_or_default();
                    val.clear();
                    if empty {
                        while row.len() <= col {
                            row.push(String::new());
                        }
                    }
                }
                Tok::Close { name: "c" } => {
                    cells += 1;
                    if cells > XLSX_MAX_CELLS {
                        return Some(csv);
                    }
                    let shown = match ty.as_str() {
                        "s" => val.trim().parse::<usize>().ok().and_then(|i| shared.get(i).cloned()).unwrap_or_default(),
                        "b" => if val.trim() == "1" { "TRUE".into() } else { "FALSE".into() },
                        _ => val.clone(),
                    };
                    if col < 16_384 {
                        while row.len() <= col {
                            row.push(String::new());
                        }
                        row[col] = shown;
                    }
                }
                Tok::Open { name: "v", empty: false, .. } => in_v = true,
                Tok::Close { name: "v" } => in_v = false,
                Tok::Open { name: "t", empty: false, .. } => in_is_t = true,
                Tok::Close { name: "t" } => in_is_t = false,
                Tok::Text(s) if in_v || in_is_t => val.push_str(&s),
                _ => {}
            }
        }
    }
    (!sheets.is_empty()).then_some(csv)
}

// ---- writing ---------------------------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Md,
    Txt,
    Csv,
    Docx,
    Pdf,
    Doc,
}

impl Format {
    pub fn ext(self) -> Option<&'static str> {
        match self {
            Format::Md => Some("md"),
            Format::Txt => Some("txt"),
            Format::Csv => Some("csv"),
            Format::Docx => Some("docx"),
            Format::Pdf => Some("pdf"),
            Format::Doc => None,
        }
    }
}

/// The server's output name, if it is a plain file name for this format: no `/`, `\`, `:` or control characters, no
/// leading dot, at most 255 characters, ending with the format's extension.
pub fn output_name_ok(name: &str, format: Format) -> bool {
    let Some(ext) = format.ext() else { return false };
    !name.is_empty()
        && name.chars().count() <= NAME_MAX
        && !name.starts_with('.')
        && !name.chars().any(|c| c == '/' || c == '\\' || c == ':' || c.is_control())
        && name.to_lowercase().ends_with(&format!(".{ext}"))
        && name.len() > ext.len() + 1
}

/// The first free name in `dir`: `name`, then "stem 2.ext", "stem 3.ext"… up to 99 (B.9.4). `write_output` takes the
/// same names in the same order, each with `create_new`.
#[cfg_attr(not(test), allow(dead_code))]
pub fn output_path(dir: &Path, name: &str) -> Option<PathBuf> {
    candidates(dir, name).into_iter().find(|p| !p.exists())
}

fn candidates(dir: &Path, name: &str) -> Vec<PathBuf> {
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string());
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut out = vec![dir.join(name)];
    for n in 2..=COLLISION_MAX {
        out.push(dir.join(format!("{stem} {n}{ext}")));
    }
    out
}

/// Creates the first free name with `create_new` (never replacing anything, even if a file appears meanwhile).
fn create_new(dir: &Path, name: &str) -> Result<(PathBuf, std::fs::File), String> {
    for path in candidates(dir, name) {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(f) => return Ok((path, f)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(_) => return Err("I couldn't save a file in that folder.".into()),
        }
    }
    Err("Too many files with that name already.".into())
}

/// Writes `content` (md, txt, csv) or `html` (docx through textutil) as a new file next to the original. PDF output is
/// `pdf_bytes` (made by WebKit, `act.rs`). Returns the path written.
pub fn write_output(dir: &Path, name: &str, format: Format, content: &str, html: Option<&str>, pdf_bytes: Option<&[u8]>) -> Result<PathBuf, String> {
    if !output_name_ok(name, format) {
        return Err("That file name isn't one I can use.".into());
    }
    match format {
        Format::Md | Format::Txt | Format::Csv => {
            let (path, mut f) = create_new(dir, name)?;
            if f.write_all(content.as_bytes()).and_then(|_| f.flush()).is_err() {
                let _ = std::fs::remove_file(&path);
                return Err("I couldn't write the file.".into());
            }
            Ok(path)
        }
        Format::Pdf => {
            let bytes = pdf_bytes.filter(|b| b.starts_with(b"%PDF")).ok_or("PDF_UNAVAILABLE")?;
            let (path, mut f) = create_new(dir, name)?;
            if f.write_all(bytes).and_then(|_| f.flush()).is_err() {
                let _ = std::fs::remove_file(&path);
                return Err("I couldn't write the file.".into());
            }
            Ok(path)
        }
        Format::Docx => {
            let html = html.ok_or("I couldn't make that document.")?;
            // Reserve the name first (so nothing is ever replaced), then let textutil fill our own empty file.
            let (path, f) = create_new(dir, name)?;
            drop(f);
            let tmp = std::env::temp_dir().join(format!("brenda-{:016x}.html", random_u64()));
            let written = (|| -> std::io::Result<()> {
                let mut t = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
                }
                t.write_all(html.as_bytes())?;
                t.flush()
            })();
            let ok = written.is_ok()
                && run_tool("/usr/bin/textutil", &["-convert", "docx", "-output", &path.to_string_lossy(), &tmp.to_string_lossy()], TOOL_TIMEOUT).is_some();
            let _ = std::fs::remove_file(&tmp);
            if !ok || std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) == 0 {
                let _ = std::fs::remove_file(&path);
                return Err("I couldn't make the Word document.".into());
            }
            Ok(path)
        }
        Format::Doc => Err("A Boredroom document isn't saved on the Mac.".into()),
    }
}

fn random_u64() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("brenda-filework-{tag}-{}-{:x}", std::process::id(), random_u64()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn output_path_never_replaces() {
        let d = scratch("out");
        assert_eq!(output_path(&d, "Q3 report (Brenda brief).md"), Some(d.join("Q3 report (Brenda brief).md")));
        std::fs::write(d.join("Q3 report (Brenda brief).md"), "x").unwrap();
        assert_eq!(output_path(&d, "Q3 report (Brenda brief).md"), Some(d.join("Q3 report (Brenda brief) 2.md")));
        std::fs::write(d.join("Q3 report (Brenda brief) 2.md"), "x").unwrap();
        assert_eq!(output_path(&d, "Q3 report (Brenda brief).md"), Some(d.join("Q3 report (Brenda brief) 3.md")));
        let p = write_output(&d, "Q3 report (Brenda brief).md", Format::Md, "# Brief", None, None).unwrap();
        assert_eq!(p, d.join("Q3 report (Brenda brief) 3.md"));
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "# Brief");
        assert_eq!(std::fs::read_to_string(d.join("Q3 report (Brenda brief).md")).unwrap(), "x", "the original is untouched");
        for n in 4..=99 {
            std::fs::write(d.join(format!("full {n}.txt")), "x").unwrap();
        }
        std::fs::write(d.join("full.txt"), "x").unwrap();
        std::fs::write(d.join("full 2.txt"), "x").unwrap();
        std::fs::write(d.join("full 3.txt"), "x").unwrap();
        assert_eq!(output_path(&d, "full.txt"), None);
        assert!(write_output(&d, "full.txt", Format::Txt, "y", None, None).is_err());
        assert!(write_output(&d, "x.pdf", Format::Pdf, "", None, None).is_err(), "no PDF bytes, nothing written");
        assert!(!d.join("x.pdf").exists());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn output_names_are_plain() {
        assert!(output_name_ok("Q3 report (Brenda brief).md", Format::Md));
        assert!(output_name_ok("Notes.TXT", Format::Txt));
        assert!(!output_name_ok("../x.md", Format::Md));
        assert!(!output_name_ok(".hidden.md", Format::Md));
        assert!(!output_name_ok("a:b.md", Format::Md));
        assert!(!output_name_ok("a.md", Format::Txt), "the extension must match");
        assert!(!output_name_ok(".md", Format::Md));
        assert!(!output_name_ok("x.md", Format::Doc));
        assert!(!output_name_ok(&format!("{}.md", "a".repeat(260)), Format::Md));
    }

    #[test]
    fn kinds_by_extension_then_sniff() {
        assert_eq!(kind_of(Path::new("a.PDF"), b""), Kind::Pdf);
        assert_eq!(kind_of(Path::new("a.md"), b""), Kind::Text);
        assert_eq!(kind_of(Path::new("main.rs"), b""), Kind::Text);
        assert_eq!(kind_of(Path::new("a.docx"), b""), Kind::Document);
        assert_eq!(kind_of(Path::new("a.xlsx"), b""), Kind::Spreadsheet);
        assert_eq!(kind_of(Path::new("a.heic"), b""), Kind::Image);
        assert_eq!(kind_of(Path::new("a.pptx"), b"PK"), Kind::Other);
        assert_eq!(kind_of(Path::new("README"), b"hello"), Kind::Text);
        assert_eq!(kind_of(Path::new("scan"), b"%PDF-1.7"), Kind::Pdf);
        assert_eq!(kind_of(Path::new("blob"), &[0, 1, 2]), Kind::Other);
        assert_eq!(serde_json::to_value(Kind::Spreadsheet).unwrap(), "spreadsheet");
    }

    #[test]
    fn sources_match_exactly() {
        let c = |source, name: &str| Candidate { source, name: name.into(), kind: Kind::Pdf, bytes: 1, path: PathBuf::from("/x"), app: None };
        let cands = vec![c(Source::FinderSelection, "Q3 report.pdf"), c(Source::Dropped, "notes.txt")];
        assert!(sources_match(&cands, Source::FinderSelection, "Q3 report.pdf").is_some());
        assert!(sources_match(&cands, Source::Dropped, "Q3 report.pdf").is_none(), "the source must match too");
        assert!(sources_match(&cands, Source::FinderSelection, "q3 report.pdf").is_none(), "exactly");
        assert_eq!(serde_json::to_value(Source::FrontDocument).unwrap(), "front_document");
        let h = serde_json::to_value(cands[0].hint()).unwrap();
        assert_eq!(h, serde_json::json!({ "source": "finder_selection", "name": "Q3 report.pdf", "kind": "pdf", "bytes": 1 }), "never the path");
    }

    #[test]
    fn paths_stay_inside_and_are_files() {
        let d = scratch("paths");
        let f = d.join("a.txt");
        std::fs::write(&f, "hello").unwrap();
        let home = d.canonicalize().unwrap();
        assert_eq!(allowed_path(&f, Some(&home)), Some(f.canonicalize().unwrap()));
        assert_eq!(allowed_path(&d, Some(&home)), None, "a folder");
        assert_eq!(allowed_path(&d.join("missing"), Some(&home)), None);
        #[cfg(unix)]
        {
            let link = d.join("link");
            std::os::unix::fs::symlink("/etc/hosts", &link).unwrap();
            assert_eq!(allowed_path(&link, Some(&home)), None, "a link out of home");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn reading_text_and_refusals() {
        let d = scratch("read");
        let f = d.join("n.md");
        std::fs::write(&f, "# Notes\nhello").unwrap();
        let c = Candidate { source: Source::Dropped, name: "n.md".into(), kind: Kind::Text, bytes: 13, path: f.clone(), app: None };
        match read(&c).unwrap() {
            Payload::Text { ref text, pages } => {
                assert_eq!(text, "# Notes\nhello");
                assert_eq!(pages, Some(1));
            }
            ref other => panic!("{other:?}"),
        }
        let long = d.join("long.txt");
        std::fs::write(&long, "a".repeat(MAX_TEXT_CHARS + 1)).unwrap();
        let c2 = Candidate { path: long, kind: Kind::Text, ..c.clone() };
        assert_eq!(read(&c2).err(), Some((Refusal::FileLong, Some(134))));
        let c3 = Candidate { kind: Kind::Other, ..c.clone() };
        assert_eq!(read(&c3).err(), Some((Refusal::FileType, None)));
        let c4 = Candidate { path: d.join("gone"), ..c.clone() };
        assert_eq!(read(&c4).err(), Some((Refusal::FileUnresolved, None)));
        let pdf = d.join("p.pdf");
        std::fs::write(&pdf, b"%PDF-1.4\n%%EOF").unwrap();
        let c5 = Candidate { path: pdf, kind: Kind::Pdf, ..c.clone() };
        let p = read(&c5).unwrap();
        let v = serde_json::to_value(FileJson { candidate: &c5, payload: &p }).unwrap();
        assert_eq!(v["kind"], "pdf");
        assert_eq!(v["mediaType"], "application/pdf");
        assert!(v["data"].as_str().unwrap().starts_with("JVBERi0"));
        assert!(v.get("text").is_none());
        let _ = std::fs::remove_dir_all(&d);
    }

    /// Companion2-spec C.2: a folder job cuts long text instead of refusing it.
    #[test]
    fn read_capped_cuts_long_text() {
        assert_eq!(cut_text("héllo wörld".into(), 4), ("héll".to_string(), true));
        assert_eq!(cut_text("short".into(), 10), ("short".to_string(), false));
        let d = scratch("capped");
        let long = d.join("long.txt");
        std::fs::write(&long, "é".repeat(crate::folder::FILE_TEXT_CAP + 5)).unwrap();
        let c = Candidate { source: Source::FinderSelection, name: "long.txt".into(), kind: Kind::Text, bytes: 0, path: long, app: None };
        let (p, cut) = read_capped(&c, crate::folder::FILE_TEXT_CAP).unwrap();
        assert!(cut);
        match p {
            Payload::Text { ref text, pages } => {
                assert_eq!(text.chars().count(), crate::folder::FILE_TEXT_CAP);
                assert_eq!(pages, Some(67));
            }
            ref other => panic!("{other:?}"),
        }
        assert!(read(&c).is_ok(), "phase 2's job reads up to 400,000 characters as before");
        let short = d.join("n.md");
        std::fs::write(&short, "# Notes").unwrap();
        let c = Candidate { path: short, kind: Kind::Text, ..c };
        assert!(matches!(read_capped(&c, 10), Ok((Payload::Text { .. }, false))));
        let c = Candidate { kind: Kind::Folder, ..c };
        assert_eq!(read(&c).err(), Some((Refusal::FileType, None)), "a folder is never read as a file");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn folders_the_person_points_at() {
        let home = scratch("home").canonicalize().unwrap();
        for f in ["Documents/Invoices", "Library/Mail", ".ssh", "Pictures/Photos Library.photoslibrary", "Desktop"] {
            std::fs::create_dir_all(home.join(f)).unwrap();
        }
        std::fs::write(home.join("Documents/a.pdf"), "x").unwrap();
        let never = crate::folder::never_names(&[]);
        let c = folder_candidate(Source::FrontFolder, &home.join("Documents/Invoices"), &home, &never).unwrap();
        assert_eq!((c.name.as_str(), c.kind, c.bytes, c.source), ("Invoices", Kind::Folder, 0, Source::FrontFolder));
        assert_eq!(serde_json::to_value(c.hint()).unwrap(), serde_json::json!({ "source": "front_folder", "name": "Invoices", "kind": "folder", "bytes": 0 }));
        for no in ["Library/Mail", ".ssh", "Pictures/Photos Library.photoslibrary", "Documents/a.pdf", "Missing"] {
            assert!(folder_candidate(Source::FinderSelection, &home.join(no), &home, &never).is_none(), "{no}");
        }
        assert!(folder_candidate(Source::FinderSelection, Path::new("/etc"), &home, &never).is_none());
        assert_eq!(folder_candidate(Source::FrontFolder, &home, &home, &never).unwrap().name, "your home folder");
        // The desktop under the pointer, and selected folders (lines ending "/"), at most three.
        let sel: Vec<PathBuf> = vec![home.join("Documents/Invoices/"), home.join("Documents/a.pdf"), home.join("Library/Mail/")];
        let got = folder_candidates(false, true, &sel, &home, &never);
        assert_eq!(got.iter().map(|c| (c.source, c.name.as_str())).collect::<Vec<_>>(), vec![(Source::FrontFolder, "Desktop"), (Source::FinderSelection, "Invoices")]);
        let _ = std::fs::remove_dir_all(&home);
    }

    /// A stored (uncompressed) and a deflated zip entry, written here, read back as CSV.
    fn zip_of(files: &[(&str, &str, bool)]) -> Vec<u8> {
        let mut out = Vec::new();
        let mut central = Vec::new();
        for (name, body, deflate) in files {
            let data: Vec<u8> = if *deflate {
                let mut e = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
                e.write_all(body.as_bytes()).unwrap();
                e.finish().unwrap()
            } else {
                body.as_bytes().to_vec()
            };
            let offset = out.len() as u32;
            let method: u16 = if *deflate { 8 } else { 0 };
            out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
            out.extend_from_slice(&[20, 0, 0, 0]);
            out.extend_from_slice(&method.to_le_bytes());
            out.extend_from_slice(&[0; 8]);
            out.extend_from_slice(&(data.len() as u32).to_le_bytes());
            out.extend_from_slice(&(body.len() as u32).to_le_bytes());
            out.extend_from_slice(&(name.len() as u16).to_le_bytes());
            out.extend_from_slice(&0u16.to_le_bytes());
            out.extend_from_slice(name.as_bytes());
            out.extend_from_slice(&data);
            central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
            central.extend_from_slice(&[20, 0, 20, 0, 0, 0]);
            central.extend_from_slice(&method.to_le_bytes());
            central.extend_from_slice(&[0; 8]);
            central.extend_from_slice(&(data.len() as u32).to_le_bytes());
            central.extend_from_slice(&(body.len() as u32).to_le_bytes());
            central.extend_from_slice(&(name.len() as u16).to_le_bytes());
            central.extend_from_slice(&[0; 12]);
            central.extend_from_slice(&offset.to_le_bytes());
            central.extend_from_slice(name.as_bytes());
        }
        let cd_offset = out.len() as u32;
        out.extend_from_slice(&central);
        out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        out.extend_from_slice(&[0; 4]);
        out.extend_from_slice(&(files.len() as u16).to_le_bytes());
        out.extend_from_slice(&(files.len() as u16).to_le_bytes());
        out.extend_from_slice(&(central.len() as u32).to_le_bytes());
        out.extend_from_slice(&cd_offset.to_le_bytes());
        out.extend_from_slice(&[0, 0]);
        out
    }

    #[test]
    fn xlsx() {
        let workbook = r#"<?xml version="1.0"?><workbook xmlns:r="x"><sheets><sheet name="Q3 &amp; Q4" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>"#;
        let rels = r#"<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>"#;
        let shared = r#"<sst><si><t>Name</t></si><si><r><t>Total</t></r><r><t xml:space="preserve">, £</t></r></si><si><t>Ada "the" Obi</t></si></sst>"#;
        let sheet1 = r#"<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>3.5</v></c><c r="C2" t="b"><v>1</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>line &lt;3&gt;</t></is></c></row></sheetData></worksheet>"#;
        let sheet2 = r#"<worksheet><sheetData><row r="1"><c r="B1" t="str"><v>x</v></c></row></sheetData></worksheet>"#;
        let z = zip_of(&[("xl/workbook.xml", workbook, false), ("xl/_rels/workbook.xml.rels", rels, true), ("xl/sharedStrings.xml", shared, true), ("xl/worksheets/sheet1.xml", sheet1, true), ("xl/worksheets/sheet2.xml", sheet2, false)]);
        let csv = xlsx_to_csv(&z).unwrap();
        assert_eq!(csv, "Sheet: Q3 & Q4\nName,,\"Total, £\"\n\"Ada \"\"the\"\" Obi\",3.5,TRUE\nline <3>\nSheet: Notes\n,x\n");
        assert_eq!(xlsx_to_csv(b"not a zip"), None);
        assert_eq!(column_of("AA10"), Some(26));
        assert_eq!(unescape("a&#x41;&#66;&bogus;&"), "aAB&bogus;&");
    }
}
