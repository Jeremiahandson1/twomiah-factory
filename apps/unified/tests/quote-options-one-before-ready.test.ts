// Good / better / best was built twice in parallel (field service PR #169 `quote_options`, roofing PR #170 `quote_proposals`) and
// merged side by side on 10/30. Neither may be switched on until they are one (docs/parity/quote-options-unify.md): this fails if
// either is un-hidden while both exist. Delete it in the commit that makes them one.
import { test, expect } from 'bun:test'
import { FEATURE_MAP } from '@twomiah/tenant-backend'

test('both good / better / best features stay not ready until they are one implementation', () => {
  const both = ['quote_options', 'quote_proposals'].filter((id) => FEATURE_MAP[id])
  if (both.length < 2) return // made one: this test should be deleted with that change
  for (const id of both) expect([id, FEATURE_MAP[id].hidden]).toEqual([id, true])
})
