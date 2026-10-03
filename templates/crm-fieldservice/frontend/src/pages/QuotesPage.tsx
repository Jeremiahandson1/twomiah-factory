// QuotesPage — shared implementation in packages/tenant-ui/src/invoicing, vendored as ../shared.
// This wrapper only hands the shared page this template's api client, toast, company settings and vertical config.
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { QuotesPage as SharedQuotesPage } from '../shared';
import { INVOICING } from '../invoicingConfig';

export default function QuotesPage() {
  const toast = useToast();
  const { company } = useAuth();
  /**
   * `can` is threaded in so the shared page can ask what this person may do. (T41)
   *
   * InvoicingConfig has documented a `can` hook for a while — "threaded in from the template's own
   * auth context, the way hasFeature is" — and NO template was passing it, so it was always
   * undefined and every control it guards defaulted to shown. That was harmless while nothing
   * sensitive hung off it; it stopped being harmless when the quote editor gained a cost column,
   * because what the company PAYS is not a figure for whoever can raise a quote. The pricebook API
   * already withholds cost from a caller without pricebook:update; this makes the screen ask the
   * same question instead of relying on the field arriving empty.
   */
  const { can } = usePermissions();
  return (
    <SharedQuotesPage
      api={api as any}
      toast={toast}
      settings={(company as any)?.settings}
      config={{ ...INVOICING, can }}
    />
  );
}
