// BookingsPage — shared implementation in packages/tenant-ui/src/booking, vendored as ../../shared.
// This wrapper only hands the shared page this template's api client, toast and vertical config.
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { BookingsPage as SharedBookingsPage } from '../../shared';
import { BOOKING } from '../../bookingConfig';

export default function BookingsPage() {
  const toast = useToast();
  return <SharedBookingsPage api={api as any} toast={toast} config={BOOKING} />;
}
