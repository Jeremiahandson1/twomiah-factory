// The base CRM behaviour suite — the first one this template has ever had.
//
// crm is the fallback template (industryRouting returns it for every named trade) and the one the
// other recurring-job verticals were cloned from, so a defect here is a defect everywhere. It had 280
// routes across 79 mounts and zero tests; this session found a 500 in its payroll module that had
// been there since the file was written, because nothing ever called it.
//
// Same runner as every other suite (tests/harness/runSuite.ts) — only the template differs.
//
//   bun tests/crm/harness/run.ts            # everything
//   bun tests/crm/harness/run.ts contract   # only files whose name contains "contract"
import { runSuite } from '../../harness/runSuite.ts'

const ROOT = new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
process.exit(await runSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/crm',
  template: 'crm',
  label: 'crm',
  filter: process.argv[2] || '',
}))
