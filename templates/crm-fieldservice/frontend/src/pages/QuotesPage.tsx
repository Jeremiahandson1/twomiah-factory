// QuotesPage — shared implementation in packages/tenant-ui/src/invoicing, vendored as ../shared.
// This wrapper only hands the shared page this template's api client, toast, company settings and vertical config.
//
// No `can` is threaded in, deliberately: the shared page asks the permissions context itself with
// useMayWrite, which is the mechanism InvoiceDetailPage already uses and documents — "`can` is
// declared optional on InvoicingConfig and NO vertical has ever set it, so every `cfg.can ? … : true`
// on this page is a gate that cannot close". A prop no page reads is the next dead hook. (T41)
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { QuotesPage as SharedQuotesPage } from '../shared';
import { INVOICING } from '../invoicingConfig';

export default function QuotesPage() {
  const toast = useToast();
  const { company } = useAuth();
  return <SharedQuotesPage api={api as any} toast={toast} settings={(company as any)?.settings} config={INVOICING} />;
}
