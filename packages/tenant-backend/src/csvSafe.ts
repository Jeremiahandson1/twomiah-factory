// A SPREADSHEET CELL THAT STAYS TEXT (code review 11-1, 2026-11-13).
//
// A cell that begins with = + - @ (or a tab or carriage return) is run as a FORMULA when the file is opened in Excel or
// Sheets. Much of what the app exports was typed by somebody outside the business — a name on the website's enquiry
// form, a booking note, a message in a portal — so a visitor could put a formula in the office's own export
// ("CSV injection"). The import already kept such a value as text (crm/office/importService.ts deFormula) and the
// screens' own downloads did (tenant-ui reporting/csv.ts); the server's files did not. A leading apostrophe keeps the
// cell literal, which is what a spreadsheet shows as plain text.
//
// A value that is only a number, a phone number, a date or a time (digits and their punctuation) is left as it is: it
// cannot run anything, and "-12.50" or "+1 715 555 0100" should stay what it says.
const STARTS_A_FORMULA = /^[=+\-@\t\r]/
const ONLY_FIGURES = /^[+-]?[\d\s().,:/-]*$/

export function csvFormulaSafe(text: string): string {
  return STARTS_A_FORMULA.test(text) && !ONLY_FIGURES.test(text) ? "'" + text : text
}
