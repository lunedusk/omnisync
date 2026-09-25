import {
  exportRecoveryKeyEncrypted,
  importRecoveryKeyEncrypted,
} from "../crypto/recovery-export";

async function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function run() {
  console.log("recovery export tests…");
  const key = "my-super-secret-recovery-key-omnisync";
  const json = await exportRecoveryKeyEncrypted(key, "export-pass-1234");
  await assert(json.includes("omnisync-recovery-v1"), "format");
  await assert(!json.includes(key), "no plaintext key in file");
  const opened = await importRecoveryKeyEncrypted(json, "export-pass-1234");
  await assert(opened === key, "round-trip");
  let failed = false;
  try {
    await importRecoveryKeyEncrypted(json, "wrong-password");
  } catch {
    failed = true;
  }
  await assert(failed, "wrong password fails");
  console.log("recovery export tests OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
