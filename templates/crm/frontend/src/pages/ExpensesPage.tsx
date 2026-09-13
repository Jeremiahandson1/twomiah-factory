// ExpensesPage — shared implementation (packages/tenant-ui/src/people), vendored into this tenant as ../shared. Wrapper only.
import { ExpensesPage } from '../shared'
import api from '../services/api'
import { useToast } from '../contexts/ToastContext'
import { expensesConfig } from '../peopleConfig'

export default function ExpensesPageWrapper() {
  const toast = useToast()
  return <ExpensesPage api={api as any} toast={toast} config={expensesConfig} />
}
