/** Native pickers shared by the FAB (Documents screen) and the Upload page. */
import * as DocumentPicker from "expo-document-picker";
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

/** Document scanner; [] when the user cancels. */
export async function scanDocuments(): Promise<PickedFile[]> {
  const { scannedImages, status } = await DocumentScanner.scanDocument();
  if (status !== "success" || !scannedImages?.length) return [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return scannedImages.map((uri, i) => ({
    uri: uri.startsWith("file://") ? uri : `file://${uri}`,
    name: `scan-${stamp}${scannedImages.length > 1 ? `-${i + 1}` : ""}.jpg`,
    mimeType: "image/jpeg",
  }));
}
