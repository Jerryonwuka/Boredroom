---
name: boredroom-ui
description: Boredroom interface rules. Use before any UI change in this repository so new screens match the design system (tokens, primitives, accessibility, motion) distilled from the UI Skills registry.
---

# Boredroom UI

Read `docs/design-system.md` first; it records the decisions. Then:

1. Use the primitives in `src/components/ui/` (Button, Input/Select/Textarea/Field, Card/PageHeader, Badge, DataTable, EmptyState/Alert/Skeleton, ConfirmDialog/ConfirmButton). Do not hand-roll buttons, dialogs or inputs.
2. Bind to tokens (`bg-elevated`, `border-border`, `text-fg-muted`, `var(--radius-sm)`, `var(--z-dialog)`), never raw hex, arbitrary z-index or `shadow-xl`.
3. One focal element per view; demote the rest with weight and colour before size.
4. Accessibility: accessible names on every control, `aria-expanded`/`aria-controls` on toggles, errors linked to fields, keyboard reachable, `prefers-reduced-motion` respected.
5. Motion only on transform/opacity, under 200ms for feedback, `--ease-out`; no animation unless it explains a change.
6. Destructive actions go through `ConfirmButton`, never `window.confirm`.
7. Empty states name one next action; loading states use skeletons; numbers are tabular.
8. Verify in the browser at desktop and ~400px widths before presenting.
