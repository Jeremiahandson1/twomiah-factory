/**
 * Expo dynamic config — produces a different app per APP_VARIANT.
 *
 *   APP_VARIANT=build    → Twomiah Build   (contractor vertical, locked)
 *   APP_VARIANT=roofer   → Twomiah Roofer  (roofing vertical, locked)
 *   APP_VARIANT=care     → Twomiah Care    (home care vertical, locked — the caregiver app)
 *   (unset)              → generic Twomiah dev build, no vertical lock
 *
 * Per-variant artwork lives in ./assets/<variant>/. Until those files exist,
 * each variant falls back to the shared ./assets/*.png. Drop branded
 * icon.png / adaptive-icon.png / splash.png / notification-icon.png into
 * ./assets/build/, ./assets/roofer/ and ./assets/care/ to override.
 */

import type { ExpoConfig, ConfigContext } from 'expo/config'
import * as fs from 'fs'
import * as path from 'path'

export type Variant = 'build' | 'roofer' | 'care' | 'generic'

export interface VariantSpec {
  appName: string
  slug: string
  bundleId: string
  scheme: string
  primaryColor: string
  lockedVertical: 'contractor' | 'roofing' | 'homecare' | null
  cameraPermission: string
  locationPermission: string
  /**
   * Background location ("Always"), for the person's own "Share my location while working" switch
   * (src/location/tracking.ts): the iOS "Always" prompt text, or null for a variant that never tracks in
   * the background. Only trade apps whose businesses can have gps_tracking carry it: Twomiah Build (the generic app
   * does not, in its first store version — see `generic` below). NOT Twomiah Care (a caregiver's location is recorded at clock-in / clock-out for EVV) and
   * NOT Twomiah Roofer (roofing is not offered gps_tracking, so the switch never shows; both stores refuse an
   * app that declares background location it never uses).
   */
  backgroundLocationPermission: string | null
  /**
   * This variant's EAS project (expo.dev, account jeremiahandson). One project per variant, because an
   * EAS project is bound to ONE slug — a single shared EAS_PROJECT_ID, which is what this file used to
   * read, fails `eas build` / `eas update` with a slug mismatch on two of the three apps. Project ids
   * are public identifiers (they sit in the update URL every installed app requests), not secrets.
   */
  easProjectId: string
}

/**
 * Twomiah Care has no EAS project yet — it must be created by the owner on expo.dev, not invented
 * here. Until this constant holds the real id, `eas build` for the care profiles stops with
 * CARE_EAS_PROJECT_MISSING (below) and the config ships no update URL.
 *
 * To create it: expo.dev → account "jeremiahandson" → Projects → Create project, slug `twomiah-care`
 * (it must be exactly that — the slug below), then paste its Project ID here.
 */
export const CARE_EAS_PROJECT_ID_PLACEHOLDER = 'CREATE-ON-EXPO-DEV-twomiah-care'
export const CARE_EAS_PROJECT_ID: string = CARE_EAS_PROJECT_ID_PLACEHOLDER

export const CARE_EAS_PROJECT_MISSING =
  'Twomiah Care has no EAS project yet. Create it on expo.dev: account "jeremiahandson" → Projects → ' +
  'Create a project with the slug "twomiah-care" (exactly). Copy its Project ID and set ' +
  'CARE_EAS_PROJECT_ID in apps/mobile/app.config.ts to it, then run the build again.'

export const VARIANTS: Record<Variant, VariantSpec> = {
  build: {
    appName: 'Twomiah Build',
    slug: 'twomiah-build',
    bundleId: 'com.twomiah.build',
    scheme: 'twomiahbuild',
    primaryColor: '#1e40af',
    lockedVertical: 'contractor',
    cameraPermission: 'Allow Twomiah Build to capture job site photos and scan documents',
    locationPermission: 'Allow Twomiah Build to verify field check-ins at job sites',
    backgroundLocationPermission:
      'Only if you turn on location sharing in the app: Twomiah Build uses your location while you work, even when the app is closed, to clock you in and out at job sites and show your office where the crew is',
    easProjectId: 'd914c704-9047-414f-ad1b-27b7e3099b68',
  },
  roofer: {
    appName: 'Twomiah Roofer',
    slug: 'twomiah-roofer',
    bundleId: 'com.twomiah.roofer',
    scheme: 'twomiahroofer',
    primaryColor: '#dc2626',
    lockedVertical: 'roofing',
    cameraPermission: 'Allow Twomiah Roofer to capture roof photos and damage documentation',
    locationPermission: 'Allow Twomiah Roofer to verify canvass routes and on-site check-ins',
    backgroundLocationPermission: null,
    easProjectId: '4c6bd5f4-6680-451c-b3d7-d4c31eae44f4',
  },
  care: {
    appName: 'Twomiah Care',
    slug: 'twomiah-care',
    bundleId: 'com.twomiah.care',
    scheme: 'twomiahcare',
    // Teal: calm and clinical-adjacent, and white text on it passes 4.5:1 (5.5:1).
    primaryColor: '#0f766e',
    lockedVertical: 'homecare',
    cameraPermission: 'Allow Twomiah Care to take visit photos and incident photos for your agency',
    locationPermission: 'Allow Twomiah Care to record your location when you clock in and out of a visit, so your agency can verify the visit (EVV)',
    backgroundLocationPermission: null,
    easProjectId: CARE_EAS_PROJECT_ID,
  },
  generic: {
    appName: 'Twomiah',
    slug: 'twomiah-mobile',
    bundleId: 'com.twomiah.crm',
    scheme: 'twomiah',
    primaryColor: '#1e40af',
    lockedVertical: null,
    cameraPermission: 'Allow Twomiah to take job photos and scan documents for your business',
    locationPermission: 'Allow Twomiah to record where you are when you clock in or out of a job or visit, and to fill in an address',
    // NOT in the first store submission (owner decision pending; recommended in store/READY.md): Google reviews background
    // location separately (a declaration form and a demo video) and Apple asks for a convincing reason, for one opt-in switch
    // that only a business with the GPS add-on can use. Twomiah Build keeps it (the code is all there). To put it back in
    // the store app, restore the text below, bump `version`, and fill Google's background-location form (READY.md §5):
    //   'Only if you turn on location sharing in the app: your business uses your location while you work, even when the app
    //    is closed, to clock you in and out at job sites and show the office where the crew is'
    backgroundLocationPermission: null,
    easProjectId: 'd8c46085-a58c-4fd7-9913-6f33e95fa4f7',
  },
}

export function resolveVariant(raw = process.env.APP_VARIANT): Variant {
  const v = raw?.toLowerCase()
  if (!v) return 'generic'
  if (v === 'build' || v === 'roofer' || v === 'care' || v === 'generic') return v
  throw new Error(`APP_VARIANT must be 'build', 'roofer', 'care', or 'generic' (got: ${raw})`)
}

/** A real EAS project id, not the placeholder. */
export const hasEasProject = (v: VariantSpec) => !!v.easProjectId && v.easProjectId !== CARE_EAS_PROJECT_ID_PLACEHOLDER

/**
 * Is EAS building (or about to build) this config? The EAS build servers set EAS_BUILD=true; the
 * care profiles in eas.json set TWOMIAH_EAS_BUILD so `eas build` stops on THIS machine too, before
 * anything is uploaded. `expo start` / `expo config` set neither, so local work is not blocked.
 */
export const isEasBuild = (env: NodeJS.ProcessEnv = process.env) => env.EAS_BUILD === 'true' || env.EAS_BUILD === '1' || !!env.TWOMIAH_EAS_BUILD

/**
 * Twomiah's own colours behind the icon and on the splash (owner, 2026-10-28: the app should look like twomiah.com): its
 * near-black ground (--dark) and the flame's middle orange for Android's notification tint. assets/source/build-icons.ts draws
 * the artwork on the same ground. The sign-in screen's buttons are the flame (extra.signInColor, with dark ink); after sign-in
 * they take the business's own colour.
 */
export const TWOMIAH_DARK = '#0D0D0D'
export const TWOMIAH_FLAME = '#FF6D00'

/** Use ./assets/<variant>/<file> if it exists, otherwise fall back to shared ./assets/<file>. */
function asset(variant: Variant, file: string): string {
  const branded = path.join(__dirname, 'assets', variant, file)
  return fs.existsSync(branded) ? `./assets/${variant}/${file}` : `./assets/${file}`
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant()
  const v = VARIANTS[variant]
  if (!hasEasProject(v) && isEasBuild()) throw new Error(CARE_EAS_PROJECT_MISSING)
  const projectId = hasEasProject(v) ? v.easProjectId : undefined
  const bg = v.backgroundLocationPermission

  return {
    ...config,
    name: v.appName,
    slug: v.slug,
    version: '1.0.0',
    /**
     * OVER-THE-AIR UPDATES (EAS Update). (T59)
     *
     * A JavaScript fix — every mobile fix so far — reaches installed apps in minutes, without a store
     * review, instead of waiting for a new build. Native changes (a new permission, a new native module)
     * still need a store build; `runtimeVersion: appVersion` is what keeps the two apart: an update is
     * only offered to builds with the same `version`, so bump `version` whenever a native change ships.
     *
     * The update URL is the variant's own EAS project (see easProjectId), so an update published for
     * Twomiah Roofer can only ever reach Roofer installs. A variant with no EAS project yet (Twomiah
     * Care until the owner creates it) gets no update URL rather than someone else's.
     */
    runtimeVersion: { policy: 'appVersion' },
    updates: projectId
      ? { url: `https://u.expo.dev/${projectId}`, enabled: true, checkAutomatically: 'ON_LOAD', fallbackToCacheTimeout: 0 }
      : { enabled: false },
    orientation: 'portrait',
    icon: asset(variant, 'icon.png'),
    scheme: v.scheme,
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    splash: {
      image: asset(variant, 'splash.png'),
      resizeMode: 'contain',
      backgroundColor: TWOMIAH_DARK,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: v.bundleId,
      infoPlist: {
        NSCameraUsageDescription: v.cameraPermission,
        NSLocationWhenInUseUsageDescription: v.locationPermission,
        // Only a build that asks for "Always" carries its text; the others ask "while using" and nothing more.
        ...(bg ? { NSLocationAlwaysUsageDescription: bg, NSLocationAlwaysAndWhenInUseUsageDescription: bg } : {}),
        // The app talks to its server over HTTPS only (no encryption of its own): no export-compliance question on each upload.
        ITSAppUsesNonExemptEncryption: false,
      },
      // Tap to Pay on iPhone (tap_to_pay): Apple grants this entitlement to the developer account on request. A build that
      // carries it before Apple has granted it fails signing, so it is added only when the build says so
      // (TAP_TO_PAY_IOS=1 in the EAS profile, once Apple's email arrives).
      ...(process.env.TAP_TO_PAY_IOS === '1' ? { entitlements: { 'com.apple.developer.proximity-reader.payment.acceptance': true } } : {}),
      // Apple's required-reason API declarations for what the app and its libraries use (Expo's list for SDK 52).
      privacyManifests: {
        NSPrivacyAccessedAPITypes: [
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults', NSPrivacyAccessedAPITypeReasons: ['CA92.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp', NSPrivacyAccessedAPITypeReasons: ['C617.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime', NSPrivacyAccessedAPITypeReasons: ['35F9.1'] },
          { NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace', NSPrivacyAccessedAPITypeReasons: ['E174.1'] },
        ],
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: asset(variant, 'adaptive-icon.png'),
        backgroundColor: TWOMIAH_DARK,
      },
      package: v.bundleId,
      // Added by the platform's defaults, not used by this app: no sound recording, no drawing over other apps. Bluetooth is
      // added by Stripe Terminal's plugin for its card readers; this app takes cards only by Tap to Pay on the phone itself.
      blockedPermissions: [
        'android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.BLUETOOTH', 'android.permission.BLUETOOTH_ADMIN', 'android.permission.BLUETOOTH_SCAN', 'android.permission.BLUETOOTH_CONNECT',
      ],
      permissions: [
        'CAMERA',
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'RECEIVE_BOOT_COMPLETED',
        'VIBRATE',
        ...(bg ? ['ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION'] : []),
      ],
      // On EAS the file is a secret file variable (gitignored files are never uploaded): GOOGLE_SERVICES_JSON holds its path.
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? (fs.existsSync(
        path.join(__dirname, `google-services.${variant}.json`),
      )
        ? `./google-services.${variant}.json`
        : './google-services.json'),
    },
    plugins: [
      'expo-router',
      // No Face ID, no microphone: the app signs in with a password and takes photos, never video or sound. Each plugin adds
      // its own default usage text (and Android's RECORD_AUDIO) unless told `false`, and a store reviewer reads every one.
      ['expo-secure-store', { faceIDPermission: false }],
      ['expo-camera', { cameraPermission: v.cameraPermission, microphonePermission: false, recordAudioAndroid: false }],
      [
        'expo-location',
        bg
          ? {
              locationWhenInUsePermission: v.locationPermission,
              locationAlwaysAndWhenInUsePermission: bg,
              locationAlwaysPermission: bg,
              isIosBackgroundLocationEnabled: true,
              isAndroidBackgroundLocationEnabled: true,
              isAndroidForegroundServiceEnabled: true,
            }
          // "While using" only: the plugin would otherwise add generic "Always" texts for a permission the app never asks.
          : { locationWhenInUsePermission: v.locationPermission, locationAlwaysAndWhenInUsePermission: false, locationAlwaysPermission: false },
      ],
      [
        'expo-notifications',
        {
          icon: asset(variant, 'notification-icon.png'),
          color: TWOMIAH_FLAME,
        },
      ],
      [
        'expo-image-picker',
        variant === 'care'
          ? {
              photosPermission: 'Allow Twomiah Care to attach photos from your library to a visit or an incident report',
              cameraPermission: v.cameraPermission,
              microphonePermission: false,
            }
          : { photosPermission: `Allow ${v.appName} to attach photos from your library to jobs and records`, cameraPermission: v.cameraPermission, microphonePermission: false },
      ],
      '@react-native-community/datetimepicker',
      // Tap to Pay (tap_to_pay, not ready): Stripe Terminal's SDK. Its plugin adds the Swift file iOS needs to build it and,
      // with tapToPayCheck, Android's guard for the Tap to Pay process; the location text stays the app's own.
      ['@stripe/stripe-terminal-react-native', { locationWhenInUsePermission: v.locationPermission, tapToPayCheck: true }],
      // Stripe Terminal's Android library needs Android 8 (API 26) or later; Expo 54 builds for 7 (24) by default.
      ['expo-build-properties', { android: { minSdkVersion: 26 } }],
    ],
    extra: {
      ...(projectId ? { eas: { projectId } } : {}),
      apiUrl: '',
      appVariant: variant,
      appName: v.appName,
      primaryColor: v.primaryColor,
      // The sign-in screen (before any business's colour is known): the store app wears Twomiah's flame like twomiah.com.
      signInColor: variant === 'generic' ? TWOMIAH_FLAME : v.primaryColor,
      // The app shows the location switch only in a build that declares background location.
      ...(bg ? { backgroundLocation: true } : {}),
      // Only emit lockedVertical for branded variants; generic stays multi-vertical.
      ...(v.lockedVertical ? { lockedVertical: v.lockedVertical } : {}),
    },
  }
}
