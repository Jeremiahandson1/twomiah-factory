// Background location for the trades — apps/mobile/src/location (the phone app, under plain bun: no React Native):
//   · the decisions in src/location/policy.ts — who is offered it, the permission verdict, what to do on
//     start, the settings body a switch sends, the fixes a background delivery posts, when the task stops;
//   · the wiring, read from source: the task is defined at module top level and imported by app/_layout.tsx,
//     logout stops tracking before the tokens are cleared, the Alerts tab mounts the card, the old
//     ask-everyone foreground reporter is gone;
//   · app.config.ts: Twomiah Build and the generic app declare background location (iOS + Android); Twomiah
//     Care and Twomiah Roofer do not;
//   · the card's ink passes 4.5:1 on its grounds in both themes.
//
//   bun run tests/mobile/location-tracking.test.ts
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  TRACKING_VERTICALS, SETTINGS_OFF, ERROR_INK, readSettings, settingsFromReply, trackingOffered, permissionVerdict,
  startupAction, settingsChange, locationBodies, afterPost,
} from '../../apps/mobile/src/location/policy.ts'
import { contrast } from '../../apps/mobile/src/care/rules.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const mobile = join(import.meta.dir, '../../apps/mobile')
const src = (f: string) => readFileSync(join(mobile, f), 'utf8')

console.log('who is offered it')
{
  const on = (vertical: string, hasGpsFeature = true, buildSupportsBackground = true) => trackingOffered({ vertical, hasGpsFeature, buildSupportsBackground })
  check('contractor, basic, field service, landscaping — with gps_tracking', ['contractor', 'basic', 'fieldservice', 'landscaping'].every((v) => on(v)))
  check('never home care, roofing, RV or a business with no phone screens', ['homecare', 'roofing', 'rv', 'unavailable'].every((v) => !on(v)))
  check('not without the gps_tracking feature', !on('contractor', false))
  check('not in a build that declares no background location', !on('contractor', true, false))
  check('the list is exactly the four trades', JSON.stringify([...TRACKING_VERTICALS]) === JSON.stringify(['contractor', 'basic', 'fieldservice', 'landscaping']))
}

console.log('settings from the server')
{
  check('the server default (no row) reads as off', JSON.stringify(readSettings({ locationTrackingEnabled: false, autoClockEnabled: false, locationAccuracy: 'high', trackingInterval: 30 })) === JSON.stringify(SETTINGS_OFF))
  check('both on', JSON.stringify(readSettings({ locationTrackingEnabled: true, autoClockEnabled: true })) === JSON.stringify({ locationTrackingEnabled: true, autoClockEnabled: true }))
  check('auto clock without sharing reads as off', readSettings({ locationTrackingEnabled: false, autoClockEnabled: true })?.autoClockEnabled === false)
  check('PUT\'s saved row (the whole user_settings row) reads the same', readSettings({ id: 'us1', userId: 'u1', locationTrackingEnabled: true, autoClockEnabled: false, updatedAt: 'x' })?.locationTrackingEnabled === true)
  check('a truthy non-boolean is not "on"', readSettings({ locationTrackingEnabled: 'true' })?.locationTrackingEnabled === false)
  check('no body → null', readSettings(null) === null && readSettings('oops') === null)
  check('GET 200 → the settings', settingsFromReply({ ok: true, status: 200, data: { locationTrackingEnabled: true } })?.locationTrackingEnabled === true)
  check('GET 403 / 404 (no feature) → off', [403, 404].every((status) => JSON.stringify(settingsFromReply({ ok: false, status, data: {} })) === JSON.stringify(SETTINGS_OFF)))
  check('no signal / 5xx → "could not tell" (null)', [0, 500, 502].every((status) => settingsFromReply({ ok: false, status, data: null }) === null))
}

console.log('permission')
{
  check('"Always" = foreground and background granted', permissionVerdict('granted', 'granted') === 'always')
  check('"While using" only → needs Always', permissionVerdict('granted', 'denied') === 'needs_always' && permissionVerdict('granted', 'undetermined') === 'needs_always')
  check('no foreground → denied, whatever the background says', permissionVerdict('denied', 'granted') === 'denied' && permissionVerdict('undetermined', 'undetermined') === 'denied')
}

console.log('on app start')
{
  const ON = { locationTrackingEnabled: true, autoClockEnabled: false }
  const a = (offered: boolean, settings: any, permission: any, running: boolean) => startupAction({ offered, settings, permission, running })
  check('on + Always + not running → start', a(true, ON, 'always', false) === 'start')
  check('on + Always + running → leave it', a(true, ON, 'always', true) === 'none')
  check('off + running → stop', a(true, SETTINGS_OFF, 'always', true) === 'stop')
  check('off + not running → nothing (never starts on its own)', a(true, SETTINGS_OFF, 'always', false) === 'none')
  check('on but Always taken away in phone settings → stop, never asks', a(true, ON, 'needs_always', true) === 'stop' && a(true, ON, 'denied', false) === 'none')
  check('not offered (home care, no feature) + running → stop', a(false, ON, 'always', true) === 'stop' && a(false, null, 'always', false) === 'none')
  check('settings unreadable (no signal) → leave it as it is', a(true, null, 'always', true) === 'none' && a(true, null, 'always', false) === 'none')
}

console.log('the switches')
{
  const ON = { locationTrackingEnabled: true, autoClockEnabled: true }
  check('turning sharing on sends only that', JSON.stringify(settingsChange(SETTINGS_OFF, { locationTrackingEnabled: true })) === JSON.stringify({ locationTrackingEnabled: true }))
  check('turning sharing off turns auto clock off with it', JSON.stringify(settingsChange(ON, { locationTrackingEnabled: false })) === JSON.stringify({ locationTrackingEnabled: false, autoClockEnabled: false }))
  check('auto clock on while sharing is off → refused (null)', settingsChange(SETTINGS_OFF, { autoClockEnabled: true }) === null)
  check('auto clock on/off while sharing is on', JSON.stringify(settingsChange({ locationTrackingEnabled: true, autoClockEnabled: false }, { autoClockEnabled: true })) === JSON.stringify({ autoClockEnabled: true })
    && JSON.stringify(settingsChange(ON, { autoClockEnabled: false })) === JSON.stringify({ autoClockEnabled: false }))
  check('no body ever carries an unknown field', [settingsChange(SETTINGS_OFF, { locationTrackingEnabled: true }), settingsChange(ON, { locationTrackingEnabled: false }), settingsChange(ON, { autoClockEnabled: false })]
    .every((b) => Object.keys(b || {}).every((k) => k === 'locationTrackingEnabled' || k === 'autoClockEnabled')))
}

console.log('a background delivery')
{
  const fix = (lat: number, lng: number, accuracy: number | null, timestamp: number) => ({ coords: { latitude: lat, longitude: lng, accuracy }, timestamp })
  const bodies = locationBodies([fix(44.81, -91.5, 12, 2000), fix(44.8, -91.49, null, 1000), { coords: { latitude: NaN, longitude: 1 } }, null])
  check('each valid fix becomes { lat, lng, accuracy }, oldest first', JSON.stringify(bodies) === JSON.stringify([{ lat: 44.8, lng: -91.49 }, { lat: 44.81, lng: -91.5, accuracy: 12 }]), bodies)
  check('no locations → nothing posted', locationBodies(undefined).length === 0 && locationBodies([]).length === 0)
  check('200 tracking:true → keep', afterPost({ ok: true, status: 200, data: { actions: [], tracking: true } }) === 'keep')
  check('200 tracking:false (switched off elsewhere) → stop', afterPost({ ok: true, status: 200, data: { actions: [], tracking: false } }) === 'stop')
  check('401 (signed out) / 403 / 404 (no feature) → stop', [401, 403, 404].every((status) => afterPost({ ok: false, status, data: {} }) === 'stop'))
  check('no signal / 5xx / a 400 → keep', [0, 400, 500, 503].every((status) => afterPost({ ok: false, status, data: null }) === 'keep'))
}

console.log('the wiring (source)')
{
  const tracking = src('src/location/tracking.ts')
  const layout = src('app/_layout.tsx')
  const auth = src('src/auth/AuthContext.tsx')
  const alerts = src('app/(tabs)/notifications.tsx')
  const card = src('src/location/LocationCard.tsx')
  const sync = src('src/location/useTrackingSync.ts')
  check('the task is defined at module top level', /^TaskManager\.defineTask/m.test(tracking))
  check('the task loads the saved server + tokens on a background launch', /if \(!getApiUrl\(\)\) await loadTokens\(\)/.test(tracking))
  check('the task posts to /api/geofencing/location and stops when told', /post\('\/api\/geofencing\/location'/.test(tracking) && /afterPost\(res\) === 'stop'/.test(tracking))
  check('balanced accuracy, ~100 m, deferred ~60 s, pauses, iOS indicator, Android notification',
    /Accuracy\.Balanced/.test(tracking) && /distanceInterval: 100/.test(tracking) && /deferredUpdatesInterval: 60_000/.test(tracking)
    && /pausesUpdatesAutomatically: false/.test(tracking) && /showsBackgroundLocationIndicator: true/.test(tracking)
    && /notificationTitle: 'Location on for work'/.test(tracking) && /clock you in and out at job sites/.test(tracking))
  check('app/_layout.tsx imports the task module and runs the start-up sync', /^import '\.\.\/src\/location\/tracking'/m.test(layout) && /useTrackingSync\(\)/.test(layout))
  check('the old foreground reporter is gone', !existsSync(join(mobile, 'src/hooks/useLocationReporter.ts')) && !/useLocationReporter/.test(layout))
  const logout = /const logout = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[\]\)/.exec(auth)?.[1] || ''
  check('logout stops tracking before the tokens are cleared', logout.indexOf('stopTracking()') > -1 && logout.indexOf('stopTracking()') < logout.indexOf('clearTokens()'), logout)
  check('the Alerts tab mounts the Location card', /ListHeaderComponent=\{<LocationCard \/>\}/.test(alerts))
  check('the card asks for permission only from a tap, and saves nothing as on without "Always"',
    /requestPermission\(\)/.test(card) && /if \(verdict !== 'always'\) return/.test(card) && card.indexOf("if (verdict !== 'always') return") < card.indexOf("put('/api/geofencing/settings', body)"))
  check('the card offers the phone settings', /Linking\.openSettings\(\)/.test(card))
  check('the start-up sync never asks for permission', !/requestPermission|requestForeground|requestBackground/.test(sync))
  check('policy.ts has no React Native import', !/from 'react-native'|from 'expo-/.test(src('src/location/policy.ts')))
}

console.log('app.config.ts')
{
  const mod = await import('../../apps/mobile/app.config.ts')
  const build = (variant: string | undefined) => {
    const saved = process.env.APP_VARIANT
    if (variant === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = variant
    try { return mod.default({ config: {} } as any) as any }
    finally { if (saved === undefined) delete process.env.APP_VARIANT; else process.env.APP_VARIANT = saved }
  }
  const BG = ['ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION']
  const loc = (c: any) => (c.plugins.find((p: any) => Array.isArray(p) && p[0] === 'expo-location') || [])[1] || {}
  for (const [variant, label] of [['build', 'Twomiah Build']] as const) {
    const c = build(variant)
    const o = loc(c)
    check(`${label}: expo-location background on (iOS, Android, foreground service)`, o.isIosBackgroundLocationEnabled === true && o.isAndroidBackgroundLocationEnabled === true && o.isAndroidForegroundServiceEnabled === true, o)
    check(`${label}: "Always" text names the work use`, /clock you in and out at job sites/.test(o.locationAlwaysAndWhenInUsePermission) && c.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription === o.locationAlwaysAndWhenInUsePermission)
    check(`${label}: Android background + foreground-service permissions`, BG.every((p) => c.android.permissions.includes(p)), c.android.permissions)
    check(`${label}: extra.backgroundLocation`, c.extra.backgroundLocation === true)
  }
  // The store app (generic) ships WITHOUT background location in its first version (app.config.ts, store/READY.md §5).
  for (const variant of ['care', 'roofer', 'generic']) {
    const c = build(variant)
    const o = loc(c)
    check(`${variant}: no background location anywhere`, !o.isIosBackgroundLocationEnabled && !o.isAndroidBackgroundLocationEnabled && !o.isAndroidForegroundServiceEnabled
      && !BG.some((p) => c.android.permissions.includes(p)) && !c.ios.infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription && !c.extra.backgroundLocation, { o, perms: c.android.permissions })
    check(`${variant}: no "Always" text in the iOS plist at all`, !('NSLocationAlwaysUsageDescription' in c.ios.infoPlist))
    check(`${variant}: expo-location carries only the while-in-use text`, JSON.stringify(Object.keys(o)) === JSON.stringify(['locationWhenInUsePermission']))
  }
  check('care: location text is still the EVV one', /EVV/.test(build('care').ios.infoPlist.NSLocationWhenInUseUsageDescription))
}

console.log('the card is readable in both themes')
{
  const theme = src('src/theme/ThemeContext.tsx')
  const token = (name: string) => {
    const m = new RegExp(`\\b${name}: isDark \\? '(#[0-9a-f]{6})' : '(#[0-9a-f]{6})'`).exec(theme)
    return m ? { dark: m[1], light: m[2] } : null
  }
  const surface = token('surface'), surfaceAlt = token('surfaceAlt'), text = token('text'), textSecondary = token('textSecondary')
  check('theme tokens found', !!(surface && surfaceAlt && text && textSecondary))
  if (surface && surfaceAlt && text && textSecondary) {
    for (const mode of ['light', 'dark'] as const) {
      check(`${mode}: text on surface / surfaceAlt ≥ 4.5`, contrast(text[mode], surface[mode]) >= 4.5 && contrast(text[mode], surfaceAlt[mode]) >= 4.5)
      check(`${mode}: textSecondary (the switch details) on surface ≥ 4.5`, contrast(textSecondary[mode], surface[mode]) >= 4.5, contrast(textSecondary[mode], surface[mode]))
      check(`${mode}: error ink on surface ≥ 4.5`, contrast(ERROR_INK[mode], surface[mode]) >= 4.5, contrast(ERROR_INK[mode], surface[mode]))
    }
  }
  const card = src('src/location/LocationCard.tsx')
  check('the card uses no textMuted and no opacity on its text', !/textMuted/.test(card) && !/opacity/.test(card))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
