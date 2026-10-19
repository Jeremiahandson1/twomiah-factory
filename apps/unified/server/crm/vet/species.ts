// The practice's species vocabulary — ONE list, so every way a patient can be created agrees.
//
// /api/patients enforces it (an unknown species is a 400). Online booking cannot: its species box is free text on a
// public widget, and refusing a booking because somebody wrote "Kitty" would lose the customer. So the booking path
// normalises what was typed into THIS list instead, and the booking row keeps the raw answer. (Vet T12 H5/L9)
export const SPECIES = ['dog', 'cat', 'avian', 'reptile', 'equine', 'exotic', 'other'] as const
export type Species = (typeof SPECIES)[number]
/** what an unrecognised answer becomes on the chart */
export const SPECIES_FALLBACK: Species = 'other'
