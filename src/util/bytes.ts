/**
 * Type-safe helpers for Web Crypto / fetch under strict TypeScript
 * (Uint8Array<ArrayBufferLike> vs BufferSource / BodyInit).
 */

/** Copy into a fresh ArrayBuffer-backed view for crypto.subtle */
export function asBufferSource(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

/** Use as fetch() body */
export function asBodyInit(data: Uint8Array): Blob {
  return new Blob([asBufferSource(data)]);
}
