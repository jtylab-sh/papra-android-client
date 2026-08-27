# papra-android-client

An unofficial Android client for [Papra](https://github.com/papra-hq/papra), the self-hosted
document archiving platform. Point it at your own server, browse and upload documents, and keep a
full offline copy on your phone. Not affiliated with the Papra project.

> 🤖 This app is AI-generated: designed, written and released by
> [Claude](https://claude.com/claude-code) (Anthropic) under human direction, including this README.

## Features

- Works with any self-hosted Papra instance. Sign in with email and password; two-factor (TOTP)
  accounts work and the device is remembered after the first code. Settings shows the server
  version next to your account.
- Material You: on Android 12+ the colors follow your wallpaper, and there is a themed app icon.
- Browse and search documents using Papra's real query grammar (`AND`/`OR`/`NOT`, `"quoted
  phrases"`, `tag:`, `name:`, `content:`, `created:`, `has:`), with results streaming in as you
  type. Offline, search falls back to local names.
- Saved views, shared with the web UI: save a search from the bookmark icon, run it from a chip,
  long-press to delete.
- Manage tags and custom properties (all types, select options included), and edit text, number,
  date and yes/no property values right on the document page.
- Multi-select with select all, batch tag/untag, share, print, trash and download. Swipe a row
  right to download it, left to trash it. Sort by date, name or last update.
- Upload from the file picker, the Android share sheet, or the built-in document scanner.
- Open, share and print documents under their real names, rename inline, and view images with
  pinch-zoom.
- Trash with restore, delete forever and empty trash; rows show the time left before permanent
  deletion.
- Offline mirror: sync every document on a schedule (15 min to 24 h, Wi-Fi-only option). Syncs are
  incremental, pause and resume around connectivity loss, can be paused by hand, pick up documents
  added mid-sync, and manual syncs keep running in a foreground service when you switch apps.
  Copies can also be exported to a folder of your choice, browsable in any file manager and kept
  out of the photo gallery. Each document page has its own download / remove-offline toggle.
- Home page with quick Scan/Upload actions, organization statistics and the most recent documents.
- Offline awareness: a banner while there is no connectivity, a small toast when an action needs
  the server, and every page refreshes by itself once you are back online.
- Home-screen widgets: a Scan button and a Recent documents list. Add them from the widget picker
  or from Settings.
- Opt-in notifications: new documents, repeated sync failures, session expired, trash purge
  warning, and live sync progress. Tapping one opens the matching page.
- Organizations: switch or create from Settings; each keeps its own offline mirror.
- Biometric lock with a configurable grace period.
- Configurable date format (system, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD).
- Optional update check (off by default) that downloads new releases and opens the installer
  directly.

## Install

Grab the APK from the [latest release](../../releases/latest), or add the repo to
[Obtainium](https://github.com/ImranR98/Obtainium) for updates. The APK is built for arm64
(64-bit) devices, which covers any Android phone from roughly 2016 on.

## Privacy

- All network traffic goes to the server URL you configure, nothing else. No analytics, tracking,
  crash reporting or telemetry of any kind.
- The document scanner uses Google's ML Kit via Play services; the first scan may download the
  scanner module from Google. Scanning itself runs on-device.
- Notifications are generated locally on the phone, no push service involved.
- If you enable the update check in Settings (off by default), the app asks this repo's GitHub
  releases for a newer version on start: a plain unauthenticated GET, nothing sent beyond the
  request itself.

## Server requirements

- A reachable Papra instance (LAN IP, VPN hostname or public domain).
- Sign-in relies on Papra trusting the `papra://` app scheme, which recent versions do by default.
  On older servers, add `papra://` to `TRUSTED_APP_SCHEMES`.
- Two-factor accounts sign in with their TOTP code; backup codes are not supported in-app.

## Offline sync notes

- The background job runs through Android's WorkManager: the cadence is a minimum, Android picks
  the exact moment and by default waits for network and a non-low battery.
- Force-stopping the app suspends background jobs until the app is opened again. That is Android
  policy.

## Development

```bash
npm ci
npx expo start            # dev client / Expo Go
npx tsc --noEmit          # type-check (what CI runs)
npx expo prebuild -p android && cd android && ./gradlew assembleRelease   # local APK
```

Imports use the `~` alias for `src/` (tsconfig paths, resolved by Metro).

## Release flow

Push to `main` and CI type-checks, computes a version from conventional-commit messages since the
last tag (`feat:` = minor, `fix:`/anything else = patch, `!`/`BREAKING CHANGE` = major), builds and
signs the APK, and only on success creates the GitHub release with the APK attached.

Repository secrets required for signing: `KEYSTORE_B64` (base64 of the keystore),
`KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`. The keystore must never change once published,
since Android refuses updates signed with a different key.

## License

[MIT](LICENSE)
