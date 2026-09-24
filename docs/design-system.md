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

Sidebar and mobile header sit on `#050505`, one step off the canvas, so the content column reads as the page.

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
| `Badge` | Status pills; `TASK_STATUS_TONE`, `SESSION_STATE_TONE`, `REPORT_STATUS_TONE` map states to tones. |
| `DataTable` | Hairline table inside a tile; quiet 12px header, 13px dividers, hover tint. |
| `Tabs` | Pill tabs with a sliding active pill; link tabs by URL or value tabs by state; counts in small pills. |
| `HairlineGrid`, `GridCell` | Equal things in a hairline grid with a 3D icon each. |
| `Input`, `Select`, `Textarea`, `Label`, `Field` | Inset controls with an accent ring on focus; `Field` links errors to controls. |
| `EmptyState`, `ErrorState`, `PermissionDenied`, `OfflineState`, `Alert`, `Skeleton` | Every empty state names one next action and may carry a 3D icon (`icon3d`). |
| `ConfirmDialog`, `ConfirmButton` | Native `<dialog>` for every destructive or irreversible action. |
| `Icon3D`, `IconTile` | The 3D icon set, bare or in its lit tile. |
| Motion primitives | `MotionRoot`, `PageRise`, `Rise`, `Presence`, `Expand`, `AnimatedList`, `AnimatedRow`, `Swap`, `SlidingMarker`. |

Aceternity pieces (`src/components/aceternity/`, vendored) that belong to the system: `moving-border` (through `LitTile`, the travelling light on a feature card), `flip-words`, `typewriter-effect`, `container-scroll-animation`, `background-ripple-effect`, `3d-card` and `glowing-effect` (through `GlassCard`, landing only, tilt kept subtle). The rest of the pack is available but not part of the system until a screen needs it.

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

Every control has a name. Toggles carry `aria-expanded` and `aria-controls`. Errors are linked to their field. Everything is keyboard reachable with a visible ring. Colour never carries meaning alone: a badge has a word, a dot has a label. Body text 15px or larger, 4.5:1 or better on black.

## Landing page

The landing page (`src/app/page.tsx`, `src/components/landing/`) is where the system came from and still carries its own `.lp-*` classes for the marketing-only pieces (hero grid, marquees, aurora). Its cards, buttons and icon tiles now share the product values (`--card-shadow`, the shimmer, the icon tile); the aliases will fold into the shared classes as screens are rebuilt.
