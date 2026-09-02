# papra-android-client

An unofficial Android client for [Papra](https://github.com/papra-hq/papra), the self-hosted
document archiving platform. Point it at your own server, browse and upload documents, and keep a
full offline copy on your phone. Not affiliated with the Papra project.

> 🤖 This app is AI-generated: designed, written and released by
> [Claude](https://claude.com/claude-code) (Anthropic) under human direction, including this README.

## Features

- Works with any self-hosted Papra instance. Sign in with email and password; two-factor (TOTP)
  accounts work, with an optional "trust this device" checkbox that skips the code on later
  sign-ins. Settings shows the server version next to your account.
- Material You: on Android 12+ the colors follow your wallpaper, and there is a themed app icon.
- Browse and search documents using Papra's real query grammar (`AND`/`OR`/`NOT`, `"quoted
  phrases"`, `tag:`, `name:`, `content:`, `created:`, `has:`), with results streaming in as you
  type. Offline, search falls back to local names and tags.
- Saved views, shared with the web UI: save a search from the bookmark icon, run it from a chip,
  long-press to delete.
- Manage tags and custom properties (all types, select options included), and edit text, number,
  date and yes/no property values right on the document page. Tapping a tag searches for it.
- Multi-select with select all, batch tag/untag, share, print, trash and download. Swipe a row
  right to download it, left to trash it. Sort by date, name or last update.
- Upload from the file picker, the Android share sheet, or the built-in document scanner. Files
  can be renamed before they go up.
- Scans become a single PDF, however many pages you capture, and you pick the name right after
  scanning. Papra runs OCR on scanned PDFs, so they stay searchable.
- Reliable uploads: a progress notification shows each file, uploads keep running when you switch
  apps, and anything that cannot be sent (offline, server unreachable) waits in a queue that
  retries by itself. The queue page lets you retry now or remove entries.
- Open, share and print documents under their real names, rename inline, view images with
  pinch-zoom, copy the extracted text, or jump to the document in the web UI.
- Trash with restore, delete forever and empty trash; rows show the time left before permanent
  deletion.
- Offline mirror: Sync now downloads every document to this phone. Syncs are incremental, pause and
  resume around connectivity loss, can be paused by hand, pick up documents added mid-sync, and keep
  running in a foreground service when you switch apps. Copies can also be exported to a folder of
  your choice, browsable in any file manager and kept out of the photo gallery. Each document page
  has its own download / remove-offline toggle.
- Home is the start page: quick Scan/Upload actions, organization statistics and the most recent
  documents. Long-pressing the app icon offers Scan, Upload and Search shortcuts.
- Offline awareness: a banner while there is no connectivity, a small toast when an action needs
  the server, and every page refreshes by itself once you are back online.
- Home-screen widgets: a Scan button and a Recent documents list. Add them from the widget picker
  or from Settings.
- Opt-in notifications: new documents, repeated sync failures, session expired, trash purge
  warning, and live sync and upload progress. Tapping one opens the matching page.
- Organizations: switch or create from Settings; each keeps its own offline mirror.
- Private by design on the device too: biometric lock with a configurable grace period
  (screenshots are blocked only while locked), the app is excluded from Google's device backup,
  and the session is stored per server and fully removed on sign-out. App settings survive
  sign-out; documents do not.
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

- Sync is manual: Settings, Sync now. There is no scheduled background sync.

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
