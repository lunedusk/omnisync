/**
 * E2EE layer – ADR 0001
 * Default: libsodium secretstream (XChaCha20-Poly1305)
 * Optional: AES-256-GCM via Web Crypto
 * Key derivation: Argon2id from Recovery Key / passphrase
 */

import type { E2EEAlgorithm } from "../types";

let sodium: typeof import("libsodium-wrappers") | null = null;

async function ensureSodium() {
  if (!sodium) {
    sodium = await import("libsodium-wrappers");
    await sodium.ready;
  }
  return sodium;
}

export interface DerivedKey {
  key: Uint8Array;
  salt: Uint8Array;
}

export async function deriveKey(
  passphrase: string,
  salt?: Uint8Array
): Promise<DerivedKey> {
  const s = await ensureSodium();
  const actualSalt = salt ?? s.randombytes_buf(16);
  const key = s.crypto_pwhash(
    32,
    passphrase,
    actualSalt,
    s.crypto_pwhash_OPSLIMIT_MODERATE,
    s.crypto_pwhash_MEMLIMIT_MODERATE,
    s.crypto_pwhash_ALG_ARGON2ID13
  );
  return { key, salt: actualSalt };
}

/** Magic byte prefix so decrypt can detect algorithm */
const MAGIC_SECRETSTREAM = 0x01;
const MAGIC_AESGCM = 0x02;

export async function encrypt(
  plain: Uint8Array,
  key: Uint8Array,
  algorithm: E2EEAlgorithm
): Promise<Uint8Array> {
  if (algorithm === "aes-256-gcm") {
    return encryptAesGcm(plain, key);
  }
  return encryptSecretstream(plain, key);
}

export async function decrypt(
  sealed: Uint8Array,
  key: Uint8Array,
  algorithm: E2EEAlgorithm
): Promise<Uint8Array> {
  // Prefer magic byte if present (forward compatible)
  if (sealed.length > 0 && sealed[0] === MAGIC_AESGCM) {
    return decryptAesGcm(sealed.slice(1), key);
  }
  if (sealed.length > 0 && sealed[0] === MAGIC_SECRETSTREAM) {
    return decryptSecretstream(sealed.slice(1), key);
  }
  // Legacy / explicit algorithm
  if (algorithm === "aes-256-gcm") {
    return decryptAesGcm(sealed, key);
  }
  return decryptSecretstream(sealed, key);
}

async function encryptSecretstream(
  plain: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  const s = await ensureSodium();
  const res = s.crypto_secretstream_xchacha20poly1305_init_push(key);
  const header = res.header;
  const state = res.state;
  const ciphertext = s.crypto_secretstream_xchacha20poly1305_push(
    state,
    plain,
    null,
    s.crypto_secretstream_xchacha20poly1305_TAG_FINAL
  );
  const out = new Uint8Array(1 + header.length + ciphertext.length);
  out[0] = MAGIC_SECRETSTREAM;
  out.set(header, 1);
  out.set(ciphertext, 1 + header.length);
  return out;
}

async function decryptSecretstream(
  sealed: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  const s = await ensureSodium();
  const headerLen = s.crypto_secretstream_xchacha20poly1305_HEADERBYTES;
  const header = sealed.slice(0, headerLen);
  const ciphertext = sealed.slice(headerLen);
  const state = s.crypto_secretstream_xchacha20poly1305_init_pull(header, key);
  const result = s.crypto_secretstream_xchacha20poly1305_pull(state, ciphertext);
  if (!result) {
    throw new Error("Decryption failed – wrong key or corrupted data");
  }
  return result.message;
}

async function encryptAesGcm(
  plain: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, plain)
  );
  // magic(1) + iv(12) + ciphertext
  const out = new Uint8Array(1 + 12 + ciphertext.length);
  out[0] = MAGIC_AESGCM;
  out.set(iv, 1);
  out.set(ciphertext, 13);
  return out;
}

async function decryptAesGcm(
  sealed: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  const iv = sealed.slice(0, 12);
  const ciphertext = sealed.slice(12);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error("AES-GCM decryption failed – wrong key or corrupted data");
  }
}

export async function generateRecoveryKey(): Promise<string> {
  const s = await ensureSodium();
  const bytes = s.randombytes_buf(32);
  return s.to_base64(bytes, s.base64_variants.URLSAFE_NO_PADDING);
}

export async function contentHash(data: Uint8Array): Promise<string> {
  const s = await ensureSodium();
  const hash = s.crypto_generichash(32, data);
  return s.to_hex(hash);
}
