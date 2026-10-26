//! Downloads from the Boredroom window (owner request, 24 October 2026): files, deliverables and exports land in the
//! Downloads folder like a browser's, and are marked as downloaded from the web (quarantine), so Gatekeeper treats them
//! as Safari's. Only Boredroom's own pages can reach here: every other site opens in the browser (policy.rs).
//!
//! wry gives a de-duplicated `~/Downloads/<name>`; the name is checked again (no path separators, NUL or leading dot, at
//! most 255 bytes) and the folder must be Downloads. macOS's `Finished` carries no path, so the destination is kept from
//! `Requested`. If the person said no to the Downloads folder in setup, a save panel asks where instead.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{webview::DownloadEvent, AppHandle, Manager, Webview};

/// Downloads in progress: (the download's URL, where it goes, the page it came from).
static PENDING: Mutex<Vec<(String, PathBuf, Option<String>)>> = Mutex::new(Vec::new());

/// A file name that is only a name: no separators, NUL or control characters, no leading dot, at most 255 bytes (the
/// extension kept where it can be).
pub fn safe_name(name: &str) -> String {
    let mut s: String = name.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '\0') || c.is_control() { '_' } else { c }).collect();
    s = s.trim().to_string();
    if s.is_empty() || s == "." || s == ".." {
        s = "download".into();
    }
    if s.starts_with('.') {
        s = format!("_{s}");
    }
    if s.len() > 255 {
        let ext = Path::new(&s).extension().and_then(|e| e.to_str()).filter(|e| e.len() <= 16).map(|e| format!(".{e}")).unwrap_or_default();
        let mut stem: String = String::new();
        for c in s.chars() {
            if stem.len() + c.len_utf8() + ext.len() > 255 {
                break;
            }
            stem.push(c);
        }
        if !ext.is_empty() && !stem.ends_with(&ext) {
            while stem.len() + ext.len() > 255 {
                stem.pop();
            }
            s = format!("{stem}{ext}");
        } else {
            s = stem;
        }
    }
    s
}

/// Whether `dest` is directly in `downloads`.
pub fn in_folder(dest: &Path, downloads: &Path) -> bool {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    dest.parent().is_some_and(|p| canon(p) == canon(downloads))
}

/// `name (1).ext`, `name (2).ext`… until the name is free.
pub fn unique(dir: &Path, name: &str, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    for n in 1..1000 {
        let c = dir.join(format!("{stem} ({n}){ext}"));
        if !exists(&c) {
            return c;
        }
    }
    dir.join(format!("{stem} ({}){ext}", std::process::id()))
}

fn downloads_denied(app: &AppHandle) -> bool {
    app.state::<crate::AppState>().config.lock().unwrap().folders.as_ref().and_then(|f| f.downloads.as_deref()) == Some("denied")
}

pub fn on_download(app: &AppHandle, webview: Webview, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            let Ok(downloads) = app.path().download_dir() else { return false };
            let name = destination.file_name().and_then(|n| n.to_str()).map(String::from).unwrap_or_else(|| "download".into());
            let safe = safe_name(&name);
            let target = if downloads_denied(app) {
                match save_panel(&safe, &downloads) {
                    Some(p) => p,
                    None => return false,
                }
            } else if safe == name && in_folder(destination, &downloads) {
                destination.clone()
            } else {
                unique(&downloads, &safe, |p| p.exists())
            };
            *destination = target.clone();
            let page = webview.url().ok().map(|u| u.to_string());
            PENDING.lock().unwrap().push((url.to_string(), target, page));
            true
        }
        DownloadEvent::Finished { url, success, .. } => {
            let found = {
                let mut p = PENDING.lock().unwrap();
                p.iter().position(|(u, _, _)| *u == url.as_str()).map(|i| p.remove(i))
            };
            let Some((_, path, page)) = found else { return true };
            if success {
                let data = matches!(url.scheme(), "http" | "https").then(|| url.to_string());
                mark_downloaded(&path, data.as_deref(), page.as_deref());
            } else {
                let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("the file").to_string();
                crate::appmenu::alert(app, crate::appmenu::Alert::info(&format!("Couldn't download “{name}”."), "Try again from the page."), |_, _| {});
            }
            true
        }
        _ => true,
    }
}

/// The quarantine a browser sets (agent Boredroom, a web download, where from), and the Dock's Downloads stack bounces.
#[cfg(target_os = "macos")]
fn mark_downloaded(path: &Path, data_url: Option<&str>, origin_url: Option<&str>) {
    use objc2::{class, msg_send, runtime::AnyObject};
    use objc2_foundation::NSString;
    #[link(name = "Foundation", kind = "framework")]
    extern "C" {
        static NSURLQuarantinePropertiesKey: *mut AnyObject;
    }
    let Some(p) = path.to_str() else { return };
    unsafe {
        let ps = NSString::from_str(p);
        let file: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: &*ps];
        let dict: *mut AnyObject = msg_send![class!(NSMutableDictionary), dictionary];
        if file.is_null() || dict.is_null() {
            return;
        }
        let set = |k: &str, v: *mut AnyObject| {
            if !v.is_null() {
                let key = NSString::from_str(k);
                let _: () = msg_send![&*dict, setObject: v, forKey: &*key];
            }
        };
        let agent = NSString::from_str("Boredroom");
        set("LSQuarantineAgentName", objc2::rc::Retained::as_ptr(&agent) as *mut AnyObject);
        let kind = NSString::from_str("LSQuarantineTypeWebDownload");
        set("LSQuarantineType", objc2::rc::Retained::as_ptr(&kind) as *mut AnyObject);
        let url_of = |s: &str| -> *mut AnyObject {
            let ns = NSString::from_str(s);
            msg_send![class!(NSURL), URLWithString: &*ns]
        };
        if let Some(d) = data_url {
            set("LSQuarantineDataURL", url_of(d));
        }
        if let Some(o) = origin_url {
            set("LSQuarantineOriginURL", url_of(o));
        }
        let key = NSURLQuarantinePropertiesKey;
        if !key.is_null() {
            let _: bool = msg_send![&*file, setResourceValue: dict, forKey: key, error: std::ptr::null_mut::<*mut AnyObject>()];
        }
        let center: *mut AnyObject = msg_send![class!(NSDistributedNotificationCenter), defaultCenter];
        if !center.is_null() {
            let name = NSString::from_str("com.apple.DownloadFileFinished");
            let _: () = msg_send![&*center, postNotificationName: &*name, object: &*ps];
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn mark_downloaded(_path: &Path, _data_url: Option<&str>, _origin_url: Option<&str>) {}

/// A modal save panel (Downloads preselected): where the person chose, or None for Cancel.
#[cfg(target_os = "macos")]
fn save_panel(name: &str, downloads: &Path) -> Option<PathBuf> {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_foundation::NSString;
    unsafe {
        let panel: *mut AnyObject = msg_send![class!(NSSavePanel), savePanel];
        if panel.is_null() {
            return None;
        }
        let n = NSString::from_str(name);
        let _: () = msg_send![&*panel, setNameFieldStringValue: &*n];
        if let Some(d) = downloads.to_str() {
            let ds = NSString::from_str(d);
            let dir: *mut AnyObject = msg_send![class!(NSURL), fileURLWithPath: &*ds];
            if !dir.is_null() {
                let _: () = msg_send![&*panel, setDirectoryURL: dir];
            }
        }
        let r: isize = msg_send![&*panel, runModal];
        if r != 1 {
            return None;
        }
        let url: *mut AnyObject = msg_send![&*panel, URL];
        if url.is_null() {
            return None;
        }
        let path: Option<Retained<NSString>> = msg_send![&*url, path];
        path.map(|p| PathBuf::from(p.to_string()))
    }
}

#[cfg(not(target_os = "macos"))]
fn save_panel(_name: &str, _downloads: &Path) -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names() {
        assert_eq!(safe_name("report.pdf"), "report.pdf");
        assert_eq!(safe_name("../../etc/passwd"), "_.._.._etc_passwd");
        assert_eq!(safe_name("a/b\\c:d\0e"), "a_b_c_d_e");
        assert_eq!(safe_name(".zshrc"), "_.zshrc");
        assert_eq!(safe_name(""), "download");
        assert_eq!(safe_name(".."), "download");
        assert_eq!(safe_name("a\nb"), "a_b");
        let long = format!("{}.xlsx", "é".repeat(200));
        let s = safe_name(&long);
        assert!(s.len() <= 255 && s.ends_with(".xlsx"), "{s}");
        assert!(safe_name(&"x".repeat(400)).len() <= 255);
    }

    #[test]
    fn the_downloads_folder_and_free_names() {
        let dir = std::env::temp_dir().join(format!("boredroom-dl-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert!(in_folder(&dir.join("a.pdf"), &dir));
        assert!(!in_folder(&dir.join("sub").join("a.pdf"), &dir));
        assert!(!in_folder(Path::new("/tmp/a.pdf"), &dir));
        let taken = [dir.join("a.pdf"), dir.join("a (1).pdf")];
        assert_eq!(unique(&dir, "a.pdf", |p| taken.contains(&p.to_path_buf())), dir.join("a (2).pdf"));
        assert_eq!(unique(&dir, "b.pdf", |p| taken.contains(&p.to_path_buf())), dir.join("b.pdf"));
        assert_eq!(unique(&dir, "notes", |p| p == dir.join("notes")), dir.join("notes (1)"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
