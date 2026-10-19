// The statutes that bar (or call for review of) a caregiver's employment, by state: Wisconsin's (Wis. Stat.
// 50.065(2)(bd), 48.685, DHS 12.07(1m)(a)). Read by the eligibility engine (eligibilityEngine.ts) for an agency in that
// state.
//
// The template seeded these 28 rows into a table (templates/crm-homecare/backend/db/migrations/0018_staff.sql), and
// nothing ever wrote to it. Here every table carries company_id, a migration cannot seed a company that does not exist
// yet, and nothing seeded one at signup — so a new agency's list was empty and a disqualifying record read as "manual
// review" instead of "do not hire" (found moving the HR routes). It is the law, the same for every agency: it lives in
// the code, so every agency always has the whole, current list. Generated from the template's rows, not retyped.
//
//   permanent_bar  the conviction bars caregiver employment; no rehabilitation review
//   rehab_review   bars employment unless a DHS rehabilitation review finds substantial rehabilitation
//   advisory       worth flagging; does not legally bar employment
// matchPatterns are case-insensitive regex fragments matched against the check's findings.

export interface Disqualifier {
  id: string
  state: string
  category: string
  statute: string
  shortTitle: string
  description: string
  severity: 'permanent_bar' | 'rehab_review' | 'advisory'
  matchPatterns: string[]
}

export const DISQUALIFIERS: readonly Disqualifier[] = [
  { id: "wi-940-01", state: "WI", category: "violence", statute: "Wis. Stat. § 940.01", shortTitle: "First-degree intentional homicide", description: "Intentional killing.", severity: "permanent_bar", matchPatterns: ["first[- ]degree.*intentional.*homicide","first[- ]degree.*murder","intentional homicide"] },
  { id: "wi-940-02", state: "WI", category: "violence", statute: "Wis. Stat. § 940.02", shortTitle: "First-degree reckless homicide", description: "Reckless killing under circumstances showing depraved mind.", severity: "permanent_bar", matchPatterns: ["first[- ]degree.*reckless.*homicide"] },
  { id: "wi-940-05", state: "WI", category: "violence", statute: "Wis. Stat. § 940.05", shortTitle: "Second-degree intentional homicide", description: "Intentional killing with mitigating circumstances.", severity: "permanent_bar", matchPatterns: ["second[- ]degree.*intentional.*homicide"] },
  { id: "wi-940-19", state: "WI", category: "violence", statute: "Wis. Stat. § 940.19", shortTitle: "Aggravated battery", description: "Battery causing great bodily harm.", severity: "rehab_review", matchPatterns: ["aggravated battery","great bodily harm"] },
  { id: "wi-940-225", state: "WI", category: "violence", statute: "Wis. Stat. § 940.225", shortTitle: "Sexual assault (1st/2nd/3rd degree)", description: "Nonconsensual sexual contact or intercourse.", severity: "permanent_bar", matchPatterns: ["sexual assault","sexual intercourse.*without consent","1st degree sexual","2nd degree sexual","3rd degree sexual"] },
  { id: "wi-940-285", state: "WI", category: "violence", statute: "Wis. Stat. § 940.285", shortTitle: "Abuse of a vulnerable adult", description: "Intentional/negligent abuse of a vulnerable adult.", severity: "permanent_bar", matchPatterns: ["abuse.*vulnerable adult","abuse of elderly","abuse of patient","abuse of resident"] },
  { id: "wi-940-295", state: "WI", category: "violence", statute: "Wis. Stat. § 940.295", shortTitle: "Abuse/neglect of patients/residents", description: "Abuse or neglect in a care setting.", severity: "permanent_bar", matchPatterns: ["abuse.*patient","abuse.*resident","neglect.*patient","neglect.*resident"] },
  { id: "wi-948-02", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.02", shortTitle: "Sexual assault of a child", description: "Sexual contact/intercourse with person under 16.", severity: "permanent_bar", matchPatterns: ["sexual assault.*child","sexual contact.*child","948\\.02"] },
  { id: "wi-948-03", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.03", shortTitle: "Physical abuse of a child", description: "Physical abuse of a child.", severity: "permanent_bar", matchPatterns: ["physical abuse.*child","child abuse","948\\.03"] },
  { id: "wi-948-04", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.04", shortTitle: "Causing mental harm to a child", description: "Intentional mental harm.", severity: "rehab_review", matchPatterns: ["mental harm.*child","948\\.04"] },
  { id: "wi-948-05", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.05", shortTitle: "Sexual exploitation of a child", description: "Causing/permitting sexual conduct.", severity: "permanent_bar", matchPatterns: ["sexual exploitation.*child","948\\.05"] },
  { id: "wi-948-055", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.055", shortTitle: "Causing child to view/listen to sexual activity", description: "Exposing minors to sexual activity.", severity: "permanent_bar", matchPatterns: ["child.*view.*sexual","child.*listen.*sexual","948\\.055"] },
  { id: "wi-948-06", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.06", shortTitle: "Incest with a child", description: "Sexual contact with child relative.", severity: "permanent_bar", matchPatterns: ["incest.*child","948\\.06"] },
  { id: "wi-948-07", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.07", shortTitle: "Child enticement", description: "Enticing a child into a secluded place.", severity: "permanent_bar", matchPatterns: ["child enticement","948\\.07"] },
  { id: "wi-948-08", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.08", shortTitle: "Soliciting a child for prostitution", description: "Soliciting a child for sex acts.", severity: "permanent_bar", matchPatterns: ["solicit.*child.*prostitut","948\\.08"] },
  { id: "wi-948-21", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.21", shortTitle: "Neglect of a child", description: "Negligent failure to act as a parent/guardian.", severity: "rehab_review", matchPatterns: ["neglect.*child","948\\.21"] },
  { id: "wi-948-22", state: "WI", category: "child_offenses", statute: "Wis. Stat. § 948.22", shortTitle: "Failure to support (child abandonment)", description: "Intentional failure to support.", severity: "advisory", matchPatterns: ["failure to support","abandon.*child","948\\.22"] },
  { id: "wi-943-20", state: "WI", category: "financial", statute: "Wis. Stat. § 943.20", shortTitle: "Theft", description: "Taking property of another.", severity: "rehab_review", matchPatterns: ["theft","larceny","943\\.20"] },
  { id: "wi-943-201", state: "WI", category: "financial", statute: "Wis. Stat. § 943.201", shortTitle: "Identity theft", description: "Using another person's identity.", severity: "rehab_review", matchPatterns: ["identity theft","943\\.201"] },
  { id: "wi-943-38", state: "WI", category: "financial", statute: "Wis. Stat. § 943.38", shortTitle: "Forgery", description: "Falsification of a writing.", severity: "rehab_review", matchPatterns: ["forgery","943\\.38"] },
  { id: "wi-943-41", state: "WI", category: "financial", statute: "Wis. Stat. § 943.41", shortTitle: "Financial crimes (credit card etc.)", description: "Credit/debit card fraud.", severity: "rehab_review", matchPatterns: ["credit card.*fraud","943\\.41"] },
  { id: "wi-946-52", state: "WI", category: "financial", statute: "Wis. Stat. § 946.52", shortTitle: "Theft from a vulnerable person", description: "Financial exploitation of a vulnerable adult.", severity: "permanent_bar", matchPatterns: ["theft.*vulnerable","financial.*exploit","946\\.52"] },
  { id: "wi-961-41", state: "WI", category: "drugs", statute: "Wis. Stat. § 961.41", shortTitle: "Controlled substance manufacture/delivery", description: "Manufacture or delivery of a controlled substance.", severity: "rehab_review", matchPatterns: ["manufacture.*controlled","deliver.*controlled","961\\.41"] },
  { id: "wi-961-573", state: "WI", category: "drugs", statute: "Wis. Stat. § 961.573", shortTitle: "Drug paraphernalia possession", description: "Possession of drug paraphernalia.", severity: "advisory", matchPatterns: ["drug paraphernalia","961\\.573"] },
  { id: "wi-941-29", state: "WI", category: "weapons", statute: "Wis. Stat. § 941.29", shortTitle: "Possession of firearm by felon", description: "Felon in possession of a firearm.", severity: "rehab_review", matchPatterns: ["felon.*possession.*firearm","941\\.29"] },
  { id: "wi-346-63", state: "WI", category: "driving", statute: "Wis. Stat. § 346.63", shortTitle: "OWI — 3rd offense or higher", description: "Operating while intoxicated, 3rd+ offense.", severity: "advisory", matchPatterns: ["owi.*3rd","owi.*4th","owi.*5th","owi.*sixth","operating while intoxicated.*3rd","dwi.*3rd"] },
  { id: "wi-346-67", state: "WI", category: "driving", statute: "Wis. Stat. § 346.67", shortTitle: "Hit and run", description: "Leaving the scene of an accident.", severity: "rehab_review", matchPatterns: ["hit and run","leaving.*scene","346\\.67"] },
  { id: "wi-42cfr1001", state: "WI", category: "federal", statute: "42 CFR § 1001", shortTitle: "OIG exclusion list", description: "Excluded from participation in federal healthcare programs.", severity: "permanent_bar", matchPatterns: ["oig.*exclus","medicaid.*exclus","medicare.*exclus"] },
]

/** The statutes that apply in `state` (two letters). */
export const disqualifiersFor = (state: string | null | undefined): Disqualifier[] =>
  state ? DISQUALIFIERS.filter((d) => d.state === state.toUpperCase()) : []
