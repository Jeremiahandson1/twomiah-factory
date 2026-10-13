// CommissionsPage — shared implementation (packages/tenant-ui/src/commissions), vendored as ../shared. Wrapper only.
import { CommissionsPage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'

// The four stored keys in this CRM's words — a landscaping business's words.
const ROLE_WORDS: Record<string, string> = {
  technician: 'Crew',
  sales_rep: 'Sales',
  manager: 'Manager',
  all: 'All roles'
}

export default function CommissionsPageWrapper() {
  const toast = useToast()
  return <CommissionsPage api={api as any} toast={toast} config={{ roleWords: ROLE_WORDS, planExample: 'Crew standard' }} />
}
