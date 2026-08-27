// Custom entry: expo-router plus the home-screen widget task handler.
import "expo-router/entry";
import { registerWidgetTaskHandler } from "react-native-android-widget";
import { widgetTaskHandler } from "./src/widgets/task-handler";

registerWidgetTaskHandler(widgetTaskHandler);
