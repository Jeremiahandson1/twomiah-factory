// LeadSourcesPage — shared implementation (packages/tenant-ui/src/leads), vendored into this tenant as ../shared. Wrapper only.
import { LeadSourcesPage } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { leadsConfig } from '../../leadsConfig'

export default function LeadSourcesPageWrapper() {
  const toast = useToast()
  return <LeadSourcesPage api={api as any} toast={toast} config={leadsConfig} />
}
