/**
 * palette-from-images.ts — measure the dominant colors of reference images
 * (simple k-means over downsampled pixels) so a brand palette comes from
 * the owner's art, not from a guess.
 *   bun scripts/palette-from-images.ts <img> [<img> ...]
 */
import sharp from 'sharp'

const K = 9
function hex(c: number[]) { return '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase() }
function hsl([r, g, b]: number[]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b); const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min; const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}
function name(c: number[]) {
  const [h, s, l] = hsl(c)
  if (l < 0.12) return 'near-black'
  if (s < 0.12) return l > 0.8 ? 'near-white' : 'gray'
  if (h < 15 || h >= 345) return 'red'
  if (h < 40) return l < 0.35 ? 'brown' : 'orange'
  if (h < 65) return l < 0.35 ? 'olive/dark gold' : 'gold/yellow'
  if (h < 170) return l < 0.3 ? 'dark green' : 'green'
  if (h < 260) return l < 0.3 ? 'navy/dark blue' : 'blue'
  return 'purple/magenta'
}

for (const file of process.argv.slice(2)) {
  const { data, info } = await sharp(file).resize({ width: 160 }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const px: number[][] = []
  for (let i = 0; i < data.length; i += 3) px.push([data[i], data[i + 1], data[i + 2]])
  // k-means++
  let centers: number[][] = [px[Math.floor(Math.random() * px.length)]]
  while (centers.length < K) {
    const d = px.map(p => Math.min(...centers.map(c => (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2)))
    const sum = d.reduce((a, b) => a + b, 0); let r = Math.random() * sum
    for (let i = 0; i < px.length; i++) { r -= d[i]; if (r <= 0) { centers.push(px[i]); break } }
    if (centers.length < K && r > 0) centers.push(px[px.length - 1])
  }
  let assign = new Array(px.length).fill(0)
  for (let iter = 0; iter < 12; iter++) {
    assign = px.map(p => { let best = 0, bd = Infinity; centers.forEach((c, i) => { const d = (p[0]-c[0])**2 + (p[1]-c[1])**2 + (p[2]-c[2])**2; if (d < bd) { bd = d; best = i } }); return best })
    const sums = centers.map(() => [0, 0, 0, 0])
    px.forEach((p, i) => { const s = sums[assign[i]]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++ })
    centers = sums.map((s, i) => s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[i])
  }
  const counts = centers.map((_, i) => assign.filter(a => a === i).length)
  const rows = centers.map((c, i) => ({ hex: hex(c), pct: (100 * counts[i] / px.length), name: name(c), sat: hsl(c)[1] })).sort((a, b) => b.pct - a.pct)
  console.log('\n' + file.split(/[\\/]/).pop() + '  (' + info.width + 'x' + info.height + ' sample)')
  for (const r of rows) console.log('  ' + r.hex + '  ' + r.pct.toFixed(1).padStart(5) + '%  ' + r.name + '  sat ' + r.sat.toFixed(2))
}
