//! Folder-wide file work (owner request, 12 October 2026: "look through my documents and summarise them", "find the
//! invoice from last week and open it"; companion2-spec C, I.4.4, I.4.6), only under the owner's permission rule:
//! nothing here starts anything; it is used for a proposal the person's own words asked for, and for the job they said
//! yes to.
//!
//! What this file promises, and how:
//! - Only the folder the person named (`NamedFolder`: home, Desktop, Documents, Downloads, Pictures, Movies, Music) or
//!   pointed at (the Finder window in front, a folder selected in Finder) is ever listed, never more: depth 1, or up to
//!   3 when they asked for everything inside, at most 5,000 entries and 2 seconds.
//! - The walk skips hidden items, any `Library`, `node_modules`, bundles and packages (a folder with an extension),
//!   symlinks (never followed), folders named after a never-look app, files that hold secrets, installers, scripts and
//!   link files, apps, and files over 25 MB. It is pure over `Fs`, so the tests walk temp folders only (never the
//!   person's own).
//! - At most 25 files (the newest), 100 MB together. What is found stays on the Mac: Boredroom hears counts, kinds,
//!   sizes and a SHA-256 of each name before the yes; the names themselves only for the files sent after the yes, and
//!   text rather than files (a small PDF or a picture goes as phase 2's file job sends it).
//! - The job reads one file at a time, checks Stop before each, cuts text at 200,000 characters a file and 1,000,000 for
//!   the job, and writes nothing if stopped (`read_and_send`).

use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    io,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant},
};

use crate::filework::{Payload, Refusal};
use crate::guard;

pub const MAX_FILES: usize = 25;
pub const MAX_FILE_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 104_857_600;
pub const MAX_ENTRIES: usize = 5_000;
pub const WALK_TIME: Duration = Duration::from_secs(2);
pub const MAX_DEPTH: u32 = 3;
/// A folder job's text per file and in all (companion2-spec C.2).
pub const FILE_TEXT_CAP: usize = 200_000;
pub const JOB_TEXT_CAP: usize = 1_000_000;
/// Pointed-at folders in a look request.
pub const MAX_FOLDER_CANDIDATES: usize = 3;
/// A search's "and N more like it".
pub const MAX_OTHERS: usize = 99;

/// The folders a person can name (companion2-spec C.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum NamedFolder {
    Home,
    Desktop,
    Documents,
    Downloads,
    Pictures,
    Movies,
    Music,
}

impl NamedFolder {
    pub const ALL: [NamedFolder; 7] = [NamedFolder::Home, NamedFolder::Desktop, NamedFolder::Documents, NamedFolder::Downloads, NamedFolder::Pictures, NamedFolder::Movies, NamedFolder::Music];

    pub fn of(name: &str) -> Option<NamedFolder> {
        Self::ALL.into_iter().find(|f| f.key() == name)
    }

    pub fn key(self) -> &'static str {
        match self {
            NamedFolder::Home => "home",
            NamedFolder::Desktop => "desktop",
            NamedFolder::Documents => "documents",
            NamedFolder::Downloads => "downloads",
            NamedFolder::Pictures => "pictures",
            NamedFolder::Movies => "movies",
            NamedFolder::Music => "music",
        }
    }

    /// The words for it ("Documents", "your home folder").
    pub fn words(self) -> &'static str {
        match self {
            NamedFolder::Home => "your home folder",
            NamedFolder::Desktop => "Desktop",
            NamedFolder::Documents => "Documents",
            NamedFolder::Downloads => "Downloads",
            NamedFolder::Pictures => "Pictures",
            NamedFolder::Movies => "Movies",
            NamedFolder::Music => "Music",
        }
    }

    /// Its path under the (injected) home folder.
    pub fn dir(self, home: &Path) -> PathBuf {
        match self {
            NamedFolder::Home => home.to_path_buf(),
            other => home.join(other.words()),
        }
    }
}

/// The kinds a step can ask for (companion2-spec D.1.2 `kind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum FindKind {
    Pdf,
    Word,
    Text,
    Spreadsheet,
    Image,
    Any,
}

impl FindKind {
    pub fn key(self) -> &'static str {
        match self {
            FindKind::Pdf => "pdf",
            FindKind::Word => "word",
            FindKind::Text => "text",
            FindKind::Spreadsheet => "spreadsheet",
            FindKind::Image => "image",
            FindKind::Any => "any",
        }
    }
}

/// A file's kind by its extension: PDF; Word (doc, docx, rtf, odt, html); text (txt, md); a spreadsheet (xlsx, csv); a
/// picture. Anything else is none of them.
pub fn find_kind_of(path: &Path) -> Option<FindKind> {
    let e = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    Some(match e.as_str() {
        "pdf" => FindKind::Pdf,
        "doc" | "docx" | "rtf" | "odt" | "html" | "htm" => FindKind::Word,
        "txt" | "md" | "markdown" | "text" => FindKind::Text,
        "xlsx" | "csv" => FindKind::Spreadsheet,
        "png" | "jpg" | "jpeg" | "heic" | "webp" | "gif" => FindKind::Image,
        _ => return None,
    })
}

/// Which kinds a walk keeps: the step's kinds (`any` is text, PDF, Word and spreadsheets; pictures only when asked), or
/// any file at all (a search for one file to open).
#[derive(Clone, Debug, PartialEq)]
pub enum Kinds {
    Some(Vec<FindKind>),
    AnyFile,
}

impl Kinds {
    pub fn of(kinds: &[FindKind]) -> Kinds {
        if kinds.is_empty() {
            return Kinds::Some(vec![FindKind::Any]);
        }
        Kinds::Some(kinds.to_vec())
    }

    fn keeps(&self, k: Option<FindKind>) -> bool {
        match self {
            Kinds::AnyFile => true,
            Kinds::Some(list) => k.is_some_and(|k| list.contains(&k) || (list.contains(&FindKind::Any) && k != FindKind::Image)),
        }
    }
}

// ---- the file system, injectable ------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    pub path: PathBuf,
    pub kind: EntryKind,
    pub bytes: u64,
    /// Last modified, unix seconds.
    pub modified: i64,
    /// Any execute bit.
    pub exec: bool,
}

/// What a walk reads (companion2-spec I.4.6). `RealFs` reads the disk without following links; tests point it at temp
/// folders only.
pub trait Fs {
    fn read_dir(&self, p: &Path) -> io::Result<Vec<Entry>>;
    fn meta(&self, p: &Path) -> io::Result<Entry>;
}

pub struct RealFs;

fn entry_of(path: PathBuf, m: &std::fs::Metadata) -> Entry {
    let ft = m.file_type();
    let kind = if ft.is_symlink() {
        EntryKind::Symlink
    } else if ft.is_dir() {
        EntryKind::Dir
    } else if ft.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    };
    let modified = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64).unwrap_or(0);
    #[cfg(unix)]
    let exec = {
        use std::os::unix::fs::PermissionsExt;
        m.permissions().mode() & 0o111 != 0
    };
    #[cfg(not(unix))]
    let exec = false;
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    Entry { name, path, kind, bytes: m.len(), modified, exec }
}

impl Fs for RealFs {
    fn read_dir(&self, p: &Path) -> io::Result<Vec<Entry>> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(p)? {
            let Ok(e) = e else { continue };
            // `DirEntry::metadata` never follows a link.
            if let Ok(m) = e.metadata() {
                out.push(entry_of(e.path(), &m));
            }
        }
        Ok(out)
    }

    fn meta(&self, p: &Path) -> io::Result<Entry> {
        std::fs::symlink_metadata(p).map(|m| entry_of(p.to_path_buf(), &m))
    }
}

// ---- what is skipped ------------------------------------------------------------------------------------------------

/// The never-look apps' names, lower-case (the fixed list's names and the workspace's and person's rules): folders named
/// after them are never listed.
pub fn never_names(rules: &[crate::look::Rule]) -> Vec<String> {
    let mut out: Vec<String> = crate::look::FIXED_NEVER_LOOK.iter().flat_map(|f| std::iter::once(f.name).chain(f.names.iter().copied())).map(|n| n.to_lowercase()).collect();
    out.extend(rules.iter().map(|r| r.name.trim().to_lowercase()).filter(|n| !n.is_empty()));
    out.sort();
    out.dedup();
    out
}

fn hidden(name: &str) -> bool {
    name.starts_with('.')
}

/// A folder that is never listed or entered: hidden, `Library`, `node_modules`, a bundle or package (a folder with an
/// extension), or named after a never-look app.
pub fn skip_dir(name: &str, never: &[String]) -> bool {
    let l = name.to_lowercase();
    hidden(name) || l == "library" || l == "node_modules" || Path::new(name).extension().is_some_and(|e| !e.is_empty()) || never.iter().any(|n| named_after(&l, n))
}

/// A folder named after an app: its name, or its name and then more words ("1Password Exports"), never a word that
/// merely starts the same ("Wireframes" is not Wire's).
fn named_after(folder: &str, app: &str) -> bool {
    !app.is_empty() && folder.strip_prefix(app).is_some_and(|rest| rest.is_empty() || rest.starts_with(|c: char| !c.is_alphanumeric()))
}

/// Never-look apps whose names are everyday words ("Line items.xlsx", "Signal processing.pdf", "Wire transfer.pdf",
/// "Zoom notes.docx"): a file is not taken for their data by its name alone. Their folders are still skipped.
pub const EVERYDAY_APP_WORDS: &[&str] = &["line", "signal", "wire", "element", "zoom", "messages", "keeper", "passwords", "messenger"];

/// A file that is never listed: hidden, a secret (a password store or export among them), something that runs, an app,
/// or named after a never-look app ("WhatsApp Chat with Ada.txt", "Bitwarden export.json", a name on the person's or
/// workspace's own list; review, 12 October 2026: a folder job read password exports and sent them to the model).
pub fn skip_file(path: &Path, never: &[String]) -> bool {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let stem = path.file_stem().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    hidden(&name)
        || guard::secret_file(path)
        || guard::runs_something(path)
        || path.extension().is_some_and(|e| e.eq_ignore_ascii_case("app"))
        || never.iter().filter(|n| !EVERYDAY_APP_WORDS.contains(&n.as_str())).any(|n| named_after(&stem, n))
}

/// Whether a folder may be listed or opened: absolute, no `..`, inside the home folder (or a disk under `/Volumes`), and
/// no part of it below that hidden, `Library`, a package or a never-look app's folder.
pub fn folder_ok(path: &Path, home: &Path, never: &[String]) -> bool {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return false;
    }
    let rest = if let Ok(r) = path.strip_prefix(home) {
        r
    } else if let Ok(r) = path.strip_prefix("/Volumes") {
        if r.as_os_str().is_empty() {
            return false;
        }
        r
    } else {
        return false;
    };
    rest.components().all(|c| match c {
        Component::Normal(n) => !skip_dir(&n.to_string_lossy(), never),
        _ => false,
    })
}

// ---- the walk -------------------------------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct WalkOpts {
    pub kinds: Kinds,
    /// 1: the folder itself; up to 3 with "everything inside".
    pub depth: u32,
    /// Modified within this many days (0: any).
    pub since_days: u32,
    /// Every word must be in the name (lower-cased).
    pub words: Vec<String>,
    pub never: Vec<String>,
    pub now_unix: i64,
    pub deadline: Instant,
}

/// A file the walk found (its path stays on the Mac).
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub path: PathBuf,
    pub name: String,
    pub kind: Option<FindKind>,
    pub bytes: u64,
    pub modified: i64,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct WalkResult {
    /// The newest first, at most 25 and 100 MB together.
    pub kept: Vec<Found>,
    /// Every match (before the caps).
    pub total: usize,
    pub bytes: u64,
    pub counts: BTreeMap<FindKind, usize>,
    pub too_big: usize,
    /// macOS refused the folder itself.
    pub denied: bool,
    pub missing: bool,
    pub timed_out: bool,
    pub examined: usize,
}

impl WalkResult {
    /// The SHA-256 of each kept name, in order (what Boredroom checks each file against after the yes).
    pub fn name_hashes(&self) -> Vec<String> {
        self.kept.iter().map(|f| crate::act::sha256_hex(&f.name)).collect()
    }
}

/// Lists one folder (companion2-spec C.1): what is skipped, the caps, newest first.
pub fn walk(fs: &dyn Fs, root: &Path, o: &WalkOpts) -> WalkResult {
    let mut r = WalkResult::default();
    let mut matches: Vec<Found> = Vec::new();
    let words: Vec<String> = o.words.iter().map(|w| w.to_lowercase()).filter(|w| !w.is_empty()).collect();
    let since = if o.since_days == 0 { None } else { Some(o.now_unix - o.since_days as i64 * 86_400) };
    let mut queue: Vec<(PathBuf, u32)> = vec![(root.to_path_buf(), 1)];
    let mut first = true;
    'outer: while let Some((dir, depth)) = queue.pop() {
        let entries = match fs.read_dir(&dir) {
            Ok(e) => e,
            Err(e) => {
                if first {
                    match e.kind() {
                        io::ErrorKind::PermissionDenied => r.denied = true,
                        io::ErrorKind::NotFound => r.missing = true,
                        _ => r.denied = e.raw_os_error() == Some(1),
                    }
                }
                first = false;
                continue;
            }
        };
        first = false;
        for e in entries {
            if r.examined >= MAX_ENTRIES || Instant::now() >= o.deadline {
                r.timed_out = true;
                break 'outer;
            }
            r.examined += 1;
            match e.kind {
                EntryKind::Dir => {
                    if depth < o.depth.min(MAX_DEPTH) && !skip_dir(&e.name, &o.never) {
                        queue.push((e.path.clone(), depth + 1));
                    }
                }
                EntryKind::File => {
                    if skip_file(&e.path, &o.never) {
                        continue;
                    }
                    let kind = find_kind_of(&e.path);
                    if !o.kinds.keeps(kind) {
                        continue;
                    }
                    if since.is_some_and(|s| e.modified < s) {
                        continue;
                    }
                    let lname = e.name.to_lowercase();
                    if !words.iter().all(|w| lname.contains(w.as_str())) {
                        continue;
                    }
                    if e.bytes > MAX_FILE_BYTES {
                        r.too_big += 1;
                        continue;
                    }
                    matches.push(Found { path: e.path, name: e.name, kind, bytes: e.bytes, modified: e.modified });
                }
                // Links are never followed; anything else is not a file.
                EntryKind::Symlink | EntryKind::Other => {}
            }
        }
    }
    matches.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.name.cmp(&b.name)));
    r.total = matches.len();
    for f in matches {
        if r.kept.len() >= MAX_FILES || r.bytes + f.bytes > MAX_TOTAL_BYTES {
            break;
        }
        r.bytes += f.bytes;
        if let Some(k) = f.kind {
            *r.counts.entry(k).or_insert(0) += 1;
        }
        r.kept.push(f);
    }
    r
}

/// When each file was last opened (Spotlight's `kMDItemLastUsedDate`, unix seconds), when the Mac can say.
pub trait LastUsed {
    fn last_used(&self, paths: &[PathBuf]) -> Option<Vec<Option<i64>>>;
}

#[cfg(test)]
pub struct NoLastUsed;

#[cfg(test)]
impl LastUsed for NoLastUsed {
    fn last_used(&self, _paths: &[PathBuf]) -> Option<Vec<Option<i64>>> {
        None
    }
}

/// One file found by words (companion2-spec I.4.4): the chosen one and how many others matched.
#[derive(Clone, Debug, PartialEq)]
pub struct Pick {
    pub file: Found,
    pub last_used: Option<i64>,
    pub others: usize,
    pub root: PathBuf,
}

/// Searches the roots in order (each walked to depth 3, every word in the name) and picks the newest: by last use when
/// `by_use` and Spotlight answers, else by when it was changed. Denied roots are reported.
pub fn search(fs: &dyn Fs, roots: &[PathBuf], o: &WalkOpts, by_use: bool, spot: &dyn LastUsed) -> (Option<Pick>, bool) {
    let mut all: Vec<(Found, PathBuf)> = Vec::new();
    let mut extra = 0usize;
    let mut denied = false;
    let mut opts = o.clone();
    opts.depth = MAX_DEPTH;
    for root in roots {
        let w = walk(fs, root, &opts);
        denied |= w.denied;
        // Every match counts towards "and N more like it", not only the 25 a folder job would keep.
        extra += w.total - w.kept.len();
        all.extend(w.kept.into_iter().map(|f| (f, root.clone())));
        if Instant::now() >= o.deadline {
            break;
        }
    }
    let real: Vec<&(Found, PathBuf)> = all.iter().collect();
    if real.is_empty() {
        return (None, denied);
    }
    let used: Option<Vec<Option<i64>>> = if by_use { spot.last_used(&real.iter().map(|(f, _)| f.path.clone()).collect::<Vec<_>>()).filter(|v| v.len() == real.len()) } else { None };
    let mut idx: Vec<usize> = (0..real.len()).collect();
    match &used {
        Some(u) if u.iter().any(|x| x.is_some()) => idx.sort_by(|a, b| u[*b].unwrap_or(i64::MIN).cmp(&u[*a].unwrap_or(i64::MIN)).then(real[*b].0.modified.cmp(&real[*a].0.modified))),
        _ => idx.sort_by(|a, b| real[*b].0.modified.cmp(&real[*a].0.modified)),
    }
    let best = idx[0];
    let others = (all.len() - 1 + extra).min(MAX_OTHERS);
    (Some(Pick { file: real[best].0.clone(), last_used: used.and_then(|u| u[best]), others, root: real[best].1.clone() }), denied)
}

/// "Documents", "Desktop", or the folder's own name: where a found file is, in words.
pub fn where_words(path: &Path, home: &Path) -> String {
    let parent = path.parent().unwrap_or(path);
    if parent == home {
        return NamedFolder::Home.words().to_string();
    }
    for f in NamedFolder::ALL {
        if f != NamedFolder::Home && parent == f.dir(home) {
            return f.words().to_string();
        }
    }
    let name = parent.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    clip_name(&name, 80)
}

/// A folder's words: a named folder's, else its own name.
pub fn folder_words(path: &Path, home: &Path) -> String {
    for f in NamedFolder::ALL {
        if path == f.dir(home) {
            return if f == NamedFolder::Home { "your home folder".into() } else { f.words().into() };
        }
    }
    clip_name(&path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), 80)
}

/// At most `n` characters, one line, no `/`.
pub fn clip_name(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control() && *c != '/').take(n).collect()
}

/// `YYYY-MM-DD` in the Mac's own time zone.
pub fn ymd(unix: i64) -> String {
    #[cfg(unix)]
    {
        #[repr(C)]
        struct Tm {
            sec: i32,
            min: i32,
            hour: i32,
            mday: i32,
            mon: i32,
            year: i32,
            wday: i32,
            yday: i32,
            isdst: i32,
            gmtoff: std::ffi::c_long,
            zone: *const std::ffi::c_char,
        }
        extern "C" {
            fn localtime_r(t: *const i64, out: *mut Tm) -> *mut Tm;
        }
        let mut tm = Tm { sec: 0, min: 0, hour: 0, mday: 0, mon: 0, year: 0, wday: 0, yday: 0, isdst: 0, gmtoff: 0, zone: std::ptr::null() };
        let t = unix;
        if !unsafe { localtime_r(&t, &mut tm) }.is_null() {
            return format!("{:04}-{:02}-{:02}", tm.year + 1900, tm.mon + 1, tm.mday);
        }
    }
    // UTC (days from the civil calendar).
    let days = unix.div_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

// ---- the job --------------------------------------------------------------------------------------------------------

/// One file's part of the result, kept in memory and wiped when dropped.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Section {
    pub title: String,
    pub markdown: String,
}

impl Drop for Section {
    fn drop(&mut self) {
        unsafe {
            self.title.as_bytes_mut().fill(0);
            self.markdown.as_bytes_mut().fill(0);
        }
    }
}

/// A file the job did not read, and why (H.2.4).
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Skipped {
    pub name: String,
    pub why: &'static str,
}

/// Why the job ended early.
#[derive(Debug, PartialEq)]
pub enum JobEnd {
    Stopped,
    Failed(crate::ApiError),
}

/// What the job needs from the Mac and Boredroom (the real one in `plan.rs`; the tests' own).
pub trait JobHost {
    fn stopped(&self) -> bool;
    /// The file's payload with its text cut at `cap` characters (and whether it was cut).
    fn read(&mut self, f: &Found, cap: usize) -> Result<(Payload, bool), Refusal>;
    /// `POST /act/{id}/folder` for file `n`; the section Boredroom wrote.
    fn send(&mut self, n: usize, f: &Found, payload: &Payload, truncated: bool) -> Result<Section, crate::ApiError>;
    fn progress(&mut self, done: usize, of: usize);
}

fn skip_why(r: Refusal) -> &'static str {
    match r {
        Refusal::FileTooBig => "too_big",
        Refusal::FileLong => "too_long",
        _ => "unreadable",
    }
}

/// Reads and sends each kept file in order (companion2-spec C.2): Stop is checked before each file and after each
/// answer; a file past the job's text budget is skipped. Stopped: nothing comes back (the sections are dropped and
/// wiped), so nothing is written.
pub fn read_and_send(host: &mut dyn JobHost, files: &[Found]) -> Result<(Vec<Section>, Vec<Skipped>), JobEnd> {
    let mut sections = Vec::new();
    let mut skipped = Vec::new();
    let mut used = 0usize;
    let of = files.len();
    for (n, f) in files.iter().enumerate() {
        if host.stopped() {
            return Err(JobEnd::Stopped);
        }
        host.progress(n, of);
        let (payload, truncated) = match host.read(f, FILE_TEXT_CAP) {
            Ok(p) => p,
            Err(r) => {
                skipped.push(Skipped { name: f.name.clone(), why: skip_why(r) });
                continue;
            }
        };
        let chars = match &payload {
            Payload::Text { text, .. } => text.chars().count(),
            _ => 0,
        };
        if used + chars > JOB_TEXT_CAP {
            skipped.push(Skipped { name: f.name.clone(), why: "budget" });
            continue;
        }
        used += chars;
        if host.stopped() {
            return Err(JobEnd::Stopped);
        }
        let s = host.send(n, f, &payload, truncated);
        drop(payload);
        if host.stopped() {
            return Err(JobEnd::Stopped);
        }
        match s {
            Ok(s) => sections.push(s),
            Err(e) if e.code.as_deref() == Some("STOPPED") => return Err(JobEnd::Stopped),
            Err(e) => return Err(JobEnd::Failed(e)),
        }
    }
    host.progress(of, of);
    Ok((sections, skipped))
}

/// The `/folder` request's `file` (H.2.3): phase 2's file shape without its source, plus `truncated`.
pub struct FolderFileJson<'a> {
    pub name: &'a str,
    pub bytes: u64,
    pub payload: &'a Payload,
    pub truncated: bool,
}

impl Serialize for FolderFileJson<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use base64::Engine;
        use serde::ser::SerializeMap;
        let mut m = s.serialize_map(None)?;
        m.serialize_entry("name", self.name)?;
        m.serialize_entry("bytes", &self.bytes)?;
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
        if self.truncated {
            m.serialize_entry("truncated", &true)?;
        }
        m.end()
    }
}

/// Reads one found file for the job (the walk's checks again: still a plain file, not a link, at most 25 MB).
pub fn read_found(f: &Found, cap: usize) -> Result<(Payload, bool), Refusal> {
    let m = std::fs::symlink_metadata(&f.path).map_err(|_| Refusal::FileUnresolved)?;
    if !m.file_type().is_file() {
        return Err(Refusal::FileUnresolved);
    }
    if m.len() > MAX_FILE_BYTES {
        return Err(Refusal::FileTooBig);
    }
    let mut head = [0u8; 16];
    let n = std::fs::File::open(&f.path).ok().and_then(|mut h| io::Read::read(&mut h, &mut head).ok()).unwrap_or(0);
    let c = crate::filework::Candidate {
        source: crate::filework::Source::FinderSelection,
        name: f.name.clone(),
        kind: crate::filework::kind_of(&f.path, &head[..n]),
        bytes: m.len(),
        path: f.path.clone(),
        app: None,
    };
    crate::filework::read_capped(&c, cap).map_err(|(r, _)| r)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("brenda-folder-{tag}-{}-{:x}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&d).unwrap();
        d.canonicalize().unwrap()
    }

    pub(crate) fn file(dir: &Path, name: &str, bytes: usize, age_days: i64) -> PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, vec![b'a'; bytes]).unwrap();
        set_age(&p, age_days);
        p
    }

    pub(crate) fn set_age(p: &Path, age_days: i64) {
        let t = std::time::SystemTime::now() - Duration::from_secs((age_days * 86_400 + 60) as u64);
        let f = std::fs::File::options().write(true).open(p).unwrap();
        f.set_modified(t).unwrap();
    }

    pub(crate) fn opts(kinds: &[FindKind]) -> WalkOpts {
        WalkOpts { kinds: Kinds::of(kinds), depth: 1, since_days: 0, words: vec![], never: never_names(&[]), now_unix: now(), deadline: Instant::now() + WALK_TIME }
    }

    fn now() -> i64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
    }

    #[test]
    fn walk_skips() {
        let d = scratch("skips");
        file(&d, "Report.pdf", 10, 1);
        file(&d, ".hidden.pdf", 10, 1);
        file(&d, "Vault.kdbx", 10, 1);
        file(&d, ".env", 10, 1);
        file(&d, "setup.pkg", 10, 1);
        file(&d, "run.sh", 10, 1);
        file(&d, "Site.webloc", 10, 1);
        file(&d, "notes.txt", 10, 2);
        file(&d, "photo.jpg", 10, 1);
        file(&d, "song.mp3", 10, 1);
        let big = d.join("Big.pdf");
        std::fs::File::create(&big).unwrap().set_len(MAX_FILE_BYTES + 1).unwrap();
        for sub in ["Library", ".git", "node_modules", "Thing.app", "Photos Library.photoslibrary", "1Password Exports", "Keychain Access", "Inner"] {
            std::fs::create_dir_all(d.join(sub)).unwrap();
            file(&d.join(sub), "inside.pdf", 10, 0);
        }
        #[cfg(unix)]
        {
            let outside = scratch("outside");
            file(&outside, "secret plan.pdf", 10, 0);
            std::os::unix::fs::symlink(&outside, d.join("Linked")).unwrap();
            std::os::unix::fs::symlink(outside.join("secret plan.pdf"), d.join("linked plan.pdf")).unwrap();
        }
        let mut o = opts(&[FindKind::Any]);
        o.depth = 3;
        let w = walk(&RealFs, &d, &o);
        let names: Vec<&str> = w.kept.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"Report.pdf") && names.contains(&"notes.txt"));
        assert_eq!(names.iter().filter(|n| **n == "inside.pdf").count(), 1, "only Inner's: {names:?}");
        for never in [".hidden.pdf", "Vault.kdbx", ".env", "setup.pkg", "run.sh", "Site.webloc", "photo.jpg", "song.mp3", "Big.pdf", "secret plan.pdf", "linked plan.pdf"] {
            assert!(!names.contains(&never), "{never} must be skipped");
        }
        assert_eq!(w.too_big, 1);
        // Password exports and never-look apps' data, by the file's own name (review, 12 October 2026).
        let x = scratch("exports");
        for n in ["Passwords.csv", "Chrome Passwords.csv", "bitwarden_export_20261012.csv", "lastpass_export.csv", "1Password Export.csv", "WhatsApp Chat with Ada.txt", "Slack export.json", "Keychain Access notes.txt", "Q3 report.pdf", "Line items.xlsx", "Signal processing.pdf", "Wire transfer.txt"] {
            file(&x, n, 10, 1);
        }
        let mut o = opts(&[FindKind::Any]);
        o.never = never_names(&[]);
        let got: Vec<String> = walk(&RealFs, &x, &o).kept.into_iter().map(|f| f.name).collect();
        let mut got_sorted = got.clone();
        got_sorted.sort();
        assert_eq!(got_sorted, vec!["Line items.xlsx", "Q3 report.pdf", "Signal processing.pdf", "Wire transfer.txt"], "{got:?}");
        let _ = std::fs::remove_dir_all(&x);
        // Pictures only when asked.
        let w = walk(&RealFs, &d, &opts(&[FindKind::Image]));
        assert_eq!(w.kept.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["photo.jpg"]);
        // A person's own never-look rule.
        let mut o = opts(&[FindKind::Any]);
        o.depth = 3;
        o.never = never_names(&[crate::look::Rule { name: "Inner".into(), bundle_id: None, source: crate::look::RuleSource::You }]);
        assert!(!walk(&RealFs, &d, &o).kept.iter().any(|f| f.name == "inside.pdf"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn walk_caps() {
        let d = scratch("caps");
        for n in 0..30 {
            file(&d, &format!("Note {n:02}.txt"), 100, n);
        }
        file(&d, "Invoice 1042.pdf", 2_000, 3);
        file(&d, "Invoice 1041.pdf", 2_000, 40);
        file(&d, "Budget.xlsx", 50, 0);
        std::fs::create_dir_all(d.join("Inner/Deeper/Too deep")).unwrap();
        file(&d.join("Inner"), "inner.md", 10, 0);
        file(&d.join("Inner/Deeper"), "level3.md", 10, 0);
        file(&d.join("Inner/Deeper/Too deep"), "level4.md", 10, 0);
        let w = walk(&RealFs, &d, &opts(&[FindKind::Any]));
        assert_eq!(w.total, 33);
        assert_eq!(w.kept.len(), 25, "the 25 newest");
        assert_eq!(w.kept[0].name, "Budget.xlsx", "newest first");
        assert!(!w.kept.iter().any(|f| f.name == "Note 29.txt"), "the oldest are left out");
        assert_eq!(w.counts.values().sum::<usize>(), 25);
        assert_eq!(w.counts.get(&FindKind::Spreadsheet), Some(&1));
        assert_eq!(w.counts.get(&FindKind::Pdf), Some(&1));
        assert_eq!(w.bytes, w.kept.iter().map(|f| f.bytes).sum::<u64>());
        assert_eq!(w.name_hashes().len(), 25);
        assert_eq!(crate::act::sha256_hex("Invoice 1042.pdf"), "af8e832f1c3fcf8e2b33909bb32b7756a7524e2ce45b417221d1ab0e54782e14", "D.4's name vector");
        assert!(!w.kept.iter().any(|f| f.name == "inner.md"), "depth 1");
        // Everything inside: three levels.
        let mut o = opts(&[FindKind::Text]);
        o.depth = 3;
        let names: Vec<String> = walk(&RealFs, &d, &o).kept.iter().map(|f| f.name.clone()).collect();
        assert!(names.contains(&"inner.md".to_string()) && names.contains(&"level3.md".to_string()) && !names.contains(&"level4.md".to_string()));
        // Words and days.
        let mut o = opts(&[FindKind::Pdf]);
        o.words = vec!["INVOICE".into()];
        o.since_days = 7;
        let w = walk(&RealFs, &d, &o);
        assert_eq!(w.kept.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["Invoice 1042.pdf"]);
        // 100 MB together.
        struct Fat;
        impl Fs for Fat {
            fn read_dir(&self, p: &Path) -> io::Result<Vec<Entry>> {
                Ok((0..10).map(|n| Entry { name: format!("f{n}.pdf"), path: p.join(format!("f{n}.pdf")), kind: EntryKind::File, bytes: 20 * 1024 * 1024, modified: 100 - n, exec: false }).collect())
            }
            fn meta(&self, _p: &Path) -> io::Result<Entry> {
                Err(io::ErrorKind::NotFound.into())
            }
        }
        let w = walk(&Fat, Path::new("/x"), &opts(&[FindKind::Any]));
        assert_eq!((w.kept.len(), w.total, w.bytes), (5, 10, 100 * 1024 * 1024));
        // 5,000 entries at most.
        struct Many;
        impl Fs for Many {
            fn read_dir(&self, p: &Path) -> io::Result<Vec<Entry>> {
                Ok((0..6_000).map(|n| Entry { name: format!("f{n}.txt"), path: p.join(format!("f{n}.txt")), kind: EntryKind::File, bytes: 1, modified: n, exec: false }).collect())
            }
            fn meta(&self, _p: &Path) -> io::Result<Entry> {
                Err(io::ErrorKind::NotFound.into())
            }
        }
        let w = walk(&Many, Path::new("/x"), &opts(&[FindKind::Any]));
        assert!(w.timed_out && w.examined == MAX_ENTRIES && w.total == MAX_ENTRIES);
        // A folder macOS refuses.
        struct Denied;
        impl Fs for Denied {
            fn read_dir(&self, _p: &Path) -> io::Result<Vec<Entry>> {
                Err(io::ErrorKind::PermissionDenied.into())
            }
            fn meta(&self, _p: &Path) -> io::Result<Entry> {
                Err(io::ErrorKind::PermissionDenied.into())
            }
        }
        assert!(walk(&Denied, Path::new("/x"), &opts(&[FindKind::Any])).denied);
        assert!(walk(&RealFs, &d.join("missing"), &opts(&[FindKind::Any])).missing);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn named_paths() {
        let home = scratch("home");
        assert_eq!(NamedFolder::Documents.dir(&home), home.join("Documents"));
        assert_eq!(NamedFolder::Home.dir(&home), home);
        assert_eq!(NamedFolder::of("downloads"), Some(NamedFolder::Downloads));
        assert_eq!(NamedFolder::of("Library"), None);
        assert_eq!(NamedFolder::ALL.iter().map(|f| f.key()).collect::<Vec<_>>().join(" "), "home desktop documents downloads pictures movies music");
        let never = never_names(&[]);
        assert!(folder_ok(&home.join("Documents/Invoices"), &home, &never));
        assert!(folder_ok(&home, &home, &never));
        assert!(!folder_ok(&home.join("Library/Mail"), &home, &never));
        assert!(!folder_ok(&home.join(".ssh"), &home, &never));
        assert!(!folder_ok(&home.join("Documents/../.ssh"), &home, &never));
        assert!(!folder_ok(Path::new("/etc"), &home, &never));
        assert!(!folder_ok(Path::new("/Volumes"), &home, &never));
        assert!(folder_ok(Path::new("/Volumes/Backup/Work"), &home, &never));
        assert!(!folder_ok(&home.join("Pictures/Photos Library.photoslibrary"), &home, &never));
        assert!(!folder_ok(&home.join("Documents/1Password Exports"), &home, &never));
        assert!(folder_ok(&home.join("Documents/Wireframes"), &home, &never), "a word that merely starts like an app's name");
        assert_eq!(where_words(&home.join("Documents/a.pdf"), &home), "Documents");
        assert_eq!(where_words(&home.join("a.pdf"), &home), "your home folder");
        assert_eq!(where_words(&home.join("Documents/Invoices/a.pdf"), &home), "Invoices");
        assert_eq!(folder_words(&home.join("Downloads"), &home), "Downloads");
        assert_eq!(folder_words(&home.join("Work/Q3"), &home), "Q3");
        assert_eq!(ymd(0).len(), 10);
        assert!(ymd(1_791_000_000).starts_with("2026-"));
        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn search_picks_newest_and_counts_others() {
        let home = scratch("search");
        for f in ["Desktop", "Documents", "Downloads/Old"] {
            std::fs::create_dir_all(home.join(f)).unwrap();
        }
        file(&home.join("Downloads"), "Invoice 1042.pdf", 10, 4);
        file(&home.join("Documents"), "Invoice 1040.pdf", 10, 20);
        file(&home.join("Downloads/Old"), "invoice 1001.pdf", 10, 200);
        file(&home.join("Desktop"), "Notes.txt", 10, 0);
        let roots: Vec<PathBuf> = [NamedFolder::Desktop, NamedFolder::Documents, NamedFolder::Downloads].iter().map(|f| f.dir(&home)).collect();
        let mut o = opts(&[]);
        o.kinds = Kinds::AnyFile;
        o.words = vec!["invoice".into()];
        let (p, denied) = search(&RealFs, &roots, &o, false, &NoLastUsed);
        let p = p.unwrap();
        assert!(!denied);
        assert_eq!(p.file.name, "Invoice 1042.pdf");
        assert_eq!(p.others, 2);
        assert_eq!(where_words(&p.file.path, &home), "Downloads");
        // By last use when Spotlight answers.
        struct Used;
        impl LastUsed for Used {
            fn last_used(&self, paths: &[PathBuf]) -> Option<Vec<Option<i64>>> {
                Some(paths.iter().map(|p| p.to_string_lossy().contains("1040").then_some(2_000_000_000)).collect())
            }
        }
        let (p, _) = search(&RealFs, &roots, &o, true, &Used);
        assert_eq!(p.unwrap().file.name, "Invoice 1040.pdf");
        o.words = vec!["nothing like this".into()];
        assert_eq!(search(&RealFs, &roots, &o, false, &NoLastUsed).0, None);
        let _ = std::fs::remove_dir_all(&home);
    }

    struct Job {
        stop_after: Option<usize>,
        sent: Vec<(usize, String, bool)>,
        stopped: std::cell::Cell<bool>,
        long: bool,
    }

    impl JobHost for Job {
        fn stopped(&self) -> bool {
            self.stopped.get()
        }
        fn read(&mut self, f: &Found, cap: usize) -> Result<(Payload, bool), Refusal> {
            if f.name.starts_with("bad") {
                return Err(Refusal::FileFailed);
            }
            let n = if self.long { 400_000 } else { 10 };
            let text: String = "x".repeat(n.min(cap));
            Ok((Payload::Text { text, pages: Some(1) }, n > cap))
        }
        fn send(&mut self, n: usize, f: &Found, _p: &Payload, truncated: bool) -> Result<Section, crate::ApiError> {
            self.sent.push((n, f.name.clone(), truncated));
            if self.stop_after == Some(self.sent.len()) {
                self.stopped.set(true);
            }
            Ok(Section { title: f.name.clone(), markdown: "summary".into() })
        }
        fn progress(&mut self, _done: usize, _of: usize) {}
    }

    fn found(name: &str) -> Found {
        Found { path: PathBuf::from(format!("/x/{name}")), name: name.into(), kind: Some(FindKind::Text), bytes: 10, modified: 0 }
    }

    #[test]
    fn job_reads_in_order_skips_and_stops() {
        let files: Vec<Found> = ["a.txt", "bad.txt", "c.txt"].iter().map(|n| found(n)).collect();
        let mut j = Job { stop_after: None, sent: vec![], stopped: std::cell::Cell::new(false), long: false };
        let (sections, skipped) = read_and_send(&mut j, &files).unwrap();
        assert_eq!(sections.len(), 2);
        assert_eq!(skipped, vec![Skipped { name: "bad.txt".into(), why: "unreadable" }]);
        assert_eq!(j.sent.iter().map(|s| s.0).collect::<Vec<_>>(), vec![0, 2], "n is the file's place in what was found");
        // Long files are cut at 200,000 characters, and the job stops reading at 1,000,000.
        let files: Vec<Found> = (0..7).map(|n| found(&format!("f{n}.txt"))).collect();
        let mut j = Job { stop_after: None, sent: vec![], stopped: std::cell::Cell::new(false), long: true };
        let (sections, skipped) = read_and_send(&mut j, &files).unwrap();
        assert_eq!(sections.len(), 5);
        assert!(j.sent.iter().all(|s| s.2), "marked truncated");
        assert_eq!(skipped.iter().map(|s| s.why).collect::<Vec<_>>(), vec!["budget", "budget"]);
        // Stop after the second file: nothing comes back to write.
        let mut j = Job { stop_after: Some(2), sent: vec![], stopped: std::cell::Cell::new(false), long: false };
        let files: Vec<Found> = ["a.txt", "b.txt", "c.txt"].iter().map(|n| found(n)).collect();
        assert_eq!(read_and_send(&mut j, &files), Err(JobEnd::Stopped));
        assert_eq!(j.sent.len(), 2, "the third is never read or sent");
    }

    #[test]
    fn folder_file_json() {
        let p = Payload::Text { text: "Plan".into(), pages: Some(1) };
        let v = serde_json::to_value(FolderFileJson { name: "Plan.docx", bytes: 2_104, payload: &p, truncated: true }).unwrap();
        assert_eq!(v, serde_json::json!({ "name": "Plan.docx", "bytes": 2104, "kind": "text", "mediaType": "text/plain", "text": "Plan", "pages": 1, "truncated": true }));
        let v = serde_json::to_value(FolderFileJson { name: "Plan.docx", bytes: 1, payload: &p, truncated: false }).unwrap();
        assert!(v.get("truncated").is_none() && v.get("source").is_none(), "no source, no path");
    }
}
