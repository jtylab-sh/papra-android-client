# Notification plan

**Status: implemented** (src/lib/notifications.ts) — per-event opt-in toggles in
Settings, permission requested on first enable, events fired from background
syncs only. Not implemented: transfer progress bars (needs a foreground
service; on demand).

All notifications are **local** (scheduled/shown by the app itself via
`expo-notifications`). Real push would require FCM plus a server-side webhook
sender that Papra does not ship — out of scope for a self-hosted client.

## Channels (Android notification channels)

| Channel | Importance | Notifications |
|---|---|---|
| `sync` | low (silent) | background-sync results |
| `transfers` | low, with progress bar | uploads / mass offline downloads |
| `alerts` | default (sound) | action-needed events |

Users can mute any channel from Android settings without touching the app.

## Notifications, by value

### 1. Sync results (channel `sync`)
- **New documents found** — after a background sync that pulled documents the
  phone had not seen: "3 new documents" with the first few names. Tapping opens
  the documents list. Shown only when something is new — a silent "sync ok every
  12 h" notification is noise.
- **Sync failed repeatedly** — one notification after N (e.g. 3) consecutive
  background failures, not on the first flake. Wi-Fi-only skips are not failures.

### 2. Transfers (channel `transfers`)
- **Upload progress / result** — when the user leaves the app during an upload
  batch: progress notification (x/y files), replaced by "Uploaded 5 documents"
  or "2 uploads failed — tap to retry" on completion.
- **Mass offline download** — same pattern for multi-select "download offline"
  and full-mirror syncs with many pending blobs.

### 3. Action needed (channel `alerts`)
- **Session expired** — background sync got a 401: "Sign in again to keep
  syncing". Tapping opens the sign-in screen. Without this, offline sync dies
  silently and the user finds out weeks later.
- **Trash purge warning** — during sync, if trashed documents are within 3 days
  of the 30-day purge: "4 documents will be permanently deleted in 3 days".
  Tapping opens Trash. At most one per day.
- **Storage low** — mirror download aborted because the phone has little free
  space (threshold, e.g. < 500 MB): tells the user why offline is incomplete.

## Implementation notes

- `expo-notifications` (config plugin, already Expo SDK native module).
- Android 13+ needs the `POST_NOTIFICATIONS` runtime permission — ask on first
  enable of any feature that notifies (sync enable, first background upload),
  not at app start.
- Background-task code (`src/lib/sync.ts`) already knows new-vs-seen ids and
  failure counts; notifications hook in there. No architectural change needed.
