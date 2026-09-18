// What a drug belongs to, so a prescription can be checked against the allergies already on the chart.
//
// A clinic records allergies as free text — "penicillin", "sulfa drugs", "Rimadyl (hives)" — and prescribes by
// brand or generic name. Matching the two strings directly catches only the case where the clinician typed the
// identical word, which is the case least likely to be the mistake. So a drug is first resolved to its class,
// and the allergy text is then searched for that class's name, any other member of it, or the drug itself.
// "Amoxicillin" against an allergy of "penicillin" is the reason this exists.
//
// This warns; it does not decide. Every check returns something the clinician can overrule — the vet knows
// things the chart does not, and a hard block on a documented allergy would be wrong for, say, a desensitised
// patient or a mis-recorded reaction. (Vet T12 M7)

export interface DrugClass {
  /** what the warning calls it */
  label: string
  /** generic and brand names that put a prescription in this class */
  members: string[]
  /** other ways an owner or a clinician writes the class itself in an allergy note */
  alsoKnownAs?: string[]
}

export const DRUG_CLASSES: DrugClass[] = [
  {
    label: 'penicillin',
    alsoKnownAs: ['penicillins', 'penicillin g', 'penicillin v', 'beta lactam', 'beta-lactam'],
    members: ['penicillin', 'amoxicillin', 'amoxicillin-clavulanate', 'amoxicillin clavulanate', 'clavamox', 'augmentin', 'ampicillin', 'cloxacillin', 'dicloxacillin', 'piperacillin', 'ticarcillin', 'carbenicillin'],
  },
  {
    label: 'cephalosporin',
    alsoKnownAs: ['cephalosporins', 'cephalexins'],
    members: ['cephalexin', 'keflex', 'cefazolin', 'cefovecin', 'convenia', 'cefpodoxime', 'simplicef', 'ceftiofur', 'naxcel', 'excede', 'cefadroxil'],
  },
  {
    label: 'sulfonamide',
    alsoKnownAs: ['sulfonamides', 'sulfa', 'sulfa drugs', 'sulphonamide', 'sulpha'],
    members: ['sulfamethoxazole', 'trimethoprim-sulfamethoxazole', 'trimethoprim sulfamethoxazole', 'tmps', 'smz-tmp', 'sulfadiazine', 'sulfadimethoxine', 'albon', 'sulfasalazine'],
  },
  {
    label: 'NSAID',
    alsoKnownAs: ['nsaids', 'non-steroidal', 'non steroidal', 'anti-inflammatory', 'anti inflammatory'],
    members: ['carprofen', 'rimadyl', 'novox', 'meloxicam', 'metacam', 'deracoxib', 'deramaxx', 'firocoxib', 'previcox', 'robenacoxib', 'onsior', 'grapiprant', 'galliprant', 'aspirin', 'ibuprofen', 'ketoprofen', 'flunixin', 'banamine'],
  },
  {
    label: 'tetracycline',
    alsoKnownAs: ['tetracyclines'],
    members: ['tetracycline', 'doxycycline', 'vibramycin', 'minocycline', 'oxytetracycline'],
  },
  {
    label: 'macrolide',
    alsoKnownAs: ['macrolides'],
    members: ['erythromycin', 'azithromycin', 'zithromax', 'clarithromycin', 'tylosin', 'tylan'],
  },
  {
    label: 'aminoglycoside',
    alsoKnownAs: ['aminoglycosides'],
    members: ['gentamicin', 'amikacin', 'neomycin', 'tobramycin', 'streptomycin'],
  },
  {
    label: 'fluoroquinolone',
    alsoKnownAs: ['fluoroquinolones', 'quinolone', 'quinolones'],
    members: ['enrofloxacin', 'baytril', 'marbofloxacin', 'zeniquin', 'orbifloxacin', 'orbax', 'ciprofloxacin', 'pradofloxacin', 'veraflox'],
  },
  {
    label: 'lincosamide',
    alsoKnownAs: ['lincosamides'],
    members: ['clindamycin', 'antirobe', 'lincomycin'],
  },
  {
    label: 'opioid',
    alsoKnownAs: ['opioids', 'opiate', 'opiates'],
    members: ['morphine', 'hydromorphone', 'buprenorphine', 'buprenex', 'simbadol', 'butorphanol', 'torbugesic', 'fentanyl', 'methadone', 'tramadol', 'codeine'],
  },
]

const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
/** whole-word-ish containment: "amoxicillin" is in "amoxicillin 250mg", but "pen" is not a hit on "penicillin" */
const mentions = (haystack: string, needle: string) => {
  if (!needle || needle.length < 4) return false
  return new RegExp(`(^|[^a-z0-9])${needle.replace(/[-\s]/g, '[-\\s]')}([^a-z0-9]|$)`).test(haystack)
}

export function classOf(drug: unknown): DrugClass | null {
  const d = norm(drug)
  if (!d) return null
  let best: { cls: DrugClass; len: number } | null = null
  for (const cls of DRUG_CLASSES) {
    for (const m of cls.members) {
      // longest member wins, so "amoxicillin-clavulanate" is not merely "amoxicillin"
      if (mentions(d, m) && (!best || m.length > best.len)) best = { cls, len: m.length }
    }
  }
  return best?.cls || null
}

export interface AllergyHit { allergy: string; drugClass: string | null; matched: string }

/**
 * Does this drug run into something on the chart? Returns the allergy phrase as the clinic wrote it, so the
 * warning quotes the record rather than paraphrasing it.
 */
export function allergyConflict(allergies: unknown, drug: unknown): AllergyHit | null {
  const raw = String(allergies ?? '').trim()
  const d = norm(drug)
  if (!raw || !d) return null
  const hay = norm(raw)

  const cls = classOf(d)
  if (cls) {
    for (const term of [cls.label, ...(cls.alsoKnownAs || []), ...cls.members]) {
      if (mentions(hay, norm(term))) return { allergy: raw, drugClass: cls.label, matched: term }
    }
  }

  // No class, or a class nothing on the chart names — the drug itself may still be listed. Compare against
  // each phrase the clinic separated out, so "hives, doxycycline" is two entries and not one long string.
  for (const part of raw.split(/[,;\n]/).map(norm).filter(p => p.length >= 4)) {
    if (mentions(d, part) || mentions(part, d)) return { allergy: raw, drugClass: cls?.label || null, matched: part }
  }
  return null
}

/** The sentence a clinician sees. */
export function allergyWarning(patientName: string, drug: string, hit: AllergyHit): string {
  const who = patientName || 'This patient'
  const what = String(drug).trim()
  return hit.drugClass
    ? `${who}'s chart records an allergy — "${hit.allergy}" — and ${what} is a ${hit.drugClass}-class drug. Prescribe anyway?`
    : `${who}'s chart records an allergy — "${hit.allergy}" — which names ${what}. Prescribe anyway?`
}
