/**
 * Core sync engine – production ready.
 * Direction, Conflict Policy, Filters, concurrency, deletes, Fast Path (hash skip).
 */

import { App, TFile, Notice } from "obsidian";
import type {
  OmniSyncSettings,
  ConflictPolicy,
} from "../types";
import { LocalIndex } from "../index/local-index";
import type { RemoteAdapter, RemoteFileMeta } from "../remotes/types";
import { encrypt, decrypt, contentHash } from "../crypto/e2ee";
import { createRemoteAdapter } from "../remotes/factory";
import {
  shouldAttemptDiff,
  buildLinePatch,
  applyLinePatch,
  encodePatch,
  decodePatch,
  isTextPath,
} from "./diff";

/** Session-only plaintext snapshots for differential (never synced) */
const textSnapshots = new Map<string, string>();

export interface SyncResult {
  uploaded: number;
  downloaded: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
  skipped: number;
  errors: string[];
}

function emptyResult(): SyncResult {
  return {
    uploaded: 0,
    downloaded: 0,
    deletedRemote: 0,
    deletedLocal: 0,
    conflicts: 0,
    skipped: 0,
    errors: [],
  };
}

/** Simple concurrency pool */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export class SyncEngine {
  private running = false;
  private masterKey: Uint8Array | null = null;

  constructor(
    private app: App,
    private settings: OmniSyncSettings,
    private index: LocalIndex,
    private getMasterKey: () => Promise<Uint8Array | null>
  ) {}

  async run(reason: string = "manual"): Promise<SyncResult> {
    if (this.running) {
      new Notice("OmniSync is already running");
      return emptyResult();
    }
    this.running = true;
    const result = emptyResult();

    try {
      const key = await this.getMasterKey();
      if (!key) {
        new Notice("OmniSync: unlock with your Recovery Key first");
        return result;
      }
      this.masterKey = key;

      const remote = this.resolveActiveRemote();
      if (!remote) {
        new Notice("OmniSync: no active Remote configured");
        return result;
      }

      new Notice(`OmniSync: starting (${reason})…`);

      const localFiles = await this.collectLocalFiles();
      const remoteFiles = await remote.list();
      const remoteMap = new Map(remoteFiles.map((r) => [r.path, r]));

      const direction = this.settings.direction;
      const policy = this.settings.conflictPolicy;
      const concurrency =
        this.settings.threadLimit ??
        (typeof navigator !== "undefined" &&
        /Mobile|Android|iPhone/i.test(navigator.userAgent)
          ? 3
          : 6);

      if (
        direction === "bidirectional" ||
        direction.startsWith("incremental-push")
      ) {
        await this.pushChanges(
          localFiles,
          remoteMap,
          remote,
          policy,
          concurrency,
          result
        );
      }
      if (
        direction === "bidirectional" ||
        direction.startsWith("incremental-pull")
      ) {
        await this.pullChanges(
          localFiles,
          remoteFiles,
          remote,
          policy,
          concurrency,
          result
        );
      }
      if (direction === "incremental-push-delete") {
        await this.deleteRemoteExtras(localFiles, remoteFiles, remote, result);
      }
      if (direction === "incremental-pull-delete") {
        await this.deleteLocalExtras(localFiles, remoteMap, result);
      }

      new Notice(
        `OmniSync done: ↑${result.uploaded} ↓${result.downloaded} ✕${result.deletedRemote + result.deletedLocal} ⚠${result.conflicts} (skip ${result.skipped})`
      );
    } catch (e: any) {
      result.errors.push(e?.message ?? String(e));
      new Notice(`OmniSync error: ${e?.message ?? e}`);
      console.error("[OmniSync]", e);
    } finally {
      this.running = false;
      this.masterKey = null;
    }
    return result;
  }

  private resolveActiveRemote(): RemoteAdapter | null {
    const id = this.settings.activeRemoteId;
    if (!id) return null;
    const cfg = this.settings.remotes.find((r) => r.id === id);
    if (!cfg) return null;
    try {
      return createRemoteAdapter(cfg);
    } catch (e) {
      console.error("[OmniSync] failed to create adapter", e);
      return null;
    }
  }

  private async collectLocalFiles(): Promise<Map<string, TFile>> {
    const map = new Map<string, TFile>();
    for (const f of this.app.vault.getFiles()) {
      if (this.shouldSync(f.path)) map.set(f.path, f);
    }
    return map;
  }

  shouldSync(path: string): boolean {
    const f = this.settings.filters;
    if (path.startsWith(".omnisync-conflicts/")) return false;
    if (path.includes("/.obsidian/plugins/omnisync")) return false;

    if (path.startsWith(".obsidian/")) {
      if (path.includes("/themes/") || path.includes("/snippets/")) {
        if (!f.syncThemesAndSnippets) return false;
      } else if (path.includes("/plugins/")) {
        if (!f.syncCommunityPlugins) return false;
      } else if (!f.syncCoreSettings) {
        return false;
      }
    }

    for (const ex of f.excludeFolders) {
      if (path === ex || path.startsWith(ex + "/")) return false;
    }
    for (const re of f.ignoreRegex) {
      try {
        if (new RegExp(re).test(path)) return false;
      } catch {
        /* ignore bad regex */
      }
    }
    if (f.allowRegex.length > 0) {
      let ok = false;
      for (const re of f.allowRegex) {
        try {
          if (new RegExp(re).test(path)) {
            ok = true;
            break;
          }
        } catch {
          /* ignore */
        }
      }
      if (!ok) return false;
    }
    for (const inc of f.includeFolders) {
      if (path === inc || path.startsWith(inc + "/")) return true;
    }
    return true;
  }

  private async pushChanges(
    local: Map<string, TFile>,
    remoteMap: Map<string, RemoteFileMeta>,
    remote: RemoteAdapter,
    policy: ConflictPolicy,
    concurrency: number,
    result: SyncResult
  ): Promise<void> {
    const key = this.masterKey!;
    const algo = this.settings.e2eeAlgorithm;
    const entries = [...local.entries()];

    await mapPool(entries, concurrency, async ([path, file]) => {
      try {
        const data = new Uint8Array(await this.app.vault.readBinary(file));
        const changed = await this.index.hasChanged(
          path,
          data,
          file.stat.mtime
        );
        if (!changed) {
          result.skipped++;
          return;
        }

        const remoteMeta = remoteMap.get(path);
        if (remoteMeta) {
          const localNewer = file.stat.mtime > remoteMeta.mtime;
          const localLarger = data.byteLength > remoteMeta.size;
          const localWins =
            policy === "newer-survives" ? localNewer : localLarger;
          if (!localWins) {
            await this.preserveConflict(path, data);
            result.conflicts++;
            return;
          }
        }

        // Hybrid Fast Path: try line-patch for large text when we have a snapshot
        let payload = data;
        const prev = textSnapshots.get(path);
        if (
          prev != null &&
          shouldAttemptDiff(path, data.byteLength, prev.length) &&
          isTextPath(path)
        ) {
          try {
            const newText = new TextDecoder().decode(data);
            const baseHash = await contentHash(
              new TextEncoder().encode(prev)
            );
            const patch = buildLinePatch(prev, newText, baseHash);
            if (patch) {
              const encoded = encodePatch(patch);
              if (encoded.byteLength < data.byteLength * 0.5) {
                // Prefix magic so pull can detect patch payloads after decrypt
                const magic = new TextEncoder().encode("OMNIPATCH1");
                payload = new Uint8Array(magic.length + encoded.length);
                payload.set(magic, 0);
                payload.set(encoded, magic.length);
              }
            }
          } catch {
            payload = data;
          }
        }

        const sealed = await encrypt(payload, key, algo);
        await remote.put(path, sealed, file.stat.mtime);
        const entry = await this.index.makeEntry(path, data, file.stat.mtime);
        this.index.set(entry);
        if (isTextPath(path) && data.byteLength < 2_000_000) {
          try {
            textSnapshots.set(path, new TextDecoder().decode(data));
          } catch {
            /* binary misdetected */
          }
        }
        result.uploaded++;
      } catch (e: any) {
        result.errors.push(`push ${path}: ${e?.message ?? e}`);
      }
    });
  }

  private async pullChanges(
    local: Map<string, TFile>,
    remoteList: RemoteFileMeta[],
    remote: RemoteAdapter,
    policy: ConflictPolicy,
    concurrency: number,
    result: SyncResult
  ): Promise<void> {
    const key = this.masterKey!;
    const algo = this.settings.e2eeAlgorithm;
    const toPull = remoteList.filter((m) => this.shouldSync(m.path));

    await mapPool(toPull, concurrency, async (meta) => {
      try {
        const localFile = local.get(meta.path);
        if (localFile) {
          const localData = new Uint8Array(
            await this.app.vault.readBinary(localFile)
          );
          const localNewer = localFile.stat.mtime > meta.mtime;
          const localLarger = localData.byteLength > meta.size;
          const localWins =
            policy === "newer-survives" ? localNewer : localLarger;
          if (localWins) {
            result.skipped++;
            return;
          }
          await this.preserveConflict(meta.path, localData);
          result.conflicts++;
        }

        const sealed = await remote.get(meta.path);
        let plain = await decrypt(sealed, key, algo);

        // Apply line-patch Fast Path if payload is a patch envelope
        const magic = new TextEncoder().encode("OMNIPATCH1");
        if (
          plain.byteLength > magic.length &&
          magic.every((b, i) => plain[i] === b)
        ) {
          const patchBody = plain.slice(magic.length);
          const patch = decodePatch(patchBody);
          const base =
            textSnapshots.get(meta.path) ??
            (localFile
              ? new TextDecoder().decode(
                  new Uint8Array(await this.app.vault.readBinary(localFile))
                )
              : null);
          if (patch && base != null) {
            const applied = applyLinePatch(base, patch);
            plain = new TextEncoder().encode(applied);
          } else {
            // Cannot apply patch without base – skip and keep local
            result.errors.push(
              `pull ${meta.path}: patch received but no base snapshot`
            );
            return;
          }
        }

        if (isTextPath(meta.path) && plain.byteLength < 2_000_000) {
          try {
            textSnapshots.set(meta.path, new TextDecoder().decode(plain));
          } catch {
            /* ignore */
          }
        }

        // Ensure parent folders exist
        const parent = meta.path.includes("/")
          ? meta.path.replace(/\/[^/]+$/, "")
          : "";
        if (parent) {
          await this.app.vault.adapter.mkdir(parent).catch(() => {});
        }
        await this.app.vault.adapter.writeBinary(
          meta.path,
          plain.buffer.slice(
            plain.byteOffset,
            plain.byteOffset + plain.byteLength
          ) as ArrayBuffer
        );
        const entry = await this.index.makeEntry(
          meta.path,
          plain,
          meta.mtime,
          meta.etag
        );
        this.index.set(entry);
        result.downloaded++;
      } catch (e: any) {
        result.errors.push(`pull ${meta.path}: ${e?.message ?? e}`);
      }
    });
  }

  private async deleteRemoteExtras(
    local: Map<string, TFile>,
    remoteList: RemoteFileMeta[],
    remote: RemoteAdapter,
    result: SyncResult
  ): Promise<void> {
    for (const meta of remoteList) {
      if (!this.shouldSync(meta.path)) continue;
      if (local.has(meta.path)) continue;
      try {
        await remote.delete(meta.path);
        this.index.delete(meta.path);
        result.deletedRemote++;
      } catch (e: any) {
        result.errors.push(`delete-remote ${meta.path}: ${e?.message ?? e}`);
      }
    }
  }

  private async deleteLocalExtras(
    local: Map<string, TFile>,
    remoteMap: Map<string, RemoteFileMeta>,
    result: SyncResult
  ): Promise<void> {
    for (const [path] of local) {
      if (remoteMap.has(path)) continue;
      try {
        await this.app.vault.adapter.remove(path);
        this.index.delete(path);
        result.deletedLocal++;
      } catch (e: any) {
        result.errors.push(`delete-local ${path}: ${e?.message ?? e}`);
      }
    }
  }

  private async preserveConflict(
    path: string,
    data: Uint8Array
  ): Promise<void> {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const safe = path.replace(/\//g, "__");
    const conflictPath = `.omnisync-conflicts/${ts}_${safe}`;
    await this.app.vault.adapter.mkdir(".omnisync-conflicts").catch(() => {});
    await this.app.vault.adapter.writeBinary(
      conflictPath,
      data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength
      ) as ArrayBuffer
    );
  }
}
