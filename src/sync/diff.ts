/**
 * Hybrid Fast Path – text line differential for large markdown/text notes.
 * Binary and small files always use full replace (after E2EE).
 *
 * Strategy:
 * - If file is not text or below threshold → full body
 * - If we have a local snapshot of the last-synced plaintext and the change
 *   is mostly line edits → produce a compact patch payload
 * - Remote stores either full ciphertext or an encrypted patch envelope
 * - On pull, patch is applied to last local snapshot / existing file
 *
 * Patches are still E2EE-wrapped by the engine; this module only works on plaintext.
 */

const TEXT_EXT = /\.(md|txt|markdown|csv|json|yaml|yml|xml|html|css|js|ts|py|rs|go|toml)$/i;
const MIN_SIZE_FOR_DIFF = 8 * 1024; // 8 KiB
const MAX_CHANGE_RATIO = 0.4; // if >40% lines changed, full replace is cheaper

export function isTextPath(path: string): boolean {
  return TEXT_EXT.test(path);
}

export function shouldAttemptDiff(
  path: string,
  newSize: number,
  oldSize?: number
): boolean {
  if (!isTextPath(path)) return false;
  if (newSize < MIN_SIZE_FOR_DIFF) return false;
  if (oldSize != null && Math.abs(newSize - oldSize) > newSize * 0.5) return false;
  return true;
}

export interface LinePatch {
  type: "line-patch-v1";
  /** Base content hash the patch expects */
  baseHash: string;
  /** Ordered operations */
  ops: PatchOp[];
}

export type PatchOp =
  | { op: "keep"; count: number }
  | { op: "add"; lines: string[] }
  | { op: "del"; count: number };

/**
 * Build a simple line-based patch (Myers-inspired greedy LCS for moderate files).
 */
export function buildLinePatch(
  oldText: string,
  newText: string,
  baseHash: string
): LinePatch | null {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length > 20000 || b.length > 20000) return null; // too large for in-memory LCS

  // Greedy walk with simple matching
  const ops: PatchOp[] = [];
  let i = 0;
  let j = 0;
  let changed = 0;

  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      let count = 0;
      while (i < a.length && j < b.length && a[i] === b[j]) {
        i++;
        j++;
        count++;
      }
      ops.push({ op: "keep", count });
    } else {
      // Find next matching line within a window
      let found = false;
      const window = 40;
      for (let di = 0; di <= window && i + di < a.length; di++) {
        for (let dj = 0; dj <= window && j + dj < b.length; dj++) {
          if (a[i + di] === b[j + dj]) {
            if (di > 0) {
              ops.push({ op: "del", count: di });
              changed += di;
              i += di;
            }
            if (dj > 0) {
              ops.push({ op: "add", lines: b.slice(j, j + dj) });
              changed += dj;
              j += dj;
            }
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        // drain remainder
        if (i < a.length) {
          const n = a.length - i;
          ops.push({ op: "del", count: n });
          changed += n;
          i = a.length;
        }
        if (j < b.length) {
          const lines = b.slice(j);
          ops.push({ op: "add", lines });
          changed += lines.length;
          j = b.length;
        }
      }
    }
  }

  const total = Math.max(a.length, b.length, 1);
  if (changed / total > MAX_CHANGE_RATIO) return null;

  return { type: "line-patch-v1", baseHash, ops };
}

export function applyLinePatch(oldText: string, patch: LinePatch): string {
  const lines = oldText.split("\n");
  const out: string[] = [];
  let i = 0;
  for (const op of patch.ops) {
    if (op.op === "keep") {
      for (let k = 0; k < op.count; k++) {
        if (i < lines.length) out.push(lines[i++]);
      }
    } else if (op.op === "del") {
      i += op.count;
    } else if (op.op === "add") {
      out.push(...op.lines);
    }
  }
  return out.join("\n");
}

export function encodePatch(patch: LinePatch): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(patch));
}

export function decodePatch(data: Uint8Array): LinePatch | null {
  try {
    const obj = JSON.parse(new TextDecoder().decode(data));
    if (obj?.type === "line-patch-v1" && Array.isArray(obj.ops)) return obj;
  } catch {
    /* ignore */
  }
  return null;
}

/** Marker prefix inside encrypted payload metadata (engine uses separate remote key naming) */
export const PATCH_REMOTE_SUFFIX = ".omnisync-patch";
