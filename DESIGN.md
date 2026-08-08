# DESIGN.md

## Tokens (source of truth: index.html)
CSS variables per theme (several light + dark themes, user-selectable via Theme Editor), mapped to Tailwind utilities:
- Surfaces: `bg-bg-primary` (content), `bg-bg-secondary` (page/panel), `bg-bg-tertiary` (hover/inset), `bg-bg-quaternary` (disabled).
- Text: `text-text-primary` → `text-text-quaternary` (4-step ramp).
- Borders: `border-border-primary` (strong), `border-border-secondary` (hairline).
- Brand: `brand-primary` / `brand-secondary`, `brand-bg-light`, `brand-text-light`, `brand-text-on-primary`. Default theme brand is indigo.
- Semantic tags: `tag-red-*`, `tag-amber-*`, `tag-green-*`, `tag-blue-*` (each `-bg` / `-text` / `-border`; vars are `--red-bg` etc.).
Rule: components use tokens only. No hex, no `#000`/`#fff`.

## Typography
System sans stack. Product scale, fixed rem/px: card titles 14–15px semibold, body/meta 11–12px, micro labels 9–10px bold uppercase. Counts and money in `tabular-nums`.

## Color strategy
Restrained. Brand accent for interactive/selected only. Red family is reserved for urgency (overdue / unqualified / lost) so it keeps meaning. Amber = caution/flag, green = confirm action.

## Components (review surfaces)
- Cards: `rounded-md border` on `bg-bg-primary`; urgency = full-perimeter red border + graded `tag-red-bg` tint + status chip (chips are the loudest element; they alone may pulse).
- Status chips: 9px bold uppercase, `.animate-outcome-attention` pulse only on overdue/unqualified while needs_review; disabled under prefers-reduced-motion.
- CSR identity: initials avatar dot (`bg-brand-primary`) + name. Identity ≠ state.
- FilterDropdown: button + fixed-position panel, per-value counts, click-to-toggle, multi-select.
- Segmented controls for period; pill tabs for review status.

## Motion
150–250ms state transitions, ease-out. Card exit slide 320ms. No decorative motion; pulse conveys urgency state only.
