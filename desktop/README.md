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

   The first build compiles the Rust dependencies and takes a few minutes; later starts take seconds. Voice needs
   `cmake` to build whisper.cpp (`pip3 install --user cmake`, then add `~/Library/Python/3.9/bin` to `PATH`, or install
   it with Homebrew).

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
- Past chats: what is said or typed to Brenda up here is kept with her chats in Boredroom
  (`POST` and `PUT /api/orgs/:org/brenda/conversations`), privately to the person, so it shows in Past chats on her
  page; **Open chat** on a reply carries it on there (`/app/:org/home?chat=…`) and hands it over: the next thing said
  up here starts a new conversation, so the notch never writes over what was added on the web. Each `PUT` carries
  `expectedUpdatedAt`; when the chat was saved somewhere else meanwhile it is refused (409), the copy there stands, and
  what was said up here since goes into a new conversation. One conversation per run of talk (it ends after a few
  quiet minutes). As on the web, a Confirm is kept without its token.
- What Brenda's built-in helper offers as one press (a to-do, clocking in or out, starting a timer) goes through
  `POST /api/orgs/:org/todos`, `/clock/in`, `/clock/out` and `/sessions/start`.
- On the computer, it only opens Boredroom links in the browser. No files, keyboard, other apps or screen.

## Talking to Brenda (hold to talk)

Off until the person turns it on (the mic button on a card, or **Turn voice on** in the tray). Then:

1. Hold **Option+Space** (Alt+Space on Windows) and speak. The microphone records only while the keys are held, up to
   30 seconds, and the notch shows "Mic on" with a pulsing red dot.
2. Let go. whisper.cpp turns the audio into text on this computer (`ggml-base.en.bin`, about 148 MB, downloaded once
   from Hugging Face into the app's data folder). No audio leaves the computer.
3. The text goes to `POST /api/orgs/:org/assistant/chat` with the last few spoken turns, so Brenda acts with the
   person's own permissions and logs every action. Anything that needs a yes shows **Confirm**, which calls
   `POST /api/orgs/:org/brenda/confirm`; an answer of `ALREADY_CONFIRMED` (pressed twice, or confirmed in Boredroom
   meanwhile) counts as done. Errors from Boredroom reach the page with their `code` for this.
4. The reply is shown and spoken with the system voice (`say` on macOS, System.Speech on Windows). Pressing the
   shortcut again cuts her off.

The bundled app asks for microphone access the first time (`Info.plist`). "Hey Brenda" (Porcupine) comes next and only
replaces the trigger in step 1.

The voice card (the round orb whose orange dot and ring swell with your voice, "Mic on" with a red dot, your words in
italic quotes, the shimmer while she works, a faint orange wash while the microphone is open) matches dictation and
voice notes in the web app (`src/components/app/voice-capture.tsx`, the compact card): change one, change the other.

## Look

Boredroom's design system v4 (owner decision, 6 October 2026: the ElevenLabs app's design language, with orange kept as
the accent), dark only. The tokens in `src/style.css` are copied from `src/app/globals.css` and keep its v4 names
(`--background` #0F0F10, `--foreground`, `--secondary` white 64%, `--subtle` 53%, `--border` 7.5%, `--border-input` 10%,
`--fill-0`/`--fill-1`/`--fill-150`, `--primary`, `--accent`, `--ring` and the rest); `docs/design-system.md` describes
them. Inter (UI text, 14/20 medium for titles, 13/19.5 for what goes under them) and Geist Mono (the clock, the link
code) are bundled in `src/fonts` (SIL Open Font License, `OFL.txt`); the notch loads nothing remote.

- **Surfaces:** panels, fields and outline buttons are near-black #0F0F10 with white 7.5% to 10% hairlines. Lists sit in
  one panel with calm 32px rows and no lines between them. The prompt is the web's prompt pill at the notch's size.
- **Buttons:** 28px pills, 13px medium. The primary is white with near-black text, the secondary is outline, the ghost is
  text in secondary, and danger is outline with red text. The send button is round, white once there is something to
  send and grey until then.
- **Badges:** neutral on fill-1, green and amber as 12% washes. The orange "New" badge is used for a new task, and the same
  orange on dark brown for the unread count.
- **Orange, used rarely:** the focus ring (2px at 50%), the unread count, the open microphone (orb, ring and wash), and
  the timer's estimate hairline and progress ring.
- **No gradients, glass or glow,** apart from the four the web keeps for Brenda: the orb's tool-tile fill, the waiting
  shimmer, the listening wash, and the soft light around her face for a reminder, success, a Confirm or an error.
- **Type:** copy is sentence case, in Brenda's voice, with commas rather than middle dots.
- **The island itself stays true black,** because it meets the screen's own notch, where #0F0F10 would show as a grey
  frame around the camera; its open edge is a 7.5% hairline with the web's toast shadow.

Brenda's face, moods and reactions match `.brenda-face` on the web (white, flat, orange heart eyes). Links to the Reports
and Policy pages, which are gone, are never offered. The app icon stays as it is until the owner supplies a vector or
high-resolution "B." mark: the current artwork is only 58px tall, too small for a desktop icon set.

## Layout preview without Rust

`preview.html` runs the notch in an ordinary browser with sample data
(`?state=link|compact|briefing|timer|paused|reminder|report|lead|idle`) and can open one of Brenda's cards on top
(`&card=listening|working|thinking|reply|confirm|offer|error|drop|voice-off`; `&confirm=already` answers the Confirm as
already done). Serve this folder with any static server and open it; it is not part of the app.

## Build installers

```bash
pnpm build
```

Produces a `.dmg` on macOS and an `.msi`/`.exe` on Windows under `src-tauri/target/release/bundle/`. Code signing
(Apple Developer ID, a Windows certificate) is configured separately before distributing.

## Motion, face and sounds

The window is a fixed, transparent 480 × 440 stage at the top centre of the screen; the island inside it springs open
(520 ms with a slight overshoot) and eases shut (340 ms). Clicks pass through the empty part of the stage: a small Rust
thread reads the cursor about 30 times a second and only lets the window take the mouse over the island (`island.rs`),
and the same feed moves Brenda's eyes. She blinks, breathes, and her face and the card's glow follow what is happening
(a reminder, success, something to confirm, an error, listening, thinking). Sounds are synthesised in `src/sound.js`
(no audio files) and can be switched off from the tray. Keys while the notch has focus: Esc closes, Y and N answer a
Confirm.

Also:

- **Drop a file on Brenda** to attach it to one of your open tasks and send it for review (PDF, PNG, JPEG, WebP, TXT,
  up to 25 MB). Rust keeps the paths of what was dropped and uploads only those (`files.rs`), through the normal task
  upload, then the page submits the task with an optional note.
- **Teammates' faces:** team leads and organisation accounts see a small face per person working (green dot running,
  amber paused, red interrupted, as on the web's timer) in the compact bar, and an outline chip per teammate in the day
  card that opens the Workroom.
- **Tucks away when idle** (no card, no timer, nothing unread) to a thin sliver, and peeks out when the pointer reaches
  the top of the screen around it. **Keep Brenda always visible** in the tray turns this off.
- **Reactions:** click her face to poke her, three quick pokes make her dizzy, and resting the pointer on her gives her
  heart eyes.

These techniques and timings come from [Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé (MIT licence,
code only). Coucou's character, sounds, icon and name are not used: its asset licence reserves them.
