# List Behavior (Sprint 14)

## Density
- Default feed row padding: 12px with 6px internal gap.
- Settings row height: ~52px padded (dense).
- Tap targets: minimum 48px height.

## Metadata priority
1) Generation
2) Topic
3) Assumption

Truncate body to 3 lines; metadata to 1 line.

## Interaction
- Rows open details on press; avoid nested taps except explicit actions (e.g., CTA button).
- Empty: explain why and what to do next.
- Error: offer retry; preserve scroll position.
- Loading: skeletons in place of rows.

## Pagination vs scroll
- Default: scroll with `FlatList`. Introduce pagination only when server/data requires (not in Sprint 14).

## Sources
- Patterns informed by Bento (feed density/metadata stacking) and Takeout (settings row density). No donor code copied.

