/**
 * OneDrive / Microsoft Graph adapter.
 * Auth: access token (or refresh token + client credentials).
 */

import type { RemoteAdapter, RemoteFileMeta } from "./types";

export interface OneDriveConfig {
  accessToken: string;
  refreshToken?: string;
  clientId?: string;
  clientSecret?: string;
  /** Tenant, default "common" */
  tenant?: string;
  /** Root folder path inside OneDrive, e.g. "OmniSync" */
  rootFolder?: string;
}

const GRAPH = "https://graph.microsoft.com/v1.0";

export class OneDriveAdapter implements RemoteAdapter {
  readonly id: string;
  readonly type = "onedrive";
  private cfg: OneDriveConfig;
  private rootPath: string;

  constructor(id: string, cfg: OneDriveConfig) {
    if (!cfg.accessToken && !(cfg.refreshToken && cfg.clientId)) {
      throw new Error(
        "OneDrive requires accessToken, or refreshToken + clientId"
      );
    }
    this.id = id;
    this.cfg = cfg;
    this.rootPath = (cfg.rootFolder ?? "OmniSync").replace(/^\/+|\/+$/g, "");
  }

  private async ensureToken(): Promise<string> {
    if (this.cfg.accessToken) return this.cfg.accessToken;
    const tenant = this.cfg.tenant ?? "common";
    const res = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.cfg.clientId!,
          ...(this.cfg.clientSecret
            ? { client_secret: this.cfg.clientSecret }
            : {}),
          refresh_token: this.cfg.refreshToken!,
          grant_type: "refresh_token",
          scope: "https://graph.microsoft.com/.default offline_access Files.ReadWrite",
        }),
      }
    );
    if (!res.ok) throw new Error(`OneDrive token refresh failed ${res.status}`);
    const data = (await res.json()) as { access_token: string };
    this.cfg.accessToken = data.access_token;
    return data.access_token;
  }

  private async api(
    method: string,
    path: string,
    body?: Uint8Array | object | null,
    contentType?: string
  ): Promise<Response> {
    const token = await this.ensureToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    let fetchBody: BodyInit | undefined;
    if (body instanceof Uint8Array) {
      const copy = new Uint8Array(body.byteLength);
      copy.set(body);
      fetchBody = copy;
      headers["Content-Type"] = contentType ?? "application/octet-stream";
    } else if (body != null) {
      headers["Content-Type"] = "application/json";
      fetchBody = JSON.stringify(body);
    }
    return fetch(`${GRAPH}${path}`, { method, headers, body: fetchBody });
  }

  private itemPath(path: string): string {
    const full = this.rootPath ? `${this.rootPath}/${path}` : path;
    // Graph path encoding: each segment encoded
    return full
      .split("/")
      .filter(Boolean)
      .map((s) => encodeURIComponent(s))
      .join("/");
  }

  async testConnection(): Promise<boolean> {
    try {
      const res = await this.api("GET", "/me/drive");
      return res.ok;
    } catch {
      return false;
    }
  }

  async list(): Promise<RemoteFileMeta[]> {
    // Ensure root folder exists
    await this.ensureRootFolder();
    const results: RemoteFileMeta[] = [];
    const queue: string[] = [this.rootPath];

    while (queue.length) {
      const folder = queue.shift()!;
      let url = `/me/drive/root:/${this.itemPath(folder === this.rootPath ? "" : folder.replace(this.rootPath + "/", ""))}:/children?$top=1000&$select=id,name,size,lastModifiedDateTime,file,folder`;
      // simpler: always relative to root
      const rel = folder === this.rootPath ? this.rootPath : folder;
      url = `/me/drive/root:/${rel
        .split("/")
        .map(encodeURIComponent)
        .join("/")}:/children?$top=1000`;

      let next: string | undefined = url;
      while (next) {
        const res = next.startsWith("http")
          ? await fetch(next, {
              headers: { Authorization: `Bearer ${await this.ensureToken()}` },
            })
          : await this.api("GET", next);
        if (!res.ok) {
          if (res.status === 404) break;
          throw new Error(`OneDrive list failed ${res.status}`);
        }
        const data = (await res.json()) as {
          value: {
            name: string;
            size?: number;
            lastModifiedDateTime?: string;
            file?: unknown;
            folder?: unknown;
            "@microsoft.graph.downloadUrl"?: string;
          }[];
          "@odata.nextLink"?: string;
        };
        for (const item of data.value ?? []) {
          const path =
            folder === this.rootPath
              ? item.name
              : `${folder.replace(this.rootPath + "/", "")}/${item.name}`.replace(
                  /^\//,
                  ""
                );
          // normalize: path relative to vault root (under OmniSync/)
          const vaultPath =
            folder === this.rootPath
              ? item.name
              : path;

          if (item.folder) {
            queue.push(
              folder === this.rootPath
                ? `${this.rootPath}/${item.name}`
                : `${folder}/${item.name}`
            );
          } else if (item.file) {
            results.push({
              path: vaultPath,
              size: item.size ?? 0,
              mtime: item.lastModifiedDateTime
                ? new Date(item.lastModifiedDateTime).getTime()
                : 0,
            });
          }
        }
        next = data["@odata.nextLink"];
      }
    }
    return results;
  }

  private async ensureRootFolder(): Promise<void> {
    if (!this.rootPath) return;
    const res = await this.api(
      "GET",
      `/me/drive/root:/${encodeURIComponent(this.rootPath)}`
    );
    if (res.ok) return;
    // create
    await this.api("POST", "/me/drive/root/children", {
      name: this.rootPath,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    });
  }

  async get(path: string): Promise<Uint8Array> {
    const full = this.rootPath ? `${this.rootPath}/${path}` : path;
    const encoded = full
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const res = await this.api("GET", `/me/drive/root:/${encoded}:/content`);
    if (!res.ok) throw new Error(`OneDrive GET ${path} failed ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(
    path: string,
    data: Uint8Array,
    mtime?: number
  ): Promise<RemoteFileMeta> {
    const full = this.rootPath ? `${this.rootPath}/${path}` : path;
    const encoded = full
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    // Simple upload (< 4 MB) or create upload session for larger
    if (data.byteLength < 4 * 1024 * 1024) {
      const res = await this.api(
        "PUT",
        `/me/drive/root:/${encoded}:/content`,
        data
      );
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`OneDrive PUT ${path} failed ${res.status}: ${t.slice(0, 200)}`);
      }
      const meta = (await res.json()) as {
        size?: number;
        lastModifiedDateTime?: string;
      };
      return {
        path,
        size: meta.size ?? data.byteLength,
        mtime: mtime ?? (meta.lastModifiedDateTime
          ? new Date(meta.lastModifiedDateTime).getTime()
          : Date.now()),
      };
    }
    // Upload session for large files
    const sessionRes = await this.api(
      "POST",
      `/me/drive/root:/${encoded}:/createUploadSession`,
      {
        item: {
          "@microsoft.graph.conflictBehavior": "replace",
        },
      }
    );
    if (!sessionRes.ok) throw new Error(`OneDrive upload session failed`);
    const { uploadUrl } = (await sessionRes.json()) as { uploadUrl: string };
    const chunkSize = 320 * 1024 * 10; // 3.2 MB
    let offset = 0;
    while (offset < data.byteLength) {
      const end = Math.min(offset + chunkSize, data.byteLength);
      const chunk = data.subarray(offset, end);
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.byteLength),
          "Content-Range": `bytes ${offset}-${end - 1}/${data.byteLength}`,
        },
        body: (() => { const c = new Uint8Array(chunk.byteLength); c.set(chunk); return c; })(),
      });
      if (!res.ok && res.status !== 202) {
        throw new Error(`OneDrive chunk upload failed ${res.status}`);
      }
      offset = end;
    }
    return {
      path,
      size: data.byteLength,
      mtime: mtime ?? Date.now(),
    };
  }

  async delete(path: string): Promise<void> {
    const full = this.rootPath ? `${this.rootPath}/${path}` : path;
    const encoded = full
      .split("/")
      .map(encodeURIComponent)
      .join("/");
    const res = await this.api("DELETE", `/me/drive/root:/${encoded}`);
    if (!res.ok && res.status !== 404) {
      throw new Error(`OneDrive DELETE ${path} failed ${res.status}`);
    }
  }
}
