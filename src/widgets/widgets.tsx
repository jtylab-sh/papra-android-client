/**
 * Home-screen widgets (react-native-android-widget). Rendered to RemoteViews —
 * no JS runtime on the home screen, so everything here must be pure/presentational.
 * Data comes from the SQLite mirror only; taps deep-link via the papra:// scheme.
 * Static dark palette: widgets can't use the runtime MD3 theme.
 */
import { FlexWidget, ListWidget, TextWidget, requestWidgetUpdate } from "react-native-android-widget";
import { listCachedDocuments, type CachedDocument } from "../lib/db";

const BG = "#131a18";
const TEXT = "#e7edeb";
const MUTED = "#8fa39d";
const GREEN = "#10b981";

export function ScanWidget() {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: "papra:///upload?mode=scan" }}
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: BG,
        borderRadius: 16,
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <TextWidget text="📄  Scan to Papra" style={{ fontSize: 14, color: TEXT }} />
    </FlexWidget>
  );
}

export function RecentDocumentsWidget({ docs }: { docs: CachedDocument[] }) {
  return (
    <FlexWidget
      style={{
        height: "match_parent",
        width: "match_parent",
        backgroundColor: BG,
        borderRadius: 16,
        flexDirection: "column",
        padding: 12,
      }}
    >
      <TextWidget
        text="Papra · recent"
        clickAction="OPEN_APP"
        style={{ fontSize: 12, color: GREEN, marginBottom: 6 }}
      />
      {docs.length === 0 ? (
        <TextWidget text="No documents synced yet" style={{ fontSize: 13, color: MUTED }} />
      ) : (
        <ListWidget style={{ height: "match_parent", width: "match_parent" }}>
          {docs.map((doc) => (
            <FlexWidget
              key={doc.id}
              clickAction="OPEN_URI"
              clickActionData={{ uri: `papra:///document/${doc.id}` }}
              style={{ width: "match_parent", flexDirection: "column", paddingVertical: 6 }}
            >
              <TextWidget text={doc.name} maxLines={1} style={{ fontSize: 13, color: TEXT }} />
              <TextWidget
                text={`${doc.createdAt ? new Date(doc.createdAt).toLocaleDateString() : ""}${doc.fileUri ? "  ·  offline" : ""}`}
                style={{ fontSize: 11, color: MUTED }}
              />
            </FlexWidget>
          ))}
        </ListWidget>
      )}
    </FlexWidget>
  );
}

/** Render a widget by its config-plugin name. */
export function renderWidgetByName(name: string) {
  if (name === "Scan") return <ScanWidget />;
  // RecentDocuments — read failures render the empty state rather than crash the host.
  let docs: CachedDocument[] = [];
  try {
    docs = listCachedDocuments("", 8, 0);
  } catch {
    /* db unavailable in this context */
  }
  return <RecentDocumentsWidget docs={docs} />;
}

/** Refresh the recent-documents widget after a sync; no-op when none is placed. */
export async function updateRecentDocumentsWidget(): Promise<void> {
  await requestWidgetUpdate({
    widgetName: "RecentDocuments",
    renderWidget: () => renderWidgetByName("RecentDocuments"),
  });
}
