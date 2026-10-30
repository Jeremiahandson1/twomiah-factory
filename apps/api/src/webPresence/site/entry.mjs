// The real wiring of the site's function (bundled with @netlify/blobs into the one file that is deployed). The page's first
// version, the model and the spec are generated at publish time into ./payload.mjs.
import { getStore, connectLambda } from '@netlify/blobs'
import { createHandler } from './handler.mjs'
import { toRequest, fromResponse } from './lambda.mjs'
import { INITIAL, SPEC } from './payload.mjs'

// The store is EVENTUALLY consistent: in a Lambda-style function `connectLambda` gives Blobs no `uncachedEdgeURL`, so a strong
// read throws (BlobsConsistencyError) — every route of the live $19 test site answered 500 (10/30). What must be exact is done
// with an atomic conditional write instead (the sign-in link's single use: `onlyIfNew`, checked at the origin).
export const handler = async (event) => {
  connectLambda(event)
  const h = createHandler({ store: getStore({ name: 'wp' }), env: process.env, initial: INITIAL, spec: SPEC })
  return fromResponse(await h(toRequest(event)))
}
