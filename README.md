# papra-android-client

An unofficial Android client for [Papra](https://github.com/papra-hq/papra), the self-hosted document
archiving platform. Built for personal use: connect it to **your own Papra server**, browse and upload
documents, and keep a full offline mirror on the phone. Dark mode only. Not affiliated with the Papra
project.

## Features

- **Connect to any self-hosted Papra instance** — enter the server URL on first run.
- **Sign in with email & password** (Papra's better-auth session, using the `papra://` app scheme that
  Papra trusts out of the box) **or with an API key** for accounts using two-factor auth or older servers.
- **Browse documents** with tags, size, dates, custom properties and extracted OCR content; search by
  name offline, or submit the search to the server for full-content search.
- **Upload** via in-app file picker, the Android share sheet (share any file to Papra), or the built-in
  **document scanner** (ML Kit edge detection).
- **Open / download / share** document files.
- **Trash** like the web app: move to trash, restore, delete forever, empty trash.
- **Offline sync job**: optionally mirror every document to the phone on a schedule (15 min – 24 h,
  Wi-Fi-only option) using Android WorkManager. Documents open instantly and without a network.
- **Biometric lock** (fingerprint / face) on app open.

## Install

Grab the APK from the [latest release](../../releases/latest), or add this repo to
[Obtainium](https://github.com/ImranR98/Obtainium) (`Add App` → paste the repo URL) to get updates.

## Server requirements

- A reachable Papra instance (any URL — LAN IP, VPN hostname, public domain).
- **Email & password sign-in** relies on Papra trusting the `papra://` app scheme. Recent Papra versions
  do this by default (`TRUSTED_APP_SCHEMES` defaults to `papra://`). If your server is older or overrides
  that variable, either add `papra://` to `TRUSTED_APP_SCHEMES` or just use an API key.
- **API key mode**: create a key in Papra under your user menu → API keys. Permissions needed:
  `documents:read`, `tags:read` to browse; `documents:create` to upload; `documents:update`,
  `documents:delete` for trash/restore.
- Accounts with two-factor auth must use an API key (the app does not implement the 2FA flow).

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
tag (`feat:` = minor, `fix:`/anything else = patch, `!`/`BREAKING CHANGE` = major, capped at minor while
pre-1.0) → a GitHub release is created → a signed APK is built and attached to it.

Repository secrets required for signing: `KEYSTORE_B64` (base64 of the keystore), `KEYSTORE_PASSWORD`,
`KEY_ALIAS`, `KEY_PASSWORD`. The keystore must never change once published — Android refuses updates
signed with a different key.

## License

[MIT](LICENSE)
