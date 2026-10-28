// The QR code the Text button shows on a computer (packages/tenant-ui/src/text/qr.ts, a small encoder with no dependency:
// the package is vendored into every CRM template, which would not install a library added here). It must be READ by a real
// decoder — jsQR — at every size it can make, for every kind of text a message holds.
import { test, expect } from 'bun:test'
import jsQR from 'jsqr'
import { qrMatrix, qrSvg, QR_MAX_BYTES, QR_MAX_VERSION } from '../../../packages/tenant-ui/src/text/qr.ts'

const SCALE = 6
const QUIET = 4

function decode(text: string): { version: number; text: string | null } {
  const m = qrMatrix(text)
  const n = m.length + QUIET * 2
  const w = n * SCALE
  const px = new Uint8ClampedArray(w * w * 4).fill(255)
  m.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
      const i = (((y + QUIET) * SCALE + dy) * w + (x + QUIET) * SCALE + dx) * 4
      px[i] = px[i + 1] = px[i + 2] = 0
    }
  }))
  return { version: (m.length - 17) / 4, text: jsQR(px, w, w)?.data ?? null }
}

test('what a text link holds reads back exactly — a short number, a message with a customer link, unicode', () => {
  for (const t of [
    'a', 'sms:+15551234567', 'sms:+15551234567?&body=Hi%20Sam%2C%20Westridge%20Builders%20here.%20We%27re%20on%20our%20way.',
    'sms:+15551234567?&body=' + encodeURIComponent('Hi Sam, Westridge Builders here. Here is your invoice #1042: https://westridge.example/d/' + 'a1'.repeat(32)),
    'ünïcødé ✓ 日本語',
  ]) expect(decode(t).text).toBe(t)
})

test('every version from 1 to 20 is made, and each reads back (the longest text it holds is the last)', () => {
  const versions = new Set<number>()
  for (let n = 1; n <= QR_MAX_BYTES; n += 11) {
    const t = 'x'.repeat(n - 1) + String(n % 10)
    const r = decode(t)
    versions.add(r.version)
    expect(r.text).toBe(t)
  }
  const longest = 'y'.repeat(QR_MAX_BYTES)
  expect(decode(longest).text).toBe(longest)
  expect([...versions].sort((a, b) => a - b)).toEqual(Array.from({ length: QR_MAX_VERSION }, (_, i) => i + 1))
})

test('a text too long for a code is refused, never cut short', () => {
  expect(() => qrMatrix('z'.repeat(QR_MAX_BYTES + 1))).toThrow('too long')
})

test('the SVG is black on white with its own quiet zone, so it scans in dark mode, and the label cannot break out of its attribute', () => {
  const svg = qrSvg('hello', 'QR "label" <x>')
  expect(svg).toContain('fill="#fff"')
  expect(svg).toContain('fill="#000"')
  expect(svg).toContain('aria-label="QR label <x>"')
  const n = qrMatrix('hello').length + 8
  expect(svg).toContain(`viewBox="0 0 ${n} ${n}"`)
  // a whole number of pixels per module, at least 5, so a dense code is not drawn too small to scan
  for (const t of ['hi', 'x'.repeat(200), 'x'.repeat(600)]) {
    const m = qrMatrix(t).length + 8
    const w = Number(/width="(\d+)"/.exec(qrSvg(t))![1])
    expect(w % m).toBe(0)
    expect(w / m).toBeGreaterThanOrEqual(5)
  }
})
