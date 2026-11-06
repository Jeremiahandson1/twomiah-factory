// Tap to Pay (tap_to_pay, hidden) — the native build config is ready to switch on (parity brief item 10, docs/parity/tap-to-pay.md).
// No EAS account here, so this holds what `expo prebuild` was seen to produce from app.config.ts (10/31, both platforms):
//   · Android builds for API 26 (Android 8), which Stripe Terminal's Android library requires — the figure is read from the
//     installed SDK's own build.gradle, so an SDK upgrade that raises it fails here;
//   · Stripe Terminal's Expo plugin runs with tapToPayCheck (the Tap to Pay process guard in MainApplication) and the app's
//     own location text, and every Bluetooth permission the plugin writes into the Android manifest is blocked again;
//   · the iOS Tap to Pay entitlement is carried ONLY when TAP_TO_PAY_IOS=1 (a build carrying it before Apple grants it fails
//     signing), and every eas.json build profile resolves TAP_TO_PAY_IOS to "0" until the owner flips it;
//   · the SDK is pinned to 0.0.1-beta.33, the last version for React Native 0.81 / Expo 54.
//
//   bun run tests/mobile/tap-to-pay-build.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log('  ok  ', name) } else { failed++; console.log('  FAIL', name, detail === undefined ? '' : JSON.stringify(detail).slice(0, 500)) }
}
const ROOT = path.resolve(import.meta.dir, '../..')
const MOBILE = path.join(ROOT, 'apps/mobile')
const read = (f: string) => fs.readFileSync(path.join(MOBILE, f), 'utf8').replace(/\r\n/g, '\n')
const mod = await import(path.join(MOBILE, 'app.config.ts'))
const VARIANTS = Object.keys(mod.VARIANTS) as string[]

/** app.config.ts resolved as EAS would, with exactly this environment on top of the current one. */
const resolve = (variant: string, env: Record<string, string | undefined> = {}): any => {
  const before = { APP_VARIANT: process.env.APP_VARIANT, TAP_TO_PAY_IOS: process.env.TAP_TO_PAY_IOS, EAS_BUILD: process.env.EAS_BUILD, TWOMIAH_EAS_BUILD: process.env.TWOMIAH_EAS_BUILD }
  delete process.env.TAP_TO_PAY_IOS; delete process.env.EAS_BUILD; delete process.env.TWOMIAH_EAS_BUILD
  process.env.APP_VARIANT = variant
  for (const [k, val] of Object.entries(env)) { if (val === undefined) delete process.env[k]; else process.env[k] = val }
  try { return mod.default({ config: {} }) } finally {
    for (const [k, val] of Object.entries(before)) { if (val === undefined) delete process.env[k]; else process.env[k] = val }
  }
}
const pluginOf = (c: any, name: string): any[] | undefined => c.plugins.find((p: any) => (Array.isArray(p) ? p[0] : p) === name)

// ── the SDK and its floor ─────────────────────────────────────────────────────────────────────────────────────────────
const SDK = '@stripe/stripe-terminal-react-native'
const pkg = JSON.parse(read('package.json'))
check('the Stripe Terminal SDK is pinned to 0.0.1-beta.33 (the last for React Native 0.81 / Expo 54)', pkg.dependencies[SDK] === '0.0.1-beta.33' && /^0\.81\./.test(pkg.dependencies['react-native']), { sdk: pkg.dependencies[SDK], rn: pkg.dependencies['react-native'] })
check('expo-build-properties is a dependency (the plugin that sets Android\'s minimum)', !!pkg.dependencies['expo-build-properties'])

const require = createRequire(path.join(MOBILE, 'package.json'))
const sdkDir = path.dirname(require.resolve(`${SDK}/package.json`))
const gradle = fs.readFileSync(path.join(sdkDir, 'android/build.gradle'), 'utf8')
const sdkMin = Number(/minSdkVersion\s+(\d+)/.exec(gradle)?.[1])
check('the installed SDK states its Android minimum (build.gradle minSdkVersion)', Number.isInteger(sdkMin) && sdkMin >= 24, sdkMin)
const sdkGradleProps = fs.readFileSync(path.join(sdkDir, 'android/gradle.properties'), 'utf8')
check('the SDK ships with Tap to Pay on Android switched on (taptopay.enabled)', /StripeTerminalReactNative_taptopay\.enabled=true/.test(sdkGradleProps))
const plugin = require(`${SDK}/app.plugin.js`)
check('the SDK ships an Expo config plugin (app.plugin.js) with the manifest helpers', typeof plugin.default === 'function' && typeof plugin.addBTPermissionToManifest === 'function')

// ── the resolved config, every variant ───────────────────────────────────────────────────────────────────────────────
for (const variant of VARIANTS) {
  const c = resolve(variant)
  const v = mod.VARIANTS[variant]
  const bp = pluginOf(c, 'expo-build-properties')
  const min = bp?.[1]?.android?.minSdkVersion
  check(`${variant}: Android minimum ${min} covers the SDK's ${sdkMin} (expo-build-properties)`, Number.isInteger(min) && min >= sdkMin && min >= 26, { min, sdkMin })

  const st = pluginOf(c, SDK)
  const props = st?.[1] || {}
  check(`${variant}: Stripe Terminal's plugin runs with tapToPayCheck`, props.tapToPayCheck === true, st)
  check(`${variant}: …and the app's own location text, not the plugin's stock words`, props.locationWhenInUsePermission === v.locationPermission && c.ios.infoPlist.NSLocationWhenInUseUsageDescription === v.locationPermission)
  check(`${variant}: …and no card-reader background mode (no bluetooth-central) and no app-delegate hook`, !props.bluetoothBackgroundMode && !props.appDelegate)
  for (const key of ['bluetoothPeripheralPermission', 'bluetoothAlwaysUsagePermission', 'localNetworkUsagePermission']) {
    const text = props[key]
    check(`${variant}: the iOS ${key} text is the app's own and says it does not use readers`, typeof text === 'string' && text.includes(v.appName) && /does not use/.test(text) && !/supported.*card readers/.test(text), text)
  }

  // Every Bluetooth permission the plugin writes into the manifest is blocked by the app — read from the plugin itself.
  const manifest = plugin.addBTPermissionToManifest({ manifest: {} })
  const added = (manifest.manifest['uses-permission'] as any[]).map((p) => p.$['android:name'])
  const blocked: string[] = c.android.blockedPermissions
  check(`${variant}: every Bluetooth permission the plugin adds (${added.length}) is blocked`, added.length >= 2 && added.every((p) => blocked.includes(p)), { added, blocked })
  check(`${variant}: the classic Bluetooth pair is blocked too`, ['android.permission.BLUETOOTH', 'android.permission.BLUETOOTH_ADMIN'].every((p) => blocked.includes(p)))
  check(`${variant}: the app asks for no Bluetooth permission of its own`, !c.android.permissions.some((p: string) => /BLUETOOTH/.test(p)))

  // The location permissions the plugin also writes are ones the app already asks for (so nothing new appears in the store listing).
  const loc = plugin.addLocationPermissionToManifest({ manifest: {} })
  const locAdded = (loc.manifest['uses-permission'] as any[]).map((p) => String(p.$['android:name']).replace('android.permission.', ''))
  check(`${variant}: the plugin's location permissions are ones the app already declares`, locAdded.every((p) => c.android.permissions.includes(p)), { locAdded, permissions: c.android.permissions })

  // iOS: the Tap to Pay entitlement only when the build says so.
  const ENT = 'com.apple.developer.proximity-reader.payment.acceptance'
  check(`${variant}: no iOS Tap to Pay entitlement without TAP_TO_PAY_IOS`, c.ios.entitlements?.[ENT] === undefined)
  check(`${variant}: …nor with TAP_TO_PAY_IOS=0 (the eas.json default)`, resolve(variant, { TAP_TO_PAY_IOS: '0' }).ios.entitlements?.[ENT] === undefined)
  check(`${variant}: the entitlement is carried with TAP_TO_PAY_IOS=1`, resolve(variant, { TAP_TO_PAY_IOS: '1' }).ios.entitlements?.[ENT] === true)
}

// ── eas.json: every build profile resolves TAP_TO_PAY_IOS, and to "0" until Apple's grant ─────────────────────────────
// Profiles are merged the way @expo/eas-json does it: `extends` is resolved first, then the child's env is laid over the parent's.
const eas = JSON.parse(read('eas.json'))
const resolveProfile = (name: string, depth = 0): any => {
  const p = eas.build[name]
  if (!p) throw new Error(`no profile ${name}`)
  if (depth > 5) throw new Error('extends cycle')
  const { extends: base, ...rest } = p
  if (!base) return rest
  const parent = resolveProfile(base, depth + 1)
  return { ...parent, ...rest, env: { ...(parent.env || {}), ...(rest.env || {}) } }
}
const profiles = Object.keys(eas.build)
check('eas.json has the variant profiles (build / roofer / care, preview and production)', ['build-preview', 'build-production', 'roofer-preview', 'roofer-production', 'care-preview', 'care-production', 'preview', 'production'].every((p) => profiles.includes(p)), profiles)
for (const name of profiles) {
  const env = resolveProfile(name).env || {}
  check(`eas.json ${name}: TAP_TO_PAY_IOS is set, to "0" (the owner flips it to "1" when Apple grants the entitlement)`, env.TAP_TO_PAY_IOS === '0', env)
}

// ── the generated native folders never reach git ──────────────────────────────────────────────────────────────────────
const gitignore = fs.readFileSync(path.join(ROOT, 'apps/mobile/.gitignore'), 'utf8')
check('apps/mobile/.gitignore: android, ios and .expo are generated and ignored (the root .gitignore is fenced)', ['android/', 'ios/', '.expo/'].every((l) => gitignore.split('\n').includes(l)))

// ── the doc tells the owner what is left ──────────────────────────────────────────────────────────────────────────────
const doc = fs.readFileSync(path.join(ROOT, 'docs/parity/tap-to-pay.md'), 'utf8')
check('docs/parity/tap-to-pay.md names the entitlement request, TAP_TO_PAY_IOS=1, a real-phone test-mode run and the EAS build command', /entitlement/i.test(doc) && /TAP_TO_PAY_IOS=1/.test(doc) && /test mode/i.test(doc) && /eas build/.test(doc) && /not seen on a real phone/i.test(doc))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
