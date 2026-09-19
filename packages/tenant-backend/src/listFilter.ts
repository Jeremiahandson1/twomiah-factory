// Refusing a list filter whose value is not in the vocabulary — ONE answer for every CRM.
//
// A filter naming something the vocabulary does not contain is a typo, not a result. Answering it with an empty
// list is the worst of both: the caller is told, in the ordinary way, that there is nothing there. On the live
// contractor tenant `?status=banana` came back as 0 invoices of 78, 0 jobs of 90 and 0 quotes of 27, each
// indistinguishable from a genuinely empty page. (Contractor T29 N2)
//
// The house style for this already existed and is followed here: the lead inbox refuses an unknown status, and
// the marketing audience refuses an unknown audience and names the ones it accepts (T21 M4). Naming them is the
// part that makes the answer useful, so that is what this does.
//
// It applies ONLY where a bounded vocabulary already governs writes — invoice/job/quote status, contact type,
// expense category. A field that is free text on the way in (a document's `type`) has no vocabulary to be
// outside of, so an empty result there is the true answer and is left alone.

/** No filter at all ('' or absent) is not a filter to validate. */
export const filterGiven = (value: string | undefined | null): value is string => typeof value === 'string' && value !== ''

/** 400 naming the values this filter accepts. `accepted` is the same list that governs writes. */
export function invalidFilter(c: any, field: string, value: string, accepted: readonly string[]) {
  return c.json(
    {
      error: `"${value}" is not a ${field} this CRM uses. Choose one of: ${accepted.join(', ')}.`,
      code: 'INVALID_FILTER',
      field,
      accepted: [...accepted],
    },
    400,
  )
}

/**
 * Returns the 400 when the filter names something outside the vocabulary, or null to carry on.
 *   const bad = checkFilter(c, 'status', status, JOB_STATUSES); if (bad) return bad
 */
export function checkFilter(c: any, field: string, value: string | undefined | null, accepted: readonly string[]) {
  if (!filterGiven(value)) return null
  return accepted.includes(value) ? null : invalidFilter(c, field, value, accepted)
}
