//! Where Brenda never works, and which steps need their own yes (owner rule, 12 October 2026; companion-spec 0.6, B.7).
//!
//! Pure tables and checks, used by the executor (`input.rs`) before every action and by the companion's hiding rules:
//! - `FIXED_NO_ACT`: apps she never clicks or types in, whatever anyone sets (every never-look app, plus terminals,
//!   script and automation tools, Activity Monitor, Disk Utility, the installers). The same table is `FIXED_NO_ACT` in
//!   `src/lib/act.ts`: change both.
//! - `PAYMENT_HINTS`: banking and payment pages, by their address (a heuristic, and the consent says so).
//! - The outward classifier: a click on a button, link, menu item or check box whose title names a verb that sends,
//!   deletes, pays…; the keys that press a focused button, submit a field, delete or send; drops into the Trash or into
//!   another app; and the shortcuts that send, delete or quit. Each needs its own yes, and a yes covers only its own kind
//!   of step. What the classifier cannot read (no focus, no element) fails closed: it asks (review, 12 October 2026).
//! - What must never be opened (owner request, 12 October 2026: "I wanted Brenda to assist me with some things, like open
//!   an app on my desktop, and it said it can't do that"): the review's blanket rule (no app, installer or script, by
//!   extension) goes. Ordinary apps in the Applications folders open again; installers and disk images, scripts and
//!   executables, link files, apps from anywhere else and apps that came from the internet and were never opened stay
//!   refused (`never_open`), whether Brenda opens them herself (`open.rs`) or by a double-click or ⌘O.
//! - Files that hold secrets (`SECRET_EXT`): never listed, opened or read.
//! - The pure halves of the full-screen, sharing and screenshot-tool heuristics (B.4.7).

use crate::look::{never_look, AppId, Bounds, Rule};

/// Apps beyond `look::FIXED_NEVER_LOOK` where Brenda never acts: (bundle id, name). Ids beyond phase 1's confirmed ones
/// are best known (B.7).
pub const FIXED_NO_ACT: &[(&str, &str)] = &[
    ("com.apple.Terminal", "Terminal"),
    ("com.googlecode.iterm2", "iTerm"),
    ("dev.warp.Warp-Stable", "Warp"),
    ("com.mitchellh.ghostty", "Ghostty"),
    ("org.alacritty", "Alacritty"),
    ("net.kovidgoyal.kitty", "kitty"),
    ("com.apple.ScriptEditor2", "Script Editor"),
    ("com.apple.Automator", "Automator"),
    ("com.apple.shortcuts", "Shortcuts"),
    ("com.apple.ActivityMonitor", "Activity Monitor"),
    ("com.apple.DiskUtility", "Disk Utility"),
    ("com.apple.installer", "Installer"),
    ("com.apple.MigrateAssistant", "Migration Assistant"),
    // Launchers that type into themselves while another app stays in front, and can run commands or fill passwords
    // (review, 12 October 2026: the keyboard's owner is checked before every key, not only the front app).
    ("com.apple.Spotlight", "Spotlight"),
    ("com.raycast.macos", "Raycast"),
    ("com.runningwithcrayons.Alfred", "Alfred"),
    ("com.runningwithcrayons.Alfred-3", "Alfred 3"),
    ("com.runningwithcrayons.Alfred-Preferences", "Alfred Preferences"),
    ("at.obdev.LaunchBar", "LaunchBar"),
    ("com.apple.SystemEvents", "System Events"),
    ("com.apple.ScriptMenuApp", "Script Menu"),
];

/// The app's name when Brenda must never act in it: the never-look lists (fixed, workspace, the person's) first, then
/// `FIXED_NO_ACT`. Name matches can only refuse, never allow.
pub fn no_act(app: &AppId, rules: &[Rule]) -> Option<String> {
    if let Some(m) = never_look(app, rules) {
        return Some(m.name);
    }
    let id = app.bundle_id.as_deref().map(|s| s.trim().to_lowercase());
    for (bid, name) in FIXED_NO_ACT {
        let by_id = id.as_deref().is_some_and(|i| i == bid.to_lowercase());
        let by_name = app.names.iter().any(|n| !n.trim().is_empty() && n.trim().eq_ignore_ascii_case(name));
        if by_id || by_name {
            return Some((*name).to_string());
        }
    }
    None
}

/// Host or path substrings of banking and payment pages, lower-case (B.7).
pub const PAYMENT_HINTS: &[&str] = &[
    "bank", "banking", "paypal", "checkout", "/pay", "payment", "billing", "wallet", "stripe.com", "revolut", "wise.com", "monzo", "starling", "chase.com",
    "barclays", "hsbc", "lloyds", "natwest", "santander", "wellsfargo", "bankofamerica", "citi.com", "americanexpress", "venmo", "cash.app", "coinbase",
    "binance", "kraken", "flutterwave", "paystack", "opay", "palmpay", "kuda", "gtbank", "zenithbank", "firstbanknigeria", "accessbankplc", "ubagroup",
    "moniepoint", "fidelitybank", "stanbicibtc", "ecobank",
];

/// Browsers whose page address is checked against `PAYMENT_HINTS` (Safari, Chrome, Arc, Edge, Firefox, Brave, Opera).
pub const BROWSERS: &[&str] = &[
    "com.apple.Safari",
    "com.apple.SafariTechnologyPreview",
    "com.google.Chrome",
    "com.google.Chrome.canary",
    "company.thebrowser.Browser",
    "com.microsoft.edgemac",
    "org.mozilla.firefox",
    "com.brave.Browser",
    "com.operasoftware.Opera",
];

pub fn is_browser(bundle_id: Option<&str>) -> bool {
    bundle_id.is_some_and(|b| BROWSERS.iter().any(|x| x.eq_ignore_ascii_case(b)))
}

/// Whether a page address looks like banking or payment: its host or path (never the query) contains a hint.
pub fn payment_page(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url.trim()) else {
        let l = url.to_lowercase();
        return PAYMENT_HINTS.iter().any(|h| l.contains(h));
    };
    let host = u.host_str().unwrap_or("").to_lowercase();
    let path = u.path().to_lowercase();
    PAYMENT_HINTS.iter().any(|h| host.contains(h) || path.contains(h))
}

// ---- outward steps -------------------------------------------------------------------------------------------------

/// The words that make a click outward (B.7.5), as single words or two-word phrases, case-insensitive, whole words.
const OUTWARD_WORDS: &[&str] = &[
    "send", "submit", "post", "publish", "share", "pay", "buy", "purchase", "order", "checkout", "check out", "delete", "remove", "erase", "trash", "discard",
    "sign in", "log in", "login", "sign up", "register", "accept", "agree", "confirm", "transfer", "approve", "merge", "deploy", "invite", "unsubscribe",
    "forward", "reply", "overwrite", "replace", "empty trash", "quit",
];

/// Roles whose press does something (B.7.5); check boxes and radio buttons too ("I agree to the terms", review,
/// 12 October 2026).
pub const PRESS_ROLES: &[&str] = &["AXButton", "AXMenuItem", "AXLink", "AXMenuButton", "AXCheckBox", "AXRadioButton"];
/// Roles that take typed text (Return in one of these inside a web page submits).
pub const TEXT_ROLES: &[&str] = &["AXTextField", "AXTextArea", "AXComboBox"];

/// The outward word in a control's title or description, if any (whole words; the first found, in the text's order).
pub fn outward_word(text: &str) -> Option<String> {
    let words: Vec<String> = text.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(String::from).collect();
    for i in 0..words.len() {
        // Two-word phrases first, so "check out" is not read as nothing and "empty trash" names itself.
        if i + 1 < words.len() {
            let two = format!("{} {}", words[i], words[i + 1]);
            if OUTWARD_WORDS.contains(&two.as_str()) {
                return Some(two);
            }
        }
        if OUTWARD_WORDS.contains(&words[i].as_str()) {
            return Some(words[i].clone());
        }
    }
    None
}

/// One accessibility element as the classifier needs it: role, title and description (never its value).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct AxBrief {
    pub role: String,
    pub title: String,
    pub description: String,
}

/// A click is outward when the element under it, or one of its two parents, is a button, link or menu item whose title
/// or description names an outward verb.
pub fn outward_click(chain: &[AxBrief]) -> Option<String> {
    for el in chain.iter().take(3) {
        if PRESS_ROLES.contains(&el.role.as_str()) {
            if let Some(w) = outward_word(&el.title).or_else(|| outward_word(&el.description)) {
                return Some(w);
            }
        }
    }
    None
}

pub const MOD_SHIFT: u64 = 0x0002_0000;
pub const MOD_CONTROL: u64 = 0x0004_0000;
pub const MOD_OPTION: u64 = 0x0008_0000;
pub const MOD_COMMAND: u64 = 0x0010_0000;

pub const KEY_RETURN: u16 = 36;
pub const KEY_KEYPAD_ENTER: u16 = 76;
pub const KEY_BACKSPACE: u16 = 51;
pub const KEY_Q: u16 = 12;
pub const KEY_D: u16 = 2;

/// The shortcuts that send, delete or quit (0.6 layer 2, the same list as the server's): ⌘Return, ⌘Enter, ⌘⇧D, ⌘⌫, ⇧⌘⌫,
/// ⌥⌘⌫, ⌘Q. Control is ignored when reading them (it never makes them safe).
pub fn outward_shortcut(code: u16, flags: u64) -> Option<&'static str> {
    let cmd = flags & MOD_COMMAND != 0;
    let shift = flags & MOD_SHIFT != 0;
    let opt = flags & MOD_OPTION != 0;
    if !cmd {
        return None;
    }
    match code {
        KEY_RETURN | KEY_KEYPAD_ENTER => Some("send"),
        KEY_D if shift => Some("send"),
        KEY_BACKSPACE if shift || opt => Some("delete"),
        KEY_BACKSPACE => Some("delete"),
        KEY_Q if !shift && !opt => Some("quit"),
        _ => None,
    }
}

pub const KEY_SPACE: u16 = 49;
pub const KEY_FORWARD_DELETE: u16 = 117;
pub const KEY_3: u16 = 20;
pub const KEY_O: u16 = 31;
pub const KEY_DOWN: u16 = 125;

/// The element that has the keyboard (Accessibility, never its value): its role, title and description, whether it is
/// inside a web page (a browser's, or an Electron app's once its tree is switched on), and the process that owns it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Focus {
    pub el: AxBrief,
    pub in_web: bool,
    pub pid: Option<i32>,
}

/// What a key, some typing, a click or a drop would do, for the second yes (rule c).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Class {
    Safe,
    /// It sends, deletes, pays… (the verb).
    Outward(String),
    /// The classifier cannot tell (no focus, no element, an unnamed button): it asks, as an outward step does.
    Unknown,
}

/// Apps where Return in a text field or area adds a line or confirms an edit (Finder's rename), never sends (review,
/// 12 October 2026). Return in a text field of any other app counts as sending; in a web page, as submitting.
pub const RETURN_SAFE_APPS: &[&str] = &[
    "com.apple.finder",
    "com.apple.TextEdit",
    "com.apple.iWork.Pages",
    "com.apple.iWork.Numbers",
    "com.apple.iWork.Keynote",
    "com.apple.Notes",
    "com.apple.Preview",
    "com.microsoft.Word",
    "com.microsoft.Excel",
    "com.microsoft.Powerpoint",
    "com.apple.dt.Xcode",
    "com.barebones.bbedit",
    "com.sublimetext.4",
];

/// Inside a web page, the roles where Return only moves or opens (a row, a list, the page itself).
const WEB_NAV_ROLES: &[&str] = &["AXWebArea", "AXRow", "AXCell", "AXList", "AXOutline", "AXTable", "AXScrollArea", "AXStaticText", "AXHeading"];

fn same_app(a: Option<&str>, list: &[&str]) -> bool {
    a.is_some_and(|b| list.iter().any(|x| x.eq_ignore_ascii_case(b)))
}

/// A pressable element pressed from the keyboard: its outward verb, unknown when it has no name at all, else safe.
fn press_class(el: &AxBrief) -> Class {
    if let Some(w) = outward_word(&el.title).or_else(|| outward_word(&el.description)) {
        return Class::Outward(w);
    }
    if el.title.trim().is_empty() && el.description.trim().is_empty() {
        return Class::Unknown;
    }
    Class::Safe
}

/// What a key would do (rule c, review 12 October 2026). `focus`: the element with the keyboard (None: unknown);
/// `front_bundle`: the front app's bundle id; `browser`: the front app is a web browser.
/// - The send, delete and quit shortcuts (`outward_shortcut`).
/// - Return or Enter: on a button, link, menu item or check box, that control's verb (an unnamed one is unknown); in a
///   text field, submitting in a web page, sending anywhere but `RETURN_SAFE_APPS`; elsewhere in a web page, unknown
///   unless it is a row, a list or the page; no focus at all, unknown.
/// - Space on a button, link, menu item or check box: that control's verb; with no focus, unknown.
/// - Backspace or Delete outside a text field: deletes; with no focus, unknown.
/// - ⇧3 ("#", Gmail's delete) outside a text field in a web page: deletes.
pub fn classify_key(code: u16, flags: u64, focus: Option<&Focus>, front_bundle: Option<&str>, browser: bool) -> Class {
    if let Some(v) = outward_shortcut(code, flags) {
        return Class::Outward(v.into());
    }
    if flags & (MOD_COMMAND | MOD_CONTROL) != 0 {
        return Class::Safe;
    }
    let role = focus.map(|f| f.el.role.as_str());
    let text = role.is_some_and(|r| TEXT_ROLES.contains(&r));
    let press = role.is_some_and(|r| PRESS_ROLES.contains(&r));
    let web = browser || focus.is_some_and(|f| f.in_web);
    match code {
        KEY_RETURN | KEY_KEYPAD_ENTER => {
            let Some(f) = focus else { return Class::Unknown };
            if press {
                press_class(&f.el)
            } else if text {
                if f.in_web {
                    Class::Outward("submit".into())
                } else if same_app(front_bundle, RETURN_SAFE_APPS) {
                    Class::Safe
                } else {
                    Class::Outward("send".into())
                }
            } else if f.in_web && !role.is_some_and(|r| WEB_NAV_ROLES.contains(&r)) {
                Class::Unknown
            } else {
                Class::Safe
            }
        }
        KEY_SPACE => match focus {
            None => Class::Unknown,
            Some(f) if press => press_class(&f.el),
            Some(_) => Class::Safe,
        },
        KEY_BACKSPACE | KEY_FORWARD_DELETE => match focus {
            None => Class::Unknown,
            Some(_) if text => Class::Safe,
            Some(_) => Class::Outward("delete".into()),
        },
        KEY_3 if flags & MOD_SHIFT != 0 && web => match focus {
            None => Class::Unknown,
            Some(_) if text => Class::Safe,
            Some(_) => Class::Outward("delete".into()),
        },
        _ => Class::Safe,
    }
}

/// Typing (a `type` action): a line break is a Return; in a web page, letters typed while no text field has the keyboard
/// can press the page's own one-key shortcuts ("#" deletes in Gmail), so that is unknown too.
pub fn classify_typing(text: &str, focus: Option<&Focus>, front_bundle: Option<&str>, browser: bool) -> Class {
    let role = focus.map(|f| f.el.role.as_str());
    let in_text = role.is_some_and(|r| TEXT_ROLES.contains(&r));
    if (browser || focus.is_some_and(|f| f.in_web)) && !in_text {
        return Class::Unknown;
    }
    if text.contains(['\n', '\r']) {
        return classify_key(KEY_RETURN, 0, focus, front_bundle, browser);
    }
    Class::Safe
}

/// The kind of ask (`ask_before`'s kind) an outward verb belongs to.
pub fn verb_kind(verb: &str) -> &'static str {
    match verb {
        "send" | "forward" | "reply" | "invite" => "send",
        "submit" | "confirm" | "approve" | "register" | "sign up" | "merge" | "deploy" | "unsubscribe" => "submit",
        "post" | "publish" => "publish",
        "share" => "share",
        "pay" | "buy" | "purchase" | "order" | "checkout" | "check out" | "transfer" => "pay",
        "delete" | "remove" | "erase" | "trash" | "discard" | "empty trash" => "delete",
        "sign in" | "log in" | "login" => "sign_in",
        "accept" | "agree" => "accept_terms",
        "overwrite" | "replace" => "overwrite",
        "quit" => "quit",
        _ => "other",
    }
}

/// Sending, submitting, publishing and sharing are one family: a yes to one covers a control that names another
/// ("Post" for a step asked as "send").
const SENDING: &[&str] = &["send", "submit", "publish", "share"];

/// Whether the person's yes to an asked step of `approved` kind covers this action (review, 12 October 2026: a yes covers
/// the step they heard, not any outward step). An action the classifier cannot read is covered by any yes to an asked
/// step (the model named that step to them); one it can read must be of the same kind (or family).
pub fn kind_allows(approved: &str, verb: Option<&str>) -> bool {
    let Some(v) = verb else { return true };
    let k = verb_kind(v);
    k == approved || (SENDING.contains(&k) && SENDING.contains(&approved))
}

/// Installers and disk images: opening one installs something (owner request, 12 October 2026: never opened). The
/// three groups are the contract's table (B.2); `RUNS_EXT` is all three, and a test keeps them equal. Review of 12 October
/// 2026: every disk image mounts through DiskImageMounter, not only `.dmg` (`iso img cdr sparseimage sparsebundle toast
/// udif`), and certificates and provisioning profiles open Keychain Access's or the system's import (`cer crt der p7b p7c
/// provisionprofile mobileprovision`), so those are refused too.
#[allow(dead_code)]
pub const INSTALLER_EXT: &[&str] = &[
    "pkg", "mpkg", "dmg", "mobileconfig", "prefpane", "kext", "osax", "iso", "img", "cdr", "sparseimage", "sparsebundle", "toast", "udif", "cer", "crt", "der", "p7b",
    "p7c", "provisionprofile", "mobileprovision",
];
/// Scripts and executables: opening one runs it.
#[allow(dead_code)]
pub const SCRIPT_EXT: &[&str] = &[
    "command", "tool", "sh", "zsh", "bash", "csh", "ksh", "fish", "py", "pl", "rb", "php", "js", "scpt", "scptd", "applescript", "workflow", "terminal", "action",
    "jar", "shortcut",
];
/// Link files: opening one goes wherever it says.
#[allow(dead_code)]
pub const LINK_EXT: &[&str] = &["webloc", "inetloc", "fileloc"];
/// Everything that runs something when opened (companion2-spec B.2; the same list as `OPEN_RUNS_EXT` in
/// `src/lib/act.ts`: change both). `.app` is not here: an app is decided by `never_open`'s app rule.
pub const RUNS_EXT: &[&str] = &[
    "pkg", "mpkg", "dmg", "mobileconfig", "prefpane", "kext", "osax", "iso", "img", "cdr", "sparseimage", "sparsebundle", "toast", "udif", "cer", "crt", "der", "p7b",
    "p7c", "provisionprofile", "mobileprovision", "command", "tool", "sh", "zsh", "bash", "csh", "ksh", "fish", "py", "pl", "rb", "php", "js", "scpt", "scptd",
    "applescript", "workflow", "terminal", "action", "jar", "shortcut", "webloc", "inetloc", "fileloc",
];
/// Files that hold secrets: never listed, opened or read (the same list as `SECRET_EXT` in `src/lib/act.ts`), and any
/// name starting `.env`.
pub const SECRET_EXT: &[&str] = &["kdbx", "kdb", "1pux", "1pif", "opvault", "agilekeychain", "keychain", "keychain-db", "p12", "pfx", "pem", "key", "ovpn", "gpg", "pgp", "asc", "psafe3"];

fn ext_of(path: &std::path::Path) -> String {
    path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default()
}

/// An installer, a script or a link file, by its extension.
pub fn runs_something(path: &std::path::Path) -> bool {
    let e = ext_of(path);
    !e.is_empty() && RUNS_EXT.contains(&e.as_str())
}

/// Password managers whose exports carry their name ("bitwarden_export_20261012.csv", "lastpass_export.csv",
/// "Keeper Export.csv"): with "export", "backup" or "vault" in the name, the file is a password export.
pub const PASSWORD_BRANDS: &[&str] = &["1password", "bitwarden", "lastpass", "dashlane", "keeper", "nordpass", "enpass", "keepass", "roboform", "protonpass", "proton pass", "proton_pass"];

/// A password export by its name (review, 12 October 2026: "Passwords.csv" from Apple Passwords and Safari, "Chrome
/// Passwords.csv", Bitwarden's and LastPass's exports were read by a folder job and sent to the model). Any name with
/// "password" in it, or a password manager's name with "export", "backup" or "vault". The same rule is
/// `passwordExportName` in `src/lib/act.ts`: change both.
pub fn password_export(name: &str) -> bool {
    let l = name.to_lowercase();
    l.contains("password") || (["export", "backup", "vault"].iter().any(|w| l.contains(w)) && PASSWORD_BRANDS.iter().any(|b| l.contains(b)))
}

/// A file that holds secrets (a password store or export, a key, a certificate, an `.env` file).
pub fn secret_file(path: &std::path::Path) -> bool {
    let e = ext_of(path);
    let name = path.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    name.starts_with(".env") || (!e.is_empty() && SECRET_EXT.contains(&e.as_str())) || password_export(&name)
}

/// Apps that install, uninstall, update or erase (review, 12 October 2026: "Install Command Line Developer Tools",
/// "Erase Assistant", "Install macOS …" in /Applications, "Rosetta 2 Updater", "Microsoft AutoUpdate"): never opened, by
/// Brenda or by a double-click, whatever folder they are in. By whole words of the name, and by the bundle id. The same
/// rule is `installerLike` in `src/lib/act.ts`: change both.
pub const INSTALLER_WORDS: &[&str] = &["install", "installer", "installers", "uninstall", "uninstaller", "updater", "autoupdate", "erase"];
pub const INSTALLER_IDS: &[&str] = &["installassistant", "installer", "uninstall", "updater", "autoupdate", "diskimagemounter", "eraseassistant"];

pub fn installer_like(names: &[String], bundle_id: Option<&str>) -> bool {
    let by_name = names.iter().any(|n| n.to_lowercase().split(|c: char| !c.is_alphanumeric()).any(|w| INSTALLER_WORDS.contains(&w)));
    let by_id = bundle_id.is_some_and(|b| {
        let b = b.to_lowercase();
        INSTALLER_IDS.iter().any(|w| b.contains(w))
    });
    by_name || by_id
}

/// Apps that must never be what opens a file Brenda opens (review, 12 October 2026), beyond `no_act` and
/// `installer_like`: disk images mount through DiskImageMounter, certificates import through Certificate Assistant.
/// Ids read with `plutil` on this Mac, 12 October 2026.
pub const NEVER_HANDLERS: &[(&str, &str)] = &[("com.apple.DiskImageMounter", "DiskImageMounter"), ("com.apple.CertificateAssistant", "Certificate Assistant"), ("com.apple.EraseAssistant", "Erase Assistant")];

/// The app that would open a file must be one Brenda works in (review, 12 October 2026: a `.cer` opens Keychain Access,
/// a `.iso` mounts, an `.alfredworkflow` imports into Alfred). Its name when it is not, else None.
pub fn handler_refused(handler: &AppId, rules: &[Rule]) -> Option<String> {
    if let Some(n) = no_act(handler, rules) {
        return Some(n);
    }
    let id = handler.bundle_id.as_deref().map(str::to_lowercase);
    if let Some((_, n)) = NEVER_HANDLERS.iter().find(|(b, n)| id.as_deref() == Some(b.to_lowercase().as_str()) || handler.names.iter().any(|x| x.trim().eq_ignore_ascii_case(n))) {
        return Some((*n).to_string());
    }
    if installer_like(&handler.names, handler.bundle_id.as_deref()) {
        return Some(handler.names.first().cloned().unwrap_or_else(|| "an installer".into()));
    }
    None
}

/// The folders apps open from (companion2-spec B.1), with the words Brenda uses for them. `~` is the home folder; the
/// last one counts only for Finder (review, 12 October 2026: CoreServices also holds Erase Assistant, installers and
/// updaters, so only `FINDER_APP` there).
pub const APP_FOLDERS: &[(&str, &str)] = &[
    ("/Applications", "Applications"),
    ("/Applications/Utilities", "Utilities"),
    ("/System/Applications", "System Applications"),
    ("/System/Applications/Utilities", "Utilities"),
    ("~/Applications", "your Applications"),
    ("/System/Library/CoreServices", "System Applications"),
];

/// The app folders as paths (the home folder's own Applications only when the home folder is known).
pub fn app_folders(home: Option<&std::path::Path>) -> Vec<(std::path::PathBuf, &'static str)> {
    APP_FOLDERS
        .iter()
        .filter_map(|(p, w)| match p.strip_prefix("~/") {
            Some(rest) => home.map(|h| (h.join(rest), *w)),
            None => Some((std::path::PathBuf::from(p), *w)),
        })
        .collect()
}

/// Finder, the one app opened from CoreServices (companion2-spec B.1: "Finder, depth 1").
pub const FINDER_APP: &str = "/System/Library/CoreServices/Finder.app";
pub const FINDER_ID: &str = "com.apple.finder";

/// Whether an app's bundle is in one of the Applications folders (anywhere inside one, so a suite's folder counts; in
/// CoreServices only Finder). A path with `..` in it never counts.
pub fn in_app_folder(path: &std::path::Path, home: Option<&std::path::Path>) -> bool {
    use std::path::Component;
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return false;
    }
    app_folders(home).iter().any(|(dir, _)| {
        if dir.ends_with("CoreServices") {
            path == std::path::Path::new(FINDER_APP)
        } else {
            path.starts_with(dir) && path != dir.as_path()
        }
    })
}

/// The quarantine flag macOS sets once the person has opened an app that came from the internet ("user approved",
/// 0x0040). Checked read-only on this Mac, 12 October 2026: five downloaded apps that had been opened all read
/// `03c1;…` (0x0040 set); a never-opened one is UNVERIFIED here (none was at hand).
pub const QTN_USER_APPROVED: u32 = 0x0040;

/// Whether an app's `com.apple.quarantine` value says it came from the internet and was never opened. No value: not
/// quarantined. A value that cannot be read fails closed.
pub fn quarantine_unapproved(value: Option<&str>) -> bool {
    let Some(v) = value.map(str::trim).filter(|v| !v.is_empty()) else { return false };
    match u32::from_str_radix(v.split(';').next().unwrap_or(""), 16) {
        Ok(flags) => flags & QTN_USER_APPROVED == 0,
        Err(_) => true,
    }
}

/// What the app and file rules need from the Mac (`open::RealProbe`; the tests' own).
pub trait OpenProbe {
    fn home(&self) -> Option<std::path::PathBuf>;
    /// The `com.apple.quarantine` extended attribute, when there is one.
    fn quarantine(&self, path: &std::path::Path) -> Option<String>;
    /// A regular file with an execute bit.
    fn exec_file(&self, path: &std::path::Path) -> bool;
    /// The app that opens this file by default (`NSWorkspace URLForApplicationToOpenURL:`), when macOS says.
    fn handler(&self, path: &std::path::Path) -> Option<AppId>;
}

/// Why something is never opened.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NeverOpen {
    /// An installer, a disk image, a script, an executable or a link file.
    Runs,
    /// An app that came from the internet and hasn't been opened before.
    NewApp,
    /// An app outside the Applications folders.
    OutsideApp,
}

/// Whether opening `path` (by Brenda, a double-click or ⌘O) is refused (owner request, 12 October 2026: apps open
/// again; installers, scripts, link files and new or stray apps never). Names on the never-look and never-act lists are
/// checked by the caller (`no_act`), since they need the rules.
pub fn never_open(path: &std::path::Path, probe: &dyn OpenProbe) -> Option<NeverOpen> {
    if runs_something(path) {
        return Some(NeverOpen::Runs);
    }
    let e = ext_of(path);
    if e == "app" {
        let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if installer_like(&[stem], None) {
            return Some(NeverOpen::Runs);
        }
        if !in_app_folder(path, probe.home().as_deref()) {
            return Some(NeverOpen::OutsideApp);
        }
        if quarantine_unapproved(probe.quarantine(path).as_deref()) {
            return Some(NeverOpen::NewApp);
        }
        return None;
    }
    // Inside an app bundle, or a bare program: an executable.
    if path.components().any(|c| c.as_os_str().to_string_lossy().to_ascii_lowercase().ends_with(".app")) && e.is_empty() {
        return Some(NeverOpen::Runs);
    }
    if e.is_empty() && probe.exec_file(path) {
        return Some(NeverOpen::Runs);
    }
    None
}

/// The Trash in the Dock (its English and British names, and the role every Dock item has).
pub fn is_trash(chain: &[AxBrief]) -> bool {
    chain.iter().take(3).any(|el| {
        el.role == "AXDockItem" && ["trash", "bin"].iter().any(|n| el.title.trim().eq_ignore_ascii_case(n) || el.description.trim().eq_ignore_ascii_case(n))
    })
}

/// A Dock (or Launchpad) item's name: clicking it opens that app.
pub fn dock_item_name(chain: &[AxBrief]) -> Option<String> {
    chain.iter().take(3).find(|el| el.role == "AXDockItem" || el.role == "AXApplicationDockItem").map(|el| if el.title.trim().is_empty() { el.description.trim() } else { el.title.trim() }.to_string()).filter(|n| !n.is_empty())
}

// ---- the companion's hiding heuristics (pure parts) -----------------------------------------------------------------

/// Apps that share the screen (B.4.7): Zoom's sharing helper. [UNVERIFIED bundle id]
pub const SHARE_HELPERS: &[&str] = &["us.zoom.CptHost"];
/// The window owner Zoom's sharing helper shows while sharing.
pub const SHARE_OWNERS: &[&str] = &["CptHost"];
/// macOS's screenshot tool (⇧⌘4, ⇧⌘5).
pub const SCREENSHOT_TOOL: &str = "com.apple.screencaptureui";

pub fn sharing_suspected(running_bundle_ids: &[String], window_owner_names: &[String]) -> bool {
    running_bundle_ids.iter().any(|b| SHARE_HELPERS.iter().any(|h| h.eq_ignore_ascii_case(b)))
        || window_owner_names.iter().any(|n| SHARE_OWNERS.iter().any(|o| o == n))
}

pub fn screenshot_tool_running(running_bundle_ids: &[String]) -> bool {
    running_bundle_ids.iter().any(|b| b.eq_ignore_ascii_case(SCREENSHOT_TOOL))
}

/// Full screen: the front app's first ordinary window covers its display exactly (±1 point).
pub fn is_full_screen(window: Bounds, display: Bounds) -> bool {
    (window.x - display.x).abs() <= 1.0 && (window.y - display.y).abs() <= 1.0 && (window.w - display.w).abs() <= 1.0 && (window.h - display.h).abs() <= 1.0
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::look::RuleSource;

    fn app(id: Option<&str>, names: &[&str]) -> AppId {
        AppId { bundle_id: id.map(String::from), names: names.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn never_act_covers_never_look_and_the_tools() {
        assert_eq!(no_act(&app(Some("com.apple.Terminal"), &["Terminal"]), &[]).as_deref(), Some("Terminal"));
        assert_eq!(no_act(&app(Some("com.googlecode.iterm2"), &[]), &[]).as_deref(), Some("iTerm"));
        assert_eq!(no_act(&app(Some("com.1password.1password"), &[]), &[]).as_deref(), Some("1Password"));
        assert_eq!(no_act(&app(Some("com.apple.systempreferences"), &[]), &[]).as_deref(), Some("System Settings"));
        assert_eq!(no_act(&app(Some("com.apple.keychainaccess"), &[]), &[]).as_deref(), Some("Keychain Access"));
        assert_eq!(no_act(&app(None, &["Activity Monitor"]), &[]).as_deref(), Some("Activity Monitor"));
        assert_eq!(no_act(&app(Some("com.apple.finder"), &["Finder"]), &[]), None);
        let rules = vec![Rule { name: "Excel".into(), bundle_id: None, source: RuleSource::You }];
        assert_eq!(no_act(&app(Some("com.microsoft.Excel"), &["Excel"]), &rules).as_deref(), Some("Excel"));
        assert_eq!(FIXED_NO_ACT.len(), 21);
        for (id, name) in [("com.apple.Spotlight", "Spotlight"), ("com.raycast.macos", "Raycast"), ("com.runningwithcrayons.Alfred", "Alfred")] {
            assert_eq!(no_act(&app(Some(id), &[]), &[]).as_deref(), Some(name), "launchers that take the keyboard");
        }
    }

    #[test]
    fn payment_hints_match_host_or_path() {
        assert!(payment_page("https://www.paypal.com/signin"));
        assert!(payment_page("https://shop.example.com/checkout/step-2"));
        assert!(payment_page("https://example.com/pay/now"));
        assert!(payment_page("https://online.lloydsbank.co.uk/"));
        assert!(payment_page("https://ibank.gtbank.com/"));
        assert!(payment_page("https://dashboard.stripe.com/payments"));
        assert!(!payment_page("https://www.figma.com/file/abc"));
        assert!(!payment_page("https://docs.google.com/document/d/x?next=checkout"), "never the query");
        assert!(payment_page("not a url but a bank"));
        assert_eq!(PAYMENT_HINTS.len(), 42);
        assert!(is_browser(Some("com.apple.Safari")));
        assert!(!is_browser(Some("com.apple.finder")));
    }

    #[test]
    fn the_outward_classifier() {
        let b = |role: &str, title: &str| AxBrief { role: role.into(), title: title.into(), description: String::new() };
        assert_eq!(outward_click(&[b("AXButton", "Send")]).as_deref(), Some("send"));
        assert_eq!(outward_click(&[b("AXStaticText", "Send"), b("AXButton", "Send now")]).as_deref(), Some("send"), "a parent");
        assert_eq!(outward_click(&[b("AXImage", ""), b("AXGroup", ""), b("AXLink", "Check out")]).as_deref(), Some("check out"));
        assert_eq!(outward_click(&[b("AXImage", ""), b("AXGroup", ""), b("AXGroup", ""), b("AXButton", "Delete")]), None, "two parents at most");
        assert_eq!(outward_click(&[b("AXMenuItem", "Move to Trash")]).as_deref(), Some("trash"));
        assert_eq!(outward_click(&[b("AXButton", "Sent items")]), None, "whole words");
        assert_eq!(outward_click(&[b("AXButton", "Rename")]), None);
        assert_eq!(outward_click(&[b("AXTextField", "Send")]), None, "not a pressable role");
        assert_eq!(outward_click(&[b("AXCheckBox", "I accept the terms")]).as_deref(), Some("accept"), "a check box (review, 12 October 2026)");
        assert_eq!(outward_click(&[AxBrief { role: "AXButton".into(), title: String::new(), description: "Empty Trash".into() }]).as_deref(), Some("empty trash"));
        assert_eq!(outward_word("Sign in with Google").as_deref(), Some("sign in"));
        assert_eq!(outward_word("LOG IN").as_deref(), Some("log in"));
        assert_eq!(outward_word("Quit Safari").as_deref(), Some("quit"));
    }

    #[test]
    fn the_shortcut_table() {
        assert_eq!(outward_shortcut(KEY_RETURN, MOD_COMMAND), Some("send"));
        assert_eq!(outward_shortcut(KEY_KEYPAD_ENTER, MOD_COMMAND), Some("send"));
        assert_eq!(outward_shortcut(KEY_D, MOD_COMMAND | MOD_SHIFT), Some("send"));
        assert_eq!(outward_shortcut(KEY_D, MOD_COMMAND), None);
        assert_eq!(outward_shortcut(KEY_BACKSPACE, MOD_COMMAND), Some("delete"));
        assert_eq!(outward_shortcut(KEY_BACKSPACE, MOD_COMMAND | MOD_SHIFT), Some("delete"));
        assert_eq!(outward_shortcut(KEY_BACKSPACE, MOD_COMMAND | MOD_OPTION), Some("delete"));
        assert_eq!(outward_shortcut(KEY_Q, MOD_COMMAND), Some("quit"));
        assert_eq!(outward_shortcut(KEY_Q, MOD_COMMAND | MOD_CONTROL), Some("quit"), "control never makes it safe");
        assert_eq!(outward_shortcut(KEY_RETURN, 0), None);
        assert_eq!(outward_shortcut(KEY_BACKSPACE, 0), None);
    }

    fn f(role: &str, title: &str, web: bool) -> Focus {
        Focus { el: AxBrief { role: role.into(), title: title.into(), description: String::new() }, in_web: web, pid: Some(1) }
    }

    /// Review, 12 October 2026 (permission-1): every key that can press, submit, send or delete, and failing closed.
    #[test]
    fn keys_that_press_submit_send_or_delete() {
        let out = |v: &str| Class::Outward(v.into());
        let chrome = Some("com.google.Chrome");
        let slack = Some("com.tinyspeck.slackmacgap");
        // A focused button pressed from the keyboard (Tab to it, then Return or Space).
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXButton", "Send", true)), chrome, true), out("send"));
        assert_eq!(classify_key(KEY_SPACE, 0, Some(&f("AXButton", "Pay now", true)), chrome, true), out("pay"));
        assert_eq!(classify_key(KEY_SPACE, 0, Some(&f("AXCheckBox", "I agree to the terms", true)), chrome, true), out("agree"));
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXButton", "", false)), slack, false), Class::Unknown, "an unnamed button");
        assert_eq!(classify_key(KEY_SPACE, 0, Some(&f("AXButton", "Rename", false)), Some("com.apple.finder"), false), Class::Safe);
        // Return in a text field: submits in a web page, sends in any app that is not known to add a line.
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXTextField", "", true)), chrome, true), out("submit"));
        assert_eq!(classify_key(KEY_KEYPAD_ENTER, 0, Some(&f("AXComboBox", "", true)), chrome, true), out("submit"));
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXTextArea", "", false)), slack, false), out("send"), "Electron and native chat apps");
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXTextField", "", false)), Some("com.apple.finder"), false), Class::Safe, "Finder's rename");
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXTextArea", "", false)), Some("com.apple.TextEdit"), false), Class::Safe, "a new line");
        // Return elsewhere.
        assert_eq!(classify_key(KEY_RETURN, 0, None, chrome, true), Class::Unknown, "no focus: ask first");
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXGroup", "", true)), chrome, true), Class::Unknown, "an unnamed web element");
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXRow", "", true)), chrome, true), Class::Safe, "a row opens");
        assert_eq!(classify_key(KEY_RETURN, 0, Some(&f("AXList", "", false)), Some("com.apple.finder"), false), Class::Safe, "Finder starts a rename");
        // Single-key deletes.
        assert_eq!(classify_key(KEY_BACKSPACE, 0, Some(&f("AXTable", "", false)), Some("com.apple.mail"), false), out("delete"), "a selected message");
        assert_eq!(classify_key(KEY_FORWARD_DELETE, 0, Some(&f("AXOutline", "", false)), Some("com.apple.finder"), false), out("delete"));
        assert_eq!(classify_key(KEY_BACKSPACE, 0, Some(&f("AXTextField", "", false)), Some("com.apple.mail"), false), Class::Safe, "editing text");
        assert_eq!(classify_key(KEY_BACKSPACE, 0, None, Some("com.apple.mail"), false), Class::Unknown);
        assert_eq!(classify_key(KEY_3, MOD_SHIFT, Some(&f("AXGroup", "", true)), chrome, true), out("delete"), "Gmail's #");
        assert_eq!(classify_key(KEY_3, MOD_SHIFT, Some(&f("AXTextArea", "", true)), chrome, true), Class::Safe, "a # typed in a field");
        assert_eq!(classify_key(KEY_3, MOD_SHIFT, Some(&f("AXList", "", false)), Some("com.apple.finder"), false), Class::Safe, "not a web page");
        // The shortcuts, and everything else.
        assert_eq!(classify_key(KEY_RETURN, MOD_COMMAND, Some(&f("AXTextArea", "", true)), chrome, true), out("send"));
        assert_eq!(classify_key(1, MOD_COMMAND, None, chrome, true), Class::Safe, "⌘S");
        assert_eq!(classify_key(0, 0, Some(&f("AXTextArea", "", true)), chrome, true), Class::Safe, "a letter");
        assert_eq!(classify_key(123, 0, None, chrome, true), Class::Safe, "an arrow");
    }

    #[test]
    fn typing_into_the_right_place() {
        let chrome = Some("com.google.Chrome");
        assert_eq!(classify_typing("hello", Some(&f("AXTextArea", "", true)), chrome, true), Class::Safe);
        assert_eq!(classify_typing("hello\n", Some(&f("AXTextArea", "", true)), chrome, true), Class::Outward("submit".into()));
        assert_eq!(classify_typing("#", Some(&f("AXGroup", "", true)), chrome, true), Class::Unknown, "letters into a page with no field press its shortcuts");
        assert_eq!(classify_typing("hi", None, chrome, true), Class::Unknown);
        assert_eq!(classify_typing("Invoice-01", Some(&f("AXTextField", "", false)), Some("com.apple.finder"), false), Class::Safe);
        assert_eq!(classify_typing("Invoice-01\n", Some(&f("AXTextField", "", false)), Some("com.apple.finder"), false), Class::Safe, "the rename's Return");
        assert_eq!(classify_typing("ok\n", Some(&f("AXTextArea", "", false)), Some("com.hnc.Discord"), false), Class::Outward("send".into()));
        assert_eq!(classify_typing("abc", Some(&f("AXList", "", false)), Some("com.apple.finder"), false), Class::Safe, "Finder's type-to-select");
    }

    /// Review, 12 October 2026 (permission-6): a yes covers the kind of step the person heard.
    #[test]
    fn a_yes_covers_its_own_kind() {
        assert!(kind_allows("send", Some("send")));
        assert!(kind_allows("send", Some("post")), "the sending family");
        assert!(kind_allows("submit", Some("send")));
        assert!(!kind_allows("other", Some("delete")), "a yes to 'Save as draft' never deletes");
        assert!(!kind_allows("send", Some("delete")));
        assert!(!kind_allows("delete", Some("pay")));
        assert!(kind_allows("delete", Some("trash")));
        assert!(kind_allows("pay", Some("check out")));
        assert!(kind_allows("accept_terms", Some("agree")));
        assert!(kind_allows("other", None), "an unreadable step the model named");
        assert_eq!(verb_kind("sign in"), "sign_in");
        assert_eq!(verb_kind("whatever"), "other");
    }

    #[test]
    fn opening_and_dropping() {
        use std::path::Path;
        for p in ["/Users/a/run.command", "/Users/a/setup.PKG", "/Users/a/x.sh", "/Users/a/Tool.workflow", "/Users/a/Docs.webloc", "/Users/a/Disk.dmg"] {
            assert!(runs_something(Path::new(p)), "{p}");
        }
        // Owner request, 12 October 2026: an app is decided by the app rule, not by its extension.
        for p in ["/Users/a/Q3 report.pdf", "/Users/a/notes.txt", "/Users/a/Invoices", "/Applications/Figma.app"] {
            assert!(!runs_something(Path::new(p)), "{p}");
        }
        let dock = |t: &str| AxBrief { role: "AXDockItem".into(), title: t.into(), description: String::new() };
        assert!(is_trash(&[dock("Trash")]));
        assert!(is_trash(&[AxBrief::default(), dock("Bin")]));
        assert!(!is_trash(&[dock("Finder")]));
        assert_eq!(dock_item_name(&[dock("Terminal")]).as_deref(), Some("Terminal"));
        assert_eq!(dock_item_name(&[AxBrief { role: "AXButton".into(), title: "Send".into(), description: String::new() }]), None);
    }

    /// A probe with a fixed home folder, quarantine values and executables (no real file is read).
    pub(crate) struct FakeProbe {
        pub home: Option<std::path::PathBuf>,
        pub quarantine: Vec<(String, String)>,
        pub exec: Vec<String>,
    }

    impl OpenProbe for FakeProbe {
        fn home(&self) -> Option<std::path::PathBuf> {
            self.home.clone()
        }
        /// macOS's usual default apps, by extension (no real lookup): certificates open Keychain Access, Alfred's
        /// workflows open Alfred Preferences, disk images DiskImageMounter; an unknown extension has no app.
        fn handler(&self, p: &std::path::Path) -> Option<AppId> {
            let (id, name) = match ext_of(p).as_str() {
                "pdf" | "png" | "jpg" | "jpeg" | "heic" => ("com.apple.Preview", "Preview"),
                "txt" | "md" | "rtf" | "csv" => ("com.apple.TextEdit", "TextEdit"),
                "docx" | "doc" => ("com.microsoft.Word", "Microsoft Word"),
                "xlsx" => ("com.microsoft.Excel", "Microsoft Excel"),
                "keynote" => ("com.apple.iWork.Keynote", "Keynote"),
                "kc" => ("com.apple.keychainaccess", "Keychain Access"),
                "alfredworkflow" => ("com.runningwithcrayons.Alfred-Preferences", "Alfred Preferences"),
                "vhd" => ("com.apple.DiskImageMounter", "DiskImageMounter"),
                "upd" => ("com.example.SomeUpdater", "Some Updater"),
                _ => return None,
            };
            Some(AppId { bundle_id: Some(id.into()), names: vec![name.into()] })
        }
        fn quarantine(&self, p: &std::path::Path) -> Option<String> {
            self.quarantine.iter().find(|(q, _)| std::path::Path::new(q) == p).map(|(_, v)| v.clone())
        }
        fn exec_file(&self, p: &std::path::Path) -> bool {
            self.exec.iter().any(|e| std::path::Path::new(e) == p)
        }
    }

    pub(crate) fn probe() -> FakeProbe {
        FakeProbe { home: Some("/Users/a".into()), quarantine: vec![], exec: vec![] }
    }

    /// Owner request, 12 October 2026 (companion2-spec B.1, B.4): apps from the Applications folders open; apps from
    /// elsewhere, apps from the internet never opened, installers, scripts, link files and executables never do.
    #[test]
    fn app_open_rules() {
        use std::path::Path;
        let mut p = probe();
        for ok in ["/Applications/Figma.app", "/Applications/Microsoft Office/Microsoft Word.app", "/System/Applications/Notes.app", "/System/Applications/Utilities/Console.app", "/Users/a/Applications/Chrome Apps.app", "/System/Library/CoreServices/Finder.app", "/Users/a/Documents/Q3 report.pdf", "/Users/a/Documents"] {
            assert_eq!(never_open(Path::new(ok), &p), None, "{ok}");
        }
        assert_eq!(never_open(Path::new("/Users/a/Downloads/Figma.app"), &p), Some(NeverOpen::OutsideApp));
        assert_eq!(never_open(Path::new("/Volumes/Figma/Figma.app"), &p), Some(NeverOpen::OutsideApp));
        assert_eq!(never_open(Path::new("/System/Library/CoreServices/Applications/Wireless Diagnostics.app"), &p), Some(NeverOpen::OutsideApp), "CoreServices only directly");
        // Review, 12 October 2026: CoreServices is Finder only; installers, updaters and Erase Assistant never open,
        // wherever they are.
        for bad in ["/System/Library/CoreServices/DiskImageMounter.app", "/System/Library/CoreServices/Database Events.app", "/System/Library/CoreServices/Certificate Assistant.app"] {
            assert_eq!(never_open(Path::new(bad), &p), Some(NeverOpen::OutsideApp), "{bad}");
        }
        for bad in [
            "/System/Library/CoreServices/Install Command Line Developer Tools.app",
            "/System/Library/CoreServices/Erase Assistant.app",
            "/System/Library/CoreServices/Rosetta 2 Updater.app",
            "/System/Library/CoreServices/Automator Installer.app",
            "/Applications/Install macOS Sequoia.app",
            "/Applications/Microsoft AutoUpdate.app",
            "/Applications/Zoom Uninstaller.app",
        ] {
            assert_eq!(never_open(Path::new(bad), &p), Some(NeverOpen::Runs), "{bad}");
        }
        assert_eq!(never_open(Path::new("/Applications/../Users/a/Downloads/x.app"), &p), Some(NeverOpen::OutsideApp));
        // The quarantine flag [the 0x0040 bit: opened apps on this Mac read 03c1; a never-opened one is UNVERIFIED].
        p.quarantine = vec![("/Applications/New.app".into(), "0083;6712a1b2;Safari;".into()), ("/Applications/Old.app".into(), "00c3;6712a1b2;Safari;".into()), ("/Applications/Bad.app".into(), "zz;".into())];
        assert_eq!(never_open(Path::new("/Applications/New.app"), &p), Some(NeverOpen::NewApp));
        assert_eq!(never_open(Path::new("/Applications/Old.app"), &p), None);
        assert_eq!(never_open(Path::new("/Applications/Bad.app"), &p), Some(NeverOpen::NewApp), "unreadable fails closed");
        assert_eq!(never_open(Path::new("/Applications/Plain.app"), &p), None, "no flag: not from the internet");
        assert!(!quarantine_unapproved(Some("03c1;68f0;Chrome;")));
        assert!(quarantine_unapproved(Some("0081;68f0;Chrome;")));
        assert!(!quarantine_unapproved(None));
        // Installers, scripts, link files, executables.
        for bad in [
            "/Users/a/Downloads/Setup.pkg",
            "/Users/a/Downloads/Figma.dmg",
            "/Users/a/run.command",
            "/Users/a/x.SH",
            "/Users/a/Site.webloc",
            "/Users/a/Profile.mobileconfig",
            "/Applications/Figma.app/Contents/MacOS/Figma",
            "/Users/a/Downloads/ubuntu.iso",
            "/Users/a/Downloads/disk.img",
            "/Users/a/Downloads/old.toast",
            "/Users/a/Downloads/backup.sparseimage",
            "/Users/a/Downloads/root-ca.cer",
            "/Users/a/Downloads/root-ca.CRT",
            "/Users/a/Downloads/chain.p7b",
            "/Users/a/Downloads/dev.mobileprovision",
        ] {
            assert_eq!(never_open(Path::new(bad), &p), Some(NeverOpen::Runs), "{bad}");
        }
        p.exec = vec!["/Users/a/bin/tool".into()];
        assert_eq!(never_open(Path::new("/Users/a/bin/tool"), &p), Some(NeverOpen::Runs), "no extension and an execute bit");
        assert_eq!(never_open(Path::new("/Users/a/README"), &p), None);
        assert_eq!(RUNS_EXT.len(), INSTALLER_EXT.len() + SCRIPT_EXT.len() + LINK_EXT.len());
        for e in INSTALLER_EXT.iter().chain(SCRIPT_EXT).chain(LINK_EXT) {
            assert!(RUNS_EXT.contains(e), "{e}");
        }
        assert!(!RUNS_EXT.contains(&"app"));
    }

    /// The tables are companion2-spec B.2's, word for word (the server's `OPEN_RUNS_EXT` and `SECRET_EXT` are pinned to
    /// the same text).
    #[test]
    fn never_open_names() {
        use std::path::Path;
        assert_eq!(INSTALLER_EXT.join(" "), "pkg mpkg dmg mobileconfig prefpane kext osax iso img cdr sparseimage sparsebundle toast udif cer crt der p7b p7c provisionprofile mobileprovision");
        assert_eq!(SCRIPT_EXT.join(" "), "command tool sh zsh bash csh ksh fish py pl rb php js scpt scptd applescript workflow terminal action jar shortcut");
        assert_eq!(LINK_EXT.join(" "), "webloc inetloc fileloc");
        assert_eq!(SECRET_EXT.join(" "), "kdbx kdb 1pux 1pif opvault agilekeychain keychain keychain-db p12 pfx pem key ovpn gpg pgp asc psafe3");
        for s in ["/Users/a/Vault.kdbx", "/Users/a/.env", "/Users/a/.env.local", "/Users/a/login.keychain-db", "/Users/a/id.PEM"] {
            assert!(secret_file(Path::new(s)), "{s}");
        }
        assert!(!secret_file(Path::new("/Users/a/keys.txt")));
        assert!(!secret_file(Path::new("/Users/a/environment.md")));
        // Password exports (review, 12 October 2026), and what they must not catch.
        for s in ["Passwords.csv", "Chrome Passwords.csv", "passwords_2026.CSV", "bitwarden_export_20261012.csv", "lastpass_export.csv", "1Password Export.csv", "Keeper Export.csv", "nordpass backup.json", "my-passwords.txt"] {
            assert!(secret_file(&Path::new("/Users/a/Downloads").join(s)), "{s}");
            assert!(password_export(s), "{s}");
        }
        for s in ["Q3 report.pdf", "Export plan.docx", "Vault tour notes.md", "Keeping track.xlsx", "Backup checklist.txt"] {
            assert!(!secret_file(&Path::new("/Users/a/Documents").join(s)), "{s}");
        }
        // Names on the never-act list are refused by name, whatever folder they are in.
        assert_eq!(no_act(&app(None, &["Terminal"]), &[]).as_deref(), Some("Terminal"));
        assert_eq!(no_act(&app(None, &["System Settings"]), &[]).as_deref(), Some("System Settings"));
        assert_eq!(no_act(&app(None, &["Figma"]), &[]), None);
        assert_eq!(app_folders(None).len(), 5, "without a home folder, its Applications folder is left out");
    }

    /// Review, 12 October 2026: the app that would open a file is checked, so a certificate never reaches Keychain
    /// Access, a workflow never reaches Alfred and a disk image never mounts.
    #[test]
    fn handler_rules() {
        use std::path::Path;
        let p = probe();
        let h = |f: &str| p.handler(Path::new(f)).map(|a| handler_refused(&a, &[]));
        assert_eq!(h("/Users/a/Downloads/root.kc"), Some(Some("Keychain Access".into())), "never-look");
        assert_eq!(h("/Users/a/Downloads/Clipboard.alfredworkflow"), Some(Some("Alfred Preferences".into())), "never-act");
        assert_eq!(h("/Users/a/Downloads/disk.vhd"), Some(Some("DiskImageMounter".into())));
        assert_eq!(h("/Users/a/Downloads/patch.upd"), Some(Some("Some Updater".into())), "installer-like by name");
        assert_eq!(h("/Users/a/Documents/Q3 report.pdf"), Some(None));
        assert_eq!(h("/Users/a/Documents/notes.unknownext"), None, "no app: the caller decides (Brenda's own open refuses)");
        let rules = vec![Rule { name: "Preview".into(), bundle_id: None, source: RuleSource::You }];
        assert_eq!(p.handler(Path::new("/Users/a/x.pdf")).and_then(|a| handler_refused(&a, &rules)).as_deref(), Some("Preview"), "the person's own list");
        assert!(installer_like(&["Install macOS Sequoia".into()], None));
        assert!(installer_like(&["Anything".into()], Some("com.apple.InstallAssistant.macOSSequoia")));
        assert!(!installer_like(&["Figma".into(), "Eraser Notes".into()], Some("com.figma.Desktop")));
    }

    #[test]
    fn sharing_full_screen_and_the_screenshot_tool() {
        assert!(sharing_suspected(&["us.zoom.CptHost".into()], &[]));
        assert!(sharing_suspected(&[], &["CptHost".into()]));
        assert!(!sharing_suspected(&["us.zoom.xos".into()], &["zoom.us".into()]));
        assert!(screenshot_tool_running(&["com.apple.screencaptureui".into()]));
        assert!(!screenshot_tool_running(&["com.apple.finder".into()]));
        let d = Bounds { x: 0.0, y: 0.0, w: 1512.0, h: 982.0 };
        assert!(is_full_screen(Bounds { x: 0.5, y: 0.0, w: 1512.0, h: 982.0 }, d));
        assert!(!is_full_screen(Bounds { x: 0.0, y: 33.0, w: 1512.0, h: 949.0 }, d));
    }
}
