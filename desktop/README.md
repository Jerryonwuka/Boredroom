# Boredroom for Mac

One app, `Boredroom.app` (owner decision, option A, 24 October 2026): the whole Boredroom dashboard in its own Mac
window, and Brenda (the person's own assistant, by whatever name they gave it) in the notch, signed in once for both.
The bundle identifier stays `cc.boredroom.brenda`, so `brenda.json` and the Mac's permissions carry over from the
notch-only app.

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

3. In the notch, click the address under "Sign in to Boredroom" and set it to `http://localhost:3000`, then press
   **Sign in**: the Boredroom window opens at the sign-in page, and signing in there signs the notch in too. Or press
   **Use a code instead**: your browser opens Boredroom's approval page with the code filled in; approve it for a
   workspace, and the notch signs in within a few seconds. (Under `tauri dev` the browser can't hand back to the app
   through `boredroom://`, so sign in inside the window, or use the code.)

## The Boredroom window

`dashboard.rs` (owner request, 24 October 2026). One window, label `boredroom`, made on demand and destroyed when it is
closed (⌘W or the red button; it asks first during a call). It opens from the Dock icon (also when Boredroom isn't
running), from the notch (**Sign in**, **Open Boredroom**, and every link to an app page: calls, notifications,
routines, follow-ups, open chat), from **Open Boredroom** in the menu-bar menu, from ⌘, (Settings), from a
`boredroom://open?path=…` link, and at launch (not after an update restart that had it closed, and not at login).
While it exists Boredroom is an ordinary Mac app (a Dock icon, ⌘Tab, the menu bar: Boredroom, Edit, View, Window, Help;
`appmenu.rs`); 1.5 s after it is destroyed Boredroom is a menu-bar app again, and the notch carries on (notifications and
calls keep working with the window closed). `dashboard.json` (0600, beside `brenda.json`) keeps its frame, zoom and last
page, `dockIcon` (set it to `false` to keep Boredroom out of the Dock even with the window open), the one-time quit
explanation's "Don't ask again", and whether an update restart had it open. ⌘Q quits everything, the notch too: asked
once while the window is open, and always during a call or a task.

Its user agent is Safari's plus `BoredroomDesktop/<version>`; the web uses the token for the interface only (hard
navigations at sign-in and sign-out, the connector bridge, no Mac card), never for security. Downloads land in Downloads
with the quarantine a browser sets (`downloads.rs`); the file picker is macOS's own; files dropped on the window go to
the page. Offline, the window shows "Boredroom can't connect." with Try again. A crashed page reloads.

## The Boredroom window's chrome

Owner request, 26 October 2026 (the Mac app shell): the window looks like a Mac app, not a browser. `dashboard.rs` makes it with the Overlay title bar style and a hidden title (the title still names the window in the Window menu and Mission Control), the traffic lights at (20, 32) so they sit in the web app's floating sidebar (`chrome::TRAFFIC_LIGHTS`), a transparent page over macOS's sidebar vibrancy, and the theme the page last showed (`dashboard.json`'s `theme`). The web app does the rest when it sees the window's user agent (globals.css, "Boredroom for Mac's window"; development: `?shell=mac` in a browser).

`chrome.rs` keeps the window IPC-free while doing what a title bar does. Twice a second while the window shows, and after each page load, the app runs one fixed script in WebKit's isolated client world (`PROBE_JS`: the page's own scripts can't touch it) that returns the page's theme and the rectangles that move the window (the margins round the floating panels, the sidebar's top row, the top bar, less anything clickable in them; nothing while a dialog, a menu or the assistant's panel is open; the top 40 points on other pages and the offline page). A transparent native view over the web view claims exactly those points (`hitTest:`) and hands a press to macOS (`performWindowDragWithEvent:`; a double click follows System Settings: zoom, minimise or nothing); every other point falls through to the page. The answer is parsed defensively (at most 240 rectangles, finite numbers, one word for the theme); the worst a page could do is make its own top bar move the window or not. The window's appearance follows the page's theme, so the vibrancy and the traffic lights match.

Menus (`appmenu.rs`): File › New To-do (⌘N, the to-do list with its new row open), Go › the assistant's page, My Day, To-dos, Tasks, Commitments, Messages, Calls, Docs, Notifications (⌘1–⌘9; owners and HR are sent on where those belong), in the workspace the window shows, else the one this Mac is linked to. Inside the app's own pages the move is the web router's (`window.__boredroomShell.go`, which only accepts `/app/…` paths); the app never reads anything back. ⌘, Settings, ⌘[ ⌘] Back and Forward and ⌘R Reload were already there.

The Dock's badge is the unread notifications count the notch's state already carries (`notificationsUnread`, read as it passes through the `api` command; "99+" past 99), cleared on sign-out.

## Security of the window

- **No IPC.** The window loads remote pages, so no capability names it (a test reads every file in `capabilities/`: no
  `boredroom`, no wildcard, no `remote`), and the opener plugin's link script is off for the whole app. Its only ways to
  reach Rust are navigations, which `policy.rs` decides, and the page loads `webauth.rs` watches.
- **Only Boredroom.** It shows https://www.boredroom.cc and the apex (a development build also the configured server).
  Every other link opens in the default browser (3 per 5 seconds at most); `mailto:` and `tel:` go to macOS; `file:`,
  `tauri:`, `javascript:` and other schemes are refused; a new window is always refused (an app link stays in the window,
  anything else goes to the browser); a page that reaches another site anyway goes to the browser and the window goes
  back. `/desktop/link`, `/desktop/continue` and `/download` open in the browser.
- **Its own data.** A website data store of its own (a fixed id, never changed), never the notch's.
- **No devtools** in a release build. Microphone and camera are allowed for calls (macOS still asks once); nothing else.
- **Never Brenda's target.** Brenda never looks at the window, clicks in it or types in it, and never mistakes it for
  the app behind it (`capture::own_dashboard_front`, `own_window_at`).

## One sign-in

`webauth.rs`. The app is signed in when Rust holds a desktop session (the 90-day token below). The window's web session
is tied to it on the server, and signing out anywhere (the window, the notch, the tray, Settings › Desktop) ends both.

- **Notch signed in, window opens:** Rust asks for a 60-second single-use handoff code with its token and hands it, by
  `eval`, to Boredroom's own `/desktop/app` page, which posts it to a strict same-origin route that sets the ordinary
  session cookie. No code or token is ever in a URL.
- **Signing in signs the notch in (PKCE):** Rust starts an auth request with a challenge; the person signs in in the
  window, or in the default browser for **Continue with Google** and **Sign in with your browser** (Google blocks
  sign-in inside apps' own windows, and password managers work there); `/desktop/app/finish` sends them to
  `boredroom://auth?code&state`, which Rust catches in the window or macOS hands to the app from the browser. Rust
  redeems the code with its verifier.
- **Connected apps** (Google, Notion, Slack, GitHub…): their consent runs in the browser through a single-use ticket
  (`/desktop/continue`), and **Back to Boredroom** (`boredroom://open?path=…`) returns to the window.
- An old server (or migration 0064 not applied) answers 404 or 503: the window then signs in on its own, and the notch
  uses the device code below.

## How it signs in

A device code, never a password. The app asks Boredroom for a code (`POST /api/desktop/link`), the person approves it
on `/desktop/link` while signed in, and the app claims a desktop session (`POST /api/desktop/link/poll`) that lasts 90
days. The token is kept by the Rust side in the app's config folder (`brenda.json`, readable only by you) and sent as a
bearer token; the web view never sees it. Linked computers are listed on `/desktop/link`, where each can be unlinked,
which signs the app out at once. The tray menu also has **Sign out of Boredroom**. Since 24 October 2026 the code is
the fallback (**Use a code instead**); the one sign-in above is the usual way.

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
- Calls (phase 8, see "Calls" below): `GET /api/orgs/:org/calls/now` every 4 seconds (2 while a call rings, 60 before
  the server has calls), and `POST /api/orgs/:org/calls/:id/accept`, `/decline` and `POST /api/orgs/:org/calls` when the
  person presses Accept, Decline or Call back.
- Screen help (see "Screen help (Look)" below): the picture goes only from Rust, in `POST /api/orgs/:org/assistant/look`
  (the generic `api` command refuses that path); "Never look at Figma" on the preview reads and writes the person's own
  list with `GET` and `PUT /api/orgs/:org/screen-help/me`. The desktop state's `look` carries whether screen help is
  offered, the never-look lists and "Turn off on my Macs".
- On the computer, it opens Boredroom links in the browser; reads files you drop on it or ask it to work on, and the
  names of files in a folder you ask it to go through; and, only when you have turned it on and hold Control+Command or
  press Look, sees the screen your pointer is on (kept in memory for a minute). With “Do things when I ask” on, and only
  after you ask and say yes to exactly what she'll do, it opens apps, files, folders and pages, and moves the pointer,
  clicks and types. Nothing on a timer, nothing from the server, nothing from what's on the screen. It tells Boredroom
  which of these are on, for you alone. (Owner rule and requests, 12 October 2026; see "Brenda by your pointer, and doing
  things when asked" and "Opening things, folders and plans" below. Opening things and folder work need this build's Rust
  patch; until it is applied, today's binary opens nothing itself.) Since phase 8 nothing records the screen anywhere in
  Boredroom, and the notch never uses the camera or microphone for calls.
- Which abilities are on (phase 3, owner request of 12 October 2026): `PUT /api/orgs/:org/screen-help/mac` through the
  generic `api` command, only once the desktop state says Boredroom takes it (`look.mac.ready`, migration 0059): at start,
  2 s after anything changes, right after opening the setup that "Set up on my Mac" asked for, and every ten minutes.
  The body is on or off for each ability, macOS's answer for each permission and whether the companion shows (A.6 of
  `scratchpad/companion2-spec.md`): no names, no paths, nothing seen or done. Only the person can read it in Boredroom;
  their workspace can't. The desktop state's `look.setupAt` (a "Set up on my Mac" press in the last 15 minutes) opens
  the setup card once; it turns nothing on.
- Brenda and her helpers (the owner's approved brief, 12 October 2026; see "Brenda and her helpers" below; only once the
  Rust patch and migration 0060 are applied): on the computer, it opens Boredroom links in the browser; reads files you
  drop on it or ask it to work on; and, only when you hold Control+Command, press Option+Space, press Look or type to it,
  hears or reads what you ask. Common requests (opening apps, files, folders and pages; windows; quitting; volume;
  screenshots; copying; typing into the box you're in; Wi-Fi; emptying the Trash) are done on the Mac itself, straight
  away when they're routine and only after your yes when they delete, send, pay or touch security. Other requests go to
  Boredroom's AI as words, never pictures; questions about your screen send the screen your pointer is on, kept in memory
  for a minute. Background jobs work only in your Desktop, Documents, Downloads and folders you add, never delete
  anything, move things to the Trash only after your yes, and keep an Undo record on this Mac for a week. With “Do things
  when I ask” on and your one-time go-ahead, it can click and type in your apps for a job you asked for, stopping before
  anything that sends, submits, pays or deletes. Nothing on a timer, nothing from the server, nothing from what's on the
  screen. Boredroom keeps your requests and what she did for you alone, for 30 days. This page calls only
  `POST /api/orgs/:org/assistant/front/line` (a short line's natural-voice offer) and `GET`/`PUT
  /api/orgs/:org/brenda/mac-permission` ("Check with me before every task"); the front desk's and the jobs' routes are
  Rust's alone.
- Phase 2's requests go only from Rust, never from this page: the v2 look (`POST /api/orgs/:org/assistant/look`,
  streamed), and a task's answer, steps, step answers, stop and file job (`POST /api/orgs/:org/assistant/act/:id/…`);
  the generic `api` command refuses those paths.

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

## Screen help (Look)

Owner decisions, 11 October 2026 ("start building with your recommendations"), and the owner's request the same day:
"press the two buttons, ask Brenda a question about what I'm pointing at on my screen and she helps me out with it". The
plan is the approved proposal (phase 1); the page's words and rules are `src/look.js`, the cards are in `src/main.js`,
and the Rust side (`src-tauri/src/look.rs`, `capture.rs`) waits as a patch for the owner's go-ahead (below).

**Off until you turn it on, on this Mac.** The first time you press **Look** (the eye beside the talk control on her
cards) or choose **Turn on screen help…** in the tray, the notch shows the consent: what she sees, when, that nothing
is kept, that your workspace can't see it or whether you use it, that the picture goes through Boredroom's own account
to Anthropic (which doesn't train on it and normally deletes it within 30 days; it keeps anything it flags for a
usage-policy breach for up to 2 years), and that you see it before it leaves. The keys
do nothing until you have said yes on this Mac, so an accidental hold never opens it. Your yes is stored on this Mac
only (`brenda.json`), never in Boredroom, and signing out clears it. Then macOS asks for **Screen Recording** (that is
what it calls letting an app see a window); if it was refused, the notch says where to allow it (System Settings ›
Privacy & Security › Screen Recording on macOS 14 Sonoma, Screen & System Audio Recording on macOS 15 and later; the
Open System Settings button goes straight there on both). Turn it off any time from the tray, or with **Turn off on my
Macs** in Boredroom (Settings › Your assistant), which this Mac obeys on its next poll. Screen help needs macOS 14
Sonoma or later; it is offered only where the workspace allows it (owners and HR can switch it off for everyone, and
existing workspaces get 14 days' notice first), and during the pilot only in the workspaces named in
`BRENDA_LOOK_WORKSPACES`.

**Asking.**

1. Point at the thing, hold **Control+Command** (only those two keys, for about 0.3 s) and ask. As the hold starts
   Brenda takes one picture of the window in front of you, with your pointer marked by a ring, and, if voice is on,
   listens while you hold the keys (whisper on this Mac, as with Option+Space). The notch shows her looking ("Looking at
   Figma…"), the orange live dot and, while she listens, the time and the waveform; a soft orange outline flashes round
   the window she captured.
2. Let go. The preview opens: the picture with the ring where your pointer was, your words (edit them, type them, or
   hold Option+Space to say more into the field), "Nothing leaves your Mac until you press Send.", **Never look at
   Figma**, **Don't send** and **Send**. Esc, Don't send or closing the card lets the picture go; so does waiting two
   minutes ("I let that picture go.").
3. **Send.** Rust sends the picture with your question and the chat so far, then wipes it, whatever the answer. Brenda
   answers in words on the reply card ("Looked at Figma"), and anything she would do is a Confirm card, even when you
   let her act without asking ("Still asking: this came from what Brenda saw on your screen."). "This", "that" and
   "here" mean the thing under your pointer; if the pointer was outside the window, or you pressed Look on her card, she
   helps with the window as a whole.

Option+Space stays the talk key and never looks. **Look** on her card does the same without the keys: no pointer (it
was on Brenda), no recording; type the question or hold Option+Space to say it into the field.

**How the keys are read without keyboard access.** A modifier-only chord cannot be a global shortcut (Carbon hotkeys
need a key), and listening to keys system-wide (an event tap) needs the Input Monitoring or Accessibility permission,
which would break "Brenda has no keyboard access". So Rust reads the current modifier state about 30 times a second
(`CGEventSourceFlagsState` with the combined session state, and `CGEventSourceSecondsSinceLastEventType` to notice a
key pressed during the hold), only while screen help is on here and Boredroom last said it is available, and not while
the Mac is locked or asleep. If Boredroom hasn't been reached for two minutes, a hold or Look says "I can't reach
Boredroom right now" and takes no picture; it never blames the workspace. Apple's documentation for `CGEventSourceFlagsState` and `NSEvent.modifierFlags` ("the
currently pressed modifier keys") names no permission (checked 11 October 2026); Input Monitoring
(`CGPreflightListenEventAccess`) governs event taps, which Brenda never creates. After a first look, System Settings ›
Privacy & Security › Input Monitoring and Accessibility should list no Brenda; check that on a real Mac. A hold is
cancelled when another key or modifier joins it, when the Mac locks, or when the app in front changes before you let
go (Control+Command+Space opens the emoji picker, Control+Command+Q locks the screen, Control+Command+F toggles full
screen). The keys are one constant (`LOOK_KEYS` in `look.rs`). Control+Option is never used: it is VoiceOver's key.
**Caveat:** holding Control+Command for more than 0.3 s before pressing a third key (a window-tiling shortcut, say)
starts a look that is then cancelled: the live dot flashes and nothing is kept.

**The picture.** Only the window in front of you (never the whole screen, never Brenda's own windows), one picture per
press, about one pixel per screen point (Retina windows are halved), at most 2,576 pixels on the long edge and 3.6
megapixels, as a JPEG of at most 2.5 MB, with the ring drawn at your pointer and your pointer's position in the
picture's own pixels sent beside it. It lives in Rust's memory only: never written to disk, the clipboard, a log or a
crash report, dropped at Send, Don't send, a new look or after two minutes, and its bytes are overwritten when it is
dropped. The notch's card shows a smaller copy (a data URL, checked to be a JPEG or PNG) and forgets it as you press
Send.

**What she never looks at.** Password managers and sign-in prompts, messaging apps (Messages, WhatsApp, Signal,
Telegram, Slack, Discord and the rest), call apps (Zoom, Teams, FaceTime, Webex…) and System Settings, always (a fixed
list in Rust and in `src/lib/screen-help.ts` that cannot be removed); plus the apps your workspace lists and the ones you
add (Never look at Figma on the preview, or Settings › Your assistant). Rust checks before taking the picture; Boredroom
checks again. A browser is one app to the Mac: a web Slack, a private window or a Google Meet tab cannot be told apart
in phase 1, so the only way to keep those out is to list the browser. The consent and Settings say so too.

**Never during a Boredroom call.** While a Boredroom call is live or ringing for you, she refuses ("I don't look at the
screen during a Boredroom call"). Calls in other apps (Zoom, FaceTime, a Meet tab) are not detected: only those apps'
own windows are kept out, by the never-look list, so the words always say "a Boredroom call". The notch tells Rust
after every ring poll; when it has not said for 15 s Rust asks Boredroom itself, and refuses if it can't tell.

**What Boredroom does with it.** The look goes through Boredroom's own Anthropic key (never a workspace's own key) to
the pilot model, inline, never into Anthropic's file storage; Boredroom keeps nothing of the picture and never logs it.
It counts as one ordinary request in your daily limit. Owners and HR never see that you looked, or whether you use it:
what Brenda does from a look shows in their log only as what was done ("Added a to-do"), and something that didn't go
through only as what she tried ("Didn't add a to-do"), never the reason, which may quote the picture. Her spoken
answer uses a natural voice only on Boredroom's own ElevenLabs key; where the workspace has its own key (whose History
its owners can read), the Mac's own voice says it. Past chats keep your question and her answer with a note that she
looked at a window and which app ("Brenda looked at a window (Figma)"), never the picture: no screen in Boredroom shows
them to anyone else, and Boredroom's staff never look. Follow-up questions in the same chat go the ordinary way.

**Developing it.** Under `tauri dev` macOS gives the Screen Recording permission to the terminal app that launched the
notch, not to Brenda, and an unsigned rebuild may lose it (allow it again in System Settings). Screen help needs the
Rust patch (`look.rs`, `capture.rs`, the ScreenCaptureKit crate, weak-linked): it waits as
`look-rust.patch` for the owner's go-ahead, because applying it rebuilds and restarts the running notch. Until then this
page shows no look features (every look command is caught, and `look_status` answering nothing hides them). The preview
states are in "Layout preview without Rust" below.

## Brenda by your pointer, and doing things when asked

Owner request and rule, 12 October 2026. After trying phase 1 the owner asked for no preview step, for her to see the
desktop and whatever is under the pointer, for Clicky's companion by the pointer in the colour of your Brenda, for
smarter answers, and for an actual assistant that does things on the screen and works on files. Over all of it, his rule:

> "Brenda cannot take any action except I explicitly give an instruction. So Brenda cannot just be doing things in the
> background on its own. Except I explicitly say Brenda, I need you to do this. And then if it's a core task, Brenda
> should confirm, oh, do you want me to do this? And then I'll say, yes, I need you to do this."

In plain words: she only ever does something because you asked her to, in your own words, with her keys held or typed
in her box; she then says exactly what she will do ("I'll rename these 6 files to Invoice-01 to Invoice-06.") and asks
**"Do you want me to do this?"**; nothing happens until you press **Yes, do it** or say "yes". Silence for a minute, a
question, "yes but…" or anything unclear is no. Before anything she can't undo (sending, submitting, deleting, paying,
sharing, publishing, signing in, accepting terms, quitting an app, replacing a file) she asks again, for that one step.
"Act without asking" never applies here. Looking is not doing: a look only ever answers, points or proposes. Rust checks
that the request and the yes came from your own hands and voice, and Boredroom records the request and the yes and
refuses any step or file job without them. This page only shows things and passes presses on: Yes is `act_answer` and
nothing else, and nothing here calls the act or look routes. The contract is `scratchpad/companion-spec.md`.

**Keys.**

| Input | When | What happens |
|---|---|---|
| Hold Control+Command (300 ms) | idle | A look: she sees the screen your pointer is on |
| | a proposal or a step question waiting | The microphone opens, no picture: your words are the answer |
| | a screen task or a file job running, or paused | Stop, at once (review, 12 October 2026: rule f covers file jobs too) |
| Hold Option+Space | idle | Talk, as before (words only, never a picture) |
| | a question waiting | Your words are the answer |
| | a screen task or a file job running | Stop |
| Esc | a question waiting | No |
| | a screen task or a file job running, asking about a step or paused | Stop |
| | anything else | Not Brenda's (she registers Esc only in the rows above) |
| Typed in the notch | the asking card's box | Your answer (Enter) |
| | the reply's box, within a minute of a look | A follow-up about the same screen |

**What she sees.** The whole display your pointer is on, desktop included, captured as the hold starts and sent as soon
as your words are written out: the screen downscaled, and a sharp close-up round the pointer, the pointer marked in
both. Apps on the never-look lists are left out by macOS's own capture filter and their windows hatched grey; her own
windows are left out. For a minute after she answers, Rust keeps the two pictures in memory so you can ask a follow-up
in the reply's box; then they are wiped, and the box is an ordinary chat box again. "Show me the picture first" (off
by default) brings back phase 1's preview with Send and Don't send. If you turned screen help on under phase 1's
words, "Screen help works differently now" asks once before your next look.

**Her by your pointer.** A small Brenda (her face, coat colour, visor and eyes, 26 points) follows your pointer with a
soft spring, 30 points right of and below it so she never covers what you point at, in a click-through window that
screenshots and shares leave out. Listening she shows orange bars and a live dot; thinking, a dot circles her; speaking,
her eyes move with the syllables; pointing, she flies to the thing, rings it with a clean ring in her colour and a short
label, and flies back;
asking, a neutral pill with the plan and "Do you want me to do this?" (never orange); doing, an orange arc turns round
her with the step's note. She fades after 3 s still, and hides while you type, in full-screen apps, during a Boredroom
call or a screen share she can tell about, while macOS's screenshot tool is open, when the Mac is locked, and whenever
"Show Brenda by my pointer" is off (she then appears only during an exchange). Reduced motion: no spring, no flights, no
circling. The pages are `src/companion.html` (with `companion.css`, `companion.js` and the shared `face.css`) and
`src/ring.html`; Rust drives them with `Companion.apply` and `Ring.apply` and they can call no command.

**One setup: "Let Brenda help on this Mac"** (phase 3, owner report of 12 October 2026: "I wanted Brenda to assist me
with some things, like open an app on my desktop, and it said it can't do that, why?"; and, having pressed "Turn off on
my Macs" in Boredroom thinking it turned things on, "I stopped seeing my Brenda"). One card, `src/help.js`'s words, with
three ticks: **See my screen when I ask** (looks), **Do things when I ask** (opening apps, files, folders and pages, and
clicking and typing, each only after a yes), **Work on my files** (finding, reading and summarising files, saving new
ones next to them). Each ability that is off is pre-ticked (or only the one asked about, and seeing when it is off);
one already on shows "On"; unticking seeing unticks the other two, which need it. Three promises under them, and **Read
everything** with phase 1's and phase 2's consents whole. **Turn these on** (the card's one orange button, a real press
Rust checks) turns on what is ticked: this build's Rust in one `help_setup`; today's with `set_screen_help`,
`act_set_use_mac` and `act_set_file_work` one after another (a press Rust did not take falls back to a card with its
own Continue). Then macOS's own steps, in order and only when needed: Screen Recording, Accessibility ("Opening apps,
files and pages works without it; clicking and typing need it"), Finder, and Documents, Desktop and Downloads (this
build's Rust; macOS asks once for each); a refusal shows where to change it in System Settings, with a button that
opens that pane (`help_open_privacy`; today's Rust can open the first two). The done card says what is on. Every way in
opens this card and turns nothing on by itself: the tray, Look while it is off, the switches on **Help on this Mac**, the
"Set up" and "Turn it on" buttons under her replies, and Boredroom's **Set up on my Mac** at the next poll.

**Never just "I can't."** When something you asked for needs a switch that is off, her reply names it ("“Do things when I
ask” is off on this Mac.") with **Turn it on** (or **Allow it** for Accessibility), which opens the setup focused on it;
asked how to turn things on, her reply has **Set up**; a chat request for something on this Mac while seeing your screen
is off offers **Set up Brenda on this Mac**. Your words are kept for ten minutes, in memory only, and the done card
offers **Ask again**: the Look button with your words, so the most it can lead to is a proposal that waits for your yes.

**The menu bar** (this build's Rust): "Brenda can help on this Mac: On" (or ": Off", or "can't help on this Mac yet"),
and inside it the status, **Set up Brenda on this Mac…**, the three abilities (one that is off ends "…" and opens the
setup; one that is on turns off at once), **Show Brenda by my pointer** and why she is hidden when she is, **Show me the
picture first**, **Stop Brenda**, **Turn off help on this Mac** and **Help settings…**. Today's tray keeps its "Screen
help" submenu; its "Turn on…" items open the setup card.

**Help on this Mac** (the tray's "Help settings…", or Settings on "Screen help is on"): five switches, white when on: the three
abilities (turning one on opens the setup focused on it; turning one off is at once), with an amber pill where macOS
still needs to say yes ("Needs Screen Recording", "Needs Accessibility to click and type", "Finder not allowed", "Can't
open Documents") that opens that step; **Show Brenda by my pointer**, whose line says where she is or why she is hidden;
and **Show me the picture first**.

**Why she is hidden** (phase 3, owner report of 12 October 2026). She shows whenever seeing your screen is on and "Show
Brenda by my pointer" is on, apart from the moments below; the settings card and the tray say which: "She's by your
pointer. She steps aside while you type or keep still."; "Hidden: “Show Brenda by my pointer” is off."; "Hidden: seeing
your screen is off. Set her up again to bring her back."; "Hidden: you're signed out."; "Hidden while your Mac is
locked."; "Hidden during a Boredroom call."; "Hidden while your screen may be shared."; "Hidden while you take a
screenshot."; "Hidden while your screen is mirrored."; "Hidden while an app is full screen." (Today's binary says less:
"She's by your pointer while screen help is on.") After the setup turns seeing on, this build's Rust greets you by the
pointer with a hop.

**The ring** (owner report, 12 October 2026: "some of the highlighted items have very wiggly lines, I don't like that").
One clean, smooth 2-point stroke in her coat colour round what she points at, a rounded rectangle (or an ellipse round a
small round control), with a soft glow in her colour's edge shade and a faint dark edge so it reads on white; it draws in
one 250 ms stroke from the top centre, the glow breathes gently while it stays, and it fades in 300 ms. Reduced motion:
there at once, still. Today's binary sends no colour, so it is orange.

**Under `tauri dev`**, Screen Recording, Accessibility and the folder prompts belong to the terminal that launched
Brenda, so granting them there gives the terminal's other processes the same power: test on-screen actions with a signed
build.

**What leaves the Mac, and what is kept.** A look sends the two pictures and your question through Boredroom's own
account to Anthropic; a screen task sends a picture of the screen after each step; a file job sends that file's text
(or, for small PDFs and pictures, the file). Nothing of the pictures, steps or files is kept by Boredroom. Your Past
chats keep your request, her proposal and one line of what came of it. Your Activity keeps a short note of each task
for 30 days, only for you. Your workspace can't see any of it, or whether you use it.

**Stopping.** Esc, holding her keys, Option+Space, Stop in the notch, "Stop Brenda" in the menu bar; a lock, a sign-out,
a Boredroom call starting or a share she can tell about stops her too. Rust checks the stop before every single event it
posts. A file job stops the same way (while one runs, Esc and her keys are hers to stop it, so a look waits until it
ends). Moving the pointer or typing while she works on the screen pauses her: "I paused", Stop or Carry on.

**A second yes, by code (review, 12 October 2026).** Besides the model's own ask_before, Rust reads what every click, key,
piece of typing and drop would do: a button, link, menu item or check box named Send, Delete, Pay, Agree…; Return or Space
on a focused button; Return in a text field (a web form submits; anywhere but TextEdit, Pages, Notes, Word, Xcode and
Finder's rename it sends); Backspace or Delete on a selected item; "#" in a web page; a drop into the Trash or into another
app; the send, delete and quit shortcuts. Each needs the person's yes to a step of that kind, once; what Accessibility
cannot read asks too. Before every key and every piece of typing the front app and the app that owns the keyboard are
checked again (Spotlight, Raycast, Alfred and Terminal can take it mid-action), and she never opens an installer, a script,
a link file or an app that came from the internet and hasn't been opened before (phase 3: ordinary apps in your
Applications folders may be opened again, owner request of 12 October 2026). Electron and Chromium apps are asked to show
their web tree during a task, so their Send buttons can be read.

## Opening things, folders and plans

Owner requests, 12 October 2026 ("Brenda is meant to assist you do anything you need it to do"; his spoken request: "how
do I turn on the features so that I can be able to look through my documents and summarise them and maybe open up").
Under the same rule: you ask, she says the whole of it in one sentence and the lines under it, you say yes once.

- **One sentence, its lines, one yes.** "I'll open Figma, make a new file called “Landing v2” and remind you at 3pm to
  review it." and under it exactly what each part touches: "Open Figma (Applications)", "On your screen: Make a new
  design file and name it “Landing v2”.", "Remind you at 15:00: review Landing v2". While Brenda for Mac finds what the
  lines name (the app, the file, the files in the folder; read-only, on this Mac) the card says "Getting that ready…";
  then "Do you want me to do this?". The yes is to the sentence and the lines together. Up to six parts in order: opening
  things (up to three), one on-screen part, one folder or file job, and up to four Boredroom changes. "Part 2 of 3"
  while she works; the first part that fails ends it ("What I did before that stays done").
- **What she opens**, without clicking: an app by name from your Applications folders (from CoreServices, Finder only),
  a web page (`https`, never a banking or payment page, a link that passes you on to another address, or a download; the
  line under her sentence shows the whole address, query included, so your yes covers exactly what opens), a folder you
  named or pointed at, a file you named or one found by words, a recent document, or a file shown in Finder. **Never**:
  installers, updaters and apps that erase, disk images of any kind, certificates and profiles, scripts and executables,
  link files, apps outside your Applications folders or new from the internet and never opened, the apps she never looks
  at or works in (password managers, Keychain, System Settings, Terminal, messaging and call apps, launchers), and a file
  whose default app is one of those (a certificate opens Keychain Access, so it is never opened). System Settings opens
  only at a privacy pane from the setup's own buttons (review, 12 October 2026).
- **Folders.** Only the folder you named (home, Desktop, Documents, Downloads, Pictures, Movies, Music) or pointed at (the
  Finder window in front, a folder you selected), its top level (or three levels down if you ask for everything inside);
  never hidden items, `Library`, packages, links, the never-look apps' folders or secret files, never password exports
  ("Passwords.csv", "Chrome Passwords.csv", Bitwarden's or LastPass's exports) and never files named after a never-look
  app ("WhatsApp Chat with Ada.txt"). At most the 25 newest
  files, each 25 MB or less, 100 MB together. "Read the 14 documents in Documents (PDF, Word, text, 38 MB) and save
  “Documents summary.docx” there"; **Show the 14** lists them by name on the card (the names stay on this Mac until you
  say yes). Then "Reading 4 of 14" in the bar; the text (not the files) goes to Boredroom one file at a time, and the
  result is one new file saved in that folder, never over anything. Stop at any point and nothing is written. If macOS
  hasn't let Brenda into the folder, the card says so with **Open System Settings**.
- **Boredroom changes in a plan** (a reminder, a to-do, a message to a colleague's assistant) are prepared with the
  plan; one that reaches anyone else asks again when the plan gets there ("Next I'll go ahead with “…”. Do you want me to
  do this?"). Its line and that question carry every word it sends and who it reaches; a message too long for one line
  is never part of a plan and keeps its own Confirm button (review, 12 October 2026).
- **What leaves the Mac.** Before the yes, only the counts and the chosen name; after it, a folder job's text one file at
  a time. Your Past chats keep your request, her sentence and one line of what came of it, never the lines or the file
  names; Activity keeps a short note for 30 days, only for you.

**What Boredroom knows** (phase 3, owner request of 12 October 2026). This page tells Boredroom which abilities are on on
this Mac, which permissions macOS has given and whether the companion shows (`PUT /screen-help/mac`, A.6), so Settings ›
Your assistant can show you, per Mac, what is on, and **Set up on my Mac** can open the setup here. Only you can read it;
your workspace can't, and nothing shows anyone else whether you use any of it. Phase 1 kept this on the Mac only; the
words on the cards now say "Only you can see these, here and in Boredroom › Settings › Your assistant."

**Where she never works.** Password managers, Keychain, System Settings, Terminal and other shells, Script Editor,
Automator, Shortcuts, Activity Monitor, Disk Utility, installers, messaging and call apps, the apps on the never-look
lists, and banking and payment pages, which she spots by their addresses (a heuristic that can miss some).

**Previews.** Phase 3 (companion2 contract J.4; `&binary=2` today's Rust, `&binary=3` this build's, the default for these):
`?state=help-setup` (`&focus=look|mac|files`, `&on=look,mac`, `&name=Max`, `&read`, `&untick`, `&press`; `&binary=2` the
one-after-another path), `help-steps` (`&to=screen|accessibility|finder|folders|folders-result|done` presses Continue up to
that step; `&screen=denied`, `&ax=denied`, `&finder=denied`, `&folders=documents:denied`), `help-done`
(`&request=open%20Figma` for Ask again), `help-settings` (`&companion=` any reason, `&mac=on&ax=denied`,
`&folders=documents:denied`), `setup-from-web` (the desktop state carries a fresh `setupAt`: the card opens at the next
poll and the report carries `setupSeen`), `reply-enable` (`&which=mac|files|accessibility`), `reply-setup`
(`&which=all|files`), `reply-use-screen-off`, `plan-scoping`, `plan-asking` (`&steps=open|open-file|folder|mix`,
`&others=2`), `plan-running`, `plan-folder-working` (`&finish=1`), `plan-boredroom-ask`, `plan-done` (`&kind=open|folder|mix`,
`&skipped=2`), `plan-unresolved` (`&why=app_none|forbidden|quarantined|outside|folder_denied|file_none|timeout`). The console
logs every `PUT /screen-help/mac` body. `companion-preview.html?state=pointing` draws the clean ring:
`&shape=box|circle`, `&look=white|orange|blue|yellow`, `&bg=light|dark`, `&reduced=1`, `&old` (no colour: orange), `&hold=1`.
Phase 2's states: `preview.html` (the comment at its top lists every state): `?state=look-instant` (`&natural`, `&desktop`,
`&mic=off`), `look-followup` (`&expire=5`), `look-consent-update`, `look-settings` (`&mac=on&ax=denied`), `look-preview-on`,
`act-consent-mac`, `act-consent-files`, `act-accessibility` (`&ax=denied`), `act-finder` (`&finder=denied`), `act-asking`
(`&kind=screen|file`, `&risky=1`, `&answer=button|voice-yes|voice-no|voice-unclear|typed-yes|timeout|new-request`,
`&name=Max`), `act-confirming`, `act-doing` (`&steps=6`), `act-step-ask` (`&kind=send|delete|pay|…`), `act-paused`
(`&why=moved|typed|focus`), `act-done` (`&kind=screen|file|doc`), `act-stopped` (`&why=…`), `act-cannot`, `act-failed`,
`act-refused&reason=…` (every row of the refusal table), `act-working`, `confirm-voice`; `&old` on any of them is today's
binary and server, and shows exactly phase 1. `companion-preview.html` shows the companion and the ring over a fake
desktop: `?state=idle|listening|thinking|speaking|pointing|asking|doing|paused|done|sad|badge`, `&look=orange,band,round`,
`&flip=x|y|xy`, `&reduced=1`, `&text=…`.

**Phase 3's Rust patch (`companion2-rust.patch`) and migration 0059 wait for the owner's go-ahead.** Until then the page
runs with today's binary: the setup card (one after another), the "Set up" and "Turn it on" offers, Help on this Mac's
new words and the clean ring (in orange) all work; opening things, folder work, plans, the ring in her colour, the
companion's reasons and the new menu bar need the patch; the Mac's state in Boredroom and "Set up on my Mac" need 0059.

**The Rust patch waits for the owner's go-ahead.** The page works with today's binary (every new command is caught, and
without `look_status` v2 and `act_status` nothing new shows). The Rust side (`src-tauri`: the display capture, the
companion windows, tasks, the executor, file work, the app's command ACL) is a patch built and tested in a separate
worktree; applying it rebuilds and restarts the notch, so it is applied only when the owner says so. The patch also
carries `src-tauri/permissions/autogenerated/*.toml` (one allow and one deny permission per command, which `tauri-build`
writes from the app manifest in `build.rs` and rewrites only when they change), so the tree stays clean after the build.

**The contract with Boredroom, checked both ways** (integration, 12 October 2026; no network, no model, nothing on this
Mac): `ACT_SEAM_DIR=<dir> pnpm vitest run tests/integration/act-flow.test.ts` (on a throwaway test database) writes the
server's real answers there; `BRENDA_SEAM_DIR=<dir> cargo test --lib -- --ignored seam_` (in `src-tauri`) reads them with
Rust's own parsers and writes every body Rust sends; `ACT_SEAM_DIR=<dir> pnpm vitest run tests/unit/act-seam.test.ts`
reads those with the server's own schemas, and checks that the transcript Rust holds still hashes to what the server
recorded.

## Brenda and her helpers

The owner's approved brief, 12 October 2026 (the doc "Brenda and her helpers": all nine decisions "Agree", "proceed to
build"; then "leave that out, let's build with what we currently have": no OpenAI and no realtime voice, so speech is
recognised on the Mac, Claude thinks, and ElevenLabs or the Mac's own voice speaks). The contract is
`scratchpad/helpers-spec.md`. **None of this shows until the Rust patch `helpers-rust.patch` and migrations 0059 and
0060 are applied, each with the owner's go-ahead; until then the notch behaves exactly as today.** The page feature-detects
this build's Rust (`LookStatus.v` 4) and Boredroom's `look.front.ready` (0060); every new command is caught.

### One Brenda, three lanes

- **Do it now (the front desk).** Hold Control+Command (or Option+Space, or type in the notch) and ask. Common requests are
  recognised on the Mac itself, with no AI call, and done straight away through macOS, never by clicking: "Open Figma",
  "Go to stripe.com", "Open my downloads", "Turn the volume down", "Mute", "Put Slack and Figma side by side", "Make Figma
  full screen", "Hide everything", "Quit Spotify" (the app's own save prompt protects unsaved work), "Take a screenshot of
  this" (saved to your Desktop, with Undo), "Copy that", "Write 'running five minutes late' here" (typed into the box you
  are in, never pressing Return or Send), "Turn off Wi-Fi", "Empty the Trash", and in a web browser (see **Tabs, pages and
  searches in a browser** below): "Open a new tab", "New tab in Brave", "Open a new window in Chrome", "Open stripe.com in
  Safari", "Go to github.com in Brave", "Search for remote work tools in Chrome", "Google standing desks", "Look up the
  weather in Brave". Anything else goes to Boredroom's router
  (claude-haiku-5-5) **as words, never a picture**, which picks the lane: a Mac action ("Open the Q3 deck": several
  matches, "Which one?"), your own reminder, to-do or timer (done at once, with Undo), a job, Boredroom's chat (anything
  that sends asks with a Confirm, as today), a look, or one short question back.
- **Think harder.** Questions about the screen go straight to a look. Quick ones are answered at once; errors, code, long
  documents and small print get "Let me look properly." first and a careful answer from claude-opus-5-5.
- **Helpers in the background (jobs).** The Files helper (organise a folder by kind or by month, rename by date, move,
  copy, convert, summarise a folder, clear out files to the Trash after your yes) and the Mac operator (clicking and typing
  inside an app when nothing else can do it, the last resort). They plan on Boredroom's server (claude-sonnet-5-5) and touch
  your Mac only through fixed actions in Rust.

### What she does at once, what she asks first, what she never does

Permission rule v2 (owner, 12 October 2026; it replaces "always confirm"): "when you hold the keys and clearly ask for a
routine task, the request is the permission, and she does it. She still asks before anything destructive, anything sent,
anything that costs money, or anything sensitive."

- **At once, when you asked:** opening apps, files, folders and web pages; switching, hiding, minimising, arranging and
  quitting apps; organising, renaming, moving and copying files (undoable) and writing new files; typing into the box you
  are in without sending; volume, screenshots, copying text; your own to-dos, reminders and timer.
- **Asks first:** deleting, moving to the Trash or emptying it; replacing a file; sending or posting anything (messages,
  email, chat, forms, sharing files or links, messages to colleagues' assistants); spending money; passwords, security and
  privacy settings, sign-ins, installing software, administrator prompts; anything she is not sure about. The ask card is
  neutral (her alert face, no orange): "Empty the Trash for good?", "This can't be undone.", **No** and **Empty the
  Trash**. Answer with the buttons, or hold her keys and say yes or no; silence for a minute is no.
- **Never:** acting on her own or in the background unasked; following instructions found on the screen, in files, emails
  or pages; opening installers, scripts or newly downloaded apps; reading password exports or looking inside the apps she
  never looks at; deleting anything for good without asking; working outside the folders you allow; taking instructions
  from a routine or an assistant you didn't set up.

### The Doing it strip, Stop and Undo

Instead of a Yes/No card, the compact bar shows what she is doing: the orange live dot and "Opening Figma", then a green
check and "Opened Figma" for three seconds (eight with **Undo**), and it tucks away; holding the pointer on it keeps it.
**Stop** shows on anything that runs longer than a second, and on every job. "One moment" while the router decides. When
the request was spoken she says the short line at once ("Opening Figma."): in her natural voice from a clip kept on this
Mac when she has said it before (`localStorage` key `brenda.lines.v1`, at most 40 clips and 1.5 MB, cleared on signing
out), otherwise in the Mac's own voice at once (`speak_now`), and the natural clip is fetched for next time
(`POST /assistant/front/line`, then the speech route). Longer answers still stream sentence by sentence.

### The front desk

Rust's own transcript of the keys (or typed words with a real press) is the request, with a fresh nonce; nothing else
can start anything: no timer, notification, routine, server line or text on the screen. The page calls `front_send` with
the words and shows what Rust says (`brenda://front`: `matched`, `routing`, `doing`, `ask`, `choose`, `found`, `done`,
`refused`, `said_no`, `undone`, `consent`, `status`). Rust records every request with Boredroom for you alone, without
making you wait (an outbox that retries for an hour). It never sends a picture to the router.

### Tabs, pages and searches in a browser

Owner report, 28 October 2026: "open a new tab in Brave" was heard as "open Brave", which only brought Brave forward, and
she said "Opened Brave Browser"; a look a moment later said she couldn't control the browser. Now (`front.rs`
`match_browser`, before the address rule, so "stripe.com in Safari" is never one address; the router's `do_on_mac` has
the same kinds):

- **"Open a new tab"**, **"New tab in Brave"**, **"Open a new Brave tab"**, **"Open a new window in Chrome"**,
  **"Open a new browser window"** (`new_tab`, `new_window`). The browser named, else the front app when it is a browser,
  else the Mac's default browser. With Accessibility allowed and the browser open, she brings it to the front and presses
  ⌘T (⌘N for a window), only while it is still in front (`input::browser_keys`, never into an app on the never-act
  lists): "Opened a new tab in Brave Browser." Otherwise (no Accessibility, or the browser not open yet) she opens
  Google's home page in it, a new tab in practice, and says only that: "Opened google.com in Brave Browser." A bare "open
  a new window" (of what?) goes to the router.
- **"Open stripe.com in Safari"**, **"Go to github.com in Brave"** (`open_url` with the browser in `app`): the page in
  that browser (NSWorkspace `openURLs:withApplicationAtURL:`), "Opened stripe.com in Safari." The address rules are
  unchanged (no downloads of installers or scripts, no redirects); "Go to stripe.com" alone still opens the default browser.
- **"Search for remote work tools in Chrome"**, **"Google X"**, **"Look up X in Brave"**, **"Look up X online"**
  (`search_web`, the words in `text`, at most 200 characters): Google's results
  (`https://www.google.com/search?q=…`, the words form-encoded) in the browser named, else the front or default one:
  "Searched Google for remote work tools in Google Chrome." "Search for X" or "look up X" with no browser or "online" may
  be about files, so it goes to the router.
- Browsers she knows by name (`open::BROWSERS`, the same table as `BROWSERS` in `src/lib/front.ts`): Safari, Chrome,
  Brave, Arc, Firefox, Edge, Opera, Vivaldi, Orion, Zen, DuckDuckGo. Only a browser can be the target: "Notes isn't a web
  browser". A browser that isn't on this Mac is refused by name ("I couldn't find an app called “Brave Browser”").
- All three are routine (they open; nothing is sent or changed), and a quarantined or out-of-place browser is refused as
  any app is.

### What she did lately (for a look and the chat)

Rust keeps the done lines of the last ten minutes (`Front::recent`, at most six, cleared on signing out; typing is
"Typed it.", never the text). Every v2 look sends them as `recent` (`[{ "line": "Opened Brave Browser.", "minutesAgo": 3
}]`) and the notch's chat as `macRecent` (Rust sets it in `api`, replacing anything the page put there). Boredroom keeps
only its own fixed lines and tells the model, as facts, "What you did on their Mac in the last few minutes (Boredroom's
record): …"; a front look is also told what Brenda for Mac does (open apps, pages in the browser they name, new tabs,
searches, files; acts after their yes), so she never says she can't control the browser. Neither field is required: an
older Mac or server works as before.

### Jobs

"Organise my desktop": the strip says "Organising your Desktop, 23 of 64" with **Stop**; the pointer on it opens the job
card (the orange progress bar, the note, the time, Stop). You carry on working. Done: "I moved 64 files into 7 folders on
your Desktop." with **Undo**, and any new file with **Open** and **Show in Finder**. "Delete my old screenshots" finds them
and asks "Move 41 screenshots to the Trash?" before anything moves. The Files helper never deletes, never replaces
(a name that is taken gets " 2"), leaves hidden and system files and anything changed in the last five minutes alone, and
keeps an Undo record on this Mac for a week. A job pauses while the Mac sleeps or Boredroom can't be reached and carries
on after; after 30 minutes without Boredroom it stops ("I lost Boredroom, so I stopped"; Undo still works). Stop is on the
strip, the card, the menu bar's "Stop Brenda", or say "stop"; Esc and her keys stay yours while a Files job works. The Mac
operator asks once per Mac, "Let Brenda click and type for you?", then works as phase 2's tasks do, titled with what it is
doing ("Filling in the form"), stopping before every Send, Submit, Pay or Delete; Esc, her keys and Stop stop it, and if
Brenda is in front it pauses with "Click the app you want me to work in, then press Carry on." **Jobs on this Mac** (in
Help on this Mac) lists the live job and the last three, with Undo; Boredroom's **Jobs** page lists them for you alone.

### Check with me before every task

A switch on Help on this Mac and in Boredroom (Settings › Your assistant), off by default: on, she asks "Do you want me to
do this?" before anything, even opening an app. Only you can change it (`PUT /brenda/mac-permission`); the notch tells
Rust the new value at once.

### Folders I work in

The Files helper works in Desktop, Documents and Downloads, plus up to ten folders you add (**Add a folder…** opens macOS's
own folder picker); never Library, system or hidden folders. Each shows whether macOS has let Brenda in.

### What Boredroom keeps

Your requests (your exact words, how you asked, when) and what she did, for 30 days, for you alone (Activity › On your
Mac, each with Forget); a job's row with its title, progress, outcome and counts. Never a path: files are named to the
model by short references the Mac keeps, and the Undo record stays on this Mac. Names of files (and, for summaries and
conversions, their text) go to Claude through Boredroom's key. No owner, HR or lead can read any of it.

### Errors that recover by themselves

Every failure says what still works: "I can't reach Boredroom right now. Simple things like opening apps still work.";
"I can't think that through right now. Boredroom's AI account has run out of credit. Simple things like “open Figma” still
work."; "Claude is busy just now. Try again in a moment." A missing permission is never just "I can't": **Allow it** opens
that setup step, **Turn it on** the setup card.

### Previews

`preview.html` mocks this build's Rust with `&binary=4` (the default for these states; `&binary=2` or `&binary=3` shows
the same request on today's or phase 3's Rust, where nothing new shows; `&ready=0` is a server before 0060): `front-doing`
(`&finish=1` finishes; `&cmd=arrange|volume|hide|quit` says "Put Slack and Figma side by side", "Turn the volume down",
"Hide everything" or "Quit Spotify" instead of "Open Figma"),
`front-done` (`&undo=1` a screenshot with Undo, `&others=2` the newest invoice and "Show the others"), `front-routing`,
`front-ask` (`&what=trash|wifi|check`), `front-choose`, `front-found`, `front-refused`
(`&why=app_none|not_open|installer|accessibility|screen|secure|nothing_selected|no_box|finder_denied|wifi_admin|offline|no_credit|busy`),
`job-running` (`&bar=1` keeps the strip; `&finish=1` runs to the end), `job-paused` (`&why=sleep|offline`), `job-ask`,
`job-done` (`&outputs=1`), `job-stopped`, `job-failed`, `job-undone`, `job-replay` (plays `brenda://job` events exactly
as the Rust emitted them, set on `window.__replay` by a test driver, `&every=` ms apart; the integrator's run of the real
Files runner on a temp Desktop, 16 October 2026), `jobs-recent`, `consent-click`, `settings-v4`
(`&check=1&click=1&added=Projects`, `&scroll=end` to the new rows, `&press` presses Check with me; `&save=error` refuses the
save), `operator-doing`, `operator-paused-own` (`&carry=1` presses Carry on and the steps go on), `look-think`,
`reply-quick` (a reminder with Undo) and `reply-confirm`
(send_message). `&natural` gives short lines a natural-voice offer. Nothing is opened, clicked, typed, moved or deleted:
the console logs what Rust would do.

### Under `tauri dev`

Accessibility, Screen Recording, Automation (Finder) and the folder prompts belong to the terminal that launched Brenda,
not to Brenda.app.

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

## Calls

Owner decisions, 8 October 2026, confirmed 10 October 2026 (phase 8, "build Phase 8, cook"): screen recording is gone and
people call each other instead (one to one from a direct message, a team call or a group call from a channel, on every
plan; video through LiveKit Cloud). The call itself always runs in the person's browser: WKWebView's limits on the
camera, the microphone and screen sharing, the notch's size, and no Rust change in this phase. Up here the notch:

- **Rings.** `pollCalls` in `main.js` asks `GET /calls/now` through the existing `api` command (the bearer token stays in
  Rust) and asks again after each answer at the server's `pollMs`, clamped to 2 to 60 s: 4 s normally, 2 s while a call
  rings, 60 s before migration 0054 or without LiveKit. A server from before phase 8 (404) is asked again in 5 minutes,
  any other failure in 15 s; a 401 signs the notch out as everywhere. It starts after the first desktop state and stops
  on signing out. Cost: one small JSON read every 4 s per signed-in notch (about 900 an hour, no rate limit on the
  route); nothing about calls is added to the 20-second desktop state except each
  teammate's `onCall`.
- **Shows the incoming card** (`NotifyCards.ringCard`): the caller's assistant's face beside "Call" or "Call in #Design"
  (the byline says where, the headline says who; fix review, 10 October 2026), "Ada Obi is calling", "You're on another call. Accepting leaves it." when it applies, a hairline running down to the ring's end,
  "+1 more calling", then Decline, Message (three quick messages, the web's words, each a decline that sends it as the
  person's own message) and Accept, the card's one orange button. An incoming call outranks every other card, the
  morning opener and the summary (a notification it replaces stays unread in the bar). While the talk keys are held, or
  the open card has something typed, pressed or awaiting a Confirm, the ring is one row at the top of that card instead
  ("Ada is calling", a quiet Decline icon button, "Decline Ada's call", and Accept in white), so nothing typed is lost
  (`Notify.ringAction`). The ring plays every 2.5 s while the card
  shows; Esc silences it and the card stays; the card never folds on its own while the ring lives and closes when the
  ring leaves `/calls/now` (answered elsewhere, cancelled, or the 30 s ran out).
- **Answers and declines.** Accept is `POST /calls/:id/accept` (with `leaveOther` when the person is on another call),
  then `open_in_browser` with `/app/:org/calls/:id?from=notch` (the web page shows Join, whose press turns its sound on),
  and "Opening the call in your browser" for 3 s. Decline is `POST /calls/:id/decline` ("Declined." for 1.2 s; with a
  quick message, "Sent and declined."). A call that ended meanwhile says "The call has ended."; any other refusal shows
  the server's words on the card.
- **Missed calls and notes** are notifications: a missed call has its own card (Join while the call is still on, Call
  back for a direct call, else Open), a call's notes are the plain card from the workspace's assistant. On another call
  (fix review, 10 October 2026), the missed card says "You're on another call." and its Join becomes "Leave it and
  join", which leaves that call first, as Accept does; a Join the server refuses with 409 `IN_ANOTHER_CALL` (the ring poll
  had not seen that call yet) turns into the same choice, never a dead end.
- **On a call,** the compact bar says so first: the live dot, the call's clock in orange digits, "On a call in #Design";
  a click opens the call in the browser. Teammates on a call carry a small phone mark on their faces ("on a call" in
  their title).
- **Quiet hours** ring nothing (the server does not ring anyone in quiet hours either; this is the belt and braces): no
  card, no sound. A missed call waits in the bell and opens after quiet hours like any held card. The tray's sound switch
  silences the ring as it silences every sound (a separate switch for calls up here needs a tray item, a Rust change; the
  web has its own, Settings → Your assistant → Calls).
- **One ringer** (fix review, 10 October 2026: the notch and a Boredroom tab rang at once, out of step). Each ring poll
  says whether the notch rings aloud: `?ring=1` while the tray's sounds are on and quiet hours are off, else `?ring=0`
  (turning the tray's sounds off asks again at once). The server remembers a `ring=1` from a desktop session for 20 s
  against a keyed digest of the network it came from (`call_ringers`, migration 0054; never the address), and a browser
  on the same network then shows its incoming card without a ring. A browser elsewhere still rings, and a notch that
  stops polling (asleep, quit, signed out) hands the ring back to the browser within 20 s.

What it does not do: join or show the call (no camera, microphone, screen share or LiveKit here), turn on Brenda's
notes, or ring when the notch is hidden, the Mac is in Do Not Disturb or the app is not running (the web rings in any
open Boredroom tab, and the missed call is in the bell either way).

### Rust follow-ups (not done in phase 8; `src-tauri` unchanged)

1. A native macOS notification and sound for an incoming call when the notch is hidden or muted, or the Mac is in Do Not
   Disturb (`UNUserNotificationCenter` with a time-sensitive interruption level, Accept and Decline as its actions).
2. Forward `idempotencyKey` as the `Idempotency-Key` header in the `api` command. `main.js` already passes it on Accept
   and Decline (and on the phase 7b presses); the server's Accept and Decline are idempotent today without it.
3. A 5-second timeout for `GET /calls/now` in the `api` command, so one slow answer cannot hold the ring poll (the poll
   never stacks, but it waits for the answer before asking again).
4. A pushed channel (the events stream, or a small WebSocket) instead of polling, so a ring arrives at once and an idle
   notch asks nothing.
5. `NSCameraUsageDescription` (and the microphone's for calls) in `Info.plist` only if calls ever move into the app.

## Look

Boredroom's design system v4 (owner decision, 6 October 2026: the ElevenLabs app's design language, with orange kept as
the accent), dark only. The tokens in `src/style.css` are copied from `src/app/globals.css` and keep its v4 names
(`--background` #0F0F10, `--foreground`, `--secondary` white 64%, `--subtle` 53%, `--border` 7.5%, `--border-input` 10%,
`--fill-0`/`--fill-1`/`--fill-150`, `--primary`, `--accent`, `--ring` and the rest); `docs/design-system.md` describes
them. Inter (UI text, 14/20 medium for titles, 13/19.5 for what goes under them), Geist Mono (the clock, the link
code) and Geist (the summary's count alone) are bundled in `src/fonts` (SIL Open Font License, `OFL.txt`); the notch
loads nothing remote. On the island's true black the web's alpha fills are laid over the canvas as solid colours
(`--surface`, `--surface-150`, the `--tint-*`), so they read as they do on the web (17 October 2026).

- **Surfaces:** panels, fields and outline buttons are near-black #0F0F10 with white 7.5% to 10% hairlines. Lists sit in
  rows of quiet 32px r8 tiles, 4px apart, with no outer box (as the landing page draws this notch). The prompt is the
  web's prompt pill at the notch's size.
- **Buttons:** the web's xs, 28px with an 8px radius, 13px medium, never scaled on a press (17 October 2026: they were
  pills); chips and the quick replies stay round. The primary is white with near-black text, the secondary is outline, the ghost is
  text in secondary, and danger is outline with red text. Each card may have one orange button (`.btn.accent`, orange
  with near-black text) for its one thing to do: Link to Boredroom, Open Boredroom, Start on the briefing, Resume on a
  paused timer, Turn on voice, Turn on screen help, Show me, and a look's Send once it has words. Save, OK, Done, Got it,
  Confirm and Send for review stay white. The send button is
  round, orange once there is something to send and grey until then; while it is orange, the card's other orange
  button turns white, so two never show at once.
- **Badges:** neutral on the solid fill-1, green, amber and red on their solid 12% tints. The orange "New" badge is used for a new task, and the same
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
  frame around the camera; open, a faint 10% hairline traces its sides, bottom and shoulders (as the landing page's
  notch does, so it survives a dark wallpaper) with the web's toast shadow.

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
it is not part of the app. A browser that wants a press before it plays sound shows "Press anywhere to start" first.
Calls (phase 8): `?state=call-incoming`, `call-incoming-group` ("+1 more calling"), `call-incoming-busy` (the ring as the
strip on a follow-up ask that must stay), `call-waiting` (on another call), `call-missed` (Call back), `call-missed-live`
(Join; `&busy` on another call: "Leave it and join"; `&busy=stale`: Join meets the 409 first), `on-call` (the bar with a running clock) and `call-recap`; `&accept=ended` answers Accept with 409 `CALL_ENDED`,
`&hold` keeps it ringing past 30 s, `&calls=404` answers as a server from before phase 8; the mocked `open_in_browser`
logs the call page it would open. The comment at the top of `preview.html` says what each one shows. To
see it in WebKit, as the notch does, open the same address in Safari by hand (Develop › Show JavaScript Console for the
logs); Safari also wants a press first, which the notch does not.
Screen help (owner decisions, 11 October 2026): the `look-` states mock the nine look commands as Rust answers them and
send `brenda://look` and `brenda://voice` (with `lookId`) the way Rust does; the picture is a sample window drawn on a
canvas in the page (nothing is captured), and the mock `look_send` logs what it is sent without the picture.
`?state=look-consent` (`&name=Max` for a renamed assistant), `look-permission` (`&permission=denied` shows "Allow Brenda
in System Settings"), `look-on`, `look-holding` (Control+Command held: listening), `look-preview` (`&pointer=none`,
`&source=button`, `&typed=…`), `look-sending`, `look-reply` (`&mode=auto` for the "Still asking" line; `&send=limit|
switched_off|failed` for the server's errors), `look-refused&reason=on_call|call_unknown|never_look|own_window|
no_window|busy|unsupported|not_available|permission|error|send` (never_look with `&source=fixed|workspace|you`),
`look-off&from=settings|tray`, `look-timeout`, `look-point` (a reply with Show me; `&press` presses it and the mocked
`open_in_browser` logs the page) and `look-call` (a ring arriving while the preview shows: the strip). Every other state
answers the look commands as today's Rust does (they do not exist), so no look feature shows there.

## Releasing Boredroom for Mac

Owner request, 24 October 2026: people download Boredroom for Mac from boredroom.cc/download before there is an Apple
Developer account. The app is one universal build (Apple silicon and Intel), ad-hoc signed (`signingIdentity: "-"`) with
the hardened runtime and `src-tauri/Entitlements.plist` (microphone, camera, Apple events), for macOS 14 or later. The
app is `Boredroom.app`; the file people download is `Boredroom.dmg`. Mac only for now. (The 0.2.0 build that held
`Brenda.app` was never released and is superseded.)

### Once

- `rustup target add aarch64-apple-darwin x86_64-apple-darwin`
- cmake (the speech library): `pip3 install --user cmake` or `brew install cmake`. The script finds either.
- The updater key, made once: `pnpm exec tauri signer generate --ci -w ~/.tauri/boredroom-updater.key`, then the
  `.pub` file's text goes in `plugins.updater.pubkey` (done for 0.2.0; the key has no password, mode 600). **Back the
  private key up** (a password manager): without it no installed copy can ever be updated again, and everyone would
  have to download Boredroom afresh. Never commit it or paste it anywhere.
- A **public** GitHub repo for the files: `Jerryonwuka/boredroom-releases` by default (the main repo may go private).

### Each release

1. Bump the version in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `package.json` (the script refuses if
   they differ).
2. `pnpm release --notes "What changed"` (or `--notes-file notes.md`; `--repo owner/name` or
   `BOREDROOM_RELEASES_REPO` for another releases repo; `--plain` skips the Finder window layout of the disk image, for
   unattended runs; `--out dir` puts the files elsewhere). It builds with `GGML_NATIVE=OFF`, so the speech library runs on
   every Mac rather than only on processors like this one's, then checks both architectures, macOS 14 in both
   slices, the signature, entitlements and hardened runtime, the `boredroom://` scheme and the camera and microphone
   strings, that the app links only system libraries, the disk image
   (verified and mounted, without opening the app) and the update signature against the public key.
3. It writes `release/v<version>/`: `Boredroom.dmg`, `Boredroom_<version>_universal.app.tar.gz`, `latest.json` and
   `SHA256SUMS.txt`, and prints the tag (`v<version>`) and the exact upload list (and a `gh release create` line). It
   never uploads. Make the release on the releases repo, not a pre-release, marked latest; the file names must stay
   exactly as printed.

The website's download button is `https://github.com/<repo>/releases/latest/download/Boredroom.dmg`
(`DESKTOP_DOWNLOAD_URL` overrides it; `off` stops offering it).

`pnpm build` alone now also needs `TAURI_SIGNING_PRIVATE_KEY` (the key's path) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
(empty), because the bundle makes update archives; use `pnpm release` instead, which sets both and the speech library's
flags. `tauri dev` is unaffected.

### Updates

About a minute after it starts, then once a day, Boredroom reads
`https://github.com/<repo>/releases/latest/download/latest.json` (`updater.rs`). A newer version is downloaded in the
background and its minisign signature (and the version it was signed for) checked against the key in tauri.conf.json.
Then "Restart to update to Boredroom X.Y.Z" appears at the top of the menu-bar menu, and the notch shows a one-off
card (when nothing else is going on) with Restart to update and Later. Boredroom › Check for Updates… asks at once and
says what it found. It never restarts by itself; after an update's restart the window opens again only if it was open.
Never under `tauri dev` (unless `BRENDA_UPDATER_DEV=1`), and not while it runs from the disk image or from a
translocated copy (opened from Downloads without moving it to Applications).

### When there is an Apple Developer account

No code changes: set these and run `pnpm release` again.

- `APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)"` replaces the `"-"` in tauri.conf.json.
- Notarisation: `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`; or an App Store Connect
  API key: `APPLE_API_KEY` (the key id), `APPLE_API_ISSUER` and `APPLE_API_KEY_PATH` (the `.p8`).
- On CI: `APPLE_CERTIFICATE` (base64 .p12) and `APPLE_CERTIFICATE_PASSWORD` import the certificate.

Tauri then signs, notarises and staples the app; the script signs, notarises and staples `Boredroom.dmg`, and fails
if Gatekeeper still rejects the app. The first-open steps on /download can then go.

**Until then**, an ad-hoc signature changes with every build, so macOS may ask again for the microphone after an
update, and Screen Recording or Accessibility can look on but not work until the old Boredroom entry is removed in
Privacy & Security and added again (/download says so). A free way round it: make a self-signed code-signing
certificate once (Keychain Access › Certificate Assistant › Create a Certificate…, type Code Signing, e.g. "Boredroom
Local Signing") and release with `APPLE_SIGNING_IDENTITY="Boredroom Local Signing"`; permissions then survive updates.
The first-open steps stay the same.

The release app and `tauri dev` share the identifier `cc.boredroom.brenda` (and so `brenda.json`) and both take
Option+Space: quit the dev notch before trying the installed app.

### Manual checks (the owner, on the installed release build)

Quit the dev notch first. Then: the first launch opens the window with the sign-in and a Dock icon; signing in with
email and password signs the notch in within seconds; quit and reopen needs no second sign-in; ⌘W then the Dock icon
reopens it at the same size and place; signing out in the window signs the notch out, and Continue with Google opens the
browser and comes back ("Open Boredroom?"); signing out from the tray shows the sign-in; Connect a provider in Settings ›
Connected apps finishes in the browser and Back to Boredroom returns; an external link opens the browser and `mailto:`
Mail; a timesheet export lands in Downloads (`xattr -l` shows `com.apple.quarantine`); Edit, View and Window menus work,
⌘, opens Settings, Check for Updates… answers; with the window open, the notch still shows over another app's full
screen, and typing to Brenda doesn't raise the window; ⌘H hides the window, not the notch; a call accepted in the notch
opens in the window with sound and camera, and closing the window asks first; screen help refuses to look at the window;
no "Inspect Element" and no Develop menu entry; offline shows "Boredroom can't connect."

**Before shipping the Dock icon (D6), run the activation-policy spike** (spec §5.1, S1): with a small always-on-top
window made while a menu-bar app, switch to an ordinary app and open a window, put Safari full screen and check the small
window shows there; close it and switch back; repeat ten times quickly and look for ghost Dock icons. If only the
second check passes, the notch hides over other apps' full-screen Spaces while the window is open; if it fails, set
`"dockIcon": false` in `dashboard.json` and consider a separate helper process for the notch.

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
- **Inside an app** (owner request, 17 October 2026: "not stagnant in the app"): while the front app is full screen (its
  own Space, or two apps side by side) or its window covers the screen (maximised or zoomed), the notch hides
  completely, with no bar and no sliver, even with a timer running or "always visible" on. It comes out when the pointer
  touches the very top edge in the middle (the top 4 points, 140 either side of the centre; it works with the menu bar
  hidden), when you hold Control+Command or Option+Space, and when a call rings or a card arrives on its own, and hides
  again about half a second after the pointer leaves or the card closes. An ordinary window keeps the bar as before.
  `island.rs` tells the page (`brenda://covered`) from the window server's list of Spaces and the front window's
  bounds. The root cause of the old "nothing shows in apps": the notch window was made from the config before Brenda
  became a menu-bar app, and macOS never lets such a window into other apps' full-screen Spaces (it stayed on the
  ordinary desktops only); `lib.rs` now makes it after (`"create": false` in `tauri.conf.json`).
- **Reactions:** click her face to poke her, three quick pokes make her dizzy, and resting the pointer on her gives her
  heart eyes.

These techniques and timings come from [Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé (MIT licence,
code only). Coucou's character, sounds, icon and name are not used: its asset licence reserves them.
