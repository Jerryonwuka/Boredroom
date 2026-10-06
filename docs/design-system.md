# Boredroom design system, version 4

Owner decision, 6 October 2026: "Study ElevenLabs' dashboard deeply … replicate the design style, spacing, alignment, text formatting, use of numbers, button styles, design layout, text sizes and styles … ignore the current design system totally." And: "Keep orange as our accent colour." v4 is the ElevenLabs app's design language, measured from the live app with computed styles, with Boredroom orange wherever they use their blue. We copy the language (tokens, proportions, behaviours), never their brand (no logo, no Waldenburg files, no images, no copy).

- Values: `src/app/globals.css` (source of truth). Parts: `src/components/ui/`. Every part in every state, dark and light: **`/dev/design`** (development only), with a sample app frame in `src/app/dev/design/app-frame.tsx`.
- Where this document and an older comment disagree, this document and `globals.css` win. Versions 1 to 3 (glow tiles, solid dark cards, the "Digital" aurora and gradient) are retired.

## Principles

1. **Monochrome.** Near-black canvas, white text, greys made of white at low alpha. Hierarchy comes from colour (100% / 64% / 53% white), not size.
2. **Hairlines, not shadows.** Every edge is 1px of white at 7.5% (`--border`); inputs and outline buttons 10%. Shadows are tiny "natural" stacks you barely see in dark.
3. **Quiet density.** Interface text is Inter 14/20 medium. Page titles use the display face.
4. **Primary = solid white with near-black text** (inverted in light). Secondary = outline. Tertiary = ghost.
5. **Orange is rare:** the focus ring, "New" badges, one standout action per screen (accent button), the logo's dot, live/recording marks. Status colours (green, amber, red) only on small dots, badges and status charts.
6. **No** gradients, glass, glow, aurora, text gradients, tracked uppercase labels or middle-dot meta lines. The one blur is the top bar (canvas at 90% + blur 8px). The one measured gradient is the barely visible fill on a tool-tile square.
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
| `--accent` / `-hover` | `#FF6C02` / `#FF7F24` | `#F25F00` / `#DB5600` | Orange |
| `--accent-fg` | `#0F0F10` | `#0F0F10` | Text on orange (white on orange fails contrast) |
| `--accent-soft` / `--accent-text` | `#4A1F04` / `#FF9A4D` | `#FFE9D9` / `#B54400` | "New" badge; rare accent links |
| `--accent-tint` | orange 10% | orange 8% | Accent-tinted notice card (with a hairline) |
| `--ring` | orange 50% | orange 50% | Focus ring: 2px, offset 2px, keyboard only |
| `--success` `--warning` `--danger` | `hsl(142 71% 45%)` `hsl(38 92% 50%)` `hsl(0 84% 60%)` | darker for contrast | Status only; soft fills 10–15% |
| `--info` | `#A3A3A3` | `#6B6B6B` | No blue in v4: "info" is a neutral grey |
| `--gray-75/100/150/600` | `#212121 #2E2E2E #3B3B3B #A3A3A3` | light equivalents | Utilities are **`grey-*`** (`bg-grey-100`), so Tailwind's own `gray-*` stays intact |

Layout tokens: `--header-height: 50px`, `--sidebar-width: 16rem`, `--sidebar-width-collapsed: 3.5rem`, `--page-x: 20px`, `--sheet-width: 512px`. Elevation: `shadow-natural-xs`, `shadow-chart`, `shadow-sheet`, `shadow-toast` (variables `--elev-*`). Motion: `--duration-fast` 75ms, `--duration` 150ms, `--duration-menu` 180ms, `--duration-sheet` 300ms, `--ease-out`. Z-index: `--z-raised` 10 → `--z-toast` 60.

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

Radius: 6 (mono chip, kbd, small select); 7 (segmented items); 8 (28px buttons, nav links, menu items: `rounded-lg`); 10 (32–36px buttons, inputs, icon buttons: `rounded-[10px]` or `rounded-sm`); 12 (40px buttons and inputs, stat cards, menus, tool squares: `rounded-xl`); 16 (chart cards, dialogs: `rounded-2xl`); 24 (section cards: `rounded-3xl`); 26 (prompt pill); full (badges, switches, round prompt actions). Tailwind's scale is kept except `rounded-sm`, which is 10px.

Spacing base 4px. Page sides 20px; top bar 50px; sections 32–48px apart; grid gaps 12px. Card padding: 20 (stat, chart), 24 (section), 16 (tiles, metric cells), 12 (sidebar notice).

## Layout

- **Shell:** fixed sidebar 256px on `--sidebar` with a right hairline, collapsible. Logo row at the top (`<LogoArt height={16} />`; collapsed: `variant="mark"` at 18px). Nav items 32px tall, 4px apart, inset 12px, px8, gap 8, 18px icon in the secondary grey, label 14/20 medium secondary; hover and active: fill-1 + foreground. Section label ("Pinned") 14/20 medium secondary. At the bottom: a `card-tint` notice and the workspace row (32px, 20px avatar).
- **Top bar:** fixed, 50px, from the sidebar's edge; the canvas at 90% with blur(8px) and a bottom hairline; three columns: sidebar toggle + breadcrumb (14/20 medium, secondary, current page foreground, 14px chevrons) | centred search button (32px, ~230px, r12, outline, "Search everything…" 13px + ⌘ K) | small outline buttons, 32px icon buttons, a 32px avatar. Mark it `data-app-topbar` (see Brenda below).
- **Page:** padding-top = header height, sides 20px, full width. `PageHeader`: display title + right-aligned actions, optional description, then underline tabs on a full-width hairline.
- **Brenda's page (home):** centred column; the display headline; 20px below, the prompt pill (max 650px); about 40px below, Brenda's asks as tool tiles; then lists under underline tabs. Her chat: full height, past chats as a left list in sub-nav item style (a sheet on small screens).
- **Dashboards:** stat cards, the analytics card with its metric strip, filter controls, tables. **Settings and forms:** sheets, inputs, switches, segmented controls; page headers with tabs for sub-sections.
- Logo: always `<Logo />` / `<LogoArt />` from `src/components/logo.tsx` (the owner's artwork; the single icon is "B." via `variant="mark"`). Never type the wordmark.

## Components (`src/components/ui/`)

| Part | Import | Notes |
|---|---|---|
| `Button`, `buttonVariants` | `button` | variants `primary` `secondary` (=`outline`) `ghost` `subtle` `accent` `danger` `destructive` `link`; sizes `xs` 28, `sm` 32, `md` 36, `lg` 40, `tile` 56, `icon-xs` 28, `icon-sm` 32, `icon` 40, `icon-round` 36; `loading` |
| `IconButton`, `ICON_BUTTON` | `icon-button` | `variant` ghost (32, r10) / outline (40, r12) / round (36); `size` xs/sm/md; needs `aria-label` |
| `Input` `Textarea` `Select` `InputAdorned` `Label` `Field` | `input` | `.field` h36 r10; `fieldSize` xs 24 / sm 32 / md 36 / lg 40; `Field` links `description` and `error` to the control |
| `Switch` `Checkbox` `Radio` | `switch` | Switch 36×20 (bare without children); checkbox/radio 16px |
| `Segmented` | `segmented` | fill-1 r10 p2, items h28 r7 |
| `Tabs` | `tabs` | `variant` underline (default) / pills; counts; arrow keys |
| `Badge` `NewBadge` `CountPill` `MonoChip` `Kbd` | `badge` | plus `TASK_STATUS_TONE` (monochrome first), `SESSION_STATE_TONE`, `taskStatusLabel` |
| `Card` `SectionCard` `Panel`/`ChartCard` `CardHeader` `SectionTitle` `Overline` `Eyebrow` `Ledger` `PageHeader` | `card` | Card `variant` panel / section / stat / tint / plain |
| `StatCard` | `stat-card` | `value` (or v3 `verdict`), `icon`, `action`, `hint`, `rows`, `actions`, `href` |
| `AnalyticsCard` `MetricStrip` | `analytics-card` | metrics with server-rendered `content`; or `href` metrics |
| `FilterControl` `FilterSelect` `FilterBar` | `filter-control` | `autoSubmit` for GET forms |
| `ToolTile` `ToolTileRow` `ToolSquare` `QuickLink` | `tool-tile` | Brenda's asks; tiles fill the prompt, never send |
| `ListRow` `RowList` `Row` `RowEmpty` | `rows` | 64px rows separated by space |
| `DataTable` | `table` | `table.data`: 36px head, 48px rows, no lines; `fit` |
| `EmptyState` `ErrorState` `PermissionDenied` `OfflineState` `Alert` `Skeleton` | `states` | line icons (`icon`, or a v3 `icon3d` name) |
| `Sheet` `Dialog` | `sheet` | right sheet 512px (sm 400, lg 720); centred dialog 440px |
| `ConfirmDialog` `ConfirmButton` | `confirm` | centred r16; destructive = red fill; focus starts on Cancel |
| `Menu` `MenuItem` `MenuSeparator` `MenuLabel` `Popover` | `menu` | popover surface r12 p4; items h32 r8; keyboard |
| Tooltips | `tooltips` (`TooltipLayer`, mounted in the root layout) | the one system: from `aria-label`, or `data-tip`; `data-tip-side="right"` |
| `notify` `successToast` `ToastCard` | `toast` | toast surface, status dot with a 15% halo |
| `Avatar` `PresenceDot` `Person` | `avatar`, `presence`, `person` | solid grey-100 disc |
| `PromptInputBox` `PromptAction` | `ai-prompt-box` | the home pill: r26, solid fill-1, round 36px actions, white Send; VoiceCapture while dictating |
| `DatePicker` `TimePicker` `DurationPicker` | `date-picker` … | `size` xs/sm/md; choice = inverted primary |
| `ProgressArc` | `progress-arc` | foreground arc, green at 100, `tone="accent"` |
| `AreaChart` `BarChart` `Donut` `SegmentBar` `Sparkline` `Legend` | `charts` | foreground and greys, one orange highlight (bars: `highlight`, last by default) |
| `Icon3D` `IconTile` `LINE_ICON` | `icon` | v3 names now draw line icons |
| `HairlineGrid` `GridCell`, `EditButton`, `BackLink`, `AutoSubmitSelect`, motion helpers | … | restyled, same props |

Icons: lucide, 16px in controls, 18px in nav and prompt actions, 20px in tool squares, 24px in quick links; 1.5–2 stroke. No generic AI icons (no Sparkles, Bot, Wand, Stars, Brain): `BrendaGlyph` or `BrendaFace` mean Brenda.

## Brenda contract (kept)

While her chat is open the app's top bar is hidden and her header sits at the top: her page sets `<html data-brenda-chat>`, and `html:has([data-brenda-chat-view])` covers the first paint. globals.css hides any `[data-app-topbar]` (the top bar carries it), zeroes `#main` padding and width cap, and sizes `#workspace-sidebar` to the screen less `--shell-banners`. No animation between her home and the chat. The composer never lets messages show through (`bg-surface`, solid). The floating Brenda button and drawer do not appear on her page.

## Legacy classes and tokens (Control Center and landing page only)

The workspace app, the entry screens, `/dev/*` and `src/components/ui` use v4 classes and tokens only; the integration pass on 6 October 2026 migrated the last users and deleted the unused aliases. What remains is kept only for the two areas not yet redesigned, and each rule goes with its last user:

- globals.css §6 (classes): `.tile`, `.tile-link`, `.chip`, `.chip-link`, `.panel`, `.btn` (colours only), `.glass-panel`, `.sidebar-glass`, `.topbar-glass`, `.eyebrow`, `.eyebrow-accent`, `.link-action`, `.num`: the Control Center (`src/app/admin`, `src/components/admin`); `.tile` also draws the landing page's vendored phone menu (`src/components/aceternity/resizable-navbar.tsx`).
- globals.css §2 and the legacy part of `@theme` (tokens): `--bg`, `--bg-elevated`, `--bg-inset`, `--border-soft`, `--border-strong`, `--fg`, `--fg-muted`, `--fg-subtle`, `--fg-faint`, `--wash-soft`, `--wash`, `--wash-strong`, `--wash-active`, `--highlight`, `--btn-bg`, `--radius-sm`, `--radius` and their utilities (`text-fg-muted`, `border-border-soft`, `bg-wash` …). The landing page re-declares them with its v3 values (§8).

New code never uses any of these. `cn()` (`src/lib/utils.ts`) knows the v4 scale: `text-meta` and `text-2xs` are font sizes and the named shadows are shadows, so merging them never drops a colour.

## Desktop notch

The Tauri notch (`desktop/`) follows v4 through its own stylesheet, `desktop/src/style.css`, which copies the dark tokens from `globals.css` (it cannot import the web's CSS). Change a token in both places. Its deliberate differences: the island itself stays true black to meet the screen's notch, buttons are pills, and the compact bar text is 13/16 to fit a 24px menu bar. Its app icon stays as it is until the owner supplies a vector or high-resolution "B." mark.

## Not part of v4 (yet)

- **Landing page** (`src/app/page.tsx`, `src/components/landing`, `.lp-*`): keeps its v3 look. While it is on screen (`:root:has(.lp)`) the legacy tokens take their v3 values back, and `.lp` restores Geist 15px body type and Tailwind's default type scale.
- **Control Center** (`src/app/admin`, `src/components/admin`): renders through the legacy aliases above (v4-ish) until it is redesigned.

## Accessibility floor

Accessible names on every control (icon buttons need `aria-label`; the tooltip reads it), `aria-expanded`/`aria-controls` on toggles, errors linked to fields, focus visible from the keyboard (orange ring), dialogs on the native `<dialog>`, a word beside every colour, 40px touch targets on small controls (`pointer: coarse`), both themes, 400px wide without sideways scroll, reduced motion respected. Destructive actions go through `ConfirmButton`.
