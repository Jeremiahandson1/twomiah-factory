// A fieldservice shop in California with a 47-hour week, for the pay run screens.
export async function seed(t: any, s: any) {
  await t.client.query("UPDATE company SET enabled_features = $1, state = 'CA', timezone = 'America/Los_Angeles' WHERE id = $2", [JSON.stringify(['time_tracking', 'payroll']), s.company.id])
  const hash = await Bun.password.hash('Seat-pass-1', 'bcrypt')
  const people: Record<string, any> = {}
  for (const [key, first, last] of [['tech', 'Ann', 'Tech'], ['helper', 'Hal', 'Helper']]) {
    const [u] = await t.db.insert(t.schema.user).values({ email: `${key}@shop.example`, passwordHash: hash, firstName: first, lastName: last, role: 'field', companyId: s.company.id }).returning()
    people[key] = u
  }
  const day = (offset: number, hour = 17) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); d.setUTCHours(hour, 0, 0, 0); return d }
  // The current period is the last 14 days; put Ann's 47 hours in one Sunday–Saturday week inside it (last week).
  const now = new Date(); const dow = now.getUTCDay()
  const lastSunday = -dow - 7
  const entry = (uid: string, offset: number, hours: number, rate = 30) => t.db.insert(t.schema.timeEntry).values({ companyId: s.company.id, userId: uid, date: day(offset), hours: String(hours), hourlyRate: String(rate) } as any)
  for (let i = 1; i <= 5; i++) await entry(people.tech.id, lastSunday + i, 9)
  await entry(people.tech.id, lastSunday + 6, 2)
  await entry(people.helper.id, lastSunday + 2, 7.5, 22)
  await entry(people.helper.id, lastSunday + 3, 8, 22)
}
