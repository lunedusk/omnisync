/**
 * SigV4 smoke tests – verifies canonical request shape without live AWS.
 */

import { signRequest } from "../remotes/sigv4";

async function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function run() {
  console.log("sigv4 tests…");

  const signed = await signRequest({
    method: "GET",
    url: "https://mybucket.s3.us-east-1.amazonaws.com/omnisync/notes/hello.md",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    body: null,
  });

  await assert(signed.method === "GET", "method");
  await assert(!!signed.headers["Authorization"], "has Authorization");
  await assert(
    signed.headers["Authorization"].startsWith("AWS4-HMAC-SHA256 Credential="),
    "auth prefix"
  );
  await assert(!!signed.headers["x-amz-date"], "has x-amz-date");
  await assert(!!signed.headers["x-amz-content-sha256"], "has content sha");

  // PUT with body
  const body = new TextEncoder().encode("payload");
  const put = await signRequest({
    method: "PUT",
    url: "https://mybucket.s3.us-east-1.amazonaws.com/omnisync/file.bin",
    region: "us-east-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    body,
  });
  await assert(put.headers["Authorization"].includes("Signature="), "put signature");

  console.log("sigv4 tests OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
