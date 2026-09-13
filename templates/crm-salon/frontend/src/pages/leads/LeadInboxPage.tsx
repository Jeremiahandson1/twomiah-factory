// LeadInboxPage — shared implementation (packages/tenant-ui/src/leads), vendored into this tenant as ../shared. Wrapper only.
import { LeadInboxPage } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { useSocket } from '../../contexts/SocketContext'
import { leadsConfig } from '../../leadsConfig'

export default function LeadInboxPageWrapper() {
  const toast = useToast()
  const { subscribe } = useSocket()
  return <LeadInboxPage api={api as any} toast={toast} config={leadsConfig} subscribe={subscribe} />
}
