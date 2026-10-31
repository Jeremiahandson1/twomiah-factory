/** Stripe Terminal is phones only (./terminal.native.ts): on the web there is no Tap to Pay. */
export function loadTerminal(): any | null {
  return null
}
