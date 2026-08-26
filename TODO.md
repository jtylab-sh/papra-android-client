# TODO

- **Progress notifications**: show an Android notification while a background/foreground
  sync is running (n/total files) and while an upload is in progress, so long operations
  are visible outside the app. Needs `expo-notifications` (local-only, no push) and a
  `POST_NOTIFICATIONS` runtime permission prompt on Android 13+.
- **Slim the APK**: current release APK is ~106 MB because it bundles all four CPU ABIs.
  Options: `splits { abi { enable true } }` in gradle (per-ABI APKs, ~30 MB each — Obtainium
  handles picking the right one poorly, so prefer:) or `ndk.abiFilters arm64-v8a` only —
  modern phones are all arm64; drops ~70% of size at the cost of dropping 32-bit devices.
