// RecurringList — shared implementation (packages/tenant-ui/src/recurring), vendored as ../../shared. Wrapper only.
import { RecurringList } from '../../shared'
import api from '../../services/api'

export default function RecurringListWrapper() {
  return <RecurringList api={api as any} />
}
