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
- Her natural voice (when the person chose one, see "Her natural voice" below):
  `POST /api/orgs/:org/assistant/speech` with the reply's signed token and words, `as: "base64"`.
- On the computer, it only opens Boredroom links in the browser. No files, keyboard, other apps or screen.

## Talking to Brenda (hold to talk)

Off until the person turns it on (the mic button on a card, or **Turn voice on** in the tray). Then:

1. Hold **Option+Space** (Alt+Space on Windows) and speak. The microphone records only while the keys are held, up to
   30 seconds, and the notch's voice card shows Brenda listening, a pulsing orange dot with the running time, and the
   live waveform (ElevenLabs' recording look) moving with your voice.
2. Let go. whisper.cpp turns the audio into text on this computer (`ggml-base.en.bin`, about 148 MB, downloaded once
   from Hugging Face into the app's data folder). No audio leaves the computer.
3. The text goes to `POST /api/orgs/:org/assistant/chat` with the last few spoken turns, so Brenda acts with the
   person's own permissions and logs every action. Anything that needs a yes shows **Confirm**, which calls
   `POST /api/orgs/:org/brenda/confirm`; an answer of `ALREADY_CONFIRMED` (pressed twice, or confirmed in Boredroom
   meanwhile) counts as done. Errors from Boredroom reach the page with their `code` for this.
4. The reply is shown and, by default, spoken with the system voice (`say` on macOS, System.Speech on Windows), or with
   the natural voice the person chose in Boredroom; see "Her voice" and "Her natural voice" below. Pressing the shortcut
   again cuts her off.

The bundled app asks for microphone access the first time (`Info.plist`). "Hey Brenda" (Porcupine) comes next and only
replaces the trigger in step 1.

The voice card (owner decision, 7 October 2026: ElevenLabs' recording look) shows Brenda's face listening (her eyes
widen and swell with your voice, her glow with them), "Listening…", the pulsing orange dot and the running time in
orange digits, and under them a 40px live waveform: thin white bars scrolling in from the right as loud as your voice,
the edges fading into the island, fed by the ~70 ms level events. Once the keys come up the time stops, your words show
in italic quotes, the title shimmers and the bars become a slow travelling wave. A faint orange wash rises from the
bottom while the microphone is open. It matches dictation and voice notes in the web app
(`src/components/app/voice-capture.tsx` and `src/components/ui/live-waveform.tsx`; the notch's `Wave` in `src/main.js`
is a plain-JavaScript port of the latter, under the same MIT notice): change one, change the other. The round orb is
kept only for the speech model's download.

## Her voice

Owner decision, 7 October 2026 (personal assistants, phase 2). She reads her replies aloud with the computer's own
voice: on a Mac, the system voice (System Settings › Accessibility › Spoken Content › System voice; the notch has no
voice picker of its own). Since 9 October 2026 she can also speak with a natural voice from ElevenLabs, when the person
chose one in Boredroom (see "Her natural voice" below); the computer's voice is still the default and always the
fallback.

- **When:** as the person chose in Boredroom (Settings › Your assistant › Voice), carried by the desktop state as
  `assistant.speak`: `voice` (the default) reads the answer to something said with the talk keys, `always` every
  answer, typed or spoken, `never` none. A **Listen** button on the reply card reads that answer on demand whatever the
  choice, and turns to **Stop** (an orange square) while she speaks.
- **What:** the speakable version the server sends with each answer (`spoken` from `POST /assistant/chat`: no Markdown,
  links, ids or tokens, about three sentences); with an older server, the plain words of the reply.
- **Her face while she talks:** on macOS `voice.rs` renders the words with `say -o` to a temporary 16-bit WAVE file,
  measures its loudness every 30 ms, plays it with `afplay` and sends `speaking` events with that level on
  `brenda://voice`, timed to the playback, then one `spoken` (`interrupted` when cut off); the file is deleted
  afterwards. Her own faces talk with it (`.face.talk`): her eyes squash and open with each syllable, she bobs a little
  and her glow brightens in her own colour. If rendering fails (and on Windows), she is spoken the plain way and the
  page makes the syllables itself (`synthetic`). Under reduced motion she holds a still speaking pose.
- **One voice at a time:** a new answer replaces the last. She stops on Stop, typing in the ask box, asking something
  new, closing the card (Done, Esc), opening a link or the chat, the talk keys and signing out, and never speaks while
  the microphone is open. The card stays open while she talks.

## Her natural voice

Owner decision, 9 October 2026 (natural voice (ElevenLabs), "use your recommendations"). Each person can pick one of
eight curated ElevenLabs voices for their assistant in Boredroom (Settings › Your assistant › Voice); "Computer voice"
stays the default. The choice is saved to their account, so the notch uses it too. Nothing new is chosen up here.

- **How it gets here:** when a natural voice is chosen, Boredroom adds a `speech` offer to each answer she may read
  aloud (`POST /assistant/chat`, `/brenda/confirm`, `/brenda/undo`): `{ path, token, text }`, a token signed for exactly
  those words, for this person, for 30 minutes. `sayAloud` sends it to `POST /api/orgs/:org/assistant/speech` with
  `as: "base64"` through Rust's `api` command (the webview has no bearer token, and the CSP allows no media URL), and
  `src/natural-voice.js` (`NaturalVoice`) decodes the MP3 with Web Audio (`decodeAudioData`, no URL involved), plays it
  through an `AnalyserNode` and sends the level of what plays every animation frame, so her talking face follows the
  real audio, with the same maths as the web (`src/lib/assistant-speech/level.ts`). Speed is always normal up here.
- **When it is not used, the computer voice speaks at once:** the audio context will not run within 300 ms (checked
  before asking, so no characters are spent; a context that is only slow to wake, such as AirPods, costs that one reply,
  and only one that refuses or is still not running after 2 s leaves the natural voice alone for the rest of the run;
  review, 9 October 2026), Boredroom
  refuses (`VOICE_UNAVAILABLE`: a daily cap, the month's allowance running low, ElevenLabs failing, no key), no answer
  within 15 s (a late answer is not played, only kept for Listen again), audio that will not decode, or an expired token (Listen more than 30 minutes
  later). The notch never goes silent. A failure after she started ends that reply (it is not said again from the top).
- **Unchanged:** Voice off and quiet hours decide whether she speaks; the offer only decides how. Stop, typing to her,
  a new question, closing the card, the talk keys (at once, even while the audio is still being fetched) and signing out
  stop the natural voice too, and she never starts it over an open microphone. Listen on a reply card reuses the card's
  offer, and plays audio already heard from memory (the last three replies), so it is not paid for twice. Past chats
  keep no token. The audio context sleeps 1.8 s after the last sound, and after a refusal or a hush too, so an idle
  notch costs no CPU.
- **Privacy:** the words she says aloud in a natural voice go to Boredroom, which sends them to ElevenLabs; nothing is
  stored on this computer, and the audio lives only in memory (while it plays, and for Listen again). ElevenLabs keeps
  each one in the History of the key's account; Boredroom deletes it from there once it has been said. Only reasons (never words or tokens) are
  written to the app's log when the computer voice had to step in.

### For later: playing it in Rust (not done; `src-tauri` unchanged)

Tauri 2.12 / wry 0.57 create the WKWebView with autoplay on (`mediaTypesRequiringUserActionForPlayback = None`), so Web
Audio should start without a press, as `src/sound.js` already does. If the real notch shows otherwise (the app's log
says "natural voice: the computer voice spoke instead (suspended)" and, after the first 2 s without sound, she always
uses the computer voice), or to stream
instead of waiting for the whole base64 answer, the change is in Rust:

1. A command `speak_natural { path, token, text }` in `lib.rs`/`voice.rs` that POSTs to the speech route with the bearer
   token (`as: "stream"`, or a `format: "pcm"` variant of the route), writes the audio to a temporary file (removed after,
   as `speak_rendered` does), plays it with `afplay`, measures it for the `speaking` level events as `speak_rendered`
   measures `say`'s render, then sends `spoken`.
2. It honours `halt()` (the talk keys, Stop, sign out, quit), never plays over an open microphone (`unspoken`), and falls
   back to `speak()` (the computer voice) on any failure.
3. `main.js` then calls `invoke("speak_natural", offer)` in place of the `api` call and `NaturalVoice.play`, and the
   `brenda://voice` events drive her face as for `say`.
4. Optionally, `media-src 'self' blob:` in the CSP (`tauri.conf.json`), if the page ever plays a URL itself.

Rebuilding `src-tauri` restarts the notch, so this waits for the owner's go-ahead.

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
  text in secondary, and danger is outline with red text. Each card may have one orange button (`.btn.accent`, orange
  with near-black text) for its one thing to do: Link to Boredroom, Open Boredroom, Start on the briefing, Resume on a
  paused timer, Turn on voice. Save, OK, Done, Got it, Confirm and Send for review stay white. The send button is
  round, orange once there is something to send and grey until then; while it is orange, the card's other orange
  button turns white, so two never show at once.
- **Badges:** neutral on fill-1, green and amber as 12% washes. The orange "New" badge is used for a new task, and the same
  orange on dark brown for the unread count.
- **Orange marks what is live, active or the one thing to do** (the web's accent rules, `docs/design-system.md`): the
  focus ring (2px at 50%) and the ask box's ring while it has focus, the unread count, the running timer's breathing
  dot and its digits (on the timer card and in the compact bar), Brenda listening (the live dot and running time beside
  the waveform, and the wash)
  and working, download and upload bars, teammates' running dots, the timer's estimate hairline and progress ring
  (green when done), the one orange button per card, and the underline of a hovered link. Paused stays amber and
  interrupted red: status meaning wins over orange.
- **No gradients, glass or glow,** apart from the four the web keeps for Brenda: the orb's tool-tile fill, the waiting
  shimmer, the listening wash, and the soft light around her face for a reminder, success, a Confirm, an error or her
  listening (the waveform's edge fade is drawn on its canvas, as ElevenLabs draws it).
- **Type:** copy is sentence case, in Brenda's voice, with commas rather than middle dots.
- **The island itself stays true black,** because it meets the screen's own notch, where #0F0F10 would show as a grey
  frame around the camera; its open edge is a 7.5% hairline with the web's toast shadow.

Brenda's face, moods and reactions match `.brenda-face` on the web (white, flat, orange heart eyes). Links to the Reports
and Policy pages, which are gone, are never offered. The app icon stays as it is until the owner supplies a vector or
high-resolution "B." mark: the current artwork is only 58px tall, too small for a desktop icon set.

## Layout preview without Rust

`preview.html` runs the notch in an ordinary browser with sample data
(`?state=link|compact|briefing|timer|paused|reminder|report|lead|idle`) and can open one of Brenda's cards on top
(`&card=listening|working|thinking|reply|confirm|offer|error|drop|voice-off|typing|speaking`; `&confirm=already` answers the
Confirm as already done; `&typed=…` fills the open card's ask box, to show Send turning orange). `card=listening` feeds
the waveform and her listening face a speech-like level every 70 ms, as Rust does; `card=working` listens for two
seconds and then writes the words out, to show the bars turning into the travelling wave; `card=typing` types a question
into the ask box letter by letter, to show her eyes reading along. `card=speaking` opens a reply and feeds her talking
face a speech-like level every 30 ms for four seconds, as Rust does while she reads it aloud (`&synthetic` sends the
fallback's start instead, and the page pulses her eyes itself); Listen and Stop work on any reply, and
`&speak=always|never` sets when she speaks. Her natural voice: `&natural` gives every answer a `speech` offer and the mock
speech route a 2-second WAV made in the page (a hum with syllables; no network, never ElevenLabs), so Listen and anything
read aloud plays through Web Audio and her face follows the measured level; `?card=speaking&natural` presses Listen for
you. `&natural=fail` (502 `VOICE_UNAVAILABLE`), `slow` (answers after 16 s: the computer voice takes over at 15 s and the
late audio is dropped), `suspended` (the audio context never runs: the computer voice at once, no request, and after
2 s the natural voice is off for the run),
`decode` (bytes that are not audio) and `listen` (the talk keys go down while it plays: it stops at once) show each
fallback; the mock computer voice logs `speak` in the console. Serve this folder with any static server and open it
(for example `python3 -m http.server 4517` in `desktop/`, then `http://127.0.0.1:4517/preview.html?card=speaking&natural`);
it is not part of the app. A browser that wants a press before it plays sound shows "Press anywhere to start" first. To
see it in WebKit, as the notch does, open the same address in Safari by hand (Develop › Show JavaScript Console for the
logs); Safari also wants a press first, which the notch does not.

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
(a reminder, success, something to confirm, an error, listening, thinking). Her reactions (owner request, 7 October
2026) match the web's: while you type in the ask box her eyes go to it and follow the caret (reading along); while you
hold to talk her eyes widen and swell with your voice (listening); sending, she thinks; her reply pleases her (happy
eyes and a small hop). Sounds are synthesised in `src/sound.js`
(no audio files) and can be switched off from the tray. Keys while the notch has focus: Esc closes, Y and N answer a
Confirm.

Also:

- **Drop a file on Brenda** to attach it to one of your open tasks and send it for review (PDF, PNG, JPEG, WebP, TXT,
  up to 25 MB). Rust keeps the paths of what was dropped and uploads only those (`files.rs`), through the normal task
  upload, then the page submits the task with an optional note.
- **Teammates' faces:** team leads and organisation accounts see a small face per person working (orange dot running,
  amber paused, red interrupted, as on the web's timer) in the compact bar, and an outline chip per teammate in the day
  card that opens the Workroom.
- **Tucks away when idle** (no card, no timer, nothing unread) to a thin sliver, and peeks out when the pointer reaches
  the top of the screen around it. **Keep Brenda always visible** in the tray turns this off.
- **Reactions:** click her face to poke her, three quick pokes make her dizzy, and resting the pointer on her gives her
  heart eyes.

These techniques and timings come from [Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé (MIT licence,
code only). Coucou's character, sounds, icon and name are not used: its asset licence reserves them.
