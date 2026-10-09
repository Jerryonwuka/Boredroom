// Brenda's notch (owner decision, 3 October 2026). Plain JavaScript, no build step.
//
// Signed out: a link code to approve in Boredroom. Signed in: a compact bar (Brenda's face, the running timer or what
// is due), which opens into one card at a time: Brenda's notifications (clock-in, reminders, nudges, assignments), the
// morning briefing once a day, or the timer with its progress ring. Cards close on their own after a few seconds
// unless the pointer is on them. Every action goes through Boredroom's own API with the person's permissions.
//
// Voice, step one (owner decision, 3 October 2026): hold the talk shortcut, speak, let go. The Rust side records only
// while the keys are held, turns the speech into text on this computer and sends `brenda://voice` events; this page
// shows each step, sends the text to Brenda's chat, shows and speaks the reply, and offers Confirm for anything Brenda
// prepared that needs a yes.
//
// Motion, face and sound (owner decision, 4 October 2026; ideas and timings from Coucou by Louis Raillé, MIT — its
// character, sounds and artwork are not used): the window is a fixed transparent stage and the island inside it springs
// open and eases shut; content blurs in once per view; Brenda's eyes follow the cursor, she blinks and breathes, and her
// face and the card's glow follow what is happening; small synthesised sounds mark opening, arrivals, success and voice.
//
// Also from Coucou (owner decision, 4 October 2026): drop a file on Brenda to attach it to one of your tasks and send it
// for review; team leads see small faces for the teammates who are working; the notch tucks away when nothing needs you
// and peeks out when the pointer reaches the top of the screen; and Brenda reacts to being poked or admired.
//
// The notch follows the web (owner decision, 5 October 2026): the timer laid out like My Day's, and what is said to
// Brenda up here kept with her past chats in Boredroom, so it can be carried on there. A Confirm that already ran counts
// as done, and nothing here points at the Reports or Policy pages, which are gone.
//
// Design system v4 (owner decision, 6 October 2026): style.css follows the web's v4 (the ElevenLabs app's language, with
// orange as the accent): Inter, near-black surfaces and hairlines, white primary pills, outline and ghost buttons, badges
// on fill-1, orange only for focus, the unread count, the open microphone and the timer's estimate and progress. The
// voice card matches the web's (src/components/app/voice-capture.tsx) in the same restyle. Only the markup changed here;
// shape, motion and behaviour are as they were.
//
// The accent rules (owner decision, 6 October 2026: "it looks too monochromatic, let's add nice accents of orange"):
// orange marks what is live, active, chosen or the one thing to do, as on the web (docs/design-system.md). Here that is
// a running timer's dot and digits (`live`), Brenda listening or working, teammates' running timers, progress, the
// unread count, the ask pill's focus ring, and one standout button per card (`btn primary accent`): Send once there are
// words, Start on the briefing, Resume on a paused timer, Link to Boredroom / Open Boredroom, Turn on voice. style.css
// turns the card's other orange button white while Send is lit. Only classes changed; behaviour is as it was.
//
// The recording look and her reactions (owner decisions, 7 October 2026: "I want our voice note recording to look exactly
// like ElevenLabs' one, the whole wave thing when recording, let the change also reflect in the notch", and "I want
// Brenda to give reactions when you do actions"). While the talk keys are held the voice card shows the live waveform
// (`Wave` below, the web's src/components/ui/live-waveform.tsx in plain JavaScript) with the time running beside the
// orange live dot, and Brenda listens: her eyes widen and swell with the voice, her glow with them. While the person
// types in the ask box her eyes read along, following the caret; once it is sent she thinks; a reply pleases her. The
// island's shape, hover-open, click-through and every action are as they were.
//
// Replies easy to scan and icons that move (owner requests, 7 October 2026: "if you're listing things, it should not be in
// a paragraph; list it", and "I want our icons to be animated icons"). Her replies arrive as light Markdown and are drawn
// here as on the web: paragraphs, bulleted and numbered lists, bold, and links to Boredroom pages (`md` below, which
// escapes every piece of text it is given and writes only its own few tags); the spoken version stays plain (`plain`).
// The icons on buttons play a small move once on hover and keyboard focus (style.css, "Icons that move"), as the web's
// animated icons do; never a loop, and nothing under reduced motion.
//
// Personal assistants (owner decision, 7 October 2026: phase 1). Each person has their own assistant in each workspace,
// with a name, a sphere colour, a visor and eyes (Brenda as she is unless they choose otherwise); the workspace has one of
// its own that signs what it sends by itself. The desktop state carries both, resolved, with the face colours to draw
// (`assistant`; this page cannot import src/lib/assistant-look). Every face here is the person's own assistant and every
// label names it ("Ask Max…", "Max is on it…"); the end-of-day report's card shows the workspace's. Signed out, and where
// the words name the product (the plan gate), she is Brenda. The last profile seen is kept per workspace on this
// computer, so the first paint after launch already shows theirs. Teammates' small faces are unchanged.
//
// Her voice (owner decision, 7 October 2026: phase 2). She reads her replies aloud with the Mac's own voice when the
// person chose so in Boredroom (`data.assistant.speak`: "voice", the default, answers aloud what was said with the talk
// keys; "always"; "never"), saying the words the server made speakable (`spoken`: no Markdown, links, ids or tokens;
// `plain` stays for an older server). Rust renders the reply, measures it and sends `speaking` with the real level of
// what is playing every 30 ms, then `spoken`; meanwhile her own faces talk (`.face.talk` and `--talk` in style.css): her
// eyes squash and open with each syllable, she bobs a little and her glow brightens in her own colour, and under reduced
// motion she holds a still speaking pose. When Rust could only speak the plain way (`synthetic`), this page makes the
// syllables itself. The reply card has a Listen / Stop button whatever the preference and stays open while she talks;
// she stops when the person types to her, asks something new, closes the card or signs out (the talk keys stop her in
// Rust, and she never speaks over an open microphone).
//
// Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4). "Instead of following up
// with the people, the assistants follow up with each other's assistants." When someone's assistant asks about the
// person's work and their work does not answer it, their own assistant asks them once: an unread `brenda.followup_ask`
// whose follow-up is waiting (the desktop state's `followUps.waiting`) opens the request card, which stays until it is
// answered, Not now or Esc. It shows the asker's assistant, the question quoted, when the reply is due, four quick replies
// (On track, Blocked, Done, Not started), a one-line note typed or said (while it is open the talk keys write into the
// note instead of asking her), what their assistant will share, and that a reply never changes the task. Not now tells
// the asker's assistant they can't answer right now. The person's own follow-ups come back as `brenda.followup_answer`
// (or `brenda.followup_batch` for a group): the answer card shows both assistants' faces and the answer as plain text,
// never Markdown, with Open and Done. Everything other people wrote goes through esc() only, and only Boredroom paths
// open. An older server (no `followUps`) gets the plain notification cards, as before.
//
// Asking your assistant in Messages (owner decision, 8 October 2026: personal assistants, phase 5). "@Max …" in a
// conversation makes the person's own assistant reply there, and "@Ben" tells Ben. Nothing new in the desktop state: the
// notifications carry it all (type, title, body, href). `message.mention` ("Olu Adeyemi mentioned you in #design") shows
// the message in a quoted bubble; to the person who asked, `brenda.mention_reply` ("Max replied in #design") the reply,
// `brenda.mention_confirm` ("Max needs you to confirm in #design") what waits for their Confirm, which is given only in
// the conversation (the tokens never leave the server), and `brenda.mention_private` ("Max answered you in #design", or
// "Max couldn't answer in #design") the answer only they can see, or why there was none. Every one is the person's own
// assistant's face and plain text through esc(), never Markdown or a link; Open goes to the conversation (Boredroom paths
// only) and OK marks it read.
//
// Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6). "I want all the bots to be
// able to communicate with each other." Someone's assistant can pass the person a message, hand them a request to accept,
// and bring back a reply or the outcome of their own request; the desktop state's `assistantItems` (DesktopAssistantItems)
// says what is waiting for the person and what came back in the last day. An unread `assistant.message` whose item is
// waiting opens the message card: the sender's assistant's face, the message as sent in a quoted bubble (plain text through
// esc(), never Markdown or a link), whether it was reworded, Seen and Reply (one line, typed or said with the talk keys,
// then Send, the card's one standout). An `assistant.request` opens the request card: what would change, the sender's
// note, that nothing changes until they accept and when it expires, Decline (with a reason, if they like) and Accept,
// then what happened. Nothing on the person's account changes until they press Accept, and then Boredroom does it as them.
// `assistant.outcome` and `assistant.reply` open an update card with both assistants' faces, Open and Done. Esc never
// marks anything seen. `assistant.tagged` (their assistant was tagged in Messages) and `assistant.thread_reply` (someone's
// assistant answered their tag) are mention cards. An older server (no `assistantItems`, or not ready) gets the plain
// notification cards, as before.
//
// Acting without asking (owner decision, 8 October 2026: "there should be a setting where we can bypass the permission,
// you can toggle it on and off, just like the way it is on Claude Code"). The person's mode is on their assistant profile
// and Boredroom decides with it (the desktop state's `assistant.act` and each chat answer's `act`, an ActState from
// src/lib/act-mode.ts): in "Act without asking" what they ask for in their own chat runs at once instead of waiting for
// Confirm, and the safety floors still ask. The notch shows the mode and leaves changing it to Boredroom (Settings, Your
// assistant, or the pill in the chat's box): while it is in force the chat card's header carries an amber "Acting without
// asking" pill; before the database update (`ready: false`), while the workspace has it off or someone else is signed in
// as the person, and from an older server, nothing shows. What she did comes back as done lines: one done without asking
// ends "(without asking)", and one that can be undone has Undo while the server's offer lasts (its `until`, 10 minutes;
// the card folding away ends it here). Undo is the person acting again, once (POST /brenda/undo); the line then reads
// "Undone", the server's words are said under the same rule as a Confirm's result, and a refusal shows the server's words
// on the card. A Confirm that still asks says why under its summary ("Still asking: Max read other people's words in this
// reply."). Each answer's `tainted` is kept on it and sent back with the conversation, so Boredroom knows other people's
// words are earlier in this chat; past chats keep `tainted`, `auto`, `undone` and `why`, never an Undo token (as never a
// Confirm token).
//
// Brenda keeps the loops closed (owner decision, 8 October 2026: phase 7a). Four things up here, all read from the desktop
// state and the chat's answers; nothing new is decided on this computer.
// - The morning opener (`opener`, an Opener from src/lib/opener.ts, which this page cannot import). The day's first card,
//   once per day per computer (the briefing's own localStorage key), opens with the counts behind the person's day
//   (requests waiting, overdue tasks, answers to their follow-ups, messages from other assistants, reviews for leads) as a
//   list, label left and number right ("not available" in grey, never 0), or the calm line on a quiet day, and up to
//   three one-tap actions made for those counts: a link opens that Boredroom page, an ask puts its words in the ask box
//   and never sends them (owner decision, 5 October 2026). The first is the card's one orange button. An older server (no
//   `opener`) gets the briefing card as before. It never opens during quiet hours; once they end, or on a new day while
//   the notch keeps running, it opens on the next poll once the pointer has moved in the last two minutes, so it is not
//   spent on an empty desk.
// - Routines (`routineRuns`, DesktopRoutineRun). `brenda.routine` opens the routine card: her face, the routine's name and
//   lead, up to five lines (each with Open when it has a Boredroom page), Open for the run and Done; `brenda.routine_bundle`
//   the runs held over quiet hours, together; `brenda.routine_failed` why one couldn't run. The pill says Routine. Every
//   word goes through esc(), never Markdown, and only Boredroom paths open. Without `routineRuns` (an older server, or
//   before migration 0046) the plain notification card.
// - Quiet hours (`quiet`, a QuietState from src/lib/routines.ts, worked out by Boredroom in the person's time zone). While
//   they are on nothing opens on its own, no sound plays at all (Sound.setQuiet), she reads nothing aloud on her own (a
//   reply to the talk keys shows, with Listen), and the compact bar says "Quiet until 07:00" when it has nothing else to
//   say; the unread count still shows, and opening her, Listen and every button still work. A missing or unready `quiet`
//   (an older server, before 0046) is never quiet.
// - The Confirm readback (`proposals[].readback`, a Readback from src/lib/confirm-readback.ts). Each Confirm names who gets
//   what: "Goes to" over its lines (people, a channel with its member count, an assistant; at most six, then "and 2 more")
//   and "What they get: …", under the summary and its why; Confirm is described by them for screen readers, and past
//   chats keep them. The consent rule holds here as everywhere: an answer or agreement that arrives through another
//   person's assistant never confirms anything; only the person's own press of Confirm (or Y) does.
//
// Brenda keeps the loops closed, second part (owner decision, 8 October 2026: phase 7b). The desktop state's `loops`
// (DesktopLoops in src/lib/commitments.ts, which this page cannot import) says what waits for the person; nothing is
// decided on this computer.
// - A noted commitment (`brenda.commitment`: the workspace's assistant noted they said they'd do something in a group
//   chat) opens its card: the workspace assistant's face, the sentence, what it is in a quoted bubble, when it is due,
//   then Open, Not a commitment and the accept button in the server's words ("Add to my to-dos", or "Accept" for the owner
//   and HR, who hold no to-dos), the card's one orange button. An open ask (`brenda.open_ask`: someone asked them and
//   nobody agreed in the thread) opens the same card with Take it on, Decline (with a reason, if they like: the asker is
//   told, privately) and Open. Accept is the consent (owner decision: a to-do from someone else's words always asks):
//   nothing is added to their list until they press it here or in Boredroom, whatever their act mode says.
// - Blocked on you (`brenda.blocked_on`): who is waiting, on which task, and their question quoted; the answer is typed in
//   Boredroom (Open), and Not me answers here (the person waiting is told it isn't theirs).
// - The day card lists these with what else is waiting (follow-up asks, blocks, requests, commitments, then messages, as
//   the web's inbox orders them), and "3 loose ends" when the person has open ones, which opens their Loose ends page.
// - The other new notifications (due today, overdue, accepted, declined, answered, not theirs, re-plan) are the plain card
//   with their badge in the contract's words. Every press goes to the same route as Boredroom's own buttons, as the
//   person, carrying an idempotency key; opening a card (from the day card, or resting the pointer on one that opened on
//   its own) tells Boredroom it was seen. Other people's words go through esc() only, never Markdown or a link, and only
//   Boredroom paths open. Quiet hours hold these cards like any other. Before migration 0048 (`ready: false`) and from an
//   older server (no `loops`) nothing changes: the plain notification cards show.
//
// Standup, abilities and "How I like things done" (owner decisions, 8–9 October 2026: phase 7c; "they stay private",
// "use English for now"). The desktop state's `standup` (DesktopStandup in src/lib/standup.ts), `abilities.off` and
// `assistant.voice` say what shows; nothing is decided on this computer, and an older server (none of the three) changes
// nothing.
// - The standup card (`brenda.standup`, its entry's id as `resource_id`): her face, "Your standup for Design", the day, the
//   three sections as short plain lists (the person's Yesterday or "Since Friday", Today and Blocked; at most four lines
//   each, then "and 2 more"; esc() only, never Markdown or a link), the readback "Goes to #Design (6 people), as you, sent
//   by Max", then Skip today, Edit (opens the entry in Boredroom: editing stays on the web) and Post, the card's one
//   orange button. Posting always needs this press (the act-mode floor for anything to a whole team): nothing here posts
//   on its own, ever. Post and Skip go to the same routes as Boredroom's own buttons, as the person, with an idempotency
//   key (the server also answers a second Post with the post it already made). The card then says what happened ("Posted
//   to #Design at 09:41" with Open; "Skipped." with Undo while the server allows it). Resting the pointer on it, or
//   opening it from the day card, tells Boredroom it was seen. Never a reminder: one card per draft, as the server sends
//   one notification.
// - The rollup card (`brenda.standup_rollup`, for team leads): "Design standup: 4 of 6 posted", the blockers people named
//   in their own posted words, and who has no update as one plain grey line of names (never a reason, never a warning
//   colour), Open and OK. `brenda.standup_failed` is the plain card with Open.
// - The day card lists "Standup for Design ready" first among what is waiting, and a lead's unseen rollups last.
// - A Confirm for remember_preference or forget_preference (the chat's answer) shows its summary in the quoted bubble, why
//   it still asks, "Only you", and Remember or Forget as the card's one orange button: what her assistant remembers about
//   the person is always their own press, whatever their act mode says.
// - Voice switched off for the workspace (`assistant.voice` false): the talk keys say "Voice is switched off for Max.
//   Change it in Boredroom Settings." once per press and do nothing else, the talk and Listen controls go, and nothing is
//   read aloud. Loose ends switched off: the day card leaves out its loose-ends row. Quiet hours hold every new card as
//   before.
//
// Notifications, "A plus the grafts" (owner decision, 9 October 2026: the approved mockup, with the design judge's spec;
// "build exactly that"). Every notification is one card at a time, drawn by notify-cards.js (`NotifyCards`: a short
// headline, numbers as chips, the sender's assistant's face in the mood of the news, a wash in the colour of its kind);
// this page decides when one opens, how long it stays and what the bar says, with the pure rules in notify.js (`Notify`).
// - Nothing chains any more: closing a card never opens the next one (today's closeCard() → setTimeout(nextNotification,
//   600) is gone). What arrives is decided once, after each poll (`arrive`): one alone opens its card; two or more together,
//   or what waited through quiet hours or time away, open the summary ("Hey Jeremiah, you have 8 notifications", the row of
//   faces, the kind chips, Mark all read and Show them); while a card is open they only join the bar ("+2 waiting" on the
//   card); while the pager is open they join right behind the current card.
// - The pager (C's footer: ‹, "3 of 8", Next › that becomes Finish, a dot per card in its kind's colour) is turned by the
//   person only: ← and →, Enter for the card's main action, Esc folds it and keeps the place; Next reads a notice (never an
//   ask); Mark all read reads the notices and keeps the asks; acting on a card shows what happened for 600 ms, then moves
//   on; after the last, "All caught up" for 4 s.
// - A card that arrived on its own holds 3 s plus 0.3 s a word (6 to 14 s), its countdown hairline in its kind's colour;
//   an ask holds 15 s and then tucks into the bar ("Ben is waiting on you") until it is answered, read, opened again or
//   something newer arrives (supersedes "stays until answered"; it still stays while a box is open or a press is in
//   flight). The pointer on the island, or keyboard focus in it, pauses the clock; leaving gives at least 3 s more (the
//   3-second linger), and the open pager also stays 3 s after the pointer leaves. An island opened by hovering still folds
//   at once (the 5 October rule, LEAVE_GRACE_MS). Quiet hours open nothing and the count grows; when they end, or on the
//   first movement after five minutes away, what waited opens as the summary or its one card.
// - The bar never says "All clear" beside a count: one or two unread, the newest sender and their line; three or more,
//   "8 new, 2 need you" with the faces that brought them; the open home card starts with the same row, which opens them.
// - The empty black island the owner saw (a view that threw halfway through drawing left the island open around the bar's
//   "All clear"; a view with nothing to draw opened an empty one) cannot happen any more: render() builds the card before
//   it touches the page and drops a card that cannot be drawn, fit() checks that an open island has content, and the
//   island measures itself again whenever its content changes size or a transition ends.
// - Review, 9 October 2026: only a notification newer than anything seen arrives (an older unread one moving into the
//   state's newest 20 never pops); the bar and the summary count every unread one (`notificationsUnread`) and Mark all
//   read goes on past the 20; the morning opener still comes before what waited through quiet hours or time away; the
//   pager takes the keyboard only when the notch already has it (it can never give it back to the person's app), and
//   Enter presses a card's main action only once the person has touched that card; the notch tucks away when nothing new
//   is waiting (what was already shown may stay unread), as before.
// Without notify-cards.js (it failed to load, or a template throws) the cards as they were draw instead.

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const island = document.getElementById("island");
const el = document.getElementById("notch");
const countdown = document.getElementById("countdown");
const COMPACT = { w: 220, h: 40 };
const PEEK = 14;            // the compact bar widens a little under the pointer
const WIDE = 420;
// Notifications, "A plus the grafts" (owner decision, 9 October 2026): a notification card, the summary, the pager and the
// end card are 440 px wide (their root is `.nc`); the bar is 300 px while it names a sender or the mix of what is waiting.
const WIDE_NOTICE = 440;
const COMPACT_WIDE = 300;
const POLL_MS = 20_000;
const PRESENCE_MS = 10 * 60_000;
const CLOSE_AFTER_MS = 8_000;
/** A reply with a line that can still be undone stays this long (review, 8 October 2026), longer while the pointer is on it. */
const UNDO_CLOSE_MS = 60_000;

let config = null;          // { baseUrl, signedIn, workspaceSlug, workspaceName, displayName }
let data = null;            // the last desktop state from Boredroom
let offsetMs = 0;           // server clock minus ours, for the timer
let link = null;            // { deviceCode, userCode, verifyUrl, interval, expiresAt }
let card = null;            // what is open: { kind, ... } or null for the compact bar
// Notifications (owner decision, 9 October 2026: "A plus the grafts"; the header says what they do). `nq` is Notify's
// arrival state: the ids known (with when each was first seen), held through quiet hours or time away, and shown ("will
// not pop again on this run", the old `shown`). `readHere`: the ids read from here, left out of the inbox even before the
// next poll agrees. The pager ({ ids, index, seen }), the place it keeps when it folds, and the notifications it was
// opened over (a read one stays reachable with ‹). `waitingAsk`: an ask that held its 15 s and tucked into the bar.
let nq = Notify.initial();
const readHere = new Set();
let pager = null, pagerPlace = null;
const pagerNotes = new Map();
const pagerRun = new Set();  // every id the pager has shown since the person opened it (All caught up counts the read ones)
let pagerLeft = false;       // the pointer has left the open pager (its steps then keep the 3 s fold going)
let pagerSeen = new Set();   // the cards seen in the pager when it folded (their dots stay dimmed when it opens again)
let waitingAsk = null;
let barWide = false;        // the compact bar names a sender or the mix (COMPACT_WIDE)
let stepDir = 0;            // the pager's last step (+1, -1): the next draw slides that way instead of blurring in
let drawnAt = 0;            // when the current view was first drawn (Enter waits ENTER_GUARD_MS after it)
// The hold of a card that arrived on its own: when it ends, what is left of it while paused, and its timer.
const hold = { active: false, paused: false, endAt: 0, left: 0, timer: null };
let closeTimer = null, pollTimer = null, linkTimer = null, presenceTimer = null;
let hovering = false, busy = false, error = null, editingServer = false;
let voice = { enabled: false, modelReady: false, downloading: false, shortcut: "⌥ Space" };
let talk = [];              // the spoken conversation so far, forgotten after a few quiet minutes
let talkAt = 0;
let cursor = null;          // the cursor in window coordinates, from Rust (for the eyes and hover)
let gaze = null;            // the caret in the ask box while the person types to her (she reads along), or null
// The boxes the person types in: the ask box, and a card's one-line note (`fnote`: a follow-up's note, phase 4; a reply to
// a passed-on message or a reason for declining a request, phase 6, 8 October 2026). Typing in either keeps the notch
// focused, cuts her off and has the face on the card read along.
const TYPING = new Set(["ask", "fnote"]);
let viewKey = "";           // which view is showing; content animates in only when it changes
let wasOpen = false;
let tucked = false, tuckTimer = null, alwaysVisible = false;
let fx = null, fxTimer = null, loveTimer = null;   // a passing reaction on Brenda's face: squash, dizzy, love
const pokes = [];
// Her voice (owner decision, 7 October 2026): she is talking (Rust said `speaking`), the pulse standing in for levels
// when Rust has none (`synthetic`), she was asked to speak and has not started yet (rendering takes a moment), and the
// last level, put back on her faces after a render.
let talking = false, talkSynthetic = null;
let talkWaiting = false, talkWaitTimer = null, talkLast = 0;
const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
const TUCK = { w: 96, h: 5 };
const TALK_MEMORY_MS = 3 * 60_000;
const REPLY_CLOSE_MS = 16_000;
// The morning opener (phase 7a, 8 October 2026): opened from a poll only while the pointer has moved this recently (the
// person is at the computer), and at most once per day on this run even when storage is blocked.
const PRESENT_MS = 2 * 60_000;
let lastMoveAt = Date.now();  // launching the notch counts as being there
let briefedOn = "";
let quietTimer = null, wasQuiet = false;

// ---- helpers -------------------------------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The person's assistant (owner decision, 7 October 2026: personal assistants). The desktop state's `assistant` is
// { personal, workspace }, each { name, colour, visor, eyes, face: { hi, mid, edge } } (src/server/services/desktop.ts).
// Nothing from it is drawn unchecked: the visor and eyes must be one of their three shapes, the face colours #rrggbb (else
// Brenda's three), and the name goes into the page only through esc() or as an attribute set by the DOM.
const BRENDA = { name: "Brenda", colour: "white", visor: "bean", eyes: "pill", face: { hi: "#ffffff", mid: "#ececf0", edge: "#c9cad1" } };
const VISORS = ["bean", "band", "screen"];
const EYES = ["pill", "round", "square"];
const HEX = /^#[0-9a-f]{6}$/i;
const NAME_MAX = 24;        // the server's rule (src/lib/assistant-look.ts); a longer one is cut, never trusted
let cached = null;          // the person's assistant as last seen in this workspace on this computer (localStorage)

/** A profile as the notch may draw it: anything missing or unexpected is Brenda's. */
function assistantOf(p) {
  if (!p || typeof p !== "object") return BRENDA;
  const name = typeof p.name === "string" ? [...p.name.replace(/\s+/g, " ").trim()].slice(0, NAME_MAX).join("").trim() : "";
  const f = p.face && typeof p.face === "object" ? p.face : {};
  const shades = [f.hi, f.mid, f.edge].every((v) => typeof v === "string" && HEX.test(v));
  return {
    name: name || BRENDA.name,
    colour: typeof p.colour === "string" && /^[a-z]{1,16}$/.test(p.colour) ? p.colour : BRENDA.colour,
    visor: VISORS.includes(p.visor) ? p.visor : BRENDA.visor,
    eyes: EYES.includes(p.eyes) ? p.eyes : BRENDA.eyes,
    face: shades ? { hi: f.hi, mid: f.mid, edge: f.edge } : BRENDA.face,
  };
}
/** The person's own assistant in this workspace (Brenda while signed out). */
const me = () => (config?.signedIn ? assistantOf(data?.assistant?.personal ?? cached) : BRENDA);
/** The workspace's own assistant, which signs the end-of-day team report. */
const ws = () => (config?.signedIn ? assistantOf(data?.assistant?.workspace) : BRENDA);
const cacheKey = () => `brenda-assistant:${config?.workspaceSlug ?? ""}`;
/** The first paint after launch draws the assistant last seen in this workspace, before the first poll answers. */
function loadCached() {
  cached = null;
  if (!config?.signedIn || !config.workspaceSlug) return;
  try { const raw = localStorage.getItem(cacheKey()); if (raw) cached = assistantOf(JSON.parse(raw)); } catch { /* storage blocked or unreadable */ }
}
/** Each poll keeps the person's assistant for next time (written only when it changed). */
function keepCached() {
  const p = data?.assistant?.personal;
  if (!p || !config?.signedIn || !config.workspaceSlug) return;
  const next = assistantOf(p), json = JSON.stringify(next);
  if (cached && JSON.stringify(cached) === json) return;
  cached = next;
  try { localStorage.setItem(cacheKey(), json); } catch { /* storage blocked */ }
}

/**
 * Brenda's face, drawn as the person's own assistant (or `o.who`, such as the workspace's): its sphere colours, visor
 * and eyes (style.css `--sphere-*`, `data-visor`, `data-eyes`). mood: happy | alert | sad | think | listen; tone: the
 * glow (accent, ok, warn, bad; blue and violet draw none). Her own faces (`data-own`, no `o.who`) talk while she speaks
 * (`talk`, owner decision, 7 October 2026: her voice); the workspace's assistant never does.
 * Notifications (owner decision, 9 October 2026: "A plus the grafts"): `cls` adds classes (sizes and states such as
 * "xl still away", lower-case words only), `look` fixes where the eyes look ([x, y], each -1 to 1: the two faces of
 * Together look at each other, and stepFace leaves them be), and `label` names the face for screen readers.
 */
const FACE_CLS = /^[a-z -]{0,60}$/;
const face = (o = {}) => {
  const a = assistantOf(o.who ?? me());
  const own = !o.who;
  const cls = typeof o.cls === "string" && FACE_CLS.test(o.cls) ? ` ${o.cls.trim()}` : "";
  const mood = typeof o.mood === "string" && FACE_CLS.test(o.mood) ? o.mood : "";
  const lk = Array.isArray(o.look) && o.look.length === 2 && o.look.every((v) => typeof v === "number" && Number.isFinite(v)) ? o.look.map((v) => Math.max(-1, Math.min(1, v)).toFixed(3)) : null;
  const label = typeof o.label === "string" && o.label.trim() ? ` role="img" aria-label="${esc(o.label.trim())}" title="${esc(o.label.trim())}"` : "";
  return `<span class="face ${o.small ? "small" : ""} ${mood}${cls}${own && talking ? " talk" : ""}"${own ? " data-own" : ""} data-sphere="${esc(a.colour)}" data-visor="${esc(a.visor)}" data-eyes="${esc(a.eyes)}" style="--sphere-hi:${esc(a.face.hi)};--sphere-mid:${esc(a.face.mid)};--sphere-edge:${esc(a.face.edge)}${lk ? `;--lx:${lk[0]};--ly:${lk[1]}` : ""}"${lk ? ` data-look="${lk.join(",")}"` : ""}${label} ${o.tone ? `data-tone="${esc(o.tone)}"` : ""}><span class="eyes"><span></span><span></span></span>${o.dot ? `<i class="dot ${esc(o.dot)}"></i>` : ""}</span>`;
};
/** A teammate's small face: their own assistant (owner request, 9 October 2026), in its colour with its visor and eyes (Brenda when the server sends none), with a dot when their timer is running (orange), paused (amber) or interrupted (red). */
const MATES = 8;
const hue = (id) => `var(--mate-${[...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) % MATES})`;
const who = (p) => `${esc(p.name)}${p.task ? `, ${esc(p.task)}` : ""}`;
const mini = (p) => {
  const a = assistantOf(p.assistant);
  return `<span class="face small mini" data-sphere="${esc(a.colour)}" data-visor="${esc(a.visor)}" data-eyes="${esc(a.eyes)}" style="--sphere-hi:${esc(a.face.hi)};--sphere-mid:${esc(a.face.mid)};--sphere-edge:${esc(a.face.edge)}" title="${who(p)}"><span class="eyes"><span></span><span></span></span>${p.state ? `<i class="st ${esc(p.state)}"></i>` : ""}</span>`;
};
const pad = (n) => String(n).padStart(2, "0");
const hms = (s) => `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
/** A length of time the way the web writes it: "3h 00m", "45m". */
const dur = (minutes) => { const m = Math.max(0, Math.round(minutes)); return m >= 60 ? `${Math.floor(m / 60)}h ${pad(m % 60)}m` : `${m}m`; };
const when = (iso) => { if (!iso) return ""; const d = new Date(iso); const today = new Date().toDateString() === d.toDateString(); return d.toLocaleString(undefined, today ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" }); };
const org = (path) => `/api/orgs/${config.workspaceSlug}${path}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** The task's progress ring, as the web's ProgressArc (tone accent): orange over a 10% track, green once done, the percentage in the middle. */
const ring = (value) => {
  const p = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const r = 14.5, c = 2 * Math.PI * r, done = p >= 100;
  return `<svg class="ring" viewBox="0 0 32 32" role="img" aria-label="${p}% done"><circle class="track" cx="16" cy="16" r="${r}"/>${p > 0 ? `<circle class="arc ${done ? "full" : ""}" cx="16" cy="16" r="${r}" stroke-linecap="round" stroke-dasharray="${((p / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 16 16)"/>` : ""}<text class="${done ? "full" : ""}" x="16" y="16" dy=".35em" text-anchor="middle">${p}%</text></svg>`;
};
/** Line icons for controls, drawn like the web's lucide set. Never a generic AI icon: Brenda is her face. */
const ICONS = {
  mic: `<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/>`,
  send: `<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>`,
  pause: `<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>`,
  play: `<polygon points="6 3 20 12 6 21 6 3"/>`,
  stop: `<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>`,
  check: `<path d="M20 6 9 17l-5-5" pathLength="1"/>`,
  shield: `<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>`,
  open: `<path d="M7 7h10v10"/><path d="M7 17 17 7"/>`,
  plus: `<path d="M5 12h14"/><path d="M12 5v14"/>`,
  alarm: `<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>`,
  volume: `<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>`,
  chevron: `<path d="m9 18 6-6-6-6"/>`,
  // Acting without asking (8 October 2026): the mode's amber mark (lucide Zap) and Undo (lucide Undo2), as on the web.
  zap: `<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>`,
  undo: `<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>`,
  // The morning opener's actions (phase 7a, 8 October 2026), the web's lucide icons for its OpenerIcon names: Inbox,
  // CircleAlert, Reply, MessageSquare, ClipboardCheck, List, Users, Calendar.
  inbox: `<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>`,
  alert: `<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>`,
  reply: `<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>`,
  message: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
  clipboard: `<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>`,
  list: `<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>`,
  users: `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  calendar: `<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>`,
};
/** An icon; its class (`ic-<name>`) picks the small move it makes when its button is hovered or focused (style.css). */
const icon = (name) => `<svg class="ic ic-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
// The Reports and Policy pages are gone (owner decision, 5 October 2026): an older notification or answer that still
// points at one gets no Open button.
const removedPage = (href) => /^(?:https?:\/\/[^/]+)?\/app\/[^/?#]+\/(?:reports|policy)(?:[/?#]|$)/.test(String(href ?? ""));
/** How far the running session is through its estimate, 0 to 1, or null without one. */
const estimateShare = () => { const t = data?.timer; return t?.estimateMinutes ? Math.min(1, elapsed() / (t.estimateMinutes * 60)) : null; };

function elapsed() {
  const t = data?.timer; if (!t) return 0;
  if (t.state !== "running" || !t.openIntervalStartedAt) return t.confirmedSeconds;
  return t.confirmedSeconds + Math.max(0, Math.floor((Date.now() + offsetMs - Date.parse(t.serverNow)) / 1000));
}

/**
 * One Boredroom API call as the person. `o.idempotencyKey` (phase 7b, 8 October 2026: the commitment and block presses)
 * rides along to the Rust side as `idempotencyKey`, which sends it as the Idempotency-Key header once its `api` command
 * takes it; until then Tauri leaves the extra argument unread, and the press runs as before (the server's definer
 * functions answer a second press with "already answered").
 */
async function call(method, path, body, o = {}) {
  try { return await invoke("api", { method, path, body: body ?? null, ...(o.idempotencyKey ? { idempotencyKey: o.idempotencyKey } : {}) }); }
  catch (e) {
    if (e && e.status === 401) { await signedOut(); throw e; }
    throw e;
  }
}

// ---- size and placement ---------------------------------------------------------------------------------------

/**
 * Sizes the island to its content. Opening springs (with a little overshoot), closing eases, like Coucou's island.
 * Notifications (owner decision, 9 October 2026: "A plus the grafts"): a notification card is 440 px wide and the bar
 * 300 px while it names a sender; the spring (`growing`) lasts until the island has finished growing (transitionend), so
 * measuring again meanwhile (the content settling, fonts arriving) keeps it. The empty black island (same day): an open
 * island must be an open card with something in it; anything else is reported, the card dropped and the bar drawn.
 */
let fitting = false, growTimer = null;
function fit() {
  const signed = !!config?.signedIn;
  const open = !!card || !signed;
  if (signed && !fitting && (open === el.classList.contains("compact") || (open && el.childElementCount === 0))) {
    fitting = true;
    try { dropCard(`fit: ${card ? `${card.kind} open with ${el.childElementCount ? "the bar's row" : "nothing"} drawn` : "the bar drawn as a card"}`); render(); }
    finally { fitting = false; }
    return;
  }
  island.classList.toggle("open", open);
  // The spring ends with the transition; without one (reduced motion) a moment later.
  if (open && !wasOpen) { island.classList.add("growing"); clearTimeout(growTimer); growTimer = setTimeout(() => island.classList.remove("growing"), 700); }
  else if (!open) island.classList.remove("growing");
  const tuck = tucked && !open;
  island.classList.toggle("tucked", tuck);
  const wide = open ? (el.firstElementChild?.classList.contains("nc") ? WIDE_NOTICE : WIDE) : barWide ? COMPACT_WIDE : COMPACT.w;
  el.style.width = `${wide}px`;
  const w = open ? wide : tuck ? TUCK.w : wide + (hovering ? PEEK : 0);
  const h = open ? Math.ceil(el.offsetHeight) : tuck ? TUCK.h : COMPACT.h;
  if (open !== wasOpen) Sound.play(open ? "open" : "close");
  wasOpen = open;
  island.style.width = `${w}px`;
  island.style.height = `${h}px`;
  invoke("set_island_rect", { x: (window.innerWidth - w) / 2, y: 0, w, h }).catch(() => {});
}
/** Something the notch could not draw: in the app's log (Rust's debug_log) and the page's console, never on screen; the same words at most once a minute. */
const reported = new Map();
function report(msg) {
  const m = String(msg).slice(0, 500);
  const now = Date.now();
  if (reported.get(m) > now - 60_000) return;
  if (reported.size > 50) reported.clear();
  reported.set(m, now);
  console.error(`[notch] ${m}`);
  invoke("debug_log", { msg: `[notch] ${m}` }).catch(() => {});
}
/** A card that cannot be drawn goes, so the island never stays open around nothing (owner decision, 9 October 2026). */
function dropCard(why) {
  report(why);
  if (card?.pager) leavePager();
  card = null;
  cancelHold();
  restartCountdown(0);
  clearTimeout(closeTimer);
}
// The island measures itself again whenever its content changes size (a line going when Undo expires, names opened, an
// error cleared), when a resize transition ends (the rectangle Rust hit-tests with is sent again), and when the page is
// shown again. The observer watches #notch, whose size fit() only sets to the same width again, so it cannot loop.
if (typeof ResizeObserver === "function") {
  let queued = false;
  new ResizeObserver(() => {
    if (queued || !config || (!card && config.signedIn)) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (config && (card || !config.signedIn)) fit(); });
  }).observe(el);
}
island.addEventListener("transitionend", (e) => {
  if (e.target !== island || (e.propertyName !== "width" && e.propertyName !== "height")) return;
  island.classList.remove("growing");
  if (config) fit();
});
document.addEventListener("visibilitychange", () => { if (config && !document.hidden) fit(); });

/** The card's glow and Brenda's mood follow what is showing. */
function moodOf() {
  if (!config?.signedIn || !card) return data?.timer?.state === "running" ? { tone: "blue" } : {};
  if (card.kind === "notification") {
    const t = card.n.type;
    if (t === "brenda.clock_in") return { mood: "happy", tone: "ok" };
    if (t === "brenda.daily_report") return { mood: "happy", tone: "violet" };
    if (t.startsWith("review")) return { mood: "alert", tone: "warn" };
    // Mentions in Messages (phase 5, 8 October 2026): a reply posted pleases her; a Confirm waiting is a warning; a private
    // answer or note stays neutral; someone mentioning the person is the usual arrival.
    if (t === "brenda.mention_reply") return { mood: "happy", tone: "ok" };
    if (t === "brenda.mention_confirm") return { mood: "alert", tone: "warn" };
    if (t === "brenda.mention_private") return {};
    // Someone's assistant answered the person's tag in Messages (phase 6): a reply, as above.
    if (t === "assistant.thread_reply") return { mood: "happy", tone: "ok" };
    // A routine that couldn't run, or was paused (phase 7a): sad, with the amber glow of something that needs them.
    if (t === "brenda.routine_failed") return { mood: "sad", tone: "warn" };
    // Commitments and blocks (phase 7b): one taken on or a block answered pleases her; overdue, and a re-plan waiting for
    // the lead's Confirm, carry the amber glow; a decline or "not theirs" stays neutral.
    if (t === "brenda.commitment_accepted" || t === "brenda.block_answered") return { mood: "happy", tone: "ok" };
    if (t === "brenda.commitment_stalled" || t === "brenda.replan") return { mood: "alert", tone: "warn" };
    if (t === "brenda.commitment_declined" || t === "brenda.block_not_me") return {};
    // Standup (phase 7c, 8–9 October 2026): a draft that couldn't be made is sad, with the amber glow of something left to
    // the person; a rollup is calm news, never an alarm about who didn't post.
    if (t === "brenda.standup_failed") return { mood: "sad", tone: "warn" };
    if (t === "brenda.standup_rollup") return {};
    return { mood: "alert", tone: "accent" };
  }
  // The standup card (phase 7c) waits on the person until they post or skip; posted pleases her; skipped, gone and the
  // rollup stay neutral.
  if (card.kind === "standup") return card.phase === "open" ? { mood: "alert", tone: "accent" } : card.phase === "posted" ? { mood: "happy", tone: "ok" } : {};
  if (card.kind === "standup_rollup") return {};
  // A commitment, an open ask or a block waits on the person until it is answered (phase 7b); taking one on pleases her;
  // the rest of what can come of it stays neutral.
  if (card.kind === "loop") return card.phase === "result" ? (card.decided === "accept" ? { mood: "happy", tone: "ok" } : {}) : card.phase === "gone" ? {} : { mood: "alert", tone: "accent" };
  // Routines (phase 7a, 8 October 2026): a delivery is an arrival; a routine that couldn't run, as above.
  if (card.kind === "routine") return card.n?.type === "brenda.routine_failed" ? { mood: "sad", tone: "warn" } : { mood: "alert", tone: "accent" };
  // The morning opener: a calm day pleases her; otherwise she shows the day as it is, as the briefing does.
  if (card.kind === "opener") return card.o && !shownCounts(card.o).length ? { mood: "happy" } : {};
  // Assistants talk to each other (owner decision, 8 October 2026: phase 6): a message or a request waits on the person
  // (alert, the accent glow) until it is answered; a reply sent or a request done pleases her (happy, green); a request
  // that couldn't be done is sad (red); declined, closed elsewhere and the rest stay neutral. An update pleases her only
  // when it is a reply or a request done.
  if (card.kind === "item") {
    if (card.phase === "sent") return { mood: "happy", tone: "ok" };
    if (card.phase === "result") return card.item?.status === "done" ? { mood: "happy", tone: "ok" } : card.item?.status === "failed" ? { mood: "sad", tone: "bad" } : {};
    if (card.phase === "gone") return {};
    return { mood: "alert", tone: "accent" };
  }
  if (card.kind === "item_update") return card.u?.kind === "reply" || card.u?.status === "done" || (!card.u && card.n?.type === "assistant.reply") ? { mood: "happy", tone: "ok" } : {};
  if (card.kind === "error") return { mood: "sad", tone: "bad" };
  // Follow-ups (owner decision, 8 October 2026: phase 4): an ask waits on the person (alert, the accent glow) until it is
  // sent (happy, green); an answer pleases only when it is one (happy, green), and a no-reply, a not now or a failure
  // stays neutral.
  if (card.kind === "followup_ask") return card.phase === "sent" ? { mood: "happy", tone: "ok" } : card.phase === "gone" ? {} : { mood: "alert", tone: "accent" };
  if (card.kind === "followup_answer") return !card.a || card.a.status === "answered" ? { mood: "happy", tone: "ok" } : {};
  if (card.kind === "drop") {
    if (card.phase === "over") return { mood: "gulp", tone: card.hot ? "ok" : "blue" };
    if (card.phase === "uploading") return { mood: "think", tone: "violet" };
    return { mood: "happy", tone: "ok" };
  }
  if (card.kind === "home" && data?.timer) return { tone: "blue" };
  if (card.kind === "voice") {
    if (card.phase === "error") return { mood: "sad", tone: "bad" };
    if (card.phase === "listening") return { mood: "listen", tone: "accent" };
    if (card.phase === "thinking" || card.phase === "transcribing" || card.phase === "downloading") return { mood: "think", tone: "violet" };
    if (card.phase === "ready") return { mood: "happy", tone: "ok" };
    if (card.phase === "reply") {
      if ((card.proposals ?? []).some((p) => p.kind === "confirm")) return { mood: "alert", tone: "warn" };
      // An answer pleases her: happy eyes and a small hop as it arrives (green glow when she did something).
      if (card.actions?.length) return { mood: "happy pleased", tone: "ok" };
      return { mood: "happy pleased" };
    }
  }
  return {};
}

/** The bar that shows when an open card will fold away; it pauses while the pointer is on the island. */
function restartCountdown(ms) {
  countdown.classList.remove("run");
  countdown.style.animationPlayState = "";
  if (!ms) return;
  countdown.style.animationDuration = `${ms}ms`;
  void countdown.offsetWidth;
  countdown.classList.add("run");
}

/**
 * The card folds on its own after a while. Brenda's own cards (the day card, the timer, her replies, voice, a drop, an
 * error) as before: CLOSE_AFTER_MS or their `closeAfter`, never while sticky, held while the pointer is on them. A
 * notification card (owner decision, 9 October 2026: "A plus the grafts") only when it arrived on its own (`armHold`).
 */
function scheduleClose() {
  clearTimeout(closeTimer);
  if (!card) return;
  if (isNotice(card)) return armHold();
  if (card.sticky) return;
  const ms = card.closeAfter ?? CLOSE_AFTER_MS;
  closeTimer = setTimeout(() => { if (!hovering) closeCard(); else scheduleClose(); }, ms);
  restartCountdown(ms);
}

/**
 * Opening a card. One that is not the pager's folds the pager away keeping its place (a voice card, the opener, a
 * hover-open); opening a tucked ask again ends its "waiting on you" (owner decision, 9 October 2026).
 */
function openCard(c) {
  if (!c.pager) leavePager();
  if (waitingAsk && c.n?.id && c.n.id === waitingAsk.nid) waitingAsk = null;
  c.openedAt ??= Date.now();
  clearTimeout(leaveTimer);
  cancelHold();
  card = c; restartCountdown(0); render(); scheduleClose();
}
// Closing a card (Done, Esc, leaving it, opening a link or the chat in Boredroom) stops her (owner decision, 7 October 2026).
// It never opens the next notification any more (owner decision, 9 October 2026: "never auto-chain"; the old
// setTimeout(nextNotification, 600) is gone): what is unread stays in the bar. The pager keeps its place.
function closeCard() { hush(); leavePager(); clearTimeout(leaveTimer); cancelHold(); card = null; error = null; restartCountdown(0); render(); }

// Brenda opens the moment the pointer reaches her and folds away as soon as it leaves (owner decision, 5 October 2026;
// a click in the menu bar strip does not reach her anyway). A card that is waiting on the person stays open: something
// to confirm, a question being typed, the mic listening, a file being attached. The short grace on leaving only
// stops her flickering when the pointer grazes her edge while she is still growing.
// Notifications (owner decision, 9 October 2026: "A plus the grafts"): that rule stays for what the pointer opened. A card
// that arrived on its own pauses its clock while the pointer is on it and stays what is left of it, at least 3 s, after
// the pointer leaves; the pager and a card opened by a press stay 3 s (Notify.leaveFold). Before the first poll has
// answered there is no day to show, so the bar only peeks (the empty island, same day).
const LEAVE_GRACE_MS = 120;
let leaveTimer = null;
function setHover(on) {
  if (on === hovering) return;
  hovering = on;
  island.classList.toggle("hover", on);
  clearTimeout(leaveTimer);
  pagerLeft = !on && !!card?.pager;
  if (on && !card && config?.signedIn && data) { tucked = false; openCard({ kind: "home", origin: "hover" }); }
  else if (on && card) {
    card.touched = true; // Enter may press its main action from now on (review, 9 October 2026)
    pauseHold();
    // A commitment or block card that opened on its own counts as seen once the pointer rests on it (phase 7b).
    if (card.kind === "loop") loopSeen(card);
    // So does a standup draft or a rollup (phase 7c).
    else if (card.kind === "standup" || card.kind === "standup_rollup") standupSeen(card);
  }
  else if (!on && card) leaveIsland();
  else if (!card) fit();
  updateTuck();
}

/** Where a card came from: "hover", "auto", "user" or "pager" (Brenda's own cards count as opened by the pointer). */
const originOf = (c) => (c?.origin ? c.origin : isNotice(c) ? "user" : "hover");
/** Keyboard focus is in the open card (the notch window has it, and it is on something in #notch). */
// #notch itself counts only while the pager holds the keys (review, 9 October 2026: once the pager folded, a focused
// #notch kept every later card paused).
const focusInside = () => { const a = document.activeElement; return document.hasFocus() && !!a && el.contains(a) && (a !== el || (!!pager && !!card?.pager)); };

/** The pointer (or the keyboard's focus) has left the island: what the card's origin says (Notify.leaveFold). */
function leaveIsland() {
  const c = card;
  if (!c || hovering) return;
  const origin = originOf(c);
  if (origin === "auto" && focusInside()) return; // the keyboard holds its clock as the pointer does
  const d = Notify.leaveFold({ origin, sticky: stickyNow(), left: hold.active ? hold.left : 0, grace: LEAVE_GRACE_MS });
  if (d.mode === "stay") return;
  if (origin === "auto") return hold.active ? resumeHold(d.ms) : startHold(d.ms);
  clearTimeout(leaveTimer);
  const go = () => { if (card !== c || hovering || stickyNow()) return; if (c.pager) foldPager(); else closeCard(); };
  if (d.mode === "now") return go();
  leaveTimer = setTimeout(go, d.ms);
}

/**
 * Nothing needs the person (no card, no timer, no ask tucked in the bar, nothing new waiting to open): tuck the notch away
 * after a moment. What has already been shown may stay unread (as before 9 October 2026; review, same day: needing the
 * inbox empty kept the notch out for anyone with an old unread notification).
 */
function idle() {
  return !!config?.signedIn && !card && !alwaysVisible && !data?.timer && !waitingAsk && !inbox().some((n) => nq.held.has(n.id) || !nq.known.has(n.id));
}
function updateTuck() {
  clearTimeout(tuckTimer);
  if (!idle() || hovering) { if (tucked) { tucked = false; fit(); } return; }
  if (!tucked) tuckTimer = setTimeout(() => { if (idle() && !hovering) { tucked = true; fit(); } }, 1500);
}
island.addEventListener("pointerenter", () => setHover(true));
island.addEventListener("pointerleave", () => setHover(false));
island.addEventListener("pointerdown", () => { Sound.unlock(); if (card) card.touched = true; });

// ---- rendering ---------------------------------------------------------------------------------------------------

/**
 * Draws what is showing. Atomic (owner decision, 9 October 2026: the empty black island): the markup is built first, and
 * only then does the page change; a card whose view throws or has nothing to draw is reported and dropped, and the bar
 * is drawn instead, so the island is never left open around the bar's row or around nothing.
 */
function render() {
  const signed = !!config?.signedIn;
  let html = "";
  if (!signed) html = linkView();
  else if (card) {
    try {
      html = `${cardView()}${error ? `<p class="err">${esc(error)}</p>` : ""}`;
      if (!/<[a-z]/i.test(html)) throw new Error("nothing to draw");
    } catch (err) {
      dropCard(`render: ${card?.kind ?? "card"}${card?.phase ? ` (${card.phase})` : ""}: ${err?.message ?? err}`);
      html = "";
    }
  }
  if (signed && !card) {
    try { html = compactView(); }
    catch (err) { report(`render: the bar: ${err?.message ?? err}`); barWide = false; html = `<div class="row" data-act="home" aria-label="Open ${esc(me().name)}">${face({ small: true })}<span class="tiny grow">${esc(me().name)}</span></div>`; }
  }
  el.classList.toggle("compact", signed && !card);
  const key = !signed ? `link:${!!link}:${editingServer}` : card ? `${card.kind}:${card.phase ?? ""}:${card.n?.id ?? card.w?.id ?? card.u?.id ?? ""}` : "compact";
  // A follow-up's note keeps its words (they live on the card), its focus and its caret when the card is drawn again.
  const noting = document.activeElement?.id === "fnote" ? { from: document.activeElement.selectionStart, to: document.activeElement.selectionEnd } : null;
  // The pager keeps the keyboard on the island across its steps (← → Enter Esc; owner decision, 9 October 2026).
  const keepKeys = !!card?.pager && document.activeElement === el;
  el.innerHTML = html;
  if (noting) { const n = document.getElementById("fnote"); if (n && !n.disabled) { n.focus(); try { n.setSelectionRange(noting.from, noting.to); } catch { /* not a text field any more */ } } }
  if (keepKeys) el.focus({ preventScroll: true });
  el.setAttribute("aria-label", me().name); // the notch is named after the person's assistant (Brenda while signed out)
  const m = moodOf();
  island.dataset.tone = m.tone ?? "";
  paintWash();
  if (key !== viewKey) {
    viewKey = key;
    drawnAt = Date.now();
    el.classList.remove("enter", "steady", "step"); island.classList.remove("step"); void el.offsetWidth;
    // A pager step slides the way the person went and its wash fades again (owner decision, 9 October 2026); anything
    // else blurs in as before.
    if (stepDir && card?.pager) { el.style.setProperty("--dx", `${stepDir > 0 ? 8 : -8}px`); el.classList.add("step"); island.classList.add("step"); }
    else el.classList.add("enter");
  } else { el.classList.remove("step"); el.classList.add("enter", "steady"); } // the same view drawn again (busy, a poll, a sent reply): no second blur-in (review, 8 October 2026)
  stepDir = 0;
  if (gaze && !TYPING.has(document.activeElement?.id)) gaze = null; // the box she was reading has gone
  syncHold();
  fit();
  applyFx();
  if (talking) talkLevel(talkLast); // the faces were drawn again: the level she is at, at once
  stepFace();
  updateTuck();
  armUndoClock();
}

/**
 * The island's wash and countdown colour follow the open notification's kind (owner decision, 9 October 2026: "A plus
 * the grafts"; style.css draws them from `data-family` and, for the summary, `--mix`). Brenda's own cards and the bar
 * carry none.
 */
function paintWash() {
  const family = isNotice(card) ? familyOf(card) : null;
  if (family) island.dataset.family = family; else delete island.dataset.family;
  let mix = "";
  if (card?.kind === "summary" && cardsReady()) {
    const counts = { needs: 0, talk: 0, plain: 0, good: 0 };
    for (const x of noticesNow()) if (Object.hasOwn(counts, x.family)) counts[x.family]++;
    try { mix = String(NotifyCards.mix(counts) ?? ""); } catch (err) { report(`mix: ${err?.message ?? err}`); }
  }
  if (mix) island.style.setProperty("--mix", mix); else island.style.removeProperty("--mix");
}

/** Team leads and organisation accounts: who is working right now, each with their own small face. */
function teamView() {
  // A teammate without a name (the empty black island, 9 October 2026: `p.name.split` threw) shows without one.
  const team = (Array.isArray(data?.team) ? data.team : []).filter((p) => !!p && typeof p === "object");
  if (!team.length) return "";
  return `<div class="team">${team.slice(0, 6).map((p) => `<button class="mate" style="--c:${hue(p.id)}" data-act="open-href" data-href="/app/${esc(config.workspaceSlug)}/workroom" title="${who(p)}">${mini(p)}<span class="nm">${esc(firstName(p.name))}</span><span class="tk">${p.task ? esc(p.task) : p.state ? esc(cap(String(p.state))) : "Not working"}</span></button>`).join("")}</div>`;
}

/**
 * The compact bar. Notifications (owner decision, 9 October 2026: "A plus the grafts"): it never says "All clear" beside
 * a count. With a timer, the timer and the count; an ask that tucked away, "Ben is waiting on you" (her own face thinks);
 * one or two unread, the newest sender and their line; three or more, "8 new, 2 need you" with the faces that brought
 * them (NotifyCards.barModel and bar). Then, as before, what is due, "Not clocked in yet", quiet hours or "All clear".
 * While anything is unread a click on it opens what is waiting (`nc-inbox`) instead of the day card.
 */
function compactView() {
  const t = data?.timer;
  const b = data?.briefing;
  const list = noticesNow();
  const count = list.length;
  const dot = data?.me?.presence ?? "active";
  if (waitingAsk && !list.some((x) => x.id === waitingAsk.nid)) waitingAsk = null; // answered, read or gone
  const total = unreadTotal();
  let lead = "", text = "", trail = "", wide = false, label = "";
  if (t) text = `<span class="clock ${t.state === "running" ? "live" : ""}" id="tclock">${hms(elapsed())}</span>&ensp;${esc(t.taskTitle)}`;
  else if ((count || waitingAsk) && cardsReady()) {
    try {
      const env = noticeEnv();
      const parts = NotifyCards.bar(barModelNow(list, env), env) ?? {};
      lead = String(parts.lead ?? ""); text = String(parts.text ?? ""); trail = String(parts.trail ?? ""); wide = !!parts.wide; label = typeof parts.label === "string" ? parts.label : "";
    } catch (err) { report(`bar: ${err?.message ?? err}`); lead = trail = label = ""; text = ""; wide = false; }
  }
  // Before the first poll has answered nothing is known yet: her name, never "All clear" (review, 9 October 2026).
  if (!text && !data) text = esc(me().name);
  if (!text) {
    const due = b ? [Array.isArray(b.dueToday) && b.dueToday.length ? `${b.dueToday.length} due today` : "", Array.isArray(b.overdue) && b.overdue.length ? `${b.overdue.length} overdue` : ""].filter(Boolean).join(", ") : "";
    // Without notify-cards.js the newest one's words still beat "All clear".
    if (count) text = total === 1 ? esc(list[0].line || "1 new") : `${total} new`;
    else if (due) text = due;
    else if (data?.clock?.status === "not_in" && data.clock.workingDay) text = "Not clocked in yet";
    // During quiet hours (phase 7a) the bar says until when, when it has nothing else to say.
    else text = quietNow() ? esc(quietWords()) : "All clear";
  }
  barWide = wide;
  const counted = /class="count"/.test(trail);
  const badge = count && !counted && !/nc-stack/.test(trail) ? `<span class="count">${total}</span>` : "";
  const working = wide ? [] : (Array.isArray(data?.team) ? data.team : []).filter((p) => p && (p.state === "running" || p.state === "paused")).slice(0, 3);
  const mood = waitingAsk && !t ? { mood: "think" } : moodOf();
  const act = count || waitingAsk ? "nc-inbox" : "home";
  const said = `${label.trim() || plainOf(`${lead} ${text}`)}${badge ? `, ${total} unread` : ""}`;
  return `<div class="row" data-act="${act}" aria-label="${esc(`Open ${me().name}${said ? `: ${said}` : ""}`)}">${face({ small: true, ...mood, dot })}${lead}<span class="tiny grow">${text}</span>${working.length ? `<span class="minis">${working.map(mini).join("")}</span>` : ""}${trail}${badge}</div>`;
}
/** The words of some markup, for a label (parsed by the page, never run). */
function plainOf(html) {
  const t = document.createElement("template");
  t.innerHTML = String(html ?? "");
  return t.content.textContent.replace(/\s+/g, " ").trim();
}

function linkView() {
  if (editingServer) {
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Which Boredroom?</p><p class="sub">Leave empty for boredroom.cc. While developing, use http://localhost:3000.</p></div></div>
      <input class="field" id="server" value="${esc(config?.baseUrl ?? "")}" placeholder="https://boredroom.cc" spellcheck="false">
      <div class="actions"><button class="btn ghost" data-act="server-cancel">Cancel</button><button class="btn primary" data-act="server-save">Save</button></div>`;
  }
  if (!link) {
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Hi, I'm Brenda.</p><p class="sub">Link me to your Boredroom and I'll keep your day in view up here.</p></div></div>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
      <div class="actions"><button class="link" data-act="server">${esc(config?.baseUrl ?? "boredroom.cc")}</button><span class="grow"></span><button class="btn primary accent" data-act="link-start" ${busy ? "disabled" : ""}>Link to Boredroom</button></div>`;
  }
  return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Approve this code in Boredroom</p><p class="sub">Check it matches, pick your workspace, approve. I'll be ready in a few seconds.</p></div></div>
    <div class="code fade">${esc(link.userCode)}</div>
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <div class="actions"><button class="btn ghost" data-act="link-cancel">Cancel</button><button class="btn primary accent" data-act="link-open">Open Boredroom</button></div>`;
}

function cardView() {
  const b = data?.briefing;
  // Notifications, the summary, the pager and the end card (owner decision, 9 October 2026: "A plus the grafts") are
  // drawn by notify-cards.js; if it is missing or a template throws, the cards as they were below.
  if (isNotice(card) && cardsReady()) {
    try { return noticeView(); }
    catch (err) {
      report(`card ${card.kind}${card.n?.type ? ` (${card.n.type})` : ""}: ${err?.message ?? err}`);
      if (card.kind === "summary" || card.kind === "caught_up") throw err;
    }
  }
  if (card.kind === "notification") {
    const n = card.n;
    if (mentionCard(n.type)) return mentionView(n);
    // Badges as on the web: neutral on fill-1, green for clocked in, amber for a review, and the orange "New" badge only
    // for a task that has just arrived.
    // Phase 6's (8 October 2026), when the desktop state cannot open their own cards: neutral words.
    // Routines' (phase 7a) when the desktop state has no `routineRuns`: Routine, Routines, and amber for one that failed.
    // Commitments and blocks (phase 7b): the contract's words, green for one taken on or answered, amber for due today and
    // a re-plan to confirm, red for overdue; their titles name a task or a commitment, so they may run to two lines.
    // Standup's (phase 7c, 8–9 October 2026) when the desktop state cannot open their own cards, and always for a draft that
    // couldn't be made: neutral words, amber for that one; their titles name a team, so they may run to two lines too.
    const loop = loopPill(n.type) || standupPill(n.type);
    const pill = n.type === "brenda.reminder" ? `<span class="pill">Reminder</span>` : n.type === "brenda.clock_in" ? `<span class="pill ok"><span class="d"></span>In</span>` : n.type === "brenda.daily_report" ? `<span class="pill">Daily report</span>` : n.type === "task.assigned" ? `<span class="pill acc">New task</span>` : n.type.startsWith("review") ? `<span class="pill warn">Review</span>` : Object.hasOwn(ITEM_PILLS, n.type) ? `<span class="pill">${ITEM_PILLS[n.type]}</span>` : loop || routinePill(n.type);
    // The end-of-day report is sent by the workspace, so its card shows the workspace's assistant (owner decision,
    // 7 October 2026: personal assistants); everything else comes from the person's own.
    const from = n.type === "brenda.daily_report" ? ws() : me();
    return `<div class="row fade">${face({ ...moodOf(), who: from })}<div class="grow"><p class="title${loop ? " wrap" : ""}">${esc(n.title)}</p>${n.body ? `<p class="sub">${esc(n.body)}</p>` : `<p class="sub">${esc(when(n.created_at))}</p>`}</div>${pill}</div>
      <div class="actions">${n.href && !removedPage(n.href) ? `<button class="btn" data-act="open-href" data-href="${esc(n.href)}">Open${icon("open")}</button>` : ""}<button class="btn primary" data-act="read" data-id="${esc(n.id)}">${n.type === "brenda.reminder" ? "Done" : "OK"}</button></div>`;
  }
  // The day card starts with what is waiting, as the bar says it (owner decision, 9 October 2026: "A plus the grafts"):
  // one row that opens it. Lists the state leaves out read as empty (the empty black island, same day).
  if (card.kind === "briefing" && b) {
    const arr = (x) => (Array.isArray(x) ? x.filter((t) => !!t && typeof t === "object") : []);
    const items = [
      ...arr(b.overdue).map((t) => ({ t, k: "overdue", bad: true })),
      ...arr(b.dueToday).map((t) => ({ t, k: `due ${when(t.due)}` })),
      ...arr(b.dueTomorrow).map((t) => ({ t, k: "due tomorrow" })),
    ].slice(0, 3);
    const extra = [arr(b.waitingForYourReview).length ? `${arr(b.waitingForYourReview).length} waiting for your review` : "", arr(b.assignmentsNotPickedUp).length ? `${arr(b.assignmentsNotPickedUp).length} not picked up` : ""].filter(Boolean).join(", ");
    const first = items[0]?.t;
    const greet = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
    const firstTitle = String(first?.title ?? "");
    return `${inboxStrip()}<div class="row fade">${face({ ...moodOf(), dot: data.me?.presence })}<div class="grow"><p class="title">${greet}${config.displayName ? `, ${esc(firstName(config.displayName))}` : ""}. ${Number(b.openTasks) || 0} open task${b.openTasks === 1 ? "" : "s"}.</p><p class="sub">${extra || (first ? `First up: ${esc(first.title)}` : asksWaiting() ? esc(`${asksWaiting()} ${asksWaiting() === 1 ? "thing waits" : "things wait"} on you.`) : "Nothing is waiting on you.")}</p></div></div>
      ${quietNow() ? `<p class="cap fade">${esc(quietWords())}: no pop-ups or sounds.</p>` : ""}
      ${items.length ? `<ul class="list fade">${items.map((i) => `<li><span class="t">${esc(i.t.title)}</span><span class="k ${i.bad ? "bad" : ""}">${esc(i.k)}</span></li>`).join("")}</ul>` : ""}
      ${waitingView()}
      ${teamView()}
      ${askBox()}
      <div class="actions">${talkButton()}<button class="btn ghost" data-act="close">Later</button><button class="btn" data-act="open-href" data-href="/app/${esc(config.workspaceSlug)}/tasks">Tasks</button>${first && !data.timer && data.clock ? `<button class="btn primary accent" data-act="start" data-id="${esc(first.id)}" ${busy ? "disabled" : ""}>Start ${esc(firstTitle.length > 22 ? `${firstTitle.slice(0, 21)}…` : firstTitle)}</button>` : ""}</div>`;
  }
  // Before the first poll has answered, or when the state carries no briefing: a small day card, never an empty island
  // (owner decision, 9 October 2026).
  if (card.kind === "briefing") return dayCardView();
  if (card.kind === "home") {
    const t = data?.timer;
    if (t) {
      // Laid out like My Day's timer card: the task and its state on the left, the clock large on the right, the
      // estimate as an orange hairline underneath, and the controls with their words on them. Running, the dot and
      // digits are orange (live); paused, Resume is the card's orange standout action.
      const live = t.state === "running";
      const state = live ? "On the clock" : t.state === "paused" ? "Paused" : "Connection interrupted";
      const share = estimateShare();
      return `${inboxStrip()}<div class="row fade">${face({ ...moodOf(), dot: data.me?.presence })}<div class="grow"><p class="title">${esc(t.taskTitle)}</p><p class="sub"><span class="status"><span class="d ${esc(t.state)}"></span>${state}</span>${t.estimateMinutes ? `, estimated ${dur(t.estimateMinutes)}` : ""}</p></div><span class="big ${live ? "live" : "dim"}" id="tclock" role="timer">${hms(elapsed())}</span>${t.taskVersion ? `<button class="ring-btn" data-act="progress" title="Add 10% progress" aria-label="Add 10% progress">${ring(t.progress)}</button>` : ""}</div>
        ${share !== null ? `<div class="est fade" aria-hidden="true"><i id="testimate" style="transform:scaleX(${share.toFixed(3)})"></i></div>` : ""}
        ${askBox()}
        <div class="actions">${talkButton()}<button class="btn ghost" data-act="briefing">Today</button>${live ? `<button class="btn" data-act="pause" ${busy ? "disabled" : ""}>${icon("pause")}Pause</button>` : `<button class="btn primary accent" data-act="resume" ${busy ? "disabled" : ""}>${icon("play")}Resume</button>`}<button class="btn danger" data-act="stop" ${busy ? "disabled" : ""}>${icon("stop")}Stop</button></div>`;
    }
    card = { kind: "briefing", origin: card.origin, openedAt: card.openedAt };
    return cardView();
  }
  if (card.kind === "voice") return voiceView();
  if (card.kind === "drop") return dropView();
  if (card.kind === "followup_ask") return followUpAskView();
  if (card.kind === "followup_answer") return followUpAnswerView();
  if (card.kind === "item") return itemView();
  if (card.kind === "item_update") return itemUpdateView();
  if (card.kind === "opener") return openerView();
  if (card.kind === "routine") return routineView();
  if (card.kind === "loop") return loopView();
  if (card.kind === "standup") return standupView();
  if (card.kind === "standup_rollup") return rollupView();
  if (card.kind === "error") return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Can't reach Boredroom</p><p class="sub">${esc(card.message)}</p></div></div><div class="actions"><button class="btn" data-act="close">OK</button></div>`;
  // Never nothing (owner decision, 9 October 2026: the empty black island): a kind this page does not know draws its
  // notification as the plain card, or render() drops it.
  if (card.n && typeof card.n.type === "string" && card.kind !== "notification") { card = { kind: "notification", n: card.n, origin: card.origin, pager: card.pager, openedAt: card.openedAt }; return cardView(); }
  throw new Error(`no view for ${card.kind}`);
}

/** The day card when there is no briefing to show (before the first poll, or a state without one): her face, a greeting, the ask box and Later. */
function dayCardView() {
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = firstName(data?.me?.displayName ?? config?.displayName);
  return `${inboxStrip()}<div class="row fade">${face({ ...moodOf(), dot: data?.me?.presence })}<div class="grow"><p class="title">${greet}${first ? `, ${esc(first)}` : ""}.</p>${data ? "" : `<p class="sub">Getting your day from Boredroom…</p>`}</div></div>
    ${askBox()}
    <div class="actions">${talkButton()}<button class="btn ghost" data-act="close">Later</button></div>`;
}

// ---- notifications: one at a time, the summary and the pager -----------------------------------------------------
// Owner decision, 9 October 2026 (notch notifications, "A plus the grafts"; the header says what the person sees). The
// rules are notify.js's (`Notify`: arrival, order, holds, the pager's steps, leaving); the markup is notify-cards.js's
// (`NotifyCards`: every card from its template, the summary, the pager's footer, the end card and the bar's words). This
// part keeps the state, the timers and the calls to Boredroom, and hands the templates what only this page knows: the
// note boxes, the quick replies, the buttons while a box is open, what a press did (`result`), the footer (`nav`), how
// many wait behind a card (`more`) and the 600 ms "done" state in the pager (`done`).

/** The cards that are notifications (they hold, linger and page by Notify's rules); the rest are Brenda's own. */
const NOTICE_KINDS = new Set(["notification", "followup_answer", "followup_ask", "item", "item_update", "loop", "standup", "standup_rollup", "routine", "summary", "caught_up"]);
const isNotice = (c) => !!c && NOTICE_KINDS.has(c.kind);
/** notify-cards.js loaded (without it the cards as they were draw, and two or more open the newest instead of a summary). */
const cardsReady = () => typeof NotifyCards === "object" && !!NotifyCards && typeof NotifyCards.card === "function";

/** What every NotifyCards call is given (contract A.2), built once per draw. */
function noticeEnv() {
  return {
    esc, face, me: me(), ws: ws(), assistantOf, firstName,
    displayName: data?.me?.displayName ?? config?.displayName ?? "",
    workspaceName: data?.workspace?.name ?? config?.workspaceName ?? "",
    now: serverNow(), boredroomPath, state: data, busy, canStart: !data?.timer && !!data?.clock, unreadTotal: unreadTotal(),
  };
}

/**
 * How many are unread in all (review, 9 October 2026): the server's count past the 20 it sends, less what was read here
 * since (markRead lowers it), never fewer than the inbox.
 */
const unreadTotal = () => { const t = data?.notificationsUnread; return Math.max(inbox().length, Number.isInteger(t) && t >= 0 ? t : 0); };
/** How many of the unread wait on the person (asks), for the day card's line. */
const asksWaiting = () => (inbox().length ? noticesNow().filter((x) => x.waits).length : 0);
/** What is unread: the desktop state's notifications (newest first, at most 20) less those read from here meanwhile. */
const inbox = () => (Array.isArray(data?.notifications) ? data.notifications : []).filter((n) => !!n && typeof n.id === "string" && typeof n.type === "string" && !readHere.has(n.id));

// Without notify-cards.js, a notification's place in the pager and whether it waits on the person, from its type alone
// (the contract's table, A.4).
const LOCAL_ASK = new Set(["brenda.followup_ask", "assistant.request", "brenda.commitment", "brenda.open_ask", "brenda.blocked_on", "brenda.standup", "brenda.mention_confirm", "brenda.replan", "review.requested", "adjustment.requested", "capture.exception"]);
const LOCAL_TIME = new Set(["brenda.reminder", "task.assigned", "brenda.commitment_due", "brenda.nudge", "brenda.commitment_stalled", "task.blocked", "review.changes_requested"]);
const LOCAL_GOOD = new Set(["review.approved", "brenda.commitment_accepted", "brenda.block_answered", "brenda.clock_in"]);
const LOCAL_PEOPLE = /^(?:message\.|task\.comment$|assistant\.|brenda\.mention_|brenda\.followup_(?:answer|batch)$|review\.question$|brenda\.commitment_declined$|brenda\.block_not_me$)/;
function localNotice(n) {
  const t = n.type;
  const group = LOCAL_ASK.has(t) ? "ask" : LOCAL_TIME.has(t) ? "time" : LOCAL_GOOD.has(t) ? "good" : LOCAL_PEOPLE.test(t) ? "people" : "report";
  const family = group === "ask" || group === "time" ? "needs" : group === "people" ? "talk" : group === "good" ? "good" : "plain";
  return { id: n.id, type: t, template: "plain", family, group, waits: group === "ask", word: "update", at: Date.parse(n.created_at) || 0,
    sender: { key: "me", label: "You", who: null, mood: "" }, line: String(n.title ?? ""), facts: n.facts ?? null };
}
/** A notification as the queue, the bar and the summary see it (NotifyCards.notice), or the local reading of its type. */
function noticeOf(n, env) {
  if (cardsReady()) {
    try { const x = NotifyCards.notice(n, env ?? noticeEnv()); if (x && typeof x.id === "string" && typeof x.group === "string") return x; }
    catch (err) { report(`notice ${n?.type}: ${err?.message ?? err}`); }
  }
  return localNotice(n);
}
/** The inbox as notices, newest first. */
function noticesNow(env) { const e = env ?? noticeEnv(); return inbox().map((n) => noticeOf(n, e)); }
/** The inbox as notices in the pager's order (what waits on you first; Notify.order). */
function orderedNotices(env) {
  const list = noticesNow(env);
  const by = new Map(list.map((x) => [x.id, x]));
  return Notify.order(list.map((x) => ({ id: x.id, group: x.group, at: x.at }))).map((id) => by.get(id)).filter(Boolean);
}

/** What NotifyCards makes of an open card ({ template, family, group, waits, words }), or null. */
function infoOf(c) {
  if (!cardsReady() || !c) return null;
  try { const i = NotifyCards.cardInfo(c, noticeEnv()); return i && typeof i === "object" ? i : null; }
  catch (err) { report(`cardInfo ${c.kind}: ${err?.message ?? err}`); return null; }
}
/** Whether a card waits on the person (an ask): it holds 15 s and then tucks into the bar. */
function waitsOf(c) {
  const i = infoOf(c);
  if (i && typeof i.waits === "boolean") return i.waits;
  if (c.kind === "followup_ask") return c.phase === "ask";
  if (c.kind === "item") return c.w?.kind === "request" && c.phase === "open";
  if (c.kind === "loop" || c.kind === "standup") return c.phase === "open";
  return c.kind === "notification" && LOCAL_ASK.has(c.n?.type);
}
/** The wash's and the countdown's colour: the card's family, "mix" for the summary, "good" for All caught up. */
function familyOf(c) {
  if (c.kind === "summary") return "mix";
  if (c.kind === "caught_up") return c.left ? "needs" : "good";
  const f = infoOf(c)?.family;
  if (typeof f === "string" && /^[a-z]{1,16}$/.test(f)) return f;
  return c.n ? localNotice(c.n).family : c.kind === "followup_ask" || c.kind === "loop" || c.kind === "standup" || (c.kind === "item" && c.w?.kind === "request") ? "needs" : "talk";
}

/**
 * Something is being typed, pressed or said on the card, so it stays wherever the pointer goes (owner decision, 9 October
 * 2026: an ask is no longer sticky on its own; it is once a box opens, a quick reply is chosen, words are typed or said,
 * a press is in flight or a Confirm waits).
 */
const engaged = (c) => !!c && ((c.kind === "followup_ask" && c.phase === "ask" && (!!c.choice || !!String(c.note ?? "").trim() || !!c.dictating))
  || ((c.kind === "item" || c.kind === "loop") && c.phase === "open" && !!(c.replying || c.declining)));
const stickyNow = () => !!card && (!!card.sticky || busy || engaged(card) || !!card.dictating || (card.proposals ?? []).some((p) => p?.kind === "confirm"));

// The hold of a card that arrived on its own (Notify.holdMs): the countdown hairline runs for it in the card's colour, it
// pauses while the pointer is on the island or the keyboard is in it, and leaving gives what is left of it, at least
// 3 s (resumeHold). An ask then tucks into the bar; anything else folds. Cards opened by the pointer, by a press or in
// the pager have no countdown.
function armHold() {
  cancelHold();
  const c = card;
  if (!c || originOf(c) !== "auto" || stickyNow()) return;
  startHold(holdFor(c));
  if (hovering || focusInside()) pauseHold();
}
function holdFor(c) {
  if (c.kind === "summary") return Notify.holdMs({ summary: true });
  if (c.kind === "caught_up") return Notify.holdMs({ done: true });
  const i = infoOf(c);
  const words = Number.isFinite(i?.words) ? i.words : Notify.countWords(el.innerText ?? "");
  return Notify.holdMs({ words, waits: waitsOf(c) });
}
function startHold(ms) {
  clearTimeout(hold.timer);
  Object.assign(hold, { active: true, paused: false, endAt: Date.now() + ms, left: ms });
  island.classList.remove("paused");
  hold.timer = setTimeout(holdEnded, ms);
  restartCountdown(ms);
}
function pauseHold() {
  if (!hold.active || hold.paused) return;
  clearTimeout(hold.timer); hold.timer = null;
  hold.left = Math.max(0, hold.endAt - Date.now());
  hold.paused = true;
  island.classList.add("paused");
  countdown.style.animationPlayState = "paused";
}
/** The clock runs again for `ms`; when that is more than was left (the 3 s linger), the hairline starts again at it. */
function resumeHold(ms) {
  if (!hold.active) return startHold(ms);
  const longer = ms > hold.left + 50;
  Object.assign(hold, { paused: false, endAt: Date.now() + ms, left: ms });
  island.classList.remove("paused");
  clearTimeout(hold.timer); hold.timer = setTimeout(holdEnded, ms);
  if (longer) restartCountdown(ms); else countdown.style.animationPlayState = "";
}
function cancelHold() {
  clearTimeout(hold.timer);
  const was = hold.active;
  Object.assign(hold, { active: false, paused: false, timer: null, left: 0 });
  island.classList.remove("paused");
  if (was) restartCountdown(0);
}
/** A box opened, a press went out or a Confirm waits: the hold is off (render() asks after every draw). */
function syncHold() { if (hold.active && stickyNow()) cancelHold(); }
function holdEnded() {
  hold.timer = null;
  const c = card;
  if (!c || !hold.active) return;
  if (stickyNow()) return cancelHold();
  if (hovering || focusInside()) { Object.assign(hold, { paused: false, endAt: Date.now() }); return pauseHold(); }
  hold.active = false;
  if (c.kind !== "summary" && c.kind !== "caught_up" && waitsOf(c)) return tuckAsk(c);
  closeCard();
}

/**
 * An ask that held its 15 s folds into the bar: "Ben is waiting on you", Ben's assistant's face beside hers, until it is
 * answered, read, opened again or something newer arrives (owner decision, 9 October 2026, B's "waiting" bar).
 */
function tuckAsk(c) {
  const a = askerFor(c);
  waitingAsk = c.n?.id ? { nid: c.n.id, who: a.who, label: a.label } : null;
  closeCard();
}
/** Whose assistant waits, and the name the bar says: the person's first name, else the assistant's own. */
function askerFor(c) {
  const w = c.w;
  const named = (who, name) => ({ who, label: firstName(name) || assistantOf(who).name });
  if (c.kind === "followup_ask" && w) return named(askerOf(w), w.asker?.name);
  if (c.kind === "item" && w?.sender) return named(w.sender.assistant ?? null, w.sender.name);
  if (c.kind === "loop" && w) {
    if (c.lk === "block") return named(blockFace(w), w.from?.name);
    const who = w.from?.assistant && typeof w.from.assistant === "object" ? w.from.assistant : ws();
    return named(who, w.kind === "open_ask" ? w.from?.name : "");
  }
  if (c.n) {
    const s = noticeOf(c.n).sender;
    if (s?.key === "ws") return { who: ws(), label: ws().name };
    if (s && s.key !== "me" && s.who) return named(s.who, s.label);
  }
  return { who: me(), label: me().name };
}
/** The bar's model: the tucked ask while there is one, else NotifyCards' one or many (contract A.7). */
const barModelNow = (list, env) => (waitingAsk ? { kind: "waiting", who: waitingAsk.who, label: waitingAsk.label, count: Math.max(list.length, unreadTotal()) } : NotifyCards.barModel(list, env));

/** The row at the top of the day card that says what is waiting and opens it (contract C.6), or "". */
function inboxStrip() {
  if (!cardsReady() || !data) return "";
  const env = noticeEnv();
  const list = noticesNow(env);
  if (waitingAsk && !list.some((x) => x.id === waitingAsk.nid)) waitingAsk = null;
  if (!list.length) return "";
  try { return String(NotifyCards.strip(barModelNow(list, env), env) ?? ""); }
  catch (err) { report(`strip: ${err?.message ?? err}`); return ""; }
}
/** The day card's row again, in place (the ask box keeps its words). */
function refreshStrip() {
  if (card?.kind !== "home" && card?.kind !== "briefing") return;
  const html = inboxStrip();
  const old = el.querySelector(":scope > .nc-strip");
  if (old) { if (html) old.outerHTML = html; else old.remove(); }
  else if (html) el.insertAdjacentHTML("afterbegin", html);
}

/** How many arrived after this card opened ("+2 waiting" where its time was). */
const moreWaiting = (c) => (c?.openedAt ? inbox().filter((n) => (nq.known.get(n.id) ?? 0) > c.openedAt).length : 0);

/** The card a notification opens: its own when the desktop state knows it (phases 4 to 7c), else the notification card. */
function cardFor(n) {
  try { return followUpCard(n) ?? itemCard(n) ?? loopCard(n) ?? standupCard(n) ?? routineCard(n) ?? { kind: "notification", n }; }
  catch (err) { report(`card for ${n?.type}: ${err?.message ?? err}`); return { kind: "notification", n }; }
}
/**
 * Each arrival's sound, as before: what waits for an answer calls for attention; a standup draft or a rollup is the
 * ordinary sound (never a chase); a reply, an answer or an update the reply sound; a routine and the rest the ordinary
 * one; clocked in, success.
 */
function soundFor(c, n) {
  if (c.kind === "followup_ask" || c.kind === "loop" || (c.kind === "item" && c.w?.kind === "request")) return "attention";
  if (c.kind === "standup" || c.kind === "standup_rollup" || c.kind === "routine") return "notify";
  if (c.kind !== "notification") return "reply";
  return n.type === "brenda.clock_in" ? "success" : mentionCard(n.type)?.sound ?? "notify";
}
/** A notification's card, opened on its own (`auto`: it holds and lingers), by a press (`user`) or in the pager. */
function openNotice(n, origin) {
  const c = cardFor(n);
  c.origin = origin;
  if (origin !== "auto") markShown(n.id);
  openCard(c);
  if (origin !== "auto") { if (c.kind === "loop") loopSeen(c); else if (c.kind === "standup" || c.kind === "standup_rollup") standupSeen(c); }
  return c;
}

/**
 * Seen by the person (opened from the bar, by a press, in the pager): it never opens again on its own (review, 9 October
 * 2026: an ask paged past in quiet hours opened again when they ended).
 */
function markShown(id) {
  if (typeof id !== "string" || !id) return;
  const shown = new Set(nq.shown); shown.add(id);
  const known = new Map(nq.known); if (!known.has(id)) known.set(id, Date.now());
  const held = new Set(nq.held); held.delete(id);
  nq = { ...nq, known, shown, held };
}

/**
 * After each poll (where nextNotification() was, still after the morning opener), when quiet hours end and on the first
 * movement after time away: what arrived is decided once (Notify.arrival). Two or more open the summary, one opens its
 * card, while a card is open they only join the bar ("+2 waiting"), while the pager is open they join behind the
 * current card, and in quiet hours or while away they wait. Nothing else opens a notification on its own.
 */
function arrive() {
  if (!config?.signedIn || !data) return;
  const list = inbox();
  const now = Date.now();
  const r = Notify.arrival(nq, { list: list.map((n) => ({ id: n.id, at: Date.parse(n.created_at) })), now, cardOpen: !!card, pagerOpen: !!(pager && card?.pager), quiet: quietNow(), away: Notify.away(lastMoveAt, now) });
  nq = r.s;
  if (r.fresh.length && waitingAsk) { waitingAsk = null; if (!card) render(); } // something newer than the tucked ask
  if (r.action === "summary") return openSummary({ origin: "auto" });
  if (r.action === "single") {
    const n = list.find((x) => x.id === r.ids[0]);
    if (!n) return;
    const c = openNotice(n, "auto");
    return Sound.play(soundFor(c, n));
  }
  if (r.action === "pager-insert") return pagerArrived(r.ids, list);
  if (r.action === "bar") return barArrived();
}
/** Arrivals while a card is open: its "+N waiting", the summary's count, or the day card's row; nothing else moves. */
function barArrived() {
  if (!card) return render();
  if (card.kind === "summary" || (isNotice(card) && !card.pager && card.kind !== "caught_up")) return render();
  refreshStrip();
}

/** The summary (contract A.6): opened on its own for two or more, with one sound; Show them and the kind chips open the pager. */
function openSummary(o = {}) {
  const env = noticeEnv();
  const list = orderedNotices(env);
  if (!list.length) return;
  if (!cardsReady()) { const n = inbox().find((x) => x.id === list[0].id); if (n) { const c = openNotice(n, o.origin ?? "auto"); Sound.play(soundFor(c, n)); } return; }
  waitingAsk = null;
  openCard({ kind: "summary", origin: o.origin ?? "auto" });
  if ((o.origin ?? "auto") === "auto") Sound.play("notify");
}

/**
 * The pager over what is unread, in Notify's order, at `o.at` (an id), `o.index`, or the place it kept when it last folded
 * (contract C.5). When the notch already has the keyboard (the person is using it there) the island takes it (← → Enter
 * Esc): Enter is the card's main action and Tab reaches the buttons. Opened with the pointer it never takes the keyboard
 * from the person's app (review, 9 October 2026: focus_notch made the notch the active app, nothing could give the keys
 * back, and a stray Enter later pressed Accept or Post on a card that opened on its own).
 */
function openPager(o = {}) {
  if (!config?.signedIn || !data) return;
  const env = noticeEnv();
  const list = inbox();
  const ordered = orderedNotices(env);
  if (!ordered.length) return card ? closeCard() : render();
  if (!cardsReady()) { const n = list.find((x) => x.id === (o.at ?? ordered[0].id)) ?? list.find((x) => x.id === ordered[0].id); return void openNotice(n, "user"); }
  pagerNotes.clear();
  for (const n of list) pagerNotes.set(n.id, n);
  const ids = ordered.map((x) => x.id);
  if (!o.keep) pagerRun.clear();
  for (const id of ids) pagerRun.add(id);
  const at = Number.isInteger(o.index) ? ids[Math.max(0, Math.min(ids.length - 1, o.index))] : o.at ?? pagerPlace;
  // Opened again where it folded, the cards seen then keep their dimmed dots (review, 9 October 2026).
  pager = Notify.pagerStart(ids, at, at && at === pagerPlace ? pagerSeen : null);
  waitingAsk = null;
  if (!o.keep) pagerLeft = false;
  showPagerCard(0);
  if (o.keys !== false && document.hasFocus()) el.focus({ preventScroll: true });
}
/** The pager's current card, from the same constructors as a single (origin "pager"); seen, since the person opened it. */
function showPagerCard(dir) {
  if (!pager) return;
  const id = pager.ids[pager.index];
  const n = pagerNotes.get(id) ?? inbox().find((x) => x.id === id);
  if (!n) {
    const next = Notify.pagerRemove(pager, id);
    if (next.finished) return showCaughtUp();
    pager = next; return showPagerCard(dir);
  }
  pagerPlace = id;
  markShown(id);
  // Mark all read in the footer only while it would read something (the asks are kept).
  pager = { ...pager, readable: unreadTotal() > inbox().length || inbox().some((x) => noticeOf(x).group !== "ask") };
  const c = cardFor(n);
  Object.assign(c, { origin: "pager", pager: true });
  stepDir = dir;
  el.tabIndex = -1;
  el.style.outline = "none"; // the island holds the keys; its buttons keep their own focus rings
  openCard(c);
  if (c.kind === "loop") loopSeen(c); else if (c.kind === "standup" || c.kind === "standup_rollup") standupSeen(c);
  // A step taken after the pointer left (a press's 600 ms) keeps the 3 s fold going for the new card; a pager turned from
  // the keyboard alone, the pointer never on it, stays until Esc.
  if (pagerLeft && !hovering) leaveIsland();
}
/** The notices of the pager's cards, in its order (read ones included), for its dots. */
function pagerNoticeList(env) {
  const e = env ?? noticeEnv();
  return (pager?.ids ?? []).map((id) => pagerNotes.get(id) ?? inbox().find((x) => x.id === id)).filter(Boolean).map((n) => noticeOf(n, e));
}
/** A notice the pager stepped past is read; an ask never is, only by its own buttons. */
function readPaged(id) {
  const n = inbox().find((x) => x.id === id);
  if (n && noticeOf(n).group !== "ask") { markRead(id); seenAlong(n); }
}
/**
 * Reading an assistant's message or reply without its card's own button does what Seen and Done do (review, 9 October
 * 2026): the item is marked seen too, so the day card stops listing it as waiting and the sender's side sees it seen.
 */
function seenAlong(n) {
  if ((n?.type !== "assistant.message" && n?.type !== "assistant.reply") || typeof n.resource_id !== "string") return;
  const w = itemWaiting().find((x) => x.id === n.resource_id && (x.kind === "message" || x.kind === "reply"));
  if (!w) return;
  call("POST", org(`/assistant-items/${encodeURIComponent(w.id)}/seen`), {}).catch(() => {});
  forgetItem(w.id, false);
}
/** ← and →, ‹ and Next. Past the last: All caught up. */
function pagerGo(dir) {
  if (!pager || !card?.pager || busy) return;
  if (dir > 0) readPaged(pager.ids[pager.index]);
  const next = Notify.pagerStep(pager, dir);
  if (next.finished) return showCaughtUp();
  if (next === pager) return;
  pager = next;
  showPagerCard(dir);
}
/** Esc, leaving it, Open: the pager folds and keeps its place; nothing reopens on its own. */
function foldPager() { if (card?.pager) closeCard(); }
/** The pager is replaced or folds: its place is kept, the island gives the keys back. */
function leavePager() {
  if (!pager) return;
  const id = pager.ids[pager.index];
  if (id) pagerPlace = id;
  pagerSeen = new Set(pager.seen);
  pager = null;
  if (document.activeElement === el) el.blur(); // the keys go back with it (review, 9 October 2026)
  el.removeAttribute("tabindex");
  el.style.outline = "";
}
/** "All caught up" (contract A.6): how many were read, then it folds after 4 s and the bar says what is true. */
function showCaughtUp(count) {
  const left = new Set(inbox().map((n) => n.id));
  const read = Number.isInteger(count) ? count : [...pagerRun].filter((id) => !left.has(id)).length;
  // Asks paged past are still unread: the end card says they still need the person, not "All caught up" (review,
  // 9 October 2026).
  const asks = noticesNow().filter((x) => x.group === "ask").length;
  pagerRun.clear();
  leavePager();
  pagerPlace = null; pagerSeen = new Set();
  openCard({ kind: "caught_up", count: read, left: asks, origin: "auto" });
}
/** New arrivals join right behind the current card; only the footer is drawn again. */
function pagerArrived(ids, list) {
  if (!pager) return;
  const env = noticeEnv();
  for (const n of list) if (ids.includes(n.id)) { pagerNotes.set(n.id, n); pagerRun.add(n.id); }
  const items = ids.map((id) => pagerNotes.get(id)).filter(Boolean).map((n) => noticeOf(n, env));
  pager = Notify.pagerInsert(pager, Notify.order(items.map((x) => ({ id: x.id, group: x.group, at: x.at }))));
  redrawNav();
}
/** After a poll: what was read elsewhere leaves the pager (never the card being read). */
function prunePager() {
  if (!pager || !card?.pager || !data) return;
  const present = new Set((Array.isArray(data.notifications) ? data.notifications : []).map((n) => n?.id));
  const current = pager.ids[pager.index];
  let p = pager, changed = false;
  for (const id of pager.ids) {
    if (id === current || present.has(id) || readHere.has(id)) continue;
    const next = Notify.pagerRemove(p, id);
    if (next.finished) break;
    p = next; changed = true;
  }
  if (changed) { pager = p; redrawNav(); }
}
/** The footer drawn again in place (the card, and anything typed in it, stays). */
function redrawNav() {
  const nav = el.querySelector(".nc-nav");
  if (!nav || !pager || !cardsReady()) return;
  const hadFocus = nav.contains(document.activeElement);
  try { nav.outerHTML = String(NotifyCards.nav(pager, pagerNoticeList(), noticeEnv()) ?? ""); }
  catch (err) { report(`nav: ${err?.message ?? err}`); return render(); }
  if (hadFocus) el.focus({ preventScroll: true });
  fit();
}

/**
 * Mark all read (on the summary and in the pager's footer): every notice is read (in parallel; one that fails stays), the
 * asks are kept (Notify.markAllRead). The summary then shows what is left, the pager pages the asks from the first, and
 * with nothing left, All caught up.
 */
async function markAllReadNow() {
  if (busy || !data) return;
  const inPager = !!card?.pager;
  busy = true; error = null; render();
  // The state carries the newest 20; past them, the read ones make room for older ones, read in turn (review, 9 October
  // 2026: it read only the 20 it could see). A few rounds at most, each one poll's worth.
  const done = [];
  for (let round = 0; round < 5 && config?.signedIn && data; round++) {
    const env = noticeEnv();
    const r = Notify.markAllRead(inbox().map((n) => { const x = noticeOf(n, env); return { id: x.id, group: x.group }; }));
    if (!r.read.length) break;
    const byId = new Map(inbox().map((n) => [n.id, n]));
    const res = await Promise.allSettled(r.read.map((id) => call("PATCH", org(`/notifications/${encodeURIComponent(id)}`))));
    const ok = r.read.filter((_, i) => res[i].status === "fulfilled");
    for (const id of ok) { readHere.add(id); seenAlong(byId.get(id)); }
    if (data) {
      data.notifications = (data.notifications ?? []).filter((n) => !ok.includes(n?.id));
      if (Number.isInteger(data.notificationsUnread)) data.notificationsUnread = Math.max(0, data.notificationsUnread - ok.length);
    }
    done.push(...ok);
    if (ok.length < r.read.length || !(data && unreadTotal() > inbox().length)) break;
    try {
      const fresh = await call("GET", org("/brenda/desktop?opener=0"));
      if (fresh && Array.isArray(fresh.notifications)) { data = { ...data, notifications: fresh.notifications, notificationsUnread: fresh.notificationsUnread }; }
    } catch { break; }
  }
  busy = false;
  if (!config?.signedIn) return;
  if (done.length) Sound.play("tick");
  if (!inbox().length) return showCaughtUp(inPager ? undefined : done.length);
  if (inPager) return openPager({ index: 0, keep: true, keys: document.activeElement === el });
  render();
}

/**
 * A press on a notification card is done. In the pager its card says so for 600 ms ("Done", "Read"; contract A.3's
 * `done`) and the pager moves on; anywhere else it folds, as before.
 */
function finishNotice(word) {
  const c = card;
  if (!c) return;
  if (!(c.pager && pager)) return closeCard();
  c.doneWord = word;
  render();
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { if (card === c) pagerGo(1); }, Notify.T.ACT_MS);
}
/** One notification read from here, without waiting (a failure lets the next poll bring it back). */
function markRead(id) {
  if (typeof id !== "string" || !id) return;
  if (!readHere.has(id) && Number.isInteger(data?.notificationsUnread) && data.notificationsUnread > 0) data.notificationsUnread -= 1;
  readHere.add(id);
  if (data) data.notifications = (Array.isArray(data.notifications) ? data.notifications : []).filter((n) => n?.id !== id);
  call("PATCH", org(`/notifications/${encodeURIComponent(id)}`)).catch(() => { readHere.delete(id); });
}

/** The bar (or the day card's row) pressed: the tucked ask again, the one notification, or the pager at its place. */
function openInbox() {
  if (!config?.signedIn || !data) return;
  if (waitingAsk) {
    const n = inbox().find((x) => x.id === waitingAsk.nid);
    waitingAsk = null;
    if (n) return void openNotice(n, "user");
  }
  const ordered = orderedNotices();
  if (!ordered.length) return openCard({ kind: "home", origin: "hover" });
  if (ordered.length === 1 || !cardsReady()) { const n = inbox().find((x) => x.id === ordered[0].id); return void openNotice(n, "user"); }
  openPager({});
}
/** A kind chip on the summary: the pager at that kind's first card. */
function openKind(family) {
  const first = orderedNotices().find((x) => x.family === family);
  openPager(first ? { at: first.id } : {});
}

/** A chip with names (the report's "2 didn't clock in"): open it, one at a time, in place. */
function toggleNames(chip) {
  const root = chip.closest(".nc") ?? el;
  const open = chip.getAttribute("aria-expanded") !== "true";
  for (const b of root.querySelectorAll('[data-act="nc-names"]')) b.setAttribute("aria-expanded", "false");
  for (const box of root.querySelectorAll(".nc-names[data-for]")) box.hidden = true;
  if (open) {
    chip.setAttribute("aria-expanded", "true");
    const box = [...root.querySelectorAll(".nc-names[data-for]")].find((x) => x.dataset.for === chip.dataset.names);
    if (box) box.hidden = false;
  }
  fit();
}

/**
 * Snooze 10 min on a reminder: the same reminder again in ten minutes (POST /brenda/reminders), on the same task when the
 * facts carry it (integration, 9 October 2026: the server sends the reminder's whole text and its task id), this one read.
 */
async function snoozeReminder() {
  const c = card, n = c?.n;
  if (!n || busy) return;
  const f = n.facts && typeof n.facts === "object" && n.facts.kind === "reminder" ? n.facts : null;
  const text = [...(str(f?.text).trim() || str(n.title).replace(/^Reminder:\s*/i, "").trim())].slice(0, 500).join("");
  if (!text) return;
  busy = true; error = null; render();
  const taskId = typeof f?.taskId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(f.taskId) ? f.taskId : null;
  try { await call("POST", org("/brenda/reminders"), { body: text, remindAt: new Date(serverNow() + 10 * 60_000).toISOString(), ...(taskId ? { taskId } : {}) }); }
  catch (err) { busy = false; error = err?.message ?? String(err); Sound.play("error"); return render(); }
  busy = false;
  markRead(n.id);
  Sound.play("tick");
  if (card === c) finishNotice("Snoozed"); else render();
}
/** Mark done on a commitment that is due (the committer's own press, as Boredroom's button: POST /commitments/:id/done). */
async function commitmentDone(id) {
  const c = card;
  if (!c || busy || typeof id !== "string" || !id) return;
  busy = true; error = null; render();
  try { await call("POST", org(`/commitments/${encodeURIComponent(id)}/done`), {}, { idempotencyKey: loopKey(c, "done") }); }
  catch (err) {
    busy = false;
    if (err?.status && err.code !== "IN_PROGRESS") delete c.keys.done; // the server answered: a new press is a new key
    error = err?.message ?? String(err); Sound.play("error"); return card === c ? render() : undefined;
  }
  busy = false;
  if (c.n) markRead(c.n.id);
  Sound.play("success");
  if (card === c) finishNotice("Done"); else render();
}

/** The notification card's markup (NotifyCards.card), the summary or the end card, with what only this page knows. */
function noticeView() {
  const c = card, env = noticeEnv();
  if (c.kind === "summary") return String(NotifyCards.summary(orderedNotices(env), env) ?? "");
  if (c.kind === "caught_up") return String(NotifyCards.done(Number(c.count) || 0, env, { left: Number(c.left) || 0 }) ?? "");
  return String(NotifyCards.card(c, env, noticeOpts(c, env)) ?? "");
}
const okButton = (c) => (c.n ? `<button class="btn primary" data-act="read" data-id="${esc(c.n.id)}" data-main>OK</button>` : `<button class="btn primary" data-act="close" data-main>OK</button>`);
const closeOk = `<button class="btn primary" data-act="close" data-main>OK</button>`;
/** The options this page passes NotifyCards.card (contract A.3): slot, actions, result, nav, more, done. */
function noticeOpts(c, env) {
  const o = {};
  const off = busy ? "disabled" : "";
  if (c.kind === "followup_ask") {
    if (c.phase === "ask") { const a = askParts(c); o.slot = a.slot; o.actions = a.actions; }
    else if (c.phase === "sent") { const r = askSent(c); o.result = { title: r.title, sub: r.sub, tone: c.sent === "not_now" ? "" : "ok", actions: closeOk }; }
    else if (c.phase === "gone") o.result = { title: c.w.title, sub: c.message, tone: "", actions: okButton(c) };
  } else if (c.kind === "item") {
    const w = c.w, from = assistantOf(w.sender?.assistant), first = firstName(w.sender?.name);
    if (c.phase === "sent") o.result = { title: `Sent. ${from.name} passes it to ${first || "them"}.`, sub: `Your reply: “${c.sentNote}”`, tone: "ok", actions: closeOk };
    else if (c.phase === "gone") o.result = { title: itemTitle(w), sub: c.message, tone: "", actions: okButton(c) };
    else if (c.phase === "result") o.result = { title: itemResult(c), sub: `${from.name} lets ${first || "them"} know.`, tone: c.item?.status === "done" ? "ok" : c.item?.status === "failed" ? "bad" : "", actions: closeOk };
    else if (c.replying) { o.slot = itemNoteBox("Reply in one line"); o.actions = `<button class="btn ghost" data-act="ai-back" ${off}>Back</button><button class="btn primary accent" data-act="ai-send" data-main ${busy || !cleanNote(c.note) ? "disabled" : ""}>Send</button>`; }
    else if (c.declining) { o.slot = itemNoteBox("Say why, if you like"); o.actions = `<button class="btn ghost" data-act="ai-back" ${off}>Back</button><button class="btn primary" data-act="ai-decline" data-main ${off}>Decline</button>`; }
    else if (w.kind === "message" && w.canReply === false) o.actions = `<button class="btn primary" data-act="ai-seen" data-main ${off}>Seen</button>`;
  } else if (c.kind === "loop") {
    if (c.phase === "result") o.result = { title: c.result, sub: c.resultSub, tone: c.decided === "accept" ? "ok" : "", actions: closeOk };
    else if (c.phase === "gone") o.result = { title: c.w.title, sub: c.message, tone: "", actions: okButton(c) };
    else if (c.declining) { o.slot = itemNoteBox(LOOP_INBOX.declinePlaceholder, "data-loop"); o.actions = `<button class="btn ghost" data-act="lp-back" ${off}>Back</button><button class="btn primary" data-act="lp-decline" data-main ${off}>${LOOP_INBOX.decline}</button>`; }
  } else if (c.kind === "standup") {
    const e = c.w, to = postToOf(e);
    if (c.phase === "posted") o.result = { title: STANDUP_SAY.posted(to, c.at), tone: "ok", actions: `${c.href ? `<button class="btn" data-act="open-href" data-href="${esc(c.href)}">Open${icon("open")}</button>` : ""}${closeOk}` };
    else if (c.phase === "skipped") o.result = { title: STANDUP_SAY.skipped, sub: STANDUP_SAY.skippedSub, tone: "", actions: `${c.canUnskip ? `<button class="btn ghost" data-act="su-unskip" ${off}>${icon("undo")}Undo</button>` : ""}<button class="btn primary" data-act="close" data-main ${off}>OK</button>` };
    else if (c.phase === "result") o.result = { title: c.result, sub: c.resultSub, tone: "", actions: closeOk };
    else if (c.phase === "gone") o.result = { title: STANDUP_SAY.title(e.team.name.trim()), sub: c.message, tone: "", actions: okButton(c) };
  }
  if (c.pager && pager) o.nav = String(NotifyCards.nav(pager, pagerNoticeList(env), env) ?? "");
  else { const more = moreWaiting(c); if (more > 0) o.more = more; }
  if (c.doneWord) o.done = c.doneWord;
  return o;
}

// ---- actions -----------------------------------------------------------------------------------------------------

el.addEventListener("click", async (e) => {
  const f = e.target.closest(".face");
  // A face on a button (the day card's row of who is waiting, 9 October 2026) is the button's.
  if (f && card && !f.classList.contains("mini") && !f.closest("button, [data-act]")) return poke();
  const target = e.target.closest("[data-act]");
  if (!target) return;
  const act = target.dataset.act;
  error = null;
  try {
    if (act === "home") return openCard({ kind: "home", origin: "hover" });
    // In the pager (owner decision, 9 October 2026), OK under what a press did moves on; anywhere else it folds.
    if (act === "close") return card?.pager && pager ? pagerGo(1) : closeCard();
    // Notifications, "A plus the grafts" (owner decision, 9 October 2026): the pager's footer, the summary's buttons and
    // kind chips, the bar or the day card's row, the names behind a chip, Snooze on a reminder, Mark done on a commitment.
    if (act === "pg-next") return pagerGo(1);
    if (act === "pg-prev") return pagerGo(-1);
    if (act === "pg-all") return markAllReadNow();
    if (act === "pg-show") return openPager({});
    if (act === "pg-kind") return openKind(target.dataset.family);
    if (act === "nc-inbox") return openInbox();
    if (act === "nc-names") return toggleNames(target);
    if (act === "nc-snooze") return snoozeReminder();
    if (act === "nc-commit-done") return commitmentDone(target.dataset.id || card?.n?.facts?.id || card?.n?.resource_id);
    if (act === "briefing") return openCard({ kind: "briefing" });
    if (act === "server") { editingServer = true; return render(); }
    if (act === "server-cancel") { editingServer = false; return render(); }
    if (act === "server-save") { config = await invoke("set_base_url", { url: document.getElementById("server").value }); editingServer = false; return render(); }
    if (act === "link-start") return startLink();
    if (act === "link-cancel") { link = null; clearTimeout(linkTimer); return render(); }
    if (act === "link-open") return invoke("open_in_browser", { path: link.verifyUrl });
    // Open, as before; `data-read-id` (9 October 2026) also reads the notification. In the pager it folds keeping its place
    // (the next card's, once this one is read).
    if (act === "open-href") {
      if (!removedPage(target.dataset.href)) await invoke("open_in_browser", { path: target.dataset.href });
      const readId = target.dataset.readId;
      if (readId) markRead(readId);
      if (card?.pager && pager) { if (readId && pager.ids[pager.index] === readId && pager.index + 1 < pager.ids.length) pager = { ...pager, index: pager.index + 1 }; return foldPager(); }
      return closeCard();
    }
    // A line's own page on a routine card (phase 7a, 8 October 2026): opened, and the card stays for the next line.
    if (act === "open-keep") { const path = boredroomPath(target.dataset.href); if (path) await invoke("open_in_browser", { path }); return; }
    // An ask on the morning opener: its words go in the ask box, focused, and are never sent from here.
    if (act === "opener-ask") return fillAsk(card?.kind === "opener" ? card.o?.actions?.[Number(target.dataset.i)]?.prompt : null);
    if (act === "open-chat") return openChat();
    if (act === "listen") return aloud() ? hush() : sayAloud(card?.spokenText);
    if (act === "offer") return takeOffer(Number(target.dataset.i));
    if (act === "voice-on") { voice = await invoke("set_voice", { enabled: true }); return openCard({ kind: "voice", phase: voice.modelReady ? "ready" : "downloading", progress: 0, sticky: !voice.modelReady }); }
    if (act === "voice-setup") return openCard({ kind: "voice", phase: voice.enabled ? (voice.modelReady ? "ready" : "downloading") : "off", progress: 0 });
    if (act === "confirm") return confirmProposal(target.dataset.token);
    // Undo on a done line (acting without asking, 8 October 2026).
    if (act === "undo") return undoDone(target.dataset.token);
    if (act === "drop-send") return sendDrop();
    if (act === "drop-task") { card.taskId = target.value; return; }
    if (act === "not-now") return declineConfirms(target.dataset.token);
    // Follow-ups (phase 4, 8 October 2026): pick a quick reply, send it (or Not now), see what will be shared, open the
    // task without losing the reply, or open a waiting ask from the day card.
    if (act === "fu-choice") return chooseReply(target.dataset.choice);
    if (act === "fu-send") return sendFollowUpReply(target.dataset.choice || null);
    if (act === "fu-facts") return toggleFacts(target);
    if (act === "fu-task") { const path = boredroomPath(target.dataset.href); if (path) await invoke("open_in_browser", { path }); return; }
    if (act === "fu-open") return openWaiting(target.dataset.id);
    // Assistants talk to each other (phase 6, 8 October 2026): open a waiting item from the day card; on a message, Seen,
    // Reply (the box opens) and Send; on a request, Decline (the reason box opens, then Decline again) and Accept; Back
    // closes the box; Done on an update.
    if (act === "ai-open") return openItem(target.dataset.id);
    if (act === "ai-seen") return markItemSeen();
    if (act === "ai-reply") return openItemNote("replying");
    if (act === "ai-send") return sendItemReply();
    if (act === "ai-decline") return card?.declining ? decideItem("decline") : openItemNote("declining");
    if (act === "ai-accept") return decideItem("accept");
    if (act === "ai-back") return closeItemNote();
    if (act === "ai-ack") return ackUpdate();
    // Commitments and blocks (phase 7b, 8 October 2026): open one from the day card; on a commitment, accept it or say it
    // is not one; on an open ask, Decline (the reason box opens, then Decline again) and Back; on a block, Not me.
    if (act === "lp-open") return openLoop(target.dataset.lk, target.dataset.id);
    if (act === "lp-accept") return decideLoop("accept");
    if (act === "lp-dismiss") return decideLoop("dismiss");
    if (act === "lp-decline") return card?.declining ? decideLoop("decline") : openLoopNote();
    if (act === "lp-back") return closeLoopNote();
    if (act === "lp-notme") return decideLoop("not_me");
    // Standup (phase 7c, 8–9 October 2026): open a draft or a rollup from the day card; on a draft, Post (the person's own
    // press, always), Skip today, and Undo on a skip. Edit is a link (open-href): editing stays on the web.
    if (act === "su-open") return openStandup(target.dataset.sk, target.dataset.id);
    if (act === "su-post") return decideStandup("post");
    if (act === "su-skip") return decideStandup("skip");
    if (act === "su-unskip") return unskipStandup();
    if (act === "read") {
      const id = target.dataset.id;
      await call("PATCH", org(`/notifications/${encodeURIComponent(id)}`));
      readHere.add(id);
      if (data) data.notifications = (data.notifications ?? []).filter((n) => n.id !== id);
      return finishNotice(target.textContent.trim() === "Done" ? "Done" : "Read");
    }
    busy = true; render();
    const t = data?.timer;
    // Start timer on a new task's card (9 October 2026) also reads its notification.
    if (act === "start" && isNotice(card) && card.n) { await call("POST", org("/sessions/start"), { taskId: target.dataset.id, captureMode: "none" }); markRead(card.n.id); }
    else if (act === "start") await call("POST", org("/sessions/start"), { taskId: target.dataset.id, captureMode: "none" });
    if (act === "pause" && t) await call("POST", org(`/sessions/${t.id}/pause`), { expectedVersion: t.version });
    if (act === "resume" && t) await call("POST", org(`/sessions/${t.id}/resume`), { expectedVersion: t.version });
    if (act === "stop" && t) await call("POST", org(`/sessions/${t.id}/stop`), { expectedVersion: t.version, note: "", outcome: "continue_later" });
    if (act === "progress" && t?.taskVersion) await call("PATCH", org(`/tasks/${t.taskId}`), { expectedVersion: t.taskVersion, progressPercent: Math.min(100, (t.progress ?? 0) + 10) });
    busy = false;
    Sound.play(act === "start" || act === "stop" ? "success" : "tick");
    await refresh();
    openCard({ kind: act === "stop" ? "briefing" : "home", origin: "hover" });
  } catch (err) {
    busy = false;
    error = err?.message ?? String(err);
    Sound.play("error");
    render();
  }
});

// ---- linking -----------------------------------------------------------------------------------------------------

async function startLink() {
  busy = true; error = null; render();
  try {
    const r = await invoke("link_start");
    link = { ...r, expiresAt: Date.now() + r.expiresIn * 1000 };
    await invoke("open_in_browser", { path: r.verifyUrl });
    pollLink();
  } catch (err) { error = err?.message ?? "Can't reach Boredroom."; link = null; }
  busy = false; render();
}

async function pollLink() {
  clearTimeout(linkTimer);
  if (!link) return;
  if (Date.now() > link.expiresAt) { link = null; error = "The code expired. Start again."; return render(); }
  try {
    const r = await invoke("link_poll", { deviceCode: link.deviceCode });
    if (r.status === "approved") { config = r.config; link = null; Sound.play("success"); return start(); }
  } catch (err) {
    if (err?.status === 410 || err?.status === 404) { link = null; error = err.message; return render(); }
  }
  linkTimer = setTimeout(pollLink, (link.interval ?? 3) * 1000);
}

async function signedOut() {
  clearInterval(pollTimer); clearInterval(presenceTimer);
  config = await invoke("sign_out"); // which also stops her; its `spoken` ends her talking face
  data = null; card = null; link = null; talk = []; chat = newChat(); cached = null;
  talkWaiting = false; clearTimeout(talkWaitTimer);
  forgetNotices();
  applyQuiet(); // no one's quiet hours while signed out
  render();
}
/** Signed out: nothing of the last person's notifications stays (owner decision, 9 October 2026). */
function forgetNotices() {
  nq = Notify.initial(); readHere.clear(); leavePager(); pagerPlace = null; pagerSeen = new Set(); pagerNotes.clear(); pagerRun.clear(); waitingAsk = null; cancelHold();
}

// ---- data --------------------------------------------------------------------------------------------------------

/** Whether today's first card has been shown on this computer (then the server need not build the morning opener). */
function briefedToday() {
  const key = briefingKey();
  if (briefedOn === key) return true;
  try { return !!localStorage.getItem(key); } catch { return false; }
}
const briefingKey = () => `brenda-briefing:${config?.workspaceSlug}:${new Date().toDateString()}`;

async function refresh() {
  const first = !data;
  try {
    // The opener is the day's first card only: once it is shown, the polls ask the server not to build it (review,
    // 8 October 2026: it is a score of reads, every 20 seconds).
    data = await call("GET", org(`/brenda/desktop${briefedToday() ? "?opener=0" : ""}`));
    offsetMs = Date.parse(data.serverNow) - Date.now();
    // What was read here and the server no longer sends is forgotten (review, 9 October 2026: the set grew for as long as
    // the notch ran); one still sent stays hidden until its read lands.
    if (readHere.size) { const sent = new Set((Array.isArray(data.notifications) ? data.notifications : []).map((n) => n?.id)); for (const id of [...readHere]) if (!sent.has(id)) readHere.delete(id); }
    keepCached();
    applyQuiet();
    // The pointer reached the bar before there was a day to show (the empty island, 9 October 2026): it opens now.
    if (first && hovering && !card && config?.signedIn) { tucked = false; openCard({ kind: "home", origin: "hover" }); }
    else if (!card) render();
    else {
      followUpClosedElsewhere(); itemClosedElsewhere(); loopClosedElsewhere(); standupClosedElsewhere();
      // Notifications (9 October 2026): what was read elsewhere leaves the pager and the summary (an empty summary folds).
      if (card?.pager) prunePager();
      else if (card?.kind === "summary") { if (inbox().length) render(); else closeCard(); }
    }
  } catch (err) {
    // During quiet hours (phase 7a) not even this opens on its own.
    if (err?.status && err.status !== 401 && !card && !quietNow()) openCard({ kind: "error", message: err.message });
  }
}

// nextNotification() is gone (owner decision, 9 October 2026: notch notifications, "A plus the grafts"): it opened the
// newest unread one after every poll and, through closeCard(), 600 ms after every card closed, so they kept popping one
// after another. arrive() above decides once, on arrival; each card's own constructor and sound are kept (cardFor,
// soundFor), and so is quiet hours' rule that nothing opens on its own.

/**
 * The day's first card, once per day per computer: the morning opener when the server sends one (phase 7a, 8 October
 * 2026), else the briefing, as before. Never over another card and never during quiet hours: it waits and opens on a
 * later poll (`poll`), and then only once the pointer has moved in the last two minutes, so a new day that starts while
 * the notch runs, or quiet hours that end at 07:00, do not spend it on an empty desk.
 */
function maybeBriefing(o = {}) {
  if (!config?.signedIn || !data || card) return false;
  const opener = openerOf();
  if (!opener && !data.briefing) return false;
  if (quietNow()) return false;
  if (o.poll && Date.now() - lastMoveAt > PRESENT_MS) return false;
  const key = briefingKey();
  if (briefedOn === key) return false;
  briefedOn = key;
  try { if (localStorage.getItem(key)) return false; localStorage.setItem(key, "1"); } catch { /* storage blocked: once per run */ }
  openCard(opener ? { kind: "opener", o: opener, closeAfter: REPLY_CLOSE_MS } : { kind: "briefing" });
  return true;
}

/** The activity signal for automatic clock-in: Boredroom decides whether it may clock the person in. */
async function presence() {
  if (!data?.brendaEnabled || !data.clock) return;
  try { const r = await call("POST", org("/brenda/presence")); if (r.clockedIn) await refresh(); } catch { /* not allowed or offline */ }
}

async function start() {
  loadCached();
  render();
  await refresh();
  if (!data) return;
  await presence();
  await refresh();
  maybeBriefing();
  arrive();
  // Each poll may bring the day's first card too (phase 7a: after quiet hours, or on a new day), before what is unread;
  // then what arrived (owner decision, 9 October 2026: arrive() in place of nextNotification()).
  clearInterval(pollTimer); pollTimer = setInterval(async () => { await refresh(); maybeBriefing({ poll: true }); arrive(); }, POLL_MS);
  clearInterval(presenceTimer); presenceTimer = setInterval(presence, PRESENCE_MS);
}

// ---- voice -------------------------------------------------------------------------------------------------------

const mic = icon("mic");

/** Typing to Brenda: the same chat as talking, without the spoken reply. The send button lights up orange once there are words. */
function askBox(placeholder) {
  if (data && !data.brendaEnabled) return "";
  const name = me().name;
  return `<form class="ask fade" data-ask><input class="field" id="ask" name="q" maxlength="4000" placeholder="${esc(placeholder ?? `Ask ${name}…`)}" autocomplete="off" spellcheck="true" aria-label="${esc(`Message ${name}`)}"><button class="btn accent icon-send" aria-label="Send" title="Send">${icon("send")}</button></form>`;
}

el.addEventListener("submit", (e) => {
  // Return in a follow-up's note sends the reply once one is chosen; in a message's reply box it sends the reply, and in a
  // request's reason box it declines (phase 6).
  if (e.target.closest("[data-fu]")) { e.preventDefault(); return sendFollowUpReply(null); }
  if (e.target.closest("[data-item]")) { e.preventDefault(); return card?.declining ? decideItem("decline") : sendItemReply(); }
  // In an open ask's reason box (phase 7b) it declines.
  if (e.target.closest("[data-loop]")) { e.preventDefault(); return decideLoop("decline"); }
  const form = e.target.closest("[data-ask]");
  if (!form) return;
  e.preventDefault();
  const q = form.q.value.trim();
  if (q) ask(q, { spoken: false });
});
// While the person is typing, the card stays open even if the pointer leaves it. (A follow-up's ask is sticky anyway; its
// note only needs the notch to take the keyboard.)
el.addEventListener("focusin", (e) => {
  // Keyboard focus in a notification card pauses its clock and holds it open, as the pointer does (owner decision,
  // 9 October 2026); focus leaving for another app is a leave (below).
  if (isNotice(card)) { pauseHold(); clearTimeout(leaveTimer); }
  if (card && e.target !== el) card.touched = true;
  if (e.target.id === "fnote") return void invoke("focus_notch").catch(() => {});
  if (e.target.id === "ask" && card) { card.sticky = true; clearTimeout(closeTimer); invoke("focus_notch").catch(() => {}); }
});
el.addEventListener("focusout", (e) => { if (e.target.id === "ask" && card && !e.target.value.trim() && !(card.proposals ?? []).some((p) => p.kind === "confirm")) { card.sticky = false; scheduleClose(); } });
// Focus gone from the card (to another app, or nowhere once a press drew it again and nothing took it back): what leaving
// does (owner decision, 9 October 2026). Asked a moment later, so a card drawn again can take the focus back first.
el.addEventListener("focusout", () => { if (isNotice(card)) setTimeout(() => { if (card && !hovering && !focusInside()) leaveIsland(); }, 0); });
window.addEventListener("blur", () => { if (isNotice(card)) setTimeout(() => { if (card && !hovering && !focusInside()) leaveIsland(); }, 0); });
el.addEventListener("pointerdown", (e) => { if (TYPING.has(e.target.id)) invoke("focus_notch").catch(() => {}); });
// Typing to her cuts her off (owner decision, 7 October 2026: her voice), as on the web; so does typing a follow-up's note,
// which is kept on the card as it is typed.
el.addEventListener("input", (e) => {
  if (TYPING.has(e.target.id) && aloud()) hush();
  if (e.target.id === "fnote" && noteCard()) { card.note = e.target.value; showCount(); if (card.kind === "item") showSend(); syncHold(); }
});
// Keys while the notch has focus: Esc folds the card away; on a Confirm, Y confirms and N declines (not while typing).
// Notifications (owner decision, 9 October 2026: "A plus the grafts"): Esc folds the pager and keeps its place; ← and →
// turn it (not in a text field); Enter presses the card's main action (`data-main`) when the focus is not on a button, a
// link or a field, and not in the first 600 ms after a card is drawn, so an Enter meant for the last page never accepts
// the next one's request. Tab moves through the buttons as ever.
const isField = (t) => !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || !!t.isContentEditable);
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && card) { if (TYPING.has(e.target.id)) e.target.blur(); return card.pager && pager ? foldPager() : closeCard(); }
  const field = isField(e.target);
  if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && card?.pager && pager && !field && !busy && !e.metaKey && !e.altKey && !e.ctrlKey) {
    e.preventDefault();
    return pagerGo(e.key === "ArrowRight" ? 1 : -1);
  }
  // Only on a card the person opened or has touched (pointer, click, keyboard in it): never on one that opened on its own
  // while they were typing elsewhere (review, 9 October 2026).
  if (e.key === "Enter" && card && !field && !busy && !e.repeat && (card.touched || hovering || originOf(card) !== "auto") && !(typeof e.target?.closest === "function" && e.target.closest("button, a, select, [contenteditable]"))) {
    const main = Date.now() - drawnAt >= Notify.T.ENTER_GUARD_MS ? el.querySelector("[data-main]:not([disabled])") : null;
    if (main) { e.preventDefault(); main.click(); }
    return;
  }
  if (TYPING.has(e.target.id) || !card || busy) return;
  const confirm = (card.proposals ?? []).find((p) => p.kind === "confirm");
  if (!confirm) return;
  if (e.key === "y" || e.key === "Y") confirmProposal(confirm.token);
  if (e.key === "n" || e.key === "N") declineConfirms(confirm.token);
});

function talkButton() {
  const name = esc(me().name);
  // Voice switched off for the workspace (phase 7c): no talk control at all, as the web hides its own.
  if (voiceOff()) return "";
  if (voice.enabled && voice.modelReady) return `<span class="hint" title="Hold to talk to ${name}">${mic}<kbd>${esc(voice.shortcut)}</kbd></span>`;
  return `<button class="btn ghost icon" data-act="voice-setup" title="Talk to ${name}" aria-label="Talk to ${name}">${mic}</button>`;
}

/**
 * What Brenda said, readable aloud: no markdown marks, links as their words, list markers dropped (a numbered item
 * keeps its number) and each list line ending as a sentence, so the voice pauses between items.
 */
const plain = (s) => String(s ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1")
  .replace(/^[ \t]*[-*+•][ \t]+(.*)$/gm, (_, t) => (/[.!?:;]$/.test(t.trim()) ? t : `${t.trim()}.`))
  .replace(/^([ \t]*\d{1,3}[.)][ \t]+)(.*)$/gm, (_, n, t) => `${n}${/[.!?:;]$/.test(t.trim()) ? t : `${t.trim()}.`}`)
  .replace(/^[ \t]*(\*\*|__)((?:(?!\1).)+)\1:?[ \t]*$/gm, "$2:")
  .replace(/[*_`#>]+/g, "").replace(/\s+\n/g, "\n").trim();

// ---- her voice -----------------------------------------------------------------------------------------------------
// Owner decision, 7 October 2026 (phase 2; the header says what she does). Rust's `speaking` and `spoken` drive `talking`;
// `talkWaiting` covers the moment between asking Rust to speak and her first sound, so Stop shows at once. Nothing here
// draws the card again (that would lose words typed in the ask box): `showTalking` changes her faces and the Listen
// button where they are.

/**
 * When she reads replies aloud, as the person chose in Boredroom (the desktop state's `assistant.speak`): "voice" (the
 * default, and what an older server means) answers aloud what was said with the talk keys, "always" every answer,
 * "never" none. Listen on the reply card works whatever it says.
 */
const speakPref = () => { const s = data?.assistant?.speak; return s === "always" || s === "never" ? s : "voice"; };
/** Whether she is speaking or about to. */
const aloud = () => talking || talkWaiting;
/**
 * Whether this answer is read aloud on its own: always, or when it answers something said with the talk keys; never during
 * the person's quiet hours (phase 7a, 8 October 2026), when only Listen reads it; never while the workspace has voice
 * switched off (phase 7c, 8–9 October 2026), when nothing is read aloud at all.
 */
const speaksFor = (spoken) => !voiceOff() && !quietNow() && (speakPref() === "always" || (speakPref() === "voice" && !!spoken));
/**
 * Voice switched off for the workspace (owner decisions, 8–9 October 2026: phase 7c, the abilities catalogue): the desktop
 * state's `assistant.voice` is false (or `voice` is among `abilities.off`). An older server sends neither, and voice stays
 * as the person set it on this computer.
 */
const voiceOff = () => data?.assistant?.voice === false || offHere("voice");
/** One of the person's abilities is switched off, for the workspace or by them (the desktop state's `abilities.off`). */
const offHere = (key) => { const off = data?.abilities?.off; return Array.isArray(off) && off.includes(key); };

/** Asks Rust to read `text` aloud (it renders first, so the first sound comes a moment later). */
function sayAloud(text) {
  if (!text || voiceOff()) return;
  talkWaiting = true;
  clearTimeout(talkWaitTimer);
  // She never started (nothing to say, or the microphone opened meanwhile): the button goes back to Listen.
  talkWaitTimer = setTimeout(() => { talkWaiting = false; showTalking(); }, 12_000);
  invoke("speak", { text }).catch(() => { talkWaiting = false; showTalking(); });
  showTalking();
}

/** Stops her, and anything about to be said. Rust answers with `spoken` if she was heard. */
function hush() {
  clearTimeout(talkWaitTimer);
  if (!aloud()) return;
  talkWaiting = false;
  invoke("stop_speaking").catch(() => {});
  showTalking();
}

/**
 * The reply card's Listen / Stop (owner decision, 7 October 2026: her voice), first in its actions row: the name stays,
 * `aria-pressed` carries the state and the tooltip says what a press does. Stop's square is orange (live, accent rules).
 * Only when the answer has something to say, and never while the workspace has voice switched off (phase 7c).
 */
const listenButton = () => (card?.spokenText && !voiceOff() ? `<button class="btn ghost icon" data-act="listen" aria-label="Listen to this reply" aria-pressed="${aloud()}" title="${aloud() ? "Stop" : "Listen"}">${icon(aloud() ? "stop" : "volume")}</button>` : "");

/** Her faces and the Listen button as `talking` and `talkWaiting` now say, in place. */
function showTalking() {
  for (const f of el.querySelectorAll(".face[data-own]")) {
    f.classList.toggle("talk", talking);
    if (!talking) f.style.removeProperty("--talk");
  }
  const on = aloud();
  for (const b of el.querySelectorAll('[data-act="listen"]')) {
    b.setAttribute("aria-pressed", String(on));
    b.title = on ? "Stop" : "Listen";
    b.innerHTML = icon(on ? "stop" : "volume");
  }
  if (talking) talkLevel(talkLast);
}

/** Her talking faces follow `level` (0 to 1): eyes open and squash, glow brightens (style.css `.face.talk`, `--talk`). Under reduced motion they hold a still pose. */
function talkLevel(level) {
  talkLast = Math.max(0, Math.min(1, Number(level) || 0));
  if (reduceMotion?.matches) return;
  const lv = talkLast.toFixed(3);
  for (const f of el.querySelectorAll(".face.talk")) f.style.setProperty("--talk", lv);
}

/**
 * Syllables for when Rust has no level to send (it spoke the plain way): pulses 4 to 6 times a second, each rising in
 * 35 ms to a peak of 0.45 to 0.85 and fading (90 ms), never below 0.08, as the web's fallback
 * (src/lib/assistant-speech/envelope.ts).
 */
function startPulse() {
  stopPulse();
  if (reduceMotion?.matches) return;
  const pulses = [];
  let next = performance.now();
  talkSynthetic = setInterval(() => {
    const now = performance.now();
    while (next <= now) { pulses.push({ at: next, peak: 0.45 + 0.4 * Math.random() }); next += 1000 / (4 + 2 * Math.random()); }
    pulses.splice(0, Math.max(0, pulses.length - 4));
    let lv = 0.08;
    for (const p of pulses) { const dt = now - p.at; lv = Math.max(lv, dt < 35 ? (p.peak * dt) / 35 : p.peak * Math.exp(-(dt - 35) / 90)); }
    talkLevel(lv);
  }, 33);
}
function stopPulse() { clearInterval(talkSynthetic); talkSynthetic = null; }

// ---- her replies, as light Markdown ------------------------------------------------------------------------------
// Brenda writes light Markdown (copilot.ts): the answer first, lists with each item's key words in bold, bold labels over
// grouped lists, links to Boredroom pages. `md` draws it as the web's chat does (docs-markdown.tsx, variant "chat"):
// paragraphs (a single line break kept), bulleted and numbered lists, bold, italic, inline code and links. It is safe by
// construction: every piece of her text goes through `esc` before it is placed, and the only markup is the handful of
// tags written here. A link becomes a link button only for a path inside Boredroom (a path without the workspace is
// read as one inside it, as on the web) that is not a removed page; anything else shows its words only.

const MD_ESCAPABLE = "\\`*_{}[]()#+-.!|~>";
/** A Boredroom path the notch may open, or null. */
function mdHref(raw) {
  const url = String(raw ?? "").trim().replace(/^<|>$/g, "");
  if (!/^\/(?![/\\])[^\s\\]{0,2000}$/.test(url)) return null;
  const slug = config?.workspaceSlug ? `/app/${config.workspaceSlug}` : "";
  const path = !slug || url === slug || url.startsWith(`${slug}/`) || url.startsWith(`${slug}?`) || /^\/(?:app|api)(?:[/?#]|$)/.test(url) ? url : `${slug}${url}`;
  return removedPage(path) ? null : path;
}
/** One line of her text as escaped HTML: bold, italic, inline code and links; everything else is text. */
function mdInline(text, depth = 0, inLink = false) {
  const s = String(text ?? "");
  if (depth > 4) return esc(s);
  let out = "", buf = "", i = 0;
  const flush = () => { out += esc(buf); buf = ""; };
  // Where a mark was last found to have no closer: later openers of it are text without searching again.
  const none = {};
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && MD_ESCAPABLE.includes(s[i + 1] ?? "")) { buf += s[i + 1]; i += 2; continue; }
    if (c === "`") {
      const close = s.indexOf("`", i + 1);
      if (close > i + 1) { flush(); out += `<code>${esc(s.slice(i + 1, close))}</code>`; i = close + 1; continue; }
    }
    if (c === "[" && !inLink) {
      const m = /^\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})(?:\s+"[^"]*")?\)/.exec(s.slice(i, i + 2400));
      if (m) {
        flush();
        const href = mdHref(m[2]);
        const label = mdInline(m[1], depth + 1, true);
        out += href ? `<button type="button" class="link" data-act="open-href" data-href="${esc(href)}">${label}</button>` : label;
        i += m[0].length; continue;
      }
    }
    if (c === "*" || c === "_") {
      const d = s[i + 1] === c ? c + c : c;
      const next = s[i + d.length];
      // Opens before a non-space; "_" inside a word (snake_case) is text.
      if (next && !/\s/.test(next) && !(c === "_" && /[\p{L}\p{N}]/u.test(s[i - 1] ?? "")) && !(none[d] <= i)) {
        let close = s.indexOf(d, i + d.length);
        // Not after a space, not an escaped mark ("\*" is text), and a single mark is not half of a double one.
        while (close !== -1 && (/\s/.test(s[close - 1]) || s[close - 1] === "\\" || (d.length === 1 && s[close + 1] === c))) close = s.indexOf(d, close + 1);
        if (close === -1) none[d] = i;
        if (close > i + d.length) {
          flush();
          const inner = mdInline(s.slice(i + d.length, close), depth + 1, inLink);
          out += d.length === 2 ? `<strong>${inner}</strong>` : `<em>${inner}</em>`;
          i = close + d.length; continue;
        }
      }
      buf += d; i += d.length; continue;
    }
    buf += c; i++;
  }
  flush();
  return out;
}
/** Her reply as escaped HTML blocks: paragraphs, labels (a paragraph that is only bold), bulleted and numbered lists. */
function md(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n").slice(0, 400);
  const out = [];
  let para = [], list = null, gap = false;
  const endPara = () => {
    if (!para.length) return;
    const label = para.length === 1 && /^(\*\*|__)(?:(?!\1).)+\1:?$/.test(para[0]);
    out.push(`<p${label ? ' class="label"' : ""}>${para.map((l) => mdInline(l)).join("<br>")}</p>`);
    para = [];
  };
  const endList = () => {
    if (!list) return;
    const start = list.tag === "ol" && list.start !== 1 ? ` start="${list.start}"` : "";
    out.push(`<${list.tag}${start}>${list.items.map((it) => `<li>${it.map((l) => mdInline(l)).join("<br>")}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\t/g, "    ");
    if (!line.trim()) { endPara(); gap = true; continue; }
    const wasGap = gap; gap = false;
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line)) { endPara(); endList(); continue; } // a rule: a break only
    const item = /^ {0,12}([-*+•]|\d{1,3}[.)])[ \t]+(.+)$/.exec(line);
    if (item) {
      const tag = /\d/.test(item[1]) ? "ol" : "ul";
      endPara();
      if (!list || list.tag !== tag) { endList(); list = { tag, start: tag === "ol" ? Math.max(1, parseInt(item[1], 10)) : 1, items: [] }; }
      list.items.push([item[2].trim()]);
      continue;
    }
    // A line under an item, before any blank line, carries the item on.
    if (list && !wasGap) { list.items[list.items.length - 1].push(line.trim()); continue; }
    endList();
    const heading = /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/.exec(line);
    if (heading) { endPara(); out.push(`<p class="label">${mdInline(heading[1])}</p>`); continue; } // no headings, only labels
    para.push(line.trim().replace(/^>[ ]?/, ""));
  }
  endPara(); endList();
  return out.join("");
}

/** The voice card's time, m:ss: running while listening, stopped once the keys come up. */
const mss = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
const voiceSeconds = (c) => (c?.startedAt ? Math.max(0, Math.floor(((c.endedAt ?? Date.now()) - c.startedAt) / 1000)) : 0);

function voiceView() {
  const c = card;
  if (c.phase === "listening") {
    // ElevenLabs' recording look, as on the web's voice card: Brenda listening, the orange live dot with the time, and
    // under them the live waveform scrolling with the voice.
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Listening…</p><p class="cap">Let go of <kbd>${esc(voice.shortcut)}</kbd> when you're done.</p></div><span class="mic"><span class="rec-dot"></span><span class="clock live" id="vtime" role="timer">${mss(voiceSeconds(c))}</span></span></div>
      <div class="wave live fade" aria-hidden="true"><canvas id="wave"></canvas></div>`;
  }
  if (c.phase === "transcribing" || c.phase === "thinking") {
    // She thinks; what is happening first (shimmering), then the words heard, in italic quotes. While the words are
    // written out the waveform carries on as a slow travelling wave and the time stays where it stopped.
    const words = c.phase === "transcribing";
    // Thinking, the mode she is working in shows already (acting without asking, 8 October 2026).
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title shimmer">${words ? "Getting your words…" : `${esc(me().name)} is on it…`}</p>${c.heard ? `<p class="said">“${esc(c.heard)}”</p>` : ""}</div>${words && c.startedAt ? `<span class="mic"><span class="clock">${mss(voiceSeconds(c))}</span></span>` : ""}${words ? "" : modePill()}</div>
      ${words ? `<div class="wave fade" aria-hidden="true"><canvas id="wave"></canvas></div>` : ""}`;
  }
  if (c.phase === "reply") {
    const proposals = c.proposals ?? [];
    const confirms = proposals.filter((p) => p.kind === "confirm");
    const opens = proposals.filter((p) => p.kind === "open" && !removedPage(p.href)).slice(0, 2);
    // What the built-in helper offers as one press (a to-do, clocking in or out, a timer), as on the web; not while
    // something waits for a yes, so the card keeps its height.
    const offers = confirms.length ? [] : proposals.map((p, i) => ({ p, i })).filter(({ p }) => OFFER[p.kind]).slice(0, 3);
    // The note under her answer (past the daily limit, or Claude could not be reached), as the web shows it.
    const note = c.msg?.note ? `<p class="cap note">${esc(c.msg.note)}</p>` : "";
    // The header: what was asked and, while she acts without asking, the mode's pill beside it (the reply keeps the
    // card's full width under them).
    const pill = modePill();
    const said = `<p class="said">“${esc(c.heard)}”</p>`;
    return `<div class="row fade top">${face(moodOf())}<div class="grow">${pill ? `<div class="said-row">${said}${pill}</div>` : said}<div class="reply">${md(c.reply)}</div>${note}</div></div>
      ${c.actions?.length ? `<ul class="list fade">${shownLines(c.actions, confirms.length ? 2 : 4).map(({ a, i }) => doneLine(a, i)).join("")}</ul>` : ""}
      ${offers.length ? `<ul class="list fade">${offers.map(({ p, i }) => `<li><span class="t">${offerLabel(p)}</span>${p.done ? `<span class="k ok end">${esc(p.done)}</span>` : `<button class="btn" data-act="offer" data-i="${i}" ${busy ? "disabled" : ""}>${icon(OFFER[p.kind].icon)}${OFFER[p.kind].label}</button>`}</li>`).join("")}</ul>` : ""}
      ${confirms.map((p, i) => confirmView(p, i, confirms.findIndex(prefWord) === i)).join("")}
      ${!confirms.length ? askBox("Ask a follow-up…") : ""}
      ${!confirms.length ? `<div class="actions">${listenButton()}${opens.map((p) => `<button class="btn" data-act="open-href" data-href="${esc(p.href)}">${esc(p.label)}${icon("open")}</button>`).join("")}<button class="btn ghost" data-act="open-chat" title="Carry on with this chat on ${esc(`${me().name}'s`)} page in Boredroom">Open chat</button><button class="btn ghost" data-act="close">Done</button></div>` : ""}`;
  }
  if (c.phase === "off") {
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Talk to ${esc(me().name)}</p><p class="sub">Hold <kbd>${esc(voice.shortcut)}</kbd>, say what you need, let go. I only listen while you hold the keys, and your voice is turned into text on this computer. The first time, I download a 148 MB speech model.</p></div></div>
      <div class="actions"><button class="btn ghost" data-act="close">Not now</button><button class="btn primary accent" data-act="voice-on">Turn on voice</button></div>`;
  }
  if (c.phase === "downloading") {
    const p = Math.round((c.progress ?? 0) * 100);
    return `<div class="row fade"><span class="orb think"><i></i></span><div class="grow"><p class="title shimmer">Getting my ears ready… <span class="num">${p}%</span></p><p class="sub">Downloading the speech model once (148 MB). You can keep working.</p></div></div><div class="bar"><i style="width:${p}%"></i></div>`;
  }
  if (c.phase === "ready") {
    return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">Voice is on</p><p class="sub">Hold <kbd>${esc(voice.shortcut)}</kbd> and talk. Try “What's on today?” or “Remind me to call Josh at 3.”</p></div></div><div class="actions"><button class="btn primary" data-act="close">Got it</button></div>`;
  }
  if (c.phase === "error") return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title">${esc(c.title ?? "I didn't catch that")}</p><p class="sub">${esc(c.message)}</p></div></div><div class="actions"><button class="btn" data-act="close">OK</button></div>`;
  // The talk keys while the workspace has voice switched off (phase 7c, 8–9 October 2026): what it is and where it changes.
  if (c.phase === "disabled") return `<div class="row fade">${face(moodOf())}<div class="grow"><p class="title wrap">Voice is switched off for ${esc(me().name)}.</p><p class="sub">Change it in Boredroom Settings.</p></div></div><div class="actions"><button class="btn primary" data-act="close">OK</button></div>`;
  return "";
}

// ---- a Confirm on the reply card -------------------------------------------------------------------------------------
// One Confirm from her answer: the shield and the summary, why it still asks, who gets it (the readback) and the whole
// message when there is one, then Not now and Confirm (Y and N on the first). "How I like things done" (owner decisions,
// 8–9 October 2026: phase 7c): remembering or forgetting one of the person's preferences shows the summary (“Remember:
// “Keep replies to three lines.””) in the quoted bubble instead, "Only you" as who gets it (unless the server's readback
// says), and Remember or Forget as the card's one orange button. It is a Confirm like any other: the person's own press,
// the server's token, whatever their act mode says.

/** The button's word for a preference's Confirm ("Remember", "Forget"), or null (own keys only, never the prototype). */
const PREF_WORDS = { remember_preference: "Remember", forget_preference: "Forget" };
const prefWord = (p) => (typeof p?.tool === "string" && Object.hasOwn(PREF_WORDS, p.tool) ? PREF_WORDS[p.tool] : null);

/** One Confirm (`i`: its place on the card, `standout`: it is the card's one orange button). */
function confirmView(p, i, standout) {
  const pref = prefWord(p);
  const why = whyOf(p);
  // A preference goes to nobody but the person: "Only you", when the server's readback does not say it already.
  const rb = readbackView(pref && !readbackOf(p) ? { readback: { to: ["Only you"] } } : p, `rb${i}`);
  const head = pref
    ? `<div class="pref-q"><p class="quote" id="pq${i}">${esc(p.summary)}</p>${why ? `<p class="why">${esc(why)}</p>` : ""}</div>`
    : `<p class="sub">${icon("shield")}<span>${esc(p.summary)}${why ? `<span class="why">${esc(why)}</span>` : ""}</span></p>`;
  const described = [pref ? `pq${i}` : "", rb ? `rb${i}` : ""].filter(Boolean).join(" ");
  const detail = p.detail ? `<div class="detail" tabindex="0" aria-label="${p.tool === "create_routine" || p.tool === "update_routine" ? "The preview and what it does each time" : "The full message"}">${esc(p.detail)}</div>` : "";
  return `<div class="confirm${pref ? " pref" : ""} fade">${head}${rb}${detail}<div class="actions">${i === 0 ? listenButton() : ""}<button class="btn ghost" data-act="not-now" data-token="${esc(p.token)}">Not now${i === 0 ? " <kbd>N</kbd>" : ""}</button><button class="btn primary${pref && standout ? " accent" : ""}" data-act="confirm" data-token="${esc(p.token)}" ${described ? `aria-describedby="${described}"` : ""} ${busy ? "disabled" : ""}>${icon("check")}${pref ?? "Confirm"}${i === 0 ? " <kbd>Y</kbd>" : ""}</button></div></div>`;
}

/**
 * The text (spoken or typed) goes to Brenda's chat with the last few turns. The answer is read aloud as the person chose
 * (`speakPref`; by default a spoken question gets a spoken reply), and Listen on the card reads it on demand.
 */
async function ask(text, { spoken = true } = {}) {
  hush(); // a new question cuts her off
  if (Date.now() - talkAt > TALK_MEMORY_MS) { talk = []; chat = newChat(); }
  talk.push({ role: "user", content: text });
  talkAt = Date.now();
  if (!spoken) Sound.play("send");
  openCard({ kind: "voice", phase: "thinking", heard: text, sticky: true });
  try {
    if (data && !data.brendaEnabled) throw new Error("Brenda isn't part of your workspace's plan yet.");
    // Only the words go back to her, and whether an answer of hers read other people's words (acting without asking,
    // 8 October 2026: Boredroom then still asks before acting in this chat).
    const r = await call("POST", org("/assistant/chat"), { messages: talk.slice(-12).map(({ role, content, tainted }) => ({ role, content, ...(role === "assistant" ? { tainted: tainted !== false } : {}) })) });
    // Kept whole (what she did and offered too) for Past chats.
    const msg = { role: "assistant", content: r.reply, actions: r.actions ?? [], proposals: r.proposals ?? [], engine: r.engine, note: r.note ?? null, tainted: !!r.tainted };
    keepAct(r.act); // the mode as Boredroom read it for this answer: the pill follows it at once
    talk.push(msg);
    const needsYes = msg.proposals.some((p) => p.kind === "confirm");
    // What she says: the server's speakable version (B3 in the phase 2 contract; "" when nothing in it can be said), or
    // the plain words from an older server.
    const spokenText = typeof r.spoken === "string" ? r.spoken.trim() : plain(r.reply);
    // A line with Undo keeps the card open longer (review, 8 October 2026: it folded away with its Undo in about 16 s).
    const closeAfter = (r.actions ?? []).some(undoable) ? UNDO_CLOSE_MS : REPLY_CLOSE_MS;
    openCard({ kind: "voice", phase: "reply", heard: text, spoken, spokenText, reply: r.reply, actions: r.actions, proposals: msg.proposals.map((p, at) => ({ ...p, at })), msg, sticky: needsYes, closeAfter });
    Sound.play(needsYes ? "attention" : r.actions?.length ? "success" : "reply");
    if (speaksFor(spoken)) sayAloud(spokenText);
    if (!spoken) document.getElementById("ask")?.focus(); // typed: carry straight on with a follow-up
    if (r.actions?.length) refresh();
    saveChat();
  } catch (err) {
    talk.pop();
    // While she acts without asking, a lost answer may still have done something (review, 8 October 2026): say so, so
    // the person checks before asking again.
    const message = `${err?.message ?? "Can't reach Boredroom."}${actingAlone() && !(err?.status >= 400) ? ` ${me().name} may have done some of it already: check What ${me().name} did in Boredroom before asking again.` : ""}`;
    openCard({ kind: "voice", phase: "error", title: `${me().name} couldn't answer`, message, closeAfter: REPLY_CLOSE_MS });
    Sound.play("error");
  }
}

/**
 * Marks proposals done in a kept answer (by their place in it, `at`), with what running them did, and on the reply card
 * too while it still shows that answer.
 */
function markDone(msg, at, done, actions = []) {
  if (!msg) return;
  msg.proposals = (msg.proposals ?? []).map((p, i) => (at.includes(i) ? { ...p, done } : p));
  if (actions.length) msg.actions = [...(msg.actions ?? []), ...actions];
  if (card?.msg === msg) card = { ...card, proposals: (card.proposals ?? []).map((p) => (at.includes(p.at) ? { ...p, done } : p)) };
}

async function confirmProposal(token) {
  const msg = card?.msg;
  const at = (card?.proposals ?? []).filter((p) => p.kind === "confirm" && p.token === token).map((p) => p.at);
  busy = true; render();
  let r;
  try { r = await call("POST", org("/brenda/confirm"), { token }); }
  catch (err) {
    busy = false;
    // A Confirm that already ran (pressed twice, or answered in Boredroom meanwhile) is done, not an error.
    if (err?.code !== "ALREADY_CONFIRMED") { error = err?.message ?? String(err); Sound.play("error"); return render(); }
    r = { actions: [], error: null };
  }
  busy = false;
  const said = r.error ?? (r.actions?.map((a) => a.summary).join(". ") || "Done.");
  // Refused, the Confirm stays unanswered in the kept conversation, where it reads as expired.
  if (!r.error || r.actions?.length) markDone(msg, at, "Done", r.actions ?? []);
  saveChat();
  refresh();
  Sound.play(r.error ? "error" : "success");
  if (!card || card.msg !== msg) return render(); // the card moved on meanwhile
  // Only the Confirm that was pressed leaves the card: another one (a second message in the same answer) still waits for
  // its own yes or no, and the card stays open until it has one (review, 8 October 2026).
  const rest = (card.proposals ?? []).filter((p) => !(p.kind === "confirm" && p.token === token));
  const waiting = rest.some((p) => p.kind === "confirm");
  // What the Confirm did joins the lines already there (review, 8 October 2026: it replaced them, Undo and all), and
  // what ran before a failure is kept too.
  const added = r.actions ?? [];
  card = { ...card, proposals: rest, sticky: waiting, reply: said, actions: [...(card.actions ?? []), ...added],
    ...(added.some(undoable) || (card.actions ?? []).some(undoable) ? { closeAfter: UNDO_CLOSE_MS } : {}),
    // The server's speakable words (never a URL, an id or a `say` command from a typed title); an older server's plain().
    spokenText: typeof r.spoken === "string" ? r.spoken : plain(said) };
  render(); if (!waiting) scheduleClose();
  // What the Confirm did is read aloud under the same rule as the answer; otherwise she stops reading the question.
  if (speaksFor(card.spoken)) sayAloud(card.spokenText);
  else hush();
}

/**
 * Not now: nothing runs, and the kept conversation says it was declined. With a token, only that Confirm is declined and
 * any other one stays on the card waiting for its answer; without one, all of them.
 */
function declineConfirms(token) {
  if (!card) return;
  const declined = (p) => p.kind === "confirm" && (!token || p.token === token);
  markDone(card.msg, (card.proposals ?? []).filter(declined).map((p) => p.at), "Not done");
  const rest = (card.proposals ?? []).filter((p) => !declined(p));
  const waiting = rest.some((p) => p.kind === "confirm");
  card = { ...card, proposals: rest, sticky: waiting };
  render(); if (!waiting) scheduleClose();
  saveChat();
}

// What the built-in helper offers as one press, with the label it gets once done (the web's chat uses the same words).
const OFFER = {
  todo: { label: "Add", done: "Added", icon: "plus" },
  clock_in: { label: "Clock in", done: "Clocked in", icon: "alarm" },
  clock_out: { label: "Clock out", done: "Clocked out", icon: "alarm" },
  start_timer: { label: "Start", done: "Started", icon: "play" },
};
const offerLabel = (p) => (p.kind === "todo" ? `${esc(p.title)}${p.assigneeName ? `<span class="s"> for ${esc(p.assigneeName)}</span>` : ""}`
  : p.kind === "start_timer" ? `Start <span class="s">${esc(p.taskTitle)}</span>` : p.kind === "clock_in" ? "Clock in" : "Clock out");

async function takeOffer(i) {
  const p = card?.proposals?.[i];
  const o = p && OFFER[p.kind];
  if (!o || p.done || busy) return;
  const msg = card.msg;
  busy = true; render();
  try {
    if (p.kind === "todo") await call("POST", org("/todos"), { title: p.title, description: p.description, dueAt: p.dueAt, assigneeMembershipId: p.assigneeMembershipId, estimateMinutes: p.estimateMinutes });
    if (p.kind === "clock_in") await call("POST", org("/clock/in"));
    if (p.kind === "clock_out") await call("POST", org("/clock/out"));
    if (p.kind === "start_timer") await call("POST", org("/sessions/start"), { taskId: p.taskId, captureMode: "none" });
    busy = false;
    markDone(msg, [p.at], o.done);
    Sound.play("success");
    render(); scheduleClose();
    refresh();
    saveChat();
  } catch (err) { busy = false; error = err?.message ?? String(err); Sound.play("error"); render(); }
}

// ---- acting without asking ---------------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (the header says what the person sees). Boredroom decides whether something acts or
// asks; the notch only shows what it was told: the mode in force (`assistant.act`), each done line's `auto` and `undo`
// ({ token, until }: the server's offer, until the token expires), and a Confirm's `why`. Nothing here is drawn unchecked:
// the mode must be a ready ActState, the offer a token with a valid time, the why a string, and every word goes through
// esc(). The Undo button is the person pressing for themself, in their own chat, with their own sign-in; the server checks
// the token is theirs, still fresh and not used.

/** The person's mode as Boredroom read it (an ActState), or null: an older server, before 0045 (`ready: false`), or anything unexpected. */
function actState() {
  const a = data?.assistant?.act;
  return a && typeof a === "object" && a.ready === true && (a.mode === "ask" || a.mode === "auto") ? a : null;
}
/** Acting without asking is in force: the person chose it and nothing locks it (the workspace's switch, someone else signed in as them). */
const actingAlone = () => { const a = actState(); return !!a && a.effective === "auto" && !a.locked; };
/**
 * The chat card's mode pill while she acts without asking: amber with a word beside the mark (caution, never orange: the
 * mode is not live or the one thing to do), as the web's composer pill. Nothing in "Ask first", nothing when locked.
 */
const modePill = () => (actingAlone()
  // Review, 8 October 2026: the title says what holds here (Undo lasts while the reply shows; 10 minutes in Boredroom's
  // chat), and, with no AI connected, that acting without asking waits for it (the built-in helper always asks).
  ? `<span class="pill warn mode" title="${esc(data?.assistant?.ai === false
    ? `Acting without asking needs the AI connected. Until then ${me().name} asks first. Change it in Boredroom: Settings, Your assistant.`
    : `${me().name} does what you ask in your own chat straight away. Undo shows on the reply while it is open; in Boredroom's chat it lasts 10 minutes. Change it in Boredroom: Settings, Your assistant.`)}">${icon("zap")}Acting without asking</span>`
  : "");
/** A chat answer's `act` (the mode as the server read it for that answer) replaces the desktop state's until the next poll. */
function keepAct(act) {
  if (!act || typeof act !== "object" || typeof act.ready !== "boolean" || !data?.assistant || typeof data.assistant !== "object") return;
  data.assistant = { ...data.assistant, act };
}
/** Why a Confirm still asks while the person chose to act without asking ("Still asking: …"), or "". */
const whyOf = (p) => (typeof p?.why === "string" ? p.why.trim() : "");

/** The server's clock now (`until` is on it). */
const serverNow = () => Date.now() + offsetMs;
/** The line's Undo is on offer: a token, a time it lasts until that has not passed, not undone yet. */
const undoable = (a) => !!a && !a.undone && !!a.undo && typeof a.undo.token === "string" && a.undo.token.length > 0 && Date.parse(a.undo.until) > serverNow();
/** The done line on the card whose Undo carries `token`. */
const actionOf = (token) => (typeof token === "string" && token ? (card?.actions ?? []).find((a) => a?.undo?.token === token) ?? null : null);

/** A line done without asking keeps this much of its summary, so "(without asking)" always shows at its end (the whole is its tooltip). */
const AUTO_SUMMARY_MAX = 72;
const shorten = (s, max) => { const c = [...String(s ?? "")]; return c.length > max ? `${c.slice(0, max - 1).join("").trimEnd()}…` : c.join(""); };

/**
 * One thing she did, as a line: the green check and what it was, "(without asking)" when the person's mode ran it, then
 * Undo while the server's offer lasts (a ghost button named for what it undoes). Undone, the check becomes the undo arrow,
 * the words go grey and the line ends "Undone" (the server's words for what it did follow for screen readers; the notch
 * is a polite live region).
 */
function doneLine(a, i) {
  const auto = a.auto === true;
  const summary = String(a.summary ?? "");
  const words = auto ? shorten(summary, AUTO_SUMMARY_MAX) : summary;
  const text = `<span class="t"${words !== summary ? ` title="${esc(summary)}"` : ""}>${esc(words)}${auto ? `<span class="s"> (without asking)</span>` : ""}</span>`;
  const cls = `done${auto ? " auto" : ""}`;
  if (a.undone) {
    // The server's words show under the line (review, 8 October 2026: "They may have seen it already" was for screen
    // readers only).
    const said = typeof a.undone === "string" && a.undone !== "Undone" ? `<span class="u">${esc(a.undone)}</span>` : "";
    return `<li class="${cls} undone" data-i="${i}"><span class="k was">${icon("undo")}</span><span class="tw">${text}${said}</span><span class="k gone">Undone</span></li>`;
  }
  const undo = undoable(a)
    ? `<button class="btn ghost" data-act="undo" data-token="${esc(a.undo.token)}" aria-label="${esc(`Undo: ${summary}`)}" ${a.undoing ? 'disabled aria-busy="true"' : ""}>${icon("undo")}Undo</button>`
    : "";
  return `<li class="${cls}" data-i="${i}"><span class="k ok">${icon("check")}</span>${text}${undo}</li>`;
}
/**
 * The done lines a card shows, each with its place in `card.actions` (for paintDone): the first `max`, plus every later
 * one that still offers Undo (review, 8 October 2026: a third line's Undo was hidden while a Confirm waited).
 */
function shownLines(actions, max) {
  return actions.map((a, i) => ({ a, i })).filter(({ a, i }) => i < max || undoable(a));
}
/** The line drawn again where it is: the rest of the card, the ask box's words included, stays as it is. */
function paintDone(a) {
  const i = (card?.actions ?? []).indexOf(a);
  const li = i < 0 ? null : el.querySelector(`li.done[data-i="${i}"]`);
  if (li) li.outerHTML = doneLine(a, i);
  fit();
}
/** The card's error line, in place (render() draws the same line at the same spot). */
function showError() {
  el.querySelector(":scope > .err")?.remove();
  if (error) el.insertAdjacentHTML("beforeend", `<p class="err">${esc(error)}</p>`);
  fit();
}

/**
 * Undo on a done line: the person acting again, as themself, once (POST /brenda/undo with the line's token). Done, the
 * line reads "Undone" and the server's words are said under the same rule as a Confirm's result; already undone (pressed
 * twice, or meanwhile) reads the same, quietly. Refused because the thing has moved on (seen, answered, changed, past its
 * time, not theirs), the card shows the server's words and the button goes; Boredroom out of reach keeps it, to try
 * again. All in place, so words typed in the ask box stay; the card stays open while it is asked.
 */
async function undoDone(token) {
  const a = actionOf(token);
  if (!a || a.undoing || !undoable(a)) return;
  a.undoing = true;
  for (const b of el.querySelectorAll('[data-act="undo"]')) if (b.dataset.token === token) { b.disabled = true; b.setAttribute("aria-busy", "true"); }
  error = null; showError();
  clearTimeout(closeTimer); restartCountdown(0);
  let r = null, quietly = false;
  try { r = await call("POST", org("/brenda/undo"), { token }); }
  catch (err) {
    a.undoing = false;
    if (!config?.signedIn) return; // signed out meanwhile: the link card is showing
    if (err?.code === "ALREADY_UNDONE") quietly = true;
    else {
      // The server said no in words (too late, changed since, not theirs, not valid): it will not say yes later.
      if (err?.status >= 400 && err.status < 500) delete a.undo;
      error = err?.message ?? String(err);
      Sound.play("error");
      paintDone(a); showError();
      if (card && !card.sticky) scheduleClose();
      return;
    }
  }
  a.undoing = false;
  const said = typeof r?.summary === "string" ? r.summary.trim() : "";
  a.undone = said || "Undone";
  delete a.undo;
  paintDone(a);
  saveChat(); // the kept answer holds this same line
  refresh();
  if (!quietly) {
    Sound.play("tick");
    // What the Undo did is read aloud under the same rule as a Confirm's result; otherwise she stops reading the answer.
    if (said && card?.kind === "voice" && speaksFor(card.spoken)) sayAloud(typeof r.spoken === "string" ? r.spoken : plain(said));
    else hush();
  }
  if (card && !card.sticky) scheduleClose();
}

let undoTimer = null;
/** Each Undo goes, in place, the moment the server's offer ends (the ask box keeps its words). */
function armUndoClock() {
  clearTimeout(undoTimer);
  const next = Math.min(...(Array.isArray(card?.actions) ? card.actions : []).filter(undoable).map((a) => Date.parse(a.undo.until)));
  if (!Number.isFinite(next)) return;
  undoTimer = setTimeout(() => {
    for (const b of el.querySelectorAll('[data-act="undo"]')) if (!undoable(actionOf(b.dataset.token))) b.remove();
    fit();
    armUndoClock();
  }, Math.min(2 ** 31 - 1, Math.max(0, next - serverNow()) + 50));
}

// ---- past chats --------------------------------------------------------------------------------------------------
// What is said to Brenda up here is kept with her chats in Boredroom (owner decision, 5 October 2026), privately to the
// person, through the same conversations API the web uses (server/services/brenda-history.ts), so it shows in Past
// chats on Brenda's page and Open chat carries it on there. One conversation per run of talk: it starts with the first
// question and ends when the notch forgets the talk, after a few quiet minutes. It is saved whole after each answer,
// Confirm, Not now and offer taken, one save at a time; a failed save is let go without a word (the next one sends
// everything again). As on the web, a Confirm is kept without its token: it can only be answered where it was offered.
//
// Each save says which copy it was made from (`expectedUpdatedAt`, the updatedAt the last save returned), so a
// conversation carried on somewhere else meanwhile (Brenda's page, another window) is not saved over: the save is
// refused (409 VERSION_CONFLICT) and the copy there stands. What was said up here since the last save then starts a
// new conversation of its own, the way Open chat hands one over. A refused save that had in fact landed (only its
// answer was lost on the way) is recognised and kept.

const KEEP = { messages: 200, content: 8000, title: 200 };   // CONVERSATION_LIMITS on the server
const clip = (s, max) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
// from: where in the talk this conversation starts; savedTo: how much of the talk its last save held.
const newChat = (from = 0) => ({ id: null, updatedAt: null, saving: null, again: false, last: "", from, savedTo: from });
let chat = newChat();

// Acting without asking (8 October 2026): a done line is kept with whether it ran without asking (`auto`) and what its
// Undo did (`undone`), never the Undo's token (the offer belongs to the card it was made on, as a Confirm's token does);
// a Confirm keeps why it still asked (`why`), and an answer whether it read other people's words (`tainted`).
const keptAction = (a) => ({ kind: a.kind, summary: a.summary, ...(a.href ? { href: a.href } : {}), ...(a.followUpBatchId ? { followUpBatchId: a.followUpBatchId } : {}),
  ...(a.assistantItemId ? { assistantItemId: a.assistantItemId } : {}), ...(a.auto === true ? { auto: true } : {}), ...(a.undone ? { undone: a.undone } : {}) });

function forSaving(messages) {
  return messages.slice(-KEEP.messages).map((m) => ({
    role: m.role,
    content: clip(String(m.content ?? ""), KEEP.content),
    ...(m.actions?.length ? { actions: m.actions.map(keptAction) } : {}),
    // A Confirm keeps who it went to and what they got (phase 7a: the readback), as the web's past chats do.
    ...(m.proposals?.length ? { proposals: m.proposals.map((p) => (p.kind === "confirm" ? { kind: p.kind, summary: p.summary, tool: p.tool, ...(p.detail ? { detail: p.detail } : {}), ...(p.done ? { done: p.done } : {}), ...(whyOf(p) ? { why: whyOf(p) } : {}), ...keptReadback(p) } : p)) } : {}),
    ...(m.engine ? { engine: m.engine } : {}),
    ...(m.note ? { note: m.note } : {}),
    // False included (review, 8 October 2026): a reply with no flag counts as having read other people's words.
    ...(m.role === "assistant" ? { tainted: m.tainted !== false } : {}),
  }));
}

/** A message with what was made of it (Done, Not done, what a Confirm did, what was undone), as the web's chat compares two copies. */
const marks = (m) => JSON.stringify([m.role, m.content, (m.proposals ?? []).map((p) => p.done ?? ""), m.actions?.length ?? 0, (m.actions ?? []).map((a) => (a?.undone ? 1 : 0))]);

/** Saves the conversation as it is now: the first save creates it, later ones replace it (or create it again if it was deleted on the web). */
function saveChat(c = chat, messages = talk) {
  if (!config?.signedIn || !data?.brendaEnabled) return Promise.resolve();
  if (c.saving) { c.again = true; return c.saving; }
  // Cleared in a .finally, which always runs after this assignment: a save with nothing to send finishes without
  // awaiting anything, and clearing it from inside would leave it set for good, so no later save would ever run.
  c.saving = (async () => {
    try {
      do {
        c.again = false;
        const upTo = messages.length;
        const kept = forSaving(messages.slice(c.from, upTo));
        const json = JSON.stringify(kept);
        if (kept[kept.length - 1]?.role !== "assistant" || (c.id && json === c.last)) return; // nothing new to keep
        let saved = null;
        if (c.id) {
          try { saved = await call("PUT", org(`/brenda/conversations/${c.id}`), { messages: kept, ...(c.updatedAt ? { expectedUpdatedAt: c.updatedAt } : {}) }); }
          catch (err) {
            if (err?.code === "VERSION_CONFLICT") { if (await conflicted(c, messages, kept, upTo)) c.again = true; continue; }
            if (err?.status !== 404) throw err;
          }
        }
        if (!saved) {
          const first = kept.find((m) => m.role === "user" && m.content.trim())?.content.replace(/\s+/g, " ").trim();
          // Untitled, it is a "New chat", not "Chat with Brenda": a stored title must not go stale when the person renames
          // their assistant (owner decision, 7 October 2026: personal assistants; the web uses the same words).
          saved = await call("POST", org("/brenda/conversations"), { title: first ? clip(first, KEEP.title) : "New chat", messages: kept });
        }
        c.id = saved?.id ?? c.id;
        c.updatedAt = saved?.updatedAt ?? null;
        c.last = json;
        c.savedTo = upTo;
      } while (c.again);
    } catch { /* never interrupts Brenda */ }
  })().finally(() => { c.saving = null; });
  return c.saving;
}

/**
 * A save refused because the conversation was saved from somewhere else since. If the copy there is this very save
 * (it landed and only the answer was lost), it is kept; if it is an earlier save from here that landed the same way,
 * with nothing added anywhere since, this one is made again on top of it. Otherwise that copy stands, and what was
 * said up here since the last save goes into a new conversation. Returns whether there is something left to save.
 */
async function conflicted(c, messages, kept, upTo) {
  const theirs = await call("GET", org(`/brenda/conversations/${c.id}`)).catch(() => null);
  // Whether the copy there is this save, or the start of it (asked once its length is known to be no more than this save's).
  const ours = () => theirs.messages.every((m, i) => marks(m) === marks(kept[i]));
  if (theirs && theirs.messages?.length === kept.length && ours()) {
    c.updatedAt = theirs.updatedAt; c.last = JSON.stringify(kept); c.savedTo = upTo;
    return false;
  }
  if (theirs && theirs.updatedAt !== c.updatedAt && theirs.messages?.length < kept.length && ours()) {
    c.updatedAt = theirs.updatedAt;
    return true;
  }
  Object.assign(c, { id: null, updatedAt: null, last: "", from: c.savedTo });
  return messages.slice(c.from).some((m) => m.role === "assistant");
}

/**
 * Open chat: this conversation on Brenda's page, where it carries on (her page opens it from `?chat=`). It is handed
 * over: the next thing said up here starts a new one, because the conversation now goes on there (a save from here
 * would be refused once the web has saved it; see past chats above).
 */
async function openChat() {
  await saveChat();
  const slug = encodeURIComponent(config.workspaceSlug);
  const id = chat.id;
  talk = []; chat = newChat();
  await invoke("open_in_browser", { path: `/app/${slug}/home${id ? `?chat=${encodeURIComponent(id)}` : ""}` });
  closeCard();
}

// ---- the live waveform -------------------------------------------------------------------------------------------
// ElevenLabs' recording look in the notch (owner decision, 7 October 2026). A plain-JavaScript port of the web's
// src/components/ui/live-waveform.tsx, which adapts ElevenLabs UI's live-waveform (https://github.com/elevenlabs/ui,
// apps/www/registry/elevenlabs-ui/ui/live-waveform.tsx; MIT licence, notice below). Thin rounded white bars on a centre
// line scroll in from the right, one every 30 ms, each as tall as the voice was loud then (the level Rust sends about
// every 70 ms while the keys are held, eased: quick to rise, slow to fall), softer when quiet (0.4 + 0.6 × level), the
// edges fading out; slots not heard yet are quiet dots. While the words are written out the bars become ElevenLabs'
// travelling "processing" wave, blended over about a second from what was last heard. Reduced motion keeps the bars
// still and lets only their strength follow the voice. The loop runs only while a card with the strip (#wave) shows,
// and it also keeps the voice card's time (#vtime) up to date.
//
// MIT License
//
// Copyright (c) 2025 Eleven Labs Inc.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
// Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
// WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
// COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

const Wave = (() => {
  // 2px bars 1px apart, never shorter than 4px (silence is a row of short bars), as ElevenLabs' recording parts.
  const BAR = 2, GAP = 1, STEP = BAR + GAP, MIN = 4, RATE = 30, FADE = 20;
  const reduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  let mode = "idle";        // live | processing | idle
  let hist = [];            // what was heard, newest last
  let from = [];            // what was heard when the processing wave began, to blend from
  let target = 0, smooth = 0, lastPush = 0, since = 0, raf = 0, shownSecs = -1;
  /** A fixed, speech-like outline for the still bars of reduced motion, taller towards the middle. */
  const still = (i, n) => Math.max(0.15, (1 - Math.abs((i - n / 2) / (n / 2)) * 0.5) * (0.55 + 0.45 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))));
  const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };

  function frame(now) {
    raf = 0;
    const cv = document.getElementById("wave");
    if (!cv || mode === "idle") return;
    const reduced = !!reduce?.matches;
    if (mode === "live") {
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.15);
      if (!lastPush || now - lastPush > RATE * 4) lastPush = now - RATE; // first sample now; never catch up in a burst
      while (now - lastPush >= RATE) { hist.push(Math.max(0.05, Math.min(1, smooth))); lastPush += RATE; }
      const keep = Math.ceil((cv.clientWidth || 400) / STEP) + 3;
      if (hist.length > keep) hist.splice(0, hist.length - keep);
      const secs = voiceSeconds(card);
      if (secs !== shownSecs) { shownSecs = secs; const t = document.getElementById("vtime"); if (t) t.textContent = mss(secs); }
    }
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    const g = cv.getContext("2d");
    if (w && h && g) {
      const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
      if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, w, h);
      g.fillStyle = getComputedStyle(cv).color || "#fff";
      const bar = (x, v, alpha, dot = false) => {
        const height = dot ? BAR : Math.max(MIN, v * h * 0.8);
        const y = Math.round(((h - height) / 2) * dpr) / dpr;
        g.globalAlpha = alpha;
        g.beginPath();
        if (g.roundRect) g.roundRect(x, y, BAR, height, Math.min(BAR / 2, height / 2)); else g.rect(x, y, BAR, height);
        g.fill();
      };
      const n = Math.floor(w / STEP), x0 = (w - n * STEP + GAP) / 2;
      if (mode === "live" && reduced) {
        for (let i = 0; i < n; i++) bar(x0 + i * STEP, still(i, n) * 0.7, 0.25 + smooth * 0.75);
      } else if (mode === "live") {
        // Newest on the right; everything slides left by device pixels until the next sample lands.
        const shift = Math.min(1, (now - lastPush) / RATE) * STEP;
        const count = Math.ceil(w / STEP) + 1;
        for (let i = 0; i < count; i++) {
          const x = Math.round((w - (i + 1) * STEP - shift) * dpr) / dpr;
          if (x + BAR < 0) break;
          const v = hist[hist.length - 1 - i];
          if (v === undefined) bar(x, 0, 0.2, true); else bar(x, v, 0.4 + v * 0.6);
        }
      } else if (reduced) {
        for (let i = 0; i < n; i++) bar(x0 + i * STEP, still(i, n) * 0.5, 0.35);
      } else {
        const t = ((now - since) / 1000) * 1.8, blend = Math.min(1, (now - since) / 900);
        for (let i = 0; i < n; i++) {
          const pos = (i - n / 2) / (n / 2);
          const wave = Math.sin(t * 1.5 + i * 0.15) * 0.25 + Math.sin(t * 0.8 - i * 0.1) * 0.2 + Math.cos(t * 2 + i * 0.05) * 0.15;
          let v = (0.2 + wave) * (1 - Math.abs(pos) * 0.4);
          if (from.length && blend < 1) v = (from[Math.floor((i / n) * from.length)] ?? 0) * (1 - blend) + v * blend;
          v = Math.max(0.05, Math.min(1, v));
          bar(x0 + i * STEP, v, 0.4 + v * 0.6);
        }
      }
      // The edges fade out (ElevenLabs' destination-out gradient).
      const p = Math.min(0.3, FADE / w);
      const fade = g.createLinearGradient(0, 0, w, 0);
      fade.addColorStop(0, "rgba(255,255,255,1)"); fade.addColorStop(p, "rgba(255,255,255,0)");
      fade.addColorStop(1 - p, "rgba(255,255,255,0)"); fade.addColorStop(1, "rgba(255,255,255,1)");
      g.globalAlpha = 1;
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = fade;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = "source-over";
    }
    if (mode === "live" || (mode === "processing" && !reduced) || !w || !h) raf = requestAnimationFrame(frame);
  }

  return {
    /** The keys went down: a fresh strip. */
    start(level = 0) { mode = "live"; hist = []; from = []; target = Math.max(0, Math.min(1, level)); smooth = 0; lastPush = 0; shownSecs = -1; kick(); },
    /** A level event from Rust, 0 to 1. */
    level(level) { target = Math.max(0, Math.min(1, level)); if (mode === "live") kick(); },
    /** The keys came up: the words are being written out. */
    process() { from = hist.slice(); mode = "processing"; since = performance.now(); kick(); },
  };
})();

/** Brenda listening: her eyes widen and swell with the voice, her glow with them (style.css `.face.listen`, `--lvl`). */
function hearLevel(level) {
  const lvl = Math.max(0, Math.min(1, level)).toFixed(2);
  for (const f of el.querySelectorAll(".face.listen")) f.style.setProperty("--lvl", lvl);
}

listen("brenda://voice", ({ payload: e }) => {
  // Her voice (owner decision, 7 October 2026): `speaking` starts her talking face (with the level of what is playing,
  // or `synthetic` when there is none to send) and keeps the reply card open; `spoken` ends it, once per utterance, and
  // the card may fold away again. Handled even when signed out, so a face never keeps talking.
  if (e.phase === "speaking") {
    if (!talking) {
      talking = true; talkWaiting = false; clearTimeout(talkWaitTimer);
      if (card?.kind === "voice" && card.phase === "reply") { card.sticky = true; clearTimeout(closeTimer); restartCountdown(0); }
      showTalking();
    }
    if (e.synthetic) startPulse();
    else if (!talkSynthetic) talkLevel(e.level ?? 0);
    return;
  }
  // Asked but never heard (the microphone was open, nothing could be said, no sound came of the render; review,
  // 7 October 2026): the Listen button turns back at once, not after the 12 s wait. A hold of the talk keys does the
  // same, as it cuts off a reply still being rendered.
  if (e.phase === "unspoken" || (e.phase === "listening" && talkWaiting && !talking)) {
    if (!talking && talkWaiting) { talkWaiting = false; clearTimeout(talkWaitTimer); showTalking(); }
    if (e.phase === "unspoken") return;
  }
  if (e.phase === "spoken") {
    talking = false; stopPulse();
    showTalking();
    if (card?.kind === "voice" && card.phase === "reply") {
      card.sticky = (card.proposals ?? []).some((p) => p.kind === "confirm") || document.activeElement?.id === "ask";
      scheduleClose();
    }
    return;
  }
  if (e.phase === "downloading" || e.phase === "ready") {
    voice = { ...voice, downloading: e.phase === "downloading", modelReady: e.phase === "ready" };
    if (card?.kind === "voice" && (card.phase === "downloading" || card.phase === "ready" || card.phase === "off")) {
      card = { ...card, phase: e.phase, progress: e.progress, sticky: e.phase === "downloading" };
      render(); if (e.phase === "ready") scheduleClose();
    }
    return;
  }
  if (!config?.signedIn) return;
  // Voice switched off for the workspace (phase 7c, 8–9 October 2026): a press of the talk keys says so once and does
  // nothing else (no listening card, no words into a note, nothing asked).
  if (voiceOff() && TALK_PHASES.includes(e.phase)) return voiceRefused(e);
  voiceOffHeld = false;
  // A follow-up's ask is open (phase 4, 8 October 2026), or a message's reply box or a request's reason box (phase 6): the
  // talk keys write into it instead of asking her.
  if (noteCard() && dictate(e)) return;
  if (e.phase === "listening") {
    if (card?.kind === "voice" && card.phase === "listening") {
      card.level = e.level;
      Wave.level(e.level ?? 0);
      hearLevel(e.level ?? 0);
      return;
    }
    Sound.play("listen");
    openCard({ kind: "voice", phase: "listening", level: e.level, sticky: true, startedAt: Date.now() });
    Wave.start(e.level ?? 0);
    hearLevel(e.level ?? 0);
    return;
  }
  if (e.phase === "transcribing") {
    Sound.play("heard");
    const startedAt = card?.kind === "voice" && card.phase === "listening" ? card.startedAt : undefined;
    openCard({ kind: "voice", phase: "transcribing", sticky: true, startedAt, endedAt: Date.now() });
    return Wave.process();
  }
  if (e.phase === "heard") return ask(e.text);
  if (e.phase === "too-short") return card?.kind === "voice" ? closeCard() : undefined;
  if (e.phase === "limit") return;
  if (e.phase === "off") return openCard({ kind: "voice", phase: "off", sticky: true });
  if (e.phase === "needs-model") return openCard({ kind: "voice", phase: "downloading", progress: 0, sticky: true });
  if (e.phase === "error") { Sound.play("error"); return openCard({ kind: "voice", phase: "error", message: e.message, closeAfter: REPLY_CLOSE_MS }); }
});

/** What the talk keys send while they are held and after (Rust's `brenda://voice` phases other than her own speaking). */
const TALK_PHASES = ["listening", "transcribing", "heard", "too-short", "limit", "off", "needs-model", "error"];
/** This press of the talk keys has been told voice is off already (the level events of the same hold say nothing more). */
let voiceOffHeld = false;
/**
 * The talk keys while the workspace has voice switched off (phase 7c): the first event of a press says "Voice is switched
 * off for Max. Change it in Boredroom Settings." once, in the note's line when a note is open, on the card when one waits
 * on the person (so nothing they were answering is lost), else on a card of its own; the rest of the press is let go,
 * and its words, written out on this computer, are never used.
 */
function voiceRefused(e) {
  // A press starts with `listening` (sent again with each level while held), or with `off` / `needs-model` when voice is
  // not set up on this computer (sent once); what follows a press only ends it.
  if (!["listening", "off", "needs-model"].includes(e.phase)) { voiceOffHeld = false; return; }
  if (voiceOffHeld) return;
  if (e.phase === "listening") voiceOffHeld = true;
  const words = `Voice is switched off for ${me().name}. Change it in Boredroom Settings.`;
  if (noteCard()) { Object.assign(card, { dictating: null, dictMessage: words }); return showDictation(); }
  if (card?.kind === "voice" && card.phase === "disabled") return;
  // An ask is no longer sticky on its own (9 October 2026): one that waits on the person keeps its card too.
  if (card && (stickyNow() || (isNotice(card) && waitsOf(card)))) { error = words; return showError(); }
  openCard({ kind: "voice", phase: "disabled" });
}

listen("brenda://voice-status", ({ payload }) => {
  voice = payload;
  if (!config?.signedIn) return;
  // Voice turned on here while the workspace has it switched off (phase 7c): the card says so instead of "Voice is on".
  if (voiceOff()) return openCard({ kind: "voice", phase: "disabled" });
  openCard({ kind: "voice", phase: !voice.enabled ? "off" : voice.modelReady ? "ready" : "downloading", progress: 0, sticky: voice.enabled && !voice.modelReady });
  if (!voice.enabled) { card.phase = "off"; card.sticky = false; render(); scheduleClose(); }
});

// ---- dropping a file on Brenda ----------------------------------------------------------------------------------

const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

function dropView() {
  const c = card;
  if (c.phase === "over") {
    return `<div class="row">${face(moodOf())}<div class="grow"><p class="title">${c.count > 1 ? `Drop ${c.count} files on me` : "Drop it on me"}</p><p class="sub">I'll attach ${c.count > 1 ? "them" : "it"} to one of your tasks and send ${c.count > 1 ? "them" : "it"} for review. PDF, PNG, JPEG, WebP or TXT, up to 25 MB.</p></div></div>
      <div class="dropzone">Drop here</div>`;
  }
  if (c.phase === "choose") {
    const ok = c.files.filter((f) => !f.problem);
    const tasks = data?.myTasks ?? [];
    return `<div class="row">${face(moodOf())}<div class="grow"><p class="title">${ok.length ? `Got ${ok.length === 1 ? "it" : `${ok.length} files`}. Which task is this for?` : "I can't take these"}</p><p class="sub">${ok.length ? "It goes in with a short note, and your reviewer is told." : "Only PDF, PNG, JPEG, WebP and TXT files up to 25 MB."}</p></div></div>
      <ul class="list">${c.files.map((f) => `<li><span class="t">${esc(f.name)}</span><span class="k ${f.problem ? "bad" : ""}">${esc(f.problem ?? kb(f.size))}</span></li>`).join("")}</ul>
      ${ok.length ? `<select class="field" id="droptask" data-act="drop-task" aria-label="Task">${tasks.map((t) => `<option value="${esc(t.id)}" ${t.id === c.taskId ? "selected" : ""}>${esc(t.title)}${t.id === data?.timer?.taskId ? " (timer running)" : ""}</option>`).join("")}</select>
      <input class="field" id="dropnote" maxlength="2000" placeholder="Note for your reviewer (optional)" autocomplete="off">` : ""}
      <div class="actions"><button class="btn ghost" data-act="close">Cancel</button>${ok.length ? `<button class="btn primary" data-act="drop-send" ${busy ? "disabled" : ""}>Send for review</button>` : ""}</div>`;
  }
  if (c.phase === "uploading") {
    const p = Math.round((c.done / Math.max(1, c.total)) * 100);
    return `<div class="row">${face(moodOf())}<div class="grow"><p class="title shimmer">Attaching ${Math.min(c.done + 1, c.total)} of ${c.total}…</p><p class="sub">To “${esc(c.taskTitle ?? "your task")}”</p></div></div><div class="bar"><i style="width:${p}%"></i></div>`;
  }
  if (c.phase === "done") {
    return `<div class="row">${face(moodOf())}<div class="grow"><p class="title">Sent “${esc(c.taskTitle ?? "your task")}” for review</p><p class="sub">${c.count} file${c.count === 1 ? "" : "s"} attached.${c.failed?.length ? ` Not attached: ${esc(c.failed.join("; "))}` : ""}</p></div></div>
      <div class="actions"><button class="btn" data-act="open-href" data-href="/app/${esc(config.workspaceSlug)}/tasks/${esc(c.taskId)}">Open task</button><button class="btn primary" data-act="close">Done</button></div>`;
  }
  return "";
}

async function sendDrop() {
  const taskId = document.getElementById("droptask")?.value || card.taskId;
  const note = document.getElementById("dropnote")?.value.trim() ?? "";
  const files = card.files.filter((f) => !f.problem);
  if (!taskId || !files.length) return;
  const taskTitle = (data?.myTasks ?? []).find((t) => t.id === taskId)?.title;
  card = { ...card, phase: "uploading", done: 0, total: files.length, sticky: true, taskId, taskTitle };
  Sound.play("send");
  render();
  const ids = [], failed = [];
  for (const f of files) {
    try { const r = await invoke("upload_dropped", { index: f.index, taskId }); if (r?.id) ids.push(r.id); }
    catch (err) { failed.push(`${f.name}: ${err?.message ?? "upload failed"}`); }
    card.done++; render();
  }
  if (!ids.length) { Sound.play("error"); return openCard({ kind: "voice", phase: "error", title: "Nothing was attached", message: failed.join(" ") || "The upload failed.", closeAfter: REPLY_CLOSE_MS }); }
  try {
    await call("POST", org(`/tasks/${taskId}/submissions`), { note, links: [], fileIds: ids });
    Sound.play("success");
    openCard({ kind: "drop", phase: "done", taskId, taskTitle, count: ids.length, failed, closeAfter: 12_000 });
    refresh();
  } catch (err) {
    Sound.play("error");
    openCard({ kind: "voice", phase: "error", title: "Attached, but not sent for review", message: `${err?.message ?? "Boredroom refused it."} The files are on the task; send it from Boredroom.`, closeAfter: REPLY_CLOSE_MS });
  }
}

listen("brenda://drag", ({ payload: d }) => {
  if (!config?.signedIn) return;
  const inDrop = card?.kind === "drop";
  if (d.phase === "enter") {
    if (inDrop && card.phase !== "over") return;
    tucked = false;
    return openCard({ kind: "drop", phase: "over", count: d.count, sticky: true });
  }
  if (d.phase === "over") {
    if (!inDrop || card.phase !== "over") return;
    cursor = { x: d.x, y: d.y }; stepFace();
    const r = island.getBoundingClientRect();
    const hot = d.x >= r.left - 20 && d.x <= r.right + 20 && d.y <= r.bottom + 30;
    if (hot !== !!card.hot) { card.hot = hot; island.classList.toggle("hot", hot); island.dataset.tone = moodOf().tone ?? ""; const f = el.querySelector(".face"); if (f) f.dataset.tone = island.dataset.tone; }
    return;
  }
  island.classList.remove("hot");
  if (d.phase === "leave") { if (inDrop && card.phase === "over") closeCard(); return; }
  if (d.phase === "drop") {
    Sound.play("gulp");
    setFx("squash", 600);
    const tasks = data?.myTasks ?? [];
    if (!data?.clock) return openCard({ kind: "voice", phase: "error", title: "Evidence goes on your own tasks", message: "Staff and team leads attach files to the tasks they hold.", closeAfter: REPLY_CLOSE_MS });
    if (!tasks.length) return openCard({ kind: "voice", phase: "error", title: "No open task to attach it to", message: "Pick up or add a task first, then drop the file again.", closeAfter: REPLY_CLOSE_MS });
    const pre = tasks.some((t) => t.id === data.timer?.taskId) ? data.timer.taskId : tasks[0].id;
    return openCard({ kind: "drop", phase: "choose", files: d.files, taskId: pre, sticky: true });
  }
});

// ---- follow-ups between assistants -------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (personal assistants, phase 4; the header says what the cards do). The desktop state's
// `followUps` (src/server/services/desktop.ts, DesktopFollowUps) is { ready, waiting, answered }: `waiting` are the asks
// about this person still open (asker null: the workspace's own collection for the team report), with `facts` already
// worded for them (factLines); `answered` are their own follow-ups closed in the last day. The reply goes to
// POST /follow-ups/<id>/reply as { choice, note }, and the ask's notification is then marked read. A reply never changes
// the task: "Done" is words. Nothing a person wrote is drawn as Markdown or a link; only Boredroom paths open.

const FU_CHOICES = [["on_track", "On track"], ["blocked", "Blocked"], ["done", "Done"], ["not_started", "Not started"]];
const FU_NOTE_MAX = 280;    // FOLLOW_UP_LIMITS.noteMax on the server
const FU_COUNT_FROM = 240;  // the counter shows from here, as on the web
/** The answer card's badge, as the web's FollowUpBadge (a word with every colour). */
const FU_BADGE = { answered: { label: "Answered", tone: "ok" }, expired: { label: "No reply", tone: "" }, declined: { label: "Not now", tone: "" }, failed: { label: "Couldn't follow up", tone: "bad" } };
const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] || "";
const hhmm = (d) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayOf = (d) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const sameDay = (a, b) => a.toDateString() === b.toDateString();
/** A deadline as the server words it: "15:30" today, "12:00 tomorrow", else "Mon 12 Oct 12:00". */
function byWhen(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  const now = new Date(), tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
  return sameDay(d, now) ? hhmm(d) : sameDay(d, tomorrow) ? `${hhmm(d)} tomorrow` : `${dayOf(d)} ${hhmm(d)}`;
}
/** A moment that has passed: "15:40" today, else "Wed 7 Oct 16:02". */
function atWhen(iso) {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "";
  return sameDay(d, new Date()) ? hhmm(d) : `${dayOf(d)} ${hhmm(d)}`;
}
/** A path inside Boredroom the notch may open (never another site, never a removed page), or null. */
const boredroomPath = (href) => (typeof href === "string" && /^\/(?![/\\])[^\s\\]{0,2000}$/.test(href) && !removedPage(href) ? href : null);
/** The note as it may be sent: spaces collapsed, at most 280 characters. */
const cleanNote = (s) => [...String(s ?? "").replace(/\s+/g, " ").trim()].slice(0, FU_NOTE_MAX).join("").trim();
const followUps = () => (data?.followUps && data.followUps.ready === true ? data.followUps : null);
const isItem = (x) => !!x && typeof x === "object" && typeof x.id === "string" && typeof x.title === "string";
const waitingList = () => (followUps()?.waiting ?? []).filter(isItem);

/** The card a follow-up notification opens, or null for the plain notification card (an older server, or not known). */
function followUpCard(n) {
  if (!followUps()) return null;
  if (n.type === "brenda.followup_ask") {
    const w = waitingList().find((x) => x.id === n.resource_id);
    return w ? askCard(w, n) : null;
  }
  if (n.type === "brenda.followup_answer") {
    const a = (followUps().answered ?? []).filter(isItem).find((x) => x.id === n.resource_id);
    return a ? { kind: "followup_answer", n, a, closeAfter: REPLY_CLOSE_MS } : null;
  }
  // A group's answers arrive together, with the batch's summary as the notification's body.
  if (n.type === "brenda.followup_batch") return { kind: "followup_answer", n, a: null, closeAfter: REPLY_CLOSE_MS };
  return null;
}
// Not sticky on its own any more (owner decision, 9 October 2026: an ask holds 15 s, then tucks into the bar; it stays
// once a quick reply is chosen or a line is typed or said, `engaged`).
const askCard = (w, n) => ({ kind: "followup_ask", phase: "ask", w, n: n ?? null, choice: null, note: "", factsOpen: false, dictating: null, dictMessage: null, sticky: false });

/** Asked in a conversation (phase 6): the reply is posted there for everyone; null for an ordinary follow-up or an older server. */
const threadOf = (w) => (w.thread && typeof w.thread === "object" && typeof w.thread.where === "string" && w.thread.where.trim() ? w.thread : null);
/** The asker's assistant: theirs, or the workspace's for its own collection before the team report; in a thread the person's own. */
const askerOf = (w) => (threadOf(w) ? me() : w.asker ? assistantOf(w.asker.assistant) : ws());

/** What a sent reply says, in plain words (the card and the notification template both escape them). */
function askSent(c) {
  const w = c.w, ra = askerOf(w).name, thread = threadOf(w);
  const everyone = thread && !thread.direct ? " for everyone there" : "";
  const notNow = c.sent === "not_now";
  const label = FU_CHOICES.find(([k]) => k === c.sent)?.[1] ?? "";
  const title = thread
    ? notNow ? `Done. ${ra} says in ${thread.where} that you can't answer right now.` : `Sent. Your reply is posted in ${thread.where}${everyone}.`
    : notNow ? `Told ${ra} you can't answer right now.` : `Sent. ${ra} gets your answer.`;
  const sub = notNow ? (thread ? "" : `${ra} gets what your work shows instead.`) : `Your answer: ${label}${c.sentNote ? `, “${c.sentNote}”` : ""}`;
  return { title, sub };
}

/**
 * An open ask's parts under the question: when to reply by (the template's note line), the four quick replies, the note
 * (typed or said), what their assistant will share, and Not now and Send. The notification template places them
 * (owner decision, 9 October 2026: "A plus the grafts"); the card as it was places them too.
 */
function askParts(c) {
  const w = c.w, ra = askerOf(w).name;
  const thread = threadOf(w);
  const everyone = thread && !thread.direct ? " for everyone there" : "";
  const by = w.deadlineAt ? byWhen(w.deadlineAt) : "";
  const due = thread
    ? `${by ? `Reply by ${by}. ` : ""}Your reply is posted in ${thread.where}${everyone}. If you don't reply, ${ra} says so there.`
    : w.asker
    ? `${by ? `Reply by ${by}. ` : ""}If you don't, ${ra} gets what your work shows.`
    : `${by ? `Reply by ${by}. ` : ""}Your reply goes in the report your team lead, the owner and HR receive.`;
  const facts = thread ? [] : (Array.isArray(w.facts) ? w.facts : []).filter((l) => typeof l === "string" && l.trim()).slice(0, 12);
  const task = boredroomPath(w.taskHref);
  const off = busy ? "disabled" : "";
  const choices = `<div class="choices fade" role="group" aria-label="Your answer">${FU_CHOICES.map(([k, label]) => `<button type="button" class="btn choice" data-act="fu-choice" data-choice="${k}" aria-pressed="${c.choice === k}" ${off}>${label}</button>`).join("")}</div>`;
  const note = `<form class="fu-note fade" data-fu><div class="fu-field"><input class="field" id="fnote" name="note" maxlength="${FU_NOTE_MAX}" value="${esc(c.note)}" placeholder="Add a line, if you like" aria-label="Add a line, if you like" aria-describedby="fhold fdict" autocomplete="off" spellcheck="true" ${off}>${talkKeys()}</div><div class="fu-meta"><div class="grow" id="fdict">${dictView()}</div><span class="cap num" id="fcount">${countText(c.note)}</span></div></form>`;
  const foot = facts.length || task ? `<div class="fu-foot fade">${facts.length ? `<button type="button" class="link toggle" data-act="fu-facts" aria-expanded="${!!c.factsOpen}" aria-controls="ffacts">${icon("chevron")}What your assistant will share</button>` : ""}${task ? `<button type="button" class="link" data-act="fu-task" data-href="${esc(task)}">Open task${icon("open")}</button>` : ""}</div>` : "";
  const list = facts.length ? `<ul class="facts fade" id="ffacts" ${c.factsOpen ? "" : "hidden"}>${facts.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>` : "";
  const actions = `<span class="cap lead">${w.taskTitle ? "This doesn't change the task." : "This doesn't change any of your tasks."}</span><button class="btn ghost" data-act="fu-send" data-choice="not_now" ${off}>Not now</button><button class="btn primary accent" data-act="fu-send" data-main ${busy || !c.choice ? "disabled" : ""}>Send</button>`;
  return { due, choices, note, foot, list, actions, slot: `<p class="nc-note">${esc(due)}</p>${choices}${note}${foot}${list}` };
}

function followUpAskView() {
  const c = card, w = c.w, from = askerOf(w);
  const m = moodOf();
  if (c.phase === "sent") {
    const r = askSent(c);
    return `<div class="row fade">${face({ ...m, who: from })}<div class="grow"><p class="title wrap">${esc(r.title)}</p>${r.sub ? `<p class="sub">${esc(r.sub)}</p>` : ""}</div></div>
      <div class="actions"><button class="btn primary" data-act="close">OK</button></div>`;
  }
  if (c.phase === "gone") {
    return `<div class="row fade">${face({ ...m, who: from })}<div class="grow"><p class="title wrap">${esc(w.title)}</p><p class="sub">${esc(c.message)}</p></div></div>
      <div class="actions">${c.n ? `<button class="btn primary" data-act="read" data-id="${esc(c.n.id)}">OK</button>` : `<button class="btn primary" data-act="close">OK</button>`}</div>`;
  }
  const a = askParts(c);
  return `<div class="row top fade">${face({ ...m, who: from })}<div class="grow"><p class="title wrap">${esc(w.title)}</p><p class="sub">${esc(a.due)}</p></div></div>
    ${w.question ? `<p class="quote fade">“${esc(w.question)}”</p>` : ""}
    ${a.choices}
    ${a.note}
    ${a.foot}
    ${a.list}
    <div class="actions">${a.actions}</div>`;
}

/**
 * The talk keys inside the note's field while voice is on: hold them and say the line (it goes into the note). Not while
 * the workspace has voice switched off (phase 7c).
 */
const talkKeys = () => (voice.enabled && voice.modelReady && !voiceOff()
  ?`<span class="fu-keys" id="fhold">${mic}<kbd>${esc(voice.shortcut)}</kbd><span class="sr">Or hold ${esc(voice.shortcut)} and say it.</span></span>`
  : "");

/** Under the note: the microphone while the talk keys are held, the words being written out, or why it could not listen. */
function dictView() {
  const c = card;
  if (!noteCard()) return "";
  if (c.dictating === "listening") {
    return `<div class="dict"><span class="mic"><span class="rec-dot"></span><span class="clock live" id="vtime" role="timer">${mss(voiceSeconds(c))}</span></span><span class="cap">Listening. Let go of <kbd>${esc(voice.shortcut)}</kbd> when you're done.</span></div><div class="wave live" aria-hidden="true"><canvas id="wave"></canvas></div>`;
  }
  if (c.dictating === "transcribing") return `<p class="cap shimmer">Getting your words…</p><div class="wave" aria-hidden="true"><canvas id="wave"></canvas></div>`;
  if (c.dictMessage) return `<p class="cap">${esc(c.dictMessage)}</p>`;
  return "";
}
const countText = (s) => { const n = [...String(s ?? "")].length; return n > FU_COUNT_FROM ? `${n}/${FU_NOTE_MAX}` : ""; };
function showCount() {
  const t = document.getElementById("fcount");
  if (!t || !noteCard()) return;
  const next = countText(card.note), was = t.textContent;
  if (next === was) return;
  t.textContent = next;
  if (!next !== !was) fit(); // the line under the note came or went
}
function showDictation() { const d = document.getElementById("fdict"); if (d) d.innerHTML = dictView(); fit(); }

/** One quick reply chosen, in place (the note keeps its words and focus); Send lights up. */
function chooseReply(choice) {
  if (card?.kind !== "followup_ask" || card.phase !== "ask" || busy || !FU_CHOICES.some(([k]) => k === choice)) return;
  card.choice = choice;
  hush();
  for (const b of el.querySelectorAll('[data-act="fu-choice"]')) b.setAttribute("aria-pressed", String(b.dataset.choice === choice));
  const send = el.querySelector('[data-act="fu-send"]:not([data-choice])');
  if (send) send.disabled = false;
  el.querySelector(".err")?.remove();
  Sound.play("tick");
  syncHold(); // choosing a reply cancels the ask's hold (owner decision, 9 October 2026)
  fit();
}

function toggleFacts(button) {
  const list = document.getElementById("ffacts");
  if (!list || card?.kind !== "followup_ask") return;
  list.hidden = !list.hidden;
  card.factsOpen = !list.hidden;
  button.setAttribute("aria-expanded", String(card.factsOpen));
  fit();
  if (card.factsOpen) list.scrollIntoView({ block: "nearest" }); // a tall card scrolls inside the island
}

/**
 * Sends the reply: the chosen one with the note, or Not now (no note). Closed meanwhile (answered on the web, past its
 * time, cancelled) the card says so in the server's words; any other refusal stays on the card under it.
 */
async function sendFollowUpReply(choice) {
  const c = card;
  if (c?.kind !== "followup_ask" || c.phase !== "ask" || busy) return;
  const pick = choice ?? c.choice;
  if (!pick) { error = "Pick an answer first."; Sound.play("error"); return render(); }
  const input = document.getElementById("fnote");
  const note = pick === "not_now" ? "" : cleanNote(input?.value ?? c.note);
  c.note = input?.value ?? c.note;
  hush();
  busy = true; error = null; render();
  Sound.play("send");
  try {
    await call("POST", org(`/follow-ups/${encodeURIComponent(c.w.id)}/reply`), { choice: pick, ...(note ? { note } : {}) });
  } catch (err) {
    busy = false;
    const still = card?.kind === "followup_ask" && card.w.id === c.w.id;
    Sound.play("error");
    if (err?.status === 404 || err?.status === 409) {
      forgetAsk(c, false);
      if (still) { card = { ...card, phase: "gone", message: err?.message || "This follow-up is already closed.", dictating: null, sticky: true }; render(); holdThenClose(CLOSE_AFTER_MS); }
      return;
    }
    error = err?.message ?? String(err);
    return still ? render() : undefined;
  }
  busy = false;
  forgetAsk(c, true);
  Sound.play("success");
  if (card?.kind === "followup_ask" && card.w.id === c.w.id) {
    card = { ...card, phase: "sent", sent: pick, sentNote: note, dictating: null, sticky: true };
    render(); holdThenClose(CLOSE_AFTER_MS);
  }
  refresh();
}

/**
 * "Sent." stays for the usual delay and then folds away, even though the shorter card has slipped out from under the
 * pointer that pressed Send (a card that is not sticky folds the moment the pointer leaves it). OK and Esc close it at
 * once; the pointer resting on it holds it, as on every card.
 */
function holdThenClose(ms) {
  const held = card;
  clearTimeout(closeTimer);
  cancelHold();
  // In the pager (owner decision, 9 October 2026) what a press did shows for 600 ms and the pager moves on; a card that is
  // gone, or a request that couldn't be done, waits for the person's OK.
  if (held?.pager && pager) {
    restartCountdown(0);
    if (held.phase === "gone" || held.item?.status === "failed") return;
    closeTimer = setTimeout(() => { if (card === held) pagerGo(1); }, Notify.T.ACT_MS);
    return;
  }
  restartCountdown(ms);
  const tick = () => { if (card !== held) return; if (hovering) closeTimer = setTimeout(tick, 1000); else closeCard(); };
  closeTimer = setTimeout(tick, ms);
}

/** The ask is no longer waiting: off the day card, and its notification read once it was answered from here. */
function forgetAsk(c, answered) {
  const ids = new Set((data?.notifications ?? []).filter((n) => n.type === "brenda.followup_ask" && n.resource_id === c.w.id).map((n) => n.id));
  if (c.n) ids.add(c.n.id);
  if (answered) for (const id of ids) { readHere.add(id); call("PATCH", org(`/notifications/${encodeURIComponent(id)}`)).catch(() => {}); }
  if (data) {
    if (answered) data.notifications = (data.notifications ?? []).filter((n) => !ids.has(n.id));
    if (followUps()) data.followUps = { ...data.followUps, waiting: waitingList().filter((x) => x.id !== c.w.id) };
  }
}

/** A waiting ask opened from the day card (its notification may have been shown and folded away already). */
function openWaiting(id) {
  const w = waitingList().find((x) => x.id === id);
  if (!w) return;
  const n = (data?.notifications ?? []).find((x) => x.type === "brenda.followup_ask" && x.resource_id === id) ?? null;
  if (n) nq.shown.add(n.id);
  openCard({ ...askCard(w, n), origin: "user" });
}

/**
 * The day card's "Waiting for you", at most two (the rest wait in Boredroom), in the order the web's inbox keeps (phase 7b,
 * 8 October 2026): follow-up asks with Reply, blocks on the person with Read, requests to accept with Answer, noted
 * commitments and open asks with Answer, then messages and replies with Read, each kind oldest first. Under them, "3 loose
 * ends" when the person has open ones: the whole row opens their Loose ends page. Standup (phase 7c, 8–9 October 2026):
 * today's drafts come first ("Standup for Design ready", as the web's "Waiting for you" puts them first), and a lead's
 * unseen rollups last, each with Read.
 */
function waitingView() {
  const items = itemWaiting().map((w) => ({ id: w.id, title: w.title || itemTitle(w), act: "ai-open", label: w.kind === "request" ? "Answer" : "Read", request: w.kind === "request" }));
  const rows = [
    ...standupEntries().map((e) => ({ id: e.id, title: `Standup for ${e.team.name.trim()} ready`, act: "su-open", sk: "entry", label: "Read" })),
    ...waitingList().map((w) => ({ id: w.id, title: w.title, act: "fu-open", label: "Reply" })),
    ...loopBlocks().map((b) => ({ id: b.id, title: b.title, act: "lp-open", lk: "block", label: "Read" })),
    ...items.filter((r) => r.request),
    ...loopCommitments().map((c) => ({ id: c.id, title: c.title, act: "lp-open", lk: "commitment", label: "Answer" })),
    ...items.filter((r) => !r.request),
    ...standupRollups().map((r) => ({ id: r.id, title: rollupTitle(r), act: "su-open", sk: "rollup", label: "Read" })),
  ].slice(0, 2);
  const loose = looseEndsRow();
  if (!rows.length && !loose) return "";
  return `<ul class="list fade" aria-label="Waiting for you">${rows.map((r) => `<li><span class="t">${esc(r.title)}</span><button class="btn" data-act="${r.act}" data-id="${esc(r.id)}"${r.lk ? ` data-lk="${r.lk}"` : ""}${r.sk ? ` data-sk="${r.sk}"` : ""}>${r.label}</button></li>`).join("")}${loose}</ul>`;
}

/** After a poll: the ask on the card was answered on the web, ran out of time or was cancelled meanwhile. */
function followUpClosedElsewhere() {
  if (card?.kind !== "followup_ask" || card.phase !== "ask" || busy || !followUps()) return;
  if (waitingList().some((x) => x.id === card.w.id)) return;
  card = { ...card, phase: "gone", message: "This follow-up is already closed.", dictating: null, sticky: true };
  render(); holdThenClose(CLOSE_AFTER_MS);
}

/**
 * The talk keys while an ask is open, or a message's reply box or a request's reason box (phase 6): the waveform and the
 * time under the box while they are held, then the words heard added to it (never sent to her). Returns whether the event
 * was the card's.
 */
function dictate(e) {
  const c = card;
  if (busy) return ["listening", "transcribing", "heard", "too-short", "limit", "off", "needs-model", "error"].includes(e.phase);
  if (e.phase === "listening") {
    if (c.dictating === "listening") { Wave.level(e.level ?? 0); return true; }
    hush(); Sound.play("listen");
    Object.assign(c, { dictating: "listening", dictMessage: null, startedAt: Date.now(), endedAt: null });
    syncHold(); // saying a line keeps the card (9 October 2026)
    showDictation(); Wave.start(e.level ?? 0);
    return true;
  }
  if (e.phase === "transcribing") { Sound.play("heard"); Object.assign(c, { dictating: "transcribing", endedAt: Date.now() }); showDictation(); Wave.process(); return true; }
  if (e.phase === "heard") {
    const input = document.getElementById("fnote");
    const before = String(input?.value ?? c.note ?? "").trim();
    c.note = cleanNote(before ? `${before} ${e.text ?? ""}` : e.text);
    c.dictating = null;
    if (input) input.value = c.note;
    showDictation(); showCount(); if (c.kind === "item") showSend(); Sound.play("tick");
    return true;
  }
  if (e.phase === "limit") return true;
  const why = { "too-short": null, off: "Voice is off, so type the line instead.", "needs-model": "Voice is still getting ready. Type the line for now.", error: e.message || "I didn't catch that. Type the line instead." };
  if (!(e.phase in why)) return false;
  if (e.phase === "error") Sound.play("error");
  Object.assign(c, { dictating: null, dictMessage: why[e.phase] });
  showDictation();
  return true;
}

function followUpAnswerView() {
  const c = card, a = c.a, n = c.n, m = moodOf();
  const subject = a ? assistantOf(a.subject?.assistant) : null;
  const title = a?.title || n.title;
  const text = a ? a.answer : n.body;
  const href = boredroomPath(a?.href) ?? boredroomPath(n.href);
  const badge = a ? FU_BADGE[a.status] : null;
  // Both names, as on the web's exchange ("Olu's Max asked Ben's Brenda"), and when it was answered.
  const mine = firstName(data?.me?.displayName ?? config?.displayName);
  const theirs = firstName(a?.subject?.name);
  const at = a?.answeredAt ? atWhen(a.answeredAt) : n.created_at ? atWhen(n.created_at) : "";
  const line = a ? `${mine ? `${mine}'s ${me().name}` : `Your ${me().name}`} asked ${theirs ? `${theirs}'s ${subject.name}` : subject.name}${at ? `, ${at}` : ""}` : at;
  return `<div class="row top fade"><span class="faces">${face(m)}${subject ? face({ ...m, who: subject }) : ""}</span><div class="grow"><p class="title wrap">${esc(title)}</p>${line ? `<p class="cap">${esc(line)}</p>` : ""}</div>${badge ? `<span class="pill ${badge.tone}">${badge.label}</span>` : ""}</div>
    ${text ? `<p class="answer fade">${esc(text)}</p>` : ""}
    ${a?.engine === "claude" && text ? `<p class="cap fade">Written by AI from ${theirs ? `${esc(theirs)}'s` : "their"} work.</p>` : ""}
    <div class="actions">${href ? `<button class="btn" data-act="open-href" data-href="${esc(href)}">Open${icon("open")}</button>` : ""}<button class="btn primary" data-act="read" data-id="${esc(n.id)}">Done</button></div>`;
}

// ---- mentions in Messages ----------------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (personal assistants, phase 5; the header says what the cards show). What each
// notification's body holds (src/server/services/messaging.ts and mentions.ts): a mention's, the message clamped to 120
// characters; a reply's, the reply clamped to 300; a Confirm's, the first thing waiting for it; a private answer's,
// "Only visible to you. " and the answer clamped to 280, or a note's words when there was no answer. The "Only you" badge
// already says the first part, so the card leaves it out. Other people's words go in a quoted bubble, as a follow-up's
// question does; the assistant's in the answer's plain text, line breaks kept.

/** Each type's badge (a word with every colour, amber only for a Confirm), its sound, and whether it stays as long as a reply. */
const MENTION_CARDS = {
  "message.mention": { pill: `<span class="pill">Mention</span>`, sound: "notify", long: false },
  "brenda.mention_reply": { pill: `<span class="pill">Reply</span>`, sound: "reply", long: true },
  "brenda.mention_confirm": { pill: `<span class="pill warn">Confirm</span>`, sound: "attention", long: true },
  "brenda.mention_private": { pill: `<span class="pill">Only you</span>`, sound: "notify", long: true },
  // Tagging someone else's assistant (phase 6, 8 October 2026): to its owner, "Olu asked your Brenda in #design" with
  // what it said (or that it shared privately, or passed it on); to the person who tagged it, "Ben's Brenda replied in
  // #design" with the reply. Both are the assistant's own words, drawn as plain text like a reply.
  "assistant.tagged": { pill: `<span class="pill">Tagged</span>`, sound: "reply", long: true },
  "assistant.thread_reply": { pill: `<span class="pill">Reply</span>`, sound: "reply", long: true },
};
const PRIVATE_LEAD = /^Only visible to you\.\s*/;
/** A mention notification's card, or null (own keys only: a type is never looked up on the prototype). */
const mentionCard = (type) => (typeof type === "string" && Object.hasOwn(MENTION_CARDS, type) ? MENTION_CARDS[type] : null);

function mentionView(n) {
  const body = String(n.body ?? "").trim();
  const at = n.created_at ? atWhen(n.created_at) : "";
  const href = boredroomPath(n.href);
  const answer = n.type === "brenda.mention_private" && PRIVATE_LEAD.test(body) ? body.replace(PRIVATE_LEAD, "") : null;
  // Under the title: the time when the words follow below; otherwise the words themselves (a Confirm's summary, a note).
  let under = at ? `<p class="cap">${esc(at)}</p>` : "", words = "";
  if (n.type === "message.mention") words = body ? `<p class="quote fade">“${esc(body)}”</p>` : "";
  else if (n.type === "brenda.mention_reply" || n.type === "assistant.tagged" || n.type === "assistant.thread_reply") words = body ? `<p class="answer fade">${esc(body)}</p>` : "";
  else if (answer !== null) words = answer ? `<p class="answer fade">${esc(answer)}</p>` : "";
  else if (body) under = `<p class="sub">${esc(body)}</p>`;
  return `<div class="row top fade">${face(moodOf())}<div class="grow"><p class="title wrap">${esc(n.title)}</p>${under}</div>${mentionCard(n.type).pill}</div>
    ${words}
    <div class="actions">${href ? `<button class="btn" data-act="open-href" data-href="${esc(href)}">Open${icon("open")}</button>` : ""}<button class="btn primary" data-act="read" data-id="${esc(n.id)}">OK</button></div>`;
}

// ---- assistants talk to each other -------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (personal assistants, phase 6; the header says what the cards do). The desktop state's
// `assistantItems` (src/server/services/desktop.ts, DesktopAssistantItems) is { ready, waiting, updates }: `waiting` are
// the messages, requests and replies brought to this person that still wait for them, oldest first, each with its sender
// and their assistant (a request with the server's `lines` for what would change and the sender's `note`); `updates` are
// the person's own requests decided or expired and replies to their messages in the last day. Every press goes to
// /assistant-items/<id>/… with the person's own permissions (seen; reply { body }; accept; decline { reason }), and the
// item's notification is then marked read. Accept is done on the server, as the person, and answers with what happened
// (a request that couldn't be done still answers 200, `failed` with the words why). The card's titles and lines are the
// contract's words (src/lib/assistant-items.ts, ASSISTANT_ITEM_WORDS, which this page cannot import). Nothing another
// person wrote is drawn as Markdown or a link, and only Boredroom paths open.

/** Each phase 6 notification's badge on the plain card (an older server, or an item not in the desktop state). */
const ITEM_PILLS = { "assistant.message": "Message", "assistant.request": "Request", "assistant.reply": "Reply", "assistant.outcome": "Request update" };
/** The notifications that bring the person an item that waits for them. */
const ITEM_NOTES = ["assistant.message", "assistant.request", "assistant.reply"];
const ITEM_NOTE_MAX = 280;  // ASSISTANT_ITEM_LIMITS.replyMax and .declineReasonMax (cleanNote and the counter use the same 280)
/** A task status as the done line words it (STATUS_WORDS on the server, inside a sentence). */
const TASK_WORDS = { todo: "to do", in_progress: "in progress", blocked: "blocked", in_review: "in review", completed: "done" };
/** A request's outcome as its sender's badge (itemBadge on the server): a word with every colour. */
const OUTCOME_BADGE = { done: { label: "Done", tone: "ok" }, failed: { label: "Couldn't be done", tone: "bad" }, declined: { label: "Declined", tone: "" }, expired: { label: "Expired", tone: "" }, cancelled: { label: "Cancelled", tone: "" }, accepted: { label: "Doing it", tone: "" } };

const assistantItems = () => (data?.assistantItems && data.assistantItems.ready === true ? data.assistantItems : null);
const str = (v) => (typeof v === "string" ? v : "");
const isPerson = (p) => !!p && typeof p === "object" && typeof p.name === "string";
const isWaiting = (x) => !!x && typeof x === "object" && typeof x.id === "string" && ["message", "request", "reply"].includes(x.kind) && isPerson(x.sender);
const isUpdate = (x) => !!x && typeof x === "object" && typeof x.id === "string" && ["request", "reply"].includes(x.kind) && isPerson(x.other);
const itemWaiting = () => { const a = assistantItems(); return (Array.isArray(a?.waiting) ? a.waiting : []).filter(isWaiting); };
const itemUpdates = () => { const a = assistantItems(); return (Array.isArray(a?.updates) ? a.updates : []).filter(isUpdate); };
/** "Olu's Max": a person's first name and their assistant's name (the assistant's alone without a name). */
const whose = (p) => { const f = firstName(p?.name), a = assistantOf(p?.assistant).name; return f ? `${f}'s ${a}` : a; };
/** "Olu's" (or "their") before a noun. */
const possessive = (p, fallback) => { const f = firstName(p?.name); return f ? `${f}'s` : fallback; };
/** When a request expires, as the web words it: "Sun 11 Oct, 14:00". */
const expiresWhen = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${dayOf(d)}, ${hhmm(d)}`; };
/** Words the server may have quoted already (a notification's body) without their own quote marks, to be quoted once. */
const unquote = (s) => { const t = String(s ?? "").trim(); return /^“[\s\S]*”$/.test(t) ? t.slice(1, -1).trim() : t; };
const sameItem = (c) => card?.kind === "item" && card.w.id === c.w.id;
/**
 * Whether the open card has a one-line box the person is filling: a follow-up's note, a reply, a reason for declining a
 * request or (phase 7b) an open ask.
 */
const noteCard = () => (card?.kind === "followup_ask" && card.phase === "ask") || ((card?.kind === "item" || card?.kind === "loop") && card.phase === "open" && !!(card.replying || card.declining));

/** A waiting item's card title, in the contract's words. */
function itemTitle(w) {
  if (w.kind === "message") return `${whose(w.sender)} passed on a message`;
  if (w.kind === "request") return `${whose(w.sender)} asks you to accept a change`;
  return `${firstName(w.sender.name) || "Someone"} replied to your message`;
}

/** The card an item's notification opens, or null for the plain notification card (an older server, or not known). */
function itemCard(n) {
  if (!assistantItems() || typeof n?.type !== "string") return null;
  if (n.type === "assistant.message" || n.type === "assistant.request") {
    const kind = n.type === "assistant.message" ? "message" : "request";
    const w = itemWaiting().find((x) => x.id === n.resource_id && x.kind === kind);
    return w ? itemCardOf(w, n) : null;
  }
  if (n.type === "assistant.reply" || n.type === "assistant.outcome") return { kind: "item_update", n, u: updateOf(n.resource_id), closeAfter: REPLY_CLOSE_MS };
  return null;
}
/** What came back about `id`: one of the updates, or a reply still waiting to be seen, drawn as one. */
function updateOf(id) {
  const u = itemUpdates().find((x) => x.id === id);
  if (u) return u;
  const w = itemWaiting().find((x) => x.id === id && x.kind === "reply");
  return w ? { id: w.id, kind: "reply", title: str(w.title) || itemTitle(w), body: w.body, status: "delivered", other: w.sender, at: w.createdAt, href: w.href } : null;
}
const itemCardOf = (w, n) => (w.kind === "reply"
  ? { kind: "item_update", n: n ?? null, u: updateOf(w.id), closeAfter: REPLY_CLOSE_MS }
  // Not sticky on its own (owner decision, 9 October 2026): it stays while a box is open or a press is in flight.
  : { kind: "item", phase: "open", w, n: n ?? null, note: "", replying: false, declining: false, dictating: null, dictMessage: null, sticky: false });

/** A waiting item opened from the day card (its notification may have been shown and folded away already). */
function openItem(id) {
  const w = itemWaiting().find((x) => x.id === id);
  if (!w) return;
  const n = (data?.notifications ?? []).find((x) => ITEM_NOTES.includes(x.type) && x.resource_id === id) ?? null;
  if (n) nq.shown.add(n.id);
  openCard({ ...itemCardOf(w, n), origin: "user" });
}

/**
 * The reply box or the reason box, under a message or a request (or, phase 7b, an open ask: `form` "data-loop"); the card
 * keeps its place (no second blur-in).
 */
const itemNoteBox = (placeholder, form = "data-item") => `<form class="fu-note fade" ${form}><div class="fu-field"><input class="field" id="fnote" name="note" maxlength="${ITEM_NOTE_MAX}" value="${esc(card.note)}" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}" aria-describedby="fhold fdict" autocomplete="off" spellcheck="true" ${busy ? "disabled" : ""}>${talkKeys()}</div><div class="fu-meta"><div class="grow" id="fdict">${dictView()}</div><span class="cap num" id="fcount">${countText(card.note)}</span></div></form>`;

function itemView() {
  const c = card, w = c.w, from = assistantOf(w.sender.assistant), m = moodOf();
  const first = firstName(w.sender.name);
  const off = busy ? "disabled" : "";
  const head = (title, under, o = {}) => `<div class="row top fade">${face({ ...m, who: from })}<div class="grow"><p class="title ${o.full ? "full" : "wrap"}"${o.alert ? ' role="alert"' : ""}>${esc(title)}</p>${under}</div></div>`;
  if (c.phase === "sent") {
    return `${head(`Sent. ${from.name} passes it to ${first || "them"}.`, `<p class="sub">Your reply: “${esc(c.sentNote)}”</p>`)}
      <div class="actions"><button class="btn primary" data-act="close">OK</button></div>`;
  }
  if (c.phase === "gone") {
    return `${head(itemTitle(w), `<p class="sub">${esc(c.message)}</p>`)}
      <div class="actions">${c.n ? `<button class="btn primary" data-act="read" data-id="${esc(c.n.id)}">OK</button>` : `<button class="btn primary" data-act="close">OK</button>`}</div>`;
  }
  if (c.phase === "result") {
    const r = itemResult(c);
    // "Couldn't be done" is announced only right after the press (as on the web).
    return `${head(r, `<p class="sub">${esc(`${from.name} lets ${first || "them"} know.`)}</p>`, { full: true, alert: c.item?.status === "failed" })}
      <div class="actions"><button class="btn primary" data-act="close">OK</button></div>`;
  }
  const at = w.createdAt ? atWhen(w.createdAt) : "";
  if (w.kind === "message") {
    const body = str(w.body).trim();
    const how = w.tidied ? `${from.name} reworded it at ${possessive(w.sender, "their")} request.` : `${possessive(w.sender, "Their")} words, as sent.`;
    return `${head(itemTitle(w), at ? `<p class="cap">${esc(at)}</p>` : "")}
      ${body ? `<p class="quote fade">“${esc(body)}”</p>` : ""}
      <p class="cap fade">${esc(how)}</p>
      ${c.replying ? itemNoteBox("Reply in one line") : ""}
      <div class="actions stick">${c.replying
        ? `<button class="btn ghost" data-act="ai-back" ${off}>Back</button><button class="btn primary accent" data-act="ai-send" ${busy || !cleanNote(c.note) ? "disabled" : ""}>Send</button>`
        : `<button class="btn ghost" data-act="ai-seen" ${off}>Seen</button>${w.canReply !== false ? `<button class="btn" data-act="ai-reply" ${off}>Reply</button>` : ""}`}</div>`;
  }
  const lines = (Array.isArray(w.lines) ? w.lines : []).filter((l) => typeof l === "string" && l.trim()).slice(0, 8);
  const note = str(w.note).trim();
  // The date and time stay on one line.
  const exp = w.expiresAt ? expiresWhen(w.expiresAt).replace(/ /g, " ") : "";
  return `${head(itemTitle(w), `<p class="sub">Nothing changes until you accept.${exp ? ` Expires ${esc(exp)}.` : ""}</p>`)}
    ${lines.length ? `<div class="change fade"><p class="lbl" id="ichange">What would change</p><ul class="facts" aria-labelledby="ichange">${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>` : ""}
    ${note ? `<div class="change fade"><p class="lbl">${esc(possessive(w.sender, "Their"))} note</p><p class="quote">“${esc(note)}”</p></div>` : ""}
    ${c.declining ? itemNoteBox("Say why, if you like") : ""}
    <div class="actions stick">${c.declining
      ? `<button class="btn ghost" data-act="ai-back" ${off}>Back</button><button class="btn primary" data-act="ai-decline" ${off}>Decline</button>`
      : `<button class="btn ghost" data-act="ai-decline" ${off}>Decline</button><button class="btn primary accent" data-act="ai-accept" ${off}>Accept</button>`}</div>`;
}

/** What answering a request did, in one line: "Done: added to your to-dos.", "Couldn't be done: …", "Declined.". */
function itemResult(c) {
  const it = c.item ?? {};
  if (it.status === "done") { const words = doneWords(it); return words ? `Done: ${words}.` : "Done."; }
  if (it.status === "failed") return `Couldn't be done: ${str(it.result?.words).trim() || "Something went wrong, so nothing was changed."}`;
  if (it.status === "declined") return "Declined.";
  if (it.status === "expired") return "This request has expired.";
  if (it.status === "cancelled") return `${firstName(c.w.sender.name) || "They"} cancelled this request.`;
  if (it.status === "accepted") return `Accepted. ${me().name} is doing it now.`;
  return c.decided === "decline" ? "Declined." : "Accepted.";
}
/** What was done, from the request itself: "added to your to-dos", "“Landing page” is now in review". */
function doneWords(it) {
  const p = it.request?.payload && typeof it.request.payload === "object" ? it.request.payload : {};
  const kind = it.request?.kind ?? p.kind;
  const task = str(p.taskTitle).trim();
  if (kind === "add_todo") return "added to your to-dos";
  if (kind === "set_reminder") return "reminder set";
  if (kind === "task_status" && task && p.to === "completed" && it.result?.sentForCheck === true) return `“${task}” is sent for a check before it's done`;
  if (kind === "task_status" && task && Object.hasOwn(TASK_WORDS, p.to)) return `“${task}” is now ${TASK_WORDS[p.to]}`;
  if (kind === "task_comment" && task) return `comment added to “${task}”`;
  return str(it.result?.words).trim().replace(/[.!]+$/, "");
}

/** Reply or Decline opens its box under the card, focused; Back closes it. */
function openItemNote(which) {
  const c = card;
  if (c?.kind !== "item" || c.phase !== "open" || busy) return;
  if (which === "replying" ? c.w.kind !== "message" || c.w.canReply === false : c.w.kind !== "request") return;
  Object.assign(c, { replying: which === "replying", declining: which === "declining", note: "", dictating: null, dictMessage: null });
  error = null; render();
  document.getElementById("fnote")?.focus();
}
function closeItemNote() {
  const c = card;
  if (c?.kind !== "item" || busy) return;
  Object.assign(c, { replying: false, declining: false, note: "", dictating: null, dictMessage: null });
  error = null; render();
}
/** Send lights up once the reply has words (the card's one standout), in place. */
function showSend() {
  const b = el.querySelector('[data-act="ai-send"]');
  if (b) b.disabled = busy || !cleanNote(card?.note);
}

/**
 * The item is no longer waiting: off the day card, and, once it was answered from here, its notification read (with the
 * one on the card, `n`).
 */
function forgetItem(id, answered, n = null) {
  const ids = new Set((data?.notifications ?? []).filter((x) => ITEM_NOTES.includes(x.type) && x.resource_id === id).map((x) => x.id));
  if (n) ids.add(n.id);
  if (answered) for (const nid of ids) { readHere.add(nid); call("PATCH", org(`/notifications/${encodeURIComponent(nid)}`)).catch(() => {}); }
  if (!data) return;
  if (answered) data.notifications = (data.notifications ?? []).filter((x) => !ids.has(x.id));
  const a = assistantItems();
  if (a) data.assistantItems = { ...a, waiting: (Array.isArray(a.waiting) ? a.waiting : []).filter((x) => x?.id !== id) };
}

/**
 * A press refused. Closed or gone meanwhile (404, 409: answered on the web, expired, cancelled, already replied), the card
 * says so in the server's words; anything else (signed in as someone else, not ready, offline) stays on the card under it.
 */
function itemRefused(c, err) {
  Sound.play("error");
  if (!sameItem(c)) return;
  if (err?.status === 404 || err?.status === 409) {
    forgetItem(c.w.id, false);
    card = { ...card, phase: "gone", message: err?.message || "This was already answered.", dictating: null, sticky: true };
    render(); return holdThenClose(CLOSE_AFTER_MS);
  }
  error = err?.message ?? String(err);
  render();
}

/** Seen: the message (or request) is marked seen and the card folds away. Esc never does this. */
async function markItemSeen() {
  const c = card;
  if (c?.kind !== "item" || c.phase !== "open" || busy) return;
  busy = true; error = null; render();
  try { await call("POST", org(`/assistant-items/${encodeURIComponent(c.w.id)}/seen`), {}); }
  catch (err) { busy = false; return itemRefused(c, err); }
  busy = false;
  forgetItem(c.w.id, true, c.n);
  Sound.play("tick");
  if (sameItem(c)) finishNotice("Seen");
  refresh();
}

/** Send: the one-line reply goes back to the sender through their assistant (it marks the message seen too). */
async function sendItemReply() {
  const c = card;
  if (c?.kind !== "item" || c.phase !== "open" || !c.replying || busy) return;
  const input = document.getElementById("fnote");
  c.note = input?.value ?? c.note;
  const body = cleanNote(c.note);
  if (!body) { error = "Write your reply first."; Sound.play("error"); return render(); }
  hush();
  busy = true; error = null; render();
  Sound.play("send");
  try { await call("POST", org(`/assistant-items/${encodeURIComponent(c.w.id)}/reply`), { body }); }
  catch (err) { busy = false; return itemRefused(c, err); }
  busy = false;
  forgetItem(c.w.id, true, c.n);
  Sound.play("success");
  if (sameItem(c)) { card = { ...card, phase: "sent", sentNote: body, dictating: null, sticky: true }; render(); holdThenClose(CLOSE_AFTER_MS); }
  refresh();
}

/**
 * Accept or Decline (with the reason, if one was given). Accept is done on the server as the person, through the same
 * services as Boredroom's own buttons; the card then says what happened.
 */
async function decideItem(decision) {
  const c = card;
  if (c?.kind !== "item" || c.phase !== "open" || c.w.kind !== "request" || busy) return;
  if (c.declining) c.note = document.getElementById("fnote")?.value ?? c.note;
  const reason = decision === "decline" ? cleanNote(c.note) : "";
  hush();
  busy = true; error = null; render();
  if (decision === "accept") Sound.play("send");
  let r;
  try { r = await call("POST", org(`/assistant-items/${encodeURIComponent(c.w.id)}/${decision}`), decision === "decline" ? { reason: reason || null } : {}); }
  catch (err) { busy = false; return itemRefused(c, err); }
  busy = false;
  forgetItem(c.w.id, true, c.n);
  const item = r?.item && typeof r.item === "object" ? r.item : { status: decision === "decline" ? "declined" : "accepted" };
  Sound.play(item.status === "failed" ? "error" : decision === "accept" ? "success" : "tick");
  if (sameItem(c)) {
    card = { ...card, phase: "result", item, decided: decision, dictating: null, sticky: true };
    render(); holdThenClose(item.status === "failed" ? REPLY_CLOSE_MS : CLOSE_AFTER_MS);
  }
  refresh();
}

/**
 * After a poll: the request on the card is no longer waiting. It is looked up (it may only have dropped past the first
 * five), and when it was answered on the web, cancelled or ran out of time meanwhile, the card says so.
 */
async function itemClosedElsewhere() {
  const c = card;
  if (c?.kind !== "item" || c.phase !== "open" || c.w.kind !== "request" || busy || c.checking || !assistantItems()) return;
  if (itemWaiting().some((x) => x.id === c.w.id)) return;
  c.checking = true;
  let message = null;
  try {
    const s = (await call("GET", org(`/assistant-items/${encodeURIComponent(c.w.id)}`)))?.item?.status;
    if (s === "cancelled") message = `${firstName(c.w.sender.name) || "They"} cancelled this request.`;
    else if (s === "expired") message = "This request has expired.";
    else if (typeof s === "string" && s !== "delivered" && s !== "seen") message = "This was already answered.";
  } catch (err) { if (err?.status === 404) message = "That isn't here any more."; }
  c.checking = false;
  if (!message || !sameItem(c) || card.phase !== "open" || busy) return;
  card = { ...card, phase: "gone", message, dictating: null, sticky: true };
  render(); holdThenClose(CLOSE_AFTER_MS);
}

/**
 * The update card: what came back about the person's own request (accepted and done, couldn't be done, declined, expired)
 * or a reply to their message. Both assistants' faces, the title, the words (theirs in a quoted bubble, Boredroom's as
 * plain text), Open and Done.
 */
function itemUpdateView() {
  const c = card, u = c.u, n = c.n, m = moodOf();
  const other = u ? assistantOf(u.other.assistant) : null;
  const title = str(u?.title) || str(n?.title);
  const body = (u ? str(u.body) : str(n?.body)).trim();
  const href = boredroomPath(u?.href) ?? boredroomPath(n?.href);
  const at = u?.at ? atWhen(u.at) : n?.created_at ? atWhen(n.created_at) : "";
  const line = u ? `From ${whose(u.other)}${at ? `, ${at}` : ""}` : at;
  const reply = u ? u.kind === "reply" : n?.type === "assistant.reply";
  const badge = reply ? { label: "Reply", tone: "" } : u && Object.hasOwn(OUTCOME_BADGE, u.status) ? OUTCOME_BADGE[u.status] : { label: "Request update", tone: "" };
  const quoted = body && (reply || (u?.status === "declined" && body !== "No reason given."));
  const text = quoted ? `<p class="quote fade">“${esc(unquote(body))}”</p>` : body ? `<p class="answer fade">${esc(body)}</p>` : "";
  return `<div class="row top fade"><span class="faces">${face(m)}${other ? face({ ...m, who: other }) : ""}</span><div class="grow"><p class="title wrap">${esc(title)}</p>${line ? `<p class="cap">${esc(line)}</p>` : ""}</div><span class="pill ${badge.tone}">${badge.label}</span></div>
    ${text}
    <div class="actions">${href ? `<button class="btn" data-act="open-href" data-href="${esc(href)}">Open${icon("open")}</button>` : ""}<button class="btn primary" data-act="ai-ack" ${busy ? "disabled" : ""}>Done</button></div>`;
}

/** Done on an update: its notification read, and a reply to the person's message seen (they have read it here). */
async function ackUpdate() {
  const c = card;
  if (c?.kind !== "item_update" || busy) return;
  const reply = c.u?.kind === "reply" && itemWaiting().some((x) => x.id === c.u.id) ? c.u.id : null;
  if (reply) { call("POST", org(`/assistant-items/${encodeURIComponent(reply)}/seen`), {}).catch(() => {}); forgetItem(reply, false); }
  if (c.n) {
    try { await call("PATCH", org(`/notifications/${encodeURIComponent(c.n.id)}`)); }
    catch (err) { error = err?.message ?? String(err); Sound.play("error"); return render(); }
    if (data) data.notifications = (data.notifications ?? []).filter((x) => x.id !== c.n.id);
    readHere.add(c.n.id);
  }
  if (card === c) finishNotice("Done");
}

// ---- quiet hours ---------------------------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (phase 7a, "quiet means quiet"; the header says what changes). The desktop state's
// `quiet` is { ready, active, until, nextStart } (QuietState), worked out by Boredroom in the person's own time zone, so
// this page only follows it. Between two polls it follows the times it was given as well: quiet ends at `until` and
// starts at `nextStart`, so a reply that lands a moment after quiet hours begin is not read aloud.

/** The person's quiet hours are on now. A missing or unready `quiet` (an older server, before 0046) is never quiet. */
function quietNow() {
  const q = data?.quiet;
  if (!q || typeof q !== "object" || q.ready !== true) return false;
  const now = serverNow();
  const at = (iso) => (typeof iso === "string" ? Date.parse(iso) : NaN);
  if (q.active === true) return !(at(q.until) <= now);
  return at(q.nextStart) <= now;
}
/**
 * "Quiet until 07:00" (within the next day; "Quiet until Sat 07:00" beyond it), short enough for the compact bar, or
 * "Quiet hours" when the end is not known yet.
 */
function quietWords() {
  const q = data?.quiet;
  const end = q?.active === true && typeof q.until === "string" ? new Date(q.until) : null;
  if (!end || Number.isNaN(end.getTime())) return "Quiet hours";
  const soon = end.getTime() - serverNow() < 24 * 3600_000;
  return `Quiet until ${soon ? hhmm(end) : `${end.toLocaleDateString("en-GB", { weekday: "short" })} ${hhmm(end)}`}`;
}
/** Sounds follow the quiet hours, the compact bar says so, and the next change (their end, or their start) is timed. */
function applyQuiet() {
  const on = quietNow();
  Sound.setQuiet(on);
  // When quiet hours end, what waited through them opens: the summary, or its one card (owner decision, 9 October 2026).
  // The morning opener still comes first when it is due (review, same day): then what waited stays held for a later poll.
  if (on !== wasQuiet) { wasQuiet = on; if (config?.signedIn && !card) render(); if (!on && !maybeBriefing({ poll: true })) arrive(); }
  clearTimeout(quietTimer);
  const q = data?.quiet;
  if (!q || typeof q !== "object" || q.ready !== true) return;
  const next = Date.parse(on ? q.until : q.nextStart);
  if (!Number.isFinite(next) || next <= serverNow()) return;
  quietTimer = setTimeout(applyQuiet, Math.min(2 ** 31 - 1, next - serverNow() + 50));
}

// ---- the morning opener ------------------------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (phase 7a; the header says when it opens). The desktop state's `opener` is the web's
// Opener (src/lib/opener.ts): { v: 1, localDate, counts: [{ key, value, label, href }], actions: [{ id, kind, label,
// href?, prompt?, icon }], calm, firstVisit }, or null when the server could not make one. Nothing from it is drawn
// unchecked: a count needs words and a number (or null: "not available"), an action words and either a Boredroom path
// (a link) or a prompt (an ask, only where she can be asked), and an icon is one of its eight names.

const OPENER_ICONS = ["inbox", "alert", "reply", "message", "clipboard", "list", "users", "calendar"];
const OPENER_ACTIONS = 3;   // the notch's share of the web's 3 to 6
const NOT_AVAILABLE = "not available";

/** The opener as the notch may draw it, or null (an older server, a server that could not make one, anything unexpected). */
function openerOf() {
  const o = data?.opener;
  if (!o || typeof o !== "object" || o.v !== 1) return null;
  const counts = (Array.isArray(o.counts) ? o.counts : []).filter((c) => !!c && typeof c === "object" && typeof c.label === "string" && !!c.label.trim()
    && (c.value === null || (typeof c.value === "number" && Number.isFinite(c.value))));
  const asks = !!data.brendaEnabled; // without her in the plan there is no ask box to fill
  const actions = (Array.isArray(o.actions) ? o.actions : []).filter((a) => !!a && typeof a === "object" && typeof a.label === "string" && !!a.label.trim()
    && (a.kind === "link" ? !!mdHref(a.href) : a.kind === "ask" && asks && typeof a.prompt === "string" && !!a.prompt.trim())).slice(0, OPENER_ACTIONS);
  return { counts, actions, calm: typeof o.calm === "string" && o.calm.trim() ? o.calm.trim() : null };
}
/** The counts worth a row: above 0, or not available (as the web shows them). */
const shownCounts = (o) => o.counts.filter((c) => c.value === null || c.value > 0);

/**
 * One count as a row that opens its page: its words on the left ("Requests waiting", the server's label without its
 * number), the number on the right in Geist Mono, or "not available" in grey (never 0).
 */
function countRow(c) {
  const label = c.label.trim();
  let words = label;
  if (c.value === null) words = label.replace(/:\s*not available\.?$/i, "");
  else if (label.startsWith(`${c.value} `)) words = label.slice(String(c.value).length + 1);
  const figure = c.value === null ? `<span class="k">${NOT_AVAILABLE}</span>` : `<span class="k n">${esc(String(c.value))}</span>`;
  const inner = `<span class="t">${esc(cap(words.trim()) || label)}</span>${figure}`;
  const href = mdHref(c.href);
  return `<li>${href ? `<button type="button" class="rowlink" data-act="open-href" data-href="${esc(href)}">${inner}</button>` : inner}</li>`;
}

function openerView() {
  const o = card.o;
  const counts = shownCounts(o);
  const first = firstName(data?.me?.displayName ?? config?.displayName);
  const h = new Date().getHours();
  const greet = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const calm = counts.length ? null : o.calm ?? "Nothing is waiting on you.";
  // The first action is the card's one standout (accent rules); the rest are outline buttons; Later is ghost.
  const actions = o.actions.map((a, i) => `<button type="button" class="btn${i === 0 ? " primary accent" : ""}" ${a.kind === "link" ? `data-act="open-href" data-href="${esc(mdHref(a.href))}"` : `data-act="opener-ask" data-i="${i}" title="Puts it in the box below for you to send"`}>${icon(OPENER_ICONS.includes(a.icon) ? a.icon : "chevron")}${esc(a.label)}</button>`);
  return `<div class="row fade">${face({ ...moodOf(), dot: data?.me?.presence })}<div class="grow"><p class="title" id="otitle">${greet}${first ? `, ${esc(first)}` : ""}.</p><p class="sub">${calm ? esc(calm) : "Here's where things stand."}</p></div></div>
    ${counts.length ? `<ul class="list counts fade" aria-labelledby="otitle">${counts.map(countRow).join("")}</ul>` : ""}
    ${actions.length ? `<div class="starts fade" role="group" aria-label="Start with">${actions.join("")}</div>` : ""}
    ${askBox()}
    <div class="actions">${talkButton()}<button class="btn ghost" data-act="close">Later</button></div>`;
}

/** An ask's words in the ask box, focused with the caret at the end, for the person to send or change (never sent here). */
function fillAsk(prompt) {
  const box = document.getElementById("ask");
  if (!box || typeof prompt !== "string" || !prompt.trim()) return;
  box.value = prompt.trim().slice(0, 4000);
  box.focus();
  try { box.setSelectionRange(box.value.length, box.value.length); } catch { /* not a text field any more */ }
  box.dispatchEvent(new Event("input", { bubbles: true })); // she stops talking and reads along, as when typed
}

// ---- routines --------------------------------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (phase 7a; the header says what the cards show). The desktop state's `routineRuns` is
// { ready, recent: [{ id, notificationId, title, lead, lines: [{ text, href }], href, at }] } (DesktopRoutineRun): the
// runs delivered to the person in the last day, at most five. A routine's words are built from data (task titles, other
// people's names), so they go through esc() only, never md(), and only Boredroom paths open.

const ROUTINE_PILLS = { "brenda.routine": `<span class="pill">Routine</span>`, "brenda.routine_bundle": `<span class="pill">Routines</span>`, "brenda.routine_failed": `<span class="pill warn">Routine</span>` };
const ROUTINE_LINES = 5;
/** A routine notification's badge, or "" (own keys only: a type is never looked up on the prototype). */
const routinePill = (type) => (typeof type === "string" && Object.hasOwn(ROUTINE_PILLS, type) ? ROUTINE_PILLS[type] : "");
const isRun = (r) => !!r && typeof r === "object" && typeof r.id === "string" && typeof r.title === "string";
/** The runs the desktop state carries, or null: an older server, or before migration 0046 (`ready: false`). */
const routineRuns = () => { const r = data?.routineRuns; return r && typeof r === "object" && r.ready === true && Array.isArray(r.recent) ? r.recent.filter(isRun) : null; };
const runLines = (r) => (Array.isArray(r.lines) ? r.lines : []).filter((l) => !!l && typeof l === "object" && typeof l.text === "string" && !!l.text.trim()).slice(0, ROUTINE_LINES);

/** The card a routine notification opens, or null for the plain notification card (an older server, or a run not known). */
function routineCard(n) {
  if (!routinePill(n?.type)) return null;
  const runs = routineRuns();
  if (!runs) return null;
  const base = { kind: "routine", n, closeAfter: REPLY_CLOSE_MS };
  if (n.type === "brenda.routine") {
    const r = runs.find((x) => x.notificationId === n.id) ?? runs.find((x) => x.id === n.resource_id);
    return r ? { ...base, runs: [r] } : null;
  }
  if (n.type === "brenda.routine_bundle") {
    // The runs held over quiet hours, sent together: those that name this notification, else those delivered with it.
    const named = runs.filter((x) => x.notificationId === n.id);
    const sent = Date.parse(n.created_at);
    const near = runs.filter((x) => Math.abs(Date.parse(x.at) - sent) <= 2 * 60_000);
    return { ...base, runs: (named.length ? named : near).slice(0, ROUTINE_LINES) };
  }
  return { ...base, runs: [] };
}

/** A line with its own page: plain text that may run to two lines, and Open, which keeps the card. */
function routineRow(text, more, href) {
  const path = href ? mdHref(href) : null;
  return `<li class="wrap"><span class="t" title="${esc(text)}${more ? `: ${esc(more)}` : ""}">${esc(text)}${more ? `<span class="s">: ${esc(more)}</span>` : ""}</span>${path ? `<button class="btn" data-act="open-keep" data-href="${esc(path)}" aria-label="${esc(`Open: ${text}`)}">Open</button>` : ""}</li>`;
}

/**
 * A routine's card. One run: the routine's name, its lead, up to five lines. Several held over quiet hours: one row per
 * routine with its lead. One that couldn't run (or was paused): why, in the server's words. Open goes to the run (or the
 * routines page, or Settings), Done marks the notification read.
 */
function routineView() {
  const c = card, n = c.n, m = moodOf();
  const one = n.type === "brenda.routine" ? c.runs[0] : null;
  const at = n.created_at ? atWhen(n.created_at) : "";
  const title = one ? str(one.title).trim() || str(n.title) : str(n.title);
  const under = one ? str(one.lead).trim() || at : n.type === "brenda.routine_failed" || !c.runs.length ? str(n.body).trim() || at : at;
  // A run with nothing to report carries its calm line as both its lead and its one line: it shows once.
  const rows = one ? runLines(one).filter((l) => l.text.trim() !== under).map((l) => routineRow(l.text.trim(), "", l.href)) : c.runs.map((r) => routineRow(r.title.trim(), str(r.lead).trim(), r.href));
  const open = (one && mdHref(one.href)) || boredroomPath(n.href);
  return `<div class="row top fade">${face(m)}<div class="grow"><p class="title wrap">${esc(title)}</p>${under ? `<p class="sub">${esc(under)}</p>` : ""}</div>${routinePill(n.type)}</div>
    ${rows.length ? `<ul class="list lines fade" aria-label="${one ? "What it found" : "What ran"}">${rows.join("")}</ul>` : ""}
    <div class="actions">${open ? `<button class="btn" data-act="open-href" data-href="${esc(open)}">Open${icon("open")}</button>` : ""}<button class="btn primary" data-act="read" data-id="${esc(n.id)}">Done</button></div>`;
}

// ---- the Confirm readback --------------------------------------------------------------------------------------------
// Owner decision, 8 October 2026 (phase 7a; the header says what shows). Each Confirm from the chat may carry `readback`
// ({ to: string[], what?: string }, src/lib/confirm-readback.ts): the server's lines naming who receives it (people, a
// channel and its member count, an assistant, "Only you") and what they get. Drawn through esc() under the summary.

const READBACK_MAX = 6;
/** A Confirm's readback as the notch may draw it, or null (an older server, or nothing in it). */
function readbackOf(p) {
  const r = p?.readback;
  if (!r || typeof r !== "object" || !Array.isArray(r.to)) return null;
  const to = r.to.filter((l) => typeof l === "string" && !!l.trim()).map((l) => l.trim());
  const what = typeof r.what === "string" ? r.what.trim() : "";
  return to.length || what ? { to, what } : null;
}
/** What a kept Confirm carries of its readback (past chats; at most 50 lines of 300 characters, as Boredroom keeps it), or nothing. */
const keptReadback = (p) => {
  const r = readbackOf(p);
  return r ? { readback: { to: r.to.slice(0, 50).map((l) => clip(l, 300)), ...(r.what ? { what: clip(r.what, 1000) } : {}) } } : {};
};

/** "Goes to" over the lines (at most six, then "and 2 more"), then "What they get: …"; `id` describes the Confirm button. */
function readbackView(p, id) {
  const r = readbackOf(p);
  if (!r) return "";
  const more = r.to.length - READBACK_MAX;
  const lines = r.to.slice(0, READBACK_MAX).map((l) => `<li><span class="t">${esc(l)}</span></li>`).join("");
  return `<div class="readback" id="${esc(id)}">${r.to.length ? `<p class="lbl" id="${esc(id)}l">Goes to</p><ul class="list" aria-labelledby="${esc(id)}l">${lines}${more > 0 ? `<li class="more"><span class="t">and ${more} more</span></li>` : ""}</ul>` : ""}${r.what ? `<p class="what">What they get: ${esc(r.what)}</p>` : ""}</div>`;
}

// ---- commitments, open asks, blocked on you and loose ends -----------------------------------------------------------
// Owner decision, 8 October 2026 (phase 7b; the header says what the cards do). The desktop state's `loops` is
// DesktopLoops (src/lib/commitments.ts): { ready, commitments, blocks, looseEnds }. `commitments` are the noted
// commitments (`kind` "commitment") and open asks ("open_ask") waiting for this person, oldest first, at most five, each
// { id, kind, title, what, dueLabel, from, acceptLabel, href }; `blocks` the blocks waiting on them, each { id, title,
// question, taskTitle, from, href }; `looseEnds` { open, href }. A press goes to /commitments/<id>/accept, decline,
// dismiss or seen, or /task-blocks/<id>/not-me or seen, as the person, and the notification is then marked read. Accept
// answers { commitment, note } (`note`: the to-do could not be added). The words are the contract's (LOOP_WORDS.inbox,
// errors and notifications.kinds), which this page cannot import. Nothing another person wrote (the what, the question,
// a name) is drawn as Markdown or a link: esc() only, and only Boredroom paths open.

const LOOP_MAX = 5;           // LOOP_LIMITS.desktopMax
/** The notifications that bring a card of each kind, by `resource_id`. */
const LOOP_NOTES = { commitment: ["brenda.commitment", "brenda.open_ask"], block: ["brenda.blocked_on"] };
/** Each phase 7b notification's badge on the plain card: the contract's words, and a status tone with every colour. */
const LOOP_PILLS = {
  "brenda.commitment": ["Commitment noted", ""], "brenda.open_ask": ["Asked of you", ""],
  "brenda.commitment_accepted": ["Commitment accepted", "ok"], "brenda.commitment_declined": ["Commitment declined", ""],
  "brenda.commitment_due": ["Due today", "warn"], "brenda.commitment_stalled": ["Commitment overdue", "bad"],
  "brenda.blocked_on": ["Blocked on you", ""], "brenda.block_answered": ["Answer", "ok"], "brenda.block_not_me": ["Blocked on someone else", ""],
  "brenda.replan": ["Re-plan", "warn"],
};
/** A phase 7b notification's badge, or "" (own keys only: a type is never looked up on the prototype). */
const loopPill = (type) => (typeof type === "string" && Object.hasOwn(LOOP_PILLS, type) ? `<span class="pill ${LOOP_PILLS[type][1]}">${LOOP_PILLS[type][0]}</span>` : "");
/** The contract's words these cards use (LOOP_WORDS.inbox and .errors in src/lib/commitments.ts), under the same names. */
const LOOP_INBOX = {
  commitmentQuestion: "Add it to your to-dos?", commitmentQuestionNoTodos: "Track it as your commitment?", nothingChanges: "Nothing is added until you accept.",
  openAskQuestion: "Take it on?", askerToldOnDecline: (first) => `${first} is told what you decide.`,
  accept: "Add to my to-dos", acceptNoTodos: "Accept", takeItOn: "Take it on", decline: "Decline", dismiss: "Not a commitment", declinePlaceholder: "Say why, if you like",
  accepted: "Added to your to-dos.", acceptedNoTodo: "Tracked as your commitment.", declined: "Declined.", dismissed: "Marked as not a commitment. It won't come back.",
  blockedOn: (taskTitle) => `On “${taskTitle}”`, notMe: "Not me", notMeDone: (first) => `${first} is told it isn't yours.`,
};
const LOOP_ERRORS = { notFound: "That isn't here any more.", closed: "This was already answered.", expired: "This has expired." };
const DECLINE_MAX = 280;      // LOOP_LIMITS.declineReasonMax (the box and cleanNote keep the same 280)

/** What the desktop state carries of it, or null: an older server, or before migration 0048 (`ready: false`). */
const loops = () => (data?.loops && typeof data.loops === "object" && data.loops.ready === true ? data.loops : null);
const isLoopCommitment = (x) => !!x && typeof x === "object" && typeof x.id === "string" && typeof x.title === "string" && !!x.title.trim() && (x.kind === "commitment" || x.kind === "open_ask");
const isLoopBlock = (x) => !!x && typeof x === "object" && typeof x.id === "string" && typeof x.title === "string" && !!x.title.trim();
const loopCommitments = () => { const l = loops(); return (Array.isArray(l?.commitments) ? l.commitments : []).filter(isLoopCommitment).slice(0, LOOP_MAX); };
const loopBlocks = () => { const l = loops(); return (Array.isArray(l?.blocks) ? l.blocks : []).filter(isLoopBlock).slice(0, LOOP_MAX); };
const loopList = (lk) => (lk === "block" ? loopBlocks() : loopCommitments());
const sameLoop = (c) => card?.kind === "loop" && card.w.id === c.w.id;
/** The accept button's words: the server's, else the contract's for the kind. */
const acceptLabelOf = (w) => { const s = str(w.acceptLabel).replace(/\s+/g, " ").trim(); return s ? shorten(s, 40) : w.kind === "open_ask" ? LOOP_INBOX.takeItOn : LOOP_INBOX.accept; };
/**
 * Whose face a block shows: the blocked person's assistant when the state carries it (as the web's card), else the
 * person's own, who brings it to them.
 */
const blockFace = (b) => (b.from && typeof b.from === "object" && b.from.assistant && typeof b.from.assistant === "object" ? assistantOf(b.from.assistant) : me());

/**
 * The day card's row for open loose ends ("3 loose ends", the whole row opens the page), or "". Not while loose ends are
 * switched off for the person (phase 7c, 8–9 October 2026: the abilities catalogue).
 */
function looseEndsRow() {
  if (offHere("loose_ends")) return "";
  const le = loops()?.looseEnds;
  if (!le || typeof le !== "object" || !Number.isInteger(le.open) || le.open <= 0) return "";
  const path = boredroomPath(le.href) ?? `/app/${encodeURIComponent(config.workspaceSlug)}/home/loose-ends`;
  return `<li><button type="button" class="rowlink" data-act="open-href" data-href="${esc(path)}" title="Promises and asks from your conversations that never became a to-do. Only you see them."><span class="t">${le.open === 1 ? "1 loose end" : `${le.open} loose ends`}</span><span class="k">${icon("open")}</span></button></li>`;
}

// Not sticky on its own (owner decision, 9 October 2026): an ask holds 15 s and tucks into the bar; it stays while the
// reason box is open or a press is in flight.
const loopCardOf = (lk, w, n) => ({ kind: "loop", lk, phase: "open", w, n: n ?? null, note: "", declining: false, dictating: null, dictMessage: null, sticky: false, seen: false, keys: {} });

/** The card a commitment's, an open ask's or a block's notification opens, or null for the plain notification card. */
function loopCard(n) {
  if (!loops() || typeof n?.type !== "string") return null;
  const lk = Object.keys(LOOP_NOTES).find((k) => LOOP_NOTES[k].includes(n.type));
  if (!lk) return null;
  const w = loopList(lk).find((x) => x.id === n.resource_id);
  return w ? loopCardOf(lk, w, n) : null;
}

/** One opened from the day card (its notification may have been shown and folded away already): seen at once. */
function openLoop(lk, id) {
  if (!Object.hasOwn(LOOP_NOTES, lk)) return;
  const w = loopList(lk).find((x) => x.id === id);
  if (!w) return;
  const n = (data?.notifications ?? []).find((x) => LOOP_NOTES[lk].includes(x.type) && x.resource_id === id) ?? null;
  if (n) nq.shown.add(n.id);
  const c = { ...loopCardOf(lk, w, n), origin: "user" };
  openCard(c);
  loopSeen(c);
}

/** Tells Boredroom the person has seen it (once per card; never an answer, and a failure is let go). */
function loopSeen(c) {
  if (!c || c.kind !== "loop" || c.seen) return;
  c.seen = true;
  const id = encodeURIComponent(c.w.id);
  call("POST", org(c.lk === "block" ? `/task-blocks/${id}/seen` : `/commitments/${id}/seen`), {}).catch(() => {});
}

/**
 * The press's idempotency key: kept for a retry of the same press after Boredroom could not be reached, and made anew
 * once the server has answered it (an answer, refusals included, is kept against its key).
 */
function loopKey(c, step) {
  c.keys ??= {};
  if (!c.keys[step]) {
    let k = "";
    try { k = crypto.randomUUID(); } catch { k = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
    c.keys[step] = k;
  }
  return c.keys[step];
}

function loopView() {
  const c = card, w = c.w, m = moodOf();
  const block = c.lk === "block";
  const from = block ? blockFace(w) : ws();
  const first = firstName(w.from?.name);
  const off = busy ? "disabled" : "";
  const head = (title, under, o = {}) => `<div class="row top fade">${face({ ...m, who: from })}<div class="grow"><p class="title ${o.full ? "full" : "wrap"}">${esc(title)}</p>${under}</div></div>`;
  if (c.phase === "result") {
    return `${head(c.result, c.resultSub ? `<p class="sub">${esc(c.resultSub)}</p>` : "", { full: true })}
      <div class="actions"><button class="btn primary" data-act="close">OK</button></div>`;
  }
  if (c.phase === "gone") {
    return `${head(w.title, `<p class="sub">${esc(c.message)}</p>`)}
      <div class="actions">${c.n ? `<button class="btn primary" data-act="read" data-id="${esc(c.n.id)}">OK</button>` : `<button class="btn primary" data-act="close">OK</button>`}</div>`;
  }
  const open = boredroomPath(w.href);
  if (block) {
    // The answer is typed in Boredroom, where it becomes the person's comment on the task; Not me is answered here.
    const task = str(w.taskTitle).trim();
    const question = str(w.question).trim();
    const where = `You answer it in Boredroom, where ${first ? `${first} sees` : "they see"} it as your comment on the task.`;
    return `${head(w.title, task ? `<p class="sub">${esc(LOOP_INBOX.blockedOn(task))}</p>` : "")}
      ${question ? `<p class="quote fade">“${esc(question)}”</p>` : ""}
      <p class="cap fade">${esc(where)}</p>
      <div class="actions stick"><button class="btn ghost" data-act="lp-notme" ${off}>${LOOP_INBOX.notMe}</button>${open ? `<button class="btn primary" data-act="open-href" data-href="${esc(open)}" ${off}>Open${icon("open")}</button>` : ""}</div>`;
  }
  const ask = w.kind === "open_ask";
  const what = shorten(str(w.what).replace(/\s+/g, " ").trim(), 240);
  const due = str(w.dueLabel).trim();
  const accept = acceptLabelOf(w);
  // The what in its own bubble, unless the title already quotes exactly it.
  const quote = what && !str(w.title).includes(`“${what}”`) ? `<p class="quote fade">“${esc(what)}”</p>` : "";
  const question = ask
    ? `${LOOP_INBOX.openAskQuestion}${first ? ` ${LOOP_INBOX.askerToldOnDecline(first)}` : ""}`
    : `${accept === LOOP_INBOX.acceptNoTodos ? LOOP_INBOX.commitmentQuestionNoTodos : LOOP_INBOX.commitmentQuestion} ${LOOP_INBOX.nothingChanges}`;
  const openBtn = open ? `<button class="btn" data-act="open-href" data-href="${esc(open)}" ${off}>Open${icon("open")}</button>` : "";
  return `${head(w.title, due ? `<p class="cap">${esc(`Due ${due}`)}</p>` : "")}
    ${quote}
    <p class="sub fade">${esc(question)}</p>
    ${c.declining ? itemNoteBox(LOOP_INBOX.declinePlaceholder, "data-loop") : ""}
    <div class="actions stick">${c.declining
      ? `<button class="btn ghost" data-act="lp-back" ${off}>Back</button><button class="btn primary" data-act="lp-decline" ${off}>${LOOP_INBOX.decline}</button>`
      : `${openBtn}${ask ? `<button class="btn ghost" data-act="lp-decline" ${off}>${LOOP_INBOX.decline}</button>` : `<button class="btn ghost" data-act="lp-dismiss" ${off}>${LOOP_INBOX.dismiss}</button>`}<button class="btn primary accent" data-act="lp-accept" ${off}>${esc(accept)}</button>`}</div>`;
}

/** Decline on an open ask opens its reason box under the card, focused; Back closes it. */
function openLoopNote() {
  const c = card;
  if (c?.kind !== "loop" || c.phase !== "open" || c.lk !== "commitment" || c.w.kind !== "open_ask" || busy) return;
  Object.assign(c, { declining: true, note: "", dictating: null, dictMessage: null });
  loopSeen(c);
  error = null; render();
  document.getElementById("fnote")?.focus();
}
function closeLoopNote() {
  const c = card;
  if (c?.kind !== "loop" || busy) return;
  Object.assign(c, { declining: false, note: "", dictating: null, dictMessage: null });
  error = null; render();
}

/**
 * It is no longer waiting: off the day card, and, once it was answered from here, its notifications read (with the one on
 * the card).
 */
function forgetLoop(c, answered) {
  const types = LOOP_NOTES[c.lk];
  const ids = new Set((data?.notifications ?? []).filter((x) => types.includes(x.type) && x.resource_id === c.w.id).map((x) => x.id));
  if (c.n) ids.add(c.n.id);
  if (answered) for (const id of ids) { readHere.add(id); call("PATCH", org(`/notifications/${encodeURIComponent(id)}`)).catch(() => {}); }
  if (!data) return;
  if (answered) data.notifications = (data.notifications ?? []).filter((x) => !ids.has(x.id));
  const l = loops();
  const key = c.lk === "block" ? "blocks" : "commitments";
  if (l) data.loops = { ...l, [key]: (Array.isArray(l[key]) ? l[key] : []).filter((x) => x?.id !== c.w.id) };
}

/**
 * A press refused. Answered, expired or gone meanwhile (404, 409), the card says so in the server's words; anything else
 * (not ready, someone else signed in as the person, offline, the same press still going through) stays on the card under
 * it, to try again.
 */
function loopRefused(c, err) {
  Sound.play("error");
  if (!sameLoop(c)) return;
  if ((err?.status === 404 || err?.status === 409) && err?.code !== "IN_PROGRESS") {
    forgetLoop(c, false);
    card = { ...card, phase: "gone", message: err?.message || (err?.status === 404 ? LOOP_ERRORS.notFound : LOOP_ERRORS.closed), dictating: null, sticky: true };
    render(); return holdThenClose(CLOSE_AFTER_MS);
  }
  error = err?.message ?? String(err);
  render();
}

/**
 * Accept (the to-do is added by Boredroom, as the person), Decline an open ask (with the reason, if one was given; the
 * asker is told privately), Not a commitment, or Not me on a block. The card then says what happened.
 */
async function decideLoop(step) {
  const c = card;
  if (c?.kind !== "loop" || c.phase !== "open" || busy) return;
  const block = c.lk === "block";
  if (block ? step !== "not_me" : !["accept", "decline", "dismiss"].includes(step)) return;
  if (step === "decline" && c.w.kind !== "open_ask") return;
  if (c.declining) c.note = document.getElementById("fnote")?.value ?? c.note;
  const reason = step === "decline" ? [...cleanNote(c.note)].slice(0, DECLINE_MAX).join("") : "";
  loopSeen(c);
  hush();
  busy = true; error = null; render();
  if (step === "accept") Sound.play("send");
  const id = encodeURIComponent(c.w.id);
  const path = block ? `/task-blocks/${id}/not-me` : `/commitments/${id}/${step}`;
  let r;
  try { r = await call("POST", org(path), reason ? { reason } : {}, { idempotencyKey: loopKey(c, step) }); }
  catch (err) {
    busy = false;
    if (err?.status && err.code !== "IN_PROGRESS") delete c.keys[step]; // the server answered: a new press is a new key
    return loopRefused(c, err);
  }
  busy = false;
  forgetLoop(c, true);
  const first = firstName(c.w.from?.name);
  let result = "", sub = "";
  if (step === "accept") {
    const v = r?.commitment && typeof r.commitment === "object" ? r.commitment : null;
    result = str(r?.note).trim() || (v?.acceptMakesTodo === false ? LOOP_INBOX.acceptedNoTodo : LOOP_INBOX.accepted);
    const what = str(v?.title).trim() || str(c.w.what).trim();
    const due = str(v?.dueLabel).trim() || str(c.w.dueLabel).trim();
    sub = what ? `“${what}”${due ? `, due ${due}` : ""}` : "";
  } else if (step === "decline") { result = LOOP_INBOX.declined; sub = first ? `${first} is told, privately.` : ""; }
  else if (step === "dismiss") result = LOOP_INBOX.dismissed;
  else result = first ? LOOP_INBOX.notMeDone(first) : "They're told it isn't yours.";
  Sound.play(step === "accept" ? "success" : "tick");
  if (sameLoop(c)) {
    card = { ...card, phase: "result", decided: step, result, resultSub: sub, declining: false, dictating: null, sticky: true };
    render(); holdThenClose(CLOSE_AFTER_MS);
  }
  refresh();
}

/**
 * After a poll: the one on the card is no longer waiting (answered in Boredroom, expired, withdrawn), or an open ask became
 * a noted commitment because the person agreed in the thread (the card then reads as agreed, unless a reason is being
 * typed). A commitment missing from the five is looked up first; a block missing from the list is gone.
 */
async function loopClosedElsewhere() {
  const c = card;
  if (c?.kind !== "loop" || c.phase !== "open" || busy || c.checking || !loops()) return;
  const fresh = loopList(c.lk).find((x) => x.id === c.w.id);
  if (fresh) {
    if (!c.declining && (fresh.kind !== c.w.kind || fresh.title !== c.w.title)) { card = { ...c, w: fresh }; render(); }
    return;
  }
  let message = null;
  if (c.lk === "block") message = LOOP_ERRORS.notFound;
  else {
    c.checking = true;
    try {
      const s = (await call("GET", org(`/commitments/${encodeURIComponent(c.w.id)}`)))?.commitment?.status;
      if (s === "expired") message = LOOP_ERRORS.expired;
      else if (s === "cancelled") message = LOOP_ERRORS.notFound;
      else if (typeof s === "string" && s !== "proposed" && s !== "asked") message = LOOP_ERRORS.closed;
    } catch (err) { if (err?.status === 404) message = LOOP_ERRORS.notFound; }
    c.checking = false;
  }
  if (!message || !sameLoop(c) || card.phase !== "open" || busy) return;
  card = { ...card, phase: "gone", message, declining: false, dictating: null, sticky: true };
  render(); holdThenClose(CLOSE_AFTER_MS);
}

// ---- standup ---------------------------------------------------------------------------------------------------------
// Owner decisions, 8–9 October 2026 (phase 7c, async standup option B; the header says what the cards do). The desktop
// state's `standup` is DesktopStandup (src/lib/standup.ts, which this page cannot import): { ready, entries, rollups }.
// `entries` are the person's drafts ready today (StandupEntryView: { id, team { id, name }, dateLabel, sinceLabel, status,
// texts { yesterday, today, blocked } | null, draft, postTo { name, members }, posted, canUnskip, seen, href }); `rollups`
// are today's rollups sent to them as a team lead and not seen yet (StandupRollupView: { id, team, dateLabel, content
// { counts { members, posted }, blockers [{ name, onName, text }], noUpdate [{ name }], late [{ name, at }], cutoffAt },
// href }). A press goes to /standup/entries/<id>/post, skip, unskip or seen, or /standup/rollups/<id>/seen, as the person;
// Post answers { entry, message { href }, already? } (a second press answers the post it made, never a second post), Skip
// and Undo the entry. The words are the contract's (STANDUP_WORDS), which this page cannot import. The card shows what Post
// would send (`texts`, the person's approved words), else the draft's lines; what the person wrote and other people's names
// and words go through esc() only, never Markdown or a link, and only Boredroom paths open. Before migration 0050
// (`ready: false`) and from an older server (no `standup`) nothing changes: the plain notification cards show.

const STANDUP_LINES = 4;      // lines shown per section, then "and 2 more"
const ROLLUP_BLOCKERS = 4;    // blockers shown on the rollup card, then "and 2 more"
const STANDUP_SECTIONS = ["yesterday", "today", "blocked"];
/** The notifications that bring a card of each kind, by `resource_id`. */
const STANDUP_NOTES = { entry: "brenda.standup", rollup: "brenda.standup_rollup" };
/** Each standup notification's badge on the plain card: the contract's words; amber only for a draft that couldn't be made. */
const STANDUP_PILLS = { "brenda.standup": ["Standup", ""], "brenda.standup_rollup": ["Standup rollup", ""], "brenda.standup_failed": ["Standup", "warn"] };
/** A standup notification's badge, or "" (own keys only: a type is never looked up on the prototype). */
const standupPill = (type) => (typeof type === "string" && Object.hasOwn(STANDUP_PILLS, type) ? `<span class="pill ${STANDUP_PILLS[type][1]}">${STANDUP_PILLS[type][0]}</span>` : "");
/** The contract's words these cards use (STANDUP_WORDS in src/lib/standup.ts and section B.4), under names of their own. */
const STANDUP_SAY = {
  title: (team) => `Your standup for ${team}`,
  labels: { yesterday: "Yesterday", today: "Today", blocked: "Blocked" },
  nothing: "Nothing",
  // Post sends every line, the hidden ones too: the line says so, and its tooltip lists them (fix review, 9 October 2026).
  more: (n) => `and ${n} more, posted too`,
  members: (n) => (Number.isInteger(n) && n > 0 ? `${n} ${n === 1 ? "person" : "people"}` : "member count not available"),
  goesTo: (to, members, name) => `Goes to ${to} (${members}), as you, sent by ${name}`,
  skip: "Skip today", edit: "Edit", post: "Post",
  posted: (to, at) => `Posted to ${to}${at ? ` at ${at}` : ""}`,
  skipped: "Skipped.", skippedSub: "The rollup lists you under No update, like anyone who didn't post.",
  undone: "Undone.", undoneSub: (name) => `Your standup is back. ${name} shows it here once it's ready.`,
  closed: "This standup was skipped or its day has passed.", notFound: "That isn't here any more.",
  rollup: (team, posted, members) => `${team} standup: ${posted} of ${members} posted`,
  blocked: "Blocked", noUpdate: "No update", late: (at, names) => `Posted after ${at}: ${names}`,
};

/** What the desktop state carries of it, or null: an older server, or before migration 0050 (`ready: false`). */
const standupState = () => (data?.standup && typeof data.standup === "object" && data.standup.ready === true ? data.standup : null);
const isStandupThing = (x) => !!x && typeof x === "object" && typeof x.id === "string" && !!x.team && typeof x.team === "object" && typeof x.team.name === "string" && !!x.team.name.trim();
/** Today's drafts waiting for the person's press (none while standup is switched off for them). */
const standupEntries = () => { const s = standupState(); return offHere("standup") ? [] : (Array.isArray(s?.entries) ? s.entries : []).filter((e) => isStandupThing(e) && e.status === "ready"); };
/** A lead's rollups sent today and not seen yet. */
const standupRollups = () => { const s = standupState(); return (Array.isArray(s?.rollups) ? s.rollups : []).filter((r) => isStandupThing(r) && !!r.content && typeof r.content === "object" && r.seen !== true); };
const sameStandup = (c) => card?.kind === c.kind && card.w?.id === c.w.id;
/** "#Design": the team channel's name as the server gives it, else the team's. */
const postToOf = (e) => str(e.postTo?.name).trim() || `#${e.team.name.trim()}`;
/** A moment as "09:41", or "" when it is not one. */
const timeOf = (iso) => { const d = new Date(typeof iso === "string" ? iso : NaN); return Number.isNaN(d.getTime()) ? "" : hhmm(d); };
/** "Design standup: 4 of 6 posted", the rollup notification's own words. */
function rollupTitle(r) {
  const counts = r.content.counts && typeof r.content.counts === "object" ? r.content.counts : {};
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return STANDUP_SAY.rollup(r.team.name.trim(), n(counts.posted), n(counts.members));
}

// Not sticky on its own (owner decision, 9 October 2026): the draft holds 15 s and tucks into the bar ("Max is waiting on
// you"); a press in flight keeps it. Post is still only ever the person's press.
const standupCardOf = (e, n) => ({ kind: "standup", phase: "open", w: e, n: n ?? null, sticky: false, seen: e.seen === true, keys: {} });
const rollupCardOf = (r, n) => ({ kind: "standup_rollup", w: r, n: n ?? null, seen: false, closeAfter: REPLY_CLOSE_MS });

/** The card a standup's or a rollup's notification opens, or null for the plain notification card. */
function standupCard(n) {
  if (!standupState() || typeof n?.type !== "string") return null;
  if (n.type === STANDUP_NOTES.entry) { const e = standupEntries().find((x) => x.id === n.resource_id); return e ? standupCardOf(e, n) : null; }
  if (n.type === STANDUP_NOTES.rollup) { const r = standupRollups().find((x) => x.id === n.resource_id); return r ? rollupCardOf(r, n) : null; }
  return null;
}

/** A draft or a rollup opened from the day card (its notification may have been shown and folded away already): seen at once. */
function openStandup(sk, id) {
  if (sk !== "entry" && sk !== "rollup") return;
  const entry = sk === "entry";
  const w = (entry ? standupEntries() : standupRollups()).find((x) => x.id === id);
  if (!w) return;
  const type = entry ? STANDUP_NOTES.entry : STANDUP_NOTES.rollup;
  const n = (data?.notifications ?? []).find((x) => x.type === type && x.resource_id === id) ?? null;
  if (n) nq.shown.add(n.id);
  const c = { ...(entry ? standupCardOf(w, n) : rollupCardOf(w, n)), origin: "user" };
  openCard(c);
  standupSeen(c);
}

/**
 * Tells Boredroom the person has seen it (once per card; never an answer, and a failure is let go). A rollup seen here
 * leaves the day card at once (the state carries unseen ones only, so the next poll would drop it anyway).
 */
function standupSeen(c) {
  if (!c || (c.kind !== "standup" && c.kind !== "standup_rollup") || c.seen) return;
  c.seen = true;
  const id = encodeURIComponent(c.w.id);
  call("POST", org(c.kind === "standup" ? `/standup/entries/${id}/seen` : `/standup/rollups/${id}/seen`), {}).catch(() => {});
  const s = standupState();
  if (c.kind === "standup_rollup" && s) data.standup = { ...s, rollups: (Array.isArray(s.rollups) ? s.rollups : []).filter((x) => x?.id !== c.w.id) };
}

/** A section's lines as Post would send them (the person's `texts`), else the draft's; list marks dropped, blank lines left out. */
function sectionLines(e, s) {
  const texts = e.texts && typeof e.texts === "object" ? e.texts : null;
  const lines = texts ? str(texts[s]).split("\n") : (Array.isArray(e.draft?.sections?.[s]) ? e.draft.sections[s] : []).map((l) => str(l?.text));
  return lines.map((l) => l.replace(/^\s*[-*•]\s+/, "").trim()).filter(Boolean);
}

/**
 * One section: its label ("Since Friday", "Today", "Blocked") over its lines, at most four, then "and 2 more". A section
 * left empty is left out, as the post leaves it out, except Blocked, which says "Nothing" (src/lib/standup.ts,
 * standupPostBody).
 */
function standupSection(e, s, i) {
  let lines = sectionLines(e, s);
  if (!lines.length) { if (s !== "blocked") return ""; lines = [STANDUP_SAY.nothing]; }
  const label = s === "yesterday" ? str(e.sinceLabel).trim() || STANDUP_SAY.labels.yesterday : STANDUP_SAY.labels[s];
  const more = lines.length - STANDUP_LINES;
  const rows = (more > 0 ? lines.slice(0, STANDUP_LINES) : lines).map((l) => `<li title="${esc(l)}"><span class="t">${esc(l)}</span></li>`).join("");
  const hidden = more > 0 ? lines.slice(STANDUP_LINES).join("\n") : "";
  return `<p class="lbl" id="ss${i}">${esc(label)}</p><ul aria-labelledby="ss${i}">${rows}${more > 0 ? `<li class="more" title="${esc(hidden)}">${esc(STANDUP_SAY.more(more))}</li>` : ""}</ul>`;
}

/**
 * The standup card. Open: the team and the day, the three sections, who it goes to, then Skip today, Edit (in Boredroom)
 * and Post, the card's one orange button and the person's consent: nothing posts until it is pressed. Then what happened:
 * posted (with Open), skipped (with Undo while the server allows it), undone, or gone (answered in Boredroom, the day
 * passed, standup switched off) in the server's words.
 */
function standupView() {
  const c = card, e = c.w, m = moodOf();
  const team = e.team.name.trim();
  const to = postToOf(e);
  const off = busy ? "disabled" : "";
  const head = (title, under, o = {}) => `<div class="row top fade">${face(m)}<div class="grow"><p class="title ${o.full ? "full" : "wrap"}">${esc(title)}</p>${under}</div></div>`;
  const sub = (s) => (s ? `<p class="sub">${esc(s)}</p>` : "");
  if (c.phase === "posted") {
    return `${head(STANDUP_SAY.posted(to, c.at), "", { full: true })}
      <div class="actions">${c.href ? `<button class="btn" data-act="open-href" data-href="${esc(c.href)}">Open${icon("open")}</button>` : ""}<button class="btn primary" data-act="close">OK</button></div>`;
  }
  if (c.phase === "skipped") {
    return `${head(STANDUP_SAY.skipped, sub(STANDUP_SAY.skippedSub), { full: true })}
      <div class="actions">${c.canUnskip ? `<button class="btn ghost" data-act="su-unskip" ${off}>${icon("undo")}Undo</button>` : ""}<button class="btn primary" data-act="close" ${off}>OK</button></div>`;
  }
  if (c.phase === "result") {
    return `${head(c.result, sub(c.resultSub), { full: true })}
      <div class="actions"><button class="btn primary" data-act="close">OK</button></div>`;
  }
  if (c.phase === "gone") {
    return `${head(STANDUP_SAY.title(team), sub(c.message))}
      <div class="actions">${c.n ? `<button class="btn primary" data-act="read" data-id="${esc(c.n.id)}">OK</button>` : `<button class="btn primary" data-act="close">OK</button>`}</div>`;
  }
  const edit = boredroomPath(e.href);
  return `${head(STANDUP_SAY.title(team), sub(str(e.dateLabel).trim()))}
    <div class="standup fade" role="group" aria-label="${esc(STANDUP_SAY.title(team))}">${STANDUP_SECTIONS.map((s, i) => standupSection(e, s, i)).join("")}</div>
    <p class="cap fade" id="sgoes">${esc(STANDUP_SAY.goesTo(to, STANDUP_SAY.members(e.postTo?.members), me().name))}</p>
    <div class="actions stick"><button class="btn ghost" data-act="su-skip" ${off}>${STANDUP_SAY.skip}</button>${edit ? `<button class="btn" data-act="open-href" data-href="${esc(edit)}" title="Edit it in Boredroom" ${off}>${STANDUP_SAY.edit}${icon("open")}</button>` : ""}<button class="btn primary accent" data-act="su-post" aria-label="${esc(`Post to ${to}`)}" aria-describedby="sgoes" ${off}>${STANDUP_SAY.post}</button></div>`;
}

/**
 * The draft is no longer waiting: off the day card, and, once the person answered it (here or in Boredroom), its
 * notifications read (with the one on the card).
 */
function forgetStandup(c, answered) {
  const ids = new Set((data?.notifications ?? []).filter((x) => x.type === STANDUP_NOTES.entry && x.resource_id === c.w.id).map((x) => x.id));
  if (c.n) ids.add(c.n.id);
  if (answered) for (const id of ids) { readHere.add(id); call("PATCH", org(`/notifications/${encodeURIComponent(id)}`)).catch(() => {}); }
  if (!data) return;
  if (answered) data.notifications = (data.notifications ?? []).filter((x) => !ids.has(x.id));
  const s = standupState();
  if (s) data.standup = { ...s, entries: (Array.isArray(s.entries) ? s.entries : []).filter((x) => x?.id !== c.w.id) };
}

/**
 * A press refused. Closed meanwhile (404, or 409: skipped or past its day, no longer in the team, standup switched off,
 * the channel archived), the card says so in the server's words; anything else (someone else signed in as the person,
 * not ready, offline, the same press still going through) stays on the card under it, to try again.
 */
function standupRefused(c, err) {
  Sound.play("error");
  if (!sameStandup(c)) return;
  if ((err?.status === 404 || err?.status === 409) && err?.code !== "IN_PROGRESS") {
    forgetStandup(c, false);
    card = { ...card, phase: "gone", message: err?.message || (err?.status === 404 ? STANDUP_SAY.notFound : STANDUP_SAY.closed), sticky: true };
    render(); return holdThenClose(CLOSE_AFTER_MS);
  }
  error = err?.message ?? String(err);
  render();
}

/**
 * Post (the person's words go to the team channel as theirs, sent by their assistant) or Skip today (the rollup lists them
 * under No update, like anyone who didn't post). Each press carries its idempotency key (loopKey: kept for a retry after
 * Boredroom could not be reached, new once the server has answered). The card then says what happened.
 */
async function decideStandup(step) {
  const c = card;
  if (c?.kind !== "standup" || c.phase !== "open" || busy || (step !== "post" && step !== "skip")) return;
  standupSeen(c);
  hush();
  busy = true; error = null; render();
  if (step === "post") Sound.play("send");
  let r;
  try { r = await call("POST", org(`/standup/entries/${encodeURIComponent(c.w.id)}/${step}`), {}, { idempotencyKey: loopKey(c, step) }); }
  catch (err) {
    busy = false;
    if (err?.status && err.code !== "IN_PROGRESS") delete c.keys[step]; // the server answered: a new press is a new key
    return standupRefused(c, err);
  }
  busy = false;
  forgetStandup(c, true);
  Sound.play(step === "post" ? "success" : "tick");
  if (sameStandup(c)) {
    if (step === "post") {
      const entry = r?.entry && typeof r.entry === "object" ? r.entry : null;
      card = { ...card, phase: "posted", at: timeOf(entry?.posted?.at), href: boredroomPath(r?.message?.href) ?? boredroomPath(entry?.posted?.href), sticky: true };
    } else card = { ...card, phase: "skipped", canUnskip: r?.canUnskip === true, ...(isStandupThing(r) && r.id === c.w.id ? { w: r } : {}), sticky: true };
    render(); holdThenClose(CLOSE_AFTER_MS);
  }
  refresh();
}

/** Undo on a skip, until the rollup has gone: the draft comes back to the card (or is drafted again, and shows once ready). */
async function unskipStandup() {
  const c = card;
  if (c?.kind !== "standup" || c.phase !== "skipped" || !c.canUnskip || busy) return;
  busy = true; error = null; render();
  clearTimeout(closeTimer); restartCountdown(0);
  let r;
  try { r = await call("POST", org(`/standup/entries/${encodeURIComponent(c.w.id)}/unskip`), {}, { idempotencyKey: loopKey(c, "unskip") }); }
  catch (err) {
    busy = false;
    if (err?.status && err.code !== "IN_PROGRESS") delete c.keys.unskip;
    Sound.play("error");
    if (!sameStandup(c)) return;
    // Too late (the rollup has gone) or closed meanwhile: the server's words, and the Undo goes.
    if (err?.status === 404 || err?.status === 409) card.canUnskip = false;
    error = err?.message ?? String(err);
    render(); return holdThenClose(REPLY_CLOSE_MS);
  }
  busy = false;
  Sound.play("tick");
  if (sameStandup(c)) {
    // Back on the card with fresh keys: a skip after this is a new press, never the old one replayed.
    if (isStandupThing(r) && r.id === c.w.id && r.status === "ready") { card = { ...standupCardOf(r, null), seen: true, origin: card.origin, pager: card.pager, openedAt: card.openedAt }; render(); }
    else { card = { ...card, phase: "result", result: STANDUP_SAY.undone, resultSub: STANDUP_SAY.undoneSub(me().name), sticky: true }; render(); holdThenClose(CLOSE_AFTER_MS); }
  }
  refresh();
}

/**
 * After a poll: the draft on the card was edited in Boredroom (the card shows the words Post would send now), or it is no
 * longer waiting: posted or skipped there (the card says so, as if pressed here), or closed (the day passed, standup
 * switched off, no longer in the team). A draft missing from the list is looked up first.
 */
async function standupClosedElsewhere() {
  const c = card;
  if (c?.kind !== "standup" || c.phase !== "open" || busy || c.checking || !standupState()) return;
  const fresh = standupEntries().find((x) => x.id === c.w.id);
  if (fresh) {
    if (JSON.stringify(fresh.texts ?? null) !== JSON.stringify(c.w.texts ?? null) || fresh.postTo?.members !== c.w.postTo?.members) { card = { ...c, w: fresh }; render(); }
    return;
  }
  c.checking = true;
  let next = null;
  try {
    const v = await call("GET", org(`/standup/entries/${encodeURIComponent(c.w.id)}`));
    if (isStandupThing(v)) {
      if (v.status === "posted") next = { phase: "posted", at: timeOf(v.posted?.at), href: boredroomPath(v.posted?.href) };
      else if (v.status === "skipped") next = { phase: "skipped", canUnskip: v.canUnskip === true, w: v };
      else if (v.status !== "ready" && v.status !== "drafting") next = { phase: "gone", message: STANDUP_SAY.closed };
    }
  } catch (err) { if (err?.status === 404) next = { phase: "gone", message: STANDUP_SAY.notFound }; }
  c.checking = false;
  if (!next || !sameStandup(c) || card.phase !== "open" || busy) return;
  forgetStandup(c, next.phase !== "gone");
  card = { ...card, ...next, sticky: true };
  render(); holdThenClose(CLOSE_AFTER_MS);
}

/**
 * The rollup card, for a team lead: "Design standup: 4 of 6 posted", the day, the blockers people named in their own posted
 * words (who, on whom, what; at most four, then "and 2 more"), who has no update as one plain grey line of names (one
 * neutral list: never a reason, never a warning colour, never a chase), who posted after the cutoff, Open and OK.
 */
function rollupView() {
  const c = card, r = c.w, k = r.content, m = moodOf();
  const named = (p) => !!p && typeof p === "object" && typeof p.name === "string" && !!p.name.trim();
  const blockers = (Array.isArray(k.blockers) ? k.blockers : []).filter((b) => named(b) && !!str(b.text).trim());
  const quiet = (Array.isArray(k.noUpdate) ? k.noUpdate : []).filter(named);
  const late = (Array.isArray(k.late) ? k.late : []).filter(named);
  const more = blockers.length - ROLLUP_BLOCKERS;
  const rows = (more > 0 ? blockers.slice(0, ROLLUP_BLOCKERS) : blockers).map((b) => {
    const who = `${b.name.trim()}${str(b.onName).trim() ? ` on ${str(b.onName).trim()}` : ""}`;
    const text = str(b.text).trim();
    return `<li class="wrap"><span class="t" title="${esc(`${who}: ${text}`)}"><span class="who">${esc(who)}</span>: ${esc(text)}</span></li>`;
  }).join("");
  const day = str(r.dateLabel).trim() || str(k.dateLabel).trim();
  const open = boredroomPath(r.href);
  return `<div class="row top fade">${face(m)}<div class="grow"><p class="title wrap">${esc(rollupTitle(r))}</p>${day ? `<p class="sub">${esc(day)}</p>` : ""}</div></div>
    ${rows ? `<div class="change fade"><p class="lbl" id="rblk">${STANDUP_SAY.blocked}</p><ul class="list lines" aria-labelledby="rblk">${rows}${more > 0 ? `<li class="more"><span class="t">${esc(STANDUP_SAY.more(more))}</span></li>` : ""}</ul></div>` : ""}
    ${quiet.length ? `<div class="change fade"><p class="lbl" id="rnone">${STANDUP_SAY.noUpdate}</p><ul class="names" aria-labelledby="rnone">${quiet.map((p) => `<li>${esc(p.name.trim())}</li>`).join("")}</ul></div>` : ""}
    ${late.length ? `<p class="cap fade">${esc(STANDUP_SAY.late(timeOf(k.cutoffAt) || "the rollup", late.map((p) => p.name.trim()).join(", ")))}</p>` : ""}
    <div class="actions">${open ? `<button class="btn" data-act="open-href" data-href="${esc(open)}">Open${icon("open")}</button>` : ""}${c.n ? `<button class="btn primary" data-act="read" data-id="${esc(c.n.id)}">OK</button>` : `<button class="btn primary" data-act="close">OK</button>`}</div>`;
}

// ---- poking and admiring Brenda -----------------------------------------------------------------------------------
// A click on her face in an open card squashes her and she looks cross for a moment; three in under 1.7 seconds make
// her dizzy for three; resting the pointer on her for 1.9 seconds gives her heart eyes (Coucou's rules).

function applyFx() {
  for (const f of el.querySelectorAll(".face:not(.mini)")) {
    f.classList.remove("squash", "dizzy", "love");
    if (fx) { void f.offsetWidth; f.classList.add(fx); }
  }
}
function setFx(name, ms) {
  fx = name; applyFx();
  clearTimeout(fxTimer);
  fxTimer = setTimeout(() => { fx = null; applyFx(); }, ms);
}
function poke() {
  const now = Date.now();
  pokes.push(now);
  while (pokes.length && now - pokes[0] > 1700) pokes.shift();
  if (pokes.length >= 3) { pokes.length = 0; setFx("dizzy", 3000); return Sound.play("dizzy"); }
  if (fx !== "dizzy") { setFx("squash", 800); Sound.play("poke"); }
}
function watchAdmiration() {
  const f = card ? el.querySelector(".face:not(.mini):not(.small)") : null;
  clearTimeout(loveTimer);
  if (!f || !cursor || fx) return;
  const r = f.getBoundingClientRect();
  if (cursor.x < r.left || cursor.x > r.right || cursor.y < r.top || cursor.y > r.bottom) return;
  loveTimer = setTimeout(() => { setFx("love", 2600); Sound.play("love"); }, 1900);
}

// ---- Brenda's face ----------------------------------------------------------------------------------------------
// Her eyes follow the cursor with a lag (tanh of the distance, eased each frame, as in Coucou's engine), she blinks
// every 2.2 to 5.4 seconds (twice in a row about one time in five), and the frame loop stops once her eyes settle.
// While the person types to her (owner decision, 7 October 2026) she reads along instead: her eyes go to the ask box
// and follow the caret, more keenly than they follow the pointer, until the box loses focus. A follow-up's note is read
// the same way, by the face on its card (phase 4, 8 October 2026).

const look = { x: 0, y: 0 };
let lookFrame = null;
let measure = null;         // a canvas context for measuring the typed words in the box's own font

/** Where the caret sits in the ask box, in window coordinates. */
function caretAt(input) {
  const r = input.getBoundingClientRect();
  const cs = getComputedStyle(input);
  measure ??= document.createElement("canvas").getContext("2d");
  const left = r.left + (parseFloat(cs.paddingLeft) || 0), right = r.right - (parseFloat(cs.paddingRight) || 0);
  let x = left;
  if (measure) {
    measure.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    x = left + measure.measureText(input.value.slice(0, input.selectionEnd ?? input.value.length)).width - input.scrollLeft;
  }
  return { x: Math.max(left, Math.min(right, x)), y: r.top + r.height / 2 };
}
function readAlong(e) {
  if (!TYPING.has(e.target?.id)) return;
  gaze = caretAt(e.target);
  stepFace();
}
for (const type of ["focusin", "input", "keyup", "pointerup", "select"]) el.addEventListener(type, readAlong);
el.addEventListener("focusout", (e) => { if (TYPING.has(e.target?.id)) { gaze = null; stepFace(); } });

function stepFace() {
  if (lookFrame) return;
  lookFrame = requestAnimationFrame(() => {
    lookFrame = null;
    const faces = el.querySelectorAll(".face");
    const at = gaze ?? cursor;
    if (!faces.length || !at) return;
    const r = faces[0].getBoundingClientRect();
    const tx = Math.tanh((at.x - (r.left + r.width / 2)) / (gaze ? 150 : 260));
    const ty = Math.tanh((at.y - (r.top + r.height / 2)) / (gaze ? 70 : 200));
    look.x += (tx - look.x) * 0.2;
    look.y += (ty - look.y) * 0.2;
    // Faces with a fixed look (Together: the two look at each other; 9 October 2026) keep it.
    for (const f of faces) { if (f.dataset.look) continue; f.style.setProperty("--lx", look.x.toFixed(3)); f.style.setProperty("--ly", look.y.toFixed(3)); }
    if (Math.abs(tx - look.x) > 0.003 || Math.abs(ty - look.y) > 0.003) stepFace();
  });
}

function blink(twice) {
  for (const f of el.querySelectorAll(".face")) f.classList.add("blink");
  setTimeout(() => {
    for (const f of el.querySelectorAll(".face")) f.classList.remove("blink");
    if (twice) setTimeout(() => blink(false), 160);
  }, 130);
}
(function blinkLoop() { setTimeout(() => { blink(Math.random() < 0.22); blinkLoop(); }, 2200 + Math.random() * 3200); })();

listen("brenda://cursor", ({ payload }) => {
  // Back after five minutes away (owner decision, 9 October 2026): what arrived meanwhile opens on this first movement.
  const back = Notify.away(lastMoveAt, Date.now()) && nq.held.size > 0;
  cursor = payload;
  lastMoveAt = Date.now(); // the person is at the computer (the morning opener waits for that, phase 7a)
  // The morning opener first when it is due (review, 9 October 2026): what waited then opens at a later poll.
  if (back && !maybeBriefing()) arrive();
  const r = island.getBoundingClientRect();
  // Tucked away, the menu bar around the notch wakes it (anywhere in its height); otherwise the island itself.
  setHover(tucked
    ? payload.y >= 0 && payload.y <= COMPACT.h + 4 && Math.abs(payload.x - window.innerWidth / 2) <= 140
    : payload.x >= r.left && payload.x <= r.right && payload.y >= r.top && payload.y <= r.bottom + 4);
  stepFace();
  watchAdmiration();
});
listen("brenda://sounds", ({ payload }) => { Sound.setEnabled(payload); if (payload) Sound.play("tick"); });
listen("brenda://always-visible", ({ payload }) => { alwaysVisible = !!payload; updateTuck(); });
// Inter can arrive just after a card is drawn (font-display: swap): the island measures its content again when it does.
document.fonts?.addEventListener?.("loadingdone", () => { if (config) fit(); });

// The running timer in the compact bar and the timer card, and the timer card's estimate hairline.
setInterval(() => {
  if (!data?.timer) return;
  const c = document.getElementById("tclock"); if (c) c.textContent = hms(elapsed());
  const e = document.getElementById("testimate"), share = estimateShare(); if (e && share !== null) e.style.transform = `scaleX(${share.toFixed(3)})`;
}, 1000);

listen("brenda://signed-out", () => { config = { ...config, signedIn: false }; data = null; card = null; talk = []; chat = newChat(); cached = null; talkWaiting = false; clearTimeout(talkWaitTimer); forgetNotices(); applyQuiet(); render(); });

(async () => {
  config = await invoke("get_config");
  // Sitting in the menu bar, the compact bar is exactly as tall as it (24 to 40 px).
  const bar = await invoke("menu_bar_height").catch(() => 0);
  if (bar > 0) COMPACT.h = Math.round(Math.min(40, Math.max(24, bar)));
  document.documentElement.style.setProperty("--compact-h", `${COMPACT.h}px`);
  Sound.setEnabled(config.sounds !== false);
  alwaysVisible = !!config.alwaysVisible;
  voice = await invoke("voice_status");
  if (config.signedIn) start(); else render();
})();
