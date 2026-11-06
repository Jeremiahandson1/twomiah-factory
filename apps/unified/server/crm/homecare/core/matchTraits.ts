// Matching on what the client needs and prefers (item 5, docs/parity/homecare-matching.md): skills, a gender preference
// and a language, on top of the ranking suggest-caregivers already did (preferred caregivers, do-not-use, availability,
// hours, distance, history). Pure — the route supplies the rows. Every factor adds a plain reason the office can read.
//
// A client's needs live on the client: required_skills (a comma list, matched to the caregiver's skills), a preferred
// caregiver gender ('female' | 'male' | none) and a preferred language. A caregiver's side is caregiver_profiles:
// capabilities (the skills list that already existed), gender and languages. A factor the client did not set changes
// nothing, and a fact about the caregiver that was never recorded is said so, never guessed.
//
// Skill, gender and language misses are warnings with a score penalty, never a hiding: the office decides (the same
// rule as a credential that has expired) — UNLESS the client marks that need a must-have (row 14, AxisCare: "client requirements
// act as hard filters"): then a caregiver who misses it, or whose side is not recorded, is in `hardMisses` and is not suggested,
// not auto-filled and not offered the open shift.
//
// Row 14 adds: certifications the client needs (matched to the caregiver's unexpired certification records), the home's
// attributes against what the caregiver avoids (pets, smoking — AxisCare's "caregiver preferences"), and the caregiver's own
// travel limit against the distance to the client.
export const MATCH_PREFS_FEATURE = 'care_match_prefs'
/** The needs a client can mark as must-haves. */
export const MUST_HAVE_FACTORS = ['skills', 'certifications', 'gender', 'language', 'home'] as const
export type MustHave = typeof MUST_HAVE_FACTORS[number]
export const MUST_HAVE_LABELS: Record<MustHave, string> = { skills: 'skills', certifications: 'certifications', gender: 'caregiver gender', language: 'language', home: 'things about the home' }
/** The must-haves a client sent, checked: known factors only, each once. */
export const normMustHave = (v: unknown): MustHave[] => [...new Set((Array.isArray(v) ? v : []).map(String).filter((x): x is MustHave => (MUST_HAVE_FACTORS as readonly string[]).includes(x)))]

/** 'a, b ;c' → ['a','b','c'] (comma, semicolon or newline separated; blanks dropped; first spelling kept, case-insensitive duplicates dropped). */
export function splitList(v: unknown): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const part of (Array.isArray(v) ? v.map(String) : String(v ?? '').split(/[,;\n]/))) {
    const t = part.trim()
    if (t && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t) }
  }
  return out
}

/** 'female' | 'male' | null — what the screens and the API accept for a gender (anything else is "not set"). */
export function normGender(v: unknown): 'female' | 'male' | null {
  const g = String(v ?? '').trim().toLowerCase()
  if (g === 'f' || g === 'female' || g === 'woman') return 'female'
  if (g === 'm' || g === 'male' || g === 'man') return 'male'
  return null
}

export interface MatchClient {
  requiredSkills?: unknown; preferredCaregiverGender?: unknown; preferredLanguage?: unknown
  requiredCertifications?: unknown; homeAttributes?: unknown; matchMustHave?: unknown
}
export interface MatchCaregiver {
  capabilities?: unknown; gender?: unknown; languages?: unknown
  /** The caregiver's certification types valid on the visit's day (a comma list). */
  validCertifications?: unknown; avoidAttributes?: unknown; maxTravelMiles?: unknown
}
export interface TraitMatch {
  scoreDelta: number
  reasons: string[]
  requiredSkills: string[]
  missingSkills: string[]
  hasRequiredSkills: boolean
  genderOk: boolean | null     // null = the client has no preference, or the caregiver's gender is not recorded
  languageOk: boolean | null
  requiredCertifications: string[]
  missingCertifications: string[]
  /** Things about the home this caregiver avoids. */
  avoided: string[]
  /** The distance is over the caregiver's own travel limit. */
  beyondTravel: boolean
  /** The client's must-haves this caregiver misses (plain words): never suggested, auto-filled or offered the shift. */
  hardMisses: string[]
}

export const TRAIT_SCORES = {
  missingSkill: -120, skillsAll: 25, genderMiss: -100, genderMatch: 25, languageMiss: -40, languageMatch: 30,
  missingCert: -120, certsAll: 20, avoided: -100, beyondTravel: -60,
} as const

/** `distance` (miles, straight line) when known, for the caregiver's travel limit. */
export function matchTraits(client: MatchClient, cg: MatchCaregiver, distance: number | null = null): TraitMatch {
  const reasons: string[] = []
  let scoreDelta = 0

  const required = splitList(client.requiredSkills)
  const have = new Set(splitList(cg.capabilities).map((s) => s.toLowerCase()))
  const missingSkills = required.filter((s) => !have.has(s.toLowerCase()))
  if (required.length) {
    if (missingSkills.length) { scoreDelta += TRAIT_SCORES.missingSkill; reasons.push(`⚠️ Missing skill: ${missingSkills.join(', ')}`) }
    else { scoreDelta += TRAIT_SCORES.skillsAll; reasons.push(`✓ Has the skills needed (${required.join(', ')})`) }
  }

  const wantGender = normGender(client.preferredCaregiverGender)
  const cgGender = normGender(cg.gender)
  let genderOk: boolean | null = null
  if (wantGender) {
    if (!cgGender) reasons.push(`Client prefers a ${wantGender} caregiver — this caregiver's gender is not recorded`)
    else if (cgGender === wantGender) { genderOk = true; scoreDelta += TRAIT_SCORES.genderMatch; reasons.push(`✓ Client prefers a ${wantGender} caregiver`) }
    else { genderOk = false; scoreDelta += TRAIT_SCORES.genderMiss; reasons.push(`⚠️ Client prefers a ${wantGender} caregiver`) }
  }

  const wantLang = String(client.preferredLanguage ?? '').trim()
  const speaks = splitList(cg.languages).map((l) => l.toLowerCase())
  let languageOk: boolean | null = null
  // English is the agency's working language: a client who prefers English needs nothing recorded for the caregiver.
  if (wantLang && wantLang.toLowerCase() !== 'english') {
    if (!speaks.length) reasons.push(`Client prefers ${wantLang} — this caregiver's languages are not recorded`)
    else if (speaks.includes(wantLang.toLowerCase())) { languageOk = true; scoreDelta += TRAIT_SCORES.languageMatch; reasons.push(`✓ Speaks ${wantLang}`) }
    else { languageOk = false; scoreDelta += TRAIT_SCORES.languageMiss; reasons.push(`⚠️ Client prefers ${wantLang}; this caregiver speaks ${splitList(cg.languages).join(', ')}`) }
  }

  const certsNeeded = splitList(client.requiredCertifications)
  const certsHeld = new Set(splitList(cg.validCertifications).map((x) => x.toLowerCase()))
  const missingCertifications = certsNeeded.filter((x) => !certsHeld.has(x.toLowerCase()))
  if (certsNeeded.length) {
    if (missingCertifications.length) { scoreDelta += TRAIT_SCORES.missingCert; reasons.push(`⚠️ No valid ${missingCertifications.join(', ')}`) }
    else { scoreDelta += TRAIT_SCORES.certsAll; reasons.push(`✓ Holds ${certsNeeded.join(', ')}`) }
  }

  const home = splitList(client.homeAttributes)
  const avoids = new Set(splitList(cg.avoidAttributes).map((x) => x.toLowerCase()))
  const avoided = home.filter((x) => avoids.has(x.toLowerCase()))
  if (avoided.length) { scoreDelta += TRAIT_SCORES.avoided; reasons.push(`⚠️ Prefers not to work with: ${avoided.join(', ')}`) }

  const limit = Number(cg.maxTravelMiles)
  const beyondTravel = Number.isFinite(limit) && limit > 0 && distance !== null && distance > limit
  if (beyondTravel) { scoreDelta += TRAIT_SCORES.beyondTravel; reasons.push(`⚠️ Beyond their travel limit (${distance!.toFixed(1)} of ${limit} mi)`) }

  // Must-haves: a miss, or a side that is not recorded (it cannot be confirmed), keeps the caregiver off this client.
  const hardMisses: string[] = []
  for (const f of normMustHave(client.matchMustHave)) {
    if (f === 'skills' && required.length && missingSkills.length) hardMisses.push(`Must have: ${missingSkills.join(', ')}`)
    if (f === 'certifications' && certsNeeded.length && missingCertifications.length) hardMisses.push(`Must hold: ${missingCertifications.join(', ')}`)
    if (f === 'gender' && wantGender && genderOk !== true) hardMisses.push(`Must be a ${wantGender} caregiver`)
    if (f === 'language' && wantLang && wantLang.toLowerCase() !== 'english' && languageOk !== true) hardMisses.push(`Must speak ${wantLang}`)
    if (f === 'home' && avoided.length) hardMisses.push(`Avoids: ${avoided.join(', ')}`)
  }

  return {
    scoreDelta, reasons, requiredSkills: required, missingSkills, hasRequiredSkills: missingSkills.length === 0, genderOk, languageOk,
    requiredCertifications: certsNeeded, missingCertifications, avoided, beyondTravel, hardMisses,
  }
}
