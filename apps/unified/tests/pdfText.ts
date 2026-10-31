// What a PDF made by pdfkit says, for a test: the text of every page and the number of pictures in it. pdfkit compresses each
// content stream (Flate) and writes the text of a standard font as hex strings; this inflates the streams and reads those back.
import { inflateSync } from 'node:zlib'

export function pdfFacts(buf: Buffer): { text: string; images: number } {
  const raw = buf.toString('latin1')
  // One picture is an Image object, plus a soft-mask Image object when it has transparency (an /SMask reference).
  const images = (raw.match(/\/Subtype \/Image/g) || []).length - (raw.match(/\/SMask \d+ 0 R/g) || []).length
  let text = ''
  for (const m of raw.matchAll(/stream\r?\n/g)) {
    const start = (m.index ?? 0) + m[0].length
    const end = raw.indexOf('endstream', start)
    if (end < 0) continue
    let body: string
    try { body = inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1') } catch { continue }
    for (const arr of body.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
      for (const hex of arr[1].matchAll(/<([0-9a-fA-F]+)>/g)) text += Buffer.from(hex[1], 'hex').toString('latin1')
      text += '\n'
    }
    for (const one of body.matchAll(/<([0-9a-fA-F]+)>\s*Tj/g)) text += Buffer.from(one[1], 'hex').toString('latin1') + '\n'
  }
  return { text, images }
}
