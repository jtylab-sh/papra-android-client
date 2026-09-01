// Custom entry: expo-router plus the home-screen widget task handler and
// the sync foreground-service runner.
import "expo-router/entry";
import notifee from "react-native-notify-kit";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./src/widgets/task-handler";

// Widgets first: a throw from any later registration must never leave the
// widget task handler unregistered (widgets would render nothing).
registerWidgetTaskHandler(widgetTaskHandler);

// Background sync runs in a headless JS context where no React tree renders,
// so the route modules (and their imports) never load. The task executor in
// lib/sync must therefore be defined from the entry itself. require, not
// import: an import would hoist above the widget registration.
try {
  require("./src/lib/sync");
} catch {
  // Background sync is then unavailable; the app itself still works.
}

// The sync itself runs in ordinary app JS; this pending promise is what keeps
// the Android foreground service (and so the process) alive until
// stopForegroundService() is called at the end of the sync.
try {
  notifee.registerForegroundService(() => new Promise(() => {}));
  notifee.onBackgroundEvent(async () => {});
} catch {
  // Foreground-service progress is then unavailable; everything else works.
}
