---
name: boredroom-ui
description: Boredroom interface rules. Use before any UI change in this repository so new screens match design system v2 (true black, hairlines, solid dark cards, one orange, 3D icons) recorded in docs/design-system.md.
---

# Boredroom UI

Read `docs/design-system.md` first; it records the values, the parts and the reasons. Then:

1. Build from the primitives in `src/components/ui/`: `Button`, `Card`/`CardHeader`, `PageHeader` (with a 3D `icon`), `StatCard`, `Ledger`, `Badge`, `DataTable`, `Tabs`, `HairlineGrid`/`GridCell`, `Input`/`Select`/`Textarea`/`Field`, `EmptyState`/`Alert`/`Skeleton`, `ConfirmDialog`/`ConfirmButton`, `Icon3D`/`IconTile`, and the motion primitives. Do not hand-roll buttons, dialogs, inputs, tabs or cards.
2. Surfaces are `.tile` (card), `.chip` (row, pill, input strip), `.panel` (inner), `.icon-tile`, `.hairline-grid`. Bind to tokens (`bg-inset`, `border-border`, `text-fg-muted`, `var(--radius-sm)`, `var(--z-dialog)`); never raw hex, arbitrary z-index, `shadow-xl` or backdrop blur.
3. Icons: the 3D set (`Icon3D`, names in `ICON_3D`) marks places (page header, section, empty state, feature card); lucide marks controls. Never a 3D icon in a button or a table row.
4. Type: Cal Sans for titles, verdicts and the clock; Manrope for everything else; sentence case; no tracked-caps eyebrows, no middle dots, no arrows appended to links.
5. One focal element per view; three `StatCard`s at most; one primary button per header; every button is the dark bordered `Button`, never a filled orange one.
6. Motion: one `PageRise` per page; everything else answers an action; no control animates on its own; 120 to 350ms, transform and opacity; `prefers-reduced-motion` respected.
7. Accessibility: accessible names on every control, `aria-expanded`/`aria-controls` on toggles, errors linked to fields, keyboard reachable, a word beside every colour.
8. Destructive actions go through `ConfirmButton`, never `window.confirm`.
9. Empty states name one next action; loading states use skeletons; numbers are tabular.
10. Verify in the browser at desktop and ~400px widths before presenting.
