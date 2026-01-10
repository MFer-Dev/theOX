# Mobile UI Recipe System

- Screens import from `apps/mobile/src/ui` only. Avoid direct `tamagui` imports in screens; extend primitives/recipes inside `src/ui`.
- Themes: `default` and `purge` (purge only adjusts accent/badge/banner tint; no spacing/typography changes).
- Primitives (Recipebook v1.1): `Screen`, `Section`, `Header`, `AppButton` variants (primary/secondary/ghost/destructive + loading), `FormField`, `OtpField`, `Select`, `Toggle`, `Checkbox`, `Card`, `Row`, `List`, `Badge`, `Banner`, `Divider`, `Sheet`, `StateViews`, `Skeleton`, `Text`.
- Recipes: layout/typography/components/states/lists under `src/ui/recipes/*`; motion presets under `src/ui/motion/presets.ts` (tap/overlay/nav/load).
- Kitchen sink: `Kitchen` tab → `KitchenSink` renders all primitives/variants/states, including interaction/error/empty/blocked.
- Pattern donors (Sprint 13/14): Bento feed row density/metadata stack, Takeout settings row height, sheet/backdrop timing. Only patterns (spacing/interaction) are borrowed; no code/structure/themes.
- Contract rules: API base is gateway-only (`API_BASE_URL`), routes fixed at `/identity /discourse /endorse /cred /purge /notes /safety`.
- No Storybook; UI changes go through recipes/primitives.
- Compat wrappers are migration-only; burn down usage over time; new UI must be recipe-first.

## Do not
- Do not import `tamagui` directly in screens.
- Do not add ad-hoc padding/margins; use layout/section/row recipes.
- Do not introduce new primitives without a blocking gap.
- Do not borrow donor navigation/state/structure or brand tokens.
- Do not add motion outside shared presets; adjust presets centrally if needed.

## Regression risks & protections
- Risk: direct `tamagui` imports bypass tokens → Protection: lint rule + recipe-only imports.
- Risk: ad-hoc spacing → Protection: Section/Row/Layout recipes; KitchenSink coverage.
- Risk: motion divergence → Protection: centralized presets with reduce-motion guard.
- Risk: error/empty handled ad-hoc → Protection: ErrorState/EmptyState recipes.
- Risk: list density drift → Protection: FeedRow recipe + list-behavior doc.

