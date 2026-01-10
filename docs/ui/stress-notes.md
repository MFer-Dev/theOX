# UI Stress Notes (Sprint 15A)

- Large list: use `List` (FlatList) with keyExtractor; avoid inline height changes to prevent reflow. Tested with 200 items in KitchenSink.
- Delayed load: show skeleton/LoadingState until data; avoid flicker by gating on resolved flag.
- Retry storms: debounce retries or keep retry CTA; ensure loading/error are mutually exclusive.
- Rapid navigation/state flips: rely on Screen/Section and recipe states to keep layout stable.

