// IntegrationsPage — shared implementation (packages/tenant-ui/src), vendored into this tenant as ../shared. Wrapper only.
import { IntegrationsPage } from '../../shared'
import api from '../../services/api'
import { integrationsConfig } from '../../integrationsConfig'

export default function IntegrationsPageWrapper() {
  return <IntegrationsPage api={api as any} config={integrationsConfig} />
}
