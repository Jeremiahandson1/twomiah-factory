import type { Context } from 'hono'

/**
 * The uploaded form, or an EMPTY one when the body is not multipart.
 *
 * `c.req.formData()` throws on a non-multipart body, which turned every upload endpoint into a 500
 * for a request that its own "No file uploaded" check was already written to refuse with a 400. The
 * check could never run. Returning an empty form puts the handler's own refusal back in charge.
 */
export const uploadedForm = async (c: Context): Promise<FormData> => {
  try {
    return await c.req.formData()
  } catch {
    return new FormData()
  }
}
