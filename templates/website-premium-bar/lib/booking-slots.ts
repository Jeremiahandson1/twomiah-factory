/**
 * Booking slot generation.
 *
 * Given a service, a date, and a set of constraints (availability rules,
 * blackouts, existing bookings, buffer times), produce the list of slots
 * that could legitimately be booked.
 *
 * This is the load-bearing correctness piece of Twomiah Bookings —
 * silent slot bugs (slots offered that conflict, or hidden when they
 * shouldn't be) are exactly the kind of thing that's hard to detect at
 * runtime but corrosive to customer trust. Unit-tested from day one.
 *
 * Time model: minutes-from-midnight in tenant timezone. We convert to
 * UTC only when persisting bookings. This keeps the algorithm
 * timezone-independent and unit-testable without DST gymnastics.
 */

export interface AvailabilityRule {
  userId: string | null  // null means "any crew"
  dayOfWeek: number      // 0=Sun..6=Sat
  startMinute: number    // minutes from midnight
  endMinute: number
  isActive: boolean
}

export interface Blackout {
  userId: string | null  // null means tenant-wide
  date: string           // YYYY-MM-DD in tenant TZ
  startMinute: number | null  // null = full-day
  endMinute: number | null
}

export interface ExistingBooking {
  assignedUserId: string | null
  startMinute: number  // computed from start_at in tenant TZ for the target date
  endMinute: number
  status: string
}

export interface ServiceConfig {
  durationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  slotGranularityMinutes: number  // typically 30
  // 1 = single-customer service. >1 = group service (a single time
  // slot can accept up to N bookings before it's full).
  capacityPerSlot?: number
  // Drive-time padding between any two confirmed bookings for the
  // same crew on the same day. Added on top of bufferBefore/After.
  driveTimeMinutes?: number
}

export interface ZoneFilter {
  customerZip?: string
  serviceZones: Array<{ userId: string; zipList: string | null }>
}

export interface SlotCandidate {
  startMinute: number
  endMinute: number  // service's end_at in tenant TZ (excludes buffer)
  // Crews who could serve this slot. Empty = no one can; we never
  // return such slots, but assignment picks one of these at booking time.
  qualifyingUserIds: Array<string | null>
}

/**
 * Compute available slots for a given date.
 *
 * @param dayOfWeek 0=Sunday..6=Saturday for the target date
 * @param service duration + buffers + slot grid
 * @param rules availability rules (use only rules whose dayOfWeek matches)
 * @param blackouts blackouts for the target date specifically
 * @param existingBookings bookings that overlap the target date,
 *                         already projected into tenant-TZ minutes
 * @param zone optional zone filter (drops crews whose service area
 *             doesn't include customer's ZIP)
 * @returns slots sorted by start time, ascending
 */
export function generateSlots(args: {
  dayOfWeek: number
  service: ServiceConfig
  rules: AvailabilityRule[]
  blackouts: Blackout[]
  existingBookings: ExistingBooking[]
  zone?: ZoneFilter
}): SlotCandidate[] {
  const { dayOfWeek, service, rules, blackouts, existingBookings, zone } = args
  const granularity = service.slotGranularityMinutes
  const totalServiceMinutes = service.durationMinutes
  const bufferBefore = service.bufferBeforeMinutes
  const bufferAfter = service.bufferAfterMinutes

  // 1. Group active rules by crew (userId). A null userId means "any crew",
  //    which we treat as a wildcard crew with id null. Each crew gets its
  //    own union of available windows for the day.
  const rulesByCrew = new Map<string | null, Array<{ start: number; end: number }>>()
  for (const r of rules) {
    if (!r.isActive) continue
    if (r.dayOfWeek !== dayOfWeek) continue
    const key = r.userId
    if (!rulesByCrew.has(key)) rulesByCrew.set(key, [])
    rulesByCrew.get(key)!.push({ start: r.startMinute, end: r.endMinute })
  }

  // 2. Subtract blackouts per crew. Tenant-wide blackouts (null userId)
  //    apply to every crew. Per-crew blackouts apply only to that crew.
  for (const b of blackouts) {
    const cutWindow = (windows: Array<{ start: number; end: number }>) => {
      const bStart = b.startMinute ?? 0
      const bEnd = b.endMinute ?? 24 * 60
      const out: Array<{ start: number; end: number }> = []
      for (const w of windows) {
        if (bEnd <= w.start || bStart >= w.end) { out.push(w); continue }
        if (bStart > w.start) out.push({ start: w.start, end: bStart })
        if (bEnd < w.end) out.push({ start: bEnd, end: w.end })
      }
      return out
    }
    if (b.userId === null) {
      for (const [key, windows] of rulesByCrew) rulesByCrew.set(key, cutWindow(windows))
    } else if (rulesByCrew.has(b.userId)) {
      rulesByCrew.set(b.userId, cutWindow(rulesByCrew.get(b.userId)!))
    }
  }

  // 3. Subtract existing bookings per crew (booking ± its own buffer).
  //    A booking assigned to one specific crew blocks only that crew. A
  //    booking with no assigned crew (legacy or admin-manual) blocks all.
  //    For group services (capacity > 1), we count concurrent bookings
  //    by start-minute and only block slots where capacity is reached.
  const capacity = service.capacityPerSlot ?? 1
  if (capacity > 1) {
    // Group service: count bookings per exact start_minute. Slot is
    // "blocked" only when N bookings already at that minute.
    const countByStart = new Map<number, number>()
    for (const bk of existingBookings) {
      if (bk.status !== 'confirmed') continue
      countByStart.set(bk.startMinute, (countByStart.get(bk.startMinute) || 0) + 1)
    }
    const fullStartMinutes = new Set(Array.from(countByStart.entries()).filter(([, c]) => c >= capacity).map(([m]) => m))
    // Subtract the duration-window of each fully-booked slot
    for (const startMin of fullStartMinutes) {
      const blockStart = startMin - bufferBefore
      const blockEnd = startMin + totalServiceMinutes + bufferAfter
      const cutWindow = (windows: Array<{ start: number; end: number }>) => {
        const out: Array<{ start: number; end: number }> = []
        for (const w of windows) {
          if (blockEnd <= w.start || blockStart >= w.end) { out.push(w); continue }
          if (blockStart > w.start) out.push({ start: w.start, end: blockStart })
          if (blockEnd < w.end) out.push({ start: blockEnd, end: w.end })
        }
        return out
      }
      for (const [key, windows] of rulesByCrew) rulesByCrew.set(key, cutWindow(windows))
    }
  } else {
    const driveTime = service.driveTimeMinutes ?? 0
    for (const bk of existingBookings) {
      if (bk.status !== 'confirmed') continue
      // Drive-time pads before+after the existing booking on top of
      // the service's own buffers (so the new slot must clear a full
      // drive-time window from any neighbor on the same crew).
      const blockStart = bk.startMinute - bufferBefore - driveTime
      const blockEnd = bk.endMinute + bufferAfter + driveTime
      const cutWindow = (windows: Array<{ start: number; end: number }>) => {
        const out: Array<{ start: number; end: number }> = []
        for (const w of windows) {
          if (blockEnd <= w.start || blockStart >= w.end) { out.push(w); continue }
          if (blockStart > w.start) out.push({ start: w.start, end: blockStart })
          if (blockEnd < w.end) out.push({ start: blockEnd, end: w.end })
        }
        return out
      }
      if (bk.assignedUserId === null) {
        for (const [key, windows] of rulesByCrew) rulesByCrew.set(key, cutWindow(windows))
      } else if (rulesByCrew.has(bk.assignedUserId)) {
        rulesByCrew.set(bk.assignedUserId, cutWindow(rulesByCrew.get(bk.assignedUserId)!))
      } else if (rulesByCrew.has(null)) {
        // Solo-operator case: availability uses the null wildcard crew, but
        // busy blocks (especially external calendar events) arrive tagged
        // with the real user's id. Without this, a solo operator's Google
        // Calendar events never blocked their bookable slots.
        rulesByCrew.set(null, cutWindow(rulesByCrew.get(null)!))
      }
    }
  }

  // 4. Zone filter: drop crews whose service area doesn't include the ZIP.
  //    Crews with no zone record at all are treated as "serves everywhere."
  const eligibleCrews = new Set<string | null>(rulesByCrew.keys())
  if (zone?.customerZip && zone.serviceZones.length > 0) {
    const zip = zone.customerZip.trim()
    const crewsWithZones = new Set(zone.serviceZones.map(z => z.userId))
    for (const crewId of eligibleCrews) {
      if (crewId === null) continue  // wildcard crew always eligible
      if (!crewsWithZones.has(crewId)) continue  // no zone = serves everywhere
      const myZones = zone.serviceZones.filter(z => z.userId === crewId)
      const zipMatches = myZones.some(z => {
        if (!z.zipList) return false
        return z.zipList.split(',').map(s => s.trim()).includes(zip)
      })
      if (!zipMatches) eligibleCrews.delete(crewId)
    }
  }

  // 5. For each eligible crew × each window, enumerate slots on the
  //    granularity grid where the full service + buffers fits.
  const slotMap = new Map<number, Set<string | null>>()
  const slotEndMap = new Map<number, number>()
  for (const [crewId, windows] of rulesByCrew) {
    if (!eligibleCrews.has(crewId)) continue
    for (const w of windows) {
      // Slot start must be >= window.start + bufferBefore so the buffer fits
      // and slot end (start + duration) must be <= window.end - bufferAfter.
      const earliestStart = w.start + bufferBefore
      const latestStart = w.end - bufferAfter - totalServiceMinutes
      const firstSlot = Math.ceil(earliestStart / granularity) * granularity
      for (let s = firstSlot; s <= latestStart; s += granularity) {
        if (!slotMap.has(s)) { slotMap.set(s, new Set()); slotEndMap.set(s, s + totalServiceMinutes) }
        slotMap.get(s)!.add(crewId)
      }
    }
  }

  // 6. Sort by start time and emit
  return Array.from(slotMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([start, crews]) => ({
      startMinute: start,
      endMinute: slotEndMap.get(start)!,
      qualifyingUserIds: Array.from(crews),
    }))
}

/**
 * Pick a crew to assign at booking time. Strategy:
 *  - Crew listed first in qualifyingUserIds wins for now (deterministic,
 *    callable from public form without N+1 lookups).
 *  - Future: round-robin within the day, or prefer the crew with the
 *    fewest bookings already on the date.
 */
export function pickCrewForSlot(qualifying: Array<string | null>): string | null {
  if (qualifying.length === 0) return null
  // Prefer a real crew over the null wildcard
  const real = qualifying.find(c => c !== null)
  return real ?? null
}
