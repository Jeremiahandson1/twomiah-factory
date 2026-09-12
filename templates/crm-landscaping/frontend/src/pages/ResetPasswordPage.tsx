// ResetPasswordPage — shared implementation in packages/tenant-ui/src/auth, vendored as ../shared.
import api from '../services/api';
import { ResetPasswordPage as SharedResetPasswordPage } from '../shared';

export default function ResetPasswordPage() {
  return <SharedResetPasswordPage api={api as any} />;
}
