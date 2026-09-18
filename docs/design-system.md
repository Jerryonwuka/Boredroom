# Boredroom design system

The product keeps the landing page's identity (black surfaces, one orange accent `#FF6C02`, Cal Sans display, Manrope body, pill buttons) and applies the craft rules distilled from the UI Skills registry (ui-skills.com), chiefly `baseline-ui`, `interface-design`, `fixing-accessibility`, `fixing-motion-performance`, Anthropic's `frontend-design` and Vercel's Web Interface Guidelines. Decisions below are the ones the code holds to; `src/app/globals.css` is the source of truth for values.

## Signature and restraint (frontend-design pass, 18 September 2026)

- **The clock is the brand element.** Set in Cal Sans at display size, tabular, always the hero of My Day: the running task's elapsed time, or today's total when idle ("Not on the clock"). A hairline in the accent fills toward the estimate. Workroom cards carry the same clock.
- **Eyebrows carry information, not category.** The small line above a title is the date or the scope in sentence case, in the accent. No tracked capitals, no "ORGANISATION" style labels. Pages whose title already says what they are have no eyebrow.
- **Figures are a ledger line, not boxes.** `Ledger` renders one row of display numbers with sentence-case labels; the dashboard's first block is the room (who is working), then the ledger.
- **Meta text reads as prose.** Commas and spaces, not middle dots; no arrows appended to links; no monospace for data labels.
- **Colour restraint.** Ember only on the live thing, the primary action and the eyebrow; status colours only for status. The gradient word in the greeting is gone.

## Direction

- **Who**: a staff member with a timer running, a team lead checking the team, an owner supervising. Working tools, used many times a day.
- **Feel**: calm, dark, precise. Structure is mostly invisible; colour means something (status, action, identity).
- **Focal point per view**: My Day → the work session; Team board → the task list; Dashboard → who is working now; Settings → the two switches at the top.

## Tokens

| Group | Values |
| --- | --- |
| Surfaces (one hue, lightness only) | `--bg #0b0b0b` → `--bg-elevated #131313` → `--bg-surface #181818` → `--bg-popover #1f1f1f`; inputs `--bg-inset #0e0e0e` (darker: they receive content). Sidebar shares the canvas colour. |
| Borders | `--border-soft` 5% · `--border` 8% · `--border-strong` 14% white. Emphasis comes from space and weight before lines. |
| Text (four tiers) | `--fg` primary · `--fg-muted` secondary · `--fg-subtle` metadata · `--fg-faint` disabled |
| Accent | `--accent` orange, ~10% of any screen. Semantic: success, warning, danger, info, slightly desaturated. |
| Radius | `--radius-sm` 8px controls · `--radius` 14px cards · `--radius-lg` 20px dialogs; pills for buttons |
| Depth | Borders only. Lifted surfaces get a single 1px ring (`--ring-lift`). No drop shadows, no decorative gradients on tiles. The header glow and the running-session glow are the brand's two allowed lights. |
| Motion | `--ease-out cubic-bezier(0.23,1,0.32,1)`, `--duration-fast 120ms`, `--duration 180ms`. Transform and opacity only. `prefers-reduced-motion` drops movement globally. |
| Z-index | `--z-raised 10 · --z-dropdown 20 · --z-sticky 30 · --z-overlay 40 · --z-dialog 50 · --z-toast 60` |
| Type scale | 1.25 ratio from a 15/16px body: 12 · 13 · 15 · 16 · 18 · 22 · 28 · 36. Headings `text-wrap: balance`, paragraphs `text-wrap: pretty`, numbers `tabular-nums`. |
| Spacing | 4px base. Component padding 12–20px, section gaps 24–32px. Symmetrical padding. |

## Components

- **Button** — pill; primary / outline / ghost / subtle / danger; `sm` 36px, `md` 44px, `lg` 56px, `icon` 40×40 (hit area). Press feedback `scale(0.97)`; named transitions only.
- **Input / Select / Textarea** — inset surface, strong border, hover lightens, focus ring. `Field` links the error to the control (`aria-describedby`, `aria-invalid`).
- **ConfirmDialog / ConfirmButton** — native `<dialog>` for every destructive or irreversible action (archive, disconnect, rotate code, publish policy, turn recording off). Focus trapped, Escape closes, specific action labels.
- **Tile / Card** — flat elevated surface + border. `tile-active` marks the one live row (accent edge, no glow).
- **DataTable** — quiet header (medium weight, subtle colour, no all-caps), soft row dividers, hover tint, tabular numbers.
- **EmptyState** — every empty state names one next action.
- **Skeleton / loading.tsx** — structural skeleton while a workspace page renders.

## Rules of thumb

1. Reuse the primitives above before writing a new class string. Extract on the second reuse.
2. Icon-only buttons carry `aria-label`; toggles carry `aria-expanded` and `aria-controls`; decorative icons are `aria-hidden`.
3. Errors sit next to where the action happens. Loading labels end with an ellipsis (…).
4. One accent per view. Colour communicates; grey builds structure.
5. Never `h-screen` (use `h-dvh`); fixed elements respect `env(safe-area-inset-*)`.
6. Never `transition: all`; never animate width, height or blur.
