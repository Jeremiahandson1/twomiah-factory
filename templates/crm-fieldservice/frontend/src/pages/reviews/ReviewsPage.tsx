// ReviewsPage — shared implementation (packages/tenant-ui/src), vendored into this tenant as ../shared. Wrapper only.
import { ReviewsPage } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { reviewsConfig } from '../../integrationsConfig'

export default function ReviewsPageWrapper() {
  const toast = useToast()
  return <ReviewsPage api={api as any} toast={toast} config={reviewsConfig} />
}
