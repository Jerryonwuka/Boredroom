//! The Files helper's hands (owner brief, 12 October 2026: "Helpers run their planning on Boredroom's server and touch
//! files only through a fixed set of safe Mac actions executed by Rust (list, read text, move, copy, rename, new folder,
//! write a NEW file, move to Trash only after a yes). No free-form shell."; decision 4: "Files helper works in Desktop,
//! Documents and Downloads plus folders the person adds; never Library, system or hidden folders; nothing deleted";
//! helpers-spec G.5, G.11, H).
//!
//! What this file promises, and how:
//! - Only the fixed calls in `run_call` exist. Nothing here runs a shell: the converters are fixed tools with fixed
//!   argument vectors (`Tools`), and nothing that runs is ever opened.
//! - Every path comes from a ref the Mac handed out (`Refs`): `c…` the files the person pointed at, `f…` the allowed
//!   folders, `e…` entries she listed, `n…` items she made. A ref is checked again on every use: the parent is
//!   canonicalised (the item itself is never followed through a link) and must be inside an allowed root.
//! - Nothing is ever replaced: moves and renames use `renamex_np(RENAME_EXCL)`, new files `create_new`, and a name
//!   already taken gets " 2", " 3"… Nothing is deleted: the Trash only, only after the person's yes for exactly those
//!   refs (`Approval`, the SHA-256 of the refs and their count), and a cross-disk move is refused.
//! - Hidden and system items (a dot name, `Library`, apps, bundles, libraries, the inside of a package), files changed in
//!   the last five minutes and links are left alone and counted.
//! - Every change goes into the job's Undo manifest before the next one starts (one JSON object a line, `fsync` every
//!   20), in `<app data>/undo/<job id>.json`, mode 0600, kept 7 days. `undo` puts things back only when they are where
//!   she left them and unchanged (same inode, size and modification time).
//! - Tests use a temp folder with an injected fake Trash (`RealFileSys::with_trash`), `FakeTools` and `FakeMdls`: no test
//!   touches the real Desktop, Documents, Downloads or Trash.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    io::{self, Write},
    path::{Component, Path, PathBuf},
};

// ---- limits (G.8, mirrored from `JOB_LIMITS` in `src/lib/front.ts`) --------------------------------------------------

pub const CALLS_PER_TURN: usize = 8;
pub const REFS_PER_CALL: usize = 500;
pub const LIST_ITEMS: usize = 500;
pub const READ_CHARS: usize = 20_000;
pub const JOB_READ_CHARS: usize = 300_000;
pub const WRITE_CHARS: usize = 200_000;
pub const NEW_FILES: usize = 10;
pub const CHANGES: usize = 2_000;
pub const RESULT_CHARS: usize = 120_000;
/// A file changed this recently is left alone (0b.16).
pub const RECENT_SECS: i64 = 300;
/// Inputs to a converter at most (H.5).
pub const CONVERT_MAX_BYTES: u64 = 100 * 1024 * 1024;
/// " 2" up to this.
pub const COLLISION_MAX: u32 = 99;
/// Manifests are kept this long (G.11).
pub const MANIFEST_DAYS: i64 = 7;
/// `fsync` the manifest after this many changes.
const SYNC_EVERY: usize = 20;
/// `mdls` takes at most this many files a call (H.4).
pub const MDLS_BATCH: usize = 100;

pub const NOT_KNOWN: &str = "Not done: I don't know that one. List its folder first.";
pub const TOO_MUCH: &str = "Not done: that's more than one job may change. Finish here and say what's left.";
pub const TOO_MANY_CALLS: &str = "Not executed: too many in one turn; send at most 8.";

// ---- kinds of file (D.5, shared with `FILE_KIND_EXT` and `ORGANISE_FOLDERS` in `src/lib/front.ts`) ------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Screenshot,
    Image,
    Pdf,
    Document,
    Spreadsheet,
    Presentation,
    Video,
    Audio,
    Archive,
    Installer,
    Code,
    Design,
    Other,
}

const KIND_EXT: &[(FileKind, &[&str])] = &[
    (FileKind::Image, &["jpg", "jpeg", "png", "heic", "heif", "gif", "webp", "tiff", "tif", "bmp", "svg", "raw", "cr2", "cr3", "nef", "arw", "dng"]),
    (FileKind::Pdf, &["pdf"]),
    (FileKind::Document, &["doc", "docx", "pages", "rtf", "rtfd", "txt", "md", "odt"]),
    (FileKind::Spreadsheet, &["xls", "xlsx", "numbers", "csv", "tsv", "ods"]),
    (FileKind::Presentation, &["ppt", "pptx", "key", "odp"]),
    (FileKind::Video, &["mov", "mp4", "m4v", "avi", "mkv", "webm"]),
    (FileKind::Audio, &["mp3", "m4a", "wav", "aiff", "aif", "aac", "flac", "ogg"]),
    (FileKind::Archive, &["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]),
    (FileKind::Installer, &["dmg", "pkg", "mpkg", "iso"]),
    (FileKind::Code, &["js", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java", "c", "h", "cpp", "swift", "json", "yaml", "yml", "html", "css", "sh", "sql"]),
    (FileKind::Design, &["fig", "sketch", "psd", "ai", "xd", "afdesign", "afphoto", "indd"]),
];

impl FileKind {
    pub const ALL: [FileKind; 13] = [
        FileKind::Screenshot,
        FileKind::Image,
        FileKind::Pdf,
        FileKind::Document,
        FileKind::Spreadsheet,
        FileKind::Presentation,
        FileKind::Video,
        FileKind::Audio,
        FileKind::Archive,
        FileKind::Installer,
        FileKind::Code,
        FileKind::Design,
        FileKind::Other,
    ];

    pub fn key(self) -> &'static str {
        match self {
            FileKind::Screenshot => "screenshot",
            FileKind::Image => "image",
            FileKind::Pdf => "pdf",
            FileKind::Document => "document",
            FileKind::Spreadsheet => "spreadsheet",
            FileKind::Presentation => "presentation",
            FileKind::Video => "video",
            FileKind::Audio => "audio",
            FileKind::Archive => "archive",
            FileKind::Installer => "installer",
            FileKind::Code => "code",
            FileKind::Design => "design",
            FileKind::Other => "other",
        }
    }

    /// The folder organising by kind puts it in (H.3).
    pub fn folder(self) -> &'static str {
        match self {
            FileKind::Screenshot => "Screenshots",
            FileKind::Image => "Images",
            FileKind::Pdf => "PDFs",
            FileKind::Document => "Documents",
            FileKind::Spreadsheet => "Spreadsheets",
            FileKind::Presentation => "Presentations",
            FileKind::Video => "Videos",
            FileKind::Audio => "Audio",
            FileKind::Archive => "Archives",
            FileKind::Installer => "Installers",
            FileKind::Code => "Code",
            FileKind::Design => "Design",
            FileKind::Other => "Other",
        }
    }
}

fn ext_lower(name: &str) -> String {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// A file's kind by its name (D.5): a screenshot is a picture named "Screenshot …", "Screen Shot …" or "CleanShot …".
pub fn file_kind(name: &str) -> FileKind {
    let e = ext_lower(name);
    if ["png", "jpg", "jpeg", "heic"].contains(&e.as_str()) && ["Screenshot ", "Screen Shot ", "CleanShot "].iter().any(|p| name.starts_with(p)) {
        return FileKind::Screenshot;
    }
    KIND_EXT.iter().find(|(_, exts)| exts.contains(&e.as_str())).map(|(k, _)| *k).unwrap_or(FileKind::Other)
}

/// Whether a file of `kind` matches the kinds asked for (`any` matches everything; `image` takes screenshots too).
pub fn kind_matches(kind: FileKind, wanted: &[String]) -> bool {
    wanted.is_empty() || wanted.iter().any(|w| w == "any" || w == kind.key() || (w == "image" && kind == FileKind::Screenshot))
}

// ---- local time --------------------------------------------------------------------------------------------------------

/// (year, month, day, hour, minute, second) in the Mac's own time zone.
pub fn local_parts(unix: i64) -> (i32, u32, u32, u32, u32, u32) {
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
        if !unsafe { localtime_r(&unix, &mut tm) }.is_null() {
            return (tm.year + 1900, (tm.mon + 1) as u32, tm.mday as u32, tm.hour as u32, tm.min as u32, tm.sec as u32);
        }
    }
    let days = unix.div_euclid(86_400);
    let secs = unix.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    (y as i32, m as u32, d as u32, (secs / 3600) as u32, (secs / 60 % 60) as u32, (secs % 60) as u32)
}

/// "2026-10" (organise by month).
pub fn month_folder(unix: i64) -> String {
    let (y, m, ..) = local_parts(unix);
    format!("{y:04}-{m:02}")
}

/// "2026-10-12 14.03.22" (rename by date).
pub fn date_name(unix: i64) -> String {
    let (y, m, d, h, mi, s) = local_parts(unix);
    format!("{y:04}-{m:02}-{d:02} {h:02}.{mi:02}.{s:02}")
}

// ---- the file system, injectable -------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryType {
    File,
    Dir,
    Symlink,
    Other,
}

/// What `lstat` says (never through a link).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stat {
    pub kind: EntryType,
    pub dev: u64,
    pub ino: u64,
    pub size: u64,
    pub mtime: i64,
    pub ctime: i64,
    pub birth: Option<i64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub name: String,
    pub path: PathBuf,
    pub stat: Stat,
}

/// Every way the Files helper touches the disk (P.5). `RealFileSys` is the only implementation outside the tests.
pub trait FileSys {
    fn list(&self, dir: &Path) -> io::Result<Vec<Item>>;
    fn stat(&self, p: &Path) -> io::Result<Stat>;
    /// Moves or renames, failing with `AlreadyExists` when `to` is taken (never replaces).
    fn rename_noreplace(&self, from: &Path, to: &Path) -> io::Result<()>;
    /// Copies a file to a name that must not exist yet.
    fn copy_new(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn mkdir(&self, p: &Path) -> io::Result<()>;
    fn rmdir_empty(&self, p: &Path) -> io::Result<()>;
    /// Moves to the Trash; where it went.
    fn trash(&self, p: &Path) -> io::Result<PathBuf>;
    /// Puts an item back from the Trash (never replacing).
    fn put_back(&self, from_trash: &Path, to: &Path) -> io::Result<()> {
        self.rename_noreplace(from_trash, to)
    }
    /// Creates a new file (never replacing) and writes it.
    fn write_new(&self, p: &Path, bytes: &[u8]) -> io::Result<()>;
    fn read(&self, p: &Path, max: u64) -> io::Result<Vec<u8>>;
    /// The canonical path of a folder (links in its own path resolved).
    fn canonical(&self, p: &Path) -> io::Result<PathBuf>;
}

fn stat_of(m: &std::fs::Metadata) -> Stat {
    let ft = m.file_type();
    let kind = if ft.is_symlink() {
        EntryType::Symlink
    } else if ft.is_dir() {
        EntryType::Dir
    } else if ft.is_file() {
        EntryType::File
    } else {
        EntryType::Other
    };
    #[cfg(unix)]
    let (dev, ino, mtime, ctime) = {
        use std::os::unix::fs::MetadataExt;
        (m.dev(), m.ino(), m.mtime(), m.ctime())
    };
    #[cfg(not(unix))]
    let (dev, ino, mtime, ctime) = (0u64, 0u64, 0i64, 0i64);
    let birth = m.created().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs() as i64);
    Stat { kind, dev, ino, size: m.len(), mtime, ctime, birth }
}

/// The real disk. `trash_dir`: tests put "the Trash" in a temp folder; the app uses the Mac's own Trash
/// (`NSFileManager trashItemAtURL:resultingItemURL:error:`).
pub struct RealFileSys {
    trash_dir: Option<PathBuf>,
}

impl RealFileSys {
    /// The Mac's own Trash. Built only in `jobs.rs` and `front.rs` command entry points (a test keeps it so).
    pub fn new() -> Self {
        RealFileSys { trash_dir: None }
    }

    #[cfg(test)]
    pub fn with_trash(dir: &Path) -> Self {
        RealFileSys { trash_dir: Some(dir.to_path_buf()) }
    }
}

#[cfg(target_os = "macos")]
fn rename_excl(from: &Path, to: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    extern "C" {
        fn renamex_np(from: *const std::ffi::c_char, to: *const std::ffi::c_char, flags: std::ffi::c_uint) -> std::ffi::c_int;
    }
    /// `RENAME_EXCL` from `<stdio.h>` (libc 0.2.190: 0x00000004).
    const RENAME_EXCL: std::ffi::c_uint = 0x0000_0004;
    let f = CString::new(from.as_os_str().as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    let t = CString::new(to.as_os_str().as_bytes()).map_err(|_| io::Error::from(io::ErrorKind::InvalidInput))?;
    if unsafe { renamex_np(f.as_ptr(), t.as_ptr(), RENAME_EXCL) } == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(target_os = "macos"))]
fn rename_excl(from: &Path, to: &Path) -> io::Result<()> {
    if std::fs::symlink_metadata(to).is_ok() {
        return Err(io::Error::from(io::ErrorKind::AlreadyExists));
    }
    std::fs::rename(from, to)
}

#[cfg(target_os = "macos")]
fn mac_trash(p: &Path) -> io::Result<PathBuf> {
    use objc2::{msg_send, rc::Retained, runtime::AnyClass, runtime::AnyObject};
    use objc2_foundation::NSString;
    objc2::rc::autoreleasepool(|_| unsafe {
        let (Some(fm_cls), Some(url_cls)) = (AnyClass::get(c"NSFileManager"), AnyClass::get(c"NSURL")) else { return Err(io::Error::other("no file manager")) };
        let fm: Option<Retained<AnyObject>> = msg_send![fm_cls, defaultManager];
        let fm = fm.ok_or_else(|| io::Error::other("no file manager"))?;
        let s = NSString::from_str(&p.to_string_lossy());
        let url: Option<Retained<AnyObject>> = msg_send![url_cls, fileURLWithPath: &*s];
        let url = url.ok_or_else(|| io::Error::other("bad path"))?;
        let mut out: *mut AnyObject = std::ptr::null_mut();
        let mut err: *mut AnyObject = std::ptr::null_mut();
        let ok: bool = msg_send![&*fm, trashItemAtURL: &*url, resultingItemURL: &mut out, error: &mut err];
        if !ok {
            return Err(io::Error::from(io::ErrorKind::PermissionDenied));
        }
        if out.is_null() {
            return Err(io::Error::other("no trash url"));
        }
        let path: Option<Retained<NSString>> = msg_send![&*out, path];
        Ok(PathBuf::from(path.map(|s| s.to_string()).unwrap_or_default()))
    })
}

impl FileSys for RealFileSys {
    fn list(&self, dir: &Path) -> io::Result<Vec<Item>> {
        let mut out = Vec::new();
        for e in std::fs::read_dir(dir)? {
            let Ok(e) = e else { continue };
            // `DirEntry::metadata` never follows a link.
            if let Ok(m) = e.metadata() {
                out.push(Item { name: e.file_name().to_string_lossy().to_string(), path: e.path(), stat: stat_of(&m) });
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    fn stat(&self, p: &Path) -> io::Result<Stat> {
        std::fs::symlink_metadata(p).map(|m| stat_of(&m))
    }

    fn rename_noreplace(&self, from: &Path, to: &Path) -> io::Result<()> {
        rename_excl(from, to)
    }

    fn copy_new(&self, from: &Path, to: &Path) -> io::Result<()> {
        let mut src = std::fs::File::open(from)?;
        if !src.metadata()?.is_file() {
            return Err(io::Error::from(io::ErrorKind::InvalidInput));
        }
        let mut dst = std::fs::OpenOptions::new().write(true).create_new(true).open(to)?;
        let r = io::copy(&mut src, &mut dst).and_then(|_| dst.flush());
        if r.is_err() {
            let _ = std::fs::remove_file(to);
        }
        r.map(|_| ())
    }

    fn mkdir(&self, p: &Path) -> io::Result<()> {
        std::fs::create_dir(p)
    }

    fn rmdir_empty(&self, p: &Path) -> io::Result<()> {
        std::fs::remove_dir(p)
    }

    fn trash(&self, p: &Path) -> io::Result<PathBuf> {
        match &self.trash_dir {
            Some(dir) => {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                for cand in name_candidates(&name) {
                    let to = dir.join(&cand);
                    match rename_excl(p, &to) {
                        Ok(()) => return Ok(to),
                        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                        Err(e) => return Err(e),
                    }
                }
                Err(io::Error::from(io::ErrorKind::AlreadyExists))
            }
            None => {
                #[cfg(target_os = "macos")]
                {
                    mac_trash(p)
                }
                #[cfg(not(target_os = "macos"))]
                {
                    Err(io::Error::from(io::ErrorKind::Unsupported))
                }
            }
        }
    }

    fn write_new(&self, p: &Path, bytes: &[u8]) -> io::Result<()> {
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(p)?;
        let r = f.write_all(bytes).and_then(|_| f.flush());
        if r.is_err() {
            let _ = std::fs::remove_file(p);
        }
        r
    }

    fn read(&self, p: &Path, max: u64) -> io::Result<Vec<u8>> {
        use std::io::Read;
        let f = std::fs::File::open(p)?;
        let mut out = Vec::new();
        f.take(max).read_to_end(&mut out)?;
        Ok(out)
    }

    fn canonical(&self, p: &Path) -> io::Result<PathBuf> {
        std::fs::canonicalize(p)
    }
}

// ---- names ---------------------------------------------------------------------------------------------------------------

/// `name`, then "stem 2.ext", "stem 3.ext"… (a folder: "Images 2").
pub fn name_candidates(name: &str) -> Vec<String> {
    let p = Path::new(name);
    let (stem, ext) = match (p.file_stem(), p.extension()) {
        (Some(s), Some(e)) if !name.starts_with('.') => (s.to_string_lossy().to_string(), format!(".{}", e.to_string_lossy())),
        _ => (name.to_string(), String::new()),
    };
    let mut out = vec![name.to_string()];
    for n in 2..=COLLISION_MAX {
        out.push(format!("{stem} {n}{ext}"));
    }
    out
}

/// A name the model may give (H.6): 1–255 characters, no `/`, `:` or control characters, not starting with ".", never
/// ending ".app" and never something that runs or holds secrets.
pub fn name_ok(name: &str) -> bool {
    let n = name.chars().count();
    (1..=255).contains(&n)
        && !name.starts_with('.')
        && !name.chars().any(|c| c == '/' || c == ':' || c.is_control())
        && !name.to_lowercase().ends_with(".app")
        && !crate::guard::runs_something(Path::new(name))
        && !crate::guard::secret_file(Path::new(name))
        && name.trim() == name
}

/// A rename keeps the file's extension: appended when the new name lacks it (H.6).
pub fn keep_extension(old: &str, new: &str) -> String {
    let e = Path::new(old).extension().map(|e| e.to_string_lossy().to_string());
    match e {
        Some(e) if !e.is_empty() && !new.to_lowercase().ends_with(&format!(".{}", e.to_lowercase())) => format!("{new}.{e}"),
        _ => new.to_string(),
    }
}

// ---- what is left alone ------------------------------------------------------------------------------------------------

/// Document packages: folders macOS shows as one file, which move as files (H.3).
pub const DOC_PACKAGES: &[&str] = &["pages", "numbers", "key", "rtfd"];
/// Libraries: never touched.
pub const LIBRARIES: &[&str] = &["photoslibrary", "musiclibrary", "tvlibrary", "photolibrary", "aplibrary", "migratedphotolibrary", "fcpbundle", "logicx", "band"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LeftAlone {
    Hidden,
    System,
    App,
    Folder,
    Recent,
    Link,
}

impl LeftAlone {
    /// H.5's `why`.
    pub fn why(self) -> &'static str {
        match self {
            LeftAlone::Hidden => "hidden",
            LeftAlone::System | LeftAlone::Link => "system",
            LeftAlone::App => "app",
            LeftAlone::Folder => "system",
            LeftAlone::Recent => "recent",
        }
    }
}

/// Whether an item is left alone when moving, copying, renaming, trashing or organising (D.3 `hidden_or_system`,
/// `recently_changed`). `folders_ok`: a plain folder may move (an explicit `move` of a listed folder).
pub fn left_alone(item: &Item, now: i64, folders_ok: bool) -> Option<LeftAlone> {
    let name = &item.name;
    let lower = name.to_lowercase();
    if name.starts_with('.') || lower == ".localized" {
        return Some(LeftAlone::Hidden);
    }
    if lower == "library" {
        return Some(LeftAlone::System);
    }
    match item.stat.kind {
        EntryType::Symlink => return Some(LeftAlone::Link),
        EntryType::Other => return Some(LeftAlone::System),
        EntryType::Dir => {
            let e = ext_lower(name);
            if e == "app" {
                return Some(LeftAlone::App);
            }
            if LIBRARIES.contains(&e.as_str()) {
                return Some(LeftAlone::System);
            }
            if !e.is_empty() && !DOC_PACKAGES.contains(&e.as_str()) {
                // A bundle or package that isn't a document.
                return Some(LeftAlone::App);
            }
            if e.is_empty() && !folders_ok {
                return Some(LeftAlone::Folder);
            }
        }
        EntryType::File => {}
    }
    if now - item.stat.mtime.max(item.stat.ctime) < RECENT_SECS {
        return Some(LeftAlone::Recent);
    }
    None
}

impl LeftAlone {
    /// The risk table's fact for it (D.3).
    pub fn fact(self) -> crate::risk::Fact {
        match self {
            LeftAlone::Recent => crate::risk::Fact::RecentlyChanged,
            _ => crate::risk::Fact::HiddenOrSystem,
        }
    }
}

/// The risk table's kind for a Files call (D.2): `files.move`, `files.read`…
pub fn call_kind(name: &str) -> String {
    let k = match name {
        "list_files" => "list",
        "read_text" => "read",
        "write_file" => "write",
        other => other,
    };
    format!("files.{k}")
}

/// One item of a call, classified with what the Mac sees (D.3): left alone (hidden, system, just changed), on another
/// disk, or outside the allowed roots: `never`, so it is skipped (and listed), never fatal.
pub fn item_never(kind: &str, alone: Option<LeftAlone>, cross_volume: bool, outside: bool) -> bool {
    use crate::risk::Fact;
    let mut facts: Vec<Fact> = alone.map(|a| vec![a.fact()]).unwrap_or_default();
    if cross_volume {
        facts.push(Fact::CrossVolume);
    }
    if outside {
        facts.push(Fact::OutsideAllowed);
    }
    crate::risk::classify(kind, &facts).class == crate::risk::Class::Never
}

/// A path inside a package, a library or an app (somewhere below a folder with an extension), or with a hidden or
/// `Library` part below the root.
pub fn inside_package(path: &Path, root: &Path) -> bool {
    let Ok(rest) = path.strip_prefix(root) else { return true };
    let parts: Vec<String> = rest.components().filter_map(|c| match c {
        Component::Normal(n) => Some(n.to_string_lossy().to_string()),
        _ => None,
    }).collect();
    let n = parts.len();
    parts.iter().enumerate().any(|(i, p)| {
        let last = i + 1 == n;
        p.starts_with('.') || p.eq_ignore_ascii_case("library") || (!last && Path::new(p).extension().is_some_and(|e| !e.is_empty()))
    })
}

// ---- the allowed roots and the refs -------------------------------------------------------------------------------------

/// One allowed folder (H.2): Desktop, Documents, Downloads, or one the person added.
#[derive(Clone, Debug, PartialEq)]
pub struct Root {
    pub path: PathBuf,
    /// "Desktop", "Projects".
    pub title: String,
    /// "named", "added".
    pub source: &'static str,
    /// "desktop", the added folder's own name.
    pub name: String,
}

/// Whether `path` is `base` or inside it, ignoring case: APFS is case-insensitive by default, so "/users/ada" is the home
/// folder too (review, 16 October 2026).
fn under_ci(path: &Path, base: &Path) -> bool {
    let parts = |p: &Path| -> Vec<String> { p.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect() };
    let (p, b) = (parts(path), parts(base));
    p.len() >= b.len() && p[..b.len()] == b[..]
}

/// The folders the person added that are fine to add (0b.23): absolute, not `/`, not the home folder itself and not a
/// folder that holds it (review, 16 October 2026: adding `/Users` brought the whole home folder in), not `/System`,
/// `/Library`, `~/Library`, `/Applications` or anything hidden; at most 10. Compared without case. The callers pass the
/// path canonicalised (the add command does it before saving).
pub fn added_folder_ok(path: &Path, home: &Path) -> bool {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return false;
    }
    if path == Path::new("/") || under_ci(home, path) {
        return false;
    }
    for bad in ["/System", "/Library", "/Applications", "/private", "/usr", "/bin", "/sbin", "/etc", "/var", "/dev", "/cores", "/opt"] {
        if under_ci(path, Path::new(bad)) {
            return false;
        }
    }
    if under_ci(path, &home.join("Library")) {
        return false;
    }
    !path.components().any(|c| matches!(c, Component::Normal(n) if n.to_string_lossy().starts_with('.')))
}

/// Refs to paths, per job, never leaving the Mac (G.5).
#[derive(Default, Debug)]
pub struct Refs {
    map: BTreeMap<String, PathBuf>,
    back: HashMap<(char, PathBuf), String>,
    next: HashMap<char, u32>,
}

/// A ref as the model may send one (H.6).
pub fn ref_ok(r: &str) -> bool {
    let mut c = r.chars();
    matches!(c.next(), Some('c' | 'e' | 'f' | 'n')) && (1..=6).contains(&c.clone().count()) && c.all(|d| d.is_ascii_digit())
}

impl Refs {
    /// A ref for `path` under `prefix` (the same one again for the same path).
    pub fn add(&mut self, prefix: char, path: &Path) -> String {
        if let Some(r) = self.back.get(&(prefix, path.to_path_buf())) {
            return r.clone();
        }
        let n = self.next.entry(prefix).or_insert(0);
        *n += 1;
        let r = format!("{prefix}{n}");
        self.map.insert(r.clone(), path.to_path_buf());
        self.back.insert((prefix, path.to_path_buf()), r.clone());
        r
    }

    pub fn get(&self, r: &str) -> Option<&PathBuf> {
        if !ref_ok(r) {
            return None;
        }
        self.map.get(r)
    }

    /// After a move or rename, a ref follows its item.
    pub fn moved(&mut self, r: &str, to: &Path) {
        if let Some(p) = self.map.get_mut(r) {
            let prefix = r.chars().next().unwrap_or('e');
            self.back.remove(&(prefix, p.clone()));
            *p = to.to_path_buf();
            self.back.insert((prefix, to.to_path_buf()), r.to_string());
        }
    }
}

// ---- the manifest and Undo (G.11) -----------------------------------------------------------------------------------------

/// One change, as the manifest keeps it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Op {
    /// A move or a rename: it goes back if it is still at `to`, unchanged.
    Moved { from: PathBuf, to: PathBuf, ino: u64, size: u64, mtime: i64 },
    /// A folder she made: removed if empty.
    Made { path: PathBuf },
    /// A copy or a new file she made: to the Trash if unchanged.
    New { path: PathBuf, ino: u64, size: u64, mtime: i64 },
    /// Something she put in the Trash: back where it was.
    Trashed { from: PathBuf, to: PathBuf },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManifestHead {
    pub job_id: String,
    pub title: String,
    pub at: i64,
    #[serde(default)]
    pub undone_at: Option<i64>,
}

/// The manifest file: the head on the first line, one change a line after it, appended as each change is made.
pub struct Manifest {
    path: Option<PathBuf>,
    file: Option<std::fs::File>,
    pub ops: Vec<Op>,
    unsynced: usize,
}

impl Manifest {
    /// In memory only (no Undo across restarts).
    pub fn memory() -> Self {
        Manifest { path: None, file: None, ops: Vec::new(), unsynced: 0 }
    }

    /// `dir/<job id>.json`, mode 0600, its head written now.
    pub fn create(dir: &Path, head: &ManifestHead) -> io::Result<Self> {
        std::fs::create_dir_all(dir)?;
        let path = dir.join(format!("{}.json", safe_id(&head.job_id)));
        let mut file = std::fs::OpenOptions::new().append(true).create(true).open(&path)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
        }
        writeln!(file, "{}", serde_json::to_string(head).unwrap_or_default())?;
        file.sync_data()?;
        Ok(Manifest { path: Some(path), file: Some(file), ops: Vec::new(), unsynced: 0 })
    }

    pub fn path(&self) -> Option<&Path> {
        self.path.as_deref()
    }

    pub fn push(&mut self, op: Op) {
        if let Some(f) = self.file.as_mut() {
            let _ = writeln!(f, "{}", serde_json::to_string(&op).unwrap_or_default());
            self.unsynced += 1;
            if self.unsynced >= SYNC_EVERY {
                let _ = f.sync_data();
                self.unsynced = 0;
            }
        }
        self.ops.push(op);
    }

    pub fn sync(&mut self) {
        if let Some(f) = self.file.as_mut() {
            let _ = f.flush();
            let _ = f.sync_data();
            self.unsynced = 0;
        }
    }

    pub fn has_changes(&self) -> bool {
        !self.ops.is_empty()
    }
}

/// A job id as a file name: hex and dashes only.
pub fn safe_id(id: &str) -> String {
    id.chars().filter(|c| c.is_ascii_hexdigit() || *c == '-').take(64).collect()
}

/// Reads a manifest file: its head and its changes (a broken last line, from a crash mid-write, is left out).
pub fn read_manifest(path: &Path) -> Option<(ManifestHead, Vec<Op>)> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut lines = text.lines();
    let head: ManifestHead = serde_json::from_str(lines.next()?).ok()?;
    let ops = lines.filter_map(|l| serde_json::from_str::<Op>(l).ok()).collect();
    Some((head, ops))
}

/// Marks a manifest undone (rewrites its head line).
pub fn mark_undone(path: &Path, at: i64) -> io::Result<()> {
    let text = std::fs::read_to_string(path)?;
    let mut lines: Vec<String> = text.lines().map(String::from).collect();
    let Some(first) = lines.first_mut() else { return Ok(()) };
    let mut head: ManifestHead = serde_json::from_str(first).map_err(|_| io::Error::from(io::ErrorKind::InvalidData))?;
    head.undone_at = Some(at);
    *first = serde_json::to_string(&head).unwrap_or_default();
    std::fs::write(path, lines.join("\n") + "\n")
}

/// Manifests older than 7 days go (G.11).
pub fn prune_manifests(dir: &Path, now: i64) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.extension().is_some_and(|x| x == "json") {
            let old = read_manifest(&p).is_none_or(|(h, _)| now - h.at > MANIFEST_DAYS * 86_400);
            if old {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
pub struct UndoCount {
    pub restored: usize,
    pub skipped: usize,
}

fn same(s: &Stat, ino: u64, size: u64, mtime: i64) -> bool {
    s.ino == ino && s.size == size && s.mtime == mtime
}

/// Puts `from` back at `to` (or "… 2" when `to` is taken). True when it went back.
fn put_back_named(fs: &dyn FileSys, from: &Path, to: &Path, trash: bool) -> bool {
    let Some(dir) = to.parent() else { return false };
    let name = to.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    for cand in name_candidates(&name) {
        let target = dir.join(&cand);
        let r = if trash { fs.put_back(from, &target) } else { fs.rename_noreplace(from, &target) };
        match r {
            Ok(()) => return true,
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(_) => return false,
        }
    }
    false
}

/// Undo (G.11): newest first; anything that changed since is left and counted. The counts are the person's items put
/// back (and new files taken away), never the folders she made: "I put back 64 items" after 64 files went into 7
/// folders, not 71 (integration, 16 October 2026). A folder of hers that isn't empty any more stays, uncounted: what is
/// in it is counted already, or is new since.
pub fn undo(fs: &dyn FileSys, ops: &[Op]) -> UndoCount {
    let mut c = UndoCount::default();
    for op in ops.iter().rev() {
        let ok = match op {
            Op::Moved { from, to, ino, size, mtime } => match fs.stat(to) {
                Ok(s) if same(&s, *ino, *size, *mtime) || (s.kind == EntryType::Dir && s.ino == *ino) => put_back_named(fs, to, from, false),
                _ => false,
            },
            Op::Made { path } => {
                let _ = fs.rmdir_empty(path);
                continue;
            }
            Op::New { path, ino, size, mtime } => match fs.stat(path) {
                Ok(s) if same(&s, *ino, *size, *mtime) => fs.trash(path).is_ok(),
                _ => false,
            },
            Op::Trashed { from, to } => fs.stat(to).is_ok() && put_back_named(fs, to, from, true),
        };
        if ok {
            c.restored += 1;
        } else {
            c.skipped += 1;
        }
    }
    c
}

// ---- tools: converters, capture dates ----------------------------------------------------------------------------------

/// The fixed converters (H.5): absolute paths, fixed arguments, no shell.
pub trait Tools {
    /// `/usr/bin/textutil -convert <to> -output <out> <src>` (to: html, docx, rtf, txt).
    fn textutil(&self, src: &Path, to: &str, out: &Path) -> bool;
    /// `/usr/bin/sips -s format <pdf|jpeg|png> <src> --out <out>`.
    fn sips(&self, src: &Path, format: &str, out: &Path) -> bool;
    /// HTML to PDF (WebKit, `act.rs` `render_pdf`).
    fn render_pdf(&self, html: &str) -> Option<Vec<u8>>;
    /// A PDF's text (PDFKit, `filework::pdf_text`).
    fn pdf_text(&self, src: &Path) -> Option<String>;
}

/// When pictures were taken (H.4): Spotlight's `kMDItemContentCreationDate`, unix seconds.
pub trait Mdls {
    fn capture_dates(&self, paths: &[PathBuf]) -> Vec<Option<i64>>;
}

/// `mdls -raw -nullMarker "" -name kMDItemContentCreationDate <files…>` (5 s).
pub struct RealMdls;

impl Mdls for RealMdls {
    fn capture_dates(&self, paths: &[PathBuf]) -> Vec<Option<i64>> {
        if paths.is_empty() || paths.len() > MDLS_BATCH {
            return vec![None; paths.len()];
        }
        let mut args: Vec<String> = vec!["-raw".into(), "-nullMarker".into(), String::new(), "-name".into(), "kMDItemContentCreationDate".into()];
        args.extend(paths.iter().map(|p| p.to_string_lossy().to_string()));
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let Some(out) = run_tool("/usr/bin/mdls", &refs, std::time::Duration::from_secs(5)) else { return vec![None; paths.len()] };
        let values: Vec<Option<i64>> = String::from_utf8_lossy(&out).split('\0').map(crate::open::parse_md_date).collect();
        if values.len() >= paths.len() {
            values.into_iter().take(paths.len()).collect()
        } else {
            vec![None; paths.len()]
        }
    }
}

/// Runs a fixed tool with a time limit; whether it succeeded, and its output.
pub fn run_tool(program: &str, args: &[&str], limit: std::time::Duration) -> Option<Vec<u8>> {
    use std::process::{Command, Stdio};
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
            Ok(Some(status)) => return status.success().then(|| reader.join().ok()).flatten(),
            Ok(None) if started.elapsed() < limit => std::thread::sleep(std::time::Duration::from_millis(15)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// The Mac's own converters. `render` is WebKit's PDF render (it needs the app).
pub struct RealTools<'a> {
    pub render: &'a dyn Fn(&str) -> Option<Vec<u8>>,
}

const TOOL_TIME: std::time::Duration = std::time::Duration::from_secs(30);

/// textutil's arguments. `-noload` always (review, 16 October 2026): an HTML or web-archive file's own pictures and
/// links are never fetched while converting, so converting a page from Downloads sends nothing anywhere and pulls in no
/// file from outside the allowed folders; `-timeout 5` caps any loading textutil still tries.
pub fn textutil_args(src: &Path, to: &str, out: &Path) -> Vec<String> {
    ["-noload", "-timeout", "5", "-convert", to, "-output"].iter().map(|s| s.to_string()).chain([out.to_string_lossy().to_string(), src.to_string_lossy().to_string()]).collect()
}

impl Tools for RealTools<'_> {
    fn textutil(&self, src: &Path, to: &str, out: &Path) -> bool {
        let args = textutil_args(src, to, out);
        let args: Vec<&str> = args.iter().map(String::as_str).collect();
        ["html", "docx", "rtf", "txt"].contains(&to) && run_tool("/usr/bin/textutil", &args, TOOL_TIME).is_some()
    }
    fn sips(&self, src: &Path, format: &str, out: &Path) -> bool {
        ["pdf", "jpeg", "png"].contains(&format) && run_tool("/usr/bin/sips", &["-s", "format", format, &src.to_string_lossy(), "--out", &out.to_string_lossy()], TOOL_TIME).is_some()
    }
    fn render_pdf(&self, html: &str) -> Option<Vec<u8>> {
        (self.render)(html)
    }
    fn pdf_text(&self, src: &Path) -> Option<String> {
        crate::filework::pdf_text(src)
    }
}

// ---- the calls (H.5–H.7) -----------------------------------------------------------------------------------------------

/// The person's yes for one `trash` call (G.4): exactly these refs, this many.
#[derive(Clone, Debug, PartialEq)]
pub struct Approval {
    pub count: usize,
    pub refs_sha256: String,
}

/// The SHA-256 of refs joined with "," (G.4).
pub fn refs_sha256(refs: &[String]) -> String {
    crate::act::sha256_hex(&refs.join(","))
}

/// A call's result, as the next step carries it (G.3 `results`).
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CallResult {
    pub id: String,
    pub name: String,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub out: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// A batch's progress, for `brenda://job progress` (G.5).
#[derive(Clone, Debug, PartialEq)]
pub struct Progress {
    pub done: usize,
    pub of: usize,
    pub note: String,
}

/// What a running Files job needs from around it.
pub struct Env<'a> {
    pub fs: &'a dyn FileSys,
    pub tools: &'a dyn Tools,
    pub mdls: &'a dyn Mdls,
    pub now: i64,
    pub stopped: &'a dyn Fn() -> bool,
    pub progress: &'a mut dyn FnMut(Progress),
    /// Opens (false) or shows in Finder (true) a path; whether it worked.
    pub open: &'a mut dyn FnMut(&Path, bool) -> bool,
}

/// The job's state on the Mac (G.5): roots, refs, what she made, the manifest, the running counts.
pub struct FilesJob {
    pub roots: Vec<Root>,
    pub refs: Refs,
    pub made: HashSet<PathBuf>,
    pub manifest: Manifest,
    pub changes: usize,
    pub new_files: usize,
    pub read_chars: usize,
    pub never: Vec<String>,
    /// New files worth opening at the end (n refs).
    pub outputs: Vec<String>,
    /// macOS refused one of the folders (EPERM): the end card offers Open System Settings (G.5; integration, 16 October
    /// 2026: nothing told the page before).
    pub denied: bool,
}

/// Whether a call's error is a folder macOS refused (`denied`'s words).
pub fn is_denied(error: &str) -> bool {
    error.starts_with("Not done: your Mac hasn't let Brenda into ")
}

fn ok(out: Value) -> Result<Value, String> {
    Ok(out)
}

fn str_of<'a>(input: &'a Value, key: &str) -> Result<&'a str, String> {
    input.get(key).and_then(|v| v.as_str()).ok_or_else(|| format!("Not done: {key} is missing."))
}

fn refs_of(input: &Value, key: &str) -> Result<Vec<String>, String> {
    let arr = input.get(key).and_then(|v| v.as_array()).ok_or_else(|| format!("Not done: {key} is missing."))?;
    if arr.len() > REFS_PER_CALL {
        return Err("Not done: at most 500 at a time.".into());
    }
    let refs: Vec<String> = arr.iter().filter_map(|v| v.as_str().map(String::from)).collect();
    if refs.len() != arr.len() || refs.iter().any(|r| !ref_ok(r)) {
        return Err(NOT_KNOWN.into());
    }
    Ok(refs)
}

/// The words for a folder whose permission macOS refused.
fn denied(title: &str) -> String {
    format!("Not done: your Mac hasn't let Brenda into {title}.")
}

fn io_why(e: &io::Error) -> &'static str {
    match e.kind() {
        io::ErrorKind::NotFound => "gone",
        io::ErrorKind::PermissionDenied => "locked",
        _ if e.raw_os_error() == Some(18) => "volume", // EXDEV
        _ if e.raw_os_error() == Some(1) => "locked",  // EPERM
        _ => "locked",
    }
}

impl FilesJob {
    pub fn new(roots: Vec<Root>, never: Vec<String>, manifest: Manifest) -> Self {
        let mut refs = Refs::default();
        for r in &roots {
            refs.add('f', &r.path);
        }
        FilesJob { roots, refs, made: HashSet::new(), manifest, changes: 0, new_files: 0, read_chars: 0, never, outputs: Vec::new(), denied: false }
    }

    /// The folders as step 0 carries them (G.3 `start.folders`).
    pub fn folders_json(&mut self) -> Vec<Value> {
        let roots = self.roots.clone();
        roots.iter().map(|r| json!({ "ref": self.refs.add('f', &r.path), "source": r.source, "name": r.name, "title": r.title })).collect()
    }

    /// The root an absolute path is inside (after canonicalising its parent), if any.
    fn root_of(&self, fs: &dyn FileSys, path: &Path) -> Option<Root> {
        let canon = if self.roots.iter().any(|r| r.path == path) {
            path.to_path_buf()
        } else {
            let parent = fs.canonical(path.parent()?).ok()?;
            parent.join(path.file_name()?)
        };
        self.roots.iter().find(|r| canon == r.path || canon.starts_with(&r.path)).filter(|r| canon == r.path || !inside_package(&canon, &r.path)).cloned()
    }

    /// A ref's path, still inside an allowed root (D.3 `outside_allowed`).
    fn path_of(&self, fs: &dyn FileSys, r: &str) -> Result<(PathBuf, Root), String> {
        let p = self.refs.get(r).cloned().ok_or_else(|| NOT_KNOWN.to_string())?;
        let root = self.root_of(fs, &p);
        if item_never("files.list", None, false, root.is_none()) {
            return Err("Not done: I only work in your Desktop, Documents, Downloads and the folders you add.".to_string());
        }
        let root = root.expect("checked");
        Ok((p, root))
    }

    fn folder_of(&self, fs: &dyn FileSys, r: &str) -> Result<(PathBuf, Root), String> {
        let (p, root) = self.path_of(fs, r)?;
        match fs.stat(&p) {
            Ok(s) if s.kind == EntryType::Dir => {
                if p != root.path && Path::new(&*p.file_name().unwrap_or_default().to_string_lossy()).extension().is_some() {
                    return Err("Not done: that's not a folder I can use.".into());
                }
                Ok((p, root))
            }
            Ok(_) => Err("Not done: that's not a folder.".into()),
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(1) => Err(denied(&root.title)),
            Err(_) => Err("Not done: that folder is gone.".into()),
        }
    }

    /// Whether `p` is one of the allowed folders or holds one (review, 16 October 2026: a move or rename of an added or
    /// pointed folder itself left the person's saved folder pointing nowhere). Such a ref is skipped with "system".
    fn is_root_or_holds_one(&self, p: &Path) -> bool {
        self.roots.iter().any(|r| under_ci(&r.path, p))
    }

    fn item_of(&self, fs: &dyn FileSys, p: &Path) -> Option<Item> {
        let stat = fs.stat(p).ok()?;
        Some(Item { name: p.file_name()?.to_string_lossy().to_string(), path: p.to_path_buf(), stat })
    }

    fn change_room(&self, n: usize) -> bool {
        self.changes + n <= CHANGES
    }

    /// Moves `from` into `dir` under its own name (" 2" when taken). The new path.
    fn move_into(&mut self, fs: &dyn FileSys, from: &Path, dir: &Path, name: &str) -> io::Result<PathBuf> {
        for cand in name_candidates(name) {
            let to = dir.join(&cand);
            match fs.rename_noreplace(from, &to) {
                Ok(()) => {
                    let s = fs.stat(&to)?;
                    self.manifest.push(Op::Moved { from: from.to_path_buf(), to: to.clone(), ino: s.ino, size: s.size, mtime: s.mtime });
                    self.changes += 1;
                    return Ok(to);
                }
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
        Err(io::Error::from(io::ErrorKind::AlreadyExists))
    }

    /// The folder `name` inside `dir`: the existing folder, or a new one ("Images 2" when a file has the name). Its path
    /// and whether it existed.
    fn ensure_folder(&mut self, fs: &dyn FileSys, dir: &Path, name: &str) -> io::Result<(PathBuf, bool)> {
        for cand in name_candidates(name) {
            let p = dir.join(&cand);
            match fs.stat(&p) {
                Ok(s) if s.kind == EntryType::Dir => return Ok((p, true)),
                Ok(_) => continue,
                Err(_) => match fs.mkdir(&p) {
                    Ok(()) => {
                        self.manifest.push(Op::Made { path: p.clone() });
                        self.made.insert(p.clone());
                        self.changes += 1;
                        return Ok((p, false));
                    }
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(e) => return Err(e),
                },
            }
        }
        Err(io::Error::from(io::ErrorKind::AlreadyExists))
    }

    /// Runs one call (H.7). `approval`: the person's yes for this turn's `trash`, if any.
    pub fn run_call(&mut self, env: &mut Env, id: &str, name: &str, input: &Value, approval: Option<&Approval>) -> CallResult {
        // Every call is classified first (D): an unknown one never runs, the Trash asks (its yes is `approval`).
        let class = crate::risk::classify(&call_kind(name), &[]);
        let r = if (env.stopped)() {
            Err("Not done: you stopped me.".to_string())
        } else if class.class == crate::risk::Class::Never {
            Err(format!("Not done: I don't know how to {}.", name.replace('_', " ")))
        } else if class.class == crate::risk::Class::Ask && approval.is_none() {
            Err("Not done: I need your yes before anything goes to the Trash.".to_string())
        } else {
            match name {
                "list_files" => self.list_files(env, input),
                "read_text" => self.read_text(env, input),
                "make_folder" => self.make_folder(env, input),
                "move" => self.move_or_copy(env, input, false),
                "copy" => self.move_or_copy(env, input, true),
                "rename" => self.rename(env, input),
                "organise" => self.organise(env, input),
                "rename_by_date" => self.rename_by_date(env, input),
                "convert" => self.convert(env, input),
                "write_file" => self.write_file(env, input),
                "trash" => self.trash(env, input, approval),
                "open" => self.open(env, input),
                other => Err(format!("Not done: I don't know how to {other}.")),
            }
        };
        self.manifest.sync();
        match r {
            Ok(mut out) => {
                cap_value(&mut out);
                CallResult { id: id.into(), name: name.into(), ok: true, out: Some(out), error: None }
            }
            Err(e) => CallResult { id: id.into(), name: name.into(), ok: false, out: None, error: Some(e) },
        }
    }

    fn list_files(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let r = str_of(input, "folder")?;
        let (dir, root) = self.folder_of(env.fs, r)?;
        let recursive = input.get("recursive").and_then(|v| v.as_bool()).unwrap_or(false);
        let kinds: Vec<String> = input.get("kinds").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|k| k.as_str().map(String::from)).collect()).unwrap_or_default();
        let since = input.get("since_days").and_then(|v| v.as_i64()).unwrap_or(0).clamp(0, 3_650);
        let words: Vec<String> = input.get("words").and_then(|v| v.as_array()).map(|a| a.iter().filter_map(|w| w.as_str().map(|s| s.trim().to_lowercase())).filter(|w| !w.is_empty()).collect()).unwrap_or_default();
        let folder_ref = self.refs.add(if r.starts_with('f') { 'f' } else if r.starts_with('n') { 'n' } else { 'e' }, &dir);
        (env.progress)(Progress { done: 0, of: 0, note: format!("Looking at {}", folder_title(&dir, &root)) });
        let mut items = Vec::new();
        let (mut hidden, mut recent, mut system, mut total) = (0usize, 0usize, 0usize, 0usize);
        let mut queue = vec![(dir.clone(), 1u32)];
        let max_depth = if recursive { 3 } else { 1 };
        let mut first = true;
        while let Some((d, depth)) = queue.pop() {
            let list = match env.fs.list(&d) {
                Ok(l) => l,
                Err(e) if first && (e.kind() == io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(1)) => return Err(denied(&root.title)),
                Err(_) => continue,
            };
            first = false;
            for it in list {
                if it.name.starts_with('.') {
                    hidden += 1;
                    continue;
                }
                let is_dir = it.stat.kind == EntryType::Dir;
                let plain_dir = is_dir && Path::new(&it.name).extension().is_none();
                if it.stat.kind == EntryType::Symlink || it.stat.kind == EntryType::Other || it.name.eq_ignore_ascii_case("library") {
                    system += 1;
                    continue;
                }
                if is_dir && !plain_dir && !DOC_PACKAGES.contains(&ext_lower(&it.name).as_str()) {
                    system += 1;
                    continue;
                }
                if !is_dir || !plain_dir {
                    if crate::folder::skip_file(&it.path, &self.never) {
                        system += 1;
                        continue;
                    }
                } else if crate::folder::skip_dir(&it.name, &self.never) {
                    system += 1;
                    continue;
                }
                if env.now - it.stat.mtime.max(it.stat.ctime) < RECENT_SECS {
                    recent += 1;
                    continue;
                }
                if plain_dir && depth < max_depth {
                    queue.push((it.path.clone(), depth + 1));
                }
                let kind = if plain_dir { None } else { Some(file_kind(&it.name)) };
                let kind_key = kind.map(|k| k.key()).unwrap_or("folder");
                let wanted = kinds.is_empty() || kinds.iter().any(|k| k == "any" || k == kind_key || (k == "image" && kind == Some(FileKind::Screenshot)));
                if !wanted {
                    continue;
                }
                if since > 0 && it.stat.mtime < env.now - since * 86_400 {
                    continue;
                }
                let lname = it.name.to_lowercase();
                if !words.iter().all(|w| lname.contains(w.as_str())) {
                    continue;
                }
                total += 1;
                if items.len() < LIST_ITEMS {
                    let r = self.refs.add('e', &it.path);
                    items.push(json!({ "ref": r, "name": it.name, "kind": kind_key, "bytes": it.stat.size, "modified": iso(it.stat.mtime), "created": it.stat.birth.map(iso), "dir": plain_dir }));
                }
            }
        }
        let shown = items.len();
        ok(json!({ "folder": folder_title(&dir, &root), "ref": folder_ref, "items": items, "total": total, "shown": shown, "skipped": { "hidden": hidden, "recent": recent, "system": system } }))
    }

    fn read_text(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let r = str_of(input, "ref")?;
        let (p, _) = self.path_of(env.fs, r)?;
        let item = self.item_of(env.fs, &p).ok_or("Not done: that file is gone.")?;
        if item.stat.kind != EntryType::File {
            return Err("Not done: I can only read files.".into());
        }
        if crate::guard::secret_file(&p) || crate::folder::skip_file(&p, &self.never) {
            return Err("Not done: I don't read that kind of file.".into());
        }
        let left = JOB_READ_CHARS.saturating_sub(self.read_chars);
        if left == 0 {
            return Err("Not done: I've read as much as one job may. Finish with what you have.".into());
        }
        (env.progress)(Progress { done: 0, of: 0, note: format!("Reading “{}”", crate::folder::clip_name(&item.name, 40)) });
        let max = READ_CHARS.min(left);
        let text = if ext_lower(&item.name) == "pdf" {
            env.tools.pdf_text(&p).ok_or("Not done: I couldn't read that PDF.")?
        } else {
            let c = crate::filework::Candidate { source: crate::filework::Source::FinderSelection, name: item.name.clone(), kind: crate::filework::kind_of(&p, &[]), bytes: item.stat.size, path: p.clone(), app: None };
            let read = crate::filework::read_capped(&c, max).ok();
            match read.as_ref().map(|(p, _)| p) {
                Some(crate::filework::Payload::Text { text, .. }) => text.clone(),
                _ => {
                    let bytes = env.fs.read(&p, (max * 4) as u64).map_err(|_| "Not done: I couldn't read that file.")?;
                    String::from_utf8(bytes).map_err(|_| "Not done: that file isn't text I can read.")?
                }
            }
        };
        let (text, truncated) = crate::filework::cut_text(text, max);
        self.read_chars += text.chars().count();
        ok(json!({ "ref": r, "name": item.name, "text": text, "truncated": truncated }))
    }

    fn make_folder(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let (dir, _) = self.folder_of(env.fs, str_of(input, "in")?)?;
        let name = str_of(input, "name")?;
        if !name_ok(name) || Path::new(name).extension().is_some_and(|e| e.eq_ignore_ascii_case("app")) {
            return Err("Not done: that folder name isn't one I can use.".into());
        }
        if !self.change_room(1) {
            return Err(TOO_MUCH.into());
        }
        (env.progress)(Progress { done: 0, of: 1, note: "Making folders".into() });
        let (p, existed) = self.ensure_folder(env.fs, &dir, name).map_err(|_| "Not done: I couldn't make that folder.".to_string())?;
        let r = self.refs.add(if existed { 'e' } else { 'n' }, &p);
        let shown = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        ok(json!({ "ref": r, "name": shown, "existed": existed }))
    }

    fn move_or_copy(&mut self, env: &mut Env, input: &Value, copy: bool) -> Result<Value, String> {
        let refs = refs_of(input, "refs")?;
        let (to_dir, to_root) = self.folder_of(env.fs, str_of(input, "to")?)?;
        let to_dev = env.fs.stat(&to_dir).map(|s| s.dev).unwrap_or(0);
        if !self.change_room(refs.len()) {
            return Err(TOO_MUCH.into());
        }
        let note = if copy { "Copying" } else { "Moving files" };
        let (mut done, mut skipped) = (Vec::new(), Vec::new());
        for (i, r) in refs.iter().enumerate() {
            if (env.stopped)() {
                break;
            }
            (env.progress)(Progress { done: i, of: refs.len(), note: note.into() });
            let Ok((p, _)) = self.path_of(env.fs, r) else {
                skipped.push(json!({ "ref": r, "why": "outside" }));
                continue;
            };
            let Some(item) = self.item_of(env.fs, &p) else {
                skipped.push(json!({ "ref": r, "why": "gone" }));
                continue;
            };
            if self.is_root_or_holds_one(&p) {
                skipped.push(json!({ "ref": r, "why": "system" }));
                continue;
            }
            let made_here = self.made.contains(&p);
            let alone = left_alone(&item, env.now, !copy).filter(|_| !made_here);
            let kind = if copy { "files.copy" } else { "files.move" };
            if item_never(kind, alone, false, false) {
                skipped.push(json!({ "ref": r, "why": alone.map(|a| a.why()).unwrap_or("system") }));
                continue;
            }
            if copy && item.stat.kind != EntryType::File {
                skipped.push(json!({ "ref": r, "why": "system" }));
                continue;
            }
            if p.parent() == Some(to_dir.as_path()) && !copy {
                skipped.push(json!({ "ref": r, "why": "same" }));
                continue;
            }
            if to_dir.starts_with(&p) {
                skipped.push(json!({ "ref": r, "why": "same" }));
                continue;
            }
            if !copy && item_never("files.move", None, item.stat.dev != to_dev, false) {
                skipped.push(json!({ "ref": r, "why": "volume" }));
                continue;
            }
            if copy {
                let mut made = None;
                for cand in name_candidates(&item.name) {
                    let t = to_dir.join(&cand);
                    match env.fs.copy_new(&p, &t) {
                        Ok(()) => {
                            made = Some(t);
                            break;
                        }
                        Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                        Err(_) => break,
                    }
                }
                match made {
                    Some(t) => {
                        if let Ok(s) = env.fs.stat(&t) {
                            self.manifest.push(Op::New { path: t.clone(), ino: s.ino, size: s.size, mtime: s.mtime });
                        }
                        self.changes += 1;
                        self.made.insert(t.clone());
                        let nr = self.refs.add('n', &t);
                        done.push(json!({ "ref": r, "name": item.name, "to": t.file_name().map(|n| n.to_string_lossy().to_string()), "newRef": nr }));
                    }
                    None => skipped.push(json!({ "ref": r, "why": "locked" })),
                }
            } else {
                match self.move_into(env.fs, &p, &to_dir, &item.name) {
                    Ok(t) => {
                        self.refs.moved(r, &t);
                        if made_here {
                            self.made.insert(t.clone());
                        }
                        done.push(json!({ "ref": r, "name": item.name, "to": t.file_name().map(|n| n.to_string_lossy().to_string()), "newRef": r }));
                    }
                    Err(e) => skipped.push(json!({ "ref": r, "why": io_why(&e) })),
                }
            }
        }
        (env.progress)(Progress { done: refs.len(), of: refs.len(), note: note.into() });
        let _ = to_root;
        ok(json!({ "done": done, "skipped": skipped }))
    }

    fn rename(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let items = input.get("items").and_then(|v| v.as_array()).ok_or("Not done: items is missing.")?;
        if items.len() > REFS_PER_CALL {
            return Err("Not done: at most 500 at a time.".into());
        }
        if !self.change_room(items.len()) {
            return Err(TOO_MUCH.into());
        }
        let (mut done, mut skipped) = (Vec::new(), Vec::new());
        for (i, it) in items.iter().enumerate() {
            if (env.stopped)() {
                break;
            }
            (env.progress)(Progress { done: i, of: items.len(), note: "Renaming".into() });
            let (Some(r), Some(new)) = (it.get("ref").and_then(|v| v.as_str()), it.get("name").and_then(|v| v.as_str())) else { return Err("Not done: each item needs a ref and a name.".into()) };
            if !ref_ok(r) {
                return Err(NOT_KNOWN.into());
            }
            let Ok((p, _)) = self.path_of(env.fs, r) else {
                skipped.push(json!({ "ref": r, "why": "outside" }));
                continue;
            };
            let Some(item) = self.item_of(env.fs, &p) else {
                skipped.push(json!({ "ref": r, "why": "gone" }));
                continue;
            };
            if self.is_root_or_holds_one(&p) {
                skipped.push(json!({ "ref": r, "why": "system" }));
                continue;
            }
            let alone = left_alone(&item, env.now, true).filter(|_| !self.made.contains(&p));
            if item_never("files.rename", alone, false, false) {
                skipped.push(json!({ "ref": r, "why": alone.map(|a| a.why()).unwrap_or("system") }));
                continue;
            }
            let new = if item.stat.kind == EntryType::File { keep_extension(&item.name, new.trim()) } else { new.trim().to_string() };
            if !name_ok(&new) {
                skipped.push(json!({ "ref": r, "why": "system" }));
                continue;
            }
            if new == item.name {
                skipped.push(json!({ "ref": r, "why": "same" }));
                continue;
            }
            let dir = p.parent().map(Path::to_path_buf).unwrap_or_default();
            match self.move_into(env.fs, &p, &dir, &new) {
                Ok(t) => {
                    self.refs.moved(r, &t);
                    done.push(json!({ "ref": r, "from": item.name, "to": t.file_name().map(|n| n.to_string_lossy().to_string()) }));
                }
                Err(e) => skipped.push(json!({ "ref": r, "why": io_why(&e) })),
            }
        }
        ok(json!({ "done": done, "skipped": skipped }))
    }

    /// Organise (H.3): plan over the listing, then move.
    fn organise(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let (dir, root) = self.folder_of(env.fs, str_of(input, "folder")?)?;
        let by = str_of(input, "by")?;
        if by != "kind" && by != "month" {
            return Err("Not done: organise by kind or by month.".into());
        }
        (env.progress)(Progress { done: 0, of: 0, note: format!("Looking at {}", folder_title(&dir, &root)) });
        let list = match env.fs.list(&dir) {
            Ok(l) => l,
            Err(e) if e.kind() == io::ErrorKind::PermissionDenied || e.raw_os_error() == Some(1) => return Err(denied(&root.title)),
            Err(_) => return Err("Not done: that folder is gone.".into()),
        };
        let plan = plan_organise(&list, by == "month", env.now, &self.made);
        if !self.change_room(plan.moves.len() + plan.groups.len()) {
            return Err(TOO_MUCH.into());
        }
        let total = plan.moves.len();
        let mut folders: BTreeMap<String, (PathBuf, usize)> = BTreeMap::new();
        let mut moved = 0usize;
        let mut other_skips = 0usize;
        let mut i = 0usize;
        for (group, items) in &plan.by_group() {
            if (env.stopped)() {
                break;
            }
            (env.progress)(Progress { done: i, of: total, note: "Making folders".into() });
            let Ok((target, _)) = self.ensure_folder(env.fs, &dir, group) else {
                other_skips += items.len();
                continue;
            };
            for it in items {
                if (env.stopped)() {
                    break;
                }
                (env.progress)(Progress { done: i, of: total, note: "Moving files".into() });
                i += 1;
                match self.move_into(env.fs, &it.path, &target, &it.name) {
                    Ok(t) => {
                        moved += 1;
                        folders.entry(group.clone()).or_insert((target.clone(), 0)).1 += 1;
                        if let Some(r) = self.refs.back.get(&('e', it.path.clone())).cloned() {
                            self.refs.moved(&r, &t);
                        }
                    }
                    Err(_) => other_skips += 1,
                }
            }
        }
        (env.progress)(Progress { done: total, of: total, note: "Moving files".into() });
        let folders_json: Vec<Value> = folders
            .iter()
            .map(|(_, (path, count))| {
                let made = self.made.contains(path);
                let r = self.refs.add(if made { 'n' } else { 'e' }, path);
                json!({ "ref": r, "name": path.file_name().map(|n| n.to_string_lossy().to_string()), "count": count })
            })
            .collect();
        let s = &plan.skipped;
        ok(json!({ "folders": folders_json, "moved": moved, "skipped": { "recent": s.recent, "folders": s.folders, "apps": s.apps, "hidden": s.hidden, "other": s.other + other_skips } }))
    }

    fn rename_by_date(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let refs = refs_of(input, "refs")?;
        if !self.change_room(refs.len()) {
            return Err(TOO_MUCH.into());
        }
        let mut targets: Vec<(String, PathBuf, Item)> = Vec::new();
        let mut skipped = Vec::new();
        for r in &refs {
            let Ok((p, _)) = self.path_of(env.fs, r) else {
                skipped.push(json!({ "ref": r, "why": "outside" }));
                continue;
            };
            if self.is_root_or_holds_one(&p) {
                skipped.push(json!({ "ref": r, "why": "system" }));
                continue;
            }
            match self.item_of(env.fs, &p) {
                None => skipped.push(json!({ "ref": r, "why": "gone" })),
                Some(it) => match left_alone(&it, env.now, false) {
                    Some(why) => skipped.push(json!({ "ref": r, "why": why.why() })),
                    None if it.stat.kind != EntryType::File => skipped.push(json!({ "ref": r, "why": "system" })),
                    None => targets.push((r.clone(), p, it)),
                },
            }
        }
        let mut dates: Vec<Option<i64>> = Vec::with_capacity(targets.len());
        for chunk in targets.chunks(MDLS_BATCH) {
            let paths: Vec<PathBuf> = chunk.iter().map(|(_, p, _)| p.clone()).collect();
            let got = env.mdls.capture_dates(&paths);
            dates.extend((0..chunk.len()).map(|i| got.get(i).copied().flatten()));
        }
        let mut done = Vec::new();
        let n = targets.len();
        for (i, ((r, p, it), date)) in targets.into_iter().zip(dates).enumerate() {
            if (env.stopped)() {
                break;
            }
            (env.progress)(Progress { done: i, of: n, note: "Renaming".into() });
            let when = date.or(it.stat.birth).unwrap_or(it.stat.mtime);
            let ext = Path::new(&it.name).extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
            let new = format!("{}{ext}", date_name(when));
            if new == it.name {
                skipped.push(json!({ "ref": r, "why": "same" }));
                continue;
            }
            let dir = p.parent().map(Path::to_path_buf).unwrap_or_default();
            match self.move_into(env.fs, &p, &dir, &new) {
                Ok(t) => {
                    self.refs.moved(&r, &t);
                    done.push(json!({ "ref": r, "from": it.name, "to": t.file_name().map(|n| n.to_string_lossy().to_string()) }));
                }
                Err(e) => skipped.push(json!({ "ref": r, "why": io_why(&e) })),
            }
        }
        ok(json!({ "done": done, "skipped": skipped }))
    }

    /// Reserves the first free name for a new file in `dir` (an empty file made with `create_new`).
    fn reserve(&mut self, fs: &dyn FileSys, dir: &Path, name: &str) -> Result<PathBuf, String> {
        if self.new_files >= NEW_FILES || !self.change_room(1) {
            return Err(TOO_MUCH.into());
        }
        for cand in name_candidates(name) {
            let p = dir.join(&cand);
            match fs.write_new(&p, &[]) {
                Ok(()) => return Ok(p),
                Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("Not done: I couldn't save a file in that folder.".into()),
            }
        }
        Err("Not done: too many files with that name already.".into())
    }

    /// A new file she made: in the manifest, counted, its ref.
    fn made_file(&mut self, fs: &dyn FileSys, p: &Path) -> String {
        if let Ok(s) = fs.stat(p) {
            self.manifest.push(Op::New { path: p.to_path_buf(), ino: s.ino, size: s.size, mtime: s.mtime });
        }
        self.changes += 1;
        self.new_files += 1;
        self.made.insert(p.to_path_buf());
        let r = self.refs.add('n', p);
        self.outputs.push(r.clone());
        r
    }

    fn convert(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let r = str_of(input, "ref")?;
        let to = str_of(input, "to")?;
        let (p, _) = self.path_of(env.fs, r)?;
        let item = self.item_of(env.fs, &p).ok_or("Not done: that file is gone.")?;
        if item.stat.kind != EntryType::File && !(item.stat.kind == EntryType::Dir && ext_lower(&item.name) == "rtfd") {
            return Err("Not done: I can only convert files.".into());
        }
        if crate::guard::secret_file(&p) || crate::guard::password_export(&item.name) || crate::guard::runs_something(&p) {
            return Err("Not done: I never convert that kind of file.".into());
        }
        if item.stat.size > CONVERT_MAX_BYTES {
            return Err("Not done: that file is too big to convert.".into());
        }
        let from = ext_lower(&item.name);
        let plan = convert_plan(&from, to).ok_or_else(|| if from == to || (from == "jpg" && to == "jpeg") { format!("Not done: it's already a {}.", to.to_uppercase()) } else { "Not done: I can't convert that kind of file to that.".to_string() })?;
        (env.progress)(Progress { done: 0, of: 1, note: format!("Converting “{}”", crate::folder::clip_name(&item.name, 40)) });
        let stem = Path::new(&item.name).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Converted".into());
        let out_ext = if to == "jpeg" { "jpg" } else { to };
        let dir = p.parent().map(Path::to_path_buf).unwrap_or_default();
        let out = self.reserve(env.fs, &dir, &format!("{stem}.{out_ext}"))?;
        let done = match plan {
            ConvertPlan::Textutil => env.tools.textutil(&p, to, &out),
            ConvertPlan::Sips => env.tools.sips(&p, to, &out),
            ConvertPlan::DocToPdf => {
                let tmp = std::env::temp_dir().join(format!("brenda-convert-{}.html", crate::act::sha256_hex(&format!("{:?}{}", out, env.now))[..16].to_string()));
                let ok = env.tools.textutil(&p, "html", &tmp);
                let html = if ok { std::fs::read_to_string(&tmp).ok() } else { None };
                let _ = std::fs::remove_file(&tmp);
                match html.and_then(|h| env.tools.render_pdf(&h)) {
                    Some(bytes) if bytes.starts_with(b"%PDF") => std::fs::write(&out, bytes).is_ok(),
                    _ => false,
                }
            }
            ConvertPlan::PdfToText => match env.tools.pdf_text(&p) {
                Some(t) => std::fs::write(&out, t).is_ok(),
                None => false,
            },
            ConvertPlan::PdfToDocx => match env.tools.pdf_text(&p) {
                Some(t) => {
                    let html = paragraphs_html(&t);
                    let tmp = std::env::temp_dir().join(format!("brenda-convert-{}.html", crate::act::sha256_hex(&format!("{:?}{}", out, env.now))[..16].to_string()));
                    let ok = std::fs::write(&tmp, html).is_ok() && env.tools.textutil(&tmp, "docx", &out);
                    let _ = std::fs::remove_file(&tmp);
                    ok
                }
                None => false,
            },
        };
        let size = env.fs.stat(&out).map(|s| s.size).unwrap_or(0);
        if !done || size == 0 {
            let _ = env.fs.rmdir_empty(&out);
            let _ = std::fs::remove_file(&out);
            return Err("Not done: I couldn't convert that file.".into());
        }
        let nr = self.made_file(env.fs, &out);
        ok(json!({ "ref": nr, "name": out.file_name().map(|n| n.to_string_lossy().to_string()) }))
    }

    fn write_file(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let (dir, _) = self.folder_of(env.fs, str_of(input, "in")?)?;
        let name = str_of(input, "name")?;
        let format = str_of(input, "format")?;
        let ext = match format {
            "md" | "txt" | "csv" | "docx" | "pdf" => format,
            _ => return Err("Not done: I write md, txt, csv, docx or pdf.".into()),
        };
        if !name_ok(name) || !name.to_lowercase().ends_with(&format!(".{ext}")) || name.len() <= ext.len() + 1 {
            return Err("Not done: that file name isn't one I can use.".into());
        }
        (env.progress)(Progress { done: 0, of: 1, note: format!("Writing “{}”", crate::folder::clip_name(name, 40)) });
        let bytes: Vec<u8> = match format {
            "md" | "txt" | "csv" => {
                let content = str_of(input, "content")?;
                if content.chars().count() > WRITE_CHARS {
                    return Err("Not done: that's too long for one file.".into());
                }
                content.as_bytes().to_vec()
            }
            "pdf" => {
                let html = str_of(input, "html")?;
                env.tools.render_pdf(html).filter(|b| b.starts_with(b"%PDF")).ok_or("Not done: I couldn't make the PDF.")?
            }
            _ => Vec::new(),
        };
        let out = self.reserve(env.fs, &dir, name)?;
        let written = if format == "docx" {
            let html = str_of(input, "html").unwrap_or("");
            let tmp = std::env::temp_dir().join(format!("brenda-write-{}.html", &crate::act::sha256_hex(&format!("{:?}{}", out, env.now))[..16]));
            let ok = !html.is_empty() && std::fs::write(&tmp, html).is_ok() && env.tools.textutil(&tmp, "docx", &out);
            let _ = std::fs::remove_file(&tmp);
            ok
        } else {
            std::fs::write(&out, &bytes).is_ok()
        };
        if !written || env.fs.stat(&out).map(|s| s.size).unwrap_or(0) == 0 && !bytes.is_empty() || (format == "docx" && env.fs.stat(&out).map(|s| s.size).unwrap_or(0) == 0) {
            let _ = std::fs::remove_file(&out);
            return Err("Not done: I couldn't write that file.".into());
        }
        let nr = self.made_file(env.fs, &out);
        ok(json!({ "ref": nr, "name": out.file_name().map(|n| n.to_string_lossy().to_string()) }))
    }

    /// The Trash, only with the person's yes for exactly these refs (G.4).
    fn trash(&mut self, env: &mut Env, input: &Value, approval: Option<&Approval>) -> Result<Value, String> {
        let refs = refs_of(input, "refs")?;
        let Some(a) = approval else { return Err("Not done: I need your yes before anything goes to the Trash.".into()) };
        if a.count != refs.len() || a.refs_sha256 != refs_sha256(&refs) {
            return Err("Not done: that isn't what you said yes to.".into());
        }
        if !self.change_room(refs.len()) {
            return Err(TOO_MUCH.into());
        }
        let (mut done, mut skipped) = (0usize, Vec::new());
        for (i, r) in refs.iter().enumerate() {
            if (env.stopped)() {
                break;
            }
            (env.progress)(Progress { done: i, of: refs.len(), note: "Moving to the Trash".into() });
            let Ok((p, _)) = self.path_of(env.fs, r) else {
                skipped.push(json!({ "ref": r, "why": "outside" }));
                continue;
            };
            let Some(item) = self.item_of(env.fs, &p) else {
                skipped.push(json!({ "ref": r, "why": "gone" }));
                continue;
            };
            if self.is_root_or_holds_one(&p) {
                skipped.push(json!({ "ref": r, "why": "system" }));
                continue;
            }
            let alone = left_alone(&item, env.now, false);
            if item_never("files.trash", alone, false, false) {
                skipped.push(json!({ "ref": r, "why": alone.map(|a| a.why()).unwrap_or("system") }));
                continue;
            }
            match env.fs.trash(&p) {
                Ok(to) => {
                    self.manifest.push(Op::Trashed { from: p.clone(), to });
                    self.changes += 1;
                    done += 1;
                }
                Err(e) => skipped.push(json!({ "ref": r, "why": io_why(&e) })),
            }
        }
        ok(json!({ "done": done, "skipped": skipped }))
    }

    fn open(&mut self, env: &mut Env, input: &Value) -> Result<Value, String> {
        let r = str_of(input, "ref")?;
        let reveal = input.get("reveal").and_then(|v| v.as_bool()).unwrap_or(false);
        let (p, _) = self.path_of(env.fs, r)?;
        let item = self.item_of(env.fs, &p).ok_or("Not done: that's gone.")?;
        if !reveal && (crate::guard::runs_something(&p) || crate::guard::secret_file(&p) || ext_lower(&item.name) == "app" || item.stat.kind == EntryType::Symlink) {
            return Err("Not done: I never open that kind of file.".into());
        }
        // Review, 16 October 2026: a web page, a web archive, a calendar or contact card, an email or a web link does
        // something of its own when opened (its script runs, an import asks, a page loads), so a job only shows it in Finder.
        if !reveal && OPEN_ACTIVE.contains(&ext_lower(&item.name).as_str()) {
            return Err("Not done: I only show that kind of file in Finder. Call open with reveal true.".into());
        }
        if (env.open)(&p, reveal) {
            ok(json!({ "opened": true }))
        } else {
            Err("Not done: macOS wouldn't open it.".into())
        }
    }

    /// The Trash question as the person sees it (review, 16 October 2026): built here from the files themselves, never from
    /// the model's words for them. "Move 41 screenshots to the Trash?", or for a mix "Move 41 files to the Trash?" with
    /// "38 screenshots and 3 PDFs: “Invoice Q3.pdf”, “Screenshot 1.png” and 39 more." None when a ref is not one this
    /// job knows (then nothing is asked and nothing moves).
    pub fn trash_words(&self, refs: &[String]) -> Option<(String, String)> {
        if refs.is_empty() {
            return None;
        }
        let mut kinds: BTreeMap<(u8, &'static str, &'static str), usize> = BTreeMap::new();
        let mut names: Vec<String> = Vec::new();
        for r in refs {
            let p = self.refs.get(r)?;
            let name = p.file_name()?.to_string_lossy().to_string();
            let key = if p.is_dir() && !matches!(ext_lower(&name).as_str(), "pages" | "numbers" | "key" | "rtfd") { (14, "folder", "folders") } else { trash_noun(file_kind(&name)) };
            *kinds.entry(key).or_insert(0) += 1;
            if names.len() < 2 {
                names.push(format!("“{}”", crate::folder::clip_name(&name, 40)));
            }
        }
        let n = refs.len();
        let noun = |k: &(u8, &'static str, &'static str), c: usize| if c == 1 { k.1 } else { k.2 };
        let question = if kinds.len() == 1 {
            let k = kinds.keys().next().expect("one kind");
            format!("Move {n} {} to the Trash?", noun(k, n))
        } else {
            let things = if kinds.keys().any(|k| k.1 == "folder") { "items" } else { "files" };
            format!("Move {n} {things} to the Trash?")
        };
        let more = n.saturating_sub(names.len());
        let listed = match (names.len(), more) {
            (1, 0) => names[0].clone(),
            (2, 0) => format!("{} and {}", names[0], names[1]),
            (_, m) => format!("{} and {m} more", names.join(", ")),
        };
        let mix = if kinds.len() > 1 {
            let parts: Vec<String> = kinds.iter().map(|(k, c)| format!("{c} {}", noun(k, *c))).collect();
            let (last, rest) = parts.split_last().expect("two or more");
            format!("{} and {last}: ", rest.join(", "))
        } else {
            String::new()
        };
        Some((question, format!("{mix}{listed}. You can put them back from the Trash.")))
    }

    /// The folder a job changed things in, for Show in Finder on the done card (review, 16 October 2026: organising the
    /// Desktop moved 64 files into 7 folders and the card had nothing to show them with). The deepest folder holding every
    /// change, kept inside the allowed folder of the first change; None when nothing changed.
    pub fn job_folder(&self) -> Option<PathBuf> {
        let mut paths: Vec<PathBuf> = Vec::new();
        for op in &self.manifest.ops {
            match op {
                Op::Moved { from, to, .. } => {
                    paths.push(to.parent()?.to_path_buf());
                    paths.push(from.parent()?.to_path_buf());
                }
                Op::Made { path } | Op::New { path, .. } => paths.push(path.parent()?.to_path_buf()),
                Op::Trashed { from, .. } => paths.push(from.parent()?.to_path_buf()),
            }
        }
        let first = paths.first()?.clone();
        let root = self.roots.iter().find(|r| first.starts_with(&r.path))?.path.clone();
        let mut common = first;
        for p in &paths[1..] {
            while !p.starts_with(&common) {
                common = common.parent()?.to_path_buf();
            }
        }
        Some(if common.starts_with(&root) { common } else { root })
    }

    /// Names and folders of refs (the done card's new files, G.10).
    pub fn outputs_of(&self, refs: &[String]) -> Vec<(String, String, PathBuf)> {
        refs.iter()
            .filter_map(|r| {
                let p = self.refs.get(r)?;
                let name = p.file_name()?.to_string_lossy().to_string();
                let root = self.roots.iter().find(|x| p.starts_with(&x.path))?;
                Some((name, folder_title(p.parent().unwrap_or(p), root), p.clone()))
            })
            .collect()
    }
}

/// What the Trash question calls each kind (singular, plural), ordered as the question lists them.
fn trash_noun(k: FileKind) -> (u8, &'static str, &'static str) {
    match k {
        FileKind::Screenshot => (0, "screenshot", "screenshots"),
        FileKind::Image => (1, "picture", "pictures"),
        FileKind::Pdf => (2, "PDF", "PDFs"),
        FileKind::Document => (3, "document", "documents"),
        FileKind::Spreadsheet => (4, "spreadsheet", "spreadsheets"),
        FileKind::Presentation => (5, "presentation", "presentations"),
        FileKind::Video => (6, "video", "videos"),
        FileKind::Audio => (7, "audio file", "audio files"),
        FileKind::Archive => (8, "archive", "archives"),
        FileKind::Installer => (9, "installer", "installers"),
        FileKind::Code => (10, "code file", "code files"),
        FileKind::Design => (11, "design file", "design files"),
        FileKind::Other => (12, "file", "files"),
    }
}

/// Kinds a job only ever shows in Finder (review, 16 October 2026): opening them does something of its own.
pub const OPEN_ACTIVE: &[&str] = &["html", "htm", "xhtml", "shtml", "svg", "webarchive", "ics", "vcf", "eml", "emlx", "webloc", "inetloc", "url", "fileloc", "mobileconfig", "terminal", "command", "tool", "scpt", "workflow", "xml", "plist"];

/// A folder's title as the model and the person see it: the root's title, or the folder's own name.
pub fn folder_title(dir: &Path, root: &Root) -> String {
    if dir == root.path {
        root.title.clone()
    } else {
        dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| root.title.clone())
    }
}

fn iso(unix: i64) -> String {
    let (y, m, d, h, mi, s) = local_parts(unix);
    format!("{y:04}-{m:02}-{d:02}T{h:02}:{mi:02}:{s:02}")
}

/// Every string in a result kept under the result cap (G.5: lists at 500, text at 20,000, the whole at 120,000).
fn cap_value(v: &mut Value) {
    if serde_json::to_string(v).map(|s| s.chars().count()).unwrap_or(0) <= RESULT_CHARS {
        return;
    }
    if let Some(items) = v.get_mut("items").and_then(|i| i.as_array_mut()) {
        while serde_json::to_string(&*items).map(|s| s.chars().count()).unwrap_or(0) > RESULT_CHARS - 2_000 && !items.is_empty() {
            items.pop();
        }
    }
    if let Some(t) = v.get_mut("text").and_then(|t| t.as_str().map(String::from)) {
        let cut: String = t.chars().take(READ_CHARS).collect();
        v["text"] = json!(cut);
        v["truncated"] = json!(true);
    }
}

fn paragraphs_html(text: &str) -> String {
    let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
    let body: String = text.split("\n\n").map(|p| format!("<p>{}</p>", esc(p.trim()))).collect();
    format!("<!doctype html><html><head><meta charset=\"utf-8\"></head><body>{body}</body></html>")
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConvertPlan {
    Textutil,
    DocToPdf,
    Sips,
    PdfToText,
    PdfToDocx,
}

const TEXT_DOCS: &[&str] = &["docx", "doc", "rtf", "rtfd", "odt", "html", "htm", "webarchive", "txt", "md"];
const PICTURES: &[&str] = &["png", "jpg", "jpeg", "heic", "heif", "gif", "tiff", "tif", "bmp", "webp"];

/// How a file converts (H.5), or None when it can't (or already is that format).
pub fn convert_plan(from: &str, to: &str) -> Option<ConvertPlan> {
    let same = from == to || (to == "jpeg" && (from == "jpg" || from == "jpeg"));
    if same {
        return None;
    }
    if TEXT_DOCS.contains(&from) {
        return match to {
            "pdf" => Some(ConvertPlan::DocToPdf),
            "docx" | "rtf" | "txt" => Some(ConvertPlan::Textutil),
            _ => None,
        };
    }
    if from == "pdf" {
        return match to {
            "txt" => Some(ConvertPlan::PdfToText),
            "docx" => Some(ConvertPlan::PdfToDocx),
            _ => None,
        };
    }
    if PICTURES.contains(&from) {
        return matches!(to, "pdf" | "jpeg" | "png").then_some(ConvertPlan::Sips);
    }
    None
}

// ---- organise (H.3), pure planning -------------------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Skips {
    pub recent: usize,
    pub folders: usize,
    pub apps: usize,
    pub hidden: usize,
    pub other: usize,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct OrganisePlan {
    /// (folder name, item), in listing order.
    pub moves: Vec<(String, Item)>,
    pub groups: Vec<String>,
    pub skipped: Skips,
}

impl OrganisePlan {
    pub fn by_group(&self) -> Vec<(String, Vec<Item>)> {
        self.groups.iter().map(|g| (g.clone(), self.moves.iter().filter(|(x, _)| x == g).map(|(_, i)| i.clone()).collect())).collect()
    }
}

/// Which items move where (H.3): files directly in the folder (document packages move as files); folders, apps, other
/// bundles, libraries, hidden names, `.localized`, links, files changed in the last 300 s, and anything she made in this
/// job stay. A file named like a category folder stays a file (the folder becomes "Images 2" when made).
pub fn plan_organise(list: &[Item], by_month: bool, now: i64, made: &HashSet<PathBuf>) -> OrganisePlan {
    let mut plan = OrganisePlan::default();
    let category_names: HashSet<String> = FileKind::ALL.iter().map(|k| k.folder().to_string()).collect();
    for it in list {
        if made.contains(&it.path) {
            plan.skipped.other += 1;
            continue;
        }
        if let Some(why) = left_alone(it, now, false) {
            match why {
                LeftAlone::Hidden => plan.skipped.hidden += 1,
                LeftAlone::Recent => plan.skipped.recent += 1,
                LeftAlone::App => plan.skipped.apps += 1,
                LeftAlone::Folder => plan.skipped.folders += 1,
                LeftAlone::System | LeftAlone::Link => plan.skipped.other += 1,
            }
            continue;
        }
        if it.stat.kind == EntryType::Dir && category_names.contains(&it.name) {
            plan.skipped.folders += 1;
            continue;
        }
        // A file called like a category folder ("Images") stays put, and the folder becomes "Images 2" (H.3).
        if it.stat.kind != EntryType::Dir && category_names.iter().any(|c| c.eq_ignore_ascii_case(&it.name)) {
            plan.skipped.other += 1;
            continue;
        }
        let group = if by_month { month_folder(it.stat.mtime) } else { file_kind(&it.name).folder().to_string() };
        if !plan.groups.contains(&group) {
            plan.groups.push(group.clone());
        }
        plan.moves.push((group, it.clone()));
    }
    plan
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::cell::RefCell;

    pub struct FakeTools {
        pub calls: RefCell<Vec<String>>,
    }

    impl FakeTools {
        pub fn new() -> Self {
            FakeTools { calls: RefCell::new(vec![]) }
        }
    }

    impl Tools for FakeTools {
        fn textutil(&self, src: &Path, to: &str, out: &Path) -> bool {
            self.calls.borrow_mut().push(format!("textutil {to} {}", src.file_name().unwrap().to_string_lossy()));
            let body = if to == "html" { "<p>hello</p>".to_string() } else { format!("{to} of {}", src.display()) };
            std::fs::write(out, body).is_ok()
        }
        fn sips(&self, src: &Path, format: &str, out: &Path) -> bool {
            self.calls.borrow_mut().push(format!("sips {format} {}", src.file_name().unwrap().to_string_lossy()));
            std::fs::write(out, format!("{format} picture")).is_ok()
        }
        fn render_pdf(&self, html: &str) -> Option<Vec<u8>> {
            self.calls.borrow_mut().push(format!("render {}", html.len()));
            Some(b"%PDF-1.7 fake".to_vec())
        }
        fn pdf_text(&self, src: &Path) -> Option<String> {
            self.calls.borrow_mut().push(format!("pdftext {}", src.file_name().unwrap().to_string_lossy()));
            Some("page one\n\npage two".into())
        }
    }

    pub struct FakeMdls(pub Vec<Option<i64>>);

    impl Mdls for FakeMdls {
        fn capture_dates(&self, paths: &[PathBuf]) -> Vec<Option<i64>> {
            (0..paths.len()).map(|i| self.0.get(i).copied().flatten()).collect()
        }
    }

    /// A temp tree: <tmp>/home/{Desktop,Documents,Downloads}, and <tmp>/Trash.
    pub struct Tree {
        pub base: PathBuf,
        pub home: PathBuf,
        pub trash: PathBuf,
    }

    impl Tree {
        pub fn new(tag: &str) -> Tree {
            let base = std::env::temp_dir().join(format!("brenda-fileops-{tag}-{}-{}", std::process::id(), crate::act::sha256_hex(&format!("{:?}", std::time::SystemTime::now()))[..8].to_string()));
            let _ = std::fs::remove_dir_all(&base);
            let home = base.join("home");
            for d in ["Desktop", "Documents", "Downloads"] {
                std::fs::create_dir_all(home.join(d)).unwrap();
            }
            let trash = base.join("Trash");
            std::fs::create_dir_all(&trash).unwrap();
            let base = std::fs::canonicalize(&base).unwrap();
            Tree { home: base.join("home"), trash: base.join("Trash"), base }
        }

        pub fn file(&self, rel: &str, body: &str) -> PathBuf {
            let p = self.home.join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, body).unwrap();
            p
        }

        pub fn roots(&self) -> Vec<Root> {
            ["Desktop", "Documents", "Downloads"].iter().map(|d| Root { path: self.home.join(d), title: d.to_string(), source: "named", name: d.to_lowercase() }).collect()
        }
    }

    impl Drop for Tree {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    /// "Now" well after the files were made, so none counts as changed in the last five minutes.
    pub fn later() -> i64 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64 + 3_600
    }

    pub struct Run {
        pub fs: RealFileSys,
        pub tools: FakeTools,
        pub mdls: FakeMdls,
        pub opened: Vec<(PathBuf, bool)>,
        pub progress: Vec<Progress>,
        pub now: i64,
        pub stop_at: Option<usize>,
    }

    impl Run {
        pub fn new(t: &Tree) -> Run {
            Run { fs: RealFileSys::with_trash(&t.trash), tools: FakeTools::new(), mdls: FakeMdls(vec![]), opened: vec![], progress: vec![], now: later(), stop_at: None }
        }

        pub fn call(&mut self, job: &mut FilesJob, name: &str, input: Value, approval: Option<&Approval>) -> CallResult {
            let mut opened = std::mem::take(&mut self.opened);
            let mut progress = std::mem::take(&mut self.progress);
            let stop_at = self.stop_at;
            let counter = std::cell::Cell::new(0usize);
            let stopped = || {
                counter.set(counter.get() + 1);
                stop_at.is_some_and(|n| counter.get() > n)
            };
            let r = {
                let mut prog = |p: Progress| progress.push(p);
                let mut open = |p: &Path, reveal: bool| {
                    opened.push((p.to_path_buf(), reveal));
                    true
                };
                let mut env = Env { fs: &self.fs, tools: &self.tools, mdls: &self.mdls, now: self.now, stopped: &stopped, progress: &mut prog, open: &mut open };
                job.run_call(&mut env, "toolu_1", name, &input, approval)
            };
            self.opened = opened;
            self.progress = progress;
            r
        }
    }

    pub fn job(t: &Tree) -> FilesJob {
        FilesJob::new(t.roots(), vec![], Manifest::memory())
    }

    fn names_in(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().to_string()).collect();
        v.sort();
        v
    }

    #[test]
    fn calls_are_classified() {
        assert_eq!(call_kind("list_files"), "files.list");
        assert_eq!(call_kind("write_file"), "files.write");
        assert_eq!(crate::risk::classify(&call_kind("trash"), &[]).class, crate::risk::Class::Ask);
        assert_eq!(crate::risk::classify(&call_kind("run_shell"), &[]).class, crate::risk::Class::Never);
        assert!(item_never("files.move", Some(LeftAlone::Recent), false, false));
        assert!(item_never("files.move", None, true, false));
        assert!(!item_never("files.copy", None, true, false), "a copy may cross disks");
        assert!(item_never("files.read", None, false, true));
        assert!(!item_never("files.move", None, false, false));
        let t = Tree::new("classify");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        let r = run.call(&mut job, "run_shell", json!({ "command": "rm -rf ~" }), None);
        assert_eq!(r.error.as_deref(), Some("Not done: I don't know how to run shell."));
    }

    #[test]
    fn kinds_of_file() {
        assert_eq!(file_kind("Screenshot 2026-10-12 at 14.03.22.png"), FileKind::Screenshot);
        assert_eq!(file_kind("CleanShot 2026.jpg"), FileKind::Screenshot);
        assert_eq!(file_kind("holiday.HEIC"), FileKind::Image);
        assert_eq!(file_kind("Q3 deck.key"), FileKind::Presentation);
        assert_eq!(file_kind("budget.numbers"), FileKind::Spreadsheet);
        assert_eq!(file_kind("setup.dmg"), FileKind::Installer);
        assert_eq!(file_kind("main.rs"), FileKind::Code);
        assert_eq!(file_kind("poster.fig"), FileKind::Design);
        assert_eq!(file_kind("README"), FileKind::Other);
        assert!(kind_matches(FileKind::Screenshot, &["image".into()]));
        assert!(!kind_matches(FileKind::Pdf, &["image".into()]));
    }

    #[test]
    fn names_never_replace() {
        assert_eq!(&name_candidates("a.pdf")[..3], &["a.pdf", "a 2.pdf", "a 3.pdf"]);
        assert_eq!(&name_candidates("Images")[..2], &["Images", "Images 2"]);
        assert!(name_ok("Invoices summary.md"));
        for bad in ["", ".hidden", "a/b", "a:b", "Thing.app", "run.sh", "keys.pem", "passwords.csv", " x"] {
            assert!(!name_ok(bad), "{bad:?}");
        }
        assert!(ref_ok("e12") && ref_ok("c1") && !ref_ok("x1") && !ref_ok("e") && !ref_ok("e1234567") && !ref_ok("e1a"));
    }

    #[test]
    fn organise_by_kind() {
        let t = Tree::new("bykind");
        t.file("Desktop/IMG_1.HEIC", "i");
        t.file("Desktop/Screenshot 2026-10-12 at 10.00.00.png", "s");
        t.file("Desktop/report.pdf", "p");
        t.file("Desktop/notes.txt", "n");
        t.file("Desktop/deck.key", "k");
        t.file("Desktop/mystery.xyz", "x");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        let r = run.call(&mut job, "organise", json!({ "folder": "f1", "by": "kind" }), None);
        assert!(r.ok, "{r:?}");
        let out = r.out.unwrap();
        assert_eq!(out["moved"], 6);
        assert_eq!(names_in(&t.home.join("Desktop")), ["Documents", "Images", "Other", "PDFs", "Presentations", "Screenshots"]);
        assert_eq!(names_in(&t.home.join("Desktop/Images")), ["IMG_1.HEIC"]);
        assert_eq!(out["folders"].as_array().unwrap().len(), 6);
        assert!(run.progress.iter().any(|p| p.note == "Moving files"));
    }

    #[test]
    fn organise_by_month() {
        let t = Tree::new("bymonth");
        let a = t.file("Downloads/a.pdf", "a");
        t.file("Downloads/b.pdf", "b");
        // a.pdf from March 2025.
        let when = 1_741_000_000i64;
        set_mtime(&a, when);
        let mut job = job(&t);
        let mut run = Run::new(&t);
        let r = run.call(&mut job, "organise", json!({ "folder": "f3", "by": "month" }), None);
        assert!(r.ok, "{r:?}");
        let month = month_folder(when);
        assert!(names_in(&t.home.join("Downloads")).contains(&month));
        assert_eq!(names_in(&t.home.join("Downloads").join(&month)), ["a.pdf"]);
    }

    pub fn set_mtime(p: &Path, unix: i64) {
        let f = std::fs::File::options().write(true).open(p).unwrap();
        f.set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(unix as u64)).unwrap();
    }

    #[test]
    fn organise_skips() {
        let t = Tree::new("skips");
        t.file("Desktop/.hidden.txt", "h");
        t.file("Desktop/.localized", "");
        std::fs::create_dir_all(t.home.join("Desktop/Projects")).unwrap();
        std::fs::create_dir_all(t.home.join("Desktop/Thing.app/Contents")).unwrap();
        std::fs::create_dir_all(t.home.join("Desktop/Photos Library.photoslibrary")).unwrap();
        std::fs::create_dir_all(t.home.join("Desktop/Essay.pages")).unwrap();
        t.file("Desktop/old.txt", "o");
        #[cfg(unix)]
        std::os::unix::fs::symlink(t.home.join("Documents"), t.home.join("Desktop/link")).unwrap();
        let mut job = job(&t);
        let mut run = Run::new(&t);
        let r = run.call(&mut job, "organise", json!({ "folder": "f1", "by": "kind" }), None);
        let out = r.out.unwrap();
        assert_eq!(out["moved"], 2, "old.txt and the Pages document (a package moves as a file)");
        assert_eq!(out["skipped"]["hidden"], 2);
        assert_eq!(out["skipped"]["folders"], 1);
        assert_eq!(out["skipped"]["apps"], 1);
        assert!(out["skipped"]["other"].as_u64().unwrap() >= 2, "the library and the link");
        assert!(t.home.join("Desktop/Documents/Essay.pages").exists());
        assert!(t.home.join("Desktop/Thing.app").exists() && t.home.join("Desktop/Projects").exists());
        // Recent: "now" is the file's own time.
        let t2 = Tree::new("recent");
        t2.file("Desktop/new.txt", "n");
        let mut job2 = job_of(&t2);
        let mut run2 = Run::new(&t2);
        run2.now = later() - 3_600;
        let out = run2.call(&mut job2, "organise", json!({ "folder": "f1", "by": "kind" }), None).out.unwrap();
        assert_eq!(out["moved"], 0);
        assert_eq!(out["skipped"]["recent"], 1);
        // What she made in this job stays put.
        let t3 = Tree::new("ownoutputs");
        t3.file("Desktop/a.txt", "a");
        let mut job3 = job_of(&t3);
        let mut run3 = Run::new(&t3);
        let w = run3.call(&mut job3, "write_file", json!({ "in": "f1", "name": "Desktop summary.md", "format": "md", "content": "# Hi" }), None);
        assert!(w.ok, "{w:?}");
        let out = run3.call(&mut job3, "organise", json!({ "folder": "f1", "by": "kind" }), None).out.unwrap();
        assert_eq!(out["moved"], 1);
        assert!(t3.home.join("Desktop/Desktop summary.md").exists());
    }

    fn job_of(t: &Tree) -> FilesJob {
        job(t)
    }

    #[test]
    fn organise_reuses_existing_folder() {
        let t = Tree::new("reuse");
        std::fs::create_dir_all(t.home.join("Desktop/PDFs")).unwrap();
        t.file("Desktop/PDFs/old.pdf", "o");
        t.file("Desktop/new.pdf", "n");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        let out = run.call(&mut job, "organise", json!({ "folder": "f1", "by": "kind" }), None).out.unwrap();
        assert_eq!(out["moved"], 1);
        assert_eq!(names_in(&t.home.join("Desktop/PDFs")), ["new.pdf", "old.pdf"]);
        assert_eq!(job.manifest.ops.iter().filter(|o| matches!(o, Op::Made { .. })).count(), 0, "an existing folder is used as it is");
    }

    #[test]
    fn organise_file_named_like_folder() {
        let t = Tree::new("likefolder");
        t.file("Desktop/Images", "a file called Images");
        t.file("Desktop/cat.jpg", "c");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        let out = run.call(&mut job, "organise", json!({ "folder": "f1", "by": "kind" }), None).out.unwrap();
        assert!(t.home.join("Desktop/Images 2/cat.jpg").exists(), "{out}");
        assert!(t.home.join("Desktop/Images").is_file());
    }

    #[test]
    fn never_replaces() {
        let t = Tree::new("noreplace");
        let a = t.file("Desktop/a.txt", "desktop");
        t.file("Documents/a.txt", "documents");
        let fs = RealFileSys::with_trash(&t.trash);
        let e = fs.rename_noreplace(&a, &t.home.join("Documents/a.txt")).unwrap_err();
        assert_eq!(e.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read_to_string(t.home.join("Documents/a.txt")).unwrap(), "documents");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        let l = run.call(&mut job, "list_files", json!({ "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] }), None);
        assert!(l.ok);
        let r = run.call(&mut job, "move", json!({ "refs": ["e1"], "to": "f2" }), None);
        assert!(r.ok, "{r:?}");
        assert_eq!(r.out.as_ref().unwrap()["done"][0]["to"], "a 2.txt");
        assert_eq!(std::fs::read_to_string(t.home.join("Documents/a.txt")).unwrap(), "documents");
        assert_eq!(std::fs::read_to_string(t.home.join("Documents/a 2.txt")).unwrap(), "desktop");
    }

    #[test]
    fn refs_outside_refused() {
        let t = Tree::new("outside");
        let outside = t.base.join("elsewhere");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("secret.txt"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, t.home.join("Desktop/sneaky")).unwrap();
        let mut job = job(&t);
        let mut run = Run::new(&t);
        // An unknown ref.
        let r = run.call(&mut job, "read_text", json!({ "ref": "e99" }), None);
        assert_eq!(r.error.as_deref(), Some(NOT_KNOWN));
        // A ref that was never handed out for a path outside.
        job.refs.add('e', &outside.join("secret.txt"));
        let r = run.call(&mut job, "read_text", json!({ "ref": "e1" }), None);
        assert!(!r.ok && r.error.unwrap().contains("only work in"));
        // A link inside a root is never followed.
        let l = run.call(&mut job, "list_files", json!({ "folder": "f1", "recursive": true, "kinds": [], "since_days": 0, "words": [] }), None).out.unwrap();
        assert_eq!(l["total"], 0);
        assert_eq!(l["skipped"]["system"], 1);
        let r = run.call(&mut job, "move", json!({ "refs": ["e1"], "to": "f2" }), None).out.unwrap();
        assert_eq!(r["skipped"][0]["why"], "outside");
        // A bad ref shape.
        let r = run.call(&mut job, "move", json!({ "refs": ["../x"], "to": "f2" }), None);
        assert_eq!(r.error.as_deref(), Some(NOT_KNOWN));
    }

    #[test]
    fn rename_keeps_extension() {
        assert_eq!(keep_extension("IMG_1.HEIC", "Beach"), "Beach.HEIC");
        assert_eq!(keep_extension("a.pdf", "Invoice.pdf"), "Invoice.pdf");
        assert_eq!(keep_extension("README", "Read me"), "Read me");
        let t = Tree::new("rename");
        t.file("Desktop/IMG_1.HEIC", "i");
        t.file("Desktop/Beach.HEIC", "taken");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        run.call(&mut job, "list_files", json!({ "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": ["img"] }), None);
        let r = run.call(&mut job, "rename", json!({ "items": [{ "ref": "e1", "name": "Beach" }] }), None).out.unwrap();
        assert_eq!(r["done"][0]["to"], "Beach 2.HEIC");
        let r = run.call(&mut job, "rename", json!({ "items": [{ "ref": "e1", "name": "../escape" }] }), None).out.unwrap();
        assert_eq!(r["skipped"][0]["why"], "system", "a name with a slash is never used");
    }

    #[test]
    fn rename_by_date() {
        let t = Tree::new("bydate");
        let a = t.file("Desktop/IMG_1.jpg", "a");
        let b = t.file("Desktop/IMG_2.JPG", "b");
        set_mtime(&b, 1_760_000_000);
        let _ = a;
        let mut job = job(&t);
        let mut run = Run::new(&t);
        run.mdls = FakeMdls(vec![Some(1_760_277_802), None]);
        run.call(&mut job, "list_files", json!({ "folder": "f1", "recursive": false, "kinds": ["image"], "since_days": 0, "words": [] }), None);
        let r = run.call(&mut job, "rename_by_date", json!({ "refs": ["e1", "e2"] }), None).out.unwrap();
        let done = r["done"].as_array().unwrap();
        assert_eq!(done.len(), 2);
        assert_eq!(done[0]["to"], format!("{}.jpg", date_name(1_760_277_802)));
        let second = done[1]["to"].as_str().unwrap();
        assert!(second.ends_with(".JPG"), "the extension stays as it was: {second}");
    }

    #[test]
    fn convert_matrix() {
        assert_eq!(convert_plan("docx", "pdf"), Some(ConvertPlan::DocToPdf));
        assert_eq!(convert_plan("md", "docx"), Some(ConvertPlan::Textutil));
        assert_eq!(convert_plan("pdf", "txt"), Some(ConvertPlan::PdfToText));
        assert_eq!(convert_plan("pdf", "docx"), Some(ConvertPlan::PdfToDocx));
        assert_eq!(convert_plan("heic", "jpeg"), Some(ConvertPlan::Sips));
        assert_eq!(convert_plan("png", "pdf"), Some(ConvertPlan::Sips));
        assert_eq!(convert_plan("pdf", "pdf"), None);
        assert_eq!(convert_plan("jpg", "jpeg"), None);
        assert_eq!(convert_plan("zip", "pdf"), None);
        assert_eq!(convert_plan("pdf", "png"), None);
        let t = Tree::new("convert");
        t.file("Desktop/letter.docx", "d");
        t.file("Desktop/photo.heic", "p");
        t.file("Desktop/paper.pdf", "%PDF");
        t.file("Desktop/keys.pem", "k");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        run.call(&mut job, "list_files", json!({ "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] }), None);
        let refs: HashMap<String, String> = job.refs.map.iter().filter(|(k, _)| k.starts_with('e')).map(|(k, p)| (p.file_name().unwrap().to_string_lossy().to_string(), k.clone())).collect();
        assert!(!refs.contains_key("keys.pem"), "a secret is never listed");
        let r = run.call(&mut job, "convert", json!({ "ref": refs["letter.docx"], "to": "pdf" }), None);
        assert!(r.ok, "{r:?}");
        assert!(t.home.join("Desktop/letter.pdf").exists());
        let r = run.call(&mut job, "convert", json!({ "ref": refs["photo.heic"], "to": "jpeg" }), None);
        assert_eq!(r.out.unwrap()["name"], "photo.jpg");
        let r = run.call(&mut job, "convert", json!({ "ref": refs["paper.pdf"], "to": "pdf" }), None);
        assert_eq!(r.error.as_deref(), Some("Not done: it's already a PDF."));
        let r = run.call(&mut job, "convert", json!({ "ref": refs["paper.pdf"], "to": "txt" }), None);
        assert!(r.ok);
        assert_eq!(std::fs::read_to_string(t.home.join("Desktop/paper.txt")).unwrap(), "page one\n\npage two");
        // A second conversion never replaces the first.
        let r = run.call(&mut job, "convert", json!({ "ref": refs["letter.docx"], "to": "pdf" }), None);
        assert_eq!(r.out.unwrap()["name"], "letter 2.pdf");
        assert_eq!(job.outputs.len(), 4);
    }

    #[test]
    fn write_new() {
        let t = Tree::new("write");
        t.file("Documents/Invoices summary.md", "already");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        let r = run.call(&mut job, "write_file", json!({ "in": "f2", "name": "Invoices summary.md", "format": "md", "content": "# New" }), None);
        assert_eq!(r.out.unwrap()["name"], "Invoices summary 2.md");
        assert_eq!(std::fs::read_to_string(t.home.join("Documents/Invoices summary.md")).unwrap(), "already");
        let r = run.call(&mut job, "write_file", json!({ "in": "f2", "name": "list.csv", "format": "md", "content": "x" }), None);
        assert!(!r.ok, "the name ends with its format's extension");
        let r = run.call(&mut job, "write_file", json!({ "in": "f2", "name": "Notes.pdf", "format": "pdf", "content": "", "html": "<h1>Hi</h1>" }), None);
        assert!(r.ok, "{r:?}");
        assert!(std::fs::read(t.home.join("Documents/Notes.pdf")).unwrap().starts_with(b"%PDF"));
        // Ten new files a job at most.
        for i in 0..20 {
            let r = run.call(&mut job, "write_file", json!({ "in": "f2", "name": format!("n{i}.txt"), "format": "txt", "content": "x" }), None);
            if !r.ok {
                assert_eq!(r.error.as_deref(), Some(TOO_MUCH));
                assert_eq!(job.new_files, NEW_FILES);
                return;
            }
        }
        panic!("the new-file limit never held");
    }

    #[test]
    fn trash_needs_approval_hash() {
        let t = Tree::new("trash");
        t.file("Desktop/Screenshot 1.png", "1");
        t.file("Desktop/Screenshot 2.png", "2");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        run.call(&mut job, "list_files", json!({ "folder": "f1", "recursive": false, "kinds": ["screenshot"], "since_days": 0, "words": [] }), None);
        let refs = vec!["e1".to_string(), "e2".to_string()];
        let r = run.call(&mut job, "trash", json!({ "refs": refs, "what": "screenshots" }), None);
        assert!(!r.ok, "no yes, nothing moves");
        let wrong = Approval { count: 1, refs_sha256: refs_sha256(&refs[..1]) };
        assert!(!run.call(&mut job, "trash", json!({ "refs": refs, "what": "screenshots" }), Some(&wrong)).ok);
        assert_eq!(names_in(&t.home.join("Desktop")).len(), 2);
        let yes = Approval { count: 2, refs_sha256: refs_sha256(&refs) };
        let r = run.call(&mut job, "trash", json!({ "refs": refs, "what": "screenshots" }), Some(&yes));
        assert_eq!(r.out.unwrap()["done"], 2);
        assert!(names_in(&t.home.join("Desktop")).is_empty());
        assert_eq!(names_in(&t.trash).len(), 2);
        // Undo brings them back.
        let c = undo(&run.fs, &job.manifest.ops);
        assert_eq!(c, UndoCount { restored: 2, skipped: 0 });
        assert_eq!(names_in(&t.home.join("Desktop")).len(), 2);
    }

    #[test]
    fn undo_round_trip() {
        let t = Tree::new("roundtrip");
        let kinds = ["pdf", "jpg", "txt", "key", "mp3", "zip", "docx", "xlsx", "fig", "rs"];
        for i in 0..100 {
            t.file(&format!("Desktop/file {i:03}.{}", kinds[i % kinds.len()]), &format!("{i}"));
        }
        let before = names_in(&t.home.join("Desktop"));
        let dir = t.base.join("undo");
        let head = ManifestHead { job_id: "0b5ad1f6-0a8e-4c55-9a3c-6b8d5d1e2f30".into(), title: "Organise your Desktop".into(), at: later(), undone_at: None };
        let manifest = Manifest::create(&dir, &head).unwrap();
        let mut job = FilesJob::new(t.roots(), vec![], manifest);
        let mut run = Run::new(&t);
        let started = std::time::Instant::now();
        let out = run.call(&mut job, "organise", json!({ "folder": "f1", "by": "kind" }), None).out.unwrap();
        assert_eq!(out["moved"], 100);
        assert!(started.elapsed() < std::time::Duration::from_secs(30));
        assert_ne!(names_in(&t.home.join("Desktop")), before);
        // The manifest on disk is the one Undo reads (after a restart too).
        let path = job.manifest.path().unwrap().to_path_buf();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let (h, ops) = read_manifest(&path).unwrap();
        assert_eq!(h.title, "Organise your Desktop");
        assert_eq!(ops.len(), 109, "100 moves and 9 folders (txt and docx share Documents)");
        let c = undo(&run.fs, &ops);
        assert_eq!(c, UndoCount { restored: 100, skipped: 0 }, "the 100 files; the 9 folders she made are gone and not counted");
        assert_eq!(names_in(&t.home.join("Desktop")), before, "every file back, folders gone");
        mark_undone(&path, later()).unwrap();
        assert!(read_manifest(&path).unwrap().0.undone_at.is_some());
    }

    #[test]
    fn undo_skips_changed() {
        let t = Tree::new("undochanged");
        t.file("Desktop/a.txt", "a");
        t.file("Desktop/b.txt", "b");
        let mut job = job(&t);
        let mut run = Run::new(&t);
        run.call(&mut job, "organise", json!({ "folder": "f1", "by": "kind" }), None);
        // The person edits one file after the job.
        std::fs::write(t.home.join("Desktop/Documents/a.txt"), "changed since").unwrap();
        let c = undo(&run.fs, &job.manifest.ops);
        assert_eq!(c, UndoCount { restored: 1, skipped: 1 }, "the changed file stays, and so does its folder (not empty, not counted)");
        assert!(t.home.join("Desktop/b.txt").exists());
        assert!(t.home.join("Desktop/Documents/a.txt").exists());
        // A name taken since goes back as "… 2".
        let t2 = Tree::new("undotaken");
        t2.file("Desktop/c.txt", "c");
        let mut job2 = job_of(&t2);
        let mut run2 = Run::new(&t2);
        run2.call(&mut job2, "organise", json!({ "folder": "f1", "by": "kind" }), None);
        t2.file("Desktop/c.txt", "a new one");
        undo(&run2.fs, &job2.manifest.ops);
        assert_eq!(names_in(&t2.home.join("Desktop")), ["c 2.txt", "c.txt"]);
    }

    #[test]
    fn added_folders() {
        let home = Path::new("/Users/ada");
        assert!(added_folder_ok(Path::new("/Users/ada/Projects"), home));
        assert!(added_folder_ok(Path::new("/Volumes/Work/Clients"), home));
        // Review, 16 October 2026: a folder holding the home folder (`/Users`) and the same folders in another case.
        for bad in ["/", "/Users/ada", "/System/Library", "/Library/Fonts", "/Users/ada/Library/Mail", "/Applications", "/Users/ada/.ssh", "relative", "/Users/ada/../bob", "/Users", "/users", "/USERS/ADA", "/users/ada/library/Mail", "/system/Library"] {
            assert!(!added_folder_ok(Path::new(bad), home), "{bad}");
        }
    }

    /// Review, 16 October 2026 (safety-8): textutil never loads a file's own resources.
    #[test]
    fn textutil_never_loads() {
        let a = textutil_args(Path::new("/x/page.html"), "docx", Path::new("/x/page.docx"));
        assert_eq!(a, ["-noload", "-timeout", "5", "-convert", "docx", "-output", "/x/page.docx", "/x/page.html"]);
    }

    /// Review, 16 October 2026 (safety-7): the allowed folders themselves (and a folder holding one) never move, get
    /// renamed or go to the Trash.
    #[test]
    fn roots_stay_put() {
        let t = Tree::new("roots");
        std::fs::create_dir_all(t.home.join("Desktop/Work/Client")).unwrap();
        let mut roots = t.roots();
        roots.push(Root { path: t.home.join("Desktop/Work/Client"), title: "Client".into(), source: "pointed", name: "Client".into() });
        let mut j = FilesJob::new(roots, vec![], Manifest::memory());
        let mut run = Run::new(&t);
        // f2 is Documents, f4 the pointed folder; e1 lists Work (which holds it).
        run.call(&mut j, "list_files", json!({ "folder": "f1", "recursive": false, "kinds": [], "since_days": 0, "words": [] }), None);
        let r = run.call(&mut j, "rename", json!({ "items": [{ "ref": "f4", "name": "Other" }, { "ref": "f2", "name": "Docs" }] }), None);
        assert_eq!(r.out.as_ref().unwrap()["done"].as_array().unwrap().len(), 0, "{r:?}");
        let r = run.call(&mut j, "move", json!({ "refs": ["f4", "e1"], "to": "f3" }), None);
        assert_eq!(r.out.as_ref().unwrap()["done"].as_array().unwrap().len(), 0, "{r:?}");
        assert!(r.out.as_ref().unwrap()["skipped"].as_array().unwrap().iter().all(|x| x["why"] == "system"));
        let yes = Approval { count: 1, refs_sha256: refs_sha256(&["f4".to_string()]) };
        let r = run.call(&mut j, "trash", json!({ "refs": ["f4"], "what": "folders" }), Some(&yes));
        assert_eq!(r.out.as_ref().unwrap()["done"], 0);
        assert!(t.home.join("Desktop/Work/Client").is_dir() && t.home.join("Documents").is_dir());
        assert!(j.manifest.ops.is_empty());
    }

    /// Review, 16 October 2026 (safety-10): a web page, a calendar or contact card, an email or a web link is only ever
    /// shown in Finder by a job, never opened.
    #[test]
    fn active_files_are_only_shown() {
        let t = Tree::new("openactive");
        t.file("Downloads/page.html", "<script>x</script>");
        t.file("Downloads/invite.ics", "BEGIN:VCALENDAR");
        t.file("Downloads/Invoice.pdf", "%PDF");
        let mut j = job(&t);
        let mut run = Run::new(&t);
        run.call(&mut j, "list_files", json!({ "folder": "f3", "recursive": false, "kinds": [], "since_days": 0, "words": [] }), None);
        let refs: HashMap<String, String> = j.refs.map.iter().filter(|(r, _)| r.starts_with('e')).map(|(r, p)| (p.file_name().unwrap().to_string_lossy().to_string(), r.clone())).collect();
        for name in ["page.html", "invite.ics"] {
            let r = run.call(&mut j, "open", json!({ "ref": refs[name], "reveal": false }), None);
            assert!(!r.ok && r.error.as_deref().unwrap().contains("reveal true"), "{name}");
            assert!(run.call(&mut j, "open", json!({ "ref": refs[name], "reveal": true }), None).ok, "{name} shown in Finder");
        }
        assert!(run.call(&mut j, "open", json!({ "ref": refs["Invoice.pdf"], "reveal": false }), None).ok);
        assert_eq!(run.opened.iter().filter(|(_, reveal)| !reveal).count(), 1, "only the PDF opened");
    }

    /// Review, 16 October 2026 (experience-5): the done card's Show in Finder goes to the folder the job changed.
    #[test]
    fn the_job_folder() {
        let t = Tree::new("jobfolder");
        t.file("Desktop/a.pdf", "a");
        t.file("Desktop/b.png", "b");
        let mut j = job(&t);
        assert_eq!(j.job_folder(), None, "nothing changed");
        let mut run = Run::new(&t);
        run.call(&mut j, "organise", json!({ "folder": "f1", "by": "kind" }), None);
        assert_eq!(j.job_folder(), Some(t.home.join("Desktop")));
        let t2 = Tree::new("jobfolder2");
        t2.file("Documents/Photos/x.jpg", "x");
        let mut j2 = job(&t2);
        let mut run2 = Run::new(&t2);
        run2.call(&mut j2, "list_files", json!({ "folder": "f2", "recursive": true, "kinds": [], "since_days": 0, "words": [] }), None);
        let x = j2.refs.map.iter().find(|(_, p)| p.ends_with("x.jpg")).map(|(r, _)| r.clone()).unwrap();
        run2.call(&mut j2, "rename", json!({ "items": [{ "ref": x, "name": "Beach" }] }), None);
        assert_eq!(j2.job_folder(), Some(t2.home.join("Documents/Photos")));
    }

    #[test]
    fn stop_between_items() {
        let t = Tree::new("stop");
        for i in 0..10 {
            t.file(&format!("Desktop/f{i}.txt"), "x");
        }
        let mut job = job(&t);
        let mut run = Run::new(&t);
        run.stop_at = Some(4);
        let r = run.call(&mut job, "organise", json!({ "folder": "f1", "by": "kind" }), None);
        let moved = r.out.map(|o| o["moved"].as_u64().unwrap()).unwrap_or(0);
        assert!(moved < 10, "stopped part way: {moved}");
        assert_eq!(job.manifest.ops.iter().filter(|o| matches!(o, Op::Moved { .. })).count() as u64, moved, "every finished item is in the manifest");
    }
}
