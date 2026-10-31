# Parity: live AI call answering (field service and basic — shared by every trade with the AI Receptionist)

Branch `cloud/fieldservice-parity`, item 12 (2026-10-31, built last as the brief ordered). Feature id `ai_call_answering`
(NOT READY, `hidden` in `featureRegistry.ts`; offered to the same templates as `ai_receptionist`). Today's `ai_receptionist`
stays what it was — missed-call text-back, voicemail written out — and the new feature sits in front of it on the same line.

Server: `apps/unified/server/crm/comms/callDialogue.ts` (the deterministic dialogue engine and the keyword intent reader),
`aiCallAnsweringService.ts` (settings, hours, the engine's effects carried out, transcript, call-log row),
`aiCallAnswering.ts` (`/api/ai-call-answering`: the provider's signed turn webhooks; the owner's settings, services, status and
calls behind sign-in + feature + `ai-receptionist:read` / `:update`), `voiceProvider.ts` (the provider adapter: Twilio
Programmable Voice, and the in-memory test provider), and the hand-off inside the existing voice webhook
`/api/ai-receptionist/webhook/voice/:companyId` (`aiReceptionist.ts`). The recording comes back through the existing
`/webhook/recording/:companyId` and is filed on the call without running the missed-call rules; the status callback closes a
call the caller hung up on. Booking goes through `findOpenSlots()` (`server/data/techAvailability.ts`, item 8) and the job is
made under the job book's lock (`data/bookingLock.ts lockJobBook`, the same key `jobs.ts` takes) with the slot checked again
inside it, numbered like every job, with the vertical's `onCreate` hooks run.
Screen: `web/src/crm/pages/AiCallAnsweringPage.tsx` (menu row "AI Call Answering", gated by the feature and
`ai-receptionist:read`). Tables: `ai_receptionist_settings.call_answering` (json), `ai_call_session`, `ai_call_turn` (0059).
Test: `tests/ai-call-answering.test.ts` (33 cases: the engine on its own, then both verticals through the real server as
Twilio would call it — fails without the change; run both ways 2026-10-31).

**Leaders reviewed (from memory of their help pages, 2026-10-31; NOT fetched in this session — a page may have moved):**
Jobber — *AI Receptionist* (Jobber Help Center, "AI Receptionist" under Jobber Copilot / Add-ons, help.getjobber.com): answers
calls the team misses or routes to it, in the business's name; books into open availability on the schedule; answers
questions about services, hours and service area from the business's profile; takes a message; sends the transcript and
summary to the Jobber inbox / the client's record; the owner sets the greeting, business facts and when it answers.
Housecall Pro — *AI CSR* ("AI Call Answering" / "Pro Assistant" in Housecall Pro's Help Center, help.housecallpro.com): answers
24/7 on the business's number, books jobs into the online-booking availability, qualifies the caller (name, address,
service), transfers to a person on request, records and transcribes the call onto the customer's profile, and notifies the
office; the owner sets the hours it answers, the services it may book, the voice greeting and a transfer number.
Neither page was fetched; the rows below are the capabilities both describe, not quotations.

| # | Leader (from its page) | Ours | Mark |
|---|---|---|---|
| 1 | The call answered live by an AI voice on the business's number, when the business chooses (always / after hours / its own hours) | The AI Receptionist's voice webhook hands the call to the assistant when `ai_call_answering` is on, the owner's switch is on and the moment is inside the owner's choice: every call, outside business hours (Settings › Company), inside them, or its own week of hours — judged on the business's clock. Otherwise the line rings and takes a message exactly as before | matches |
| 2 | Uses the business's services, hours, service area and prices | Services and prices from the Pricebook (active services shown to customers; labor hours set the visit length); hours from Settings › Company; service area the owner's ZIPs / places, else the website's service areas and the booking ZIP zones. Prices are spoken only when the owner says so | matches |
| 3 | Nothing improvised: speaks in the business's voice | **Every** utterance is one of the owner's wording templates (greeting, each question, confirmations, hours / price / area answers, fallback, transfer lines, goodbye), with variables filled from what the owner set up. The caller's own words are never read back except their name and address. Anything outside the templates gets the owner's fallback line and the offer of a message. A deterministic engine, tested path by path; an LLM reader can stand behind the `IntentReader` interface later without changing a spoken word | matches; beats on auditability (no prompt) |
| 4 | Books into real open times | The service, the name, the address (checked against the service area), then up to three openings from Find a time (shifts or business hours, around booked jobs, with drive time, never before now), read out and picked by ordinal, day, time, morning / afternoon or person; confirmed with the price where allowed; the job made under the job lock with the slot checked again — a slot taken in between is refused and new ones offered. The job is the vertical's ordinary job (numbered, assigned, estimated hours and value, address and ZIP, `source: ai_call`), and its `onCreate` hooks run | matches |
| 5 | Creates the lead / customer | A new caller becomes a contact the moment they give their name (a lead; a client once booked), linked to the call; a known number is greeted as a known customer and never asked their name. With the Lead Inbox on, a message or booking also files an inbox lead | matches |
| 6 | Takes a message | Asked for (the name first for a stranger), saved on the contact's activity and the call-log notes, and announced: a phone notification to owners, admins and managers, a live alert, and the Lead Inbox row | matches |
| 7 | Transfers to a person on rules | The owner's number and rules: their keywords, "asked for a person", emergency words (owner's list), an existing customer, every call outside business hours. Nobody picks up in 25 s → the owner's line and a message. No number set → the emergency line / the transfer-failed line and a message | matches |
| 8 | Transcript and recording on the customer's record | Every turn (`ai_call_turn`) with what the engine read the caller's line as; the call-log row carries the joined transcript, a summary ("Booked Furnace tune-up for Wednesday, November 4 at 9:00 am with Tia Tech (JOB-00001)"), the contact, the outcome; the recording is started at pick-up and arrives through the existing recording webhook onto the same row. The page lists each call with its transcript, job and contact links | matches (the contact page shows the activity rows; the full transcript is on the AI Call Answering page and the call log) |
| 9 | Owner settings: on / off, hours, wording | The page: on / off, when, its own week of hours, recording, booking limits and prices, service area, transfer number and rules, every line of wording (blank = the standard line shown), the services it will name, and the calls it answered | matches |
| 10 | Spoken over a real telephony provider | The provider adapter: Twilio Programmable Voice — `<Gather input="speech">` turns on signed webhooks, `<Say>`, `<Dial>`, the recording by REST — rendered and tested; the ConversationRelay (streaming) variant's TwiML is rendered but its socket is not mounted (SPEC-PENDING). **No live call is made from the repository.** The owner's provider account and the steps below are what remain | partly — the owner's list |

**Parity verdict:** every row is built and tested on both verticals up to the provider step; the trade is at full parity for
this doc once the owner's provider account is connected (row 10). Not seen in a real browser / on a real phone / on a real
call: verified by the server suite and `build:web` only.

**Home care note:** callers are matched to `clients` for "known" (the receptionist's `callers: 'clients'` rule) but a new caller
is filed as a contact; the message and booking go on that contact.

## The owner's list (what only the owner can do)

1. **Voice provider account.** A Twilio account with Programmable Voice (the same account the AI Receptionist and texting use —
   Settings › Integrations, or the platform account) — or an equivalent. The business's number's **Voice URL** must point at
   `https://<the business's app address>/api/ai-receptionist/webhook/voice/<company id>` (POST) and its **status callback** at
   `/api/ai-receptionist/webhook/status/<company id>`, as the AI Receptionist's line already needs.
2. **Speech.** The default path uses Twilio's own speech recognition (`<Gather input="speech">`) and text-to-speech (`<Say
   voice="alice">`): no separate speech vendor. A natural-sounding voice (Twilio's Polly / Google voices, or ConversationRelay
   with ElevenLabs / Deepgram) is a provider-side choice: the `voice` attribute and the ConversationRelay settings.
3. **Number porting / carrier.** If the business's published number is not on the provider yet: a port-in request to Twilio
   (a Letter of Authorization, a recent bill, 2–4 weeks for a US number), or call-forwarding from the carrier to a Twilio
   number in the meantime (every call then shows the Twilio number as its "To"). A toll-free number needs its own
   verification. Emergency (911) calling must be set up on the Twilio number if staff will dial out from it.
4. **Recording consent per state.** Where the business records (the "Record calls" switch), the recording notice is spoken right
   after the greeting. One-party-consent states need no notice; **all-party-consent states** (California, Connecticut, Delaware,
   Florida, Illinois, Maryland, Massachusetts, Michigan, Montana, Nevada, New Hampshire, Oregon, Pennsylvania, Washington —
   check the current list with counsel) require every party to be told, which the notice does; a business calling across
   state lines should follow the stricter state. The owner decides whether to record at all.
5. **The receptionist's identity.** The default greeting says "I'm the automated assistant"; some states (California's bot
   disclosure law) require a bot to say it is one when it could mislead — keep that line in the greeting.
6. **A2P / voice compliance** is not needed for inbound voice; outbound texts the booking sends (the customer's booking text)
   use the texting registration the business already has.

## SPEC-PENDING until the provider contract is confirmed

- `voiceProvider.ts twilioVoiceProvider.startRecording`: the "record an in-progress call" REST resource
  (`POST /2010-04-01/Accounts/{sid}/Calls/{CallSid}/Recordings.json` with `RecordingStatusCallback`) — the parameter set and
  the dual-channel option are to be confirmed on the owner's account; a refusal is logged and never stops the call. The
  recording's arrival at `/webhook/recording/:companyId` is the existing, tested path.
- `voiceProvider.ts conversationRelayTwiml`: the streaming variant (`<Connect><ConversationRelay url="wss://…"/></Connect>`
  and its `{ type: 'prompt' | 'text' | 'end' }` socket messages). The same engine answers it turn for turn; the socket is not
  mounted until the message set and the transfer/handoff message are verified.
- Twilio's `<Gather input="speech">` attributes used (`speechTimeout="auto"`, `actionOnEmptyResult`, `hints`, `language`) are
  Twilio's documented ones; a live test on the owner's number confirms the recogniser's behaviour with the hints.
- No live call, recording or network request is made from the repository or its tests (`AI_CALL_ANSWERING_NO_NETWORK`, and
  `NODE_ENV=test`, block the one REST call).
