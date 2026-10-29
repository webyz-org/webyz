/**
 * Reading CSV import files in the browser (Plausible's format): a zip such as
 * the one Plausible exports, or the CSVs themselves, split into chunks the API
 * accepts one at a time.
 *
 * Unpacked here rather than on the server so the upload is plain CSV text in
 * requests small enough for any reverse proxy, with no zip library: Plausible
 * writes its archive uncompressed ("stored"), and a zip someone re-packed with
 * compression is inflated with the browser's own DecompressionStream.
 */

/** Same names the API accepts (core/imports/plausible-csv.ts). */
const REPORT_FILE =
  /(?:^|\/)(?:imported_)?(visitors|sources|pages|entry_pages|exit_pages|custom_events|locations|devices|browsers|operating_systems|custom_props)_(\d{8})_(\d{8})\.csv$/;

/**
 * Characters of CSV per request. At four bytes per character in the worst
 * case this stays under the 1 MB request ceiling of the hosted proxy.
 */
export const CHUNK_CHARS = 240_000;

export type ExportFile = {
  /** File name without any folder, as the API expects it. */
  name: string;
  report: string;
  start: string;
  end: string;
  /** Uncompressed size, for progress. */
  size: number;
  /** The file's text as a stream. */
  open: () => ReadableStream<Uint8Array>;
};

const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

const describe = (path: string, size: number, open: ExportFile["open"]): ExportFile | null => {
  const match = REPORT_FILE.exec(path);
  if (!match) return null;
  const name = path.split("/").pop()!;
  return { name, report: match[1], start: iso(match[2]), end: iso(match[3]), size, open };
};

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u64 = (v: DataView, o: number) => Number(v.getBigUint64(o, true));

/** The entries of a zip, read from its central directory (zip64 included). */
async function zipEntries(zip: File): Promise<ExportFile[]> {
  // The end-of-central-directory record sits in the last 64 KB + 22 bytes.
  const tailStart = Math.max(0, zip.size - 65_557);
  const tail = new DataView(await zip.slice(tailStart).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (u32(tail, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${zip.name} is not a zip file`);

  let count = u16(tail, eocd + 10);
  let cdSize = u32(tail, eocd + 12);
  let cdOffset = u32(tail, eocd + 16);
  // Zip64: the locator sits 20 bytes before the classic record.
  if (eocd >= 20 && u32(tail, eocd - 20) === 0x07064b50) {
    const recordOffset = u64(tail, eocd - 12);
    const record = new DataView(await zip.slice(recordOffset, recordOffset + 56).arrayBuffer());
    if (u32(record, 0) === 0x06064b50) {
      count = u64(record, 32);
      cdSize = u64(record, 40);
      cdOffset = u64(record, 48);
    }
  }

  const cd = new DataView(await zip.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const files: ExportFile[] = [];
  let p = 0;
  for (let i = 0; i < count && u32(cd, p) === 0x02014b50; i++) {
    const method = u16(cd, p + 10);
    let compressed = u32(cd, p + 20);
    let size = u32(cd, p + 24);
    const nameLength = u16(cd, p + 28);
    const extraLength = u16(cd, p + 30);
    const commentLength = u16(cd, p + 32);
    let localOffset = u32(cd, p + 42);
    const path = new TextDecoder().decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength));

    // Zip64 extra field: the 64-bit values replace whichever are 0xFFFFFFFF, in order.
    let e = p + 46 + nameLength;
    const extraEnd = e + extraLength;
    while (e + 4 <= extraEnd) {
      const id = u16(cd, e);
      const len = u16(cd, e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (size === 0xffffffff) {
          size = u64(cd, q);
          q += 8;
        }
        if (compressed === 0xffffffff) {
          compressed = u64(cd, q);
          q += 8;
        }
        if (localOffset === 0xffffffff) localOffset = u64(cd, q);
      }
      e += 4 + len;
    }
    p = extraEnd + commentLength;

    if (method !== 0 && method !== 8) continue;
    const entry = describe(path, size, () => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const local = new DataView(await zip.slice(localOffset, localOffset + 30).arrayBuffer());
          const dataStart = localOffset + 30 + u16(local, 26) + u16(local, 28);
          const reader = zip.slice(dataStart, dataStart + compressed).stream().getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        },
      });
      return method === 8
        ? // DOM typings declare the writable side as BufferSource; bytes are what flows.
          stream.pipeThrough(new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
        : stream;
    });
    if (entry) files.push(entry);
  }
  return files;
}

/** The report files in what the person picked: a zip, CSVs, or both. */
export async function readExport(picked: File[]): Promise<{ files: ExportFile[]; ignored: string[] }> {
  const files: ExportFile[] = [];
  const ignored: string[] = [];
  for (const file of picked) {
    if (/\.zip$/i.test(file.name)) {
      const entries = await zipEntries(file);
      if (!entries.length) ignored.push(file.name);
      files.push(...entries);
    } else {
      const entry = describe(file.name, file.size, () => file.stream());
      if (entry) files.push(entry);
      else ignored.push(file.name);
    }
  }
  // The same report twice (a zip and its own CSV) would double it.
  const seen = new Set<string>();
  return { files: files.filter((f) => !seen.has(f.name) && seen.add(f.name)), ignored };
}

export const estimateChunks = (files: ExportFile[]) =>
  files.reduce((sum, f) => sum + Math.max(1, Math.ceil(f.size / CHUNK_CHARS)), 0);

/** Index just past the last line break that is not inside a quoted field. */
const lastSafeBreak = (text: string): number => {
  let quoted = false;
  let last = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === "\n" && !quoted) last = i;
  }
  return last + 1;
};

/**
 * The file as CSV chunks of about CHUNK_CHARS, each starting with the header
 * row and ending on a whole record, so every chunk parses on its own.
 */
export async function* csvChunks(file: ExportFile): AsyncGenerator<string> {
  const reader = file
    .open()
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();
  let header: string | null = null;
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += value;
    if (header === null) {
      const end = buffer.indexOf("\n");
      if (end < 0 && !done) continue;
      header = (end < 0 ? buffer : buffer.slice(0, end)).replace(/\r$/, "");
      buffer = end < 0 ? "" : buffer.slice(end + 1);
    }
    while (buffer.length >= CHUNK_CHARS || (done && buffer.length)) {
      const window = buffer.slice(0, CHUNK_CHARS);
      let cut = done && buffer.length <= CHUNK_CHARS ? buffer.length : lastSafeBreak(window);
      if (cut === 0) {
        if (!done) break; // one record longer than a chunk: wait for more text
        cut = buffer.length;
      }
      yield `${header}\n${buffer.slice(0, cut)}`;
      buffer = buffer.slice(cut);
    }
    if (done) return;
  }
}
