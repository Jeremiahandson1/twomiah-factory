// What a clinic calls its appointment types. The stored values are short enum-ish strings — "wellness",
// "sick", "euthanasia" — and every surface printed them raw, so the schedule read like a database dump and
// the hardest appointment a practice books appeared as a bare lowercase word. The value is unchanged; only
// what a person sees is. (Vet T12 M11)

export const APPOINTMENT_TYPES = [
  { value: 'wellness', label: 'Wellness exam' },
  { value: 'sick', label: 'Sick visit' },
  { value: 'surgery', label: 'Surgery' },
  { value: 'dental', label: 'Dental' },
  { value: 'recheck', label: 'Recheck' },
  { value: 'grooming', label: 'Grooming' },
  { value: 'euthanasia', label: 'Euthanasia' },
] as const

const BY_VALUE: Record<string, string> = Object.fromEntries(APPOINTMENT_TYPES.map((t) => [t.value, t.label]))

/** A type we do not know still reads as a word, not as nothing. */
export function appointmentTypeLabel(value?: string | null): string {
  const v = String(value ?? '').trim()
  if (!v) return '';
  return BY_VALUE[v.toLowerCase()] || v.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
}
