# Salon #13 — Patch test status

## Source (help-centre page actually read)

- Fresha — Record client patch tests: https://www.fresha.com/help-center/knowledge-base/clients/55-record-client-patch-tests (Fresha is the only leader the brief names for this). Vagaro, GlossGenius, Boulevard and Mindbody: no help-centre page on patch tests was reached; nothing below claims a match against them.

## What Fresha does, and where this stands

| Capability (Fresha) | Here | Status |
|---|---|---|
| A recorded test has a date and a status: Pending, Passed or Failed | Date and result: Passed or Failed. A date with no result (everything recorded before this change) counts as passed | **Matches, without "Pending"** — a test not yet taken is simply "none on record" |
| A test is valid six months from its date, not changeable | Valid 180 days, the number the Book's warning already used. Not changeable | **Matches** |
| Who ran the test, a title and a description per test | One date and one result per client; no tester, no title | **Not built** |
| Several tests kept in a client's history | Only the latest | **Not built** |
| Bookings are not blocked — reminders only; manual bookings show an alert | Online booking of a patch-test service is **refused** (the client is asked to call) when none is on record, it has run out, or it failed; the desk can still book it, but types a reason, kept on the appointment | **Beats** — only when the salon switches the rule on |
| Online bookers asked to confirm they hold a valid test | Not asked; the server checks the record instead | **Different, stricter** |
| (Owner's decision 2026-10-30) A client who needs a test is not simply turned away | The salon can name its patch-test appointment (Settings › The Book). A held client is then offered it, with a link to its booking page, books that, and books the colour once the test is on record as passed. With none named they are asked to call | **Beats** — only when named |
| Alert on a manual booking for a service that needs a test | The desk is stopped and asked for a reason; the Book's existing warning at check-in is unchanged | **Matches** |
| The appointment message tells the client they need a test | Not built | **Not built** |

## Notes for the owner

- The rule is a switch in Settings › The Book, **off by default**, so no live salon's online booking changes until its owner turns it on.
- A new client has no test on record, so with the rule on they cannot book a patch-test service online. If the salon has named its patch-test appointment they are offered that first; otherwise they are told to call. Whoever runs the test still records its date and result on the client's chart — it is not recorded automatically when the patch-test appointment is completed.
