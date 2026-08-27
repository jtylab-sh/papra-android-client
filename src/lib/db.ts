/**
 * Local SQLite mirror of document metadata — the offline copy the list and
 * detail screens read first. Blobs live under the app's document directory;
 * `fileUri` points there once the sync job has downloaded a document.
 */
import * as SQLite from "expo-sqlite";
import type { PapraDocument, PapraTag } from "./papra";

export interface CachedDocument {
  id: string;
  name: string;
  originalName: string;
  mimeType: string;
  originalSize: number;
  sha256: string;
  createdAt: string;
  updatedAt: string;
  tags: PapraTag[];
  fileUri: string | null;
}

let db: SQLite.SQLiteDatabase | null = null;
let activeOrgId = "";

/**
 * Every organization gets its own database file (papra-<orgId>.db), so
 * switching orgs never wipes anything — each mirror lives side by side.
 * Called from settings load/save; must run before any query for the org.
 */
export function setActiveOrg(orgId: string): void {
  if (orgId === activeOrgId) return;
  try {
    db?.closeSync();
  } catch {
    /* already closed */
  }
  db = null;
  activeOrgId = orgId;
}

function activeDbName(): string {
  return activeOrgId ? `papra-${activeOrgId}.db` : "papra.db";
}

export function getDb(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync(activeDbName());
    db.execSync(`
      pragma journal_mode = wal;
      create table if not exists documents (
        id text primary key,
        name text not null,
        originalName text not null default '',
        mimeType text not null default '',
        originalSize integer not null default 0,
        sha256 text not null default '',
        createdAt text not null default '',
        updatedAt text not null default '',
        tagsJson text not null default '[]',
        fileUri text
      );
      create table if not exists meta (key text primary key, value text not null);
    `);
  }
  return db;
}

function toCached(row: Record<string, unknown>): CachedDocument {
  return {
    id: row.id as string,
    name: row.name as string,
    originalName: row.originalName as string,
    mimeType: row.mimeType as string,
    originalSize: row.originalSize as number,
    sha256: row.sha256 as string,
    createdAt: row.createdAt as string,
    updatedAt: row.updatedAt as string,
    tags: JSON.parse((row.tagsJson as string) || "[]") as PapraTag[],
    fileUri: (row.fileUri as string) ?? null,
  };
}

export function upsertDocuments(docs: PapraDocument[]): void {
  const d = getDb();
  const stmt = d.prepareSync(`
    insert into documents (id, name, originalName, mimeType, originalSize, sha256, createdAt, updatedAt, tagsJson)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      name = excluded.name, originalName = excluded.originalName, mimeType = excluded.mimeType,
      originalSize = excluded.originalSize, sha256 = excluded.sha256,
      createdAt = excluded.createdAt, updatedAt = excluded.updatedAt, tagsJson = excluded.tagsJson
  `);
  try {
    d.withTransactionSync(() => {
      for (const doc of docs) {
        stmt.executeSync([
          doc.id,
          doc.name,
          doc.originalName ?? "",
          doc.mimeType,
          doc.originalSize ?? 0,
          doc.originalSha256Hash ?? "",
          doc.createdAt,
          doc.updatedAt ?? "",
          JSON.stringify(doc.tags ?? []),
        ]);
      }
    });
  } finally {
    stmt.finalizeSync();
  }
}

/** synced: true = only downloaded, false = only not yet downloaded, undefined = all. */
function whereClause(search: string, synced?: boolean): { where: string; args: string[] } {
  const conds: string[] = [];
  const args: string[] = [];
  if (search) {
    conds.push("(name like ? or originalName like ?)");
    args.push(`%${search}%`, `%${search}%`);
  }
  if (synced === true) conds.push("fileUri is not null");
  if (synced === false) conds.push("fileUri is null");
  return { where: conds.length ? ` where ${conds.join(" and ")}` : "", args };
}

export interface CacheSort {
  field: "createdAt" | "updatedAt" | "name";
  order: "asc" | "desc";
}

// Whitelisted order-by fragments — sort input never reaches SQL directly.
const ORDER_SQL: Record<CacheSort["field"], string> = {
  createdAt: "createdAt",
  updatedAt: "updatedAt",
  name: "name collate nocase",
};

export function listCachedDocuments(
  search = "",
  limit = -1,
  offset = 0,
  synced?: boolean,
  sort?: CacheSort,
): CachedDocument[] {
  // limit -1 = no limit (SQLite convention); offset only applies with a limit.
  const { where, args } = whereClause(search, synced);
  const orderBy = sort ? `${ORDER_SQL[sort.field]} ${sort.order === "asc" ? "asc" : "desc"}` : "createdAt desc";
  const rows = getDb().getAllSync(`select * from documents${where} order by ${orderBy} limit ? offset ?`, [
    ...args,
    limit,
    offset,
  ]);
  return (rows as Record<string, unknown>[]).map(toCached);
}

export function countCachedDocuments(search = "", synced?: boolean): number {
  const { where, args } = whereClause(search, synced);
  const row = getDb().getFirstSync(`select count(*) as n from documents${where}`, args) as { n: number } | null;
  return row?.n ?? 0;
}

export function getCachedDocument(id: string): CachedDocument | null {
  const row = getDb().getFirstSync("select * from documents where id = ?", [id]);
  return row ? toCached(row as Record<string, unknown>) : null;
}

export function setDocumentFileUri(id: string, fileUri: string | null): void {
  getDb().runSync("update documents set fileUri = ? where id = ?", [fileUri, id]);
}

/** Remove rows not in keepIds; returns the fileUris of the removed rows so the caller can delete blobs. */
export function pruneDocuments(keepIds: string[]): string[] {
  const d = getDb();
  const keep = new Set(keepIds);
  const rows = d.getAllSync("select id, fileUri from documents") as { id: string; fileUri: string | null }[];
  const removedUris: string[] = [];
  d.withTransactionSync(() => {
    for (const row of rows) {
      if (!keep.has(row.id)) {
        d.runSync("delete from documents where id = ?", [row.id]);
        if (row.fileUri) removedUris.push(row.fileUri);
      }
    }
  });
  return removedUris;
}

export function getMeta(key: string): string | null {
  const row = getDb().getFirstSync("select value from meta where key = ?", [key]) as { value: string } | null;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  getDb().runSync("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", [
    key,
    value,
  ]);
}

/** Drop every fileUri pointer + exported markers; caller deletes the blobs. */
export function clearFileUris(): string[] {
  const d = getDb();
  const rows = d.getAllSync("select fileUri from documents where fileUri is not null") as { fileUri: string }[];
  d.runSync("update documents set fileUri = null");
  d.runSync("delete from meta where key like 'exported:%'");
  return rows.map((r) => r.fileUri);
}

/** Wipe everything (server switch / sign-out). */
export function clearCache(): string[] {
  const d = getDb();
  const rows = d.getAllSync("select fileUri from documents where fileUri is not null") as { fileUri: string }[];
  d.execSync("delete from documents; delete from meta;");
  return rows.map((r) => r.fileUri);
}
