# PRODUCT.md

register: product

## Product purpose
Internal operations suite for Arizona Roofers: rep route planner, live Today Board, and the Review/Outcomes QA queues. Staff live in it all day; it is a working tool, not a showcase.

## Users
- Travis (owner-operator of the tooling): reviews CSR bookings and appointment outcomes daily.
- Office CSRs and managers: work the review queues in long sessions on desktop monitors in a bright office. Occasional phone use.

## Tone
Operator-grade: fast, dense, quiet. Information first. The interface should disappear into the task; urgency states (overdue, unqualified, lost) are the only elements allowed to shout.

## Anti-references
- Consumer SaaS marketing gloss (hero metrics, gradient buttons, decorative motion).
- Carnival dashboards where every widget has its own color.
- Cramped 10px pill-soup (the pre-2026-08 review page): density without hierarchy.

## Strategic principles
- Scan targets first: who booked it, and what state is it in. Everything else supports.
- One component vocabulary across planner, boards, and queues.
- User-themeable: all color through the CSS-var token system in index.html, never hardcoded.
