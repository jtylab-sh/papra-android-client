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
- **Custom properties**: create, rename and delete the org's property definitions (text, number,
  date, yes/no, select, multi-select with options) from their own page; on the document page every
  property is shown and text/number/date/yes-no values are editable in place (selects and
  relations stay web-app territory). Images open in a pinch-zoom viewer.
- **Multi-select** (long press): select all, batch tag/untag, batch share, batch print, batch
  move-to-trash and batch download-offline; the back button leaves selection mode.
- **Swipe actions**: swipe a document row right to download it offline, left to move it to trash.
- **Sort**: by date, name or last update, applied locally and passed to server search; tags are
  still searchable through the `tag:` query syntax.
- **Upload** via in-app file picker, the Android share sheet (share any file to Papra), or the built-in
  **document scanner** (ML Kit edge detection).
- **Open / download / share / print** document files under their display name (printing goes
  through the Android system print dialog; PDFs and images). The document page leads with
  a preview (images) or type icon, name with inline **rename**, one-tap open/share/print/trash, and
  collapsible extracted-text / details sections.
- **Trash** like the web app: restore, delete forever, empty trash — every delete is confirmed with
  the 30-day retention notice, and trash rows show the time left until permanent deletion.
- **Offline mirror**: optionally sync every document to the phone on a schedule (15 min – 24 h,
  Wi-Fi-only option, Android WorkManager). Syncs are **incremental**, **pause and resume around
  connectivity changes**, can be **paused manually** and continue where they left off, pick up
  documents added mid-sync, and manual syncs keep running in a foreground service with a live
  progress notification when you switch apps. An Offline tab lists what's on the phone, list rows
  carry a synced / not-synced cloud icon, the Documents list filters to not-yet-synced, Settings
  counts offline vs server documents, and each document page has its own download / remove-offline
  toggle. Copies can additionally be **exported to a folder you pick** — browsable in any file
  manager, kept out of the photo gallery, and self-healing if files are deleted from it. Turning
  sync off offers to delete all offline copies.
- **Organizations**: switch between your Papra organizations or create a new one from Settings —
  each organization keeps its own offline mirror on the phone, so switching is instant and loses
  nothing.
- **Home-screen widgets**: a *Scan to Papra* button that jumps straight into the scanner, and a
  *Recent documents* list fed from the offline mirror (refreshed after every sync; rows open the
  document). Add them from the launcher's widget picker or from Settings -> Home-screen widgets.
- **Notifications** (all opt-in, per-event toggles in Settings; permission asked on first enable):
  new documents found by background sync, repeated sync failures, session expired, a warning
  when trashed documents are within 3 days of permanent deletion, and a live sync-progress
  notification (manual and scheduled background syncs). Tapping a notification opens the matching
  page: sync progress and sync failures land in Settings, new documents in the list, trash
  warnings in Trash.
- **Home page**: quick Scan/Upload actions, organization statistics from the server (document
  count, size, trash) plus the offline count, and the 20 most recent documents.
- **Offline awareness**: a banner at the top whenever the phone has no connectivity, a small
  "You are offline" toast on any action that needs the server, and an automatic refresh of every
  page the moment connectivity returns.
- **Configurable date format** (Settings -> Date format): system locale, DD/MM/YYYY, MM/DD/YYYY
  or YYYY-MM-DD, applied everywhere dates appear.
- **Biometric lock** (fingerprint / face) with a configurable grace period (default 5 min), an
  auto-opening prompt, and sign-out from the lock screen.
- **Version + update check**: the app version shows at the bottom of Settings; an **opt-in**
  update check (Settings -> Update check, off by default so Obtainium/store users are never
  nagged) offers new GitHub releases on start, once per version.

## Install

Grab the APK from the [latest release](../../releases/latest), or add this repo to
[Obtainium](https://github.com/ImranR98/Obtainium) (`Add App` → paste the repo URL) to get updates.
The APK is built for **arm64 (64-bit)** devices — any Android phone from roughly 2016 on.

## Privacy

- **All network traffic goes to the server URL you configure — nothing else.** The REST client,
  the sign-in flow (better-auth) and file downloads only ever talk to your Papra instance.
- **No analytics, no tracking, no crash reporting, no telemetry, no OTA update pings** — none of
  those SDKs are in the app, and versions only change when you install a new APK yourself.
- One qualified exception: the **document scanner** uses Google's ML Kit, which Android delivers
  through Google Play services — the first scan may make Play services download the scanner module
  from Google. Scanning itself runs on-device; documents are not uploaded anywhere except to your
  server when you press upload.
- Notifications are generated locally on the phone (no push service involved).
- **In-app updates**: the update popup can download the APK and open the Android installer
  directly (the first time, Android asks you to allow installs from Papra); if anything fails it
  falls back to the release page in the browser.
- One exception to server-only traffic, and only when you enable the update check in Settings
  (off by default): on start the app asks this repo's GitHub releases (`api.github.com`) for a
  newer version. Plain unauthenticated GET, nothing sent beyond the request itself.

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
- "Sync now" in Settings runs the same job immediately. With the sync-progress notification enabled
  (Settings -> Notifications) it runs inside a foreground service and keeps going when you leave the
  app; without it, Android may suspend the app - and the sync - shortly after you switch away.

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
