# Notifications

All notifications are local, shown by the app itself. Papra ships no push
sender, so there is nothing to subscribe to.

## What the app shows

| Notification | Channel | When |
|---|---|---|
| Sync progress | `sync-progress` (low) | While Sync now runs. Bound to a `dataSync` foreground service, so the sync keeps running when you leave the app. Opt-in in Settings. |
| Upload progress | `upload-progress` (low) | While queued files upload. Foreground service when the app is open, plain notification when a reconnect flushes the queue in the background. |
| Documents uploaded | `sync` (low) | When an upload batch finishes while the app is out of sight. |

Tapping a notification opens the matching page: Settings for sync, the upload
queue for uploads, the documents list for completed uploads.

## Implementation notes

- Progress notifications use react-native-notify-kit (the maintained Notifee
  successor); the completion note uses expo-notifications.
- Android 13+ needs the `POST_NOTIFICATIONS` runtime permission. It is asked on
  first enable of the progress toggle and on the first upload, never at app
  start.
- A run that dies with its process leaves its ongoing notification behind; the
  app cancels leftover progress notifications on start when nothing is running.
- There is no scheduled background sync, so there are no "new documents",
  "sync failed" or "session expired" notifications.
