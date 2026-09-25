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
  await assert(key.every((b, i) => b === key2[i]), "same key");
  const plain = new TextEncoder().encode("Hello OmniSync " + Date.now());
  const sealed = await encrypt(plain, key, "aes-256-gcm");
  await assert(sealed.length > plain.length, "ciphertext longer");
  const opened = await decrypt(sealed, key, "aes-256-gcm");
  await assert(new TextDecoder().decode(opened) === new TextDecoder().decode(plain), "round-trip");
  let failed = false;
  try {
    await decrypt(sealed, crypto.getRandomValues(new Uint8Array(32)), "aes-256-gcm");
  } catch { failed = true; }
  await assert(failed, "wrong key fails");
  const rk = await generateRecoveryKey();
  await assert(rk.length > 20, "recovery key");
  const h1 = await contentHash(plain);
  await assert(h1 === (await contentHash(plain)), "hash stable");
  await assert(h1.length === 64, "sha-256 hex");
  console.log("crypto tests OK");
}
run().catch((e) => { console.error(e); process.exit(1); });
