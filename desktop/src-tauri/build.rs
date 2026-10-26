fn main() {
    // Brenda Look (owner decisions, 11 October 2026): ScreenCaptureKit is linked weakly, so the app still starts on a Mac
    // older than macOS 12.3, where the framework does not exist; `capture::supported()` checks macOS 14 and the class
    // before anything touches it. PDFKit (file work's text of large PDFs, owner request 12 October 2026) is weak too.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,ScreenCaptureKit");
        println!("cargo:rustc-link-arg=-Wl,-weak_framework,PDFKit");
    }
    // The app's ACL (companion-spec 0b.14, owner rule 12 October 2026): with an app manifest, Tauri allows an app command
    // only to the windows a capability names, and `capabilities/default.json` names only the notch. The companion, ring,
    // outline and render windows show model text and can call no command at all, so no page that shows model text can
    // ever press Yes. Every command registered in `generate_handler!` is listed here (a test checks). Brenda and her
    // helpers (owner brief, 12 October 2026): the front desk's and the jobs' commands, the notch's only.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "get_config",
        "voice_status",
        "set_voice",
        "speak",
        "speak_queue",
        "stop_speaking",
        "set_base_url",
        "sign_out",
        "api",
        "link_start",
        "link_poll",
        "open_in_browser",
        "focus_notch",
        "set_island_rect",
        "menu_bar_height",
        "debug_log",
        "upload_dropped",
        "look_status",
        "set_screen_help",
        "look_set_options",
        "look_request_permission",
        "look_open_privacy_settings",
        "look_now",
        "look_send",
        "look_follow_up",
        "look_drop_held",
        "look_discard",
        "set_call_state",
        "set_look_rules",
        "companion_set_look",
        "companion_speaking",
        "act_status",
        "act_set_use_mac",
        "act_set_file_work",
        "act_request_accessibility",
        "act_open_accessibility_settings",
        "act_answer",
        "act_stop",
        "act_continue",
        "act_expect_answer",
        "act_file_from_drop",
        "act_reveal",
        "act_open_output",
        "help_setup",
        "help_request_finder",
        "help_request_folders",
        "help_open_privacy",
        "front_send",
        "front_answer",
        "front_choose",
        "front_more",
        "front_undo",
        "front_stop",
        "speak_now",
        "click_consent",
        "files_add_folder",
        "files_remove_folder",
        "job_stop",
        "job_answer",
        "job_continue",
        "job_undo",
        "job_open_output",
        "job_reveal_output",
        "job_show_folder",
        "job_list",
        // Updates (owner request, 24 October 2026).
        "update_status",
        "update_install",
    ])))
    .expect("failed to run tauri-build");
}
