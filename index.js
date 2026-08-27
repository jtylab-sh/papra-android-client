// Custom entry: expo-router plus the home-screen widget task handler and
// the sync foreground-service runner.
import "expo-router/entry";
import notifee from "react-native-notify-kit";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./src/widgets/task-handler";

registerWidgetTaskHandler(widgetTaskHandler);

// The sync itself runs in ordinary app JS; this pending promise is what keeps
// the Android foreground service (and so the process) alive until
// stopForegroundService() is called at the end of the sync.
notifee.registerForegroundService(() => new Promise(() => {}));
notifee.onBackgroundEvent(async () => {});
