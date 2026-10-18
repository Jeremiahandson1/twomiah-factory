// The uploaded form, or an EMPTY one when the body is not multipart. Moved from templates/crm/backend/src/utils/upload.ts.
//
// `c.req.formData()` throws on a non-multipart body, which turned every upload endpoint into a 500 for a request that
// its own "No file uploaded" check was already written to refuse with a 400. Returning an empty form puts the
// handler's own refusal back in charge.
import type { Context } from 'hono'

export const uploadedForm = async (c: Context): Promise<FormData> => {
  try {
    return await c.req.formData()
  } catch {
    return new FormData()
  }
}
