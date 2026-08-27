/** Native pickers shared by the FAB (Documents screen) and the Upload page. */
import * as DocumentPicker from "expo-document-picker";
import * as FS from "expo-file-system/legacy";
import * as Print from "expo-print";
import DocumentScanner from "react-native-document-scanner-plugin";

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
}

/** File picker; [] when the user cancels. */
export async function pickFiles(): Promise<PickedFile[]> {
  const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
  if (result.canceled) return [];
  return result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType }));
}

/**
 * Document scanner. Every page of one scan session merges into a single PDF
 * (Papra OCRs image-only PDFs, so search loses nothing); single-page scans
 * become PDFs too, for consistency. [] when the user cancels.
 */
export async function scanDocuments(): Promise<PickedFile[]> {
  const { scannedImages, status } = await DocumentScanner.scanDocument();
  if (status !== "success" || !scannedImages?.length) return [];
  const pages: string[] = [];
  for (const raw of scannedImages) {
    const uri = raw.startsWith("file://") ? raw : `file://${raw}`;
    const b64 = await FS.readAsStringAsync(uri, { encoding: FS.EncodingType.Base64 });
    pages.push(`<img src="data:image/jpeg;base64,${b64}" />`);
    FS.deleteAsync(uri, { idempotent: true }).catch(() => {});
  }
  // Zero-margin pages, contain-fit: a portrait scan fills the page; unusual
  // aspect ratios letterbox instead of cropping or splitting across pages.
  const html = `<html><head><style>
    @page { margin: 0; }
    body { margin: 0; }
    img { width: 100%; height: 100vh; object-fit: contain; display: block; page-break-after: always; }
  </style></head><body>${pages.join("")}</body></html>`;
  const { uri } = await Print.printToFileAsync({ html });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  return [{ uri, name: `scan-${stamp}.pdf`, mimeType: "application/pdf" }];
}
