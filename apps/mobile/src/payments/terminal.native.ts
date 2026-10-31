/**
 * Stripe Terminal's SDK on a phone (Tap to Pay, app/(details)/invoice/tap.tsx). A native module: an app built before it
 * was added has none, so it is loaded when the Tap to Pay screen asks, and null comes back rather than a crash. The web
 * build gets ./terminal.ts instead — the SDK's web entry does not bundle (its compiled logger requires a package.json
 * path that only exists beside its source, which iOS and Android read).
 */
export function loadTerminal(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require('@stripe/stripe-terminal-react-native')
    return sdk?.StripeTerminalProvider && sdk?.useStripeTerminal ? sdk : null
  } catch { return null }
}
