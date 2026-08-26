# TODO

- **Progress notifications**: show an Android notification while a background/foreground
  sync is running (n/total files) and while an upload is in progress, so long operations
  are visible outside the app. Needs `expo-notifications` (local-only, no push) and a
  `POST_NOTIFICATIONS` runtime permission prompt on Android 13+.
