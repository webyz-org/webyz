import { PassThrough, type Readable } from "node:stream";
import { crc32 } from "node:zlib";

/**
 * A zip written as a stream, entries stored uncompressed, the way Plausible's
 * exporter writes its archive: each entry's local header goes out before its
 * data with the "sizes follow" flag, the CRC and sizes after it in a data
 * descriptor, and the central directory at the end. Nothing is buffered
 * beyond one chunk, so a large export never sits in memory. No zip64: an entry or archive past 4 GB is
 * refused rather than written corrupt.
 */

const LIMIT = 0xffffffff;

type Entry = { name: Buffer; crc: number; size: number; offset: number; time: number; date: number };

const dosTime = (d: Date) => ({
  time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
  date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
});

export type ZipWriter = {
  /** The archive bytes, to pipe into a response. */
  stream: Readable;
  /** Append one file from text chunks. Entries are written in call order. */
  add: (name: string, chunks: AsyncIterable<string | Buffer> | Iterable<string | Buffer>) => Promise<void>;
  /** Write the central directory and end the stream. */
  finish: () => Promise<void>;
  /** End the stream with an error (the client sees a broken download). */
  fail: (error: Error) => void;
};

export const createZipWriter = (now: Date = new Date()): ZipWriter => {
  const out = new PassThrough();
  const entries: Entry[] = [];
  let offset = 0;
  const { time, date } = dosTime(now);

  const write = async (buf: Buffer) => {
    offset += buf.length;
    if (offset > LIMIT) throw new Error("Export larger than 4 GB; zip64 is not supported");
    if (!out.write(buf)) await new Promise<void>((resolve) => out.once("drain", resolve));
  };

  const add: ZipWriter["add"] = async (fileName, chunks) => {
    const name = Buffer.from(fileName, "utf8");
    const start = offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt16LE(0x0808, 6); // sizes in data descriptor, UTF-8 name
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    // CRC and sizes stay 0 here; the data descriptor carries them.
    header.writeUInt16LE(name.length, 26);
    await write(Buffer.concat([header, name]));

    let crc = 0;
    let size = 0;
    for await (const chunk of chunks) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
      if (!buf.length) continue;
      crc = crc32(buf, crc);
      size += buf.length;
      await write(buf);
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(size, 8);
    descriptor.writeUInt32LE(size, 12);
    await write(descriptor);
    entries.push({ name, crc: crc >>> 0, size, offset: start, time, date });
  };

  const finish: ZipWriter["finish"] = async () => {
    const cdStart = offset;
    for (const e of entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(0x02014b50, 0);
      cd.writeUInt16LE(20, 4); // version made by
      cd.writeUInt16LE(20, 6); // version needed
      cd.writeUInt16LE(0x0808, 8);
      cd.writeUInt16LE(0, 10);
      cd.writeUInt16LE(e.time, 12);
      cd.writeUInt16LE(e.date, 14);
      cd.writeUInt32LE(e.crc, 16);
      cd.writeUInt32LE(e.size, 20);
      cd.writeUInt32LE(e.size, 24);
      cd.writeUInt16LE(e.name.length, 28);
      cd.writeUInt32LE(e.offset, 42);
      await write(Buffer.concat([cd, e.name]));
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - cdStart, 12);
    end.writeUInt32LE(cdStart, 16);
    await write(end);
    out.end();
  };

  return { stream: out, add, finish, fail: (error) => out.destroy(error) };
};
