// RecurringForm — shared implementation (packages/tenant-ui/src/recurring), vendored as ../../shared. Wrapper only.
import { RecurringForm } from '../../shared'
import api from '../../services/api'

export default function RecurringFormWrapper() {
  return <RecurringForm api={api as any} />
}
