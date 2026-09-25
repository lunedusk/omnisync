/**
 * LocalIndex unit tests
 */

import { LocalIndex } from "../index/local-index";

async function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function run() {
  console.log("index tests…");
  const idx = new LocalIndex("/tmp");
  await idx.load(null);

  const data = new TextEncoder().encode("note content");
  const entry = await idx.makeEntry("notes/a.md", data, 1000);
  idx.set(entry);

  await assert(idx.has("notes/a.md"), "has path");
  await assert(idx.get("notes/a.md")?.size === data.byteLength, "size");
  await assert(!(await idx.hasChanged("notes/a.md", data, 1000)), "unchanged");

  const data2 = new TextEncoder().encode("note content changed");
  await assert(await idx.hasChanged("notes/a.md", data2, 1000), "content changed");
  await assert(await idx.hasChanged("notes/a.md", data, 2000), "mtime changed");

  const json = idx.toJSON();
  const idx2 = new LocalIndex("/tmp");
  await idx2.load(json);
  await assert(idx2.has("notes/a.md"), "reload");

  idx.delete("notes/a.md");
  await assert(!idx.has("notes/a.md"), "deleted");

  console.log("index tests OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
