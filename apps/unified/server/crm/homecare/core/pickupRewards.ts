// Points and rewards for caregivers (row 18, care_pickup_rewards). The agency says what earns points — an extra shift picked up from the
// open-shift board, a clock-in on time, a week at or over a minimum number of hours — and sets the rewards points can be spent on. A caregiver
// asks for a reward from the phone; the office hands it over (or declines, and the points come back).
//
// The rules are pure and tested alone. Points are earned from the pay run's own source — the payroll shift reviews payroll pays — so a
// visit that is not paid earns nothing, and every point is written once (the ledger's reference is unique), so reading a balance twice, or the
// pay run being recalculated, never pays twice. Nothing is back-dated: only days from the day the agency first saved the scheme earn points.
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import {
  addPoints, dayMinutes, pickupsInRange, punchLateness, pointBalance, pointHistory, pointBoard, listItems, itemById, insertItem, updateItem,
  redeem as redeemPoints, listRedemptions, redemptionById, settleRedemption, openRedemptionCount, caregiverInCompany,
} from '../../../data/homecareRewards.ts'
import type { CrmDeps } from '../../deps.ts'
import { workweekStartOn, companyWorkWeek } from '../../payrollExport/workWeek.ts'
import { addDays, type AgencyTime } from './agencyTime.ts'
import { ON_TIME_GRACE_MINUTES } from './punchRules.ts'
import { PAYABLE_REVIEW_STATUSES } from './payrollPay.ts'

export const REWARDS_FEATURE = 'care_pickup_rewards'
/** How far back one reading looks for points not yet written (the scheme's start day still bounds it). */
export const LOOKBACK_DAYS = 60

export interface RewardRules {
  enabled: boolean
  /** The day the scheme was first saved (company calendar): no earlier day earns points. */
  startedOn: string | null
  pointsPerExtraShift: number
  pointsPerOnTime: number
  /** A week at or over this many hours earns pointsForMinHours; 0 = off. */
  minHoursPerWeek: number
  pointsForMinHours: number
}
export const DEFAULT_RULES: RewardRules = { enabled: false, startedOn: null, pointsPerExtraShift: 10, pointsPerOnTime: 1, minHoursPerWeek: 0, pointsForMinHours: 10 }

/** What every screen calls each ledger row — never the stored code. */
export const KIND_LABELS: Record<string, string> = {
  extra_shift: 'Extra shift picked up', on_time: 'Clocked in on time', min_hours: 'Weekly minimum hours met',
  adjustment: 'Adjusted by the office', redeemed: 'Reward requested', refund: 'Reward not given — points returned',
}
export const kindLabel = (k: string) => KIND_LABELS[k] ?? 'Points'
export const STATUS_LABELS: Record<string, string> = { requested: 'Waiting for the office', fulfilled: 'Given', declined: 'Not given — points returned' }

const whole = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

/** The rules an agency saved, checked: each count a whole number in range. A bad value is named in words. */
export function sanitizeRules(raw: any, prev: RewardRules = DEFAULT_RULES): { rules: RewardRules } | { problem: string } {
  const b = raw && typeof raw === 'object' ? raw : {}
  const pick = (key: keyof RewardRules, label: string, lo: number, hi: number): number | { problem: string } => {
    if (b[key] === undefined) return prev[key] as number
    const n = whole(b[key], lo, hi)
    return n === null ? { problem: `${label} must be a whole number from ${lo} to ${hi}.` } : n
  }
  const extra = pick('pointsPerExtraShift', 'Points for an extra shift', 0, 1000); if (typeof extra !== 'number') return extra
  const onTime = pick('pointsPerOnTime', 'Points for an on-time clock-in', 0, 1000); if (typeof onTime !== 'number') return onTime
  const minH = pick('minHoursPerWeek', 'The weekly minimum hours', 0, 80); if (typeof minH !== 'number') return minH
  const minP = pick('pointsForMinHours', 'Points for meeting the weekly minimum', 0, 1000); if (typeof minP !== 'number') return minP
  return { rules: { enabled: b.enabled === undefined ? prev.enabled : b.enabled === true, startedOn: prev.startedOn, pointsPerExtraShift: extra, pointsPerOnTime: onTime, minHoursPerWeek: minH, pointsForMinHours: minP } }
}

/** On time: clocked in no more than the punch rules' grace after the scheduled start (early is fine). */
export const isOnTime = (lateMinutes: number) => lateMinutes <= ON_TIME_GRACE_MINUTES

/**
 * The work weeks, wholly before `today`, in which a caregiver's payable minutes reach the minimum. `days` are payable minutes per day.
 * Returns each such week's first day. A week not yet over is never counted (it could still fall short).
 */
export function weeksMeetingMinimum(days: { shiftDate: string; minutes: number }[], startDay: number, minHours: number, today: string): string[] {
  if (minHours <= 0) return []
  const byWeek = new Map<string, number>()
  for (const dm of days) { const w = workweekStartOn(dm.shiftDate, startDay); byWeek.set(w, (byWeek.get(w) ?? 0) + dm.minutes) }
  return [...byWeek.entries()].filter(([w, mins]) => addDays(w, 6) < today && mins >= minHours * 60).map(([w]) => w).sort()
}

export function createPickupRewards(d: CrmDeps, deps: { time: AgencyTime }) {
  const enabled = (companyId: string) => d.features.isFeatureEnabled(companyId, REWARDS_FEATURE)

  async function settingsOf(companyId: string): Promise<any> {
    const [row] = await d.db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return (row?.settings as any) ?? {}
  }
  async function rules(companyId: string): Promise<RewardRules> {
    const stored = (await settingsOf(companyId)).rewards
    const merged = sanitizeRules(stored, DEFAULT_RULES)
    return 'rules' in merged ? { ...merged.rules, startedOn: typeof stored?.startedOn === 'string' ? stored.startedOn : null } : DEFAULT_RULES
  }
  /** Save the rules. The first time they are saved switched on, today becomes the start day. */
  async function saveRules(companyId: string, input: any): Promise<{ rules: RewardRules } | { problem: string }> {
    const prev = await rules(companyId)
    const next = sanitizeRules(input, prev)
    if ('problem' in next) return next
    const r = next.rules
    if (r.enabled && !r.startedOn) r.startedOn = await deps.time.today(companyId)
    const s = await settingsOf(companyId)
    await d.db.update(company).set({ settings: { ...s, rewards: r } }).where(eq(company.id, companyId))
    return { rules: r }
  }

  /**
   * Write the points not yet written, for one caregiver or everyone, from the last LOOKBACK_DAYS (never before the scheme's start day):
   * an extra shift when the visit it was posted for has been paid for; an on-time clock-in per paid visit; a weekly minimum per finished week.
   * Safe to run any number of times. Returns the points newly written.
   */
  async function sweep(companyId: string, caregiverId: string | null = null): Promise<number> {
    if (!(await enabled(companyId))) return 0
    const r = await rules(companyId)
    if (!r.enabled || !r.startedOn) return 0
    const today = await deps.time.today(companyId)
    const from = addDays(today, -LOOKBACK_DAYS) > r.startedOn ? addDays(today, -LOOKBACK_DAYS) : r.startedOn
    let written = 0
    if (r.pointsPerExtraShift > 0) {
      for (const p of (await pickupsInRange(d.db, companyId, from, today, caregiverId, PAYABLE_REVIEW_STATUSES)).filter((x) => x.reviewId)) {
        if (await addPoints(d.db, companyId, p.caregiverId, 'extra_shift', r.pointsPerExtraShift, p.openShiftId)) written += r.pointsPerExtraShift
      }
    }
    if (r.pointsPerOnTime > 0) {
      for (const v of (await punchLateness(d.db, companyId, from, today, caregiverId, PAYABLE_REVIEW_STATUSES)).filter((x) => isOnTime(x.lateMinutes))) {
        if (await addPoints(d.db, companyId, v.caregiverId, 'on_time', r.pointsPerOnTime, v.id)) written += r.pointsPerOnTime
      }
    }
    if (r.minHoursPerWeek > 0 && r.pointsForMinHours > 0) {
      const { startDay } = await companyWorkWeek(d.db, companyId)
      // Whole weeks only: read from the start of the week holding `from`, so the first week is not short its early days.
      const rows = await dayMinutes(d.db, companyId, workweekStartOn(from, startDay), today, caregiverId, PAYABLE_REVIEW_STATUSES)
      const people = [...new Set(rows.map((x) => x.caregiverId))]
      for (const id of people) {
        for (const w of weeksMeetingMinimum(rows.filter((x) => x.caregiverId === id), startDay, r.minHoursPerWeek, today).filter((w) => w >= from)) {
          if (await addPoints(d.db, companyId, id, 'min_hours', r.pointsForMinHours, w)) written += r.pointsForMinHours
        }
      }
    }
    return written
  }

  /** A caregiver's own page: balance, history, the rewards they can ask for, their requests. Brings their points up to date first. */
  async function mine(companyId: string, caregiverId: string) {
    await sweep(companyId, caregiverId)
    const r = await rules(companyId)
    const [balance, history, items, requests] = await Promise.all([
      pointBalance(d.db, companyId, caregiverId), pointHistory(d.db, companyId, caregiverId, 50), listItems(d.db, companyId, true),
      listRedemptions(d.db, companyId, { caregiverId, limit: 30 }),
    ])
    return {
      balance, rules: r,
      history: history.map((h: any) => ({ ...h, label: kindLabel(h.kind) })),
      rewards: items.map((i: any) => ({ ...i, canAfford: balance >= i.costPoints })),
      requests: requests.map((x: any) => ({ ...x, statusLabel: STATUS_LABELS[x.status] ?? x.status })),
    }
  }

  async function ask(companyId: string, caregiverId: string, rewardId: string): Promise<{ request: any } | { problem: string; status: 400 | 404 | 409 }> {
    const item = await itemById(d.db, companyId, rewardId)
    if (!item || !item.isActive) return { problem: 'That reward is not available.', status: 404 }
    await sweep(companyId, caregiverId)
    const made = await redeemPoints(d.db, companyId, caregiverId, { id: item.id, name: item.name, costPoints: item.costPoints })
    if (!made) return { problem: `You need ${item.costPoints} points for this reward — you have ${await pointBalance(d.db, companyId, caregiverId)}.`, status: 409 }
    return { request: { ...made, statusLabel: STATUS_LABELS[made.status] } }
  }

  /** The office hands a reward over or declines it (the points go back). A request is settled once. */
  async function settle(companyId: string, id: string, status: 'fulfilled' | 'declined', by: string, note: string | null) {
    const done = await settleRedemption(d.db, companyId, id, status, by, note)
    if (!done) return null
    if (status === 'declined') await addPoints(d.db, companyId, done.caregiverId, 'refund', done.points, id, done.name)
    return done
  }

  /** The office adds or removes points by hand (a non-zero whole number, with a reason). */
  async function adjust(companyId: string, caregiverId: string, points: number, note: string, by: string): Promise<{ ok: true } | { problem: string; status: 400 | 404 }> {
    if (!Number.isInteger(points) || points === 0 || Math.abs(points) > 10000) return { problem: 'Enter a whole number of points, not zero (up to 10,000).', status: 400 }
    if (!note.trim()) return { problem: 'Say why — the caregiver sees this on their points page.', status: 400 }
    if (!(await caregiverInCompany(d.db, companyId, caregiverId))) return { problem: 'Caregiver not found', status: 404 }
    await addPoints(d.db, companyId, caregiverId, 'adjustment', points, `${by}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, note.trim().slice(0, 200))
    return { ok: true }
  }

  return {
    enabled, rules, saveRules, sweep, mine, ask, settle, adjust,
    board: async (companyId: string) => { await sweep(companyId); return pointBoard(d.db, companyId) },
    items: (companyId: string) => listItems(d.db, companyId, false),
    addItem: (companyId: string, f: { name: string; description: string | null; costPoints: number }) => insertItem(d.db, companyId, f),
    saveItem: (companyId: string, id: string, f: { name: string; description: string | null; costPoints: number; isActive: boolean }) => updateItem(d.db, companyId, id, f),
    requests: async (companyId: string, status?: string) => (await listRedemptions(d.db, companyId, { status, limit: 200 })).map((x: any) => ({ ...x, statusLabel: STATUS_LABELS[x.status] ?? x.status })),
    request: (companyId: string, id: string) => redemptionById(d.db, companyId, id),
    waiting: (companyId: string) => openRedemptionCount(d.db, companyId),
  }
}
export type PickupRewards = ReturnType<typeof createPickupRewards>
