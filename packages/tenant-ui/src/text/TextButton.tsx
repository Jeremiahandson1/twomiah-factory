// "Text" — opens the user's OWN texting app with the customer's number and a ready message. One component for every
// place a customer's phone number shows (never a copy). No Twilio and no cost: it is the user's own phone and plan; the
// paid automatic texting (Settings › Texting) is separate and not touched here.
//
//   on a phone or tablet   the sms: link opens Messages / the default texting app, message ready
//   on a computer          a QR code the user scans with their phone (opens the same text on any phone), and an "Open on this
//                          computer" link — which only does something where the computer is linked to a phone
//
// The words of the messages come from textMessages.ts; the link syntax, which differs between iPhone and Android, from smsLink.ts.
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Copy, Check, ExternalLink } from 'lucide-react'
import { Modal } from '../invoicing/ui'
import { AuthContext } from '../auth/AuthContext'
import { qrSvg } from './qr'
import { canTextHere, deviceTarget, smsHref, smsNumber } from './smsLink'
import { textMessages, type TextContext, type TextMessage } from './textMessages'

export interface TextButtonProps extends Pick<TextContext, 'name' | 'invoice' | 'quote'> {
  /** The customer's number as the record has it. Not a usable number: the button is not drawn. */
  phone: string | null | undefined
  /** Overrides the business name (the app's company name is used when this is not given). */
  businessName?: string | null
  /** Called when a message is chosen and the texting app (or the QR dialog) opens — e.g. a lead marked as contacted. */
  onTexted?: () => void
  /** Smaller for a dense list row. */
  compact?: boolean
  className?: string
}

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700'

export function TextButton({ phone, name, invoice, quote, businessName, onTexted, compact, className = '' }: TextButtonProps) {
  const auth = useContext(AuthContext)
  const business = businessName ?? (auth?.company as { name?: string } | null | undefined)?.name ?? null
  const messages = useMemo(() => textMessages({ name, businessName: business, invoice, quote }), [name, business, invoice?.link, invoice?.number, quote?.link, quote?.number])
  const [menu, setMenu] = useState(false)
  const [chosen, setChosen] = useState<TextMessage | null>(null)
  const root = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!menu) return
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
  }, [menu])

  if (!smsNumber(phone)) return null

  const pick = (m: TextMessage) => {
    setMenu(false)
    onTexted?.()
    if (canTextHere()) { const href = smsHref(phone, m.body, deviceTarget()); if (href) window.location.href = href } else setChosen(m)
  }

  return (
    <span ref={root} className={`relative inline-block ${className}`}>
      <button type="button" onClick={() => setMenu((o) => !o)} aria-haspopup="menu" aria-expanded={menu}
        aria-label={`Text ${name || phone} from your own phone`}
        className={`${btn} ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} font-medium`}>
        <MessageSquare className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} aria-hidden="true" />Text
      </button>
      {menu && (
        <div role="menu" aria-label="Choose a message" className="fixed inset-x-2 bottom-2 z-30 rounded-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:mt-1 sm:min-w-[15rem] border border-gray-200 bg-white py-1 shadow-lg dark:border-slate-600 dark:bg-slate-900">
          {messages.map((m) => (
            <button key={m.id} type="button" role="menuitem" onClick={() => pick(m)}
              className="block w-full px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:text-slate-100 dark:hover:bg-slate-800 dark:focus:bg-slate-800">
              {m.label}
            </button>
          ))}
          <p className="border-t border-gray-100 px-3 pt-2 pb-1 text-xs text-gray-600 dark:border-slate-700 dark:text-slate-300">Sent from your own phone and number — free.</p>
        </div>
      )}
      <TextOnPhoneDialog message={chosen} phone={phone} name={name} onClose={() => setChosen(null)} />
    </span>
  )
}

/** On a computer: the QR code to scan with a phone, the message, and the "Open on this computer" link. */
function TextOnPhoneDialog({ message, phone, name, onClose }: { message: TextMessage | null; phone: string | null | undefined; name?: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const qr = useMemo(() => {
    if (!message) return null
    const href = smsHref(phone, message.body, 'either')
    if (!href) return null
    try { return qrSvg(href, `QR code: text ${name || 'the customer'} from your phone`) } catch { return null }
  }, [message, phone, name])
  if (!message) return null
  const computer = smsHref(phone, message.body, 'either')
  const copy = async () => { try { await navigator.clipboard.writeText(message.body); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the message is on screen to copy by hand */ } }
  return (
    <Modal isOpen onClose={onClose} title={`Text ${name || 'this customer'} from your phone`} size="sm">
      <div className="space-y-4 text-sm text-gray-900 dark:text-slate-100">
        {qr ? (
          <div className="flex flex-col items-center gap-2">
            {/* Black on white with its own quiet zone, so it scans in dark mode too. The string is our own SVG (qr.ts). */}
            <div className="rounded-lg bg-white p-1 max-w-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <p className="text-center text-gray-700 dark:text-slate-200">Point your phone's camera at this. It opens your texting app with the message ready — any phone.</p>
          </div>
        ) : (
          <p className="text-gray-700 dark:text-slate-200">This message is too long for a code. Shorten it, or copy it below and paste it into your texting app.</p>
        )}
        {message.body && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-600 dark:text-slate-300">The message</p>
            <p className="whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-3 dark:bg-slate-800">{message.body}</p>
            <button type="button" onClick={copy} className={`${btn} mt-2 px-2.5 py-1 text-xs`}>
              {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}{copied ? 'Copied' : 'Copy message'}
            </button>
          </div>
        )}
        <div className="border-t border-gray-200 pt-3 dark:border-slate-700">
          {computer && (
            <a href={computer} className="inline-flex items-center gap-1.5 font-medium text-orange-700 underline dark:text-orange-200">
              <ExternalLink className="w-4 h-4" aria-hidden="true" />Open on this computer
            </a>
          )}
          <p className="mt-1 text-gray-700 dark:text-slate-300">
            Works on a Mac signed in to the same Apple ID as an iPhone. On Windows it depends on Phone Link being set up — if nothing happens, use the code instead. If the message arrives empty, copy it from here.
          </p>
          <p className="mt-2 text-gray-700 dark:text-slate-300">It is sent from your own phone and number, on your own plan — not through Twomiah.</p>
        </div>
      </div>
    </Modal>
  )
}
