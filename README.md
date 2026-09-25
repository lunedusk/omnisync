# OmniSync

**The most powerful, end-to-end encrypted, multi-backend vault sync for Obsidian.**

OmniSync by Lunedusk keeps your entire vault — notes, attachments, bookmarks, themes, plugins, workspace and settings — safely synchronised across every device. Choose your own storage, set the exact direction you need, and never lose a conflict.

[![Obsidian](https://img.shields.io/badge/Obsidian-Plugin-purple?logo=obsidian)](https://obsidian.md)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Why OmniSync?

- **True E2EE** — libsodium secretstream (XChaCha20-Poly1305) by default, optional AES-256-GCM. Your passphrase never leaves the device.
- **Five precise Directions** — Bidirectional (default), Incremental Push, Incremental Pull, Incremental Push & Delete, Incremental Pull & Delete.
- **Conflict policies that respect your data** — Newer Survives or Larger Survives. The losing version is always kept locally.
- **Whole-vault control** — Sync everything, or use regex, folder rules and separate toggles for themes, plugins and core settings.
- **Fast & gentle** — Hybrid differential transfers, local hash index, adaptive concurrency, 30 s minimum debounce so typing is never interrupted.
- **Per-device settings** — Plugin configuration is never synced. One machine can push while another pulls.
- **Works everywhere** — Desktop and mobile, with a clean tabbed settings UI and non-blocking conflict view.
- **Zero friction** — Device fingerprint skips repeated “first open” prompts.

---

## Supported Remotes

| Remote              | Status   |
|---------------------|----------|
| S3-compatible       | ✅       |
| Google Drive        | ✅       |
| OneDrive            | ✅       |

(S3-compatible covers AWS S3, Cloudflare R2, Backblaze B2, MinIO and any other S3 API.)

---

## Quick Start

1. Install OmniSync from the Obsidian Community Plugins store (or sideload the latest release).
2. Enable the plugin.
3. Complete the guided first-run: create or enter a Recovery Key, choose your Active Remote, set Direction.
4. (Optional) Export your Recovery Key to an encrypted file and store it offline.
5. Open the settings tabs to fine-tune Filters, Triggers and Advanced options.

That’s it. OmniSync will keep your vault in sync according to the rules you set.

---

## Directions explained

| Direction                    | Behaviour                                                                 |
|-----------------------------|---------------------------------------------------------------------------|
| **Bidirectional** (default) | Changes flow both ways. Conflicts resolved by the chosen Conflict Policy. |
| **Incremental Push**        | Only local → Remote. Remote is never written back to the device.          |
| **Incremental Pull**        | Only Remote → local. Local changes are never uploaded.                    |
| **Incremental Push & Delete** | Push + remove files on the Remote that no longer exist locally.         |
| **Incremental Pull & Delete** | Pull + remove local files that no longer exist on the Remote.           |

Because Plugin Settings are never synchronised, you can run Push on your laptop and Pull on your phone without them fighting each other.

---

## Conflict handling

- **Newer Survives** (default) — the version with the later modification time wins.
- **Larger Survives** — the version with the greater byte size wins.

In both cases the losing version is moved to a local `.omnisync-conflicts/` folder (timestamped).  
On mobile a badge appears and a dedicated Conflicts view lists every preserved file.  
On desktop the same view is available plus an optional toast. No blocking modals.

---

## Filters & system files

- **Regex allow / ignore** lists
- Explicit folder inclusions (including paths that start with `_`)
- Separate toggles:
  - Themes & snippets
  - Community plugins + their data
  - Core settings / workspace / bookmarks

The Local Index (hashes + metadata) lives completely outside the vault and is never synced.

---

## Triggers (auto-run)

| Trigger              | Default     | Notes                                      |
|----------------------|-------------|--------------------------------------------|
| On Obsidian start    | On          |                                            |
| File-watcher         | On          | Minimum 30 s debounce (user can raise)     |
| Periodic interval    | Off         | Configurable when enabled                  |
| On every file save   | Off         | Watcher is preferred                       |

Concurrency is adaptive by default; you can set an explicit Thread Limit if you prefer.

---

## Security model

1. A Recovery Key (or passphrase) is turned into a master key with Argon2id.
2. All file contents are encrypted with libsodium secretstream (default) or AES-256-GCM before they ever leave the device.
3. The master key is stored in the OS keychain when available; an optional encrypted keyfile can be used as fallback.
4. Plugin Settings and the Local Index never leave the device.
5. Recovery Key can be exported as an encrypted file for offline backup; plaintext is never written to disk.

---

## Settings overview (tabs)

- **General** — Direction, Conflict Policy, Active Remote, Thread Limit
- **Remotes** — Add / edit S3, Google Drive or OneDrive configurations
- **Filters** — Regex, folders, system-file toggles
- **Triggers** — Start, watcher debounce, interval, on-save
- **Advanced** — E2EE algorithm choice, recovery key export, diagnostics
- **Conflicts** — Browse and restore preserved versions

---

## Installation & updates

**Recommended**: Install from the official Obsidian Community Plugins browser.  
Updates appear automatically.

**Manual**: Download the latest release `.zip` from GitHub Releases and place the folder in your vault’s `.obsidian/plugins/` directory.

---

## Development & releases

Releases are driven by the version field in `manifest.json`.

1. Bump the version.
2. Push to `main` (or create a release tag).
3. GitHub Actions builds the plugin, creates the release and publishes to the Community Plugins store.

A small helper script `sync-workflows.sh` (gitignored) is provided so you can keep the workflow files in sync locally without committing them.

```bash
# Example local helper (not tracked by git)
./sync-workflows.sh
```

---

## License

MIT © Lunedusk

---

## Contributing

Issues and pull requests are welcome. Please open an issue first for any large change so we can discuss the design.
