// MarketingPage — shared implementation (packages/tenant-ui/src/marketing), vendored into this tenant as ../shared. Wrapper only.
import { MarketingPage } from '../../shared'
import api from '../../services/api'
import { useToast } from '../../contexts/ToastContext'
import { marketingConfig } from '../../marketingConfig'
import { useAuth } from '../../contexts/AuthContext'

export default function MarketingPageWrapper() {
  const toast = useToast()
  const { hasFeature } = useAuth()
  // with Email Marketing off (Follow-Up only), campaigns and templates are not shown — the API refuses them too
  return <MarketingPage api={api as any} toast={toast} config={marketingConfig} showCampaigns={hasFeature('email_marketing')} />
}
