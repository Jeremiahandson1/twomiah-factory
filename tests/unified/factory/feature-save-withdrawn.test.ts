// A feature offered to no industry any more is dropped by the Factory's feature save, so a business that still had it on
// its Factory row is not told "Last sync FAILED — divergent feature list" for ever (Higgs, 2026-11-13).
import { test, expect } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { FEATURE_REGISTRY } from '../../../apps/api/src/config/featureRegistry'
import { featureSyncVerdict } from '../../../apps/api/src/services/featureSyncVerdict'

const ROOT = path.resolve(import.meta.dir, '..', '..', '..')

test('the five features Higgs still carried are offered to no industry', () => {
  for (const id of ['route_optimization', 'service_dispatch', 'referral_program', 'custom_dashboards', 'map_view']) {
    expect(FEATURE_REGISTRY.find((d) => d.id === id)?.templates).toEqual([])
  }
})

test('sent with a withdrawn feature the save reads as divergent; without it, in sync', () => {
  const stored = ['contacts', 'measurement_reports']
  expect(featureSyncVerdict([...stored, 'map_view'], 200, { features: stored }).synced).toBe(false)
  expect(featureSyncVerdict(stored, 200, { features: stored }).synced).toBe(true)
})

test('the feature save drops withdrawn features before it stores and sends the list, and says which', () => {
  const admin = fs.readFileSync(path.join(ROOT, 'apps/api/src/routes/factory/admin.ts'), 'utf8')
  const save = admin.slice(admin.indexOf("factory.patch('/customers/:id/features'"), admin.indexOf("factory.get('/admin/db-health'"))
  expect(save).toMatch(/const withdrawn = features\.filter\(\(f: any\) => typeof f === 'string' && FEATURE_REGISTRY\.find\(\(d\) => d\.id === f\)\?\.templates\.length === 0\)/)
  expect(save).toMatch(/!notReady\.includes\(f\) && !withdrawn\.includes\(f\)/)
  expect(save.indexOf('const withdrawn')).toBeLessThan(save.indexOf(".update({ features: newFeatures })"))
  expect(save).toMatch(/withdrawn\.length \? \{ withdrawn \} : \{\}/)
})
