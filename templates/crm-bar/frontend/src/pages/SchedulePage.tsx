// SchedulePage — shared implementation in packages/tenant-ui/src/schedule, vendored as ../shared.
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { SchedulePage as SharedSchedulePage } from '../shared';

export default function SchedulePage() {
  const toast = useToast();
  // Drag & Drop Calendar is a paid feature (drag_drop_calendar), and nothing was consulting the flag:
  // resolveScheduleConfig defaults dragDrop to `cfg.dragDrop !== false` and no template passed it, so a
  // tenant without the feature was still handed 36 draggable jobs and the "Drag a job to another
  // day" instruction. (Field Service T26 M5)
  //
  // Off-until-known is the safe direction HERE, unlike a route gate: hasFeature() answers false until
  // /api/auth/me lands, and the cost of that moment is a job you cannot drag yet, not a redirect away from
  // a page you own. Only the three templates the registry actually offers this to consult the flag — the
  // other SchedulePage consumers (salon, restaurant, RV) are not sold it and keep the default.
  const { hasFeature } = useAuth();
  return <SharedSchedulePage api={api as any} toast={toast} config={{ jobLabel: 'Job', dragDrop: hasFeature('drag_drop_calendar') }} />;
}
