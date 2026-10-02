// The stripper's own cases. Five guards depend on it, and both of its documented traps are the kind
// that make a guard fail on correct code — or, worse, pass over code it can no longer see.
//
//   bun scripts/lib/stripComments.test.ts
import { stripComments, stripSource } from './stripComments.ts'

let passed = 0, failed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

// ── the original trap: a route pattern that looks like a comment opener ────────────────────────
{
  const src = [
    `app.get('/file/*', handler)`,
    `/** a doc comment a few lines below that route */`,
    `const kept = 1`,
  ].join('\n')
  const out = stripSource(src)
  check('a /* inside a string is not a comment opener', out.includes(`'/file/*'`), out)
  check('…and the real comment below it still goes', !out.includes('doc comment'), out)
  check('…and the code after that comment survives', out.includes('const kept = 1'), out)
}

// ── the T35 trap: an apostrophe in JSX prose ──────────────────────────────────────────────────
{
  const src = [
    `<p>above the sheet's measured cost.</p>`,
    `/*`,
    ` * a comment mentioning bg-white with no dark partner`,
    ` */`,
    `<div className="bg-white dark:bg-slate-900">text</div>`,
  ].join('\n')
  const out = stripSource(src)
  check('an unpaired apostrophe in prose does not open a string', out.includes(`sheet's measured`), out)
  check('…so the block comment after it is still stripped', !out.includes('bg-white with no dark partner'), out)
  check('…and the markup after the comment is still visible to the caller',
    out.includes('className="bg-white dark:bg-slate-900"'), out)
}

// ── a real string still behaves like one ──────────────────────────────────────────────────────
{
  const out = stripSource(`const s = 'a // b /* c */ d'\n// gone\nconst t = 2`)
  check('a comment opener inside a real string is preserved', out.includes(`'a // b /* c */ d'`), out)
  check('…and the line comment after it is removed', !out.includes('gone'), out)
  check('…and the next statement survives', out.includes('const t = 2'), out)
}

// ── escapes and template literals ─────────────────────────────────────────────────────────────
{
  const out = stripSource(`const q = 'it\\'s fine' // tail\nconst u = 3`)
  check('an escaped quote inside a string does not end it', out.includes(`'it\\'s fine'`) && out.includes('const u = 3'), out)
  const t = stripSource('const x = `line one\nline two // not a comment`\n// gone\nconst y = 4')
  check('a template literal may span lines and keeps its contents', t.includes('line two // not a comment'), t)
  check('…and a comment after it is still stripped', !t.includes('gone') && t.includes('const y = 4'), t)
}

// ── two apostrophes on one line read as a string, which is harmless ────────────────────────────
{
  const out = stripSource(`<p>it's the vendor's order</p>\n/* gone */\nconst z = 5`)
  check('prose with two apostrophes still leaves later comments strippable', !out.includes('gone') && out.includes('const z = 5'), out)
}

// ── stripComments keeps CRLF out of the caller's way only via stripSource ─────────────────────
{
  check('stripSource normalises CRLF', !stripSource('const a = 1\r\n// x\r\nconst b = 2').includes('\r'))
  check('stripComments is the raw form', typeof stripComments === 'function')
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
