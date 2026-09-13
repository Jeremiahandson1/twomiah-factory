// ImportPage — shared implementation (packages/tenant-ui/src), vendored into this tenant as ../shared. Wrapper only.
import { ImportPage } from '../../shared'
import api from '../../services/api'
import { importConfig } from '../../integrationsConfig'

export default function ImportPageWrapper() {
  return <ImportPage api={api as any} config={importConfig} />
}
