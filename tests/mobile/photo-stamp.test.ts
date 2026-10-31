// A job photo carries where and when the camera says it was taken (apps/mobile/src/photos/stamp.ts; roofing's inspection
// report prints them): read from the photo's own EXIF — nothing is asked of the person, no location is read — and sent
// with the upload only when the camera said. Plain functions under bun, plus the wiring read from source.
//
//   bun run tests/mobile/photo-stamp.test.ts
import { readFileSync } from 'fs'
import { join } from 'path'
import { stampFromExif, stampFields } from '../../apps/mobile/src/photos/stamp.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const mobile = join(import.meta.dir, '../../apps/mobile')
const src = (rel: string) => readFileSync(join(mobile, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')

// ── the reading ──────────────────────────────────────────────────────────────
const flat = stampFromExif({ GPSLatitude: 43.8014, GPSLatitudeRef: 'N', GPSLongitude: 91.4396, GPSLongitudeRef: 'W', DateTimeOriginal: '2026:03:04 14:15:00', OffsetTimeOriginal: '-06:00' })
check('flat EXIF: the hemisphere makes West negative', flat.latitude === 43.8014 && flat.longitude === -91.4396, flat)
check('the time with its offset is the instant it names', flat.takenAt === '2026-03-04T20:15:00.000Z', flat)
const nested = stampFromExif({ '{GPS}': { Latitude: 33.9, LatitudeRef: 'S', Longitude: 18.4, LongitudeRef: 'E' } })
check('the nested form ({GPS}) reads too, South negative', nested.latitude === -33.9 && nested.longitude === 18.4, nested)
const dms = stampFromExif({ GPSLatitude: [43, 48, 5.04], GPSLatitudeRef: 'N', GPSLongitude: [91, 25, 82.56], GPSLongitudeRef: 'W' })
check('degrees, minutes, seconds are turned into decimal degrees', Math.abs(dms.latitude! - 43.8014) < 1e-4 && Math.abs(dms.longitude! + 91.4396) < 1e-3, dms)
const local = stampFromExif({ DateTimeOriginal: '2026:03:04 14:15:00' })
check('a time with no offset is the phone’s own clock', !!local.takenAt && new Date(local.takenAt).getFullYear() === 2026 && new Date(local.takenAt).getHours() === 14, local)

// ── what it will not say ─────────────────────────────────────────────────────
check('no EXIF, or none usable: no stamp at all', JSON.stringify([stampFromExif(null), stampFromExif(undefined), stampFromExif({}), stampFromExif({ Make: 'x' })]) === '[{},{},{},{}]')
check('one coordinate alone is no place', stampFromExif({ GPSLatitude: 43.8, GPSLatitudeRef: 'N' }).latitude === undefined)
check('out of range or 0,0 (a camera with no fix) is no place', JSON.stringify([stampFromExif({ GPSLatitude: 95, GPSLongitude: 10 }), stampFromExif({ GPSLatitude: 0, GPSLongitude: 0 })]) === '[{},{}]')
check('an unreadable time is no time', stampFromExif({ DateTimeOriginal: 'yesterday' }).takenAt === undefined)

// ── what the upload carries ──────────────────────────────────────────────────
check('the fields are strings the server reads, and none without a stamp', JSON.stringify(stampFields(flat)) === '{"latitude":"43.8014","longitude":"-91.4396","takenAt":"2026-03-04T20:15:00.000Z"}' && JSON.stringify(stampFields({})) === '{}' && JSON.stringify(stampFields(null)) === '{}')

// ── the wiring ───────────────────────────────────────────────────────────────
const camera = src('src/hooks/useCamera.ts')
check('the camera hands back the stamp from the EXIF it already asked for', /exif:\s*true/.test(camera) && /stamp:\s*stampFromExif\(asset\.exif/.test(camera))
check('no new permission or location call was added to the camera', !/requestForegroundPermissions|getCurrentPosition|expo-location/.test(camera))
const gallery = src('src/components/PhotoGallery.tsx')
check('the job photo upload sends the stamp for the verticals that keep photos on the job', /stampFields\(stamp\)/.test(gallery) && /uploadJobPhoto\(vertical: string, jobId: string, uri: string, stamp\?: PhotoStamp\)/.test(gallery))
for (const rel of ['src/components/PhotoGallery.tsx', 'app/(details)/lead/quick-add.tsx', 'app/(tabs)/jobs.tsx']) check(`${rel} passes the camera's stamp to the upload`, /uploadJobPhoto\([^)]*\.stamp\)/.test(src(rel)))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
