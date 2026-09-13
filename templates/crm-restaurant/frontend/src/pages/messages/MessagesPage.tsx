// MessagesPage — shared implementation (packages/tenant-ui/src/marketing), vendored into this tenant as ../shared. Wrapper only.
import { MessagesPage } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { messagesConfig } from '../../marketingConfig'

export default function MessagesPageWrapper() {
  const toast = useToast()
  return <MessagesPage api={api as any} toast={toast} config={messagesConfig} />
}
