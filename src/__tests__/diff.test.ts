import {
  buildLinePatch,
  applyLinePatch,
  shouldAttemptDiff,
  isTextPath,
} from "../sync/diff";

async function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function run() {
  console.log("diff tests…");
  await assert(isTextPath("notes/a.md"), "md is text");
  await assert(!isTextPath("img.png"), "png not text");
  await assert(shouldAttemptDiff("a.md", 20_000, 19_000), "large text diffs");
  await assert(!shouldAttemptDiff("a.md", 100), "small skip");

  const oldT = "line1\nline2\nline3\nline4\nline5\n";
  const newT = "line1\nline2-changed\nline3\nline4\nline5\nline6\n";
  const patch = buildLinePatch(oldT, newT, "abc");
  await assert(!!patch, "patch built");
  const applied = applyLinePatch(oldT, patch!);
  await assert(applied === newT, "patch round-trip");

  console.log("diff tests OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
