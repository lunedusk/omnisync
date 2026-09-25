/**
 * Local Index – ADR 0002
 * Lives entirely outside the vault (plugin private data).
 * Stores path → { hash, size, mtime, remoteEtag }
 */

import type { IndexEntry } from "../types";
import { contentHash } from "../crypto/e2ee";

export class LocalIndex {
  private entries = new Map<string, IndexEntry>();
  private dirty = false;

  constructor(private pluginDataPath: string) {}

  async load(data: Record<string, IndexEntry> | null): Promise<void> {
    this.entries.clear();
    if (data) {
      for (const [path, entry] of Object.entries(data)) {
        this.entries.set(path, entry);
      }
    }
    this.dirty = false;
  }

  toJSON(): Record<string, IndexEntry> {
    const out: Record<string, IndexEntry> = {};
    for (const [path, entry] of this.entries) {
      out[path] = entry;
    }
    return out;
  }

  get(path: string): IndexEntry | undefined {
    return this.entries.get(path);
  }

  set(entry: IndexEntry): void {
    this.entries.set(entry.path, entry);
    this.dirty = true;
  }

  delete(path: string): void {
    if (this.entries.delete(path)) this.dirty = true;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  paths(): string[] {
    return Array.from(this.entries.keys());
  }

  isDirty(): boolean {
    return this.dirty;
  }

  markClean(): void {
    this.dirty = false;
  }

  /**
   * Compute hash for a file and return a new IndexEntry.
   */
  async makeEntry(
    path: string,
    data: Uint8Array,
    mtime: number,
    remoteEtag?: string
  ): Promise<IndexEntry> {
    const hash = await contentHash(data);
    return {
      path,
      hash,
      size: data.byteLength,
      mtime,
      remoteEtag,
    };
  }

  /**
   * Returns true if the local file has changed compared to the index.
   */
  hasChanged(path: string, data: Uint8Array, mtime: number): Promise<boolean> {
    return contentHash(data).then((hash) => {
      const existing = this.entries.get(path);
      if (!existing) return true;
      return existing.hash !== hash || existing.mtime !== mtime;
    });
  }
}
