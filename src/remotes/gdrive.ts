/**
 * Google Drive adapter (Drive API v3).
 * Auth: user supplies a long-lived access token or refresh token + client credentials.
 * For production OAuth: obtain tokens once via Google Cloud Console OAuth client
 * and store the refresh token in the Remote config (encrypted by plugin data).
 */

import type { RemoteAdapter, RemoteFileMeta } from "./types";

export interface GDriveConfig {
  /** OAuth access token (short-lived) or use refresh flow */
  accessToken: string;
  /** Optional refresh token for automatic renewal */
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Folder ID that acts as the vault root on Drive. Empty = appDataFolder. */
  folderId?: string;
  /** Display name for the root folder when creating */
  folderName?: string;
}

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

export class GDriveAdapter implements RemoteAdapter {
  readonly id: string;
  readonly type = "google-drive";
  private cfg: GDriveConfig;
  private rootFolderId: string | null = null;
  /** path → fileId cache for this session */
  private pathToId = new Map<string, string>();

  constructor(id: string, cfg: GDriveConfig) {
    if (!cfg.accessToken && !(cfg.refreshToken && cfg.clientId && cfg.clientSecret)) {
      throw new Error(
        "Google Drive requires accessToken, or refreshToken + clientId + clientSecret"
      );
    }
    this.id = id;
    this.cfg = cfg;
  }

  private async ensureToken(): Promise<string> {
    if (this.cfg.accessToken) return this.cfg.accessToken;
    // Refresh
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId!,
        client_secret: this.cfg.clientSecret!,
        refresh_token: this.cfg.refreshToken!,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      throw new Error(`Google token refresh failed ${res.status}`);
    }
    const data = (await res.json()) as { access_token: string };
    this.cfg.accessToken = data.access_token;
    return data.access_token;
  }

  private async api(
    method: string,
    path: string,
    body?: unknown,
    isUpload = false
  ): Promise<Response> {
    const token = await this.ensureToken();
    const base = isUpload ? UPLOAD_API : DRIVE_API;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    let fetchBody: BodyInit | undefined;
    if (body instanceof Uint8Array) {
      fetchBody = body;
      headers["Content-Type"] = "application/octet-stream";
    } else if (body != null) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    }
    return fetch(`${base}${path}`, { method, headers, body: fetchBody });
  }

  private async ensureRoot(): Promise<string> {
    if (this.rootFolderId) return this.rootFolderId;
    if (this.cfg.folderId) {
      this.rootFolderId = this.cfg.folderId;
      return this.rootFolderId;
    }
    // Use appDataFolder
    this.rootFolderId = "appDataFolder";
    return this.rootFolderId;
  }

  /** Resolve or create nested folders and return the file/folder ID for a path */
  private async resolvePath(
    path: string,
    create = false
  ): Promise<{ id: string; isFolder: boolean } | null> {
    const cached = this.pathToId.get(path);
    if (cached) return { id: cached, isFolder: false };

    const parts = path.split("/").filter(Boolean);
    let parentId = await this.ensureRoot();

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;
      const q = encodeURIComponent(
        `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`
      );
      const res = await this.api("GET", `/files?q=${q}&fields=files(id,mimeType)&spaces=appDataFolder,drive`);
      if (!res.ok) throw new Error(`Drive list failed ${res.status}`);
      const data = (await res.json()) as { files: { id: string; mimeType: string }[] };
      if (data.files?.length) {
        parentId = data.files[0].id;
        if (isLast) {
          this.pathToId.set(path, parentId);
          return {
            id: parentId,
            isFolder: data.files[0].mimeType === "application/vnd.google-apps.folder",
          };
        }
      } else if (create) {
        const meta = {
          name,
          parents: [parentId],
          mimeType: isLast
            ? "application/octet-stream"
            : "application/vnd.google-apps.folder",
        };
        if (isLast) {
          // file will be created by put via multipart; just return parent for now
          return { id: parentId, isFolder: false };
        }
        const createRes = await this.api("POST", "/files?fields=id", meta);
        if (!createRes.ok) throw new Error(`Drive mkdir failed ${createRes.status}`);
        const created = (await createRes.json()) as { id: string };
        parentId = created.id;
      } else {
        return null;
      }
    }
    return { id: parentId, isFolder: true };
  }

  async testConnection(): Promise<boolean> {
    try {
      const token = await this.ensureToken();
      const res = await fetch(`${DRIVE_API}/about?fields=user`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async list(): Promise<RemoteFileMeta[]> {
    const root = await this.ensureRoot();
    const results: RemoteFileMeta[] = [];
    let pageToken: string | undefined;

    // Recursive listing via queue
    const queue: { id: string; prefix: string }[] = [{ id: root, prefix: "" }];

    while (queue.length) {
      const { id: folderId, prefix } = queue.shift()!;
      do {
        const params = new URLSearchParams({
          q: `'${folderId}' in parents and trashed = false`,
          fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum)",
          pageSize: "1000",
          spaces: root === "appDataFolder" ? "appDataFolder" : "drive",
        });
        if (pageToken) params.set("pageToken", pageToken);
        const res = await this.api("GET", `/files?${params}`);
        if (!res.ok) throw new Error(`Drive list failed ${res.status}`);
        const data = (await res.json()) as {
          nextPageToken?: string;
          files: {
            id: string;
            name: string;
            mimeType: string;
            size?: string;
            modifiedTime?: string;
            md5Checksum?: string;
          }[];
        };
        for (const f of data.files ?? []) {
          const path = prefix ? `${prefix}/${f.name}` : f.name;
          this.pathToId.set(path, f.id);
          if (f.mimeType === "application/vnd.google-apps.folder") {
            queue.push({ id: f.id, prefix: path });
          } else {
            results.push({
              path,
              size: parseInt(f.size ?? "0", 10),
              mtime: f.modifiedTime ? new Date(f.modifiedTime).getTime() : 0,
              etag: f.md5Checksum,
            });
          }
        }
        pageToken = data.nextPageToken;
      } while (pageToken);
      pageToken = undefined;
    }
    return results;
  }

  async get(path: string): Promise<Uint8Array> {
    let id = this.pathToId.get(path);
    if (!id) {
      const resolved = await this.resolvePath(path, false);
      if (!resolved || resolved.isFolder) throw new Error(`Drive file not found: ${path}`);
      id = resolved.id;
    }
    const res = await this.api("GET", `/files/${id}?alt=media`);
    if (!res.ok) throw new Error(`Drive GET ${path} failed ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(
    path: string,
    data: Uint8Array,
    mtime?: number
  ): Promise<RemoteFileMeta> {
    const parts = path.split("/");
    const name = parts.pop()!;
    const parentPath = parts.join("/");
    let parentId = await this.ensureRoot();
    if (parentPath) {
      // ensure parent folders
      const segs = parentPath.split("/");
      let cur = parentId;
      let curPath = "";
      for (const seg of segs) {
        curPath = curPath ? `${curPath}/${seg}` : seg;
        let existing = this.pathToId.get(curPath);
        if (!existing) {
          const q = encodeURIComponent(
            `'${cur}' in parents and name = '${seg.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
          );
          const res = await this.api("GET", `/files?q=${q}&fields=files(id)`);
          const data = (await res.json()) as { files: { id: string }[] };
          if (data.files?.[0]) {
            existing = data.files[0].id;
          } else {
            const createRes = await this.api("POST", "/files?fields=id", {
              name: seg,
              mimeType: "application/vnd.google-apps.folder",
              parents: [cur],
            });
            if (!createRes.ok) throw new Error(`Drive mkdir failed`);
            existing = ((await createRes.json()) as { id: string }).id;
          }
          this.pathToId.set(curPath, existing);
        }
        cur = existing;
      }
      parentId = cur;
    }

    // Check if file exists
    let fileId = this.pathToId.get(path);
    if (!fileId) {
      const q = encodeURIComponent(
        `'${parentId}' in parents and name = '${name.replace(/'/g, "\\'")}' and trashed = false`
      );
      const res = await this.api("GET", `/files?q=${q}&fields=files(id)`);
      const d = (await res.json()) as { files: { id: string }[] };
      fileId = d.files?.[0]?.id;
    }

    const metadata: Record<string, unknown> = { name };
    if (!fileId) metadata.parents = [parentId];

    // Multipart upload
    const boundary = "omnisync_" + Date.now();
    const metaPart = JSON.stringify(metadata);
    const bodyParts = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaPart}\r\n`,
      `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ];
    const encoder = new TextEncoder();
    const head = encoder.encode(bodyParts[0] + bodyParts[1]);
    const tail = encoder.encode(`\r\n--${boundary}--`);
    const full = new Uint8Array(head.length + data.length + tail.length);
    full.set(head, 0);
    full.set(data, head.length);
    full.set(tail, head.length + data.length);

    const token = await this.ensureToken();
    const uploadUrl = fileId
      ? `${UPLOAD_API}/files/${fileId}?uploadType=multipart`
      : `${UPLOAD_API}/files?uploadType=multipart`;
    const method = fileId ? "PATCH" : "POST";
    const res = await fetch(uploadUrl, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: full,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Drive PUT ${path} failed ${res.status}: ${t.slice(0, 200)}`);
    }
    const created = (await res.json()) as { id: string; modifiedTime?: string };
    this.pathToId.set(path, created.id);
    return {
      path,
      size: data.byteLength,
      mtime: mtime ?? (created.modifiedTime ? new Date(created.modifiedTime).getTime() : Date.now()),
    };
  }

  async delete(path: string): Promise<void> {
    let id = this.pathToId.get(path);
    if (!id) {
      const resolved = await this.resolvePath(path, false);
      if (!resolved) return;
      id = resolved.id;
    }
    const res = await this.api("DELETE", `/files/${id}`);
    if (!res.ok && res.status !== 404) {
      throw new Error(`Drive DELETE ${path} failed ${res.status}`);
    }
    this.pathToId.delete(path);
  }
}
