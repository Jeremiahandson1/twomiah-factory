// ForgotPasswordPage — shared implementation in packages/tenant-ui/src/auth, vendored as ../shared.
import api from '../services/api';
import { ForgotPasswordPage as SharedForgotPasswordPage } from '../shared';

export default function ForgotPasswordPage() {
  return <SharedForgotPasswordPage api={api as any} />;
}
