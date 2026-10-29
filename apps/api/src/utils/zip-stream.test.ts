import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { crc32 } from "node:zlib";

import { createZipWriter } from "./zip-stream.js";

/** Read a finished archive back through its central directory. */
const readZip = (zip: Buffer) => {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, "end of central directory present");
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const files: Record<string, { data: string; crcOk: boolean }> = {};
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50);
    const crc = zip.readUInt32LE(p + 16);
    const size = zip.readUInt32LE(p + 24);
    const nameLength = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString("utf8");
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + size);
    files[name] = { data: data.toString("utf8"), crcOk: (crc32(data) >>> 0) === crc };
    p += 46 + nameLength;
  }
  return files;
};

describe("createZipWriter", () => {
  it("writes stored entries a zip reader can read back, CRCs included", async () => {
    const zip = createZipWriter(new Date(2026, 9, 5, 12, 0, 0));
    const parts: Buffer[] = [];
    zip.stream.on("data", (b: Buffer) => parts.push(b));
    const ended = new Promise((resolve) => zip.stream.on("end", resolve));

    await zip.add("imported_visitors_20260901_20260930.csv", ['"date","visitors"\n', '"2026-09-01",3\n']);
    await zip.add(
      "imported_pages_20260901_20260930.csv",
      (async function* () {
        yield '"date","page"\n';
        yield Buffer.from('"2026-09-01","/ünïcode"\n', "utf8");
      })(),
    );
    await zip.add("empty.csv", []);
    await zip.finish();
    await ended;

    const files = readZip(Buffer.concat(parts));
    assert.deepEqual(Object.keys(files), [
      "imported_visitors_20260901_20260930.csv",
      "imported_pages_20260901_20260930.csv",
      "empty.csv",
    ]);
    assert.equal(files["imported_visitors_20260901_20260930.csv"].data, '"date","visitors"\n"2026-09-01",3\n');
    assert.equal(files["imported_pages_20260901_20260930.csv"].data, '"date","page"\n"2026-09-01","/ünïcode"\n');
    assert.ok(Object.values(files).every((f) => f.crcOk));
  });
});
