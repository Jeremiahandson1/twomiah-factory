# Tap to Pay on the phone

**Status (10/31): BUILT, not ready** — feature `tap_to_pay`, hidden. The owner's decision (10/30): YES, Stripe Terminal's
Tap to Pay, each business's own Stripe.

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
- **Build config** (`apps/mobile/app.config.ts`): Stripe Terminal's Expo plugin (with `tapToPayCheck`, the app's own location
  text), Android minimum raised to API 26 (Android 8) through `expo-build-properties` — the SDK requires it — and the
  plugin's Bluetooth permissions blocked (no card readers in this app).

## Before it can be switched on
1. **A new native build** of the phone app (an over-the-air update cannot add the SDK). This is the first build with the
   SDK: watch it for Android and iOS build errors.
2. **Apple's Tap to Pay on iPhone entitlement**, requested by the Apple developer account holder. When Apple grants it, set
   `TAP_TO_PAY_IOS=1` in the EAS build profile — a build carrying the entitlement before Apple grants it fails signing.
3. **Test for real**: Stripe test mode on a connected test account, a real phone, Stripe's test cards; check the payment
   lands on the invoice once, and a refund from the desktop goes back through Stripe.
