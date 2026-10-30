// The addresses the demo build must not hold, in one place: the build (web/vite.demo.config.ts) scrubs them and the test
// (tests/demo/outbound.test.ts) looks for them in what was built.
/**
 * No address of Twomiah, Stripe, Twilio, Cloudflare, Render or Netlify in the build — not even as a link's text. The screens
 * name a few (a "Get an account" link, the Stripe dashboard): in the demo each is turned into a dead anchor, so the build
 * holds nothing that points outside, and tests/demo/outbound.test.ts can hold it to that.
 */
export const OUTSIDE_URL = /(?:https?|wss?):\/\/[^\s'"`)<>\\]*?(?:twomiah|stripe|twilio|cloudflare|onrender|netlify|googleapis|gstatic|openstreetmap|mapbox|cartocdn)[^\s'"`)<>\\]*/gi
