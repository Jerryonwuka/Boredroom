// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Chrome starts this binary as Brenda's native messaging host with the extension's origin as its first argument
    // (Brenda in Chrome, phase 2): it only relays to the running app, and never starts Tauri.
    if let Some(origin) = std::env::args().nth(1).filter(|a| a.starts_with("chrome-extension://")) {
        std::process::exit(brenda_desktop_lib::browser::relay_main(&origin));
    }
    brenda_desktop_lib::run()
}
