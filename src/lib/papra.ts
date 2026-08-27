/**
 * Minimal typed client for Papra's REST API.
 *
 * Auth is the better-auth session cookie.
 */
import * as Network from "expo-network";
import { AppState, ToastAndroid } from "react-native";
import { getAuthCookie } from "~/lib/auth";
import { getSettings, type Settings } from "~/lib/settings";

let lastOfflineToastAt = 0;

/**
 * The one offline notifier for every network-needing user action: when the
 * device is offline, show a small toast (throttled to one per burst, and only
 * while the app is in the foreground so background syncs stay silent).
 * Returns whether the device is offline.
 */
export async function notifyIfOffline(): Promise<boolean> {
  const state = await Network.getNetworkStateAsync().catch(() => null);
  const offline = state?.isConnected === false || state?.isInternetReachable === false;
  if (offline && AppState.currentState === "active" && Date.now() - lastOfflineToastAt > 3000) {
    lastOfflineToastAt = Date.now();
    try {
      ToastAndroid.show("You are offline - this action needs a connection", ToastAndroid.SHORT);
    } catch {
      /* toast is best effort */
    }
  }
  return offline;
}

export interface PapraTag {
  id: string;
  name: string;
  color: string;
  description?: string | null;
}

export interface PapraCustomProperty {
  key: string;
  name: string;
  type:
    | "text"
    | "number"
    | "date"
    | "boolean"
    | "select"
    | "multi_select"
    | "user_relation"
    | "document_relation";
  displayOrder: number;
  /** null when the property is not set on this document */
  value: unknown;
}

export interface PapraDocument {
  id: string;
  name: string;
  originalName?: string | null;
  mimeType: string;
  originalSize?: number | null;
  originalSha256Hash?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  deletedAt?: string | null;
  isDeleted?: boolean;
  content?: string | null;
  tags?: PapraTag[];
  customProperties?: PapraCustomProperty[];
}

export interface PapraOrganization {
  id: string;
  name: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function authHeaders(s: Settings): Promise<Record<string, string>> {
  const cookie = await getAuthCookie(s.serverUrl);
  return cookie ? { Cookie: cookie } : {};
}

interface RequestOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown; // JSON-serialized unless FormData
  settings?: Settings;
}

export async function papraRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const s = opts.settings ?? (await getSettings());
  if (!s.serverUrl) throw new ApiError(0, "No server configured");
  const url = new URL(`${s.serverUrl}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = await authHeaders(s);
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) {
    body = opts.body;
  } else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url.toString(), { method: opts.method ?? "GET", headers, body, credentials: "omit" });
  } catch (cause) {
    // Every screen action funnels through here, so this one check covers them all.
    if (await notifyIfOffline()) throw new ApiError(0, "You are offline");
    throw new ApiError(0, `Cannot reach ${s.serverUrl}`);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const json = (await res.json()) as { error?: { message?: string }; message?: string };
      message = json.error?.message ?? json.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function orgPath(s: Settings, rest: string): string {
  return `/api/organizations/${s.organizationId}${rest}`;
}

/** Server version from the public /api/config endpoint ("" when not exposed). */
export async function getServerVersion(): Promise<string> {
  const json = await papraRequest<{ config?: { version?: string } }>("/api/config");
  return json.config?.version ?? "";
}

export async function listOrganizations(settings?: Settings): Promise<PapraOrganization[]> {
  const json = await papraRequest<{ organizations: PapraOrganization[] }>("/api/organizations", { settings });
  return json.organizations ?? [];
}

export async function createOrganization(name: string, settings?: Settings): Promise<PapraOrganization> {
  const json = await papraRequest<{ organization: PapraOrganization }>("/api/organizations", {
    method: "POST",
    body: { name },
    settings,
  });
  return json.organization;
}

export interface DocumentPage {
  documents: PapraDocument[];
  documentsCount: number;
}

export interface PapraOrgStats {
  documentsCount: number;
  documentsSize: number;
  deletedDocumentsCount: number;
  deletedDocumentsSize: number;
  totalDocumentsCount: number;
  totalDocumentsSize: number;
}

export async function getDocumentsStatistics(): Promise<PapraOrgStats> {
  const s = await getSettings();
  const json = await papraRequest<{ organizationStats: PapraOrgStats }>(orgPath(s, "/documents/statistics"), {
    settings: s,
  });
  return json.organizationStats;
}

export type DocumentSortField = "createdAt" | "updatedAt" | "name" | "documentDate";
export type DocumentSortOrder = "asc" | "desc";

export async function listDocuments(
  {
    pageIndex = 0,
    pageSize = 100,
    searchQuery = "",
    sortField,
    sortOrder,
  }: {
    pageIndex?: number;
    pageSize?: number;
    searchQuery?: string;
    sortField?: DocumentSortField;
    sortOrder?: DocumentSortOrder;
  } = {},
  settings?: Settings,
): Promise<DocumentPage> {
  const s = settings ?? (await getSettings());
  return papraRequest<DocumentPage>(orgPath(s, "/documents"), {
    query: {
      pageIndex,
      pageSize,
      ...(searchQuery ? { searchQuery } : {}),
      ...(sortField ? { sortField, sortOrder: sortOrder ?? "desc" } : {}),
    },
    settings: s,
  });
}

export async function listDeletedDocuments({ pageIndex = 0, pageSize = 100 } = {}): Promise<DocumentPage> {
  const s = await getSettings();
  return papraRequest<DocumentPage>(orgPath(s, "/documents/deleted"), {
    query: { pageIndex, pageSize },
    settings: s,
  });
}

export async function getDocument(id: string): Promise<PapraDocument> {
  const s = await getSettings();
  const json = await papraRequest<{ document: PapraDocument }>(orgPath(s, `/documents/${id}`), { settings: s });
  return json.document ?? (json as unknown as PapraDocument);
}

export async function renameDocument(id: string, name: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/documents/${id}`), { method: "PATCH", body: { name }, settings: s });
}

export async function trashDocument(id: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/documents/${id}`), { method: "DELETE", settings: s });
}

export async function restoreDocument(id: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/documents/${id}/restore`), { method: "POST", settings: s });
}

export async function deleteDocumentForever(id: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/documents/trash/${id}`), { method: "DELETE", settings: s });
}

export async function emptyTrash(): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, "/documents/trash"), { method: "DELETE", settings: s });
}

export interface PapraDocumentView {
  id: string;
  name: string;
  query: string;
  description?: string | null;
}

/** Saved searches ("views" in the Papra web sidebar). Session-only routes. */
export async function listDocumentViews(): Promise<PapraDocumentView[]> {
  const s = await getSettings();
  const json = await papraRequest<{ documentViews: PapraDocumentView[] }>(orgPath(s, "/document-views"), {
    settings: s,
  });
  return json.documentViews ?? [];
}

export async function createDocumentView(input: { name: string; query: string }): Promise<PapraDocumentView> {
  const s = await getSettings();
  const json = await papraRequest<{ documentView: PapraDocumentView }>(orgPath(s, "/document-views"), {
    method: "POST",
    body: input,
    settings: s,
  });
  return json.documentView;
}

export async function deleteDocumentView(viewId: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/document-views/${viewId}`), { method: "DELETE", settings: s });
}

/** Batch move to trash; falls back to one-by-one on servers without the batch route. */
export async function batchTrashDocuments(documentIds: string[]): Promise<void> {
  const s = await getSettings();
  try {
    await papraRequest(orgPath(s, "/documents/batch/trash"), {
      method: "POST",
      body: { filter: { documentIds } },
      settings: s,
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      for (const id of documentIds) {
        await papraRequest(orgPath(s, `/documents/${id}`), { method: "DELETE", settings: s });
      }
      return;
    }
    throw e;
  }
}

/** Batch add/remove tags on many documents at once (server route, one request). */
export async function batchTagsDocuments(
  documentIds: string[],
  addTagIds: string[],
  removeTagIds: string[],
): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, "/documents/batch/tags"), {
    method: "POST",
    body: { filter: { documentIds }, addTagIds, removeTagIds },
    settings: s,
  });
}

export async function setDocumentPropertyValue(
  documentId: string,
  propertyDefinitionId: string,
  value: unknown,
): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/documents/${documentId}/custom-properties/${propertyDefinitionId}`), {
    method: "PUT",
    body: { value },
    settings: s,
  });
}

export async function clearDocumentPropertyValue(documentId: string, propertyDefinitionId: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/documents/${documentId}/custom-properties/${propertyDefinitionId}`), {
    method: "DELETE",
    settings: s,
  });
}

export async function listTags(): Promise<PapraTag[]> {
  const s = await getSettings();
  const json = await papraRequest<{ tags: PapraTag[] }>(orgPath(s, "/tags"), { settings: s });
  return json.tags ?? [];
}

export async function createTag(input: { name: string; color: string; description?: string }): Promise<PapraTag> {
  const s = await getSettings();
  const json = await papraRequest<{ tag: PapraTag }>(orgPath(s, "/tags"), { method: "POST", body: input, settings: s });
  return json.tag;
}

export async function updateTag(
  tagId: string,
  patch: { name?: string; color?: string; description?: string },
): Promise<PapraTag> {
  const s = await getSettings();
  const json = await papraRequest<{ tag: PapraTag }>(orgPath(s, `/tags/${tagId}`), {
    method: "PUT",
    body: patch,
    settings: s,
  });
  return json.tag;
}

export async function deleteTag(tagId: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/tags/${tagId}`), { method: "DELETE", settings: s });
}

/** Org-wide custom property definition (the /custom-properties module). */
export interface PapraCustomPropertyDefinition {
  id: string;
  name: string;
  key: string;
  description?: string | null;
  type: PapraCustomProperty["type"];
  displayOrder: number;
}

export async function listCustomProperties(): Promise<PapraCustomPropertyDefinition[]> {
  const s = await getSettings();
  const json = await papraRequest<{ propertyDefinitions: PapraCustomPropertyDefinition[] }>(
    orgPath(s, "/custom-properties"),
    { settings: s },
  );
  return json.propertyDefinitions ?? [];
}

/** `options` is required by the server for select / multi_select types. */
export async function createCustomProperty(input: {
  type: PapraCustomProperty["type"];
  name: string;
  description?: string;
  options?: { name: string }[];
}): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, "/custom-properties"), { method: "POST", body: input, settings: s });
}

/** Type is immutable server-side; omitting `options` keeps existing choices. */
export async function updateCustomProperty(
  id: string,
  patch: { name?: string; description?: string },
): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/custom-properties/${id}`), { method: "PUT", body: patch, settings: s });
}

export async function deleteCustomProperty(id: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/custom-properties/${id}`), { method: "DELETE", settings: s });
}

export async function addTagToDocument(documentId: string, tagId: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/documents/${documentId}/tags`), { method: "POST", body: { tagId }, settings: s });
}

export async function removeTagFromDocument(documentId: string, tagId: string): Promise<void> {
  const s = await getSettings();
  await papraRequest(orgPath(s, `/documents/${documentId}/tags/${tagId}`), { method: "DELETE", settings: s });
}

/** Upload a local file. RN FormData takes {uri, name, type}. */
export async function uploadDocument(file: { uri: string; name: string; mimeType?: string }): Promise<PapraDocument> {
  const s = await getSettings();
  const form = new FormData();
  form.append("file", {
    uri: file.uri,
    name: file.name,
    type: file.mimeType ?? "application/octet-stream",
  } as unknown as Blob);
  const json = await papraRequest<{ document: PapraDocument }>(orgPath(s, "/documents"), {
    method: "POST",
    body: form,
    settings: s,
  });
  return json.document ?? (json as unknown as PapraDocument);
}

/** Absolute URL of a document's file content (auth headers still required). */
export async function documentFileUrl(id: string): Promise<{ url: string; headers: Record<string, string> }> {
  const s = await getSettings();
  return { url: `${s.serverUrl}${orgPath(s, `/documents/${id}/file`)}`, headers: await authHeaders(s) };
}
