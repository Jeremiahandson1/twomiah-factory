/** Call / text / email open the phone's own apps (tel:, sms:, mailto:). Nothing here talks to the server. */
import { Linking } from 'react-native'

const digits = (s: string) => s.replace(/[^\d+]/g, '')
export const telUrl = (phone: string) => `tel:${digits(phone)}`
export const smsUrl = (phone: string) => `sms:${digits(phone)}`
export const mailUrl = (email: string) => `mailto:${email.trim()}`
export const open = (url: string) => Linking.openURL(url).catch(() => {})
export const callPhone = (phone?: string | null) => (phone ? open(telUrl(phone)) : undefined)
export const textPhone = (phone?: string | null) => (phone ? open(smsUrl(phone)) : undefined)
export const emailTo = (email?: string | null) => (email ? open(mailUrl(email)) : undefined)
