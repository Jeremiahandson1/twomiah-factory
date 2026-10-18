// An address the server may send a request to on an owner's say-so (a webhook): https, and resolving only to the
// public internet. Without this an owner — or anyone with their login — could point the server at its own network
// (the cloud metadata address, a database port) and read the reply in the delivery status. Checked when the address
// is saved and again before every send, because what a name resolves to can change.
import dns from 'node:dns/promises'
import net from 'node:net'

const PRIVATE_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const v4 = (ip: string) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return PRIVATE_V4.some(([base, bits]) => (v4(ip) >>> (32 - bits)) === (v4(base) >>> (32 - bits)))
  const a = ip.toLowerCase()
  if (a === '::' || a === '::1') return true
  if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(a)
}

/** Null when the address is fine to send to; otherwise why not, in the owner's words. */
export async function outboundUrlProblem(raw: string): Promise<string | null> {
  let u: URL
  try { u = new URL(raw) } catch { return 'That is not a web address.' }
  if (u.protocol !== 'https:') return 'The address must start with https://.'
  if (u.username || u.password) return 'The address must not contain a password.'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return 'That address is not on the public internet.'
  let addresses: string[]
  try {
    addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((r) => r.address)
  } catch {
    return 'That address could not be found.'
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) return 'That address is not on the public internet.'
  return null
}
