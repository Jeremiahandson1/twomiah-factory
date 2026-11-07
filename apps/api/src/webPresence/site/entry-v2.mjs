// The site's function in Netlify's CURRENT format (a "v2" function: Request in, Response out). Lambda-compatibility mode — the
// format entry.mjs runs in — stops being accepted on July 1, 2027 (docs.netlify.com/build/functions/lambda-compatibility/).
// What this format gives (documented): Blobs reads that are strongly consistent when asked (no `connectLambda`; Netlify's own
// bootstrap configures the store, uncached address included), and the CDN purge token in NETLIFY_PURGE_API_TOKEN.
// Packaged by publish.ts with Netlify's bootstrap (@netlify/serverless-functions-api), as its own CLI packages one.
import { getStore } from '@netlify/blobs'
import { createHandler } from './handler.mjs'
import { purgeWith } from './lambda.mjs'
import { INITIAL, SPEC } from './payload.mjs'

export default async (req, context) => {
  const store = getStore({ name: 'wp', consistency: 'strong' })
  const siteID = (context && context.site && context.site.id) || process.env.SITE_ID || ''
  const purge = purgeWith(process.env.NETLIFY_PURGE_API_TOKEN, siteID)
  const h = createHandler({ store, env: process.env, initial: INITIAL, spec: SPEC, fresh: true, purge })
  return h(req)
}
