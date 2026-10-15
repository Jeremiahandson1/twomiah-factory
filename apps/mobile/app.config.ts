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
    easProjectId: CARE_EAS_PROJECT_ID,
  },
  generic: {
    appName: 'Twomiah',
    slug: 'twomiah-mobile',
    bundleId: 'com.twomiah.crm',
    scheme: 'twomiah',
    primaryColor: '#1e40af',
    lockedVertical: null,
    cameraPermission: 'Take job site photos and scan documents',
    locationPermission: 'Clock in at job sites and verify field check-ins',
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
      backgroundColor: v.primaryColor,
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: v.bundleId,
      infoPlist: {
        NSCameraUsageDescription: v.cameraPermission,
        NSLocationWhenInUseUsageDescription: v.locationPermission,
        NSLocationAlwaysUsageDescription: v.locationPermission,
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: asset(variant, 'adaptive-icon.png'),
        backgroundColor: v.primaryColor,
      },
      package: v.bundleId,
      permissions: [
        'CAMERA',
        'ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION',
        'RECEIVE_BOOT_COMPLETED',
        'VIBRATE',
      ],
      googleServicesFile: fs.existsSync(
        path.join(__dirname, `google-services.${variant}.json`),
      )
        ? `./google-services.${variant}.json`
        : './google-services.json',
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      ['expo-camera', { cameraPermission: v.cameraPermission }],
      ['expo-location', { locationWhenInUsePermission: v.locationPermission }],
      [
        'expo-notifications',
        {
          icon: asset(variant, 'notification-icon.png'),
          color: v.primaryColor,
        },
      ],
      [
        'expo-image-picker',
        variant === 'care'
          ? {
              photosPermission: 'Allow Twomiah Care to attach photos from your library to a visit or an incident report',
              cameraPermission: v.cameraPermission,
            }
          : { photosPermission: `Allow ${v.appName} to access photos for documentation` },
      ],
      '@react-native-community/datetimepicker',
    ],
    extra: {
      ...(projectId ? { eas: { projectId } } : {}),
      apiUrl: '',
      appVariant: variant,
      appName: v.appName,
      primaryColor: v.primaryColor,
      // Only emit lockedVertical for branded variants; generic stays multi-vertical.
      ...(v.lockedVertical ? { lockedVertical: v.lockedVertical } : {}),
    },
  }
}
