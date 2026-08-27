# TODO

- **Notifications**: implement the plan in [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md)
  (sync results, transfer progress, session-expired / trash-purge alerts; local-only via
  `expo-notifications`, `POST_NOTIFICATIONS` prompt on Android 13+).
- **Slim the APK**: current release APK is ~106 MB because it bundles all four CPU ABIs.
  Options: `splits { abi { enable true } }` in gradle (per-ABI APKs, ~30 MB each — Obtainium
  handles picking the right one poorly, so prefer:) or `ndk.abiFilters arm64-v8a` only —
  modern phones are all arm64; drops ~70% of size at the cost of dropping 32-bit devices.
