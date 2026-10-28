// A QR code encoder, small and with no dependency.
//
// Why it is here: this package is vendored into every CRM template, and a template installs only what its own manifest
// declares (scripts/check-shared-deps.ts) — a QR library added here would break every template's install. The Text button
// (text/TextButton.tsx) needs one code, for a text message, so this writes just that: byte mode, error correction level M,
// versions 1–20 (up to 666 bytes at level M; a longer text is refused, never cut — a shortened message would be a different
// message). The result is held to a real decoder: apps/unified/tests/text-qr.test.ts reads every size back with jsQR.
//
// The method is the one in ISO/IEC 18004: data → Reed–Solomon blocks over GF(256) (x⁸+x⁴+x³+x²+1) → interleaved → placed in
// a zigzag around the function patterns → the mask with the lowest penalty → format and version bits (BCH codes).

/** Error-correction blocks and total error-correction codewords, level M, versions 1–20 (ISO/IEC 18004 table 9). */
const BLOCKS_M = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16]
const EC_TOTAL_M = [10, 16, 26, 36, 48, 64, 72, 88, 110, 130, 150, 176, 198, 216, 240, 280, 308, 338, 364, 416]
export const QR_MAX_VERSION = 20

const bit = (n: number, i: number) => ((n >>> i) & 1) !== 0

function rawModules(v: number): number {
  let r = (16 * v + 128) * v + 64
  if (v >= 2) { const a = Math.floor(v / 7) + 2; r -= (25 * a - 10) * a - 55; if (v >= 7) r -= 36 }
  return r
}

/** Data codewords at level M for a version. */
const dataCodewords = (v: number) => Math.floor(rawModules(v) / 8) - EC_TOTAL_M[v - 1]

/** The most bytes a QR code can carry in byte mode at level M. */
export const QR_MAX_BYTES = (() => {
  const v = QR_MAX_VERSION
  return dataCodewords(v) - 3 // 4 mode bits + 16 length bits = 20 bits; the rest are whole bytes
})()

function gfMul(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x }
  return z
}

function rsDivisor(degree: number): number[] {
  const out = new Array(degree).fill(0); out[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < out.length; j++) { out[j] = gfMul(out[j], root); if (j + 1 < out.length) out[j] ^= out[j + 1] }
    root = gfMul(root, 0x02)
  }
  return out
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const rem = new Array(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (rem.shift() as number)
    rem.push(0)
    divisor.forEach((c, i) => { rem[i] ^= gfMul(c, factor) })
  }
  return rem
}

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

/** The codewords (data + error correction, interleaved) for these bytes at the smallest version that holds them. */
function codewordsFor(bytes: number[]): { version: number; words: number[] } {
  let version = 0
  for (let v = 1; v <= QR_MAX_VERSION; v++) {
    const countBits = v < 10 ? 8 : 16
    if (4 + countBits + 8 * bytes.length <= dataCodewords(v) * 8) { version = v; break }
  }
  if (!version) throw new Error('That text is too long for a QR code.')
  const countBits = version < 10 ? 8 : 16
  const bits: number[] = []
  const push = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1) }
  push(0b0100, 4); push(bytes.length, countBits); bytes.forEach((b) => push(b, 8))
  const capacity = dataCodewords(version) * 8
  push(0, Math.min(4, capacity - bits.length))
  while (bits.length % 8) bits.push(0)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0xec; data.length < dataCodewords(version); pad ^= 0xec ^ 0x11) data.push(pad)

  const blocks = BLOCKS_M[version - 1]
  const ecLen = EC_TOTAL_M[version - 1] / blocks
  const total = Math.floor(rawModules(version) / 8)
  const shortBlocks = blocks - (total % blocks)
  const shortLen = Math.floor(total / blocks)
  const divisor = rsDivisor(ecLen)
  const parts: Array<{ data: number[]; ec: number[] }> = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - ecLen + (i < shortBlocks ? 0 : 1)
    const d = data.slice(k, k + len); k += len
    parts.push({ data: d, ec: rsRemainder(d, divisor) })
  }
  const words: number[] = []
  for (let i = 0; i < parts[parts.length - 1].data.length; i++) parts.forEach((p) => { if (i < p.data.length) words.push(p.data[i]) })
  for (let i = 0; i < ecLen; i++) parts.forEach((p) => words.push(p.ec[i]))
  return { version, words }
}

function alignmentPositions(v: number): number[] {
  if (v === 1) return []
  const n = Math.floor(v / 7) + 2
  const step = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2
  const out = [6]
  for (let pos = v * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos)
  return out
}

function penalty(m: boolean[][]): number {
  const n = m.length
  let p = 0
  // runs of five or more in a line; the finder-like 1:1:3:1:1 shape with a light margin (rows, then columns)
  const FINDER_A = '10111010000', FINDER_B = '00001011101'
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < n; a++) {
      let line = ''
      let run = 1
      for (let b = 0; b < n; b++) {
        const cur = pass === 0 ? m[a][b] : m[b][a]
        line += cur ? '1' : '0'
        if (b > 0) {
          const prev = pass === 0 ? m[a][b - 1] : m[b - 1][a]
          if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++ } else run = 1
        }
      }
      for (let i = 0; i + 11 <= line.length; i++) { const s = line.slice(i, i + 11); if (s === FINDER_A || s === FINDER_B) p += 40 }
    }
  }
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
  let dark = 0
  for (const row of m) for (const c of row) if (c) dark++
  p += (Math.ceil(Math.abs(dark * 20 - n * n * 10) / (n * n)) - 1) * 10
  return p
}

/** The code as a grid of modules (true = dark), without the quiet zone. Throws when the text is too long for it. */
export function qrMatrix(text: string): boolean[][] {
  const { version, words } = codewordsFor(utf8(text))
  const size = version * 4 + 17
  const mod: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x: number, y: number, dark: boolean) => { mod[y][x] = dark; fn[y][x] = true }

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy
      if (x >= 0 && x < size && y >= 0 && y < size) { const d = Math.max(Math.abs(dx), Math.abs(dy)); set(x, y, d !== 2 && d !== 4) }
    }
  }
  const al = alignmentPositions(version)
  al.forEach((cx, i) => al.forEach((cy, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === al.length - 1) || (i === al.length - 1 && j === 0)) return
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  const formatBits = (mask: number) => {
    const data = (0b00 << 3) | mask // level M is 00
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    return ((data << 10) | rem) ^ 0x5412
  }
  const drawFormat = (mask: number) => {
    const b = formatBits(mask)
    for (let i = 0; i <= 5; i++) set(8, i, bit(b, i))
    set(8, 7, bit(b, 6)); set(8, 8, bit(b, 7)); set(7, 8, bit(b, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(b, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(b, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(b, i))
    set(8, size - 8, true)
  }
  drawFormat(0) // reserves the cells; redrawn with the chosen mask below
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const b = (version << 12) | rem
    for (let i = 0; i < 18; i++) { const a = size - 11 + (i % 3), c = Math.floor(i / 3); set(a, c, bit(b, i)); set(c, a, bit(b, i)) }
  }

  let i = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
      const x = right - j
      const y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert
      if (!fn[y][x] && i < words.length * 8) { mod[y][x] = bit(words[i >>> 3], 7 - (i & 7)); i++ }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (fn[y][x]) continue
      const invert = [(x + y) % 2 === 0, y % 2 === 0, x % 3 === 0, (x + y) % 3 === 0, (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
        ((x * y) % 2) + ((x * y) % 3) === 0, (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask]
      if (invert) mod[y][x] = !mod[y][x]
    }
  }
  let best = 0, bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask); drawFormat(mask)
    const p = penalty(mod)
    if (p < bestPenalty) { best = mask; bestPenalty = p }
    applyMask(mask)
  }
  applyMask(best); drawFormat(best)
  return mod
}

/**
 * The code as an SVG string, black on white with the four-module quiet zone a scanner needs (so it reads in dark mode too).
 * Drawn at a whole number of pixels per module, never fewer than 5 (a dense code at a small size is what a camera cannot
 * resolve): about 300px for a short text, growing for a long one, shrinking only if its container is narrower (max-width 100%).
 */
export function qrSvg(text: string, label = 'QR code'): string {
  const m = qrMatrix(text)
  const q = 4, n = m.length + q * 2
  const px = n * Math.max(5, Math.floor(300 / n))
  let d = ''
  m.forEach((row, y) => { let x = 0; while (x < row.length) { if (!row[x]) { x++; continue } let e = x; while (e < row.length && row[e]) e++; d += `M${x + q} ${y + q}h${e - x}v1h${-(e - x)}z`; x = e } })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" style="max-width:100%;height:auto" role="img" aria-label="${label.replace(/"/g, '')}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
