# OmniSync

OmniSync is a powerful, end-to-end encrypted, multi-backend vault sync plugin for Obsidian, published by Lunedusk. It synchronises the entire vault (including settings, themes, plugins, bookmarks and workspace) with configurable direction, conflict policy, exclusions and triggers.

## Language

**Vault**:
The complete Obsidian vault root directory, including the `.obsidian` folder and all user notes, attachments, bookmarks and configuration.
_Avoid_: Workspace, note collection

**Remote**:
A configured storage backend (S3-compatible, Google Drive or OneDrive) that holds an encrypted copy of the Vault.
_Avoid_: Cloud, storage, destination

**Direction**:
One of five sync modes: Bidirectional (default), Incremental Push, Incremental Pull, Incremental Push & Delete, Incremental Pull & Delete.
_Avoid_: Sync mode, transfer direction

**Conflict Policy**:
Rule applied when the same path has diverged: Newer Survives (default) or Larger Survives. The losing version is always preserved locally in a conflicts folder.
_Avoid_: Conflict resolution, merge strategy

**Local Index**:
A device-local, non-synced store of metadata and content hashes used for fast change detection. Lives outside the Vault.
_Avoid_: Cache, database, state file

**Plugin Settings**:
The configuration of OmniSync itself. Never synchronised; each device keeps its own independent settings.
_Avoid_: Config, preferences

**Exclusion**:
A user-defined rule (regex, folder path, or system-file toggle) that prevents a path from being synchronised.
_Avoid_: Filter, ignore list

**Inclusion**:
A user-defined rule that forces a path (including those starting with `_`) to be synchronised even if other rules would exclude it.
_Avoid_: Allow list

**Fast Path**:
Hybrid differential transfer: small or binary files are replaced whole; large text notes attempt in-place or patch-style updates when safe.
_Avoid_: Delta sync, rsync

**Device Fingerprint**:
A lightweight, device-specific identifier stored only in Plugin Settings that lets OmniSync recognise a previously opened Vault and skip first-run prompts.
_Avoid_: Device ID, vault ID

**Recovery Key**:
A high-entropy secret generated or entered during first-run that can unlock the master encryption key. May be exported as an encrypted file for offline storage; never stored in plaintext.
_Avoid_: Backup key, seed phrase

**Thread Limit**:
The maximum number of concurrent file transfers the user may set. Defaults to an adaptive value; can be overridden manually.
_Avoid_: Concurrency, parallelism

**Active Remote**:
The single Remote currently selected for synchronisation. Multiple Remotes may be saved, but only one is active.
_Avoid_: Current backend, selected storage
