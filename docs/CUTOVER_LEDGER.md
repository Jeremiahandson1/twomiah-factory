# Cutover ledger

Everything the unified app moved out of existing code instead of importing it, and
what must happen to the original at cutover, so no second copy survives
(RULEBOOK §10). Also the shared-code fixes the fence holds back until then.

## Moved; delete the original at cutover

| Unified app | Original | Notes |
|---|---|---|
| `apps/unified/server/core/brandColour.ts` (`ensureDark`, `colourOnWhite`) | `apps/api/src/services/generator.ts` `hexToRgb`, `relLuminance`, `rgbToHex`, `ensureDark` and the `primaryOnWhite` computation | Same numbers. The generator still needs them for the CRM templates until those retire. |
| `apps/unified/server/core/logger.ts` | `templates/crm*/backend/src/services/logger.ts` | |
| `apps/unified/server/core/audit.ts` (recording half) | `templates/crm*/backend/src/services/audit.ts` `log`, `diff`, `ACTIONS`, `ENTITIES`, `requestScope` | Taken from the eight identical newer copies. The read half (query, history, filter options) moves with the audit screen, through `server/data/`. |
| `apps/unified/server/core/email.ts` (machinery + password reset) | `templates/crm*/backend/src/services/email.ts` provider, transport, `send`, `sendRaw`, `inlineButtonColours`, `passwordReset` | Brand values read from the company row instead of build-time placeholders. Each module's messages move in with that module. |
| `apps/unified/server/http/errors.ts` | `templates/crm*/backend/src/utils/errors.ts` | The version naming every invalid field. |
| `apps/unified/server/http/guards.ts` | the CSP, paging guard and rate limiter in `templates/crm*/backend/src/index.ts` | The newer rate limiter (limit and retry headers). |
| `apps/unified/server/db/schema/core.ts` | `company`, `user`, `audit_log`, `mfa_devices`, `mfa_challenges` in `templates/crm/backend/db/schema.ts` | Column for column; only `primary_color`'s default differs (was a build placeholder). |

## Held by the fence; fix when the code moves in

- **205 type errors in `packages/tenant-backend`** (never type-checked; the
  templates vendor it as source). `scripts/check-unified-types.ts` holds the count
  at 205 and fails if it rises. The largest: `inventory/inventory.ts` (47),
  `warranties/warranties.ts` (29), `contacts/contacts.ts` (15),
  `invoicing/invoices.ts` (13).
- **Shared modules that reply outside the rulebook's shapes.** The shared package's
  errors are all `{ error }` already. 22 of its replies send a bare list
  (`c.json(rows)` and the like) instead of `{ data, pagination }`. Each is conformed
  when its module is mounted in the unified app, together with the screen that reads
  it.
