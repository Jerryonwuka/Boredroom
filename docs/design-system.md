# Boredroom design system, version 2

The look the landing page arrived at on 23 and 24 September 2026, made into the system for the whole product. It is modelled on resend.com: true black, white and grey type, hairline borders, solid dark cards with a top highlight, one orange, 3D glass icons, and motion that answers something. `src/app/globals.css` holds the values; `src/components/ui/` holds the parts; `.claude/skills/boredroom-ui/SKILL.md` makes them the rule. Version 1 (dark greys, glow tiles, tracked-caps eyebrows) is superseded.

## Foundations

### Colour

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#000000` | The canvas. True black, never a tinted near-black. |
| `--bg-elevated` | `#121212` | Cards, through `.tile` (a `#151515` to `#0f0f0f` gradient). |
| `--bg-surface` | `#181818` | Small surfaces inside a card (`.panel`). |
| `--bg-popover` | `#1a1a1a` | Menus and dialogs. |
| `--bg-inset` | `#0a0a0a` | Inputs: darker than their surroundings because they receive content. |
| `--border-soft` / `--border` / `--border-strong` | white at 7% / 12% / 18% | Hairlines. Emphasis comes from space and weight before lines. |
| `--fg` / `--fg-muted` / `--fg-subtle` / `--fg-faint` | `#fff` / `#a1a1a1` / `#6b6b6b` / `#4a4a4a` | Four text tiers: primary, secondary, metadata, disabled. |
| `--accent` / `--accent-hover` / `--accent-fg` | `#ff6c02` / `#ff8226` / `#140700` | The one orange. On the live thing, the primary action, the active nav icon, a verdict that needs eyes. About 10% of any screen. |
| `--success` `--warning` `--danger` `--info` | green, amber, red, blue, slightly desaturated | Status only. Never decoration. |

Sidebar and mobile header sit on `--sidebar` (`#050505`), one step off the canvas, so the content column reads as the page.

Surfaces bind to tokens too, so a theme changes values and nothing else: `--surface-top/-bottom` (the `.tile` gradient), `--surface-hover-*`, `--btn-*` and `--btn-hover-*` (the button gradient), `--avatar-*`, four washes (`--wash-soft`, `--wash`, `--wash-strong`, `--wash-active`, white at 3/5/8/10% in dark, black at 2.5/4/6/8% in light; utilities `bg-wash-*`), `--highlight` (the 1px top highlight inside surfaces), `--overlay` (dialog backdrops) and `--media` (video letterboxing, black in both themes). Never write `bg-white/10` or a hex in a component; pick the token.

### Light theme

`:root[data-theme="light"]` restates the same tokens on paper white: canvas `#f4f4f2`, cards white, inputs `#f1f1ef`, hairlines black at 6/10/18%, text `#111` / `#5a5a5a` / `#8a8a8a` / `#b4b4b4`. Orange is unchanged; the four status colours darken (`#178f5d`, `#a86d0f`, `#d23c3c`, `#2b6cd9`) so they keep contrast on white. The `dark:` variant follows `data-theme`, not the operating system, so vendored components switch with the page. Dark is the default; the choice is stored in `localStorage` under `boredroom-theme`, applied by an inline script in the root layout before first paint, and changed with `ThemeToggle` (a sun or moon `IconButton`), which sits in the workspace top bar, the landing header, the auth pages and the workspace picker.

### Type

Cal Sans for display (headings, verdicts, the clock), Manrope for everything else. Sentence case everywhere. No tracked capitals except the 11px label on a stat card, which is the one place a label needs to recede below its verdict.

| Role | Size and weight |
| --- | --- |
| Page title | Cal Sans 30/38px, tracking -0.02em |
| Section title in a page | Cal Sans 18 to 22px |
| Verdict (stat card) | Cal Sans 28px |
| Clock | Cal Sans 48 to 96px, tabular, the accent when running |
| Body | Manrope 15 to 16px, line height 1.5 |
| Card text | Manrope 14 to 15px, `--fg-muted`, line height 1.6 |
| Metadata | Manrope 12 to 13px, `--fg-subtle` |

Headings use `text-wrap: balance`, paragraphs `text-wrap: pretty`, numbers `tabular-nums`.

### Surfaces

| Class | What it is |
| --- | --- |
| `.tile` | A card: dark gradient, hairline, inset top highlight, a soft shadow beneath. `tile-link` lifts 1px and brightens on hover. `tile-active` marks the one live row with an accent edge. `tile-glow` is reserved for the running session and page headers. |
| `.chip` | A row, chip, input strip or pill inside a card: 5% white wash and a 10% hairline. `chip-link` brightens on hover. |
| `.panel` | An inner panel on `--bg-surface`, 12px radius. |
| `.icon-tile` | The lit square that holds a 3D icon, with an orange glow beneath it. |
| `.hairline-grid` / `.hairline-cell` | Cells split by 1px lines drawn from the gap, one rounded border round the set. Hover tints the cell, lifts and tilts the icon, warms the title. |

No glass. Backdrop blur was tried on 24 September and removed by owner decision; the sticky landing header is the only element that keeps one.

### Radius, spacing, depth

Radius: 10px small controls and rows, 16px buttons and cards, 24px hairline grids and dialogs, pills for tabs and badges. Nested radius equals the outer minus the padding.
Spacing on a 4px base: 12 to 20px inside components, 24 to 32px between blocks, 96 to 144px between landing sections.
Depth is borders plus the card highlight and one soft shadow. No drop shadows on controls, no gradient washes as decoration.

### Motion

`motion` (the Framer engine) through the primitives in `src/components/ui/motion.tsx`; landing reveals in `src/components/landing/reveal.tsx`.

- One entrance per page: `PageRise` lifts the main column's children 6px with a 40ms stagger. Landing sections use `Reveal`, the blur-to-sharp rise, once each.
- Everything else answers an action: `Presence` for notices, `Expand` for panels, `AnimatedList` for rows that leave, `Swap` for the clock's faces, `SlidingMarker` for the nav pill and tabs.
- No control animates on its own; buttons only respond to hover and press.
- Hover is a hint: cards lift 1px, rows brighten, hairline cells lift their icon. Budget 120 to 350ms, transform and opacity, `--ease-out`.
- `prefers-reduced-motion` stops the marquees, aurora and icon transitions, and `MotionConfig` drops movement.

### Icons

Two sets with two jobs. The 3D orange-glass set in `public/icons/` (typed in `ICON_3D`, rendered by `Icon3D` and `IconTile`) marks places: a page header, a section opener, an empty state, a feature card. The lucide line set marks controls: nav items, buttons, table actions. Never a 3D icon inside a button or a table row.

| Name | Meaning |
| --- | --- |
| `day-checklist` | My Day, to-dos, planning |
| `stopwatch` | Timer, sessions, time |
| `clock-in` / `clock-out` | Clocking |
| `calendar-clock` | Attendance, schedule, retention |
| `eye-dashboard` | Workroom, dashboard |
| `eye-checklist` | Reviews, playback |
| `card-check` | Tasks, done |
| `doc-link-check` / `box-doc-check` | Submissions and links / deliverables and uploads |
| `chat` | Messages |
| `people` | Teams and people |
| `person-laptop` | A staff member |
| `screen-record` / `video-people` | Recording / recordings and meetings |
| `shield-check` | Policy, fairness, approvals, permission |
| `flag-alert` | Blocked, flagged |
| `chart-ring` | Reports |
| `focus-target` | Focus, everything in view |
| `desk` | Workspace, organisation |

## Components (`src/components/ui/`)

| Component | Use |
| --- | --- |
| `Button` | One surface for every button (`.btn`): a dark fill one step above the card, a hairline, a top highlight, 16px corners (10px at the small size), white text. `primary` adds an orange hairline and fills orange with a soft glow on hover, `outline` and `subtle` are the plain surface, `ghost` is text only, `danger` reads red. Nothing animates on its own. Sizes sm 36, md 44, lg 56, icon 40. |
| `Card`, `CardHeader` | A `.tile` with 20px padding; header with title, one-line description, an action. |
| `PageHeader` | Optional 3D `icon` in a tile, title, description, actions, back link. |
| `StatCard` | The verdict card: label, verdict word or figure, rows of dot, label, count, share. Three across the top of a page. |
| `Ledger` | A strip of display figures when there is no verdict to give. |
| `Badge` | Status pills; `TASK_STATUS_TONE`, `SESSION_STATE_TONE`, `REPORT_STATUS_TONE` map states to tones. A pill is always one line (`whitespace-nowrap`), as is every chip and tab; a table cell that holds only a badge, a figure or a time does not wrap either. |
| `DataTable` | Hairline table inside a tile; quiet 12px header, 13px dividers, hover tint. |
| `Tabs` | Pill tabs with a sliding active pill; link tabs by URL or value tabs by state; counts in small pills. |
| `HairlineGrid`, `GridCell` | Equal things in a hairline grid with a 3D icon each. |
| `AreaChart`, `BarChart`, `Donut`, `SegmentBar`, `Legend` (`ui/charts`) | Dependency-free SVG charts for the Control Center (owner decision, 25 September 2026: graphs before number tiles). Lines and bars in the accent, other series in info/success/warning, hairline gridlines, 11px subtle axis labels, a shared legend row of dot, label, value, share. Every chart carries a title for screen readers and a quiet "nothing yet" state when all values are zero. Server-rendered; no hover state beyond native tooltips. |
| `Input`, `Select`, `Textarea`, `Label`, `Field` | Every control is a `.field` (globals.css, owner decision 25 September 2026): 40px, 10px corners, inset with a 1px inner shadow and the same top highlight the search bar and buttons carry, hairline brightens on hover, a soft grey ring on focus (no orange, no glow), custom chevron on selects, accent on native pickers. `.field-sm` is the 36px pill for filter bars (`inputCls` in `components/admin/fields.tsx`; filter bars sit on a `.chip` strip). Checkboxes and radios are drawn globally: 18px, inset, orange when checked. A bare `<input>` anywhere takes `className="field"`; never restyle one by hand. `Field` links errors to controls. |
| `EmptyState`, `ErrorState`, `PermissionDenied`, `OfflineState`, `Alert`, `Skeleton` | Every empty state names one next action and may carry a 3D icon (`icon3d`). |
| `ConfirmDialog`, `ConfirmButton` | Native `<dialog>` for every destructive or irreversible action. |
| `Icon3D`, `IconTile` | The 3D icon set, bare or in its lit tile. |
| `Eyebrow` (`.eyebrow`) | Micro information: dates, sync times, zones, section labels, engine notes. 11px, semibold, spaced 0.08em, uppercase, `--fg-subtle`. Never body-sized. `Overline` is the accent version above a page title; `PageHeader meta=` sets one under the description. |
| `VoicePoweredOrb` | The dictation orb (OGL shader, orange by default): shown while the microphone is open in the assistant and the My Day panel; it turns and ripples with the voice. Opens its own microphone; nothing is recorded. |
| `Sidebar` (`components/app`) | Expanded: the list with the sliding pill. Collapsed: a dock of 44px icon tiles that lift and scale on hover, each with its label beside it. The state lives on `<html data-sidebar>` and in `localStorage` (`boredroom-sidebar`), applied before first paint. Icons everywhere lift a pixel on hover, as in the dock reference in `ui/dock.tsx`. |
| `TopBar` search and assistant | The gooey search input (Aceternity) opens to 260px and lists pages at once, then tasks, people, projects and teams from `/api/orgs/:org/search`. The sparkle opens the assistant drawer (`AssistantDrawer`): a side panel to ask for anything; with Claude connected the assistant does the work and replies list what it did as green check lines (with Open links); the built-in helper offers buttons instead. |
| `PresenceDot`, `PresenceLabel`, `Avatar presence=` | Work status: active (live green, a ring that swells and fades), away (amber), do not disturb (red), offline (grey). The dot sits on the avatar's bottom-right edge with a ring in the surface colour. Set from the top-bar profile panel or the profile page (`PresencePicker`). |
| `MessageBubble`, `TypingIndicator` (`ui/chat-messages`) | Chat bubbles: the person's own on the right in a dark shade of the orange (`--bubble-mine`, `#3d2412`, with an orange hairline) and white text; other people's on the left in grey (`--bubble-theirs`, `#1f1f1f`) with the avatar beside the last bubble of a run. Light theme: pale orange and light grey. Runs within five minutes group. Withdrawn is a dashed empty bubble. |
| `PromptInputBox` (`ui/ai-prompt-box`) | The assistant's composer: a 22px-rounded surface with a growing textarea, a microphone that hands over to dictation (the orb appears above), and a round send button that turns orange when there is text. Tooltips from Radix. |
| Message toasts (`app/message-toasts`, sonner) | Bottom left: the sender's picture, "New message from …", two lines of the message, Reply and Later. Never for the thread on screen. Follows the theme. |
| `VoiceNote` (`components/app`) | A voice note in a bubble: an orange play button, a thin progress bar that seeks, the time. The composer records one with the microphone button: the orb, a timer, Cancel or Send. |
| `IconButton`, `ThemeToggle` | The round 40px icon button on the button surface; the toggle flips `data-theme` and remembers it. |
| `Avatar` | A person: their picture from `/api/avatars/:id`, else initials on a dark disc. 32px in lists, 38px in the top bar, 96px on the profile page. |
| `TopBar` (`components/app`) | The top-right cluster on every workspace page: round 40px icon buttons for notifications (unread count in an orange pill), settings (organisation accounts) and the person. Each opens a `.tile` panel below it; one open at a time. Notifications and settings live here, not in the sidebar. |
| Motion primitives | `MotionRoot`, `PageRise`, `Rise`, `Presence`, `Expand`, `AnimatedList`, `AnimatedRow`, `Swap`, `SlidingMarker`. |

Aceternity pieces (`src/components/aceternity/`, vendored) that belong to the system: `moving-border` (through `LitTile`, the travelling light on a feature card), `flip-words`, `typewriter-effect`, `container-scroll-animation`, `background-ripple-effect`, `3d-card` and `glowing-effect` (through `GlassCard`, landing only, tilt kept subtle). The rest of the pack is available but not part of the system until a screen needs it.

## The frame

The sidebar is sticky and the full viewport tall; its list scrolls inside it, so every page is one click away without scrolling. The top bar is a 64px rectangle on the sidebar surface, sticky, with the workspace name on the left and search, theme, notifications, settings and the person on the right. The assistant is a floating orange-ringed sparkle bottom right on every page (`AssistantDrawer floating`). Messages is a `bleed` page: it fills the area under the top bar with the conversation list on the left and the thread on the right, and the page itself does not scroll.

## Email

One template for every email (`src/server/lib/emails.ts`, `renderEmail`): the black canvas, the wordmark, a 560px card (`#121212`, 1px `#2a2a2a`, 20px corners) with an orange eyebrow, a 28px display title, 16px grey body (`#a1a1a1`), one orange button (`#ff6c02` on `#140700`, 14px corners) with the link repeated beneath it, an inset facts table (label as eyebrow, value in white), a subtle note and a footer with the reason. Tables and inline styles only; no CSS variables, no images that need the app's origin. Every email has a plain-text twin. Add a new email as a builder in that file and preview it on `/dev/emails`.

## Control Center

The internal console at `/admin` is the same system on the same tokens: a fixed sidebar of sections grouped by purpose (Overview, Money, Product, Growth, Platform), a 64px top bar with global search and the launch state as a badge, and pages built from `PageHeader`, `StatCard`, `Ledger`, `DataTable`, `Tabs` and `Card`. Filters are a row of small labelled controls with one Apply button; lists page server-side; every mutation is an `AdminAction` (a button, a confirmation dialog for anything that changes a tenant, and a reason field for anything audited) or a `JsonForm`. Nothing in the console is a ranking of people or organisations; health profiles read as operational facts.

## Page anatomy

1. `PageHeader` with the page's 3D icon, title and one line. Actions on the right: one primary at most.
2. If the page has figures, three `StatCard`s, or a `Ledger` when nothing is a verdict.
3. The focal block: the room (Workroom), the day (My Day), the list (Tasks), the two switches (Settings).
4. Supporting blocks as `Card`s or a `HairlineGrid`, then tables.
5. Empty states in place of blocks, never a blank.

Focal point per screen: My Day is the clock; Team board is the task list; Dashboard is who is working now; Settings is the two switches at the top.

## Copy

Sentence case. Plain verbs on buttons that say what happens (Save changes, Send invitation, Clock in). Meta text reads as prose: commas, not middle dots; no arrows after links; no monospace for data. Errors say what went wrong and what to do. Empty states invite one action.

## Accessibility floor

Every control has a name. Toggles carry `aria-expanded` and `aria-controls`. Errors are linked to their field. Everything is keyboard reachable: buttons and links show a quiet grey ring when focus arrives from the keyboard, never from a click, and text fields only brighten their hairline (owner decision, 24 September 2026: no orange focus rectangles anywhere). Colour never carries meaning alone: a badge has a word, a dot has a label. Body text 15px or larger, 4.5:1 or better on black.

## Landing page

The landing page (`src/app/page.tsx`, `src/components/landing/`) is where the system came from and still carries its own `.lp-*` classes for the marketing-only pieces (hero grid, marquees, aurora). Its cards, buttons and icon tiles now share the product values (`--card-shadow`, the shimmer, the icon tile); the aliases will fold into the shared classes as screens are rebuilt.
