// The real wiring of the site's function (bundled with @netlify/blobs into the one file that is deployed). The page's first
// version, the model and the spec are generated at publish time into ./payload.mjs.
import { getStore, connectLambda, setEnvironmentContext } from '@netlify/blobs'
import { createHandler } from './handler.mjs'
import { toRequest, fromResponse, blobsContext, strongReads, purger } from './lambda.mjs'
import { INITIAL, SPEC } from './payload.mjs'

// `connectLambda` alone gives Blobs no `uncachedEdgeURL`, so a strong read throws (BlobsConsistencyError — every route of the live
// $19 test site answered 500, 10/30) and reads are eventually consistent. When Netlify sends the uncached address too, every read is
// made strong (blobsContext + strongReads): a save shows at once. Either way, a save clears the page from Netlify's CDN by tag
// (purger). What must be exact regardless is done with an atomic conditional write (the sign-in link's single use: `onlyIfNew`).
export const handler = async (event, context) => {
  connectLambda(event)
  const b = blobsContext(event, setEnvironmentContext)
  const raw = getStore({ name: 'wp' })
  const h = createHandler({ store: b.fresh ? strongReads(raw) : raw, env: process.env, initial: INITIAL, spec: SPEC, fresh: b.fresh, purge: purger(context, b.siteID) })
  return fromResponse(await h(toRequest(event)))
}
