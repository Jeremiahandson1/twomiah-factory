// Skills and zones on the Schedule's person lanes (live test 11/11: a job moved on Schedule › By person said nothing about who
// fits it, and there was no zone picker — both were on the Dispatch Board only). ServiceTitan shows the recommended technicians
// wherever a job is assigned. The rules (tenant-ui schedule/dispatchRules.ts, shown by dispatchFit.tsx), and the Schedule wired to them behind the switches.
import { test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fitFrom, neededFor, missingFor, zoneOf, inZone, type FitZone } from '../../../packages/tenant-ui/src/schedule/dispatchRules.ts'

const src = (p: string) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')
const fit = fitFrom({ people: [{ personId: 'tia', skills: ['Gas'] }, { personId: 'gus', skills: ['gas', ' Install '] }], jobTypes: [{ jobType: 'Furnace  install', skills: ['Gas', 'Install'] }] })
const zones: FitZone[] = [{ id: 'e', name: 'East', zips: ['53714'], color: '#0ea5e9', techIds: ['tia'] }]

test("what a job's kind needs, and who lacks what — case and spacing aside", () => {
  const needed = neededFor(fit, { jobType: 'furnace install' })
  expect(needed).toEqual(['Gas', 'Install'])
  expect(missingFor(fit, 'tia', needed)).toEqual(['Install'])
  expect(missingFor(fit, 'gus', needed)).toEqual([])
  expect(missingFor(fit, 'nobody', needed)).toEqual(['Gas', 'Install'])
  expect(neededFor(fit, { jobType: 'Tune-up' })).toEqual([])
  expect(neededFor(null, { jobType: 'Furnace install' })).toEqual([])
})

test('a job is in a zone by its ZIP (ZIP+4 too); the picker shows one zone, no zone, or every job', () => {
  expect(zoneOf(zones, { zip: '53714-1234' })?.name).toBe('East')
  expect(zoneOf(zones, { zip: '54703' })).toBeNull()
  expect([inZone(zones, '', { zip: '54703' }), inZone(zones, 'e', { zip: '53714' }), inZone(zones, 'e', { zip: '54703' }), inZone(zones, 'none', { zip: '54703' }), inZone(zones, 'none', { zip: '53714' })]).toEqual([true, true, false, true, false])
})

test('the Schedule uses them: the switches from the field service mount, the picker, the ranking and each lane', () => {
  const page = src('packages/tenant-ui/src/schedule/SchedulePage.tsx')
  expect(page).toContain("useDispatchFit(api, { skills: cfg.lanes && cfg.skills, zones: cfg.zones })")
  expect(page).toContain('allJobs.filter(fit.inZoneShown)')
  expect(page).toContain('<ZonePicker fit={fit} />')
  expect(page).toContain('<SkillRanking fit={fit} job={fitJob}')
  expect(page.match(/<LaneSkill fit=\{fit\} job=\{fitJob\} personId=\{l\.id\} \/>/g)?.length).toBe(2)
  expect(src('apps/unified/web/src/crm/screens.tsx')).toContain("skills: hasFeature('skill_matching'), zones: hasFeature('service_zones')")
})
