// TasksPage — shared implementation (packages/tenant-ui/src/tasks), vendored into this tenant as ../../shared. Wrapper only.
import { TasksPage } from '../../shared'
import api from '../../services/api'

export default function TasksPageWrapper() {
  return <TasksPage api={api as any} />
}
