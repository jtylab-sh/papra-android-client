/**
 * Minimal typed client for Papra's REST API.
 *
 * Auth is either the better-auth session cookie (session mode) or an API key
 * as `Authorization: Bearer` (apiKey mode) — same routes either way.
 */
import { getAuthCookie } from "./auth";
import { getSettings, type Settings } from "./settings";

export interface PapraTag {
  id: string;
  name: string;
  color: string;
  description?: string | null;
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
  if (s.authMode === "apiKey") return { Authorization: `Bearer ${s.apiKey}` };
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

export async function listOrganizations(settings?: Settings): Promise<PapraOrganization[]> {
  const json = await papraRequest<{ organizations: PapraOrganization[] }>("/api/organizations", { settings });
  return json.organizations ?? [];
}

export interface DocumentPage {
  documents: PapraDocument[];
  documentsCount: number;
}

export async function listDocuments(
  { pageIndex = 0, pageSize = 100, searchQuery = "" } = {},
  settings?: Settings,
): Promise<DocumentPage> {
  const s = settings ?? (await getSettings());
  return papraRequest<DocumentPage>(orgPath(s, "/documents"), {
    query: { pageIndex, pageSize, ...(searchQuery ? { searchQuery } : {}) },
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

export async function listTags(): Promise<PapraTag[]> {
  const s = await getSettings();
  const json = await papraRequest<{ tags: PapraTag[] }>(orgPath(s, "/tags"), { settings: s });
  return json.tags ?? [];
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
