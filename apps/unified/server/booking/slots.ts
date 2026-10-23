// The free times on one day — pure: no database, no clock, no time zones. Everything is minutes from midnight on
// that day in the business's zone; the booking service projects the rows into that before calling, and applies the
// notice and the booking window after.
//
// The premium site's algorithm (templates/website-premium-*/lib/booking-slots.ts), with three fixes:
//   • A booking still owed a deposit ('pending') holds its time like a confirmed one: the caller passes both. The
//     site counted only 'confirmed', so a slot being paid for was offered again.
//   • A group service (capacity above 1) counts only its OWN bookings starting at that time; every other booking
//     blocks it as usual. The site's group path ignored every other booking, so a one-to-one visit at 10:00 didn't
//     stop a class at 10:00 with the same person.
//   • Travel time is a property of the business, not of each call: the site's slot list added it and its booking
//     check didn't, so the two disagreed. One input here, used by every caller.

/** Opening hours: userId null = anyone. Several windows a day are allowed. */
export interface HoursWindow { userId: string | null; dayOfWeek: number; startMinute: number; endMinute: number }
/** Already limited to the day. userId null = the whole business; both minutes null = the whole day. */
export interface DayOff { userId: string | null; startMinute: number | null; endMinute: number | null }
/**
 * Something already on someone's time that day: a booking (pending or confirmed) or an event on their own calendar.
 * userId null = not assigned to anyone, which takes the time from everybody.
 */
export interface Busy {
  userId: string | null
  startMinute: number
  endMinute: number
  /** A booking's own setup / clean-up time (its service's buffers); none for a calendar event. */
  padBefore?: number
  padAfter?: number
  serviceId?: string | null
}
export interface ServiceRules {
  id?: string
  durationMinutes: number
  bufferBeforeMinutes: number
  bufferAfterMinutes: number
  slotStepMinutes: number
  /** How many customers one time can take; 1 = one at a time. */
  capacity: number
  /** Travel between two jobs for the same person (the business's setting). */
  driveTimeMinutes: number
}
export interface Zone { userId: string; zips: string[] }
export interface Slot {
  startMinute: number
  /** The visit's end (buffers excluded). */
  endMinute: number
  /** Who could take it. null = "anyone" hours. Never empty. */
  who: Array<string | null>
}

type Window = { start: number; end: number }

/** Take [from, to) out of a set of windows. */
function cut(windows: Window[], from: number, to: number): Window[] {
  const out: Window[] = []
  for (const w of windows) {
    if (to <= w.start || from >= w.end) { out.push(w); continue }
    if (from > w.start) out.push({ start: w.start, end: from })
    if (to < w.end) out.push({ start: to, end: w.end })
  }
  return out
}

export function freeSlots(args: {
  dayOfWeek: number
  service: ServiceRules
  hours: HoursWindow[]
  daysOff: DayOff[]
  busy: Busy[]
  zones?: Zone[]
  customerZip?: string | null
}): Slot[] {
  const { dayOfWeek, service, hours, daysOff, busy } = args
  const { durationMinutes: duration, bufferBeforeMinutes: before, bufferAfterMinutes: after } = service
  const step = Math.max(1, service.slotStepMinutes)
  const capacity = Math.max(1, service.capacity)

  // 1. Each person's open windows that day (null = "anyone").
  const byWho = new Map<string | null, Window[]>()
  for (const h of hours) {
    if (h.dayOfWeek !== dayOfWeek || h.endMinute <= h.startMinute) continue
    if (!byWho.has(h.userId)) byWho.set(h.userId, [])
    byWho.get(h.userId)!.push({ start: h.startMinute, end: h.endMinute })
  }
  const takeFrom = (userId: string | null, from: number, to: number) => {
    if (userId === null) { for (const [k, w] of byWho) byWho.set(k, cut(w, from, to)); return }
    if (byWho.has(userId)) { byWho.set(userId, cut(byWho.get(userId)!, from, to)); return }
    // A business that books "anyone" while its calendars and bookings carry the owner's own id: their busy time is
    // the "anyone" time, or the owner's own calendar would never block a slot.
    if (byWho.has(null)) byWho.set(null, cut(byWho.get(null)!, from, to))
  }

  // 2. Days off.
  for (const d of daysOff) takeFrom(d.userId, d.startMinute ?? 0, d.endMinute ?? 24 * 60)

  // 3. What is already booked: each entry with ITS OWN setup and clean-up, plus travel either side; the new visit's
  //    buffers are kept clear in step 5. The site took the NEW service's buffers off both sides instead, so a long clean-up after one visit was
  //    forgotten as soon as a different service was asked about, and the new service's buffers were counted twice.
  const groupCount = new Map<number, number>()
  for (const b of busy) {
    if (capacity > 1 && service.id && b.serviceId === service.id) {
      groupCount.set(b.startMinute, (groupCount.get(b.startMinute) || 0) + 1)
      continue
    }
    takeFrom(b.userId, b.startMinute - (b.padBefore ?? 0) - service.driveTimeMinutes, b.endMinute + (b.padAfter ?? 0) + service.driveTimeMinutes)
  }
  // A full class takes its whole time, like any booking.
  for (const [start, n] of groupCount) if (n >= capacity) takeFrom(null, start - before, start + duration + after)

  // 4. Service area: someone whose zone list lacks the customer's ZIP can't take it. No zone = serves everywhere;
  //    "anyone" hours always qualify.
  const eligible = new Set(byWho.keys())
  // A zone lists five-digit ZIPs; a customer's ZIP+4 is in the zone of its first five.
  const zip = args.customerZip?.trim().slice(0, 5)
  if (zip && args.zones?.length) {
    for (const who of eligible) {
      if (who === null) continue
      const mine = args.zones.filter((z) => z.userId === who)
      if (mine.length && !mine.some((z) => z.zips.includes(zip))) eligible.delete(who)
    }
  }

  // 5. Start times on the step grid where the visit and its buffers fit inside a window.
  const slots = new Map<number, Set<string | null>>()
  for (const [who, windows] of byWho) {
    if (!eligible.has(who)) continue
    for (const w of windows) {
      const latest = w.end - after - duration
      for (let s = Math.ceil((w.start + before) / step) * step; s <= latest; s += step) {
        if (!slots.has(s)) slots.set(s, new Set())
        slots.get(s)!.add(who)
      }
    }
  }
  return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([s, who]) => ({ startMinute: s, endMinute: s + duration, who: [...who] }))
}

/** Who gets a booking made at a slot: a named person before "anyone" (the first, until assignment learns to balance). */
export function pickWho(who: Array<string | null>): string | null {
  return who.find((w) => w !== null) ?? null
}
