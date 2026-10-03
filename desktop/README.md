# Brenda desktop

Brenda in a notch at the top of the screen: the running timer, the morning briefing, reminders and nudges, and
automatic clock-in, for staff and team leads in a Boredroom workspace. Built with Tauri 2 (Rust core, plain HTML,
CSS and JavaScript in `src/`, no front-end build step). Runs on macOS and Windows.

## First run

1. Install Rust once (official installer, about 1 GB, installs into your home folder):

   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. Start Boredroom (`pnpm dev` in the repository root), then the desktop app:

   ```bash
   cd desktop && pnpm install --ignore-workspace && pnpm dev
   ```

   The first build compiles the Rust dependencies and takes a few minutes; later starts take seconds.

3. In the notch, click the address under "Hi, I'm Brenda" and set it to `http://localhost:3000`, then press
   **Link to Boredroom**. Your browser opens Boredroom's approval page with the code filled in; approve it for a
   workspace. The notch signs in within a few seconds.

## How it signs in

A device code, never a password. The app asks Boredroom for a code (`POST /api/desktop/link`), the person approves it
on `/desktop/link` while signed in, and the app claims a desktop session (`POST /api/desktop/link/poll`) that lasts 90
days. The token is kept by the Rust side in the app's config folder (`brenda.json`, readable only by you) and sent as a
bearer token; the web view never sees it. Linked computers are listed on `/desktop/link`, where each can be unlinked,
which signs the app out at once. The tray menu also has **Sign out of this computer**.

## What it reads and does

- One poll every 20 seconds: `GET /api/orgs/:org/brenda/desktop` (briefing, timer, clock, unread notifications).
- Every 10 minutes while running: `POST /api/orgs/:org/brenda/presence`, the signal for automatic clock-in. Boredroom
  only clocks the person in if the organisation and the person allow it, on a working day, within working hours.
- Timer: start, pause, resume and stop through `/api/orgs/:org/sessions/…`; the progress ring through
  `PATCH /api/orgs/:org/tasks/:id`. Notifications are marked read when dismissed.
- On the computer, it only opens Boredroom links in the browser. No files, keyboard, other apps, screen or microphone.

## Layout preview without Rust

`preview.html` runs the notch in an ordinary browser with sample data (`?state=link|briefing|timer|reminder`). Serve
this folder with any static server and open it; it is not part of the app.

## Build installers

```bash
pnpm build
```

Produces a `.dmg` on macOS and an `.msi`/`.exe` on Windows under `src-tauri/target/release/bundle/`. Code signing
(Apple Developer ID, a Windows certificate) is configured separately before distributing.
