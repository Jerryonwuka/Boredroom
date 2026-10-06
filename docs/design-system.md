# Boredroom design system, version 4

Owner decision, 6 October 2026: "Study ElevenLabs' dashboard deeply … replicate the design style, spacing, alignment, text formatting, use of numbers, button styles, design layout, text sizes and styles … ignore the current design system totally." And: "Keep orange as our accent colour." v4 is the ElevenLabs app's design language, measured from the live app with computed styles, with Boredroom orange wherever they use their blue. We copy the language (tokens, proportions, behaviours), never their brand (no logo, no Waldenburg files, no images, no copy).

- Values: `src/app/globals.css` (source of truth). Parts: `src/components/ui/`. Every part in every state, dark and light: **`/dev/design`** (development only), with a sample app frame in `src/app/dev/design/app-frame.tsx`.
- Where this document and an older comment disagree, this document and `globals.css` win. Versions 1 to 3 (glow tiles, solid dark cards, the "Digital" aurora and gradient) are retired.

## Principles

1. **Monochrome.** Near-black canvas, white text, greys made of white at low alpha. Hierarchy comes from colour (100% / 64% / 53% white), not size.
2. **Hairlines, not shadows.** Every edge is 1px of white at 7.5% (`--border`); inputs and outline buttons 10%. Shadows are tiny "natural" stacks you barely see in dark.
3. **Quiet density.** Interface text is Inter 14/20 medium. Page titles use the display face.
4. **Primary = solid white with near-black text** (inverted in light). Secondary = outline. Tertiary = ghost.
5. **Orange marks what is live, active, chosen or the one thing to do, never decoration** (the accent rules below, owner decision 6 October 2026: "it looks too monochromatic, let's add nice accents of orange"). A typical screen carries 3 to 6 small touches. Status colours (green, amber, red) keep their meaning on small dots, badges and status charts.
6. **No** gradients, glass, glow, aurora, text gradients, tracked uppercase labels or middle-dot meta lines. The one blur is the top bar (canvas at 90% + blur 8px). The one measured gradient is the barely visible fill on a tool-tile square. **One owner-approved exception:** Brenda's home panel and the orb she floats in carry an orange glow (owner decision, 7 October 2026; see "Brenda's home panel" below). Nowhere else.
7. **Fast, calm motion:** colours 75ms; tabs, menus, tooltips 150–200ms; sheets 300ms ease-out. Nothing bounces or scales on press. `prefers-reduced-motion` turns movement off.

## Tokens

Themes live on `[data-theme]` (`html` carries it; any element can nest the other theme). Tailwind utilities exist for every colour: `bg-background`, `text-secondary`, `border-border`, `bg-fill-1`, `text-accent`…

| Token | Dark | Light | Use |
|---|---|---|---|
| `--background` | `#0F0F10` | `#FFFFFF` | Canvas, cards, outline buttons, dialogs |
| `--sidebar` | `#171717` | `#FAFAFA` | Sidebar panel |
| `--foreground` | `#FFFFFF` | `#0F0F10` | Text, primary fill |
| `--secondary` | white 64% | black 53% | Nav items, descriptions, icons, table headers |
| `--subtle` | white 53% | black 44% | Placeholders, metric and control labels |
| `--faint` | white 32% | black 25% | Disabled text |
| `--border` | white 7.5% | black 7.5% | Every hairline (a bare `border` draws it) |
| `--border-input` / `-hover` | white 10% / 16% | black 10% / 16% | Inputs, outline buttons |
| `--fill-0` / `--fill-075` / `--fill-1` / `--fill-150` | white 2.4 / 3 / 4.3 / 7% | black 2 / 3 / 4.3 / 6% | Section cards and metric cells / count pill / hover, active nav, badges / pressed |
| `--surface` | fill-1 over the canvas, solid | same | Anything that must not let content through (docked composers) |
| `--popover` | `#2E2E2E` | `#FFFFFF` + shadow | Menus, popovers |
| `--toast` | `hsl(0 0% 23% / .85)` | `#FFFFFF` | Toasts, tooltips |
| `--overlay` | `#3B3B3B` at 30% | ink at 20% | Behind dialogs; never blurred |
| `--primary` / `-hover` / `-fg` | white / `#CFCFCF` / `#0F0F10` | `#0F0F10` / `#2E2E2E` / white | The primary button |
| `--accent` / `-hover` | `#FF6C02` / `#FF7F24` | `#F25F00` / `#DB5600` | Orange FILLS and MARKS: the accent button, checked boxes, markers, underlines, progress, live dots (`bg-accent`, `text-accent` on icons) |
| `--accent-fg` | `#0F0F10` | `#0F0F10` | Text on orange (white on orange fails contrast) |
| `--accent-soft` / `--accent-text` | `#4A1F04` / `#FF9A4D` | `#FFE9D9` / `#B54400` | Tinted fill with its text: "New" and attention badges and counts. `text-accent-text` is THE orange for text (timer digits, "today"): it passes AA on the canvas in both themes, `text-accent` does not in light |
| `--accent-tint` | orange 10% | orange 8% | Accent-tinted notice card and the empty-state icon square (with a hairline) |
| `--accent-ring` | orange 60% | orange 55% | A 1px orange ring: the focused prompt pill (`shadow-[0_0_0_1px_var(--accent-ring)]`) |
| `--ring` | orange 50% | orange 50% | Focus ring: 2px, offset 2px, keyboard only |
| `--success` `--warning` `--danger` | `hsl(142 71% 45%)` `hsl(38 92% 50%)` `hsl(0 84% 60%)` | darker for contrast | Status only; soft fills 10–15% |
| `--info` | `#A3A3A3` | `#6B6B6B` | No blue in v4: "info" is a neutral grey |
| `--gray-75/100/150/600` | `#212121 #2E2E2E #3B3B3B #A3A3A3` | light equivalents | Utilities are **`grey-*`** (`bg-grey-100`), so Tailwind's own `gray-*` stays intact |

Layout tokens: `--header-height: 50px`, `--sidebar-width: 16rem`, `--sidebar-width-collapsed: 3.5rem`, `--page-x: 20px`, `--sheet-width: 512px`. Elevation: `shadow-natural-xs`, `shadow-chart`, `shadow-sheet`, `shadow-toast` (variables `--elev-*`). Motion: `--duration-fast` 75ms, `--duration` 150ms, `--duration-menu` 180ms, `--duration-sheet` 300ms, `--ease-out`. Z-index: `--z-raised` 10 → `--z-toast` 60.

## Accent rules (owner decision, 6 October 2026)

"It looks too monochromatic, let's add nice accents of orange on places that make the design more interesting." Orange (`--accent`; text on orange is near-black) marks what is **live, active, chosen or the one thing to do. Never decoration.** Apply these consistently and no more:

| Rule | Where | Use |
|---|---|---|
| **Navigation** | The active sidebar item's icon is orange (label foreground, fill-1 stays). Active underline tabs have an orange 1.5px underline (label foreground); so does the chosen metric in an analytics card. Unread/attention counts in the nav are orange pills. | Sidebar does it; `Tabs` does it; `CountPill tone="attention"`; a tab's count: `{ count, attention: true }` |
| **The standout action** | The one standout action per screen may be orange: Brenda's Send when the box has text, My Day's Start on the next/current to-do, "New document", "Add people", an Upgrade. Every other primary stays white. **Never two orange buttons on one screen.** | `<Button variant="accent">`; on a link `buttonVariants({ variant: "accent" })` |
| **Live and now** | Running timers (dot and digits), recording, Brenda listening/working, "Live" sync lines, the current day/item in charts and calendars. Success stays green, danger red, warning amber: status meaning wins over accent. | `StatusDot tone="live"` (breathes), `LiveIndicator`, digits `font-mono tabular-nums text-accent-text`; `DatePicker` marks today itself |
| **Progress** | Progress bars, arcs and sliders fill in orange (green when done); chart highlight series (today, current, the selected metric) orange, the others grey. | `ProgressBar`, `ProgressArc` (`tone="neutral"` where many would crowd), `Slider`; `BarChart highlight`, `AreaChart` first series, `Sparkline` latest point |
| **Choice and completion** | A checked checkbox is orange with a near-black check (switches stay white); a chosen radio is an orange ring and dot; the chosen segmented option gets an orange dot; the selected list row or sub-nav item gets a 2px orange marker on its left edge; a ticked menu item's tick is orange. | Bare `input[type=checkbox]`/`Checkbox`, `Radio`, `Segmented`, `ListRow active`, `SubNavItem active` or `.subnav-item` + `aria-current`, `.selected-marker` |
| **Brenda** | Her prompt pill's focus ring is orange; Send is orange when there is text; tool tiles' icons turn orange on hover and focus. On her home: the panel's glow and her orb (the approved exception), her glyph in the hero box, its orange-tinted hairline (full orange ring while focused or dictating), the action cards' icons on hover and focus, her orb brighter while she listens. "Past chats", "Back to our conversation", "Brenda settings", the quick-ask chips and the card pills stay neutral. | `PromptInputBox` (`variant="hero"`) and `ToolTile` do it |
| **Links, badges, empty states** | Links in running text: the foreground with an orange underline on hover. "New" badges orange. Empty-state icons sit in a small orange-tinted square. | `.link-inline`; `NewBadge`, `Badge tone="accent"`/`"attention"`; `EmptyState` (errors `tone="danger"`, locked `"neutral"`) |
| **Search** | The search button's keyboard ring, the palette's magnifier while its field has focus, the highlighted result's marker. | `WorkspaceSearch` does it |

**Budget:** a typical screen has 3 to 6 small orange touches. If a screen looks busy with orange, remove the least important (an arc to `tone="neutral"`, a count back to a plain total). **Text** in orange uses `text-accent-text`; **fills and icons** use `bg-accent` / `text-accent`. The gallery's Accents section shows every rule and a sample screen with five touches.

## Type

Inter (variable) for the interface, Geist for display (standing in for ElevenLabs' proprietary Waldenburg, same sizes and tracking), Geist Mono for code, IDs, count chips and timers. Numbers in tables and counts are tabular. Sentence case everywhere.

| Role | Style | Class / utilities |
|---|---|---|
| Home headline | display 28/36 400, −0.21px, centred, balanced | `.type-headline` (`text-3xl font-display`) |
| Page title (h1) | display 24/30 400, −0.15px | `.type-page-title` (h1 default) |
| Section title (h2) | 18/26 600, −0.045px, 14px below | `.type-section-title` (h2 default), `SectionTitle` |
| Dialog / sheet title | 18/26 500 | `.type-dialog-title` |
| Stat value | 24/30 700, −0.15px, tabular | `.type-stat` |
| Metric value | 18/26 500, tabular | `.type-metric` |
| Body, UI, buttons, nav, labels | 14/20 500 | body default, `text-sm font-medium` |
| Paragraphs, descriptions | 14/20 400, secondary | `.type-paragraph` |
| Row subtitle, meta | 13/19.5 400, secondary | `.type-meta`, `text-meta` |
| Metric label | 13/19.5 500, subtle | `.type-metric-label` |
| Caption, badge, control label | 12/16 500, +0.03px | `.type-caption`, `text-xs` |
| Tiny badge | 10/16 600 | `.type-tiny`, `text-2xs` |
| Kbd | 11px 500 in a 20px r6 fill-1 chip | `Kbd`, `.kbd` |
| Code | mono 13.6/19 | `.type-code` |
| Long-form input | 16/24 400 | `text-base` |

## Radius, spacing, elevation

Radius: 6 (mono chip, kbd, small select); 7 (segmented items); 8 (28px buttons, nav links, menu items: `rounded-lg`); 10 (32–36px buttons, inputs, icon buttons: `rounded-control` or `rounded-[10px]`); 12 (40px buttons and inputs, stat cards, menus, tool squares: `rounded-xl`); 16 (chart cards, dialogs: `rounded-2xl`); 24 (section cards: `rounded-3xl`); 26 (prompt pill); full (badges, switches, round prompt actions). Tailwind's scale is kept as it is (`rounded-sm` is Tailwind's 4px, used for the focus outline of inline links); the named steps add `rounded-control` (10), `rounded-card` (16) and `rounded-prompt` (26).

Spacing base 4px. Page sides 20px; top bar 50px; sections 32–48px apart; grid gaps 12px. Card padding: 20 (stat, chart), 24 (section), 16 (tiles, metric cells), 12 (sidebar notice).

## Layout

- **Shell:** fixed sidebar 256px on `--sidebar` with a right hairline, collapsible. Logo row at the top (`<LogoArt height={16} />`; collapsed: `variant="mark"` at 18px). Nav items 32px tall, 4px apart, inset 12px, px8, gap 8, 18px icon in the secondary grey, label 14/20 medium secondary; hover and active: fill-1 + foreground, and the active item's icon orange. Counts (unread messages, reviews waiting) are orange attention pills; collapsed, an orange dot. Section label ("Pinned") 14/20 medium secondary. At the bottom: a `card-tint` notice and the workspace row (32px, 20px avatar).
- **Top bar:** fixed, 50px, from the sidebar's edge; the canvas at 90% with blur(8px) and a bottom hairline; three columns: sidebar toggle + breadcrumb (14/20 medium, secondary, current page foreground, 14px chevrons) | centred search button (32px, ~230px, r12, outline, "Search everything…" 13px + ⌘ K) | small outline buttons, 32px icon buttons (the bell's unread dot is orange), a 32px avatar. Mark it `data-app-topbar` (see Brenda below).
- **Page:** padding-top = header height, sides 20px, full width. `PageHeader`: display title + right-aligned actions, optional description, then underline tabs on a full-width hairline.
- **Brenda's page (home)** (owner decision, 7 October 2026, after a reference AI chat home: "just like this, but instead of the purple gradient let it be our orange"): one panel (r22, hairline) filling the screen under the top bar, 20px from it and from the bottom, with her orange glow. Inside: a top row of 32px round pills (left: her status, a dot, "Brenda", a hairline and the engine, "Connected to Claude" or "Built-in helper"; right: "Back to our conversation" when there is one, "Past chats" and, for owners and HR, "Brenda settings"; label then icon, icon only on phones); centred in the space left, her live character (72px) in the orb (120px), the greeting (14/20 secondary) and the display headline (28/36, 32/40 from sm); anchored to the bottom in a 720px column: her quick asks as chips (h32 round, label then a 14px icon; staff "What's due today?", "Set a reminder", "Start a timer"; leads "Who's working?", "Who's late?", "Assign a task"), the hero box, and three action cards (r16, hairline, translucent fill, p16: a 32px r8 icon square, a h24 fill-1 pill with the card's word, the title 14/20 600, one line 13px secondary; one column under a 576px container). Chips, cards and "More asks" fill the box and put the cursor at its end; they never send. Under the panel, "Your day" (and "Team" for leads) under underline tabs, as before. Her chat: full height, past chats as a left list in sub-nav item style (a sheet on small screens), the hero box docked in its small size.
- **Dashboards:** stat cards, the analytics card with its metric strip, filter controls, tables. **Settings and forms:** sheets, inputs, switches, segmented controls; page headers with tabs for sub-sections.
- Logo: always `<Logo />` / `<LogoArt />` from `src/components/logo.tsx` (the owner's artwork; the single icon is "B." via `variant="mark"`). Never type the wordmark.

## Components (`src/components/ui/`)

| Part | Import | Notes |
|---|---|---|
| `Button`, `buttonVariants` | `button` | variants `primary` `secondary` (=`outline`) `ghost` `subtle` `accent` `danger` `destructive` `link`; sizes `xs` 28, `sm` 32, `md` 36, `lg` 40, `tile` 56, `icon-xs` 28, `icon-sm` 32, `icon` 40, `icon-round` 36; `loading` |
| `IconButton`, `ICON_BUTTON` | `icon-button` | `variant` ghost (32, r10) / outline (40, r12) / round (36); `size` xs/sm/md; needs `aria-label` |
| `Input` `Textarea` `Select` `InputAdorned` `Label` `Field` | `input` | `.field` h36 r10; `fieldSize` xs 24 / sm 32 / md 36 / lg 40; `Field` links `description` and `error` to the control |
| `Switch` `Checkbox` `Radio` | `switch` | Switch 36×20 (bare without children; on = foreground); checkbox/radio 16px, orange when checked |
| `Segmented` | `segmented` | fill-1 r10 p2, items h28 r7; an orange dot on the chosen item (a status tone colours the label instead) |
| `Tabs` | `tabs` | `variant` underline (default, orange underline) / pills (neutral); counts (`attention: true` = orange); arrow keys |
| `Badge` `NewBadge` `CountPill` `MonoChip` `Kbd` | `badge` | Badge tone `accent`/`attention` orange; `CountPill tone="attention"` orange; plus `TASK_STATUS_TONE` (monochrome first), `SESSION_STATE_TONE`, `taskStatusLabel` |
| `Card` `SectionCard` `Panel`/`ChartCard` `CardHeader` `SectionTitle` `Overline` `Eyebrow` `Ledger` `PageHeader` | `card` | Card `variant` panel / section / stat / tint / plain |
| `StatCard` | `stat-card` | `value` (or v3 `verdict`), `icon`, `action`, `hint`, `rows`, `actions`, `href` |
| `AnalyticsCard` `MetricStrip` | `analytics-card` | metrics with server-rendered `content`; or `href` metrics |
| `FilterControl` `FilterSelect` `FilterBar` | `filter-control` | `autoSubmit` for GET forms |
| `ToolTile` `ToolTileRow` `ToolSquare` `QuickLink` | `tool-tile` | Brenda's asks; tiles fill the prompt, never send; icon orange on hover/focus. `ToolTileRow`: equal columns as wide as the widest label (squares evenly spaced), centred; one row when it fits, else a balanced grid of three (two for four tiles, two below 332px); labels up to ~13 characters. `ToolSquare tone="accent"` |
| `ListRow` `SubNavItem` `RowList` `Row` `RowEmpty` | `rows` | 64px rows separated by space; `active` = fill-1 + the 2px orange marker. `SubNavItem`: 32px sub-nav item (`.subnav-item`), `active` = fill-1 + marker, `count` + `attention` |
| `DataTable` | `table` | `table.data`: 36px head, 48px rows, no lines; `fit` |
| `EmptyState` `ErrorState` `PermissionDenied` `OfflineState` `Alert` `Skeleton` | `states` | line icon (`icon`, or a v3 `icon3d` name) in an orange-tinted square; `tone` accent (default) / neutral / warning / danger |
| `Sheet` `Dialog` | `sheet` | right sheet 512px (sm 400, lg 720); centred dialog 440px |
| `ConfirmDialog` `ConfirmButton` | `confirm` | centred r16; destructive = red fill; focus starts on Cancel |
| `Menu` `MenuItem` `MenuSeparator` `MenuLabel` `Popover` | `menu` | popover surface r12 p4; items h32 r8; keyboard |
| Tooltips | `tooltips` (`TooltipLayer`, mounted in the root layout) | the one system: from `aria-label`, or `data-tip`; `data-tip-side="right"` |
| `notify` `successToast` `ToastCard` | `toast` | toast surface, status dot with a 15% halo |
| `Avatar` `PresenceDot` `Person` | `avatar`, `presence`, `person` | solid grey-100 disc |
| `PromptInputBox` `PromptAction` `PromptTextAction` | `ai-prompt-box` | `variant="pill"` (default, the drawer): r26, solid fill-1, round 36px actions; orange 1px ring while focused; Send orange with text, grey when empty; VoiceCapture while dictating. `variant="hero"` (Brenda's page, 7 October 2026): r16, orange-tinted hairline with a faint inner glow, translucent (`.prompt-hero`); `BrendaGlyph` in orange top left; 2–3 lines; bottom row: `leading` as `PromptTextAction` ghost text buttons ("More asks") left, round microphone and Send right (36px). `size="sm"`: the same box docked under her chat, solid `--surface`, one line, 32px actions |
| `DatePicker` `TimePicker` `DurationPicker` | `date-picker` … | `size` xs/sm/md; choice = inverted primary; today in orange text |
| `ProgressArc` `ProgressBar` | `progress-arc` | orange fill, green when done; arc `tone="neutral"` (foreground) where many crowd; bar `doneTone="accent"` when full is not a success |
| `Slider` | `slider` | native range (`.range`): 4px track filled orange to the value, white 16px thumb |
| `StatusDot` `LiveIndicator` | `status-dot` | tones `live` (orange, breathes) / success / warning / danger / neutral; `LiveIndicator` = live dot + orange word |
| `AreaChart` `BarChart` `Donut` `SegmentBar` `Sparkline` `Legend` | `charts` | the highlight series orange, the rest grey (AreaChart: first series; bars: `highlight`, last by default; Sparkline: latest point) |
| `Icon3D` `IconTile` `LINE_ICON` | `icon` | v3 names now draw line icons |
| `HairlineGrid` `GridCell`, `EditButton`, `BackLink`, `AutoSubmitSelect`, motion helpers | … | restyled, same props |

Icons: lucide, 16px in controls, 18px in nav and prompt actions, 20px in tool squares, 24px in quick links; 1.5–2 stroke. No generic AI icons (no Sparkles, Bot, Wand, Stars, Brain): `BrendaGlyph` or `BrendaFace` mean Brenda.

## Brenda's home panel (owner decision, 7 October 2026)

The owner asked for Brenda's tab to look "just like" a reference AI chat home, "but instead of the purple gradient let it be our orange. Our suggestive texts can still be there." This is the **one approved exception** to "no gradients, no glow", recorded here so it does not spread:

- **The panel** (`.brenda-panel`, globals.css §5 "Her home"): layered radial gradients of orange (`#FF6C02`/`#FF3D00` at 5–16%) fading to transparent from the upper middle, over a near-black base (`#0B0B0C`, a step deeper than the canvas); in light, a white panel with a soft peach glow. Text stays the usual tokens and passes contrast.
- **The orb** (`.brenda-orb`, 120px): a glowing orange sphere (a light at the top, a deeper rim) with a soft halo that breathes over 6s; her canvas blends by luminosity inside it, so her mood light takes the orb's orange. Brighter while she listens. Reduced motion stills the halo.
- **The hero box** (`.prompt-hero`): an orange-tinted 1px hairline with a faint orange glow inside, translucent over the panel; full `--accent-ring` while focused or dictating. Its small, docked size is solid.
- Chips, cards and the box's fill (`--brenda-fill`, the canvas at 62%) are translucent only on this panel. The glow tokens (`--brenda-*`) are for this page alone: no other screen, card or banner uses them.

## Brenda contract (kept)

While her chat is open the app's top bar is hidden and her header sits at the top: her page sets `<html data-brenda-chat>`, and `html:has([data-brenda-chat-view])` covers the first paint. globals.css hides any `[data-app-topbar]` (the top bar carries it), zeroes `#main` padding and width cap, and sizes `#workspace-sidebar` to the screen less `--shell-banners`. No animation between her home and the chat. The composer never lets messages show through (the hero box's small size is solid `--surface`). The floating Brenda button and drawer do not appear on her page.

## Legacy classes and tokens (deleted)

Every screen is on v4: the workspace app, the entry screens, the Control Center, the landing page and `/dev/*`. The v3 aliases kept for the last two areas were deleted with their last users on 6 October 2026: the classes `.tile`, `.tile-link`, `.chip`, `.chip-link`, `.panel`, `.btn`, `.glass-panel`, `.sidebar-glass`, `.topbar-glass`, `.eyebrow`, `.eyebrow-accent`, `.link-action`, `.num` and `dialog.sheet`; the tokens `--bg`, `--bg-elevated`, `--bg-inset`, `--border-soft`, `--border-strong`, `--fg*`, `--wash*`, `--highlight`, `--btn-bg`, `--radius-sm`, `--radius` and their utilities (`text-fg-muted`, `border-border-soft`, `bg-wash` …). Do not bring them back: use the tokens and parts above.

`cn()` (`src/lib/utils.ts`) knows the v4 scale: `text-meta` and `text-2xs` are font sizes and the named shadows are shadows, so merging them never drops a colour.

## Desktop notch

The Tauri notch (`desktop/`) follows v4 through its own stylesheet, `desktop/src/style.css`, which copies the dark tokens from `globals.css` (it cannot import the web's CSS), including `--accent-hover`, `--accent-fg` and `--accent-ring`. Change a token in both places. It follows the accent rules too: the running timer's dot (breathing) and digits, Brenda listening ("Mic on") and working, progress bars, teammates' running dots, unread counts and the ask box's focus ring are orange; each card has at most one orange button (`.btn.accent`: Link to Boredroom, Open Boredroom, Start on the briefing, Resume, Turn on voice), and while the ask box has text its Send is the orange one and the card's other orange button turns white. `desktop/preview.html?typed=…` shows that state. Its deliberate differences: the island itself stays true black to meet the screen's notch, buttons are pills, and the compact bar text is 13/16 to fit a 24px menu bar. Its app icon stays as it is until the owner supplies a vector or high-resolution "B." mark.

## Landing page and Control Center

- **Landing page** (`src/app/page.tsx`, `src/components/landing`, owner request 6 October 2026): v4 for marketing. The app's tokens and parts on the same canvas, display type at marketing sizes (`.lp-display`, `.lp-h2`, `.lp-h3`, `.lp-lead`, `.lp-sub`, `.lp-text` in globals.css §6), product views built from `src/components/ui` (Brenda's home in the hero, the dashboard, My Day, messages), a scroll fade-in (`.lp-reveal`, only where scroll-driven animations run and never under reduced motion) and the marquees. Demos only move while on screen and stop under reduced motion. One orange button per section at most (the waitlist's "Join the waitlist").
- **Control Center** (`src/app/admin`, `src/components/admin`): the workspace app's frame. A 256px sidebar with the logo and an "Admin" badge (the active page's icon orange) that collapses to a 56px rail and shares the workspace's collapse setting (`setSidebarCollapsed`/`useSidebarCollapsed` from `components/app/sidebar`); a sheet from the left below md; the 50px top bar with the breadcrumb, a centred search field (⌘K / Ctrl K) and the account menu. Pages use `PageHeader`, `DataTable`, `StatCard`, `AnalyticsCard`; forms open in right sheets and confirm with toasts; confirms are centred dialogs. Three-way flags use `TriState` (green on, red off, no orange dot for "default") so a long flag list carries no orange.

## Accessibility floor

Accessible names on every control (icon buttons need `aria-label`; the tooltip reads it), `aria-expanded`/`aria-controls` on toggles, errors linked to fields, focus visible from the keyboard (orange ring), dialogs on the native `<dialog>`, a word beside every colour (orange never carries meaning alone: a live dot sits beside "Live" or a timer, an attention count is a number, a selected row also has its fill), orange text only as `text-accent-text`, 40px touch targets on small controls (`pointer: coarse`), both themes, 400px wide without sideways scroll, reduced motion respected. Destructive actions go through `ConfirmButton`.
