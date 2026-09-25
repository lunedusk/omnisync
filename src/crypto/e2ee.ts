/**
 * E2EE layer – ADR 0001
 *
 * Web Crypto only (no libsodium) so the Obsidian CJS bundle builds cleanly.
 * - KDF: PBKDF2-SHA-256 (600_000 iterations)
 * - AEAD: AES-256-GCM
 * - Content hash: SHA-256
 *
 * Payload: [magic 1][iv 12][ciphertext+tag]
 * magic 0x02 = AES-GCM
 */

import type { E2EEAlgorithm } from "../types";
import { asBufferSource } from "../util/bytes";

const MAGIC_AESGCM = 0x02;
const MAGIC_SECRETSTREAM = 0x01;
const PBKDF2_ITERATIONS = 600_000;

export interface DerivedKey {
  key: Uint8Array;
  salt: Uint8Array;
}

function toHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export async function deriveKey(
  passphrase: string,
  salt?: Uint8Array
): Promise<DerivedKey> {
  const actualSalt = salt ?? crypto.getRandomValues(new Uint8Array(16));
  const baseKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(fromUtf8(passphrase)),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: asBufferSource(actualSalt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    256
  );
  return { key: new Uint8Array(bits), salt: actualSalt };
}

export async function encrypt(
  plain: Uint8Array,
  key: Uint8Array,
  _algorithm: E2EEAlgorithm
): Promise<Uint8Array> {
  return encryptAesGcm(plain, key);
}

export async function decrypt(
  sealed: Uint8Array,
  key: Uint8Array,
  _algorithm: E2EEAlgorithm
): Promise<Uint8Array> {
  if (sealed.length === 0) {
    throw new Error("Empty ciphertext");
  }
  if (sealed[0] === MAGIC_AESGCM) {
    return decryptAesGcm(sealed.slice(1), key);
  }
  if (sealed[0] === MAGIC_SECRETSTREAM) {
    throw new Error(
      "This data was encrypted with libsodium secretstream. Re-sync from OmniSync ≥0.2.2 or re-encrypt."
    );
  }
  return decryptAesGcm(sealed, key);
}

async function encryptAesGcm(
  plain: Uint8Array,
  key: Uint8Array
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(key),
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      asBufferSource(plain)
    )
  );
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
  if (sealed.length < 13) {
    throw new Error("Ciphertext too short");
  }
  const iv = asBufferSource(sealed.slice(0, 12));
  const ciphertext = asBufferSource(sealed.slice(12));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(key),
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
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function contentHash(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", asBufferSource(data));
  return toHex(new Uint8Array(digest));
}
