/** Call / text / email addresses for the phone's own apps (tel:, sms:, mailto:). Pure — src/home/phoneActions.ts opens them. */
const digits = (s: string) => s.replace(/[^\d+]/g, '')
export const telUrl = (phone: string) => `tel:${digits(phone)}`
export const smsUrl = (phone: string) => `sms:${digits(phone)}`
export const mailUrl = (email: string) => `mailto:${email.trim()}`
