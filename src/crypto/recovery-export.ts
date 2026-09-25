/**
 * Encrypted Recovery Key export / import.
 * Format: omnisync-recovery-v1 JSON envelope with Argon2id + AES-GCM.
 * Never writes the Recovery Key in plaintext.
 */

import { deriveKey, encrypt, decrypt } from "./e2ee";

const FORMAT = "omnisync-recovery-v1";

export interface RecoveryExportEnvelope {
  format: typeof FORMAT;
  /** base64 salt for Argon2id */
  salt: string;
  /** base64 sealed recovery key (AES-GCM magic) */
  sealed: string;
  createdAt: string;
}

function b64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Seal a recovery key / passphrase under a separate export password.
 */
export async function exportRecoveryKeyEncrypted(
  recoveryKey: string,
  exportPassword: string
): Promise<string> {
  const { key, salt } = await deriveKey(exportPassword);
  const plain = new TextEncoder().encode(recoveryKey);
  const sealed = await encrypt(plain, key, "aes-256-gcm");
  const envelope: RecoveryExportEnvelope = {
    format: FORMAT,
    salt: b64(salt),
    sealed: b64(sealed),
    createdAt: new Date().toISOString(),
  };
  return JSON.stringify(envelope, null, 2);
}

/**
 * Open an exported envelope with the export password → recovery key string.
 */
export async function importRecoveryKeyEncrypted(
  envelopeJson: string,
  exportPassword: string
): Promise<string> {
  const envelope = JSON.parse(envelopeJson) as RecoveryExportEnvelope;
  if (envelope.format !== FORMAT) {
    throw new Error("Unsupported recovery export format");
  }
  const salt = fromB64(envelope.salt);
  const sealed = fromB64(envelope.sealed);
  const { key } = await deriveKey(exportPassword, salt);
  const plain = await decrypt(sealed, key, "aes-256-gcm");
  return new TextDecoder().decode(plain);
}
