// SchedulePage — shared implementation in packages/tenant-ui/src/schedule, vendored as ../shared.
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { SchedulePage as SharedSchedulePage } from '../shared';

export default function SchedulePage() {
  const toast = useToast();
  return <SharedSchedulePage api={api as any} toast={toast} config={{ events: true }} />;
}
