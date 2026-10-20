// Free text: one-line fields squeeze every run of whitespace; notes and descriptions keep the person's line breaks
// (server/core/sanitize.ts). Markup is stripped from both.
import { test, expect } from 'bun:test'
import { cleanText, cleanLines, stripHtmlKeepLines } from '../server/core/sanitize.ts'

test('a note keeps its lines; spaces inside a line collapse; blank-line runs become one', () => {
  expect(stripHtmlKeepLines('Gate code 1234\r\nDog   in yard\n\n\n\nCall first  ')).toBe('Gate code 1234\nDog in yard\n\nCall first')
})

test('markup is still stripped from a note, scripts with their contents; <br> is a line break', () => {
  expect(stripHtmlKeepLines('<b>Bring</b> ladder<br>and <script>alert(1)</script>tarp\njavascript:x')).toBe('Bring ladder\nand tarp\nx')
})

test('a one-line field (a name, a title) still squeezes line breaks to a space', () => {
  expect(cleanText(1).parse('Kitchen\nremodel')).toBe('Kitchen remodel')
})

test('cleanLines(1) refuses a note that was only markup or blank lines', () => {
  expect(cleanLines(1).safeParse('<p></p>\n\n').success).toBe(false)
  expect(cleanLines().parse('<i>ok</i>')).toBe('ok')
})
