# OmniSync – Implementation Status (v0.2.1)

Aligned with CONTEXT.md + ADRs 0001–0011.

## Status matrix

| Area | Status | Notes |
|------|--------|-------|
| Plugin skeleton | ✅ | manifest 0.2.1 |
| Domain types / settings tabs | ✅ | |
| E2EE secretstream + AES-GCM | ✅ | magic-byte tagged |
| Local Index (outside vault) | ✅ | + session text snapshots for diff |
| Sync engine | ✅ | directions, deletes, concurrency, conflicts |
| Triggers / device fingerprint | ✅ | salt restored on load |
| **S3** | ✅ | full SigV4 |
| **Google Drive** | ✅ | API + **local loopback OAuth** (desktop) |
| **OneDrive** | ✅ | Graph + **local loopback OAuth** (desktop) |
| Recovery Key export | ✅ | Argon2id + AES-GCM envelope JSON |
| Conflicts UI | ✅ | list / restore / delete |
| Hybrid Fast Path | ✅ | hash skip + line-patch for large text |
| Unit tests | ✅ | crypto, sigv4, index, diff, recovery |

## Local OAuth (no website required)

Desktop only – spins up `http://127.0.0.1:PORT/callback`.

### Google
1. Google Cloud Console → OAuth client type **Desktop app**
2. Add redirect URI: `http://127.0.0.1:17832/callback`
3. Paste Client ID (and secret if shown) in OmniSync → Remotes → Sign in with Google

### Microsoft
1. Azure app registration → public client / native
2. Redirect: `http://127.0.0.1:17833/callback`
3. Paste Client ID → Sign in with Microsoft

Mobile: paste access/refresh tokens manually (loopback not available).

## Recovery export

Settings → Advanced → Export → re-enter Recovery Key + export password → writes encrypted `omnisync-recovery-YYYY-MM-DD.json` to vault root. Move offline and delete from the vault.

## Differential

Large text notes with a session snapshot of the last synced plaintext may upload a compact line-patch payload (still E2EE). Binary and small files always full-object. Unchanged files are skipped via content hash.

## Build

```bash
npm install
npm test
npm run build
```
