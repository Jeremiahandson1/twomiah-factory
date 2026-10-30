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
// rule as a credential that has expired).
export const MATCH_PREFS_FEATURE = 'care_match_prefs'

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

export interface MatchClient { requiredSkills?: unknown; preferredCaregiverGender?: unknown; preferredLanguage?: unknown }
export interface MatchCaregiver { capabilities?: unknown; gender?: unknown; languages?: unknown }
export interface TraitMatch {
  scoreDelta: number
  reasons: string[]
  requiredSkills: string[]
  missingSkills: string[]
  hasRequiredSkills: boolean
  genderOk: boolean | null     // null = the client has no preference, or the caregiver's gender is not recorded
  languageOk: boolean | null
}

export const TRAIT_SCORES = { missingSkill: -120, skillsAll: 25, genderMiss: -100, genderMatch: 25, languageMiss: -40, languageMatch: 30 } as const

export function matchTraits(client: MatchClient, cg: MatchCaregiver): TraitMatch {
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

  return { scoreDelta, reasons, requiredSkills: required, missingSkills, hasRequiredSkills: missingSkills.length === 0, genderOk, languageOk }
}
