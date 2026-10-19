// The bar CRM's behaviour suite, run against the unified app as the bar vertical.
//
//   bun tests/unified/harness/bar.ts            # everything
//   bun tests/unified/harness/bar.ts register   # only files whose name contains "register"
import { fileURLToPath } from 'node:url'
import { runUnifiedSuite } from './runUnifiedSuite.ts'

// fileURLToPath, not .pathname: a space in the checkout's path arrives as %20 otherwise.
const ROOT = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\\/g, '/')

// The bar's services the tests import by the template's paths (server/crm/bar). The arithmetic files are the same
// modules; the ones that read the database are made once, with the app's own dependencies (crmDeps), and each test
// file's import gets the template's function names from them.
const pure = (file: string) => `export * from '@app/server/crm/bar/${file}.ts'\n`
const bound = (file: string, key: string, names: string[]) => `
export * from '@app/server/crm/bar/${file}.ts'
import { bar } from './barServices.ts'
export const { ${names.join(', ')} } = bar.${key}
`
process.exit(await runUnifiedSuite({
  root: ROOT,
  suiteDir: ROOT + 'tests/bar',
  template: 'crm-bar',
  vertical: 'bar',
  label: 'bar',
  filter: process.argv[2] || '',
  sandboxFiles: {
    'src/services/barServices.ts': `
import { crmDeps } from './crmDeps.ts'
import { createBarServices } from '@app/server/crm/bar/services.ts'
export const bar = createBarServices(crmDeps)
`,
    'src/services/barHours.ts': pure('barHours'),
    'src/services/barMenuSizes.ts': pure('barMenuSizes'),
    'src/services/barTapSizes.ts': pure('barTapSizes'),
    'src/services/barPacing.ts': pure('barPacing'),
    'src/services/barCosting.ts': pure('barCosting'),
    'src/services/barSchedulePlan.ts': pure('barSchedulePlan'),
    'src/services/barCheckMoney.ts': pure('barCheckMoney'),
    'src/services/barFloor.ts': bound('barFloor', 'floor', ['floorFor', 'floorIsStarter', 'saveFloor']),
    'src/services/barLive.ts': bound('barLive', 'live', ['hoursFor', 'buildLiveState']),
    'src/services/barGiftCards.ts': bound('barGiftCards', 'giftCards', ['cardPrefix', 'issueCard', 'findCard', 'spend', 'refundTo', 'cardHistory', 'adjustCard', 'voidCard', 'listCards']),
    'src/services/barLoyalty.ts': bound('barLoyalty', 'loyalty', ['configFor', 'loyaltyRunning', 'memberFor', 'ensureMember', 'searchGuests', 'addRegular', 'earnForPaidCheck', 'adjustPoints', 'listMembers', 'memberHistory', 'rewardInput', 'listRewards']),
    'src/services/barReports.ts': bound('barReports', 'reports', ['loadRange', 'barTimezone', 'loadDay', 'closeDay', 'closeoutsFor']),
  },
}))
