# Tap to Pay on the phone

**Status (10/31): BUILT, ready to switch on — not seen on a real phone, no EAS build run here** — feature `tap_to_pay`,
hidden. The owner's decision (10/30): YES, Stripe Terminal's Tap to Pay, each business's own Stripe.

## What was built
- **Server** (`packages/tenant-backend/src/payments/stripe.ts`, `/api/stripe/tap-to-pay/…`, `invoices:update`, behind
  `online_payments` and `tap_to_pay`): a connection token and the business's Terminal location (made once from its address,
  per Stripe account); an in-person (`card_present`) PaymentIntent for what an invoice owes, never more; recording only
  after reading the PaymentIntent back from Stripe — succeeded, or captured if only authorised — through the same
  `handlePaymentSuccess` as the webhook, so the payment is written once. Everything on the business's connected account;
  none connected → refused in words. Test: `apps/unified/tests/tap-to-pay.test.ts`.
- **Phone** (`apps/mobile/app/(details)/invoice/tap.tsx`, "Tap to Pay" on the invoice): Stripe Terminal React Native SDK
  `0.0.1-beta.33` (the last version for React Native 0.81 / Expo 54; beta.34 needs RN 0.83). The SDK is loaded on that
  screen only: an app build without it says "update the app" instead of crashing.
- **Build config** (`apps/mobile/app.config.ts`, `apps/mobile/eas.json`): Stripe Terminal's Expo plugin (with
  `tapToPayCheck`, the app's own location text, and the app's own honest words for the Bluetooth / local-network texts the
  plugin always writes on iOS), Android minimum raised to API 26 (Android 8) through `expo-build-properties` — the SDK's
  own `build.gradle` says 26 — and the plugin's Bluetooth permissions blocked (no card readers in this app). The iOS
  Tap to Pay entitlement (`com.apple.developer.proximity-reader.payment.acceptance`) is carried only when the build sets
  `TAP_TO_PAY_IOS=1`; every `eas.json` build profile sets it to `"0"` (the base `development` / `preview` / `production`
  profiles; the variant profiles inherit `env` through `extends`). Generated `apps/mobile/android/`, `ios/` and `.expo/`
  are gitignored.

## Verified here (10/31, no EAS account, no phone)
- `bun install`, then `expo config --type prebuild` resolves for all four variants (generic, build, roofer, care).
- `expo prebuild --no-install --platform all` (generic, `TAP_TO_PAY_IOS=1`, a placeholder `google-services.json`)
  finished for Android and iOS. In its output: `android/gradle.properties` has `android.minSdkVersion=26`;
  `MainApplication.kt` imports `com.stripeterminalreactnative.TapToPay` and returns from `onCreate` inside the Tap to Pay
  process (`tapToPayCheck`); the manifest carries `tools:node="remove"` for `BLUETOOTH`, `BLUETOOTH_ADMIN`,
  `BLUETOOTH_CONNECT`, `BLUETOOTH_SCAN`; `android.jetifier.ignorelist=jackson-core` is set by the plugin; iOS has
  `noop-file.swift`, the entitlement in `Twomiah.entitlements`, and the Podfile at iOS 15.1 (the SDK's pod asks for 15.1).
  Without `TAP_TO_PAY_IOS` the entitlement is absent. The generated folders were deleted, not committed.
- `tsc --noEmit` for apps/mobile: 0 errors.
- `expo-doctor`: 17/18 checks pass. The one failure is "duplicate dependencies" for `expo-constants` and `expo-linking` —
  the same version twice through bun's isolated-install store on this machine, not two versions; EAS installs on its own
  servers. Nothing is wrong with the package set.
- Not verified here: Gradle and Xcode never ran (no Android SDK, no macOS) — the SDK's native compile, CocoaPods
  resolution of `StripeTerminal ~> 5.8.0`, and signing are only seen in a real EAS build.
- Test: `tests/mobile/tap-to-pay-build.test.ts` (plain bun; fails without the config: minimum below the SDK's, no
  `tapToPayCheck`, a Bluetooth permission the plugin adds that is not blocked, the entitlement without the flag or missing
  with it, a profile that does not set `TAP_TO_PAY_IOS`).

## The owner's steps to switch it on
1. **Apple's Tap to Pay on iPhone entitlement** (the Apple developer account holder, team 63XSWU8M5Z): Apple's request
   form is at https://developer.apple.com/contact/request/tap-to-pay-on-iphone/ (signed in as the Account Holder; it asks
   for the app, its bundle id and the payment provider — Stripe). Apple answers by email; allow some weeks. When granted,
   the "Tap to Pay on iPhone" capability appears on the app's identifier in the developer portal — one request per app id
   that will take cards (`com.twomiah.crm` for the store app; `com.twomiah.build` / `com.twomiah.roofer` /
   `com.twomiah.care` for the branded apps). Android needs no request: Tap to Pay on Android is in Stripe's SDK.
2. **Flip the flag**: in `apps/mobile/eas.json` change `TAP_TO_PAY_IOS` from `"0"` to `"1"` in the `production` (and, for a
   test build, `preview`) profile — or only in the variant profile whose app id Apple granted (a child profile's `env`
   overrides the base's). Do not flip it before Apple's email: a build carrying the entitlement before Apple grants it
   fails signing on EAS. EAS syncs the identifier's capabilities from the entitlements on the next build; if it does not
   offer to, regenerate the provisioning profile once (`eas credentials` → iOS → the build profile).
3. **Build** (a native build; an over-the-air update cannot add the SDK). Bump `version` in `app.config.ts` first so
   OTA updates stay with their build (`runtimeVersion: appVersion`). From `apps/mobile`:
   - `eas build --platform android --profile preview` — an APK for a real Android 8+ phone with NFC;
   - `eas build --platform ios --profile preview` — an internal iOS build (an iPhone XS or later, iOS 16.4+ for Tap to Pay);
   - for the store: `eas build --platform all --profile production` (or `build-production` / `roofer-production` for the
     branded apps). This is the first build with the SDK: watch it for Android and iOS build errors; `expo-doctor`'s
     duplicate warning is bun's layout here and does not apply on EAS.
4. **Test for real, in Stripe test mode**: a business with a connected test-mode Stripe account and `tap_to_pay` switched
   on (it is hidden: the factory switches it on per business), a real phone, and Stripe's test-mode Tap to Pay (its docs
   say how a test tap is made in test mode; no money moves). Open an invoice → "Tap to Pay" → take the balance. Check:
   the payment lands on the invoice once (the webhook
   and the phone's read-back agree), a partial amount leaves the right balance, and a refund from the desktop goes back
   through Stripe.
5. Then switch the feature on for real businesses (the feature registry keeps it `hidden` until then).

## Not seen here
Not seen on a real phone, and no EAS build run here: the SDK's native compile, Apple's entitlement grant, Stripe's Tap to
Pay onboarding prompts on the phone, and a real tap. Everything above the native layer (server, screen, config) is tested.
