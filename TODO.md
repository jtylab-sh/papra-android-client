# TODO

- **Notifications**: implement the plan in [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md)
  (sync results, transfer progress, session-expired / trash-purge alerts; local-only via
  `expo-notifications`, `POST_NOTIFICATIONS` prompt on Android 13+).
- ~~Slim the APK~~ — done: releases build `reactNativeArchitectures=arm64-v8a` only
  (~40 MB, 64-bit devices only, i.e. any phone since ~2016).
