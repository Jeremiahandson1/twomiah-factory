// The landscaping CRM's behaviour suite, run against the unified app as the landscaping vertical.
//
//   bun tests/unified/harness/landscaping.ts            # everything
//   bun tests/unified/harness/landscaping.ts snow       # only files whose name contains "snow"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/landscaping',
  template: 'crm-landscaping',
  vertical: 'landscaping',
  label: 'landscaping',
  filter: process.argv[2] || '',
  // The snow-billing rules are asserted where they live: the template's route file exported them.
  routeModules: {
    'snowBilling.ts': 'server/crm/landscaping/snowBilling.ts',
    'sites.ts': 'server/crm/landscaping/sites.ts',
    'areaPricing.ts': 'server/crm/landscaping/areaPricing.ts',
  },
}))
