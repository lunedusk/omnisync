/**
 * Full S3-compatible adapter (AWS S3, Cloudflare R2, Backblaze B2, MinIO, …)
 * Uses pure Web Crypto SigV4 – no AWS SDK.
 */

import type { RemoteAdapter, RemoteFileMeta } from "./types";
import { signRequest } from "./sigv4";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  prefix?: string;
  /** path-style (MinIO, some R2) vs virtual-hosted */
  forcePathStyle?: boolean;
}

function joinUrl(base: string, ...parts: string[]): string {
  let u = base.replace(/\/+$/, "");
  for (const p of parts) {
    if (!p) continue;
    u += "/" + p.replace(/^\/+/, "");
  }
  return u;
}

export class S3Adapter implements RemoteAdapter {
  readonly id: string;
  readonly type = "s3";
  private cfg: Required<
    Pick<S3Config, "endpoint" | "region" | "bucket" | "accessKeyId" | "secretAccessKey">
  > &
    S3Config;

  constructor(id: string, cfg: S3Config) {
    if (!cfg.endpoint || !cfg.bucket || !cfg.accessKeyId || !cfg.secretAccessKey) {
      throw new Error("S3 config requires endpoint, bucket, accessKeyId, secretAccessKey");
    }
    this.id = id;
    this.cfg = {
      ...cfg,
      region: cfg.region || "auto",
      prefix: (cfg.prefix ?? "omnisync").replace(/\/$/, ""),
      forcePathStyle: cfg.forcePathStyle ?? false,
    };
  }

  private objectKey(path: string): string {
    return `${this.cfg.prefix}/${path}`.replace(/\/+/g, "/");
  }

  private objectUrl(key: string): string {
    const endpoint = this.cfg.endpoint.replace(/\/+$/, "");
    if (this.cfg.forcePathStyle) {
      return joinUrl(endpoint, this.cfg.bucket, key);
    }
    // virtual-hosted-style: https://bucket.endpoint/key
    try {
      const u = new URL(endpoint);
      return `${u.protocol}//${this.cfg.bucket}.${u.host}/${key}`;
    } catch {
      return joinUrl(endpoint, this.cfg.bucket, key);
    }
  }

  private async signedFetch(
    method: string,
    url: string,
    body?: Uint8Array | null,
    extraHeaders?: Record<string, string>
  ): Promise<Response> {
    const signed = await signRequest({
      method,
      url,
      region: this.cfg.region,
      service: "s3",
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
      sessionToken: this.cfg.sessionToken,
      body: body ?? null,
      headers: {
        ...(body ? { "content-type": "application/octet-stream" } : {}),
        ...extraHeaders,
      },
      unsignedPayload: false,
    });

    const res = await fetch(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: signed.body ? (signed.body as BodyInit) : undefined,
    });
    return res;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.list();
      return true;
    } catch {
      return false;
    }
  }

  async list(): Promise<RemoteFileMeta[]> {
    const results: RemoteFileMeta[] = [];
    let continuationToken: string | undefined;

    do {
      const prefix = this.cfg.prefix + "/";
      const params = new URLSearchParams({
        "list-type": "2",
        prefix,
        "max-keys": "1000",
      });
      if (continuationToken) {
        params.set("continuation-token", continuationToken);
      }

      const base = this.cfg.forcePathStyle
        ? joinUrl(this.cfg.endpoint.replace(/\/+$/, ""), this.cfg.bucket)
        : (() => {
            const u = new URL(this.cfg.endpoint);
            return `${u.protocol}//${this.cfg.bucket}.${u.host}`;
          })();

      const url = `${base}?${params.toString()}`;
      const res = await this.signedFetch("GET", url);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`S3 ListObjectsV2 failed ${res.status}: ${text.slice(0, 200)}`);
      }

      const xml = await res.text();
      const contents = [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)];
      for (const m of contents) {
        const block = m[1];
        const key = block.match(/<Key>([^<]+)<\/Key>/)?.[1];
        if (!key || !key.startsWith(prefix)) continue;
        const path = key.slice(prefix.length);
        if (!path || path.endsWith("/")) continue;
        const size = parseInt(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? "0", 10);
        const lastMod = block.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1];
        const etag = block.match(/<ETag>"?([^"<]+)"?<\/ETag>/)?.[1];
        results.push({
          path,
          size,
          mtime: lastMod ? new Date(lastMod).getTime() : 0,
          etag,
        });
      }

      const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(xml);
      continuationToken = isTruncated
        ? xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
        : undefined;
    } while (continuationToken);

    return results;
  }

  async get(path: string): Promise<Uint8Array> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const res = await this.signedFetch("GET", url);
    if (!res.ok) {
      throw new Error(`S3 GET ${path} failed ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  }

  async put(
    path: string,
    data: Uint8Array,
    mtime?: number
  ): Promise<RemoteFileMeta> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const headers: Record<string, string> = {};
    if (mtime != null) {
      headers["x-amz-meta-mtime"] = String(mtime);
    }
    const res = await this.signedFetch("PUT", url, data, headers);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`S3 PUT ${path} failed ${res.status}: ${text.slice(0, 200)}`);
    }
    const etag = res.headers.get("etag")?.replace(/"/g, "") ?? undefined;
    return {
      path,
      size: data.byteLength,
      mtime: mtime ?? Date.now(),
      etag,
    };
  }

  async delete(path: string): Promise<void> {
    const key = this.objectKey(path);
    const url = this.objectUrl(key);
    const res = await this.signedFetch("DELETE", url);
    if (!res.ok && res.status !== 404) {
      throw new Error(`S3 DELETE ${path} failed ${res.status}`);
    }
  }
}
