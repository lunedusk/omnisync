/** Core domain types for OmniSync – see CONTEXT.md */

export type Direction =
  | "bidirectional"
  | "incremental-push"
  | "incremental-pull"
  | "incremental-push-delete"
  | "incremental-pull-delete";

export type ConflictPolicy = "newer-survives" | "larger-survives";

export type E2EEAlgorithm = "libsodium-secretstream" | "aes-256-gcm";

export type RemoteType = "s3" | "google-drive" | "onedrive";

export interface RemoteConfig {
  id: string;
  name: string;
  type: RemoteType;
  /** Type-specific credentials / endpoints – stored encrypted in plugin data */
  config: Record<string, string>;
}

export interface FilterSettings {
  /** Regex patterns that must match for a path to be included (empty = all) */
  allowRegex: string[];
  /** Regex patterns that exclude a path */
  ignoreRegex: string[];
  /** Explicit folder paths to always include (including those starting with _) */
  includeFolders: string[];
  /** Explicit folder paths to always exclude */
  excludeFolders: string[];
  /** Separate system-file toggles */
  syncThemesAndSnippets: boolean;
  syncCommunityPlugins: boolean;
  syncCoreSettings: boolean; // workspace, bookmarks, core config
}

export interface TriggerSettings {
  syncOnStart: boolean;
  /** Debounce in seconds – minimum 30 */
  watcherDebounceSeconds: number;
  periodicEnabled: boolean;
  /** Interval in minutes when periodic is enabled */
  periodicIntervalMinutes: number;
  syncOnFileSave: boolean;
}

export interface OmniSyncSettings {
  /** Exactly one active remote at a time */
  activeRemoteId: string | null;
  remotes: RemoteConfig[];
  direction: Direction;
  conflictPolicy: ConflictPolicy;
  e2eeAlgorithm: E2EEAlgorithm;
  filters: FilterSettings;
  triggers: TriggerSettings;
  /** Adaptive concurrency by default; user can set a hard limit */
  threadLimit: number | null; // null = adaptive
  /** Device fingerprint – never leave the device */
  deviceFingerprint: string;
  /** Whether first-run has been completed on this device */
  firstRunCompleted: boolean;
}

export const DEFAULT_SETTINGS: OmniSyncSettings = {
  activeRemoteId: null,
  remotes: [],
  direction: "bidirectional",
  conflictPolicy: "newer-survives",
  e2eeAlgorithm: "libsodium-secretstream",
  filters: {
    allowRegex: [],
    ignoreRegex: [String.raw`^\.trash/`, String.raw`^\.git/`],
    includeFolders: [],
    excludeFolders: [],
    syncThemesAndSnippets: true,
    syncCommunityPlugins: true,
    syncCoreSettings: true,
  },
  triggers: {
    syncOnStart: true,
    watcherDebounceSeconds: 30,
    periodicEnabled: false,
    periodicIntervalMinutes: 30,
    syncOnFileSave: false,
  },
  threadLimit: null,
  deviceFingerprint: "",
  firstRunCompleted: false,
};

/** Entry in the Local Index (lives outside the vault) */
export interface IndexEntry {
  path: string;
  hash: string; // content hash
  size: number;
  mtime: number;
  remoteEtag?: string;
}

/** A conflict that was preserved locally */
export interface ConflictRecord {
  path: string;
  losingVersionPath: string; // inside .omnisync-conflicts/
  reason: "newer-survives" | "larger-survives";
  timestamp: number;
}
