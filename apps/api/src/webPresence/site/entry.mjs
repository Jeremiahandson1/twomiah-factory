// The real wiring of the site's function (bundled with @netlify/blobs into the one file that is deployed). The page's first
// version, the model and the spec are generated at publish time into ./payload.mjs.
import { getStore, connectLambda } from '@netlify/blobs'
import { createHandler } from './handler.mjs'
import { toRequest, fromResponse } from './lambda.mjs'
import { INITIAL, SPEC } from './payload.mjs'

export const handler = async (event) => {
  connectLambda(event)
  const h = createHandler({ store: getStore({ name: 'wp', consistency: 'strong' }), env: process.env, initial: INITIAL, spec: SPEC })
  return fromResponse(await h(toRequest(event)))
}
