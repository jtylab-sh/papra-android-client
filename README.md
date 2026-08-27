# papra-android-client

An unofficial Android client for [Papra](https://github.com/papra-hq/papra), the self-hosted document
archiving platform. Built for personal use: connect it to **your own Papra server**, browse and upload
documents, and keep a full offline mirror on the phone. Dark mode only. Not affiliated with the Papra
project.

> 🤖 This app is **AI-generated**: designed, written and released by [Claude](https://claude.com/claude-code)
> (Anthropic) under human direction, including this README.

## Features

- **Connect to any self-hosted Papra instance** — enter the server URL on first run.
- **Sign in with email & password**, including **two-factor (TOTP) accounts** — Papra's better-auth
  session over the `papra://` app scheme that Papra trusts out of the box. The device is remembered
  after the first code.
- **Material You** — Material 3 dark UI; on Android 12+ the palette follows the system
  (wallpaper) colors, with a papra-green fallback elsewhere. Themed (monochrome) app icon on
  Android 13+.
- **Browse documents** in a paginated list with tags, size, dates, typed custom properties and
  extracted OCR content; navigation lives in a hamburger drawer (Documents / Offline / Tags /
  Trash / Settings) like the Papra web sidebar.
- **Search like Papra**, results streaming in as you type: the server's real query grammar —
  `AND`/`OR`/`NOT`, `-negation`, `"quoted phrases"`, `tag:`, `name:`, `content:`, `created:`,
  `date:`, `has:` filters. Offline it falls back to local name search.
- **Views (saved searches)**, like the Papra sidebar: save the current search as a named view from
  the bookmark icon, run one from the chip strip under the search box, long-press to delete. Views
  are stored server-side and shared with the web UI.
- **Tags**: create, edit and delete org tags (colors + descriptions), and add/remove tags on any
  document.
- **Multi-select** (long press): batch move-to-trash and batch download-offline.
- **Upload** via in-app file picker, the Android share sheet (share any file to Papra), or the built-in
  **document scanner** (ML Kit edge detection).
- **Open / download / share** document files under their display name.
- **Trash** like the web app: restore, delete forever, empty trash — every delete is confirmed with
  the 30-day retention notice, and trash rows show the time left until permanent deletion.
- **Offline sync job**: optionally mirror every document to the phone on a schedule (15 min – 24 h,
  Wi-Fi-only option) using Android WorkManager; an Offline tab lists what's on the phone, offline
  documents are marked with a cloud icon, and copies can additionally be exported to a folder you
  pick (visible in your file manager).
- **Organizations**: switch between your Papra organizations or create a new one from Settings
  (switching clears and re-syncs the offline mirror).
- **Home-screen widgets**: a *Scan to Papra* button that jumps straight into the scanner, and a
  *Recent documents* list fed from the offline mirror (refreshed after every sync; rows open the
  document).
- **Biometric lock** (fingerprint / face) with a configurable grace period (default 5 min), an
  auto-opening prompt, and sign-out from the lock screen.

## Install

Grab the APK from the [latest release](../../releases/latest), or add this repo to
[Obtainium](https://github.com/ImranR98/Obtainium) (`Add App` → paste the repo URL) to get updates.

## Server requirements

- A reachable Papra instance (any URL — LAN IP, VPN hostname, public domain).
- **Sign-in** relies on Papra trusting the `papra://` app scheme. Recent Papra versions do this by
  default (`TRUSTED_APP_SCHEMES` defaults to `papra://`); if your server is older or overrides that
  variable, add `papra://` to `TRUSTED_APP_SCHEMES`.
- Two-factor accounts sign in with their TOTP code; backup codes are not supported in-app.

## Offline sync notes

- The sync job runs through Android's WorkManager: the cadence is a *minimum* interval — Android decides
  the exact moment, batches jobs, and by default waits for network availability and a non-low battery.
- Force-stopping the app suspends background jobs until the app is opened again. That is Android policy,
  not a bug.
- "Sync now" in Settings runs the same job immediately in the foreground.

## Development

```bash
npm ci
npx expo start            # dev client / Expo Go
npx tsc --noEmit          # type-check (what CI runs)
npx expo prebuild -p android && cd android && ./gradlew assembleRelease   # local APK
```

## Release flow

Push to `main` → CI type-checks → a version is computed from conventional-commit messages since the last
tag (`feat:` = minor, `fix:`/anything else = patch, `!`/`BREAKING CHANGE` = major) → the APK is
built and signed → only on success is the GitHub release created with the APK attached.

Repository secrets required for signing: `KEYSTORE_B64` (base64 of the keystore), `KEYSTORE_PASSWORD`,
`KEY_ALIAS`, `KEY_PASSWORD`. The keystore must never change once published — Android refuses updates
signed with a different key.

## License

[MIT](LICENSE)
