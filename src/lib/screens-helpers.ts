/** Shared glue between screens and the sync/db layer. */
import { upsertDocuments } from "./db";
import type { PapraDocument } from "./papra";

export { syncMetadata } from "./sync";

export function upsertFromSearch(documents: PapraDocument[]): void {
  upsertDocuments(documents);
}
