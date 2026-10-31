// Run the lender adapter against Wisetack's SANDBOX with keys you hold (server/crm/financing/sandbox.ts says which):
//   WISETACK_SANDBOX_URL=… WISETACK_SANDBOX_KEY=… WISETACK_SANDBOX_MERCHANT_ID=… WISETACK_SANDBOX_CONFIRM=sandbox bun apps/unified/scripts/financing-sandbox.ts
// Without the keys it prints what is missing and calls nothing. Exit 1 when a check fails.
import { formatReport, runSandbox } from '../server/crm/financing/sandbox.ts'

const report = await runSandbox(process.env)
console.log(formatReport(report))
process.exit(report.ran && report.checks.some((c) => !c.ok) ? 1 : 0)
