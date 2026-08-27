import type { WidgetTaskHandlerProps } from "react-native-android-widget";
import { getSettings } from "~/lib/settings";
import { renderWidgetByName } from "~/widgets/widgets";

export async function widgetTaskHandler(props: WidgetTaskHandlerProps): Promise<void> {
  // Side effect: selects the active organization's database for the render.
  await getSettings().catch(() => {});
  switch (props.widgetAction) {
    case "WIDGET_ADDED":
    case "WIDGET_UPDATE":
    case "WIDGET_RESIZED":
      props.renderWidget(renderWidgetByName(props.widgetInfo.widgetName));
      break;
    default:
      // Clicks are OPEN_URI/OPEN_APP, handled natively; nothing to do on delete.
      break;
  }
}
