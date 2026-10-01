/**
 * Errors that carry their own HTTP status.
 *
 * crm-roof handles errors inline in index.ts rather than through a shared module, and until now that
 * handler ended at a hard 500 — so a service throwing "Quote not found" told the caller the server
 * had broken, for a record that is simply not there. The handler now honours a 4xx on the error, and
 * this is where services get one from.
 *
 * Deliberately tiny: roof keeps only sanitize.ts in utils, and the point here is a shared not-found,
 * not an error framework.
 */

/** A not-found a service can throw and a route can let bubble: the handler turns it into a 404. */
export const notFound = (message = 'Not found') => Object.assign(new Error(message), { status: 404 })
