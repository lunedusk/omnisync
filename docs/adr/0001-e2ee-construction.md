# E2EE uses libsodium secretstream by default, with AES-GCM option

OmniSync requires end-to-end encryption of all data stored on any Remote. The default construction is libsodium’s secretstream (XChaCha20-Poly1305) because it is currently the fastest high-security streaming AEAD available in pure JavaScript/TypeScript and has excellent mobile support. Users may optionally select AES-256-GCM + X25519 instead. Master keys are derived via Argon2id from a user passphrase (or recovery key) and stored in the OS keychain when possible, with an optional local encrypted keyfile fallback.
