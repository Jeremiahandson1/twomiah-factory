// CommissionsPage — shared implementation (packages/tenant-ui/src/commissions), vendored as ../shared. Wrapper only.
import { CommissionsPage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'

// The four stored keys in this CRM's words — field service's own words — a technician and a sales rep are what this trade calls them (T58).
const ROLE_WORDS: Record<string, string> = {
  technician: 'Technician',
  sales_rep: 'Sales Rep',
  manager: 'Manager',
  all: 'All roles'
}

export default function CommissionsPageWrapper() {
  const toast = useToast()
  return <CommissionsPage api={api as any} toast={toast} config={{ roleWords: ROLE_WORDS, planExample: 'Tech standard' }} />
}
