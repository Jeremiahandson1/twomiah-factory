// /api/skills — skill matching (parity tier 2 #6; ../../data/skills.ts): what each person can do and what each kind of job needs
// (Settings › Skills). jobs.ts warns when a job is given to people without the skills its type needs; Find a time offers only
// people who have them.
//
// Who: reading is anyone who reads jobs; changing a person's skills or a job type's needs is the seat that puts people on jobs
// (jobs:dispatch — as their hours and time off, availabilityRoutes.ts).
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../http/env.ts'
import type { CrmDeps } from '../deps.ts'
import { fail, one } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import { MAX_SKILL, MAX_SKILLS, jobTypeSkills, jobTypesInUse, peopleWithSkills, setJobTypeSkills, setPersonSkills } from '../../data/skills.ts'
import { resolvePerson, workers } from '../../data/techAvailability.ts'
import { company } from '../../db/schema/index.ts'
import { eq } from 'drizzle-orm'

const skill = z.string({ error: 'Write the skill' }).trim().min(1, 'Write the skill').max(MAX_SKILL, `A skill is at most ${MAX_SKILL} characters`)
const skillList = z.array(skill).max(MAX_SKILLS, `At most ${MAX_SKILLS} skills`)
const personSchema = z.object({ skills: skillList })
const jobTypesSchema = z.object({
  jobTypes: z.array(z.object({ jobType: z.string({ error: 'Write the kind of job' }).trim().min(1, 'Write the kind of job').max(40, 'At most 40 characters'), skills: skillList }))
    .max(200, 'At most 200 kinds of job'),
})

export function createSkillRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()

  const needs = async (companyId: string) => {
    const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    return jobTypeSkills(co?.settings)
  }

  // Everything the page shows: each person's skills, each kind of job's needs, the job types in use, and every skill named.
  app.get('/', requirePermission('jobs:read'), async (c) => {
    const companyId = c.get('user').companyId
    const [people, map, inUse] = await Promise.all([workers(db, companyId).then((w) => peopleWithSkills(db, companyId, w)), needs(companyId), jobTypesInUse(db, companyId)])
    const named = new Map<string, string>()
    for (const s of [...people.flatMap((p) => p.skills), ...Object.values(map).flat()]) if (!named.has(s.toLowerCase())) named.set(s.toLowerCase(), s)
    return one(c, {
      people,
      jobTypes: Object.entries(map).map(([jobType, skills]) => ({ jobType, skills })),
      jobTypesInUse: inUse,
      skills: [...named.values()].sort((a, b) => a.localeCompare(b)),
      maxSkills: MAX_SKILLS, maxSkill: MAX_SKILL,
    })
  })

  // Replace one person's skills.
  app.put('/people/:personId', requirePermission('jobs:dispatch'), async (c) => {
    const parsed = personSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = c.get('user').companyId
    const who = await resolvePerson(db, companyId, c.req.param('personId'))
    if (!who) return fail(c, 404, 'That person is not on your team.')
    const skills = await setPersonSkills(db, companyId, who, parsed.data.skills)
    audit.log({ action: audit.ACTIONS.UPDATE, entity: who.userId ? 'user' : 'team_member', entityId: c.req.param('personId'), metadata: { skills }, req: c })
    return one(c, { personId: c.req.param('personId'), skills })
  })

  // Replace what each kind of job needs. A kind with no skills is dropped (it needs nothing).
  app.put('/job-types', requirePermission('jobs:dispatch'), async (c) => {
    const parsed = jobTypesSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const seen = new Set<string>()
    for (const t of parsed.data.jobTypes) {
      const k = t.jobType.toLowerCase()
      if (seen.has(k)) return fail(c, 400, `"${t.jobType}" is listed twice. Put all its skills on one line.`)
      seen.add(k)
    }
    const companyId = c.get('user').companyId
    const before = await needs(companyId)
    const next = await setJobTypeSkills(db, companyId, Object.fromEntries(parsed.data.jobTypes.map((t) => [t.jobType, t.skills])))
    audit.log({ action: audit.ACTIONS.UPDATE, entity: 'company', entityId: companyId, metadata: { skillMatching: { before, after: next } }, req: c })
    return one(c, { jobTypes: Object.entries(next).map(([jobType, skills]) => ({ jobType, skills })) })
  })

  return app
}
