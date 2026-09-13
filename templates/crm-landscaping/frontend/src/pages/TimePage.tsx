// TimePage — shared implementation (packages/tenant-ui/src/people), vendored into this tenant as ../shared. Wrapper only.
import { TimePage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { timeConfig } from '../peopleConfig'

export default function TimePageWrapper() {
  const toast = useToast()
  return <TimePage api={api as any} toast={toast} config={timeConfig} />
}
