// Template glue — the browser API client is shared (packages/tenant-ui/src/api/client.ts, vendored into ./shared):
// timeout, single-flight tri-state token refresh, undefined-free queries and the resource namespaces live there.
import { api } from '../shared'

export { api }
export default api
