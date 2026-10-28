/** Call / text / email open the phone's own apps. Nothing here talks to the server. */
import { Linking } from 'react-native'
import { telUrl, smsUrl, mailUrl } from './links'

const open = (url: string) => Linking.openURL(url).catch(() => {})
export const callPhone = (phone?: string | null) => (phone ? open(telUrl(phone)) : undefined)
export const textPhone = (phone?: string | null) => (phone ? open(smsUrl(phone)) : undefined)
export const emailTo = (email?: string | null) => (email ? open(mailUrl(email)) : undefined)
