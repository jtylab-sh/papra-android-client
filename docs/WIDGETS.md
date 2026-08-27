# Home-screen widget plan

Android home-screen widgets for the Papra client, in value order.
**Implemented: Scan to Papra + Recent documents** (react-native-android-widget 0.22.x).
Search-bar and sync-status widgets remain on demand.

## How (one-time groundwork)

React Native apps need `react-native-android-widget` (config plugin; widgets are
declared as JSX trees rendered to RemoteViews — no JS runtime on the home screen,
a headless task re-renders on schedule/taps). Verify the package's maintenance
state before starting; it is the only realistic path short of writing a native
Expo module. Widget taps deep-link into the app via the existing `papra://` scheme
routes. Data comes from the SQLite mirror — widgets must never hit the server
directly (no auth/cookie handling in RemoteViews contexts).

## Widget candidates

1. **Scan to Papra** (1x1 button) — highest value, lowest effort. Tap opens the
   app straight into the document scanner (`papra:///upload?mode=scan`). Second
   button variant for the file picker.
2. **Recent documents** (2x3 list) — last N documents from the offline mirror
   (name, date, offline icon). Tap row → document detail; tap header → app.
   Refreshes after each sync (the sync task triggers a widget re-render).
3. **Search bar** (4x1) — tap opens the app with the search field focused; long
   term could offer view shortcuts (chips of saved views) beside it.
4. **Sync status** (1x1 / 2x1) — last sync time, offline document count, tap =
   sync now. Only worth it if sync reliability ever becomes a concern; otherwise
   noise.

## Not worth building

- **Upload-progress live widget** — Android already shows transfer notifications
  (see docs/NOTIFICATIONS.md); a widget duplicating that is stale 99% of the time.
- **Full document browser widget** — RemoteViews list limits (no search, no tags
  UI) make it a worse version of opening the app.

## Suggested order

Groundwork + Scan button first (one small PR), Recent documents second, the rest
on demand.
