// A zip file's entries (row 9, docs/parity/homecare-import.md): an Excel workbook is a zip of XML parts, and the bulk
// attach of documents and qualifications takes a zip of files. Reads the central directory, inflates each entry with
// node's zlib — no library (the app depends on none that reads zips, and the format's two methods, stored and deflate,
// are all a sheet or a folder of PDFs ever uses). Pure.
import { inflateRawSync } from 'node:zlib'

export interface ZipEntry { name: string; size: number; data: () => Buffer; isDirectory: boolean }

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50
/** A zip with more entries than this is not a workbook or a folder of files; it is a mistake. */
export const MAX_ZIP_ENTRIES = 5000

/** Every entry of a zip, or a plain-English problem. An entry's bytes are read only when asked for. */
export function readZip(buf: Buffer): ZipEntry[] | { problem: string; code: string } {
  if (buf.length < 22) return { problem: 'That is not a zip file.', code: 'bad_zip' }
  // the end-of-central-directory record is in the last 64 KB (its comment can be that long)
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === EOCD) { eocd = i; break }
  if (eocd < 0) return { problem: 'That is not a zip file.', code: 'bad_zip' }
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  if (count > MAX_ZIP_ENTRIES) return { problem: `The zip has ${count} files; send at most ${MAX_ZIP_ENTRIES}.`, code: 'too_many_files' }
  const out: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL) return { problem: 'The zip file is damaged.', code: 'bad_zip' }
    const method = buf.readUInt16LE(p + 10)
    const compressed = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const flags = buf.readUInt16LE(p + 8)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1')
    p += 46 + nameLen + extraLen + commentLen
    if (method !== 0 && method !== 8) return { problem: `"${name}" is compressed in a way we cannot read. Save the zip again with the usual settings.`, code: 'bad_zip' }
    const data = () => {
      if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL) throw new Error('bad local header')
      const ln = buf.readUInt16LE(localOffset + 26), le = buf.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + ln + le
      const raw = buf.subarray(start, start + compressed)
      return method === 0 ? Buffer.from(raw) : inflateRawSync(raw)
    }
    out.push({ name, size, data, isDirectory: name.endsWith('/') })
  }
  return out
}

/** Is this the start of a zip (and so possibly an .xlsx)? */
export const looksLikeZip = (buf: Buffer) => buf.length >= 4 && buf.readUInt32LE(0) === LOCAL
