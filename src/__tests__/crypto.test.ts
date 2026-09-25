/**
 * Unit tests for E2EE – run with: npx tsx src/__tests__/crypto.test.ts
 * or via npm test once configured.
 */

import {
  deriveKey,
  encrypt,
  decrypt,
  generateRecoveryKey,
  contentHash,
} from "../crypto/e2ee";

async function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function run() {
  console.log("crypto tests…");

  const { key, salt } = await deriveKey("test-passphrase-omnisync");
  await assert(key.length === 32, "key length 32");
  await assert(salt.length === 16, "salt length 16");

  const { key: key2 } = await deriveKey("test-passphrase-omnisync", salt);
  await assert(
    Buffer.from(key).equals(Buffer.from(key2)),
    "same passphrase+salt → same key"
  );

  const plain = new TextEncoder().encode("Hello OmniSync 🔐 " + Date.now());

  for (const algo of ["libsodium-secretstream", "aes-256-gcm"] as const) {
    const sealed = await encrypt(plain, key, algo);
    await assert(sealed.length > plain.length, `${algo} ciphertext longer`);
    const opened = await decrypt(sealed, key, algo);
    await assert(
      new TextDecoder().decode(opened) === new TextDecoder().decode(plain),
      `${algo} round-trip`
    );
    // wrong key must fail
    const badKey = new Uint8Array(32);
    crypto.getRandomValues(badKey);
    let failed = false;
    try {
      await decrypt(sealed, badKey, algo);
    } catch {
      failed = true;
    }
    await assert(failed, `${algo} wrong key fails`);
  }

  const rk = await generateRecoveryKey();
  await assert(rk.length > 20, "recovery key length");

  const h1 = await contentHash(plain);
  const h2 = await contentHash(plain);
  await assert(h1 === h2, "hash stable");
  await assert(h1.length === 64, "blake2b-256 hex length");

  console.log("crypto tests OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
