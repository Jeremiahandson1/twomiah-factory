// The rules dispatchFit.tsx shows (no React here, so the server-side tests can read them): what a job's kind needs, who lacks
// it, which zone a job is in.
export interface FitZone { id: string; name: string; zips: string[]; color: string; techIds?: string[] }
export interface Fit { people: Record<string, string[]>; needs: Record<string, string[]> }
/** The job's fields the rules read (GET /api/jobs rows carry both). */
export interface FitJob { jobType?: string | null; zip?: string | null }

const norm = (x: string) => x.trim().toLowerCase().replace(/\s+/g, ' ')
/** A ZIP as zones keep it: trimmed, upper case, a ZIP+4 cut to its five. */
const zipKey = (z: unknown) => String(z ?? '').trim().toUpperCase().replace(/^(\d{5})-\d{4}$/, '$1')

/** The skills a job's kind needs (none when skills are off or its kind asks for none). */
export const neededFor = (fit: Fit | null, j: FitJob | null | undefined): string[] => (j?.jobType && fit ? fit.needs[norm(j.jobType)] || [] : [])
/** Which of those a person lacks. */
export const missingFor = (fit: Fit | null, personId: string, needed: string[]) => needed.filter((n) => !(fit?.people[personId] || []).includes(norm(n)))
/** The zone a job's ZIP is in, if any. */
export const zoneOf = (zones: FitZone[], j: FitJob) => { const k = zipKey(j.zip); return k ? zones.find((z) => z.zips.includes(k)) ?? null : null }
/** One zone picked ('' every job; 'none' the jobs in no zone): is this job shown. */
export const inZone = (zones: FitZone[], shown: string, j: FitJob) => !shown || (shown === 'none' ? !zoneOf(zones, j) : zoneOf(zones, j)?.id === shown)
/** GET /api/skills, as the rules read it. */
export const fitFrom = (r: any): Fit => ({
  people: Object.fromEntries((r?.people || []).map((p: any) => [String(p.personId), (p.skills || []).map(norm)])),
  needs: Object.fromEntries((r?.jobTypes || []).map((t: any) => [norm(String(t.jobType || '')), t.skills || []])),
})
