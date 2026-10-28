// What the stores look at before a person does, checked in code (apps/mobile/store/READY.md is the owner's side):
//   · the four artwork files exist at the sizes the stores need — the icon with no alpha channel, the adaptive mark inside the
//     safe zone, the notification icon a solid white shape;
//   · the store app's config (APP_VARIANT unset): version 1.0.0, only the permission texts it uses, no background location, no
//     microphone / Face ID, nothing declared that it never asks;
//   · eas.json keeps the owner's TODO placeholders — no store id is made up — and builds are versioned by EAS;
//   · listing.md fits the stores' limits, names only the trades the app supports, and links the live privacy / support pages.
//
//   bun run tests/mobile/store-ready.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const root = path.resolve(import.meta.dir, '../../apps/mobile')
const sharp = createRequire(import.meta.url)(path.resolve(root, '../unified/node_modules/sharp')) as typeof import('sharp')
let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

console.log('artwork')
{
  const A = (f: string) => path.join(root, 'assets', f)
  const meta = async (f: string) => sharp(A(f)).metadata()
  const raw = async (f: string) => sharp(A(f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const icon = await meta('icon.png')
  check('icon.png is 1024×1024', icon.width === 1024 && icon.height === 1024, icon)
  check('icon.png has no alpha channel (Apple refuses one)', icon.hasAlpha === false && icon.channels === 3, icon)
  const { data: iconPx, info } = await raw('icon.png')
  const corner = [0, 4 * (info.width - 1), 4 * info.width * (info.height - 1), 4 * (info.width * info.height - 1)].map((o) => `${iconPx[o]},${iconPx[o + 1]},${iconPx[o + 2]}`)
  check('icon.png is square-cornered (all four corners are the background colour; the stores round it)', new Set(corner).size === 1, corner)

  const ad = await meta('adaptive-icon.png')
  check('adaptive-icon.png is 1024×1024', ad.width === 1024 && ad.height === 1024, ad)
  const { data: adPx, info: adInfo } = await raw('adaptive-icon.png')
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1
  for (let y = 0; y < adInfo.height; y++) for (let x = 0; x < adInfo.width; x++) if (adPx[4 * (y * adInfo.width + x) + 3] > 8) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y) }
  check('adaptive-icon.png: the whole mark is inside the central 720×720 (152…872)', minX >= 152 && minY >= 152 && maxX <= 872 && maxY <= 872, { minX, minY, maxX, maxY })
  check('adaptive-icon.png: the four corners are transparent (the background colour shows)', [0, 4 * 1023, 4 * 1024 * 1023, 4 * (1024 * 1024 - 1)].every((o) => adPx[o + 3] === 0))

  const splash = await meta('splash.png')
  check('splash.png is 1284×2778, opaque', splash.width === 1284 && splash.height === 2778 && splash.hasAlpha === false, splash)
  const { data: spPx } = await raw('splash.png')
  const bg = require(path.join(root, 'app.config.ts')).default({ config: {} }).splash.backgroundColor as string
  const hex = (o: number) => '#' + [spPx[o], spPx[o + 1], spPx[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
  check('splash.png\'s edge is the splash backgroundColor in app.config.ts (no visible seam)', hex(0) === bg.toLowerCase(), { edge: hex(0), bg })

  const n = await meta('notification-icon.png')
  check('notification-icon.png is 96×96 with transparency', n.width === 96 && n.height === 96 && n.hasAlpha === true, n)
  const { data: nPx } = await raw('notification-icon.png')
  let solidWhite = true, any = false
  for (let i = 0; i < nPx.length; i += 4) { if (nPx[i + 3] > 0) { any = true; if (nPx[i + 3] !== 255 || nPx[i] !== 255 || nPx[i + 1] !== 255 || nPx[i + 2] !== 255) solidWhite = false } }
  check('notification-icon.png is a solid white silhouette (Android tints it; any colour is lost)', any && solidWhite)
  check('every artwork file in the config exists (shared, no per-variant override needed)', ['icon.png', 'adaptive-icon.png', 'splash.png', 'notification-icon.png'].every((f) => fs.existsSync(A(f))))
}

console.log('app.config.ts — the store app')
{
  const saved = process.env.APP_VARIANT
  delete process.env.APP_VARIANT
  const c: any = (await import('../../apps/mobile/app.config.ts')).default({ config: {} })
  if (saved !== undefined) process.env.APP_VARIANT = saved
  const plugin = (name: string) => (c.plugins.find((p: any) => (Array.isArray(p) ? p[0] : p) === name) || [])[1] || {}
  const plist = c.ios.infoPlist
  check('version 1.0.0 (the runtime version follows it)', c.version === '1.0.0' && c.runtimeVersion?.policy === 'appVersion')
  check('bundle id and package are com.twomiah.crm', c.ios.bundleIdentifier === 'com.twomiah.crm' && c.android.package === 'com.twomiah.crm')
  check('iOS declares camera, photos and while-using location — each with the app\'s own reason', ['NSCameraUsageDescription', 'NSLocationWhenInUseUsageDescription'].every((k) => typeof plist[k] === 'string' && plist[k].length > 25) && /photo/i.test(plugin('expo-image-picker').photosPermission || ''))
  check('no background / "Always" location anywhere in the first store version', !('NSLocationAlwaysUsageDescription' in plist) && !('NSLocationAlwaysAndWhenInUseUsageDescription' in plist)
    && !c.android.permissions.some((p: string) => /BACKGROUND_LOCATION|FOREGROUND_SERVICE/.test(p)) && !c.extra.backgroundLocation
    && plugin('expo-location').locationAlwaysAndWhenInUsePermission === false && plugin('expo-location').isIosBackgroundLocationEnabled !== true)
  check('no microphone and no Face ID are declared (the plugins would add generic texts unless told false)', plugin('expo-camera').microphonePermission === false && plugin('expo-camera').recordAudioAndroid === false
    && plugin('expo-image-picker').microphonePermission === false && plugin('expo-secure-store').faceIDPermission === false)
  check('Android blocks the permissions the platform adds but the app never uses', ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW'].every((p) => c.android.blockedPermissions?.includes(p)))
  check('Apple\'s required-reason API list and the encryption flag are set', plist.ITSAppUsesNonExemptEncryption === false && (c.ios.privacyManifests?.NSPrivacyAccessedAPITypes || []).length >= 4)
  check('the store app has no locked vertical (any supported trade signs in)', c.extra.lockedVertical === undefined && c.extra.appVariant === 'generic')
  check('over-the-air updates point at the store app\'s own EAS project', c.updates?.url === `https://u.expo.dev/${c.extra.eas.projectId}` && c.updates.enabled === true)
}

console.log('eas.json — nothing is invented')
{
  const eas = JSON.parse(read('eas.json'))
  const ios = eas.submit.production.ios
  const placeholders = { appleId: /^TODO_/, ascAppId: /^TODO_|^\d{9,10}$/, appleTeamId: /^TODO_|^[A-Z0-9]{10}$/ } as const
  for (const [k, re] of Object.entries(placeholders)) check(`submit.production.ios.${k} is the owner's TODO or a real-looking value, never something made up`, re.test(ios[k]), ios[k])
  check('production builds are numbered by EAS (store builds need an ever-higher number)', eas.build.production.autoIncrement === true && eas.cli.appVersionSource === 'remote')
  check('the Play upload starts as an internal-track draft', eas.submit.production.android.track === 'internal' && eas.submit.production.android.releaseStatus === 'draft')
  check('the Play service-account key is a gitignored file, not in the repo', !fs.existsSync(path.join(root, 'google-play-service-account.json')) && /google-play-service-account/.test(fs.readFileSync(path.resolve(root, '../../.gitignore'), 'utf8') + (fs.existsSync(path.join(root, '.gitignore')) ? read('.gitignore') : '')))
}

console.log('store/listing.md')
{
  const md = read('store/listing.md')
  const between = (heading: string) => (md.split(new RegExp(`^## ${heading}.*$`, 'm'))[1] || '').split(/^## /m)[0]
  const quoted = (s: string) => (/^> (.+)$/m.exec(s) || [])[1] || ''
  const bullet = (label: RegExp) => (new RegExp(`${label.source}[^\`]*\`([^\`]+)\``).exec(md) || [])[1] || ''
  check('iOS name and Play title are "Twomiah CRM" (≤30)', bullet(/iOS App Store name/) === 'Twomiah CRM' && bullet(/Google Play title/) === 'Twomiah CRM')
  check('iOS subtitle ≤30', bullet(/iOS subtitle/).length > 0 && bullet(/iOS subtitle/).length <= 30, bullet(/iOS subtitle/).length)
  check('Play short description ≤80', bullet(/Google Play short description/).length > 0 && bullet(/Google Play short description/).length <= 80)
  check('promotional text ≤170', quoted(between('Promotional text')).length > 0 && quoted(between('Promotional text')).length <= 170, quoted(between('Promotional text')).length)
  const kw = /```\n([^\n]+)\n```/.exec(between('Keywords'))?.[1] || ''
  check('keywords ≤100 characters', kw.length > 0 && kw.length <= 100, kw.length)
  const full = between('Full description')
  check('full description ≤4000', full.trim().length > 800 && full.trim().length <= 4000, full.trim().length)
  check('release notes ≤4000', quoted(between('What\'s new')).length > 0)
  // The trades: exactly the app's (verticals.ts PHONE_VERTICALS), and not the ones it turns away — except to say so.
  const supported = ['contractors', 'field service', 'roofing', 'landscaping', 'home care', 'RV']
  const promo = quoted(between('Promotional text'))
  check('the promo names the supported trades', supported.every((t) => promo.includes(t)), promo)
  const claims = full.split('NOT FOR EVERY BUSINESS')[0]
  check('the description claims nothing for salons, restaurants, bars, stores, vets, dispensaries or POS before it says they use the website', !/salon|restaurant|bar\b|store|veterin|dispensar|budtender|point of sale|\bPOS\b/i.test(claims), (claims.match(/salon|restaurant|bar\b|store|veterin|dispensar|budtender|point of sale|\bPOS\b/i) || [])[0])
  check('it says salons, restaurants, bars, stores and vets use the website, and what the app does for them', /Salons, restaurants, bars, stores and veterinary practices use the Twomiah website CRM in their phone's browser/.test(full) && /opens the website sign-in/.test(full))
  check('no claim the product does not keep: no "EVV-compliant", no "works offline" for everything, no Sandata integration', !/EVV[- ]compliant|works offline|Sandata integration|integrates with Sandata/i.test(md))
  check('it says honestly that only home care clock-ins are saved offline', /works without signal and sends the visit when you reconnect/.test(full))
  check('privacy and support URLs are the live pages', md.includes('https://twomiah.com/privacy') && md.includes('https://twomiah.com/support'))
  check('no other product is named', !/quickbooks|servicetitan|jobber|housecall/i.test(claims + kw))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
