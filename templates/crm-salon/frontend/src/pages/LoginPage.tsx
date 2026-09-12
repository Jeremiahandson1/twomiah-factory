// LoginPage — shared implementation in packages/tenant-ui/src/auth, vendored as ../shared.
import { LoginPage as SharedLoginPage } from '../shared';

export default function LoginPage() {
  return <SharedLoginPage companyName={"{{COMPANY_NAME}}"} />;
}
