/** Print a document through the Android system print dialog (expo-print). */
import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Print from "expo-print";
import { getCachedDocument } from "./db";
import { ensureLocalFile } from "./sync";

/** True for the rejection expo-print throws when the user closes the dialog. */
export function isPrintCancel(e: unknown): boolean {
  return e instanceof Error && /did not complete|cancel/i.test(e.message);
}

/**
 * PDFs print directly; images ride a one-tag HTML page (the print engine only
 * takes PDF uris or HTML). Anything else is rejected with a clear message.
 */
export async function printDocument(id: string): Promise<void> {
  const uri = await ensureLocalFile(id);
  const mime = getCachedDocument(id)?.mimeType ?? "";
  if (mime === "application/pdf") {
    await Print.printAsync({ uri });
    return;
  }
  if (mime.startsWith("image/")) {
    const b64 = await FileSystemLegacy.readAsStringAsync(uri, {
      encoding: FileSystemLegacy.EncodingType.Base64,
    });
    await Print.printAsync({ html: `<img src="data:${mime};base64,${b64}" style="width:100%" />` });
    return;
  }
  throw new Error("Printing supports PDF and image documents only.");
}
