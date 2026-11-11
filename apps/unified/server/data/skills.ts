// SKILL MATCHING (parity tier 2 #6, 11/10 — ServiceTitan's technician skills and job types that need them; feature skill_matching,
// not ready). Two halves, both the business's own words:
//   · what a PERSON can do — a login's skills (user.skills, 0109) or a roster member's (team_member.skills, kept since the
//     templates and used by nothing until now);
//   · what a KIND OF JOB needs — company settings `skillMatching.jobTypes`: { "Furnace install": ["Gas", "Install"] }, keyed by the
//     job's own type (job.job_type, the same words its checklists attach by).
// Limits match the team roster's own (tenant-backend team/team.ts: 50 of 60 characters). Skills are matched without regard to case or spaces round them. The people on a job TOGETHER must cover what its type needs (a
// crew shares the work); the check is a warning the office may book past, as a day off is (techAvailability.checkAvailability).
import { and, desc, eq, inArray } from 'drizzle-orm'
import { company, job, teamMember, user } from '../db/schema/index.ts'
import type { PersonRef, Unavailable } from './techAvailability.ts'

export const MAX_SKILLS = 50
export const MAX_SKILL = 60
const norm = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ')
const lc = (s: unknown) => norm(s).toLowerCase()

/** A clean list: trimmed, no blanks, no repeats (first spelling kept), at most MAX_SKILLS of MAX_SKILL characters. */
export function cleanSkills(list: unknown): string[] {
  const out: string[] = []
  for (const x of Array.isArray(list) ? list : []) {
    const s = norm(x).slice(0, MAX_SKILL)
    if (s && !out.some((o) => lc(o) === lc(s))) out.push(s)
    if (out.length >= MAX_SKILLS) break
  }
  return out
}

const settingsOf = (raw: unknown): any => (typeof raw === 'string' ? JSON.parse(raw || '{}') : raw) || {}

/** The skills each kind of job needs, as stored (job type as the business writes it → its skills). */
export function jobTypeSkills(settings: unknown): Record<string, string[]> {
  const raw = settingsOf(settings)?.skillMatching?.jobTypes
  const out: Record<string, string[]> = {}
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) { const t = norm(k).slice(0, 40); const sk = cleanSkills(v); if (t && sk.length) out[t] = sk }
  return out
}

/** What a job of this type needs (none for no type, or a type nothing is set for). */
export async function skillsNeeded(exec: any, companyId: string, jobType: string | null | undefined): Promise<string[]> {
  if (!norm(jobType)) return []
  const [co] = await exec.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const map = jobTypeSkills(co?.settings)
  const key = Object.keys(map).find((k) => lc(k) === lc(jobType))
  return key ? map[key] : []
}

/** Each person's skills, by person key (a login's id or a roster member's). */
export async function skillsOf(exec: any, companyId: string, people: PersonRef[]): Promise<Map<string, string[]>> {
  const userIds = people.map((p) => p.userId).filter(Boolean) as string[]
  const memberIds = people.map((p) => p.memberId).filter(Boolean) as string[]
  const [users, members] = await Promise.all([
    userIds.length ? exec.select({ id: user.id, skills: user.skills }).from(user).where(and(eq(user.companyId, companyId), inArray(user.id, userIds))) : [],
    memberIds.length ? exec.select({ id: teamMember.id, skills: teamMember.skills }).from(teamMember).where(and(eq(teamMember.companyId, companyId), inArray(teamMember.id, memberIds))) : [],
  ])
  const out = new Map<string, string[]>()
  for (const r of [...users, ...members] as any[]) out.set(r.id, cleanSkills(r.skills))
  return out
}

/** What `needed` the people's skills, together, do not cover. */
export function missingSkills(needed: string[], have: string[][]): string[] {
  const all = new Set(have.flat().map(lc))
  return needed.filter((s) => !all.has(lc(s)))
}

/**
 * The job check: the people on a job of this type, together, lack a skill it needs — a warning the office may book past ("Book
 * anyway"), never a refusal. Nobody on the job, no type, or nothing needed: no warning.
 */
export async function skillCheck(exec: any, companyId: string, people: PersonRef[], jobType: string | null | undefined): Promise<Unavailable | null> {
  if (!people.length) return null
  const needed = await skillsNeeded(exec, companyId, jobType)
  if (!needed.length) return null
  const have = await skillsOf(exec, companyId, people)
  const missing = missingSkills(needed, people.map((p) => have.get((p.userId || p.memberId) as string) || []))
  if (!missing.length) return null
  const what = missing.length === 1 ? 'a skill this kind of job needs' : 'skills this kind of job needs'
  const short = `${people.length === 1 ? 'The person on this job is missing' : 'No one on this job has'} ${what} (${norm(jobType)}): ${missing.join(', ')}.`
  return { code: 'unavailable', message: `${short} Book anyway, or pick someone who has ${missing.length === 1 ? 'it' : 'them'}.`, short, personId: '', reason: 'skills' }
}

// ---------------------------------------------------------------------------------------------------------- the settings page

/** Everyone who can be given work, with their skills (Settings › Skills). */
export async function peopleWithSkills(exec: any, companyId: string, workers: Array<{ ref: PersonRef; id: string; kind: 'user' | 'member'; name: string }>) {
  const have = await skillsOf(exec, companyId, workers.map((w) => w.ref))
  return workers.map((w) => ({ personId: w.id, kind: w.kind, name: w.name, skills: have.get(w.id) || [] }))
}

/** Replace one person's skills (a login's or a roster member's). */
export async function setPersonSkills(exec: any, companyId: string, who: PersonRef, skills: string[]): Promise<string[]> {
  const clean = cleanSkills(skills)
  if (who.userId) await exec.update(user).set({ skills: clean, updatedAt: new Date() } as any).where(and(eq(user.id, who.userId), eq(user.companyId, companyId)))
  else if (who.memberId) await exec.update(teamMember).set({ skills: clean, updatedAt: new Date() } as any).where(and(eq(teamMember.id, who.memberId), eq(teamMember.companyId, companyId)))
  return clean
}

/** Replace what each kind of job needs (company settings skillMatching.jobTypes). */
export async function setJobTypeSkills(exec: any, companyId: string, map: Record<string, string[]>): Promise<Record<string, string[]>> {
  const [co] = await exec.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
  const settings = settingsOf(co?.settings)
  const next = jobTypeSkills({ skillMatching: { jobTypes: map } })
  await exec.update(company).set({ settings: { ...settings, skillMatching: { ...(settings.skillMatching || {}), jobTypes: next } }, updatedAt: new Date() } as any).where(eq(company.id, companyId))
  return next
}

/** The job types the business already uses (its jobs' own words), to pick from — most used first. */
export async function jobTypesInUse(exec: any, companyId: string): Promise<string[]> {
  const rows = await exec.select({ t: job.jobType }).from(job).where(eq(job.companyId, companyId)).orderBy(desc(job.createdAt)).limit(2000)
  const count = new Map<string, { name: string; n: number }>()
  for (const r of rows as any[]) { const t = norm(r.t); if (!t) continue; const k = t.toLowerCase(); const e = count.get(k); if (e) e.n++; else count.set(k, { name: t, n: 1 }) }
  return [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, 100).map((e) => e.name)
}
