/**
 * Abstract Remote interface.
 * Concrete adapters: S3, Google Drive, OneDrive.
 */

export interface RemoteFileMeta {
  path: string;
  size: number;
  mtime: number;
  etag?: string;
}

export interface RemoteAdapter {
  readonly id: string;
  readonly type: string;

  /** List all encrypted objects under the vault prefix */
  list(): Promise<RemoteFileMeta[]>;

  /** Download encrypted bytes for a path */
  get(path: string): Promise<Uint8Array>;

  /** Upload encrypted bytes */
  put(path: string, data: Uint8Array, mtime?: number): Promise<RemoteFileMeta>;

  /** Delete a path */
  delete(path: string): Promise<void>;

  /** Optional: check connectivity */
  testConnection(): Promise<boolean>;
}
