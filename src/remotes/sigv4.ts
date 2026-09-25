/**
 * Minimal AWS Signature Version 4 signer using Web Crypto.
 * Zero dependencies – works in Obsidian (browser + Electron).
 */

const encoder = new TextEncoder();

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const buf = typeof data === "string" ? encoder.encode(data) : data;
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return bufferToHex(new Uint8Array(hash));
}

function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(
  key: ArrayBuffer | Uint8Array,
  data: string
): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

async function getSignatureKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string
): Promise<ArrayBuffer> {
  const kDate = await hmac(encoder.encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export interface SignOptions {
  method: string;
  url: string; // full URL
  region: string;
  service?: string; // default "s3"
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  body?: Uint8Array | string | null;
  headers?: Record<string, string>;
  /** When true, use UNSIGNED-PAYLOAD (common for S3) */
  unsignedPayload?: boolean;
}

export interface SignedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array | string | null;
}

/**
 * Sign a request with AWS SigV4 and return headers + body ready for fetch().
 */
export async function signRequest(opts: SignOptions): Promise<SignedRequest> {
  const service = opts.service ?? "s3";
  const url = new URL(opts.url);
  const method = opts.method.toUpperCase();
  const now = new Date();
  const amzDate =
    now.toISOString().replace(/[:-]|\.\d{3}/g, "").slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-date": amzDate,
    ...(opts.headers ?? {}),
  };
  if (opts.sessionToken) {
    headers["x-amz-security-token"] = opts.sessionToken;
  }

  let payloadHash: string;
  if (opts.unsignedPayload) {
    payloadHash = "UNSIGNED-PAYLOAD";
    headers["x-amz-content-sha256"] = payloadHash;
  } else {
    const body =
      opts.body == null
        ? new Uint8Array(0)
        : typeof opts.body === "string"
          ? encoder.encode(opts.body)
          : opts.body;
    payloadHash = await sha256Hex(body);
    headers["x-amz-content-sha256"] = payloadHash;
  }

  // Canonical headers
  const signedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = signedHeaderKeys
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join("");
  const signedHeaders = signedHeaderKeys.join(";");

  // Canonical query (sorted)
  const searchParams = new URLSearchParams(url.search);
  const sortedParams = [...searchParams.entries()].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0
  );
  const canonicalQuery = sortedParams
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%20/g, "+")}`
    )
    .join("&");

  const canonicalUri = url.pathname
    .split("/")
    .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
    .join("/") || "/";

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${opts.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = await getSignatureKey(
    opts.secretAccessKey,
    dateStamp,
    opts.region,
    service
  );
  const signature = bufferToHex(
    new Uint8Array(await hmac(signingKey, stringToSign))
  );

  headers["Authorization"] =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: opts.url,
    method,
    headers,
    body: opts.body,
  };
}
