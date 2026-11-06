// Twomiah Care, row 13 (care_caregiver_surveys): the pure logic behind "How is it going?" on the phone, run under plain bun, and the
// screen's two rules — an answer is sent directly (never queued: the office reads it at once) and there are no native dialogs.
//
//   bun run tests/mobile/caregiver-survey.test.ts
import { surveyProblem, surveyBody, SCALE_WORDS, type SurveyQuestion } from '../../apps/mobile/src/care/rules.ts'
import { readFileSync } from 'fs'
import { join } from 'path'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}
const QS: SurveyQuestion[] = [
  { id: 'q1', text: 'How happy are you working with us?', kind: 'scale' },
  { id: 'q5', text: 'Would you recommend working here to a friend?', kind: 'yes_no' },
  { id: 'q6', text: 'Anything we should know?', kind: 'text' },
]

check('an unanswered scale question names itself', surveyProblem(QS, {}) === 'Pick 1 to 5 for "How happy are you working with us?".')
check('a scale answer outside 1–5 is not an answer', surveyProblem(QS, { q1: 6, q5: true }) === 'Pick 1 to 5 for "How happy are you working with us?".')
check('an unanswered yes/no names itself', surveyProblem(QS, { q1: 4 }) === 'Answer yes or no to "Would you recommend working here to a friend?".')
check('free text may be left empty', surveyProblem(QS, { q1: 4, q5: false }) === null)
check('the body carries the scale and yes/no answers and leaves empty text out', JSON.stringify(surveyBody(QS, { q1: 4, q5: false, q6: '   ' })) === JSON.stringify({ q1: 4, q5: false }))
check('a text answer is trimmed and kept', surveyBody(QS, { q1: 2, q5: true, q6: '  more hours please ' }).q6 === 'more hours please')
check('every point of the scale has a word', SCALE_WORDS.length === 5 && SCALE_WORDS[0] === 'Very unhappy' && SCALE_WORDS[4] === 'Very happy')

const root = join(import.meta.dir, '../../apps/mobile')
const screen = readFileSync(join(root, 'app/(care)/survey.tsx'), 'utf8')
const more = readFileSync(join(root, 'app/(tabs)/more-homecare.tsx'), 'utf8')
const push = readFileSync(join(root, 'src/hooks/usePushNotifications.ts'), 'utf8')
check('an answer is a direct call, never queued (the office reads it at once)', screen.includes("carePost(`/api/caregiver-surveys/me/${p.id}/answer`") && !screen.includes('queue.'))
check('no native dialogs on the survey screen', !/Alert\.alert|window\.confirm/.test(screen))
check('each scale button says its number and its word for a screen reader', screen.includes('accessibilityLabel={`${n}, ${SCALE_WORDS[n - 1]}`}'))
check('the More menu shows "How is it going?" only when the survey page answers, with the count waiting', more.includes('surveys !== null') && more.includes("'/(care)/survey'") && more.includes('badge: surveys'))
check('a survey push opens the survey screen', push.includes("caregiver_survey: '/(care)/survey'"))

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
