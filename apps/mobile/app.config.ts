/**
 * Expo dynamic config — produces a different app per APP_VARIANT.
 *
 *   APP_VARIANT=build    → Twomiah Build   (contractor vertical, locked)
 *   APP_VARIANT=roofer   → Twomiah Roofer  (roofing vertical, locked)
 *   (unset)              → generic Twomiah dev build, no vertical lock
 *
 * Per-variant artwork lives in ./assets/<variant>/. Until those files exist,
 * each variant falls back to the shared ./assets/*.png. Drop branded
 * icon.png / adaptive-icon.png / splash.png / notification-icon.png into
 * ./assets/build/ and ./assets/roofer/ to override.
 */

import { ExpoConfig, ConfigContext } from 'expo/config'
import * as fs from 'fs'
import * as path from 'path'

type Variant = 'build' | 'roofer' | 'generic'

interface VariantSpec {
  appName: string
  slug: string
  bundleId: string
  scheme: string
  primaryColor: string
  lockedVertical: 'contractor' | 'roofing' | null
  cameraPermission: string
  locationPermission: string
}

const VARIANTS: Record<Variant, VariantSpec> = {
  build: {
    appName: 'Twomiah Build',
    slug: 'twomiah-build',
    bundleId: 'com.twomiah.build',
    scheme: 'twomiahbuild',
    primaryColor: '#1e40af',
    lockedVertical: 'contractor',
    cameraPermission: 'Allow Twomiah Build to capture job site photos and scan documents',
    locationPermission: 'Allow Twomiah Build to verify field check-ins at job sites',
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
  },
}

function resolveVariant(): Variant {
  const raw = process.env.APP_VARIANT?.toLowerCase()
  if (!raw) return 'generic'
  if (raw === 'build' || raw === 'roofer' || raw === 'generic') return raw
  throw new Error(`APP_VARIANT must be 'build', 'roofer', or 'generic' (got: ${raw})`)
}

/** Use ./assets/<variant>/<file> if it exists, otherwise fall back to shared ./assets/<file>. */
function asset(variant: Variant, file: string): string {
  const branded = path.join(__dirname, 'assets', variant, file)
  return fs.existsSync(branded) ? `./assets/${variant}/${file}` : `./assets/${file}`
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const variant = resolveVariant()
  const v = VARIANTS[variant]

  return {
    ...config,
    name: v.appName,
    slug: v.slug,
    version: '1.0.0',
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
        { photosPermission: `Allow ${v.appName} to access photos for documentation` },
      ],
      '@react-native-community/datetimepicker',
    ],
    extra: {
      eas: { projectId: process.env.EAS_PROJECT_ID || '' },
      apiUrl: '',
      appVariant: variant,
      appName: v.appName,
      primaryColor: v.primaryColor,
      // Only emit lockedVertical for branded variants; generic stays multi-vertical.
      ...(v.lockedVertical ? { lockedVertical: v.lockedVertical } : {}),
    },
  }
}
