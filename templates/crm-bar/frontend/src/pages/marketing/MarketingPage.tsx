// MarketingPage — shared implementation (packages/tenant-ui/src/marketing), vendored into this tenant as ../shared. Wrapper only.
import { MarketingPage } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { marketingConfig } from '../../marketingConfig'

export default function MarketingPageWrapper() {
  const toast = useToast()
  return <MarketingPage api={api as any} toast={toast} config={marketingConfig} />
}
