// A ZIP file in memory: named files, each deflated. No library — the format's local headers, central directory and
// end record are small, and a business's export is a few hundred CSVs. Entries and sizes stay under 4 GB (ZIP64 is not
// written; building past that throws rather than writing a file other tools cannot open).
import { deflateRawSync } from 'node:zlib'

export interface ZipEntry { name: string; data: Uint8Array | string }

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
/** The ZIP checksum (CRC-32). Not zlib.crc32: that is newer than the Bun this app is pinned to in CI. */
function crc32(b: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b }
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b }

/** The file as ZIP bytes. File names are UTF-8 (general-purpose flag bit 11); the stamp is `when` (default now), in UTC. */
export function zip(entries: ZipEntry[], when: Date = new Date()): Buffer {
  const dosTime = (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1)
  const dosDate = (Math.max(0, when.getUTCFullYear() - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate()
  const parts: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8')
    const raw = typeof e.data === 'string' ? Buffer.from(e.data, 'utf8') : Buffer.from(e.data)
    const packed = deflateRawSync(raw)
    const crc = crc32(raw)
    if (raw.length >= 0xffffffff || packed.length >= 0xffffffff || offset >= 0xffffffff) throw new Error('The export is too large for one ZIP file')
    const head = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(dosTime), u16(dosDate), u32(crc), u32(packed.length), u32(raw.length),
      u16(name.length), u16(0), name,
    ])
    central.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(dosTime), u16(dosDate), u32(crc), u32(packed.length), u32(raw.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    parts.push(head, packed)
    offset += head.length + packed.length
  }
  const dir = Buffer.concat(central)
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(dir.length), u32(offset), u16(0)])
  return Buffer.concat([...parts, dir, end])
}
